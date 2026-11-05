import openpyxl
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_
from typing import List, Optional
from .. import models, schemas, reporting
from ..security import current_user
from ..database import get_db

router = APIRouter(prefix="/stock", tags=["Inventory / Stock"])


def _row_to_balance_out(db: Session, row) -> Optional[schemas.StockBalanceOut]:
    if abs(row.quantity) < 1e-6:
        return None
    item = db.query(models.Item).filter(models.Item.id == row.item_id).first()
    wh = db.query(models.Warehouse).filter(models.Warehouse.id == row.warehouse_id).first()
    customer = None
    if row.toll_customer_id:
        customer = db.query(models.Customer).filter(models.Customer.id == row.toll_customer_id).first()
    return schemas.StockBalanceOut(
        item_id=row.item_id,
        item_name=item.name if item else "Unknown",
        warehouse_id=row.warehouse_id,
        warehouse_name=wh.name if wh else "Unknown",
        batch_no=row.batch_no,
        quantity=row.quantity,
        is_toll_stock=bool(row.is_toll_stock),
        toll_customer_id=row.toll_customer_id,
        toll_customer_name=customer.name if customer else None,
    )


@router.get("/balance", response_model=List[schemas.StockBalanceOut])
def get_stock_balance(
    warehouse_id: Optional[int] = None,
    item_id: Optional[int] = None,
    toll_customer_id: Optional[int] = None,
    include_toll_stock: bool = True,
    db: Session = Depends(get_db),
):
    """
    Current stock = sum of all stock ledger entries, grouped by item + warehouse + batch
    + toll_customer_id. Toll customer stock is flagged AND attributed to a specific
    customer, so it never mixes into owned inventory valuation, and different
    customers' material in the same warehouse is never summed together.
    """
    query = db.query(
        models.StockLedgerEntry.item_id,
        models.StockLedgerEntry.warehouse_id,
        models.StockLedgerEntry.batch_no,
        models.StockLedgerEntry.is_toll_stock,
        models.StockLedgerEntry.toll_customer_id,
        func.sum(models.StockLedgerEntry.quantity).label("quantity"),
    ).group_by(
        models.StockLedgerEntry.item_id,
        models.StockLedgerEntry.warehouse_id,
        models.StockLedgerEntry.batch_no,
        models.StockLedgerEntry.is_toll_stock,
        models.StockLedgerEntry.toll_customer_id,
    )

    if warehouse_id:
        query = query.filter(models.StockLedgerEntry.warehouse_id == warehouse_id)
    if item_id:
        query = query.filter(models.StockLedgerEntry.item_id == item_id)
    if toll_customer_id:
        query = query.filter(models.StockLedgerEntry.toll_customer_id == toll_customer_id)
    if not include_toll_stock:
        query = query.filter(models.StockLedgerEntry.is_toll_stock == 0)

    output = [_row_to_balance_out(db, row) for row in query.all()]
    return [o for o in output if o is not None]


@router.get("/warehouse-summary")
def get_warehouse_summary(db: Session = Depends(get_db)):
    """One row per warehouse — item count, batch count, and owned stock value — for
    a landing view before drilling into any one warehouse's full stock list."""
    warehouses = db.query(models.Warehouse).filter(models.Warehouse.is_active == 1).all()
    output = []
    for wh in warehouses:
        rows = db.query(
            models.StockLedgerEntry.item_id,
            models.StockLedgerEntry.batch_no,
            models.StockLedgerEntry.is_toll_stock,
            func.sum(models.StockLedgerEntry.quantity).label("quantity"),
            func.sum(models.StockLedgerEntry.quantity * models.StockLedgerEntry.rate).label("value"),
        ).filter(models.StockLedgerEntry.warehouse_id == wh.id).group_by(
            models.StockLedgerEntry.item_id, models.StockLedgerEntry.batch_no, models.StockLedgerEntry.is_toll_stock,
        ).all()

        active_rows = [r for r in rows if abs(r.quantity) > 1e-6]
        distinct_items = {r.item_id for r in active_rows}
        owned_value = sum(r.value or 0 for r in active_rows if not r.is_toll_stock)
        has_toll_stock = any(r.is_toll_stock for r in active_rows)

        output.append({
            "warehouse_id": wh.id,
            "warehouse_name": wh.name,
            "warehouse_type": wh.warehouse_type.value,
            "distinct_item_count": len(distinct_items),
            "batch_count": len(active_rows),
            "owned_stock_value": owned_value,
            "has_toll_stock": has_toll_stock,
        })
    return output


@router.get("/search", response_model=List[schemas.StockBalanceOut])
def search_stock(q: str, db: Session = Depends(get_db)):
    """
    Find stock batches by GRN number, toll intake number, toll customer name, or
    batch number directly — for when you know a reference number but not which
    warehouse or item it ended up in.
    """
    q_like = f"%{q}%"

    grn_ids = [g.id for g in db.query(models.GRN).filter(models.GRN.grn_number.ilike(q_like)).all()]
    toll_intake_ids = [t.id for t in db.query(models.TollIntake).filter(models.TollIntake.intake_number.ilike(q_like)).all()]
    customer_ids = [c.id for c in db.query(models.Customer).filter(models.Customer.name.ilike(q_like)).all()]

    conditions = [models.StockLedgerEntry.batch_no.ilike(q_like)]
    if grn_ids:
        conditions.append(and_(models.StockLedgerEntry.ref_type == "GRN", models.StockLedgerEntry.ref_id.in_(grn_ids)))
    if toll_intake_ids:
        conditions.append(and_(models.StockLedgerEntry.ref_type == "TOLL_INTAKE", models.StockLedgerEntry.ref_id.in_(toll_intake_ids)))
    if customer_ids:
        conditions.append(models.StockLedgerEntry.toll_customer_id.in_(customer_ids))

    matching_rows = db.query(models.StockLedgerEntry).filter(or_(*conditions)).all()
    keys = {(r.item_id, r.warehouse_id, r.batch_no, r.is_toll_stock, r.toll_customer_id) for r in matching_rows}
    if not keys:
        return []

    # recompute the FULL balance for each matched batch (not just the subset of
    # entries that happened to match the search — a batch found via its GRN number
    # still needs its complete in/out history summed for an accurate quantity)
    output = []
    for item_id, warehouse_id, batch_no, is_toll, toll_customer_id in keys:
        bal_query = db.query(func.sum(models.StockLedgerEntry.quantity).label("quantity")).filter(
            models.StockLedgerEntry.item_id == item_id,
            models.StockLedgerEntry.warehouse_id == warehouse_id,
            models.StockLedgerEntry.batch_no == batch_no,
            models.StockLedgerEntry.is_toll_stock == is_toll,
        )
        if toll_customer_id:
            bal_query = bal_query.filter(models.StockLedgerEntry.toll_customer_id == toll_customer_id)
        qty = bal_query.scalar() or 0.0

        class _Row:
            pass
        row = _Row()
        row.item_id, row.warehouse_id, row.batch_no = item_id, warehouse_id, batch_no
        row.is_toll_stock, row.toll_customer_id, row.quantity = is_toll, toll_customer_id, qty

        result = _row_to_balance_out(db, row)
        if result:
            output.append(result)
    return output


def _stock_report_data(db: Session):
    """Every warehouse / tank with everything in it, batch by batch, plus per-item totals.
    Owned stock carries a value (quantity x the rate it came in at); toll customers' material
    is listed but never valued."""
    items = {i.id: i for i in db.query(models.Item).all()}
    custs = {c.id: c.name for c in db.query(models.Customer).all()}
    grouped = db.query(
        models.StockLedgerEntry.warehouse_id, models.StockLedgerEntry.item_id, models.StockLedgerEntry.batch_no,
        models.StockLedgerEntry.is_toll_stock, models.StockLedgerEntry.toll_customer_id,
        func.sum(models.StockLedgerEntry.quantity).label("q"),
        func.sum(models.StockLedgerEntry.quantity * models.StockLedgerEntry.rate).label("v"),
    ).group_by(
        models.StockLedgerEntry.warehouse_id, models.StockLedgerEntry.item_id, models.StockLedgerEntry.batch_no,
        models.StockLedgerEntry.is_toll_stock, models.StockLedgerEntry.toll_customer_id).all()

    by_wh = {}
    totals = {}
    for g in grouped:
        if abs(g.q or 0) < 1e-6:
            continue
        it = items.get(g.item_id)
        unit = it.uom.symbol if it and it.uom else ""
        toll = bool(g.is_toll_stock)
        value = 0.0 if toll else (g.v or 0.0)
        by_wh.setdefault(g.warehouse_id, []).append({
            "item_id": g.item_id, "item_name": it.name if it else "Unknown", "item_code": it.code if it else "",
            "unit": unit, "batch_no": g.batch_no or "", "quantity": round(g.q, 3),
            "ownership": "Toll" if toll else "Owned", "toll_customer": custs.get(g.toll_customer_id, "") if toll else "",
            "value": value,
        })
        t = totals.setdefault(g.item_id, {"item_name": it.name if it else "Unknown", "item_code": it.code if it else "",
                                          "unit": unit, "owned_qty": 0.0, "toll_qty": 0.0, "owned_value": 0.0})
        if toll:
            t["toll_qty"] += g.q
        else:
            t["owned_qty"] += g.q
            t["owned_value"] += value

    warehouses = []
    for wh in db.query(models.Warehouse).filter(models.Warehouse.is_active == 1).order_by(models.Warehouse.name).all():
        rows = sorted(by_wh.get(wh.id, []), key=lambda r: (r["item_name"], r["batch_no"]))
        warehouses.append({
            "warehouse_id": wh.id, "name": wh.name, "type": wh.warehouse_type.value, "capacity": wh.capacity,
            "rows": rows, "owned_value": sum(r["value"] for r in rows),
        })
    item_totals = sorted(({**t, "owned_qty": round(t["owned_qty"], 3), "toll_qty": round(t["toll_qty"], 3)} for t in totals.values()),
                         key=lambda t: t["item_name"])
    return {
        "generated_on": reporting.pkt_today().isoformat(), "warehouses": warehouses, "item_totals": item_totals,
        "total_owned_value": sum(w["owned_value"] for w in warehouses),
    }


@router.get("/report")
def stock_report(db: Session = Depends(get_db)):
    return _stock_report_data(db)


@router.get("/report/excel")
def stock_report_excel(request: Request, db: Session = Depends(get_db)):
    data = _stock_report_data(db)
    user = current_user(request)
    wb = openpyxl.Workbook()
    n_rows = sum(len(w["rows"]) for w in data["warehouses"])
    columns = ["Warehouse / Tank", "Item", "Code", "Batch", "Quantity", "Unit", "Ownership", "Value (Rs.)"]
    ws, r = reporting.new_sheet(
        wb, "By Warehouse", "Riwayat Oils and Fats — Full Stock Report",
        [f"As of {reporting.fmt_day(reporting.pkt_today())}  ·  {len(data['warehouses'])} warehouses / tanks, {n_rows} batches",
         "Owned stock is valued at the rate it was received at; toll customers' material is listed but not valued.",
         f"Generated by {user.full_name}"],
        columns, [24, 32, 13, 22, 14, 8, 22, 16])
    for w in data["warehouses"]:
        cap = f"  (capacity {w['capacity']:g})" if w["capacity"] else ""
        label = f"{w['name']} — {w['type'].replace('_', ' ').title()}{cap}"
        reporting.write_total_row(ws, r, label, 1, {}, len(columns), reporting.DAY_FILL)
        r += 1
        if not w["rows"]:
            ws.cell(row=r, column=2, value="Empty")
            r += 1
        for row in w["rows"]:
            owner = row["ownership"] + (f" — {row['toll_customer']}" if row["toll_customer"] else "")
            reporting.write_row(ws, r, [w["name"], row["item_name"], row["item_code"], row["batch_no"], row["quantity"],
                                        row["unit"], owner, row["value"] if row["ownership"] == "Owned" else None],
                                money_cols=(8,), qty_cols=(5,))
            r += 1
        reporting.write_total_row(ws, r, f"Value of owned stock in {w['name']}", 1, {8: w["owned_value"]}, len(columns), reporting.DAY_FILL)
        r += 2
    reporting.write_total_row(ws, r, "TOTAL VALUE OF OWNED STOCK", 1, {8: data["total_owned_value"]}, len(columns),
                              reporting.GROSS_FILL, border=reporting.TOP_DOUBLE)

    ws2, r2 = reporting.new_sheet(
        wb, "Item Totals", "Stock totals by item (all warehouses)", [f"As of {reporting.fmt_day(reporting.pkt_today())}"],
        ["Item", "Code", "Unit", "Owned quantity", "Toll quantity", "Owned value (Rs.)"], [34, 13, 8, 16, 16, 18])
    for t in data["item_totals"]:
        reporting.write_row(ws2, r2, [t["item_name"], t["item_code"], t["unit"], t["owned_qty"], t["toll_qty"], t["owned_value"]],
                            money_cols=(6,), qty_cols=(4, 5))
        r2 += 1
    return reporting.workbook_response(wb, f"stock_report_{reporting.pkt_today()}.xlsx")
