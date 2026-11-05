from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List, Optional
import datetime
from .. import models, schemas
from ..database import get_db
from ..security import require_action, current_user

router = APIRouter(prefix="/stock-adjustments", tags=["Stock Adjustments"])


def _get_fifo_ordered_own_batches(db: Session, item_id: int, warehouse_id: int):
    """Own stock only (never toll stock) — oldest batch first. Same FIFO principle
    used everywhere else in the system."""
    rows = db.query(models.StockLedgerEntry).filter(
        models.StockLedgerEntry.item_id == item_id,
        models.StockLedgerEntry.warehouse_id == warehouse_id,
        models.StockLedgerEntry.is_toll_stock == 0,
        models.StockLedgerEntry.batch_no.isnot(None),
    ).all()

    by_batch = {}
    for r in rows:
        b = by_batch.setdefault(r.batch_no, {"balance": 0.0, "in_qty": 0.0, "in_value": 0.0, "received_at": None})
        b["balance"] += r.quantity
        if r.quantity > 0:
            b["in_qty"] += r.quantity
            b["in_value"] += r.quantity * (r.rate or 0)
            if b["received_at"] is None or r.entry_date < b["received_at"]:
                b["received_at"] = r.entry_date

    batches = [
        {
            "batch_no": batch_no, "balance": b["balance"],
            "rate": (b["in_value"] / b["in_qty"]) if b["in_qty"] else 0.0,
            "received_at": b["received_at"],
        }
        for batch_no, b in by_batch.items() if b["balance"] > 1e-6
    ]
    batches.sort(key=lambda b: b["received_at"])
    return batches


def _get_own_batch_balance_and_rate(db: Session, item_id: int, warehouse_id: int, batch_no: str):
    rows = db.query(models.StockLedgerEntry).filter(
        models.StockLedgerEntry.item_id == item_id,
        models.StockLedgerEntry.warehouse_id == warehouse_id,
        models.StockLedgerEntry.batch_no == batch_no,
        models.StockLedgerEntry.is_toll_stock == 0,
    ).all()
    balance = sum(r.quantity for r in rows)
    in_rows = [r for r in rows if r.quantity > 0]
    total_in_qty = sum(r.quantity for r in in_rows)
    weighted_rate = (sum(r.quantity * (r.rate or 0) for r in in_rows) / total_in_qty) if total_in_qty else 0.0
    return balance, weighted_rate


@router.post("/", response_model=schemas.StockAdjustmentOut)
def create_stock_adjustment(adj: schemas.StockAdjustmentCreate, db: Session = Depends(get_db)):
    """
    Corrects OWN stock (never toll stock — that's the customer's material, a
    physical discrepancy there is a conversation with them, not a silent book
    correction) against a physical check. Posts to the stock ledger immediately;
    status starts as "pending" as an audit-review flag only.
    """
    item = db.query(models.Item).filter(models.Item.id == adj.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    warehouse = db.query(models.Warehouse).filter(models.Warehouse.id == adj.warehouse_id).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    existing_number = db.query(models.StockAdjustment).filter(
        models.StockAdjustment.adjustment_number == adj.adjustment_number
    ).first()
    if existing_number:
        raise HTTPException(status_code=400, detail="Adjustment number already exists")
    if not adj.reason_comment or not adj.reason_comment.strip():
        raise HTTPException(status_code=400, detail="A reason comment is required for every stock adjustment")
    if adj.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")

    if adj.direction == models.AdjustmentDirection.increase:
        if not adj.batch_no:
            raise HTTPException(status_code=400, detail="Increasing stock needs a new batch label")
        if adj.rate is None:
            raise HTTPException(status_code=400, detail="Increasing stock needs a value (rate) for the found stock")

        existing = db.query(models.StockLedgerEntry).filter(
            models.StockLedgerEntry.item_id == adj.item_id,
            models.StockLedgerEntry.warehouse_id == adj.warehouse_id,
            models.StockLedgerEntry.batch_no == adj.batch_no,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Batch '{adj.batch_no}' already exists — use a distinct new batch label")

        db_adj = models.StockAdjustment(
            adjustment_number=adj.adjustment_number, item_id=adj.item_id, warehouse_id=adj.warehouse_id,
            direction=adj.direction, quantity=adj.quantity, rate=adj.rate, batch_no=adj.batch_no,
            reason_comment=adj.reason_comment,
        )
        db.add(db_adj)
        db.flush()

        db.add(models.StockLedgerEntry(
            item_id=adj.item_id, warehouse_id=adj.warehouse_id, batch_no=adj.batch_no,
            quantity=adj.quantity, rate=adj.rate, is_toll_stock=0,
            ref_type="STOCK_ADJUSTMENT", ref_id=db_adj.id,
        ))

    else:  # decrease
        if adj.batch_no:
            balance, rate = _get_own_batch_balance_and_rate(db, adj.item_id, adj.warehouse_id, adj.batch_no)
            if adj.quantity > balance + 1e-6:
                raise HTTPException(status_code=400, detail=f"Batch '{adj.batch_no}' only has {balance} available")
            draws = [(adj.batch_no, adj.quantity, rate)]
        else:
            fifo_batches = _get_fifo_ordered_own_batches(db, adj.item_id, adj.warehouse_id)
            available = sum(b["balance"] for b in fifo_batches)
            if adj.quantity > available + 1e-6:
                raise HTTPException(status_code=400, detail=f"Only {available} available in stock for this item/warehouse")
            draws = []
            remaining = adj.quantity
            for b in fifo_batches:
                if remaining <= 1e-9:
                    break
                take = min(b["balance"], remaining)
                draws.append((b["batch_no"], take, b["rate"]))
                remaining -= take

        weighted_rate = sum(qty * rate for _, qty, rate in draws) / adj.quantity if adj.quantity else 0.0

        db_adj = models.StockAdjustment(
            adjustment_number=adj.adjustment_number, item_id=adj.item_id, warehouse_id=adj.warehouse_id,
            direction=adj.direction, quantity=adj.quantity, rate=weighted_rate, batch_no=adj.batch_no,
            reason_comment=adj.reason_comment,
        )
        db.add(db_adj)
        db.flush()

        for batch_no, qty, rate in draws:
            db.add(models.StockLedgerEntry(
                item_id=adj.item_id, warehouse_id=adj.warehouse_id, batch_no=batch_no,
                quantity=-qty, rate=rate, is_toll_stock=0,
                ref_type="STOCK_ADJUSTMENT", ref_id=db_adj.id,
            ))

    db.commit()
    db.refresh(db_adj)
    return db_adj


@router.get("/", response_model=List[schemas.StockAdjustmentOut])
def list_stock_adjustments(
    item_id: Optional[int] = None,
    warehouse_id: Optional[int] = None,
    status: Optional[str] = None,
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.StockAdjustment)
    if item_id:
        query = query.filter(models.StockAdjustment.item_id == item_id)
    if warehouse_id:
        query = query.filter(models.StockAdjustment.warehouse_id == warehouse_id)
    if status:
        query = query.filter(models.StockAdjustment.status == status)
    if start_date:
        query = query.filter(models.StockAdjustment.adjustment_date >= start_date)
    if end_date:
        query = query.filter(models.StockAdjustment.adjustment_date <= end_date)
    return query.order_by(models.StockAdjustment.adjustment_date.desc()).all()


@router.patch("/{adjustment_id}/approve", response_model=schemas.StockAdjustmentOut,
              dependencies=[Depends(require_action("approve_stock_adjustments"))])
def approve_stock_adjustment(adjustment_id: int, request: Request, db: Session = Depends(get_db)):
    """
    Marks an adjustment as reviewed/approved. Only roles with the "Approve stock
    adjustments" permission (or Admin) can do this, and the approver recorded is
    always the signed-in user — it can't be typed in or spoofed.
    """
    user = current_user(request)
    adj = db.query(models.StockAdjustment).filter(models.StockAdjustment.id == adjustment_id).first()
    if not adj:
        raise HTTPException(status_code=404, detail="Stock adjustment not found")
    if adj.status == models.AdjustmentStatus.approved:
        raise HTTPException(status_code=400, detail="This adjustment is already approved")
    adj.status = models.AdjustmentStatus.approved
    adj.approved_at = datetime.datetime.utcnow()
    adj.approved_by = f"{user.full_name} ({user.username})"
    db.commit()
    db.refresh(adj)
    return adj
