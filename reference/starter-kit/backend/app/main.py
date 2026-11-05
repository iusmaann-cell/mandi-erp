import os
import pathlib
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from . import models, file_storage, security
from .database import engine, run_lightweight_migrations
from .routers import auth, accounts, admin, settings, items     # <- register each new router here

# Startup sequence (order matters):
models.Base.metadata.create_all(bind=engine)   # 1. create missing tables
run_lightweight_migrations()                    # 2. add missing columns to existing tables
security.ensure_admin_bootstrap()               # 3. make sure an Admin role + first admin user exist
from . import one_time_cleanup                  # 4. env-var driven production data fixes (no-ops unless a variable is set)
one_time_cleanup.run()

APP_NAME = os.getenv("APP_NAME", "My ERP")

app = FastAPI(
    title=f"{APP_NAME} API",
    version="0.1.0",
    dependencies=[Depends(security.authorize)],   # EVERY route needs a valid session + module access
    # API docs are off unless ENABLE_DOCS=1 — they'd otherwise publish the full API map
    docs_url="/docs" if os.getenv("ENABLE_DOCS") else None,
    redoc_url=None,
    openapi_url="/openapi.json" if os.getenv("ENABLE_DOCS") else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your frontend domain before going live (Authorization header is used, not cookies)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

file_storage._bills_path()   # make sure the uploads folder exists


@app.get("/uploads/{file_path:path}", include_in_schema=False)
def get_upload(file_path: str):
    """Uploaded files are served through an authenticated route (never a public static mount)."""
    base = pathlib.Path(file_storage.UPLOADS_DIR).resolve()
    target = (base / file_path).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target)


for r in (auth, accounts, admin, settings, items):
    app.include_router(r.router)


@app.get("/")
def root():
    return {"message": f"{APP_NAME} API is running"}
