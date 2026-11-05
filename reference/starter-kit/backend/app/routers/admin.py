from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db

router = APIRouter(prefix="/admin", tags=["Admin"])

# Tables intentionally preserved across a reset — configuration, not test data.
# Accounts, roles and the token-signing key must survive too — wiping them would
# lock everyone (including the administrator who pressed the button) out.
PRESERVED_TABLES = {"invoice_settings", "users", "roles", "auth_secret"}


@router.post("/reset-all-data")
def reset_all_data(confirm: str = "", db: Session = Depends(get_db)):
    """
    Permanently deletes every row from every table (except the ones listed in
    PRESERVED_TABLES) and leaves the schema itself intact — for wiping test data
    and starting fresh. Tables are cleared in reverse of SQLAlchemy's dependency
    order, so child rows are always removed before the parent rows they
    reference, avoiding foreign-key violations without needing a hand-maintained
    table list that could go stale as new phases add tables.

    Administrators only (enforced centrally in security.authorize). The
    confirm=RESET query param is an extra guard against triggering it by accident.
    """
    if confirm != "RESET":
        raise HTTPException(
            status_code=400,
            detail="This permanently deletes ALL data. Pass confirm=RESET as a query parameter to proceed.",
        )

    cleared = []
    for table in reversed(models.Base.metadata.sorted_tables):
        if table.name in PRESERVED_TABLES:
            continue
        db.execute(table.delete())
        cleared.append(table.name)

    db.commit()
    return {
        "message": f"Wiped {len(cleared)} table(s). Invoice settings and user accounts were preserved.",
        "cleared_tables": cleared,
    }
