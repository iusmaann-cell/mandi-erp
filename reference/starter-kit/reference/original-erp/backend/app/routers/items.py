from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from typing import List
import io
import datetime
import openpyxl
from fastapi import Request
from .. import models, schemas, reporting
from ..database import get_db
from ..security import current_user

router = APIRouter(tags=["Items & UOM"])

BULK_UPLOAD_HEADERS = ["code", "name", "item_type", "uom_symbol", "reorder_level", "pack_size", "units_per_case"]
VALID_ITEM_TYPES = {"crude_oil", "chemical", "packaging", "finished_good"}


def _is_referenced_anywhere(db: Session, target_table_name: str, target_id: int) -> bool:
    """
    Checks every table in the schema for a foreign key pointing at
    target_table_name.id, and whether any row references target_id. Used before
    a hard delete (purge), so we never orphan a real record — reflects the
    schema dynamically rather than hardcoding a table list that could go stale
    as new features add new references.
    """
    for table in models.Base.metadata.tables.values():
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == target_table_name:
                    row = db.execute(select(column).where(column == target_id).limit(1)).first()
                    if row is not None:
                        return True
    return False


# ---- Units of Measure ----
UOM_BULK_UPLOAD_HEADERS = ["name", "symbol"]


@router.post("/uom/", response_model=schemas.UOMOut)
def create_uom(uom: schemas.UOMCreate, db: Session = Depends(get_db)):
    existing = db.query(models.UnitOfMeasure).filter(models.UnitOfMeasure.symbol == uom.symbol).first()
    if existing:
        raise HTTPException(status_code=400, detail="UOM with this symbol already exists")
    db_uom = models.UnitOfMeasure(**uom.dict())
    db.add(db_uom)
    db.commit()
    db.refresh(db_uom)
    return db_uom


@router.get("/uom/", response_model=List[schemas.UOMOut])
def list_uom(db: Session = Depends(get_db)):
    return db.query(models.UnitOfMeasure).filter(models.UnitOfMeasure.is_active == 1).all()


# Bulk upload routes MUST come before /uom/{uom_id} — FastAPI matches routes in
# registration order, and {uom_id} would otherwise swallow "bulk-upload" as an
# attempted (and failing) numeric ID lookup.

@router.get("/uom/bulk-upload/template")
def download_uom_bulk_upload_template():
    """An .xlsx template with the right headers and a couple of example rows."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Units"
    ws.append(UOM_BULK_UPLOAD_HEADERS)
    ws.append(["Metric Ton", "MT"])
    ws.append(["Piece", "pc"])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=units_bulk_upload_template.xlsx"},
    )


@router.post("/uom/bulk-upload")
async def bulk_upload_uom(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Parses an .xlsx with columns: name, symbol (see /uom/bulk-upload/template).
    Validates every row before creating anything — either everything in the file
    succeeds, or nothing does.
    """
    if not file.filename.endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Please upload an .xlsx file")

    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Couldn't read this file — is it a valid .xlsx?")

    ws = wb["Units"] if "Units" in wb.sheetnames else wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(status_code=400, detail="The sheet is empty")

    header = [str(h).strip().lower() if h else "" for h in rows[0]]
    missing_cols = [h for h in ("name", "symbol") if h not in header]
    if missing_cols:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required column(s): {', '.join(missing_cols)}. Download the template to see the expected format.",
        )
    col_idx = {h: i for i, h in enumerate(header)}

    existing_symbols = {u.symbol for u in db.query(models.UnitOfMeasure).all()}
    existing_names = {u.name for u in db.query(models.UnitOfMeasure).all()}

    to_create = []
    errors = []
    seen_symbols_in_file = set()
    seen_names_in_file = set()

    for row_num, row in enumerate(rows[1:], start=2):
        if row is None or all(c is None for c in row):
            continue

        def cell(name):
            idx = col_idx.get(name)
            return row[idx] if idx is not None and idx < len(row) else None

        name = str(cell("name") or "").strip()
        symbol = str(cell("symbol") or "").strip()

        if not name or not symbol:
            errors.append(f"Row {row_num}: name and symbol are both required")
            continue
        if symbol in existing_symbols:
            errors.append(f"Row {row_num}: symbol '{symbol}' already exists")
            continue
        if symbol in seen_symbols_in_file:
            errors.append(f"Row {row_num}: symbol '{symbol}' appears twice in this file")
            continue
        if name in existing_names:
            errors.append(f"Row {row_num}: unit name '{name}' already exists")
            continue
        if name in seen_names_in_file:
            errors.append(f"Row {row_num}: unit name '{name}' appears twice in this file")
            continue
        seen_symbols_in_file.add(symbol)
        seen_names_in_file.add(name)

        to_create.append(models.UnitOfMeasure(name=name, symbol=symbol))

    if errors:
        raise HTTPException(status_code=400, detail={"message": "Fixed nothing — please correct these rows and re-upload", "errors": errors})

    for uom in to_create:
        db.add(uom)
    db.commit()

    return {"message": f"Created {len(to_create)} unit(s)", "created_count": len(to_create)}


@router.put("/uom/{uom_id}", response_model=schemas.UOMOut)
def update_uom(uom_id: int, update: schemas.UOMUpdate, db: Session = Depends(get_db)):
    uom = db.query(models.UnitOfMeasure).filter(models.UnitOfMeasure.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="Unit not found")

    data = update.dict(exclude_unset=True)
    if "symbol" in data and data["symbol"] != uom.symbol:
        existing = db.query(models.UnitOfMeasure).filter(models.UnitOfMeasure.symbol == data["symbol"]).first()
        if existing:
            raise HTTPException(status_code=400, detail="UOM with this symbol already exists")
    if "name" in data and data["name"] != uom.name:
        existing = db.query(models.UnitOfMeasure).filter(models.UnitOfMeasure.name == data["name"]).first()
        if existing:
            raise HTTPException(status_code=400, detail="UOM with this name already exists")

    for field, value in data.items():
        setattr(uom, field, value)
    db.commit()
    db.refresh(uom)
    return uom


@router.delete("/uom/{uom_id}")
def delete_uom(uom_id: int, db: Session = Depends(get_db)):
    """Soft delete — hides the unit from active lists but keeps it valid for any
    existing item that already references it, and keeps historical data intact.
    The name/symbol are freed up (renamed on the now-inactive row) so a new unit
    can immediately reuse them — the inactive row's identity no longer needs to
    stay human-readable once it's off every active list."""
    uom = db.query(models.UnitOfMeasure).filter(models.UnitOfMeasure.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="Unit not found")
    if uom.is_active:
        suffix = f"__deleted_{uom.id}_{int(datetime.datetime.utcnow().timestamp())}"
        uom.symbol = f"{uom.symbol}{suffix}"
        uom.name = f"{uom.name}{suffix}"
    uom.is_active = 0
    db.commit()
    return {"message": "Unit deactivated", "uom_id": uom_id}


@router.post("/uom/purge-inactive")
def purge_inactive_uoms(db: Session = Depends(get_db)):
    """
    One-time cleanup for units deleted before the rename-on-delete fix above
    existed — those still hold their original name/symbol, blocking reuse.
    Permanently removes inactive units that nothing still references (checked
    dynamically against every table with a foreign key to units_of_measure, not
    just items) — safe to call any time; anything still in use is left alone and
    reported, not deleted.
    """
    inactive = db.query(models.UnitOfMeasure).filter(models.UnitOfMeasure.is_active == 0).all()
    purged, kept = [], []
    for uom in inactive:
        if _is_referenced_anywhere(db, "units_of_measure", uom.id):
            kept.append(uom.name)
        else:
            purged.append(uom.name)
            db.delete(uom)
    db.commit()
    return {"purged_count": len(purged), "purged": purged, "kept_in_use": kept}


# ---- Items ----
@router.post("/items/", response_model=schemas.ItemOut)
def create_item(item: schemas.ItemCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Item).filter(models.Item.code == item.code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Item code already exists")
    db_item = models.Item(**item.dict())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


@router.get("/items/", response_model=List[schemas.ItemOut])
def list_items(item_type: str = None, db: Session = Depends(get_db)):
    query = db.query(models.Item).filter(models.Item.is_active == 1)
    if item_type:
        query = query.filter(models.Item.item_type == item_type)
    return query.all()


def _item_list_data(db: Session):
    """Every active item with its unit and the owned stock on hand (toll customers' material excluded)."""
    from sqlalchemy import func
    on_hand = {r.item_id: r.q for r in db.query(
        models.StockLedgerEntry.item_id, func.sum(models.StockLedgerEntry.quantity).label("q")
    ).filter(models.StockLedgerEntry.is_toll_stock == 0).group_by(models.StockLedgerEntry.item_id).all()}
    out = []
    for it in db.query(models.Item).filter(models.Item.is_active == 1).order_by(models.Item.item_type, models.Item.name).all():
        out.append({
            "code": it.code, "name": it.name, "item_type": it.item_type.value,
            "unit": it.uom.symbol if it.uom else "", "pack_size": it.pack_size or "",
            "units_per_case": it.units_per_case, "reorder_level": it.reorder_level,
            "on_hand": round(on_hand.get(it.id, 0.0) or 0.0, 3),
        })
    return out


@router.get("/items/report")
def items_report(db: Session = Depends(get_db)):
    return _item_list_data(db)


@router.get("/items/report/excel")
def items_report_excel(request: Request, db: Session = Depends(get_db)):
    rows = _item_list_data(db)
    user = current_user(request)
    wb = openpyxl.Workbook()
    columns = ["Code", "Item", "Type", "Unit", "Pack size", "Units / case", "Reorder level", "On hand (owned)", "Low?"]
    ws, r = reporting.new_sheet(
        wb, "Items", "Riwayat Oils and Fats — Item List",
        [f"{len(rows)} active items", f"Generated {reporting.fmt_day(reporting.pkt_today())} by {user.full_name}"],
        columns, [14, 34, 16, 9, 11, 12, 14, 16, 8])
    for row in rows:
        low = row["reorder_level"] is not None and row["on_hand"] <= row["reorder_level"]
        reporting.write_row(ws, r, [row["code"], row["name"], row["item_type"].replace("_", " ").title(), row["unit"],
                                    row["pack_size"], row["units_per_case"], row["reorder_level"], row["on_hand"],
                                    "LOW" if low else ""], qty_cols=(6, 7, 8))
        r += 1
    return reporting.workbook_response(wb, f"item_list_{reporting.pkt_today()}.xlsx")


# ---- Bulk upload (Excel) — MUST come before /items/{item_id} routes, since a
# literal path only matches correctly if registered before the {item_id} pattern ----

@router.get("/items/bulk-upload/template")
def download_bulk_upload_template(db: Session = Depends(get_db)):
    """An .xlsx template with the right headers and a couple of example rows, plus
    a sheet listing valid unit symbols so the person filling it in doesn't have to
    guess at UOM ids."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Items"
    ws.append(BULK_UPLOAD_HEADERS)
    ws.append(["CRD-002", "Crude Palm Oil", "crude_oil", "MT", "", "", ""])
    ws.append(["BOTTLE-1L", "1L Bottle", "packaging", "pc", "", "", "12"])

    uom_sheet = wb.create_sheet("Valid Units (reference)")
    uom_sheet.append(["symbol", "name"])
    for uom in db.query(models.UnitOfMeasure).all():
        uom_sheet.append([uom.symbol, uom.name])

    type_sheet = wb.create_sheet("Valid item_type values")
    type_sheet.append(["item_type"])
    for t in sorted(VALID_ITEM_TYPES):
        type_sheet.append([t])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=items_bulk_upload_template.xlsx"},
    )


@router.post("/items/bulk-upload")
async def bulk_upload_items(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Parses an .xlsx with columns: code, name, item_type, uom_symbol, reorder_level,
    pack_size, units_per_case (see /items/bulk-upload/template). Validates every
    row before creating anything — either everything in the file succeeds, or
    nothing does, so a bad row can't leave you with a half-imported sheet.
    """
    if not file.filename.endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Please upload an .xlsx file")

    contents = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Couldn't read this file — is it a valid .xlsx?")

    ws = wb["Items"] if "Items" in wb.sheetnames else wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(status_code=400, detail="The sheet is empty")

    header = [str(h).strip().lower() if h else "" for h in rows[0]]
    missing_cols = [h for h in ("code", "name", "item_type", "uom_symbol") if h not in header]
    if missing_cols:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required column(s): {', '.join(missing_cols)}. Download the template to see the expected format.",
        )
    col_idx = {h: i for i, h in enumerate(header)}

    uoms = {u.symbol: u for u in db.query(models.UnitOfMeasure).all()}
    existing_codes = {i.code for i in db.query(models.Item).all()}

    to_create = []
    errors = []
    seen_codes_in_file = set()

    for row_num, row in enumerate(rows[1:], start=2):
        if row is None or all(c is None for c in row):
            continue

        def cell(name):
            idx = col_idx.get(name)
            return row[idx] if idx is not None and idx < len(row) else None

        code = str(cell("code") or "").strip()
        name = str(cell("name") or "").strip()
        item_type = str(cell("item_type") or "").strip().lower()
        uom_symbol = str(cell("uom_symbol") or "").strip()

        if not code or not name or not item_type or not uom_symbol:
            errors.append(f"Row {row_num}: code, name, item_type, and uom_symbol are all required")
            continue
        if item_type not in VALID_ITEM_TYPES:
            errors.append(f"Row {row_num}: '{item_type}' isn't a valid item_type ({', '.join(sorted(VALID_ITEM_TYPES))})")
            continue
        if uom_symbol not in uoms:
            errors.append(f"Row {row_num}: unit symbol '{uom_symbol}' doesn't exist — add it under Items first")
            continue
        if code in existing_codes:
            errors.append(f"Row {row_num}: item code '{code}' already exists")
            continue
        if code in seen_codes_in_file:
            errors.append(f"Row {row_num}: item code '{code}' appears twice in this file")
            continue
        seen_codes_in_file.add(code)

        reorder_level = cell("reorder_level")
        units_per_case = cell("units_per_case")
        pack_size = cell("pack_size")

        to_create.append(models.Item(
            code=code, name=name, item_type=item_type, uom_id=uoms[uom_symbol].id,
            reorder_level=float(reorder_level) if reorder_level not in (None, "") else None,
            units_per_case=float(units_per_case) if units_per_case not in (None, "") else None,
            pack_size=str(pack_size).strip() if pack_size not in (None, "") else None,
        ))

    if errors:
        raise HTTPException(status_code=400, detail={"message": "Fixed nothing — please correct these rows and re-upload", "errors": errors})

    for item in to_create:
        db.add(item)
    db.commit()

    return {"message": f"Created {len(to_create)} item(s)", "created_count": len(to_create)}


@router.get("/items/{item_id}", response_model=schemas.ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/items/{item_id}", response_model=schemas.ItemOut)
def update_item(item_id: int, update: schemas.ItemUpdate, db: Session = Depends(get_db)):
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    data = update.dict(exclude_unset=True)
    if "code" in data and data["code"] != item.code:
        existing = db.query(models.Item).filter(models.Item.code == data["code"]).first()
        if existing:
            raise HTTPException(status_code=400, detail="Item code already exists")

    for field, value in data.items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    """Soft delete — hides the item from active lists but keeps all history (stock, POs, BOMs) intact.
    The code is freed up (renamed on the now-inactive row) so a new item can
    immediately reuse it."""
    item = db.query(models.Item).filter(models.Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    # An item that still has stock on hand (owned or a toll customer's) can be edited but not removed.
    on_hand = db.query(func.coalesce(func.sum(models.StockLedgerEntry.quantity), 0.0)).filter(
        models.StockLedgerEntry.item_id == item_id).scalar() or 0.0
    batches = db.query(models.StockLedgerEntry.warehouse_id, models.StockLedgerEntry.batch_no,
                       models.StockLedgerEntry.toll_customer_id, func.sum(models.StockLedgerEntry.quantity)).filter(
        models.StockLedgerEntry.item_id == item_id).group_by(
        models.StockLedgerEntry.warehouse_id, models.StockLedgerEntry.batch_no,
        models.StockLedgerEntry.toll_customer_id).all()
    if any(round(b[3] or 0.0, 6) > 0 for b in batches):
        raise HTTPException(
            status_code=400,
            detail=f"{item.name} still has stock on hand ({on_hand:,.2f}), so it can't be deleted. "
                   "You can edit the item instead. Use the item once its stock is used up or adjusted to zero.",
        )
    if item.is_active:
        item.code = f"{item.code}__deleted_{item.id}_{int(datetime.datetime.utcnow().timestamp())}"
    item.is_active = 0
    db.commit()
    return {"message": "Item deactivated", "item_id": item_id}


@router.post("/items/purge-inactive")
def purge_inactive_items(db: Session = Depends(get_db)):
    """
    One-time cleanup for items deleted before the rename-on-delete fix above
    existed — those still hold their original code, blocking reuse. Permanently
    removes inactive items that nothing still references (checked dynamically
    against every table with a foreign key to items, not just stock/POs) — safe
    to call any time; anything still in use is left alone and reported, not deleted.
    """
    inactive = db.query(models.Item).filter(models.Item.is_active == 0).all()
    purged, kept = [], []
    for item in inactive:
        if _is_referenced_anywhere(db, "items", item.id):
            kept.append(item.name)
        else:
            purged.append(item.name)
            db.delete(item)
    db.commit()
    return {"purged_count": len(purged), "purged": purged, "kept_in_use": kept}
