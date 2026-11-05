import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/customers", tags=["Customers (Toll)"])


@router.post("/", response_model=schemas.CustomerOut)
def create_customer(customer: schemas.CustomerCreate, db: Session = Depends(get_db)):
    if customer.customer_number:
        existing = db.query(models.Customer).filter(models.Customer.customer_number == customer.customer_number).first()
        if existing:
            raise HTTPException(status_code=400, detail="Customer number already exists")
    db_customer = models.Customer(**customer.dict())
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.get("/", response_model=List[schemas.CustomerOut])
def list_customers(db: Session = Depends(get_db)):
    return db.query(models.Customer).filter(models.Customer.is_active == 1).all()


@router.get("/{customer_id}", response_model=schemas.CustomerOut)
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.put("/{customer_id}", response_model=schemas.CustomerOut)
def update_customer(customer_id: int, update: schemas.CustomerUpdate, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    data = update.dict(exclude_unset=True)
    if "customer_number" in data and data["customer_number"] and data["customer_number"] != customer.customer_number:
        existing = db.query(models.Customer).filter(models.Customer.customer_number == data["customer_number"]).first()
        if existing:
            raise HTTPException(status_code=400, detail="Customer number already exists")
    for field, value in data.items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


@router.delete("/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer.is_active = 0
    db.commit()
    return {"message": "Customer deactivated", "customer_id": customer_id}


@router.get("/{customer_id}/balance", response_model=schemas.CustomerBalanceOut)
def get_customer_balance(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    debit_total = db.query(func.coalesce(func.sum(models.CustomerLedgerEntry.amount), 0.0)).filter(
        models.CustomerLedgerEntry.customer_id == customer_id,
        models.CustomerLedgerEntry.direction == models.LedgerDirection.debit,
    ).scalar()
    credit_total = db.query(func.coalesce(func.sum(models.CustomerLedgerEntry.amount), 0.0)).filter(
        models.CustomerLedgerEntry.customer_id == customer_id,
        models.CustomerLedgerEntry.direction == models.LedgerDirection.credit,
    ).scalar()

    balance = debit_total - credit_total
    return schemas.CustomerBalanceOut(customer_id=customer.id, customer_name=customer.name, balance=balance)


@router.post("/{customer_id}/payment")
def record_payment(customer_id: int, amount: float, notes: str = "", db: Session = Depends(get_db)):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    entry = models.CustomerLedgerEntry(
        customer_id=customer_id,
        direction=models.LedgerDirection.credit,
        amount=amount,
        ref_type="PAYMENT",
        notes=notes,
    )
    db.add(entry)
    db.commit()
    return {"message": "Payment recorded", "customer_id": customer_id, "amount": amount}


@router.get("/{customer_id}/ledger", response_model=schemas.CustomerLedgerDetailOut)
def get_customer_ledger(
    customer_id: int,
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """Every ledger entry for this toll customer (commission invoices + payments
    received, with full payment method detail), optionally filtered to a date
    range, plus the running balance owed as of the end of that range."""
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    query = db.query(models.CustomerLedgerEntry).filter(models.CustomerLedgerEntry.customer_id == customer_id)
    if start_date:
        query = query.filter(models.CustomerLedgerEntry.entry_date >= start_date)
    if end_date:
        query = query.filter(models.CustomerLedgerEntry.entry_date <= end_date)
    entries = query.order_by(models.CustomerLedgerEntry.entry_date.desc()).all()

    period_debit = sum(e.amount for e in entries if e.direction == models.LedgerDirection.debit)
    period_credit = sum(e.amount for e in entries if e.direction == models.LedgerDirection.credit)

    balance_query = db.query(models.CustomerLedgerEntry).filter(models.CustomerLedgerEntry.customer_id == customer_id)
    if end_date:
        balance_query = balance_query.filter(models.CustomerLedgerEntry.entry_date <= end_date)
    all_up_to_end = balance_query.all()
    balance_as_of_end = (
        sum(e.amount for e in all_up_to_end if e.direction == models.LedgerDirection.debit)
        - sum(e.amount for e in all_up_to_end if e.direction == models.LedgerDirection.credit)
    )

    return schemas.CustomerLedgerDetailOut(
        entries=entries, period_debit=period_debit, period_credit=period_credit, balance_as_of_end=balance_as_of_end,
    )
