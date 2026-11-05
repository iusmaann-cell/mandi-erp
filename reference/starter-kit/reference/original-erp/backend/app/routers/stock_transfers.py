from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from typing import List, Optional
import datetime
from .. import models, schemas
from ..database import get_db
from ..security import current_user
from .production import _get_fifo_ordered_batches

router = APIRouter(prefix="/stock-transfers", tags=["Stock Transfers"])


def _out(db: Session, t: models.StockTransfer) -> schemas.StockTransferOut:
    out_rows = db.query(models.StockLedgerEntry).filter(
        models.StockLedgerEntry.ref_type == "STOCK_TRANSFER_OUT",
        models.StockLedgerEntry.ref_id == t.id,
    ).order_by(models.StockLedgerEntry.id).all()
    return schemas.StockTransferOut(
        id=t.id, transfer_number=t.transfer_number,
        item_id=t.item_id, item_name=t.item.name,
        from_warehouse_id=t.from_warehouse_id, from_warehouse_name=t.from_warehouse.name,
        to_warehouse_id=t.to_warehouse_id, to_warehouse_name=t.to_warehouse.name,
        quantity=t.quantity, is_toll_stock=bool(t.is_toll_stock),
        toll_customer_id=t.toll_customer_id,
        toll_customer_name=t.toll_customer.name if t.toll_customer else None,
        batch_no=t.batch_no, notes=t.notes, created_by=t.created_by, transfer_date=t.transfer_date,
        lines=[schemas.StockTransferLineOut(batch_no=r.batch_no, quantity=-r.quantity, rate=r.rate or 0.0) for r in out_rows],
    )


@router.post("/", response_model=schemas.StockTransferOut)
def create_stock_transfer(body: schemas.StockTransferCreate, request: Request, db: Session = Depends(get_db)):
    """
    Moves stock between two warehouses/tanks. Draws from the source FIFO (oldest
    batch first, splitting across batches as needed) or from one pinned batch, and
    lands the same batches in the destination with their cost rate unchanged —
    so later costing, FIFO order and toll-customer ownership all carry over.
    Own stock and each toll customer's stock are separate pools: pass
    toll_customer_id to move that customer's material, omit it for our own.
    """
    if body.quantity is None or body.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
    if body.from_warehouse_id == body.to_warehouse_id:
        raise HTTPException(status_code=400, detail="Source and destination must be different warehouses/tanks")
    number = (body.transfer_number or "").strip()
    if not number:
        raise HTTPException(status_code=400, detail="A transfer number is required")
    if db.query(models.StockTransfer).filter(models.StockTransfer.transfer_number == number).first():
        raise HTTPException(status_code=400, detail="Transfer number already exists")

    item = db.query(models.Item).filter(models.Item.id == body.item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    src = db.query(models.Warehouse).filter(models.Warehouse.id == body.from_warehouse_id).first()
    dst = db.query(models.Warehouse).filter(models.Warehouse.id == body.to_warehouse_id).first()
    if not src or not dst:
        raise HTTPException(status_code=404, detail="Warehouse/tank not found")
    if not src.is_active or not dst.is_active:
        raise HTTPException(status_code=400, detail="Can't transfer to or from an inactive warehouse/tank")

    customer = None
    if body.toll_customer_id:
        customer = db.query(models.Customer).filter(models.Customer.id == body.toll_customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="Toll customer not found")
    elif dst.warehouse_type == models.WarehouseType.toll_customer_stock:
        raise HTTPException(status_code=400, detail=f"'{dst.name}' is a toll-customer stock area — our own stock can't be moved into it")

    # ---- work out which batches to draw from
    batches = _get_fifo_ordered_batches(db, body.item_id, body.from_warehouse_id, toll_customer_id=body.toll_customer_id)
    pool = "this customer's" if customer else "our own"
    if body.batch_no:
        chosen = next((b for b in batches if b["batch_no"] == body.batch_no), None)
        if not chosen:
            raise HTTPException(status_code=400, detail=f"Batch '{body.batch_no}' has no {pool} stock in {src.name}")
        if body.quantity > chosen["balance"] + 1e-6:
            raise HTTPException(status_code=400, detail=f"Batch '{body.batch_no}' only has {chosen['balance']:g} available in {src.name}")
        draws = [(chosen, body.quantity)]
    else:
        available = sum(b["balance"] for b in batches)
        if body.quantity > available + 1e-6:
            raise HTTPException(status_code=400, detail=f"Only {available:g} of {item.name} ({pool} stock) is available in {src.name}")
        draws, remaining = [], body.quantity
        for b in batches:
            if remaining <= 1e-9:
                break
            take = min(b["balance"], remaining)
            draws.append((b, take))
            remaining -= take

    # ---- destination capacity (if one is set): total on hand across everything stored there
    if dst.capacity:
        on_hand = db.query(func.coalesce(func.sum(models.StockLedgerEntry.quantity), 0.0)).filter(
            models.StockLedgerEntry.warehouse_id == dst.id).scalar() or 0.0
        if on_hand + body.quantity > dst.capacity + 1e-6:
            room = max(dst.capacity - on_hand, 0.0)
            raise HTTPException(
                status_code=400,
                detail=f"'{dst.name}' has room for only {room:g} more (capacity {dst.capacity:g}, currently holds {on_hand:g}). "
                       f"Transfer less, or raise its capacity in Warehouses.",
            )

    user = current_user(request)
    transfer = models.StockTransfer(
        transfer_number=number, item_id=body.item_id, from_warehouse_id=src.id, to_warehouse_id=dst.id,
        quantity=body.quantity, is_toll_stock=1 if customer else 0,
        toll_customer_id=customer.id if customer else None, batch_no=body.batch_no,
        notes=(body.notes or "").strip() or None, created_by=f"{user.full_name} ({user.username})",
        transfer_date=body.transfer_date or datetime.datetime.utcnow(),
    )
    db.add(transfer)
    db.flush()

    common = dict(item_id=body.item_id, is_toll_stock=1 if customer else 0,
                  toll_customer_id=customer.id if customer else None, ref_id=transfer.id)
    for b, qty in draws:
        db.add(models.StockLedgerEntry(
            warehouse_id=src.id, batch_no=b["batch_no"], quantity=-qty, rate=b["rate"],
            ref_type="STOCK_TRANSFER_OUT", entry_date=transfer.transfer_date, **common))
        # The IN entry is dated with the batch's ORIGINAL receipt date, not today, so
        # FIFO age survives the move — oil received in March is still the oldest oil
        # in the new tank. The real transfer date lives on the transfer record itself.
        db.add(models.StockLedgerEntry(
            warehouse_id=dst.id, batch_no=b["batch_no"], quantity=qty, rate=b["rate"],
            ref_type="STOCK_TRANSFER_IN", entry_date=b["received_at"] or transfer.transfer_date, **common))

    db.commit()
    db.refresh(transfer)
    return _out(db, transfer)


@router.get("/", response_model=List[schemas.StockTransferOut])
def list_stock_transfers(
    item_id: Optional[int] = None,
    warehouse_id: Optional[int] = None,   # matches either the source or the destination
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.StockTransfer)
    if item_id:
        q = q.filter(models.StockTransfer.item_id == item_id)
    if warehouse_id:
        q = q.filter(or_(models.StockTransfer.from_warehouse_id == warehouse_id,
                         models.StockTransfer.to_warehouse_id == warehouse_id))
    if start_date:
        q = q.filter(models.StockTransfer.transfer_date >= start_date)
    if end_date:
        q = q.filter(models.StockTransfer.transfer_date <= end_date)
    return [_out(db, t) for t in q.order_by(models.StockTransfer.transfer_date.desc(), models.StockTransfer.id.desc()).all()]
