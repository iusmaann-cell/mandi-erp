from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import datetime
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/attendance", tags=["Attendance"])


@router.post("/mark", response_model=List[schemas.AttendanceRecordOut])
def mark_attendance(request: schemas.AttendanceMarkRequest, db: Session = Depends(get_db)):
    """
    Mark attendance for one or more employees on a given date. Upserts — marking the
    same employee/date twice updates the existing record instead of erroring, since
    attendance is often corrected during the day.
    """
    day_start = request.attendance_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + datetime.timedelta(days=1)

    results = []
    for line in request.lines:
        employee = db.query(models.Employee).filter(models.Employee.id == line.employee_id).first()
        if not employee:
            raise HTTPException(status_code=404, detail=f"Employee {line.employee_id} not found")

        existing = db.query(models.AttendanceRecord).filter(
            models.AttendanceRecord.employee_id == line.employee_id,
            models.AttendanceRecord.attendance_date >= day_start,
            models.AttendanceRecord.attendance_date < day_end,
        ).first()

        if existing:
            existing.status = line.status
            existing.overtime_hours = line.overtime_hours
            existing.notes = line.notes
            record = existing
        else:
            record = models.AttendanceRecord(
                employee_id=line.employee_id,
                attendance_date=day_start,
                status=line.status,
                overtime_hours=line.overtime_hours,
                notes=line.notes,
            )
            db.add(record)

        results.append(record)

    db.commit()
    for r in results:
        db.refresh(r)
    return results


@router.get("/", response_model=List[schemas.AttendanceRecordOut])
def list_attendance(
    employee_id: Optional[int] = None,
    start_date: Optional[datetime.datetime] = None,
    end_date: Optional[datetime.datetime] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.AttendanceRecord)
    if employee_id:
        query = query.filter(models.AttendanceRecord.employee_id == employee_id)
    if start_date:
        query = query.filter(models.AttendanceRecord.attendance_date >= start_date)
    if end_date:
        query = query.filter(models.AttendanceRecord.attendance_date <= end_date)
    return query.order_by(models.AttendanceRecord.attendance_date.desc()).all()
