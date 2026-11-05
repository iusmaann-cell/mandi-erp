from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/warehouses", tags=["Warehouses"])


@router.post("/", response_model=schemas.WarehouseOut)
def create_warehouse(warehouse: schemas.WarehouseCreate, db: Session = Depends(get_db)):
    db_wh = models.Warehouse(**warehouse.dict())
    db.add(db_wh)
    db.commit()
    db.refresh(db_wh)
    return db_wh


@router.get("/", response_model=List[schemas.WarehouseOut])
def list_warehouses(db: Session = Depends(get_db)):
    return db.query(models.Warehouse).filter(models.Warehouse.is_active == 1).all()


@router.get("/{warehouse_id}", response_model=schemas.WarehouseOut)
def get_warehouse(warehouse_id: int, db: Session = Depends(get_db)):
    wh = db.query(models.Warehouse).filter(models.Warehouse.id == warehouse_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return wh


@router.put("/{warehouse_id}", response_model=schemas.WarehouseOut)
def update_warehouse(warehouse_id: int, update: schemas.WarehouseUpdate, db: Session = Depends(get_db)):
    wh = db.query(models.Warehouse).filter(models.Warehouse.id == warehouse_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    for field, value in update.dict(exclude_unset=True).items():
        setattr(wh, field, value)
    db.commit()
    db.refresh(wh)
    return wh


@router.delete("/{warehouse_id}")
def delete_warehouse(warehouse_id: int, db: Session = Depends(get_db)):
    """Soft delete — hides the warehouse from active lists but keeps all stock history intact."""
    wh = db.query(models.Warehouse).filter(models.Warehouse.id == warehouse_id).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    wh.is_active = 0
    db.commit()
    return {"message": "Warehouse deactivated", "warehouse_id": warehouse_id}
