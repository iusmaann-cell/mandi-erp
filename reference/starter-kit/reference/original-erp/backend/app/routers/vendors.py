import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/vendors", tags=["Vendors"])


def _vendor_to_out(vendor: models.Vendor) -> schemas.VendorOut:
    return schemas.VendorOut(
        id=vendor.id, name=vendor.name, contact_person=vendor.contact_person,
        phone=vendor.phone, address=vendor.address, payment_terms=vendor.payment_terms,
        opening_balance=vendor.opening_balance, created_at=vendor.created_at,
        item_ids=[vi.item_id for vi in vendor.supplied_items],
        bank_accounts=[
            schemas.VendorBankAccountOut(id=ba.id, bank_name=ba.bank_name, account_title=ba.account_title, account_number=ba.account_number)
            for ba in vendor.bank_accounts if ba.is_active
        ],
    )


def _sync_vendor_items(db: Session, vendor_id: int, item_ids: List[int]):
    """Items are a plain tag/association with no financial history attached —
    safe to fully replace on every save rather than needing soft-delete."""
    db.query(models.VendorItem).filter(models.VendorItem.vendor_id == vendor_id).delete()
    for item_id in set(item_ids):
        db.add(models.VendorItem(vendor_id=vendor_id, item_id=item_id))


def _sync_vendor_bank_accounts(db: Session, vendor_id: int, accounts: List["schemas.VendorBankAccountInput"]):
    """Updates accounts whose id was submitted, creates ones without an id, and
    soft-deletes any existing active account not present in the submitted list —
    never hard-deletes, since a past payment's ledger entry may reference it."""
    existing = db.query(models.VendorBankAccount).filter(
        models.VendorBankAccount.vendor_id == vendor_id,
        models.VendorBankAccount.is_active == 1,
    ).all()
    submitted_ids = {a.id for a in accounts if a.id is not None}

    for acc in existing:
        if acc.id not in submitted_ids:
            acc.is_active = 0

    for a in accounts:
        if a.id is not None:
            acc = db.query(models.VendorBankAccount).filter(
                models.VendorBankAccount.id == a.id, models.VendorBankAccount.vendor_id == vendor_id,
            ).first()
            if acc:
                acc.bank_name = a.bank_name
                acc.account_title = a.account_title
                acc.account_number = a.account_number
                acc.is_active = 1
        else:
            db.add(models.VendorBankAccount(
                vendor_id=vendor_id, bank_name=a.bank_name, account_title=a.account_title, account_number=a.account_number,
            ))


@router.post("/", response_model=schemas.VendorOut)
def create_vendor(vendor: schemas.VendorCreate, db: Session = Depends(get_db)):
    data = vendor.dict()
    item_ids = data.pop("item_ids", None) or []
    bank_accounts = data.pop("bank_accounts", None) or []

    db_vendor = models.Vendor(**data)
    db.add(db_vendor)
    db.commit()
    db.refresh(db_vendor)

    if item_ids:
        _sync_vendor_items(db, db_vendor.id, item_ids)
    if bank_accounts:
        _sync_vendor_bank_accounts(db, db_vendor.id, [schemas.VendorBankAccountInput(**a) if isinstance(a, dict) else a for a in bank_accounts])

    # if there's an opening balance, log it as the first ledger entry
    if vendor.opening_balance:
        entry = models.VendorLedgerEntry(
            vendor_id=db_vendor.id,
            direction=models.LedgerDirection.debit,
            amount=vendor.opening_balance,
            ref_type="OPENING_BALANCE",
            notes="Opening balance at vendor creation",
        )
        db.add(entry)

    db.commit()
    db.refresh(db_vendor)
    return _vendor_to_out(db_vendor)


@router.get("/", response_model=List[schemas.VendorOut])
def list_vendors(db: Session = Depends(get_db)):
    vendors = db.query(models.Vendor).filter(models.Vendor.is_active == 1).all()
    return [_vendor_to_out(v) for v in vendors]


@router.get("/{vendor_id}", response_model=schemas.VendorOut)
def get_vendor(vendor_id: int, db: Session = Depends(get_db)):
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return _vendor_to_out(vendor)


@router.put("/{vendor_id}", response_model=schemas.VendorOut)
def update_vendor(vendor_id: int, update: schemas.VendorUpdate, db: Session = Depends(get_db)):
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    data = update.dict(exclude_unset=True)
    new_opening_balance = data.pop("opening_balance", None)
    item_ids = data.pop("item_ids", None)
    bank_accounts = data.pop("bank_accounts", None)

    for field, value in data.items():
        setattr(vendor, field, value)

    if item_ids is not None:
        _sync_vendor_items(db, vendor_id, item_ids)
    if bank_accounts is not None:
        _sync_vendor_bank_accounts(db, vendor_id, [schemas.VendorBankAccountInput(**a) if isinstance(a, dict) else a for a in bank_accounts])

    # keep the OPENING_BALANCE ledger entry in sync if it changes, rather than
    # letting vendor.opening_balance drift from the actual ledger
    if new_opening_balance is not None and new_opening_balance != vendor.opening_balance:
        vendor.opening_balance = new_opening_balance
        entry = db.query(models.VendorLedgerEntry).filter(
            models.VendorLedgerEntry.vendor_id == vendor_id,
            models.VendorLedgerEntry.ref_type == "OPENING_BALANCE",
        ).first()
        if entry:
            entry.amount = new_opening_balance
        elif new_opening_balance:
            db.add(models.VendorLedgerEntry(
                vendor_id=vendor_id,
                direction=models.LedgerDirection.debit,
                amount=new_opening_balance,
                ref_type="OPENING_BALANCE",
                notes="Opening balance (added on edit)",
            ))

    db.commit()
    db.refresh(vendor)
    return _vendor_to_out(vendor)


@router.delete("/{vendor_id}")
def delete_vendor(vendor_id: int, db: Session = Depends(get_db)):
    """Soft delete — hides the vendor from active lists but keeps all history (POs, ledger) intact."""
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    vendor.is_active = 0
    db.commit()
    return {"message": "Vendor deactivated", "vendor_id": vendor_id}


@router.get("/{vendor_id}/balance", response_model=schemas.VendorBalanceOut)
def get_vendor_balance(vendor_id: int, db: Session = Depends(get_db)):
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    debit_total = db.query(func.coalesce(func.sum(models.VendorLedgerEntry.amount), 0.0)).filter(
        models.VendorLedgerEntry.vendor_id == vendor_id,
        models.VendorLedgerEntry.direction == models.LedgerDirection.debit,
    ).scalar()
    credit_total = db.query(func.coalesce(func.sum(models.VendorLedgerEntry.amount), 0.0)).filter(
        models.VendorLedgerEntry.vendor_id == vendor_id,
        models.VendorLedgerEntry.direction == models.LedgerDirection.credit,
    ).scalar()

    balance = debit_total - credit_total
    return schemas.VendorBalanceOut(vendor_id=vendor.id, vendor_name=vendor.name, balance=balance)


@router.post("/{vendor_id}/payment")
def record_payment(vendor_id: int, amount: float, notes: str = "", db: Session = Depends(get_db)):
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    entry = models.VendorLedgerEntry(
        vendor_id=vendor_id,
        direction=models.LedgerDirection.credit,
        amount=amount,
        ref_type="PAYMENT",
        notes=notes,
    )
    db.add(entry)
    db.commit()
    return {"message": "Payment recorded", "vendor_id": vendor_id, "amount": amount}


@router.get("/{vendor_id}/ledger", response_model=schemas.VendorLedgerDetailOut)
def get_vendor_ledger(
    vendor_id: int,
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    """Every ledger entry for this vendor (bills + payments, with full payment
    method detail), optionally filtered to a date range, plus the running balance
    owed as of the end of that range."""
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    query = db.query(models.VendorLedgerEntry).filter(models.VendorLedgerEntry.vendor_id == vendor_id)
    if start_date:
        query = query.filter(models.VendorLedgerEntry.entry_date >= start_date)
    if end_date:
        query = query.filter(models.VendorLedgerEntry.entry_date <= end_date)
    entries = query.order_by(models.VendorLedgerEntry.entry_date.desc()).all()

    entry_outs = []
    for e in entries:
        label = None
        if e.vendor_bank_account_id and e.vendor_bank_account:
            acc = e.vendor_bank_account
            label = f"{acc.bank_name} — {acc.account_number}" + (f" ({acc.account_title})" if acc.account_title else "")
        entry_outs.append(schemas.VendorLedgerEntryOut(
            id=e.id, direction=e.direction, amount=e.amount, ref_type=e.ref_type, ref_id=e.ref_id,
            entry_date=e.entry_date, notes=e.notes, payment_method=e.payment_method,
            cheque_number=e.cheque_number, cheque_bank=e.cheque_bank, our_bank=e.our_bank,
            other_party_name=e.other_party_name, other_party_bank=e.other_party_bank,
            vendor_bank_account_id=e.vendor_bank_account_id, vendor_bank_account_label=label,
        ))

    period_debit = sum(e.amount for e in entries if e.direction == models.LedgerDirection.debit)
    period_credit = sum(e.amount for e in entries if e.direction == models.LedgerDirection.credit)

    balance_query = db.query(models.VendorLedgerEntry).filter(models.VendorLedgerEntry.vendor_id == vendor_id)
    if end_date:
        balance_query = balance_query.filter(models.VendorLedgerEntry.entry_date <= end_date)
    all_up_to_end = balance_query.all()
    balance_as_of_end = (
        sum(e.amount for e in all_up_to_end if e.direction == models.LedgerDirection.debit)
        - sum(e.amount for e in all_up_to_end if e.direction == models.LedgerDirection.credit)
    )

    return schemas.VendorLedgerDetailOut(
        entries=entry_outs, period_debit=period_debit, period_credit=period_credit, balance_as_of_end=balance_as_of_end,
    )
