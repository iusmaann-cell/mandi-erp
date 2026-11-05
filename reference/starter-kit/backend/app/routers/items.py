"""EXAMPLE module: master-data CRUD + Excel report. Copy this file as the template for every new
module (vendors, customers, products...). The checklist for a new module is in docs/BACKEND_GUIDE.md.

Access control is NOT written here: the global guard in security.authorize already checked that the
caller's role may view (GET) or edit (POST/PUT/DELETE) the "items" module, because "items" is listed
in security.MODULES. Only EXTRA rules (like the delete action below) are declared per route."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
import openpyxl
from .. import models, schemas, reporting
from ..database import get_db
from ..security import require_action

router = APIRouter(prefix="/items", tags=["Items (example)"])


def _is_referenced_anywhere(db: Session, target_table: str, target_id: int) -> bool:
    """True if ANY table has a foreign key pointing at this row. Reflects the live schema, so it never
    goes stale as you add tables. Use before a hard delete, so you never orphan a real record."""
    for table in models.Base.metadata.tables.values():
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == target_table:
                    if db.execute(select(column).where(column == target_id).limit(1)).first() is not None:
                        return True
    return False


@router.post("/", response_model=schemas.ItemOut)
def create_item(body: schemas.ItemCreate, db: Session = Depends(get_db)):
    if db.query(models.Item).filter(models.Item.code == body.code.strip()).first():
        raise HTTPException(status_code=400, detail="An item with this code already exists")
    item = models.Item(**body.dict())
    item.code = item.code.strip()
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/", response_model=List[schemas.ItemOut])
def list_items(db: Session = Depends(get_db)):
    return db.query(models.Item).filter(models.Item.is_active == 1).order_by(models.Item.name).all()


# Static routes (like /report) must be declared BEFORE /{item_id}, or FastAPI treats "report" as an id.
@router.get("/report")
def items_excel_report(db: Session = Depends(get_db)):
    items = db.query(models.Item).filter(models.Item.is_active == 1).order_by(models.Item.name).all()
    wb = openpyxl.Workbook()
    ws, r = reporting.new_sheet(
        wb, "Items", "My Company — Item List", [f"As of {reporting.fmt_day(reporting.pkt_today())}"],
        ["Code", "Name", "Unit price", "Notes"], [14, 34, 14, 40])
    for it in items:
        reporting.write_row(ws, r, [it.code, it.name, it.unit_price, it.notes or ""], money_cols=(3,), wrap_cols=(4,))
        r += 1
    return reporting.workbook_response(wb, "item-list.xlsx")


@router.get("/{item_id}", response_model=schemas.ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/{item_id}", response_model=schemas.ItemOut)
def update_item(item_id: int, update: schemas.ItemUpdate, db: Session = Depends(get_db)):
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    data = update.dict(exclude_unset=True)          # only the fields the client actually sent
    if "is_active" in data:
        data["is_active"] = 1 if data["is_active"] else 0   # API uses bool, DB uses 0/1
    for field, value in data.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", dependencies=[Depends(require_action("delete_items"))])
def delete_item(item_id: int, db: Session = Depends(get_db)):
    """Extra permission: only roles granted the 'delete_items' action (or admins) get past the dependency."""
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if _is_referenced_anywhere(db, "items", item_id):
        # Used elsewhere -> soft-delete (hide) instead of breaking history.
        item.is_active = 0
    else:
        db.delete(item)
    db.commit()
    return {"deleted": True}
