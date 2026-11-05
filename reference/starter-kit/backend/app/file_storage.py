"""
Bill photo storage on Railway's own persistent disk.

Why this works now when it didn't on Render: Render's free web service disk is
wiped on every redeploy, which is why bill photos were routed to Google Drive
instead. Railway supports a real persistent volume mounted onto the service
(the same way Postgres's own data directory is mounted) — so files written here
survive restarts and redeploys, and we don't need an external service at all.

Setup required on Railway: a volume must be attached to this backend service,
mounted at the path given by the UPLOADS_DIR env var (defaults to "uploads",
relative to the app's working directory, for local development). Without a real
volume attached, files would still be lost on redeploy — same trap as before.
"""
import os
import uuid
import pathlib

UPLOADS_DIR = os.getenv("UPLOADS_DIR", "uploads")
BILLS_SUBDIR = "bills"


def _bills_path() -> pathlib.Path:
    p = pathlib.Path(UPLOADS_DIR) / BILLS_SUBDIR
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_bill_photo(file_bytes: bytes, original_filename: str) -> dict:
    """
    Saves a photo to the mounted uploads volume under a random, collision-proof
    filename (the original name is never trusted/reused). Returns a dict with a
    "url" that's a relative path — the frontend prefixes it with the API's own
    base URL, so this code never needs to know its own public domain.
    """
    ext = pathlib.Path(original_filename or "").suffix.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"):
        ext = ".jpg"
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest = _bills_path() / unique_name

    with open(dest, "wb") as f:
        f.write(file_bytes)

    return {"url": f"/uploads/{BILLS_SUBDIR}/{unique_name}", "filename": unique_name}
