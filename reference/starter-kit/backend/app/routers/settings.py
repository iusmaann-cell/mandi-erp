import base64
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/settings", tags=["Invoice Print Settings"])


def _get_or_create_settings(db: Session) -> models.InvoiceSettings:
    settings = db.query(models.InvoiceSettings).filter(models.InvoiceSettings.id == 1).first()
    if not settings:
        settings = models.InvoiceSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("/invoice", response_model=schemas.InvoiceSettingsOut)
def get_invoice_settings(db: Session = Depends(get_db)):
    settings = _get_or_create_settings(db)
    return schemas.InvoiceSettingsOut(
        company_name=settings.company_name,
        company_address=settings.company_address,
        company_phone=settings.company_phone,
        company_email=settings.company_email,
        ntn_number=settings.ntn_number,
        logo_base64=settings.logo_base64,
        logo_width_mm=settings.logo_width_mm,
        logo_height_mm=settings.logo_height_mm,
        footer_text=settings.footer_text,
        show_logo=bool(settings.show_logo),
        accent_color=settings.accent_color,
    )


@router.put("/invoice", response_model=schemas.InvoiceSettingsOut)
def update_invoice_settings(update: schemas.InvoiceSettingsUpdate, db: Session = Depends(get_db)):
    settings = _get_or_create_settings(db)
    data = update.dict(exclude_unset=True)
    if "show_logo" in data:
        data["show_logo"] = 1 if data["show_logo"] else 0
    for field, value in data.items():
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return get_invoice_settings(db)


@router.post("/invoice/logo", response_model=schemas.InvoiceSettingsOut)
async def upload_invoice_logo(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Stores the logo as a data URL directly in the database — simplest option
    that survives redeploys without needing separate file storage."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file (PNG or JPG)")

    contents = await file.read()
    if len(contents) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be under 2MB")

    encoded = base64.b64encode(contents).decode("utf-8")
    data_url = f"data:{file.content_type};base64,{encoded}"

    settings = _get_or_create_settings(db)
    settings.logo_base64 = data_url
    db.commit()
    return get_invoice_settings(db)
