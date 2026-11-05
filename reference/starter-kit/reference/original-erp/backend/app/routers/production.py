from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(tags=["Production (Phase 2)"])


# ---------------- BOM / Recipe ----------------

@router.post("/boms/", response_model=schemas.BOMOut)
def create_bom(bom: schemas.BOMCreate, db: Session = Depends(get_db)):
    db_bom = models.BOM(
        name=bom.name,
        plant=bom.plant,
        reference_batch_size=bom.reference_batch_size,
        notes=bom.notes,
    )
    db.add(db_bom)
    db.flush()

    for line in bom.input_lines:
        db.add(models.BOMInputLine(bom_id=db_bom.id, item_id=line.item_id, quantity=line.quantity))
    for line in bom.output_lines:
        db.add(models.BOMOutputLine(
            bom_id=db_bom.id, item_id=line.item_id, quantity=line.quantity,
            is_primary=1 if line.is_primary else 0,
        ))

    db.commit()
    db.refresh(db_bom)
    return db_bom


@router.get("/boms/", response_model=List[schemas.BOMOut])
def list_boms(plant: str = None, db: Session = Depends(get_db)):
    query = db.query(models.BOM).filter(models.BOM.is_active == 1)
    if plant:
        query = query.filter(models.BOM.plant == plant)
    return query.all()


@router.get("/boms/{bom_id}", response_model=schemas.BOMOut)
def get_bom(bom_id: int, db: Session = Depends(get_db)):
    bom = db.query(models.BOM).filter(models.BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    return bom


@router.put("/boms/{bom_id}", response_model=schemas.BOMOut)
def update_bom(bom_id: int, update: schemas.BOMUpdate, db: Session = Depends(get_db)):
    bom = db.query(models.BOM).filter(models.BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    data = update.dict(exclude_unset=True)
    # take the lines from the model itself (data holds plain dicts, which have no .item_id)
    input_lines = update.input_lines if "input_lines" in data else None
    output_lines = update.output_lines if "output_lines" in data else None
    data.pop("input_lines", None)
    data.pop("output_lines", None)

    for field, value in data.items():
        setattr(bom, field, value)

    if input_lines is not None:
        db.query(models.BOMInputLine).filter(models.BOMInputLine.bom_id == bom.id).delete()
        for line in input_lines:
            db.add(models.BOMInputLine(bom_id=bom.id, item_id=line.item_id, quantity=line.quantity))

    if output_lines is not None:
        db.query(models.BOMOutputLine).filter(models.BOMOutputLine.bom_id == bom.id).delete()
        for line in output_lines:
            db.add(models.BOMOutputLine(
                bom_id=bom.id, item_id=line.item_id, quantity=line.quantity,
                is_primary=1 if line.is_primary else 0,
            ))

    db.commit()
    db.refresh(bom)
    return bom


@router.delete("/boms/{bom_id}")
def delete_bom(bom_id: int, db: Session = Depends(get_db)):
    """Soft delete — hides the recipe from active lists. Past production orders that referenced
    it keep their record (bom_id is just a reference, not required for their own stored data)."""
    bom = db.query(models.BOM).filter(models.BOM.id == bom_id).first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    bom.is_active = 0
    db.commit()
    return {"message": "Recipe deactivated", "bom_id": bom_id}


# ---------------- Production Orders ----------------

def _get_batch_balance_and_rate(db: Session, item_id: int, warehouse_id: int, batch_no: str, toll_customer_id=None):
    """Current quantity on hand for a batch, and its weighted-average incoming rate.
    toll_customer_id=None means "our own stock"; a customer id means that customer's
    toll stock only — the two are never mixed together."""
    query = db.query(models.StockLedgerEntry).filter(
        models.StockLedgerEntry.item_id == item_id,
        models.StockLedgerEntry.warehouse_id == warehouse_id,
        models.StockLedgerEntry.batch_no == batch_no,
    )
    if toll_customer_id is None:
        query = query.filter(models.StockLedgerEntry.is_toll_stock == 0)
    else:
        query = query.filter(
            models.StockLedgerEntry.is_toll_stock == 1,
            models.StockLedgerEntry.toll_customer_id == toll_customer_id,
        )
    rows = query.all()
    balance = sum(r.quantity for r in rows)
    in_rows = [r for r in rows if r.quantity > 0]
    total_in_qty = sum(r.quantity for r in in_rows)
    weighted_rate = (sum(r.quantity * (r.rate or 0) for r in in_rows) / total_in_qty) if total_in_qty else 0.0
    return balance, weighted_rate


def _get_fifo_ordered_batches(db: Session, item_id: int, warehouse_id: int, toll_customer_id=None):
    """
    All batches of this item in this warehouse that still have stock, oldest-received
    first. 'Oldest' = the earliest stock-in entry for that batch, which is how FIFO is
    conventionally defined (first batch received is first batch consumed).
    Scoped to either our own stock (toll_customer_id=None) or one specific toll
    customer's stock — the two pools are never merged.
    Returns list of dicts: {batch_no, balance, rate, received_at}
    """
    query = db.query(models.StockLedgerEntry).filter(
        models.StockLedgerEntry.item_id == item_id,
        models.StockLedgerEntry.warehouse_id == warehouse_id,
        models.StockLedgerEntry.batch_no.isnot(None),
    )
    if toll_customer_id is None:
        query = query.filter(models.StockLedgerEntry.is_toll_stock == 0)
    else:
        query = query.filter(
            models.StockLedgerEntry.is_toll_stock == 1,
            models.StockLedgerEntry.toll_customer_id == toll_customer_id,
        )
    rows = query.all()

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
            "batch_no": batch_no,
            "balance": b["balance"],
            "rate": (b["in_value"] / b["in_qty"]) if b["in_qty"] else 0.0,
            "received_at": b["received_at"],
        }
        for batch_no, b in by_batch.items()
        if b["balance"] > 1e-6
    ]
    batches.sort(key=lambda b: b["received_at"])
    return batches


@router.post("/production-orders/", response_model=schemas.ProductionOrderOut)
def create_production_order(order: schemas.ProductionOrderCreate, db: Session = Depends(get_db)):
    """
    Consumes real stock batches as input, produces new stock batches as output.

    Two modes:
    - Own production (customer_id not set): costs the batch as before — byproducts
      valued first, remaining cost allocated to the primary output per unit.
    - Toll run (customer_id set): consumes and produces ONLY that customer's toll
      stock, scoped separately from our own stock and from every other customer's
      stock. No cost allocation happens — it's never our material, so it never
      touches our COGS. The commission fee (our actual revenue) is invoiced
      separately via Commission Invoices, not computed here.
    """
    existing = db.query(models.ProductionOrder).filter(models.ProductionOrder.order_number == order.order_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Production order number already exists")

    if not order.input_lines:
        raise HTTPException(status_code=400, detail="At least one input line is required")
    if not order.output_lines:
        raise HTTPException(status_code=400, detail="At least one output line is required")

    is_toll = order.customer_id is not None
    if is_toll:
        customer = db.query(models.Customer).filter(models.Customer.id == order.customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

    primary_lines = [l for l in order.output_lines if l.is_primary]
    byproduct_lines = [l for l in order.output_lines if not l.is_primary and not l.is_loss]
    loss_lines = [l for l in order.output_lines if not l.is_primary and l.is_loss]
    if not primary_lines:
        raise HTTPException(status_code=400, detail="At least one primary output line is required")
    if not is_toll:
        for l in byproduct_lines:
            if l.rate is None:
                raise HTTPException(status_code=400, detail=f"Byproduct output for item {l.item_id} needs a rate (recovery value)")

    # Cost is allocated as ONE uniform per-unit rate across every primary output line —
    # correct when they're the same item split across batches/warehouses, but silently
    # wrong if they're different SKUs (e.g. tins vs. pouches from the same batch, where
    # each unit represents a very different amount of bulk product). Block that case
    # rather than produce a misleading cost; two SKUs need two orders.
    distinct_primary_items = {l.item_id for l in primary_lines}
    if len(distinct_primary_items) > 1:
        raise HTTPException(
            status_code=400,
            detail="Primary output lines must all be the same item. Packing the same batch into "
                   "different SKUs (e.g. tins and pouches) needs a separate production order for "
                   "each SKU, since each uses a different amount of bulk product per unit and "
                   "averaging them into one cost would be misleading.",
        )

    db_order = models.ProductionOrder(
        order_number=order.order_number,
        plant=order.plant,
        bom_id=order.bom_id,
        customer_id=order.customer_id,
        notes=order.notes,
        status=models.ProductionOrderStatus.completed,
    )
    db.add(db_order)
    db.flush()

    # ---- 1. Validate & consume inputs (FIFO by default, or a specific batch if given) ----
    total_input_cost = 0.0
    total_input_quantity = 0.0

    for line in order.input_lines:
        # This line's effective ownership: toll orders default to the order's customer,
        # but use_own_stock=True pulls this specific line from OUR OWN stock instead —
        # e.g. packaging materials when packing a customer's oil into your own bottles.
        line_toll_customer_id = None if (not is_toll or line.use_own_stock) else order.customer_id
        line_is_toll = line_toll_customer_id is not None

        if line.batch_no:
            balance, rate = _get_batch_balance_and_rate(
                db, line.item_id, line.warehouse_id, line.batch_no, toll_customer_id=line_toll_customer_id
            )
            if line.quantity > balance + 1e-6:
                owner = f"{customer.name}'s" if line_is_toll else "our own"
                raise HTTPException(
                    status_code=400,
                    detail=f"Batch '{line.batch_no}' in {owner} stock only has {balance} available, requested {line.quantity}",
                )
            draws = [(line.batch_no, line.quantity, rate)]
        else:
            fifo_batches = _get_fifo_ordered_batches(db, line.item_id, line.warehouse_id, toll_customer_id=line_toll_customer_id)
            available = sum(b["balance"] for b in fifo_batches)
            if line.quantity > available + 1e-6:
                owner = f"{customer.name}'s" if line_is_toll else "our own"
                raise HTTPException(
                    status_code=400,
                    detail=f"Only {available} available in {owner} stock for this item/warehouse, "
                           f"requested {line.quantity}",
                )
            draws = []
            remaining = line.quantity
            for b in fifo_batches:
                if remaining <= 1e-9:
                    break
                take = min(b["balance"], remaining)
                draws.append((b["batch_no"], take, b["rate"]))
                remaining -= take

        for batch_no, qty, rate in draws:
            db.add(models.ProductionOrderInputLine(
                production_order_id=db_order.id,
                item_id=line.item_id,
                warehouse_id=line.warehouse_id,
                batch_no=batch_no,
                quantity=qty,
                rate=0.0 if line_is_toll else rate,
                is_toll_stock=1 if line_is_toll else 0,
                toll_customer_id=line_toll_customer_id,
            ))
            db.add(models.StockLedgerEntry(
                item_id=line.item_id,
                warehouse_id=line.warehouse_id,
                batch_no=batch_no,
                quantity=-qty,   # stock OUT
                rate=0.0 if line_is_toll else rate,
                is_toll_stock=1 if line_is_toll else 0,
                toll_customer_id=line_toll_customer_id,
                ref_type="PRODUCTION_ISSUE",
                ref_id=db_order.id,
            ))
            if not line_is_toll:
                # our own material — this is real cost to us, whether it's the whole
                # order (own production) or just this line (e.g. packaging materials
                # inside an otherwise-toll order)
                total_input_cost += qty * rate
            total_input_quantity += qty

    total_primary_output_quantity = sum(l.quantity for l in primary_lines)
    if total_primary_output_quantity <= 0:
        raise HTTPException(status_code=400, detail="Primary output quantity must be greater than zero")

    if is_toll:
        # no cost allocation — it's the customer's material, not ours
        primary_unit_rate = 0.0
    else:
        # ---- 2. Value byproducts first, allocate remaining cost to primary output ----
        total_byproduct_value = sum(l.quantity * l.rate for l in byproduct_lines)
        remaining_cost = total_input_cost - total_byproduct_value
        if remaining_cost < 0:
            raise HTTPException(
                status_code=400,
                detail="Byproduct value exceeds total input cost — check byproduct rates entered",
            )
        primary_unit_rate = remaining_cost / total_primary_output_quantity

    # ---- 3. Post outputs ----
    for line in order.output_lines:
        if is_toll or line.is_loss:
            # toll output isn't ours to cost; loss has no recovery value at all
            computed_rate = 0.0
        else:
            computed_rate = primary_unit_rate if line.is_primary else line.rate

        db.add(models.ProductionOrderOutputLine(
            production_order_id=db_order.id,
            item_id=line.item_id,
            warehouse_id=line.warehouse_id,
            batch_no=line.batch_no,
            quantity=line.quantity,
            is_primary=1 if line.is_primary else 0,
            is_loss=1 if line.is_loss else 0,
            rate=computed_rate,
        ))

        if line.is_loss:
            # no StockLedgerEntry — there's no physical batch to store, this line
            # exists purely so the loss is visible in records instead of being an
            # invisible gap only inferable from input-minus-output math
            continue

        db.add(models.StockLedgerEntry(
            item_id=line.item_id,
            warehouse_id=line.warehouse_id,
            batch_no=line.batch_no,
            quantity=line.quantity,   # stock IN
            rate=computed_rate,
            is_toll_stock=1 if is_toll else 0,
            toll_customer_id=order.customer_id,
            ref_type="PRODUCTION_RECEIPT",
            ref_id=db_order.id,
        ))

    # ---- 4. Summary fields ----
    db_order.total_input_cost = total_input_cost   # 0.0 for pure toll runs, real cost if we
    # contributed any of our own material (packaging, etc.) alongside the customer's
    db_order.total_input_quantity = total_input_quantity
    db_order.total_primary_output_quantity = total_primary_output_quantity
    db_order.yield_percent = (total_primary_output_quantity / total_input_quantity * 100) if total_input_quantity else None

    db.commit()
    db.refresh(db_order)
    return db_order


@router.get("/production-orders/", response_model=List[schemas.ProductionOrderOut])
def list_production_orders(plant: str = None, customer_id: int = None, db: Session = Depends(get_db)):
    query = db.query(models.ProductionOrder)
    if plant:
        query = query.filter(models.ProductionOrder.plant == plant)
    if customer_id:
        query = query.filter(models.ProductionOrder.customer_id == customer_id)
    return query.order_by(models.ProductionOrder.id.desc()).all()


@router.get("/production-orders/{order_id}", response_model=schemas.ProductionOrderOut)
def get_production_order(order_id: int, db: Session = Depends(get_db)):
    o = db.query(models.ProductionOrder).filter(models.ProductionOrder.id == order_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Production order not found")
    return o
