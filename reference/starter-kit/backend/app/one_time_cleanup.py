"""
One-off PRODUCTION data repairs, driven by environment variables so nothing runs unless asked.
This is the safe pattern the original ERP used for every live-data fix (purge a wrong purchase order,
re-link batches to a re-created item, correct a rate everywhere it was copied...). Reuse it whenever
a user says "I entered something wrong, fix/delete it in the live system".

THE PATTERN (follow all six rules):
  1. A function reads its instruction from an env var (e.g. PURGE_ITEM_CODE). Blank/unset -> does nothing.
  2. DRY RUN BY DEFAULT: PURGE_DRY_RUN must equal "0" to apply. Anything else prints what WOULD change.
  3. Print a clear report with the prefix "[purge]" (read it in the host's deploy logs).
  4. Refuse (change nothing, print ABORTED) if anything unexpected would break — e.g. the row is
     referenced elsewhere, or a quantity would go negative.
  5. Before applying, write a JSON backup of every old value to <UPLOADS_DIR>/purge_backups/.
  6. Operate in ONE transaction; roll back on any error.
Workflow: set variable + leave dry-run on -> redeploy -> read log -> show user -> user says "confirm"
-> set PURGE_DRY_RUN=0 -> redeploy -> verify "DONE" in log -> BLANK the variables again (set to "",
and PURGE_DRY_RUN back to "1"), because the code re-runs on every restart.
Delete this file (and its two lines in main.py) in a later release when you no longer need it.
"""
import os
import json
import datetime
import pathlib

from . import models
from .database import SessionLocal


def _dry() -> bool:
    return os.getenv("PURGE_DRY_RUN", "1") != "0"


def purge_item():
    """EXAMPLE: PURGE_ITEM_CODE="ITM-001" deletes that item if nothing else references it."""
    code = (os.getenv("PURGE_ITEM_CODE") or "").strip()
    if not code:
        return
    dry = _dry()
    db = SessionLocal()
    try:
        item = db.query(models.Item).filter(models.Item.code == code).first()
        if not item:
            print(f"[purge] item {code}: not found — nothing to do (already removed?)")
            return
        from .routers.items import _is_referenced_anywhere
        if _is_referenced_anywhere(db, "items", item.id):
            print(f"[purge] ABORTED — item {code} is referenced by other records; nothing was changed.")
            return
        print(f"[purge] {'DRY RUN — ' if dry else ''}would delete item {code} ({item.name})")
        if dry:
            print("[purge]   dry run only — nothing changed")
            return
        bdir = pathlib.Path(os.getenv("UPLOADS_DIR", "uploads")) / "purge_backups"
        bdir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        (bdir / f"item_{code}_{stamp}.json").write_text(json.dumps(
            {"id": item.id, "code": item.code, "name": item.name, "unit_price": item.unit_price}, indent=1))
        db.delete(item)
        db.commit()
        print(f"[purge]   DONE — item {code} deleted (backup saved).")
    except Exception as e:
        db.rollback()
        print(f"[purge] FAILED, nothing changed: {e}")
    finally:
        db.close()


def run():
    purge_item()
    # add further one-off functions here, in the order they should run
