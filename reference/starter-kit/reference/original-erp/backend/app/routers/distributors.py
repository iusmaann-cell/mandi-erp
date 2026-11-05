import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/distributors", tags=["Distributors"])


@router.post("/", response_model=schemas.DistributorOut)
def create_distributor(distributor: schemas.DistributorCreate, db: Session = Depends(get_db)):
    if distributor.distributor_number:
        existing = db.query(models.Distributor).filter(models.Distributor.distributor_number == distributor.distributor_number).first()
        if existing:
            raise HTTPException(status_code=400, detail="Distributor number already exists")
    db_distributor = models.Distributor(**distributor.dict())
    db.add(db_distributor)
    db.commit()
    db.refresh(db_distributor)

    if distributor.opening_balance:
        db.add(models.DistributorLedgerEntry(
            distributor_id=db_distributor.id,
            direction=models.LedgerDirection.debit,
            amount=distributor.opening_balance,
            ref_type="OPENING_BALANCE",
            notes="Opening balance at distributor creation",
        ))
        db.commit()

    return db_distributor


@router.get("/", response_model=List[schemas.DistributorOut])
def list_distributors(db: Session = Depends(get_db)):
    return db.query(models.Distributor).filter(models.Distributor.is_active == 1).all()


@router.get("/{distributor_id}", response_model=schemas.DistributorOut)
def get_distributor(distributor_id: int, db: Session = Depends(get_db)):
    distributor = db.query(models.Distributor).filter(models.Distributor.id == distributor_id).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="Distributor not found")
    return distributor


@router.put("/{distributor_id}", response_model=schemas.DistributorOut)
def update_distributor(distributor_id: int, update: schemas.DistributorUpdate, db: Session = Depends(get_db)):
    distributor = db.query(models.Distributor).filter(models.Distributor.id == distributor_id).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="Distributor not found")

    data = update.dict(exclude_unset=True)
    new_opening_balance = data.pop("opening_balance", None)
    if "distributor_number" in data and data["distributor_number"] and data["distributor_number"] != distributor.distributor_number:
        existing = db.query(models.Distributor).filter(models.Distributor.distributor_number == data["distributor_number"]).first()
        if existing:
            raise HTTPException(status_code=400, detail="Distributor number already exists")
    for field, value in data.items():
        setattr(distributor, field, value)

    if new_opening_balance is not None and new_opening_balance != distributor.opening_balance:
        distributor.opening_balance = new_opening_balance
        entry = db.query(models.DistributorLedgerEntry).filter(
            models.DistributorLedgerEntry.distributor_id == distributor_id,
            models.DistributorLedgerEntry.ref_type == "OPENING_BALANCE",
        ).first()
        if entry:
            entry.amount = new_opening_balance
        elif new_opening_balance:
            db.add(models.DistributorLedgerEntry(
                distributor_id=distributor_id,
                direction=models.LedgerDirection.debit,
                amount=new_opening_balance,
                ref_type="OPENING_BALANCE",
                notes="Opening balance (added on edit)",
            ))

    db.commit()
    db.refresh(distributor)
    return distributor


@router.delete("/{distributor_id}")
def delete_distributor(distributor_id: int, db: Session = Depends(get_db)):
    distributor = db.query(models.Distributor).filter(models.Distributor.id == distributor_id).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="Distributor not found")
    distributor.is_active = 0
    db.commit()
    return {"message": "Distributor deactivated", "distributor_id": distributor_id}


@router.get("/{distributor_id}/balance", response_model=schemas.DistributorBalanceOut)
def get_distributor_balance(distributor_id: int, db: Session = Depends(get_db)):
    distributor = db.query(models.Distributor).filter(models.Distributor.id == distributor_id).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="Distributor not found")

    debit_total = db.query(func.coalesce(func.sum(models.DistributorLedgerEntry.amount), 0.0)).filter(
        models.DistributorLedgerEntry.distributor_id == distributor_id,
        models.DistributorLedgerEntry.direction == models.LedgerDirection.debit,
    ).scalar()
    credit_total = db.query(func.coalesce(func.sum(models.DistributorLedgerEntry.amount), 0.0)).filter(
        models.DistributorLedgerEntry.distributor_id == distributor_id,
        models.DistributorLedgerEntry.direction == models.LedgerDirection.credit,
    ).scalar()

    balance = debit_total - credit_total
    return schemas.DistributorBalanceOut(distributor_id=distributor.id, distributor_name=distributor.name, balance=balance)


@router.post("/{distributor_id}/payment")
def record_payment(distributor_id: int, amount: float, notes: str = "", db: Session = Depends(get_db)):
    distributor = db.query(models.Distributor).filter(models.Distributor.id == distributor_id).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="Distributor not found")
    db.add(models.DistributorLedgerEntry(
        distributor_id=distributor_id,
        direction=models.LedgerDirection.credit,
        amount=amount,
        ref_type="PAYMENT",
        notes=notes,
    ))
    db.commit()
    return {"message": "Payment recorded", "distributor_id": distributor_id, "amount": amount}


@router.get("/{distributor_id}/ledger", response_model=schemas.DistributorLedgerDetailOut)
def get_distributor_ledger(
    distributor_id: int,
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """Every ledger entry for this distributor (sales invoices + payments received,
    with full payment method detail), optionally filtered to a date range, plus
    the running balance owed as of the end of that range."""
    distributor = db.query(models.Distributor).filter(models.Distributor.id == distributor_id).first()
    if not distributor:
        raise HTTPException(status_code=404, detail="Distributor not found")

    query = db.query(models.DistributorLedgerEntry).filter(models.DistributorLedgerEntry.distributor_id == distributor_id)
    if start_date:
        query = query.filter(models.DistributorLedgerEntry.entry_date >= start_date)
    if end_date:
        query = query.filter(models.DistributorLedgerEntry.entry_date <= end_date)
    entries = query.order_by(models.DistributorLedgerEntry.entry_date.desc()).all()

    period_debit = sum(e.amount for e in entries if e.direction == models.LedgerDirection.debit)
    period_credit = sum(e.amount for e in entries if e.direction == models.LedgerDirection.credit)

    balance_query = db.query(models.DistributorLedgerEntry).filter(models.DistributorLedgerEntry.distributor_id == distributor_id)
    if end_date:
        balance_query = balance_query.filter(models.DistributorLedgerEntry.entry_date <= end_date)
    all_up_to_end = balance_query.all()
    balance_as_of_end = (
        sum(e.amount for e in all_up_to_end if e.direction == models.LedgerDirection.debit)
        - sum(e.amount for e in all_up_to_end if e.direction == models.LedgerDirection.credit)
    )

    return schemas.DistributorLedgerDetailOut(
        entries=entries, period_debit=period_debit, period_credit=period_credit, balance_as_of_end=balance_as_of_end,
    )
