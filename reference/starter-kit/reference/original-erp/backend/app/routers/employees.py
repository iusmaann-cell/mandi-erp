from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/employees", tags=["Employees"])


@router.post("/", response_model=schemas.EmployeeOut)
def create_employee(employee: schemas.EmployeeCreate, db: Session = Depends(get_db)):
    if employee.employment_type == models.EmploymentType.daily_wage and not employee.daily_wage_rate:
        raise HTTPException(status_code=400, detail="Daily-wage employees need a daily_wage_rate")
    if employee.employment_type in (models.EmploymentType.permanent, models.EmploymentType.contract) and not employee.basic_salary:
        raise HTTPException(status_code=400, detail="Permanent/contract employees need a basic_salary")

    db_employee = models.Employee(**employee.dict())
    db.add(db_employee)
    db.commit()
    db.refresh(db_employee)
    return db_employee


@router.get("/", response_model=List[schemas.EmployeeOut])
def list_employees(plant: str = None, db: Session = Depends(get_db)):
    query = db.query(models.Employee).filter(models.Employee.is_active == 1)
    if plant:
        query = query.filter(models.Employee.plant == plant)
    return query.all()


@router.get("/{employee_id}", response_model=schemas.EmployeeOut)
def get_employee(employee_id: int, db: Session = Depends(get_db)):
    employee = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee


@router.put("/{employee_id}", response_model=schemas.EmployeeOut)
def update_employee(employee_id: int, update: schemas.EmployeeUpdate, db: Session = Depends(get_db)):
    employee = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    for field, value in update.dict(exclude_unset=True).items():
        setattr(employee, field, value)
    db.commit()
    db.refresh(employee)
    return employee


@router.delete("/{employee_id}")
def delete_employee(employee_id: int, db: Session = Depends(get_db)):
    employee = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    employee.is_active = 0
    db.commit()
    return {"message": "Employee deactivated", "employee_id": employee_id}
