import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from .. import models
from ..database import get_db

router = APIRouter(prefix="/salary-advances", tags=["Salary Advances"])

METHODS = ("cash", "online", "cheque")


class AdvanceIn(BaseModel):
    employee_id: int
    advance_date: Optional[datetime.datetime] = None
    amount: float
    payment_method: str = "cash"
    notes: Optional[str] = None


class AdvanceUpdate(BaseModel):
    advance_date: Optional[datetime.datetime] = None
    amount: Optional[float] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None


def _out(a: models.SalaryAdvance):
    return {"id": a.id, "employee_id": a.employee_id, "employee_name": a.employee.name if a.employee else None,
            "advance_date": a.advance_date, "amount": a.amount, "payment_method": a.payment_method or "cash",
            "notes": a.notes}


def recovered_by_employee(db: Session, employee_ids=None) -> dict:
    """{employee_id: advance recovered on FINALIZED payroll runs}. Draft runs don't count yet."""
    q = db.query(models.PayslipLine).join(models.PayrollRun, models.PayrollRun.id == models.PayslipLine.payroll_run_id).filter(
        models.PayrollRun.status == models.PayrollRunStatus.finalized)
    if employee_ids is not None:
        q = q.filter(models.PayslipLine.employee_id.in_(list(employee_ids)))
    out = {}
    for l in q.all():
        out[l.employee_id] = out.get(l.employee_id, 0.0) + (l.advance_deduction or 0.0)
    return out


def advanced_by_employee(db: Session, employee_ids=None) -> dict:
    q = db.query(models.SalaryAdvance)
    if employee_ids is not None:
        q = q.filter(models.SalaryAdvance.employee_id.in_(list(employee_ids)))
    out = {}
    for a in q.all():
        out[a.employee_id] = out.get(a.employee_id, 0.0) + a.amount
    return out


def outstanding(db: Session, employee_id: int) -> float:
    adv = advanced_by_employee(db, [employee_id]).get(employee_id, 0.0)
    rec = recovered_by_employee(db, [employee_id]).get(employee_id, 0.0)
    return max(adv - rec, 0.0)


def _check_method(m):
    if m not in METHODS:
        raise HTTPException(status_code=400, detail="Payment method must be cash, online or cheque")


@router.get("/")
def list_advances(employee_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(models.SalaryAdvance)
    if employee_id:
        q = q.filter(models.SalaryAdvance.employee_id == employee_id)
    return [_out(a) for a in q.order_by(models.SalaryAdvance.advance_date.desc(), models.SalaryAdvance.id.desc()).all()]


@router.post("/")
def add_advance(body: AdvanceIn, db: Session = Depends(get_db)):
    emp = db.query(models.Employee).filter(models.Employee.id == body.employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="The advance amount must be above zero")
    _check_method(body.payment_method)
    a = models.SalaryAdvance(employee_id=emp.id, advance_date=body.advance_date or datetime.datetime.utcnow(),
                             amount=body.amount, payment_method=body.payment_method, notes=body.notes)
    db.add(a)
    db.commit()
    db.refresh(a)
    return _out(a)


@router.put("/{advance_id}")
def update_advance(advance_id: int, body: AdvanceUpdate, db: Session = Depends(get_db)):
    a = db.query(models.SalaryAdvance).filter(models.SalaryAdvance.id == advance_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advance not found")
    data = body.dict(exclude_unset=True)
    if "payment_method" in data:
        _check_method(data["payment_method"])
    if "amount" in data:
        if data["amount"] <= 0:
            raise HTTPException(status_code=400, detail="The advance amount must be above zero")
        # can't shrink an advance below what payroll has already taken back
        others = advanced_by_employee(db, [a.employee_id]).get(a.employee_id, 0.0) - a.amount
        if others + data["amount"] < recovered_by_employee(db, [a.employee_id]).get(a.employee_id, 0.0) - 0.01:
            raise HTTPException(status_code=400, detail="Payroll has already recovered more than this new amount.")
    for k, v in data.items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return _out(a)


@router.delete("/{advance_id}")
def delete_advance(advance_id: int, db: Session = Depends(get_db)):
    a = db.query(models.SalaryAdvance).filter(models.SalaryAdvance.id == advance_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advance not found")
    total = advanced_by_employee(db, [a.employee_id]).get(a.employee_id, 0.0)
    if total - a.amount < recovered_by_employee(db, [a.employee_id]).get(a.employee_id, 0.0) - 0.01:
        raise HTTPException(status_code=400, detail="Payroll has already recovered part of this advance, so it can't be deleted.")
    db.delete(a)
    db.commit()
    return {"message": "Advance deleted", "advance_id": advance_id}


@router.get("/balances")
def balances(db: Session = Depends(get_db)):
    """Per employee: total advanced, recovered through payroll, and still owed."""
    adv = advanced_by_employee(db)
    rec = recovered_by_employee(db)
    emps = {e.id: e for e in db.query(models.Employee).all()}
    rows = []
    for eid in sorted(adv):
        if eid not in emps:
            continue
        rows.append({"employee_id": eid, "employee_name": emps[eid].name, "advanced": adv[eid],
                     "recovered": rec.get(eid, 0.0), "outstanding": max(adv[eid] - rec.get(eid, 0.0), 0.0)})
    return rows


@router.get("/ledger/{employee_id}")
def employee_ledger(employee_id: int, db: Session = Depends(get_db)):
    """Advances given (debit) and what payroll took back (credit), oldest first, with a running balance."""
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    entries = [{"date": a.advance_date, "kind": "advance", "label": "Advance given" + (f" — {a.notes}" if a.notes else ""),
                "method": a.payment_method or "cash", "debit": a.amount, "credit": 0.0, "id": a.id}
               for a in db.query(models.SalaryAdvance).filter(models.SalaryAdvance.employee_id == employee_id).all()]
    lines = db.query(models.PayslipLine, models.PayrollRun).join(
        models.PayrollRun, models.PayrollRun.id == models.PayslipLine.payroll_run_id).filter(
        models.PayslipLine.employee_id == employee_id,
        models.PayrollRun.status == models.PayrollRunStatus.finalized,
        models.PayslipLine.advance_deduction > 0).all()
    for l, run in lines:
        entries.append({"date": run.period_end, "kind": "recovery", "label": f"Deducted in payroll {run.run_number}",
                        "method": None, "debit": 0.0, "credit": l.advance_deduction, "id": None})
    entries.sort(key=lambda e: (e["date"], 0 if e["kind"] == "advance" else 1))
    bal = 0.0
    for e in entries:
        bal += e["debit"] - e["credit"]
        e["balance"] = bal
    return {"employee_id": emp.id, "employee_name": emp.name, "entries": entries, "outstanding": max(bal, 0.0)}
