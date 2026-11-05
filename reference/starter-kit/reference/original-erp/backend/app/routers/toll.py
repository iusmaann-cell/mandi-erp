import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(tags=["Toll / Job-Work Processing"])


# ---------------- Toll Intake ----------------

@router.post("/toll-intakes/", response_model=schemas.TollIntakeOut)
def create_toll_intake(intake: schemas.TollIntakeCreate, db: Session = Depends(get_db)):
    """
    Customer material arriving at the mill. Posts straight to the stock ledger as
    toll stock tagged to this specific customer — no cost, no vendor ledger impact,
    since we never own this material.
    """
    customer = db.query(models.Customer).filter(models.Customer.id == intake.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    existing = db.query(models.TollIntake).filter(models.TollIntake.intake_number == intake.intake_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Intake number already exists")

    db_intake = models.TollIntake(
        intake_number=intake.intake_number,
        customer_id=intake.customer_id,
        vehicle_no=intake.vehicle_no,
        notes=intake.notes,
    )
    db.add(db_intake)
    db.flush()

    for line in intake.lines:
        item = db.query(models.Item).filter(models.Item.id == line.item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {line.item_id} not found")

        db.add(models.TollIntakeLine(
            intake_id=db_intake.id,
            item_id=line.item_id,
            warehouse_id=line.warehouse_id,
            batch_no=line.batch_no,
            quantity=line.quantity,
            declared_value=line.declared_value,
        ))

        db.add(models.StockLedgerEntry(
            item_id=line.item_id,
            warehouse_id=line.warehouse_id,
            batch_no=line.batch_no,
            quantity=line.quantity,   # stock IN
            rate=0.0,   # not our material — no cost basis in our own books
            is_toll_stock=1,
            toll_customer_id=intake.customer_id,
            ref_type="TOLL_INTAKE",
            ref_id=db_intake.id,
        ))

    db.commit()
    db.refresh(db_intake)
    return db_intake


@router.get("/toll-intakes/", response_model=List[schemas.TollIntakeOut])
def list_toll_intakes(customer_id: int = None, db: Session = Depends(get_db)):
    query = db.query(models.TollIntake)
    if customer_id:
        query = query.filter(models.TollIntake.customer_id == customer_id)
    return query.order_by(models.TollIntake.id.desc()).all()


@router.get("/toll-intakes/{intake_id}", response_model=schemas.TollIntakeOut)
def get_toll_intake(intake_id: int, db: Session = Depends(get_db)):
    intake = db.query(models.TollIntake).filter(models.TollIntake.id == intake_id).first()
    if not intake:
        raise HTTPException(status_code=404, detail="Toll intake not found")
    return intake


# ---------------- Toll Delivery ----------------

def _get_fifo_ordered_toll_batches(db: Session, item_id: int, warehouse_id: int, customer_id: int):
    """Same FIFO principle as production consumption, but scoped to ONE customer's toll
    stock only — never draws from our own stock or another customer's batches."""
    rows = db.query(models.StockLedgerEntry).filter(
        models.StockLedgerEntry.item_id == item_id,
        models.StockLedgerEntry.warehouse_id == warehouse_id,
        models.StockLedgerEntry.is_toll_stock == 1,
        models.StockLedgerEntry.toll_customer_id == customer_id,
        models.StockLedgerEntry.batch_no.isnot(None),
    ).all()

    by_batch = {}
    for r in rows:
        b = by_batch.setdefault(r.batch_no, {"balance": 0.0, "received_at": None})
        b["balance"] += r.quantity
        if r.quantity > 0 and (b["received_at"] is None or r.entry_date < b["received_at"]):
            b["received_at"] = r.entry_date

    batches = [
        {"batch_no": batch_no, "balance": b["balance"], "received_at": b["received_at"]}
        for batch_no, b in by_batch.items() if b["balance"] > 1e-6
    ]
    batches.sort(key=lambda b: b["received_at"])
    return batches


@router.post("/toll-deliveries/", response_model=schemas.TollDeliveryOut)
def create_toll_delivery(delivery: schemas.TollDeliveryCreate, db: Session = Depends(get_db)):
    """Dispatch processed goods back to the customer — reduces their toll stock. FIFO
    by default, same principle as production consumption."""
    customer = db.query(models.Customer).filter(models.Customer.id == delivery.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    existing = db.query(models.TollDelivery).filter(models.TollDelivery.delivery_number == delivery.delivery_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Delivery number already exists")

    db_delivery = models.TollDelivery(
        delivery_number=delivery.delivery_number,
        customer_id=delivery.customer_id,
        vehicle_no=delivery.vehicle_no,
        notes=delivery.notes,
    )
    db.add(db_delivery)
    db.flush()

    for line in delivery.lines:
        if line.batch_no:
            draws = [(line.batch_no, line.quantity)]
        else:
            fifo_batches = _get_fifo_ordered_toll_batches(db, line.item_id, line.warehouse_id, delivery.customer_id)
            available = sum(b["balance"] for b in fifo_batches)
            if line.quantity > available + 1e-6:
                raise HTTPException(
                    status_code=400,
                    detail=f"Only {available} available in {customer.name}'s stock for this item/warehouse, "
                           f"requested {line.quantity}",
                )
            draws = []
            remaining = line.quantity
            for b in fifo_batches:
                if remaining <= 1e-9:
                    break
                take = min(b["balance"], remaining)
                draws.append((b["batch_no"], take))
                remaining -= take

        for batch_no, qty in draws:
            db.add(models.TollDeliveryLine(
                delivery_id=db_delivery.id,
                item_id=line.item_id,
                warehouse_id=line.warehouse_id,
                batch_no=batch_no,
                quantity=qty,
            ))
            db.add(models.StockLedgerEntry(
                item_id=line.item_id,
                warehouse_id=line.warehouse_id,
                batch_no=batch_no,
                quantity=-qty,   # stock OUT
                rate=0.0,
                is_toll_stock=1,
                toll_customer_id=delivery.customer_id,
                ref_type="TOLL_DELIVERY",
                ref_id=db_delivery.id,
            ))

    db.commit()
    db.refresh(db_delivery)
    return db_delivery


@router.get("/toll-deliveries/", response_model=List[schemas.TollDeliveryOut])
def list_toll_deliveries(customer_id: int = None, db: Session = Depends(get_db)):
    query = db.query(models.TollDelivery)
    if customer_id:
        query = query.filter(models.TollDelivery.customer_id == customer_id)
    return query.order_by(models.TollDelivery.id.desc()).all()


# ---------------- Commission Invoices ----------------

@router.post("/commission-invoices/", response_model=schemas.CommissionInvoiceOut)
def create_commission_invoice(invoice: schemas.CommissionInvoiceCreate, db: Session = Depends(get_db)):
    """The actual revenue event of the toll business. Posts a debit to the customer
    ledger — this is what they owe you for the processing service."""
    customer = db.query(models.Customer).filter(models.Customer.id == invoice.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    existing = db.query(models.CommissionInvoice).filter(
        models.CommissionInvoice.invoice_number == invoice.invoice_number
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Invoice number already exists")

    amount = invoice.amount
    if amount is None:
        if invoice.quantity_processed is None or invoice.rate_per_unit is None:
            raise HTTPException(
                status_code=400,
                detail="Provide either a flat amount, or both quantity_processed and rate_per_unit",
            )
        amount = invoice.quantity_processed * invoice.rate_per_unit

    db_invoice = models.CommissionInvoice(
        invoice_number=invoice.invoice_number,
        customer_id=invoice.customer_id,
        production_order_id=invoice.production_order_id,
        quantity_processed=invoice.quantity_processed,
        rate_per_unit=invoice.rate_per_unit,
        amount=amount,
        notes=invoice.notes,
    )
    db.add(db_invoice)
    db.flush()

    db.add(models.CustomerLedgerEntry(
        customer_id=invoice.customer_id,
        direction=models.LedgerDirection.debit,
        amount=amount,
        ref_type="COMMISSION_INVOICE",
        ref_id=db_invoice.id,
        notes=f"Commission invoice {invoice.invoice_number}",
    ))

    db.commit()
    db.refresh(db_invoice)
    return db_invoice


@router.get("/commission-invoices/", response_model=List[schemas.CommissionInvoiceOut])
def list_commission_invoices(customer_id: int = None, db: Session = Depends(get_db)):
    query = db.query(models.CommissionInvoice)
    if customer_id:
        query = query.filter(models.CommissionInvoice.customer_id == customer_id)
    return query.order_by(models.CommissionInvoice.id.desc()).all()


def _validate_incoming_split(split: schemas.PaymentSplitLine):
    if split.amount <= 0:
        raise HTTPException(status_code=400, detail="Each payment split must be greater than zero")
    if split.payment_method == models.PaymentMethod.cheque:
        if not split.cheque_number or not split.cheque_bank:
            raise HTTPException(status_code=400, detail="Cheque payments need a cheque number and bank")
    elif split.payment_method == models.PaymentMethod.online:
        if not split.other_party_name or not split.other_party_bank:
            raise HTTPException(status_code=400, detail="Online transfers need the other party's name and bank")


def _validate_splits_total(update: schemas.PaymentStatusUpdate, total_owed: float):
    if update.payment_status != models.PaymentStatus.paid:
        return
    if not update.splits:
        raise HTTPException(status_code=400, detail="At least one payment split is required when marking as paid")
    for split in update.splits:
        _validate_incoming_split(split)
    splits_total = sum(s.amount for s in update.splits)
    if abs(splits_total - total_owed) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Payment splits add up to Rs. {splits_total:,.2f}, but the amount owed is Rs. {total_owed:,.2f}",
        )


@router.patch("/commission-invoices/{invoice_id}/payment-status", response_model=schemas.CommissionInvoiceOut)
def update_commission_invoice_payment_status(invoice_id: int, update: schemas.PaymentStatusUpdate, db: Session = Depends(get_db)):
    """
    Marks a commission invoice paid or unpaid. Marking paid posts one credit to
    the customer's ledger per payment split — together they must add up to the
    full invoice amount. Marking unpaid again reverses every one of those entries.
    """
    invoice = db.query(models.CommissionInvoice).filter(models.CommissionInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Commission invoice not found")

    _validate_splits_total(update, invoice.amount)

    existing_payments = db.query(models.CustomerLedgerEntry).filter(
        models.CustomerLedgerEntry.ref_type == "COMMISSION_PAYMENT",
        models.CustomerLedgerEntry.ref_id == invoice.id,
    ).all()

    if update.payment_status == models.PaymentStatus.paid:
        if existing_payments:
            raise HTTPException(status_code=400, detail="This invoice is already marked paid")
        payment_date = update.payment_date or datetime.datetime.utcnow()
        split_count = len(update.splits)
        for i, split in enumerate(update.splits, start=1):
            note = update.notes or f"Payment received for {invoice.invoice_number}"
            if split_count > 1:
                note += f" (split {i}/{split_count})"
            db.add(models.CustomerLedgerEntry(
                customer_id=invoice.customer_id,
                direction=models.LedgerDirection.credit,
                amount=split.amount,
                ref_type="COMMISSION_PAYMENT",
                ref_id=invoice.id,
                entry_date=payment_date,
                notes=note,
                payment_method=split.payment_method,
                cheque_number=split.cheque_number,
                cheque_bank=split.cheque_bank,
                our_bank=split.our_bank,
                other_party_name=split.other_party_name,
                other_party_bank=split.other_party_bank,
            ))
        invoice.payment_status = models.PaymentStatus.paid
    else:
        for entry in existing_payments:
            db.delete(entry)
        invoice.payment_status = models.PaymentStatus.unpaid

    db.commit()
    db.refresh(invoice)
    return invoice
