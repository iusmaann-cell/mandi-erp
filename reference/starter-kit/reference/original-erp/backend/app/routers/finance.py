import datetime
import openpyxl
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from .. import models, schemas, reporting
from ..security import current_user
from ..database import get_db

router = APIRouter(prefix="/reports", tags=["Finance Reports"])


def _default_range(start_date, end_date):
    end_date = end_date or datetime.datetime.utcnow()
    start_date = start_date or (end_date - datetime.timedelta(days=30))
    return start_date, end_date


# ---------------- P&L ----------------

@router.get("/pnl", response_model=schemas.PnLOut)
def get_pnl(
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """
    Revenue and cost of goods sold, computed directly from sales invoices, commission
    invoices, dispatch cost records, and logged expenses — not a formal GL, but an
    accurate roll-up of the real transactions already in the system.
    """
    start_date, end_date = _default_range(start_date, end_date)

    sales_revenue = db.query(func.coalesce(func.sum(models.SalesInvoice.subtotal), 0.0)).filter(
        models.SalesInvoice.invoice_date >= start_date,
        models.SalesInvoice.invoice_date <= end_date,
    ).scalar()

    commission_revenue = db.query(func.coalesce(func.sum(models.CommissionInvoice.amount), 0.0)).filter(
        models.CommissionInvoice.invoice_date >= start_date,
        models.CommissionInvoice.invoice_date <= end_date,
    ).scalar()

    cogs = db.query(
        func.coalesce(func.sum(models.SalesDispatchLine.quantity * models.SalesDispatchLine.cogs_rate), 0.0)
    ).join(models.SalesDispatch).filter(
        models.SalesDispatch.dispatch_date >= start_date,
        models.SalesDispatch.dispatch_date <= end_date,
    ).scalar()

    total_expenses = db.query(func.coalesce(func.sum(models.Expense.amount), 0.0)).filter(
        models.Expense.expense_date >= start_date,
        models.Expense.expense_date <= end_date,
    ).scalar()

    total_revenue = sales_revenue + commission_revenue
    gross_profit = total_revenue - cogs
    net_profit = gross_profit - total_expenses

    return schemas.PnLOut(
        start_date=start_date, end_date=end_date, plant=None,
        sales_revenue=sales_revenue, commission_revenue=commission_revenue,
        total_revenue=total_revenue, cogs=cogs, gross_profit=gross_profit,
        total_expenses=total_expenses, net_profit=net_profit,
    )


@router.get("/pnl-by-item")
def get_pnl_by_item(
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """Revenue, COGS, and margin broken down per SKU — a more useful lens than
    plant-wise, since a single plant produces many SKUs and a single SKU (e.g. a
    packed bottle) passes through more than one plant."""
    start_date, end_date = _default_range(start_date, end_date)

    revenue_rows = db.query(
        models.SalesInvoiceLine.item_id,
        func.sum(models.SalesInvoiceLine.amount).label("revenue"),
        func.sum(models.SalesInvoiceLine.quantity).label("qty_sold"),
    ).join(models.SalesInvoice).filter(
        models.SalesInvoice.invoice_date >= start_date,
        models.SalesInvoice.invoice_date <= end_date,
    ).group_by(models.SalesInvoiceLine.item_id).all()

    cogs_rows = db.query(
        models.SalesDispatchLine.item_id,
        func.sum(models.SalesDispatchLine.quantity * models.SalesDispatchLine.cogs_rate).label("cogs"),
    ).join(models.SalesDispatch).filter(
        models.SalesDispatch.dispatch_date >= start_date,
        models.SalesDispatch.dispatch_date <= end_date,
    ).group_by(models.SalesDispatchLine.item_id).all()
    cogs_by_item = {r.item_id: r.cogs for r in cogs_rows}

    output = []
    for r in revenue_rows:
        item = db.query(models.Item).filter(models.Item.id == r.item_id).first()
        cogs = cogs_by_item.get(r.item_id, 0.0)
        output.append({
            "item_id": r.item_id,
            "item_name": item.name if item else "Unknown",
            "quantity_sold": r.qty_sold,
            "revenue": r.revenue,
            "cogs": cogs,
            "gross_profit": r.revenue - cogs,
            "margin_percent": ((r.revenue - cogs) / r.revenue * 100) if r.revenue else None,
        })
    output.sort(key=lambda x: x["revenue"], reverse=True)
    return output


@router.get("/expenses-by-plant")
def get_expenses_by_plant(
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    start_date, end_date = _default_range(start_date, end_date)
    rows = db.query(
        models.Expense.plant,
        func.sum(models.Expense.amount).label("total"),
    ).filter(
        models.Expense.expense_date >= start_date,
        models.Expense.expense_date <= end_date,
    ).group_by(models.Expense.plant).all()
    return [{"plant": r.plant.value if r.plant else "general/admin", "total": r.total} for r in rows]


# ---------------- AP / AR Aging ----------------

def _compute_aging(entries, as_of):
    """
    Simplified aging: apply total payments (credits) against the oldest bills
    (debits) first — FIFO settlement — then bucket whatever's left unpaid by how
    old that specific bill is. This is the standard simplified approach when
    individual due dates per invoice aren't separately tracked.
    """
    debits = sorted([e for e in entries if e.direction == models.LedgerDirection.debit], key=lambda e: e.entry_date)
    remaining_credit = sum(e.amount for e in entries if e.direction == models.LedgerDirection.credit)

    buckets = {"current": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "over_90": 0.0}
    for d in debits:
        amt = d.amount
        if remaining_credit > 1e-9:
            applied = min(remaining_credit, amt)
            amt -= applied
            remaining_credit -= applied
        if amt > 1e-6:
            age = (as_of - d.entry_date).days
            if age <= 30:
                buckets["current"] += amt
            elif age <= 60:
                buckets["days_31_60"] += amt
            elif age <= 90:
                buckets["days_61_90"] += amt
            else:
                buckets["over_90"] += amt
    return buckets


@router.get("/ap-aging", response_model=List[schemas.AgingBucketOut])
def get_ap_aging(db: Session = Depends(get_db)):
    """What we owe vendors, aged by how long each unpaid bill has been outstanding."""
    as_of = datetime.datetime.utcnow()
    vendors = db.query(models.Vendor).filter(models.Vendor.is_active == 1).all()
    output = []
    for v in vendors:
        entries = db.query(models.VendorLedgerEntry).filter(models.VendorLedgerEntry.vendor_id == v.id).all()
        if not entries:
            continue
        buckets = _compute_aging(entries, as_of)
        total = sum(buckets.values())
        if total < 1e-6:
            continue
        output.append(schemas.AgingBucketOut(
            party_id=v.id, party_name=v.name, total_outstanding=total, **buckets,
        ))
    return output


@router.get("/ar-aging-distributors", response_model=List[schemas.AgingBucketOut])
def get_ar_aging_distributors(db: Session = Depends(get_db)):
    """What distributors owe us for goods sold, aged."""
    as_of = datetime.datetime.utcnow()
    distributors = db.query(models.Distributor).filter(models.Distributor.is_active == 1).all()
    output = []
    for d in distributors:
        entries = db.query(models.DistributorLedgerEntry).filter(models.DistributorLedgerEntry.distributor_id == d.id).all()
        if not entries:
            continue
        buckets = _compute_aging(entries, as_of)
        total = sum(buckets.values())
        if total < 1e-6:
            continue
        output.append(schemas.AgingBucketOut(
            party_id=d.id, party_name=d.name, total_outstanding=total, **buckets,
        ))
    return output


@router.get("/ar-aging-toll-customers", response_model=List[schemas.AgingBucketOut])
def get_ar_aging_toll_customers(db: Session = Depends(get_db)):
    """What toll customers owe us for processing commission, aged."""
    as_of = datetime.datetime.utcnow()
    customers = db.query(models.Customer).filter(models.Customer.is_active == 1).all()
    output = []
    for c in customers:
        entries = db.query(models.CustomerLedgerEntry).filter(models.CustomerLedgerEntry.customer_id == c.id).all()
        if not entries:
            continue
        buckets = _compute_aging(entries, as_of)
        total = sum(buckets.values())
        if total < 1e-6:
            continue
        output.append(schemas.AgingBucketOut(
            party_id=c.id, party_name=c.name, total_outstanding=total, **buckets,
        ))
    return output


# ---------------- Sales Tax ----------------

@router.get("/sales-tax-summary", response_model=schemas.SalesTaxSummaryOut)
def get_sales_tax_summary(
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """
    Output tax (sales tax you collected from distributors) for a period. This is
    informational, built from your own sales invoices — NOT a validated FBR filing
    format. Have your accountant confirm the actual return before submission; this
    is meant to save you from re-adding up invoices by hand, not to replace their
    review, especially since it doesn't yet track input tax paid on purchases.
    """
    start_date, end_date = _default_range(start_date, end_date)
    invoices = db.query(models.SalesInvoice).filter(
        models.SalesInvoice.invoice_date >= start_date,
        models.SalesInvoice.invoice_date <= end_date,
    ).all()
    taxable_sales = sum(i.subtotal for i in invoices)
    output_tax = sum(i.tax_amount for i in invoices)
    return schemas.SalesTaxSummaryOut(
        start_date=start_date, end_date=end_date,
        taxable_sales=taxable_sales, output_tax_collected=output_tax,
        invoice_count=len(invoices),
    )


# ---------------- Financial Snapshot ----------------

@router.get("/financial-snapshot", response_model=schemas.FinancialSnapshotOut)
def get_financial_snapshot(db: Session = Depends(get_db)):
    """
    A point-in-time overview pulled from the sub-ledgers already in the system —
    NOT a formal trial balance from a double-entry general ledger (this system
    doesn't maintain one). Useful for a quick pulse check; for statutory accounts,
    have an accountant prepare proper financial statements.
    """
    def net_ledger(model):
        debit = db.query(func.coalesce(func.sum(model.amount), 0.0)).filter(
            model.direction == models.LedgerDirection.debit
        ).scalar()
        credit = db.query(func.coalesce(func.sum(model.amount), 0.0)).filter(
            model.direction == models.LedgerDirection.credit
        ).scalar()
        return debit - credit

    total_ap = net_ledger(models.VendorLedgerEntry)
    total_ar_distributors = net_ledger(models.DistributorLedgerEntry)
    total_ar_toll = net_ledger(models.CustomerLedgerEntry)

    inventory_value = db.query(
        func.coalesce(func.sum(models.StockLedgerEntry.quantity * models.StockLedgerEntry.rate), 0.0)
    ).filter(models.StockLedgerEntry.is_toll_stock == 0).scalar()

    total_sales_revenue = db.query(func.coalesce(func.sum(models.SalesInvoice.subtotal), 0.0)).scalar()
    total_commission_revenue = db.query(func.coalesce(func.sum(models.CommissionInvoice.amount), 0.0)).scalar()
    total_cogs = db.query(
        func.coalesce(func.sum(models.SalesDispatchLine.quantity * models.SalesDispatchLine.cogs_rate), 0.0)
    ).scalar()
    total_expenses = db.query(func.coalesce(func.sum(models.Expense.amount), 0.0)).scalar()

    return schemas.FinancialSnapshotOut(
        as_of=datetime.datetime.utcnow(),
        total_accounts_payable=total_ap,
        total_accounts_receivable_distributors=total_ar_distributors,
        total_accounts_receivable_toll=total_ar_toll,
        total_inventory_value=inventory_value,
        total_sales_revenue_to_date=total_sales_revenue,
        total_commission_revenue_to_date=total_commission_revenue,
        total_cogs_to_date=total_cogs,
        total_expenses_to_date=total_expenses,
    )


# ---------------- Expense report (expenses + PO payments, by day) ----------------

def _expense_report_data(db: Session, start: datetime.date, end: datetime.date):
    """Everything paid out in the range, grouped by Pakistan-time day: daily expenses plus the
    purchase-order payments (advances and part-payments) made that day. Freight is reported as
    two separate single figures — PO freight and expense freight — that are already part of the
    amounts above them, not extra money."""
    lo, hi = reporting.range_bounds(start, end)
    days = {}

    def day(d):
        return days.setdefault(d, {"date": d, "rows": [], "total": 0.0})

    exp_freight = 0.0
    for e in db.query(models.Expense).filter(models.Expense.expense_date >= lo, models.Expense.expense_date < hi).order_by(
            models.Expense.expense_date, models.Expense.id).all():
        d = day(reporting.pkt_date(e.expense_date))
        method = getattr(e.payment_method, "value", e.payment_method)
        d["rows"].append({
            "type": "Expense", "reference": e.category.value.title(),
            "description": e.description or "", "paid_via": (method or "—").title(),
            "details": reporting.describe_payment(e) if method else "—", "amount": e.amount,
            "freight": e.freight_charges or 0.0,
        })
        d["total"] += e.amount
        exp_freight += e.freight_charges or 0.0

    pos = {p.id: p for p in db.query(models.PurchaseOrder).all()}
    vendors = {v.id: v.name for v in db.query(models.Vendor).all()}
    for r in db.query(models.VendorLedgerEntry).filter(
            models.VendorLedgerEntry.ref_type.in_(("PO_PAYMENT", "PO_ADVANCE")),
            models.VendorLedgerEntry.direction == models.LedgerDirection.credit,
            models.VendorLedgerEntry.entry_date >= lo, models.VendorLedgerEntry.entry_date < hi).order_by(
            models.VendorLedgerEntry.entry_date, models.VendorLedgerEntry.id).all():
        po = pos.get(r.ref_id)
        d = day(reporting.pkt_date(r.entry_date))
        method = getattr(r.payment_method, "value", r.payment_method)
        d["rows"].append({
            "type": "PO advance" if r.ref_type == "PO_ADVANCE" else "PO payment",
            "reference": po.po_number if po else f"PO #{r.ref_id} (deleted)",
            "description": vendors.get(r.vendor_id, ""), "paid_via": (method or "—").title(),
            "details": reporting.describe_payment(r, r.vendor_bank_account) if method else "—",
            "amount": r.amount, "freight": 0.0,
        })
        d["total"] += r.amount

    po_freight = sum(g.freight_amount or 0.0 for g in db.query(models.GRN).filter(
        models.GRN.received_date >= lo, models.GRN.received_date < hi).all())

    ordered = [days[k] for k in sorted(days)]
    exp_total = sum(r["amount"] for d in ordered for r in d["rows"] if r["type"] == "Expense")
    po_total = sum(r["amount"] for d in ordered for r in d["rows"] if r["type"] != "Expense")
    return {
        "start_date": start, "end_date": end, "days": ordered,
        "expenses_total": exp_total, "po_payments_total": po_total, "gross_total": exp_total + po_total,
        "freight_purchase_orders": po_freight, "freight_expenses": exp_freight,
    }


@router.get("/expense-report")
def expense_report(start_date: datetime.date, end_date: datetime.date, db: Session = Depends(get_db)):
    return _expense_report_data(db, start_date, end_date)


@router.get("/expense-report/excel")
def expense_report_excel(request: Request, start_date: datetime.date, end_date: datetime.date, db: Session = Depends(get_db)):
    data = _expense_report_data(db, start_date, end_date)
    user = current_user(request)
    wb = openpyxl.Workbook()
    columns = ["Date", "Type", "Reference", "Description / Vendor", "Paid Via", "Payment Details", "Amount (Rs.)"]
    ws, r = reporting.new_sheet(
        wb, "Expense Report", "Riwayat Oils and Fats — Expense Report",
        [f"Period: {reporting.fmt_day(start_date)} to {reporting.fmt_day(end_date)}",
         "Daily expenses together with purchase-order payments made in the period",
         f"Generated {reporting.fmt_day(reporting.pkt_today())} by {user.full_name}"],
        columns, [14, 13, 18, 34, 12, 40, 16])
    n = len(columns)
    if not data["days"]:
        ws.cell(row=r, column=1, value="Nothing was paid out in this period.")
        r += 2
    for d in data["days"]:
        for row in d["rows"]:
            reporting.write_row(ws, r, [d["date"], row["type"], row["reference"], row["description"], row["paid_via"],
                                        row["details"], row["amount"]], money_cols=(7,), wrap_cols=(4, 6))
            ws.cell(row=r, column=1).number_format = "dd mmm yyyy"
            r += 1
        reporting.write_total_row(ws, r, f"Total for {reporting.fmt_day(d['date'])}", 1, {7: d["total"]}, n, reporting.DAY_FILL)
        r += 2
    reporting.write_total_row(ws, r, f"GROSS TOTAL  ({len(data['days'])} day{'s' if len(data['days']) != 1 else ''})", 1,
                              {7: data["gross_total"]}, n, reporting.GROSS_FILL, border=reporting.TOP_DOUBLE)
    r += 1
    reporting.write_row(ws, r, ["", "", "", "of which: expenses", "", "", data["expenses_total"]], money_cols=(7,)); r += 1
    reporting.write_row(ws, r, ["", "", "", "of which: purchase-order payments", "", "", data["po_payments_total"]], money_cols=(7,)); r += 2
    ws.cell(row=r, column=1, value="Freight charges — shown separately; already included in the amounts above").font = reporting.BOLD
    r += 1
    reporting.write_row(ws, r, ["", "", "", "Freight charges — purchase orders (goods received in period)", "", "", data["freight_purchase_orders"]], money_cols=(7,), wrap_cols=(4,)); r += 1
    reporting.write_row(ws, r, ["", "", "", "Freight charges — expenses", "", "", data["freight_expenses"]], money_cols=(7,))
    return reporting.workbook_response(wb, f"expense_report_{start_date}_to_{end_date}.xlsx")
