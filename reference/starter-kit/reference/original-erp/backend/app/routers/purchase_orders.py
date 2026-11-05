import datetime
import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas, reporting
from ..database import get_db
from ..security import current_user, require_action

router = APIRouter(prefix="/purchase-orders", tags=["Purchase Orders"])

PAID_REFS = ("PO_ADVANCE", "PO_PAYMENT")


def _goods_total(po) -> float:
    return sum(l.quantity * l.rate for l in po.lines)


def _gst_amount(po) -> float:
    return _goods_total(po) * (po.gst_rate or 0.0) / 100.0


def _paid_by_po(po_ids, db: Session) -> dict:
    """{po_id: money paid so far (advance + later payments)} from the vendor ledger."""
    if not po_ids:
        return {}
    rows = db.query(models.VendorLedgerEntry).filter(
        models.VendorLedgerEntry.ref_type.in_(PAID_REFS),
        models.VendorLedgerEntry.ref_id.in_(po_ids),
        models.VendorLedgerEntry.direction == models.LedgerDirection.credit,
    ).all()
    out = {}
    for r in rows:
        out[r.ref_id] = out.get(r.ref_id, 0.0) + r.amount
    return out


def _decorate(pos, db: Session):
    """Attach the computed money fields the API returns (goods / freight / total / paid / due)."""
    single = not isinstance(pos, list)
    items = [pos] if single else pos
    paid = _paid_by_po([p.id for p in items], db)
    for p in items:
        goods = _goods_total(p)
        freight = p.freight_charges or 0.0
        p.goods_total = goods
        p.gst_amount = _gst_amount(p)
        p.total_value = goods + p.gst_amount + freight
        p.amount_paid = paid.get(p.id, 0.0)
        p.balance_due = max(p.total_value - p.amount_paid, 0.0)
    return pos


def _clean_gst(rate) -> float:
    rate = float(rate or 0.0)
    if rate < 0 or rate > 100:
        raise HTTPException(status_code=400, detail="GST rate must be between 0 and 100 percent")
    return rate


def _remaining_due(po, db: Session) -> float:
    return max(_goods_total(po) + _gst_amount(po) + (po.freight_charges or 0.0) - _paid_by_po([po.id], db).get(po.id, 0.0), 0.0)


@router.post("/", response_model=schemas.PurchaseOrderOut)
def create_purchase_order(po: schemas.PurchaseOrderCreate, db: Session = Depends(get_db)):
    vendor = db.query(models.Vendor).filter(models.Vendor.id == po.vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    existing = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.po_number == po.po_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="PO number already exists")

    db_po = models.PurchaseOrder(
        po_number=po.po_number,
        vendor_id=po.vendor_id,
        notes=po.notes,
        status=models.POStatus.approved,
        advance_amount=0.0,
        freight_charges=0.0,
        gst_rate=_clean_gst(po.gst_rate),
    )
    db.add(db_po)
    db.flush()  # get db_po.id before commit

    for line in po.lines:
        item = db.query(models.Item).filter(models.Item.id == line.item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {line.item_id} not found")
        db_line = models.PurchaseOrderLine(
            purchase_order_id=db_po.id,
            item_id=line.item_id,
            quantity=line.quantity,
            rate=line.rate,
        )
        db.add(db_line)
    db.flush()
    db.refresh(db_po)

    # Optional advance: posted as credits on the vendor's ledger right away.
    if po.advance_splits:
        goods = _goods_total(db_po) + _gst_amount(db_po)
        advance = 0.0
        for split in po.advance_splits:
            _validate_split(split, po.vendor_id, db)
            advance += split.amount
        if advance > goods + 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"The advance (Rs. {advance:,.2f}) is more than the PO value (Rs. {goods:,.2f})",
            )
        n = len(po.advance_splits)
        for i, split in enumerate(po.advance_splits, start=1):
            note = f"Advance for {db_po.po_number}" + (f" (split {i}/{n})" if n > 1 else "")
            db.add(models.VendorLedgerEntry(
                vendor_id=po.vendor_id,
                direction=models.LedgerDirection.credit,
                amount=split.amount,
                ref_type="PO_ADVANCE",
                ref_id=db_po.id,
                entry_date=datetime.datetime.utcnow(),
                notes=note,
                payment_method=split.payment_method,
                cheque_number=split.cheque_number,
                cheque_bank=split.cheque_bank,
                our_bank=split.our_bank,
                other_party_name=split.other_party_name,
                other_party_bank=split.other_party_bank,
                vendor_bank_account_id=split.vendor_bank_account_id,
            ))
        db_po.advance_amount = advance
        if abs(advance - goods) <= 0.01:
            db_po.payment_status = models.PaymentStatus.paid   # fully paid up-front

    db.commit()
    db.refresh(db_po)
    return _decorate(db_po, db)


@router.get("/", response_model=List[schemas.PurchaseOrderOut])
def list_purchase_orders(db: Session = Depends(get_db)):
    return _decorate(db.query(models.PurchaseOrder).all(), db)


@router.get("/report")
def purchase_order_report(request: Request, start_date: datetime.date = None, end_date: datetime.date = None,
                          db: Session = Depends(get_db)):
    """
    Excel report of purchase orders raised in the date range (inclusive, Pakistan
    time). Three sheets:
      - Purchase Orders: one row per PO (items described, amount, how much was paid
        and how), a total after each day and a gross total.
      - Payments: every payment made against those POs (one row per payment split,
        with method/cheque/bank details), totalled by payment day, plus a gross total.
      - PO Line Items: the numeric item lines (qty, rate, amount) with daily/gross totals.
    Cancelled POs are left out (the count is noted at the bottom of the first sheet).
    """
    lo, hi = reporting.range_bounds(start_date, end_date)
    all_pos = db.query(models.PurchaseOrder).filter(
        models.PurchaseOrder.order_date >= lo, models.PurchaseOrder.order_date < hi,
    ).order_by(models.PurchaseOrder.order_date, models.PurchaseOrder.id).all()
    cancelled = [p for p in all_pos if p.status == models.POStatus.cancelled]
    pos = [p for p in all_pos if p.status != models.POStatus.cancelled]

    po_ids = [p.id for p in pos]
    payments_by_po = {}
    if po_ids:
        for pay in db.query(models.VendorLedgerEntry).filter(
            models.VendorLedgerEntry.ref_type.in_(PAID_REFS), models.VendorLedgerEntry.ref_id.in_(po_ids),
        ).order_by(models.VendorLedgerEntry.entry_date, models.VendorLedgerEntry.id).all():
            payments_by_po.setdefault(pay.ref_id, []).append(pay)

    def po_total(p):
        g = sum(l.quantity * l.rate for l in p.lines)
        return g * (1 + (p.gst_rate or 0.0) / 100.0)

    def pay_desc(pay):
        return reporting.describe_payment(pay, pay.vendor_bank_account)

    user = current_user(request)
    sub = [f"Period: {reporting.fmt_day(start_date)} to {reporting.fmt_day(end_date)}  (by PO date)",
           f"Generated {reporting.fmt_day(reporting.pkt_today())} by {user.full_name}"]
    wb = openpyxl.Workbook()

    # ------------------------------------------------ sheet 1: purchase orders
    cols = ["PO Date", "PO No.", "Vendor", "Status", "Items / Description", "PO Amount (Rs.)", "Freight (Rs.)",
            "Payment Status", "Amount Paid (Rs.)", "Balance Due (Rs.)", "Payment Details", "Notes"]
    ws, r = reporting.new_sheet(wb, "Purchase Orders", "Riwayat Oils and Fats — Purchase Order Report", sub, cols,
                                [13, 20, 24, 16, 46, 17, 14, 13, 17, 17, 52, 28])
    n = len(cols)
    by_day = {}
    for p in pos:
        by_day.setdefault(reporting.pkt_date(p.order_date), []).append(p)
    g_amt = g_fr = g_paid = g_bal = 0.0
    if not pos:
        ws.cell(row=r, column=1, value="No purchase orders were raised in this period.")
        r += 1
    for day in sorted(by_day):
        d_amt = d_fr = d_paid = d_bal = 0.0
        for p in by_day[day]:
            amt = po_total(p)
            fr = p.freight_charges or 0.0     # freight is reported in its own column, never folded into PO Amount
            pays = payments_by_po.get(p.id, [])
            paid = sum(x.amount for x in pays)
            bal = amt + fr - paid
            items_text = "\n".join(
                f"{i}) {l.item.name} — {l.quantity:g} {l.item.uom.symbol} × Rs. {l.rate:,.2f} = Rs. {l.quantity * l.rate:,.2f}"
                for i, l in enumerate(p.lines, start=1))
            pay_text = "\n".join(
                f"{reporting.fmt_day(reporting.pkt_date(x.entry_date))} — Rs. {x.amount:,.2f} — {pay_desc(x)}" for x in pays) or "No payment recorded"
            reporting.write_row(ws, r, [
                day, p.po_number, p.vendor.name, p.status.value.replace("_", " ").title(), items_text, amt, fr,
                p.payment_status.value.title(), paid, bal, pay_text, p.notes or "",
            ], money_cols=(6, 7, 9, 10), wrap_cols=(3, 5, 11, 12))
            ws.cell(row=r, column=1).number_format = "dd mmm yyyy"
            d_amt, d_fr, d_paid, d_bal = d_amt + amt, d_fr + fr, d_paid + paid, d_bal + bal
            r += 1
        cnt = len(by_day[day])
        reporting.write_total_row(ws, r, f"Total for {reporting.fmt_day(day)}  ({cnt} PO{'s' if cnt != 1 else ''})", 1,
                                  {6: d_amt, 7: d_fr, 9: d_paid, 10: d_bal}, n, reporting.DAY_FILL)
        g_amt, g_fr, g_paid, g_bal = g_amt + d_amt, g_fr + d_fr, g_paid + d_paid, g_bal + d_bal
        r += 2
    reporting.write_total_row(ws, r, f"GROSS TOTAL  ({len(pos)} PO{'s' if len(pos) != 1 else ''}, {len(by_day)} day{'s' if len(by_day) != 1 else ''})", 1,
                              {6: g_amt, 7: g_fr, 9: g_paid, 10: g_bal}, n, reporting.GROSS_FILL, border=reporting.TOP_DOUBLE)
    if cancelled:
        ws.cell(row=r + 2, column=1, value=f"Note: {len(cancelled)} cancelled PO(s) in this period are not included: "
                                            + ", ".join(p.po_number for p in cancelled)).font = reporting.Font(italic=True, color="777777")

    # ------------------------------------------------ sheet 2: payments
    cols2 = ["Payment Date", "PO No.", "PO Date", "Vendor", "Payment Method", "Payment Details", "Amount Paid (Rs.)"]
    ws2, r = reporting.new_sheet(wb, "Payments", "Riwayat Oils and Fats — Purchase Order Payments", sub[:1] + [
        "Every payment made against the purchase orders above, grouped by the day the payment was made"] + sub[1:],
        cols2, [14, 20, 13, 24, 16, 60, 18])
    pay_rows = [(x, p) for p in pos for x in payments_by_po.get(p.id, [])]
    pay_rows.sort(key=lambda t: (t[0].entry_date, t[0].id))
    pdays = {}
    for x, p in pay_rows:
        pdays.setdefault(reporting.pkt_date(x.entry_date), []).append((x, p))
    g = 0.0
    if not pay_rows:
        ws2.cell(row=r, column=1, value="No payments recorded against these purchase orders.")
        r += 1
    for day in sorted(pdays):
        d = 0.0
        for x, p in pdays[day]:
            reporting.write_row(ws2, r, [
                day, p.po_number, reporting.pkt_date(p.order_date), p.vendor.name,
                getattr(x.payment_method, "value", "—").title() if x.payment_method else "—", pay_desc(x), x.amount,
            ], money_cols=(7,), wrap_cols=(6,))
            ws2.cell(row=r, column=1).number_format = "dd mmm yyyy"
            ws2.cell(row=r, column=3).number_format = "dd mmm yyyy"
            d += x.amount
            r += 1
        reporting.write_total_row(ws2, r, f"Total paid on {reporting.fmt_day(day)}  ({len(pdays[day])} payment{'s' if len(pdays[day]) != 1 else ''})",
                                  1, {7: d}, len(cols2), reporting.DAY_FILL)
        g += d
        r += 2
    reporting.write_total_row(ws2, r, f"GROSS TOTAL PAID  ({len(pay_rows)} payment{'s' if len(pay_rows) != 1 else ''})", 1,
                              {7: g}, len(cols2), reporting.GROSS_FILL, border=reporting.TOP_DOUBLE)

    # ------------------------------------------------ sheet 3: line items
    cols3 = ["PO Date", "PO No.", "Vendor", "Item Code", "Item", "Quantity", "Unit", "Rate (Rs.)", "Amount (Rs.)", "Received Qty"]
    ws3, r = reporting.new_sheet(wb, "PO Line Items", "Riwayat Oils and Fats — Purchase Order Line Items", sub, cols3,
                                 [13, 20, 24, 12, 30, 12, 8, 14, 17, 13])
    g = 0.0
    for day in sorted(by_day):
        d = 0.0
        for p in by_day[day]:
            for l in p.lines:
                reporting.write_row(ws3, r, [day, p.po_number, p.vendor.name, l.item.code, l.item.name, l.quantity,
                                             l.item.uom.symbol, l.rate, l.quantity * l.rate, l.received_quantity or 0.0],
                                    money_cols=(8, 9), qty_cols=(6, 10))
                ws3.cell(row=r, column=1).number_format = "dd mmm yyyy"
                d += l.quantity * l.rate
                r += 1
        reporting.write_total_row(ws3, r, f"Total for {reporting.fmt_day(day)}", 1, {9: d}, len(cols3), reporting.DAY_FILL)
        g += d
        r += 2
    reporting.write_total_row(ws3, r, "GROSS TOTAL", 1, {9: g}, len(cols3), reporting.GROSS_FILL, border=reporting.TOP_DOUBLE)

    return reporting.workbook_response(wb, f"purchase_orders_{start_date}_to_{end_date}.xlsx")


@router.get("/{po_id}", response_model=schemas.PurchaseOrderOut)
def get_purchase_order(po_id: int, db: Session = Depends(get_db)):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return _decorate(po, db)


@router.put("/{po_id}", response_model=schemas.PurchaseOrderOut,
            dependencies=[Depends(require_action("edit_purchase_orders"))])
def update_purchase_order(po_id: int, update: schemas.PurchaseOrderUpdate, db: Session = Depends(get_db)):
    """
    Edit a PO (administrators only unless a role is given 'Edit purchase orders').

    No goods received yet: anything can change, the lines are simply replaced.
    Goods already received (partly or fully): the vendor can't change, and each received
    line keeps its item and rate — its quantity may only be raised to at least what was
    received. New lines can be added, and lines with nothing received can be changed or removed.
    """
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.status == models.POStatus.cancelled:
        raise HTTPException(status_code=400, detail="A cancelled purchase order can't be edited.")

    has_receipts = any((line.received_quantity or 0) > 0 for line in po.lines)

    data = update.dict(exclude_unset=True)
    data.pop("lines", None)
    if "gst_rate" in data:
        data["gst_rate"] = _clean_gst(data["gst_rate"])
        if has_receipts and abs(data["gst_rate"] - (po.gst_rate or 0.0)) > 1e-9:
            raise HTTPException(status_code=400, detail="Goods are already received on this PO, so its GST setting can't be changed.")
    lines = update.lines if "lines" in update.model_fields_set else None

    if "vendor_id" in data:
        if has_receipts and data["vendor_id"] != po.vendor_id:
            raise HTTPException(status_code=400, detail="Goods are already received on this PO, so its vendor can't be changed.")
        vendor = db.query(models.Vendor).filter(models.Vendor.id == data["vendor_id"]).first()
        if not vendor:
            raise HTTPException(status_code=404, detail="Vendor not found")
    if data.get("po_number") and data["po_number"] != po.po_number:
        if db.query(models.PurchaseOrder).filter(models.PurchaseOrder.po_number == data["po_number"]).first():
            raise HTTPException(status_code=400, detail="PO number already exists")

    for field, value in data.items():
        setattr(po, field, value)

    if lines is not None:
        if not lines:
            raise HTTPException(status_code=400, detail="A purchase order needs at least one line.")
        for line in lines:
            if not db.query(models.Item).filter(models.Item.id == line.item_id).first():
                raise HTTPException(status_code=404, detail=f"Item {line.item_id} not found")
        if not has_receipts:
            db.query(models.PurchaseOrderLine).filter(models.PurchaseOrderLine.purchase_order_id == po.id).delete()
            for line in lines:
                db.add(models.PurchaseOrderLine(
                    purchase_order_id=po.id, item_id=line.item_id, quantity=line.quantity, rate=line.rate,
                ))
        else:
            existing = {l.id: l for l in po.lines}
            kept = set()
            for line in lines:
                cur = existing.get(line.id) if line.id else None
                if line.id and cur is None:
                    raise HTTPException(status_code=400, detail="One of the lines doesn't belong to this PO.")
                if cur is None:
                    db.add(models.PurchaseOrderLine(
                        purchase_order_id=po.id, item_id=line.item_id, quantity=line.quantity, rate=line.rate))
                    continue
                kept.add(cur.id)
                received = cur.received_quantity or 0
                if received > 0:
                    if line.item_id != cur.item_id or abs(line.rate - cur.rate) > 1e-9:
                        raise HTTPException(status_code=400, detail=(
                            f"Goods are already received on '{cur.item.name}', so its item and rate can't be changed."))
                    if line.quantity < received - 1e-6:
                        raise HTTPException(status_code=400, detail=(
                            f"'{cur.item.name}': quantity can't be lower than the {received:g} already received."))
                cur.item_id, cur.quantity, cur.rate = line.item_id, line.quantity, line.rate
            for cur in list(po.lines):
                if cur.id not in kept:
                    if (cur.received_quantity or 0) > 0:
                        raise HTTPException(status_code=400, detail=(
                            f"'{cur.item.name}' already has goods received and can't be removed."))
                    db.delete(cur)

    db.flush()
    db.refresh(po)

    goods = _goods_total(po) + _gst_amount(po)
    if (po.advance_amount or 0) > goods + 0.01:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"The new PO value is less than the advance already paid (Rs. {po.advance_amount:,.2f}). "
                   "Keep the value at or above the advance.",
        )

    # Keep status honest after quantities moved: fully received / partly received.
    if has_receipts:
        all_in = all((l.received_quantity or 0) >= l.quantity - 1e-6 for l in po.lines)
        po.status = models.POStatus.completed if all_in else models.POStatus.partially_received
    # A PO marked paid whose value went up now has a balance again.
    if po.payment_status == models.PaymentStatus.paid and _remaining_due(po, db) > 0.01:
        po.payment_status = models.PaymentStatus.unpaid

    db.commit()
    db.refresh(po)
    return _decorate(po, db)


@router.delete("/{po_id}", dependencies=[Depends(require_action("delete_purchase_orders"))])
def delete_purchase_order(po_id: int, db: Session = Depends(get_db)):
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    if any(line.received_quantity > 0 for line in po.lines):
        raise HTTPException(
            status_code=400,
            detail="This PO already has goods received against it and can't be deleted, since stock and "
                   "vendor ledger entries depend on it. Set its status to cancelled instead if it's no longer needed.",
        )

    # Remove the advance / payment postings too, so no orphan credit is left on the vendor's ledger.
    for entry in db.query(models.VendorLedgerEntry).filter(
        models.VendorLedgerEntry.ref_type.in_(PAID_REFS), models.VendorLedgerEntry.ref_id == po.id,
    ).all():
        db.delete(entry)
    db.delete(po)
    db.commit()
    return {"message": "Purchase order deleted", "po_id": po_id}


@router.patch("/{po_id}/cancel", response_model=schemas.PurchaseOrderOut)
def cancel_purchase_order(po_id: int, db: Session = Depends(get_db)):
    """Use this instead of delete once a PO has receipts against it — keeps history, just marks it closed."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.status == models.POStatus.completed:
        raise HTTPException(status_code=400, detail="All goods are received on this PO, so it can't be cancelled.")
    if po.payment_status == models.PaymentStatus.paid:
        raise HTTPException(status_code=400, detail="This PO is fully paid, so it can't be cancelled.")
    po.status = models.POStatus.cancelled
    db.commit()
    db.refresh(po)
    return _decorate(po, db)


def _validate_split(split: schemas.PaymentSplitLine, vendor_id: int, db: Session):
    if split.amount <= 0:
        raise HTTPException(status_code=400, detail="Each payment split must be greater than zero")
    if split.payment_method == models.PaymentMethod.cheque:
        if not split.cheque_number or not split.cheque_bank:
            raise HTTPException(status_code=400, detail="Cheque payments need a cheque number and bank")
    elif split.payment_method == models.PaymentMethod.online:
        if split.vendor_bank_account_id:
            account = db.query(models.VendorBankAccount).filter(
                models.VendorBankAccount.id == split.vendor_bank_account_id,
                models.VendorBankAccount.vendor_id == vendor_id,
            ).first()
            if not account:
                raise HTTPException(status_code=400, detail="Selected vendor bank account not found")
        elif not split.other_party_name or not split.other_party_bank:
            raise HTTPException(status_code=400, detail="Online transfers need the other party's name and bank, or a saved vendor account")


def _validate_splits_total(update: schemas.PaymentStatusUpdate, total_owed: float, vendor_id: int, db: Session):
    if update.payment_status != models.PaymentStatus.paid:
        return
    if total_owed <= 0.01:
        return   # nothing left to pay (e.g. fully covered by the advance)
    if not update.splits:
        raise HTTPException(status_code=400, detail="At least one payment split is required when marking as paid")
    for split in update.splits:
        _validate_split(split, vendor_id, db)
    splits_total = sum(s.amount for s in update.splits)
    if abs(splits_total - total_owed) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Payment splits add up to Rs. {splits_total:,.2f}, but the amount owed is Rs. {total_owed:,.2f}",
        )


@router.patch("/{po_id}/payment-status", response_model=schemas.PurchaseOrderOut)
def update_po_payment_status(po_id: int, update: schemas.PaymentStatusUpdate, db: Session = Depends(get_db)):
    """
    Marks a PO paid or unpaid. Marking paid posts one credit to the vendor's
    ledger per payment split (cash, a cheque, a specific bank account, etc.) —
    together they must add up to the PO's full value. Marking unpaid again
    reverses every one of those entries, so toggling back and forth never
    leaves stray records behind.
    """
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    existing_payments = db.query(models.VendorLedgerEntry).filter(
        models.VendorLedgerEntry.ref_type == "PO_PAYMENT",
        models.VendorLedgerEntry.ref_id == po.id,
    ).all()

    if update.payment_status == models.PaymentStatus.paid and po.payment_status == models.PaymentStatus.paid:
        raise HTTPException(status_code=400, detail="This PO is already marked paid")

    # What is still owed = goods + freight − advance − anything already paid. The splits
    # must cover exactly that (so a PO with an advance only pays the balance).
    owed_now = _remaining_due(po, db)
    _validate_splits_total(update, owed_now, po.vendor_id, db)

    if update.payment_status == models.PaymentStatus.paid:
        payment_date = update.payment_date or datetime.datetime.utcnow()
        splits = update.splits or [] if owed_now > 0.01 else []
        split_count = len(splits)
        for i, split in enumerate(splits, start=1):
            note = update.notes or f"Payment for {po.po_number}"
            if split_count > 1:
                note += f" (split {i}/{split_count})"
            db.add(models.VendorLedgerEntry(
                vendor_id=po.vendor_id,
                direction=models.LedgerDirection.credit,
                amount=split.amount,
                ref_type="PO_PAYMENT",
                ref_id=po.id,
                entry_date=payment_date,
                notes=note,
                payment_method=split.payment_method,
                cheque_number=split.cheque_number,
                cheque_bank=split.cheque_bank,
                our_bank=split.our_bank,
                other_party_name=split.other_party_name,
                other_party_bank=split.other_party_bank,
                vendor_bank_account_id=split.vendor_bank_account_id,
            ))
        po.payment_status = models.PaymentStatus.paid
    else:
        for entry in existing_payments:
            db.delete(entry)
        po.payment_status = models.PaymentStatus.unpaid

    db.commit()
    db.refresh(po)
    return _decorate(po, db)


@router.get("/{po_id}/payments")
def list_po_payments(po_id: int, db: Session = Depends(get_db)):
    """Every payment made against this PO (advance + part-payments), oldest first."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    rows = db.query(models.VendorLedgerEntry).filter(
        models.VendorLedgerEntry.ref_type.in_(PAID_REFS),
        models.VendorLedgerEntry.ref_id == po.id,
        models.VendorLedgerEntry.direction == models.LedgerDirection.credit,
    ).order_by(models.VendorLedgerEntry.entry_date, models.VendorLedgerEntry.id).all()
    return [{
        "id": r.id, "kind": "advance" if r.ref_type == "PO_ADVANCE" else "payment",
        "amount": r.amount, "entry_date": r.entry_date,
        "payment_method": getattr(r.payment_method, "value", r.payment_method),
        "notes": r.notes,
    } for r in rows]


@router.post("/{po_id}/payments", response_model=schemas.PurchaseOrderOut)
def add_po_payment(po_id: int, body: schemas.POPaymentCreate, db: Session = Depends(get_db)):
    """
    Records a partial (or final) payment — e.g. 300,000 on the 1st, 500,000 on the 10th.
    The total can be anything above zero up to what is still owed; once nothing is
    owed the PO flips to paid by itself.
    """
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po.status == models.POStatus.cancelled:
        raise HTTPException(status_code=400, detail="A cancelled purchase order can't take payments.")
    owed = _remaining_due(po, db)
    if owed <= 0.01:
        raise HTTPException(status_code=400, detail="Nothing is owed on this PO.")
    if not body.splits:
        raise HTTPException(status_code=400, detail="Enter the payment amount.")
    for sp in body.splits:
        if sp.amount <= 0:
            raise HTTPException(status_code=400, detail="Payment amounts must be above zero.")
        _validate_split(sp, po.vendor_id, db)
    total = sum(sp.amount for sp in body.splits)
    if total > owed + 0.01:
        raise HTTPException(status_code=400, detail=f"This payment (Rs. {total:,.2f}) is more than the balance due (Rs. {owed:,.2f}).")
    date = body.payment_date or datetime.datetime.utcnow()
    for i, sp in enumerate(body.splits, start=1):
        note = body.notes or f"Payment for {po.po_number}"
        if len(body.splits) > 1:
            note += f" (split {i}/{len(body.splits)})"
        db.add(models.VendorLedgerEntry(
            vendor_id=po.vendor_id, direction=models.LedgerDirection.credit, amount=sp.amount,
            ref_type="PO_PAYMENT", ref_id=po.id, entry_date=date, notes=note,
            payment_method=sp.payment_method, cheque_number=sp.cheque_number, cheque_bank=sp.cheque_bank,
            our_bank=sp.our_bank, other_party_name=sp.other_party_name, other_party_bank=sp.other_party_bank,
            vendor_bank_account_id=sp.vendor_bank_account_id,
        ))
    db.flush()
    if _remaining_due(po, db) <= 0.01:
        po.payment_status = models.PaymentStatus.paid
    db.commit()
    db.refresh(po)
    return _decorate(po, db)


@router.delete("/{po_id}/payments/{entry_id}", response_model=schemas.PurchaseOrderOut)
def delete_po_payment(po_id: int, entry_id: int, db: Session = Depends(get_db)):
    """Removes one recorded part-payment (e.g. entered by mistake). The advance can't be removed here."""
    po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    entry = db.query(models.VendorLedgerEntry).filter(
        models.VendorLedgerEntry.id == entry_id, models.VendorLedgerEntry.ref_type == "PO_PAYMENT",
        models.VendorLedgerEntry.ref_id == po.id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Payment not found")
    db.delete(entry)
    db.flush()
    if _remaining_due(po, db) > 0.01:
        po.payment_status = models.PaymentStatus.unpaid
    db.commit()
    db.refresh(po)
    return _decorate(po, db)
