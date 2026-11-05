import os
import pathlib
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from . import models, file_storage, security
from .database import engine, run_lightweight_migrations
from .routers import vendors, items, warehouses, purchase_orders, grn, stock, production, customers, toll, distributors, sales, expenses, finance, employees, attendance, payroll, salary_advances, bi, settings, stock_adjustments, stock_transfers, admin, auth, accounts

models.Base.metadata.create_all(bind=engine)
run_lightweight_migrations()
security.ensure_admin_bootstrap()
from . import one_time_cleanup
one_time_cleanup.run()

app = FastAPI(
    title="Riwayat Oils and Fats ERP",
    description="ERP for Riwayat Oils and Fats — oil refining, ghee, soap and toll processing business",
    version="0.1.0",
    dependencies=[Depends(security.authorize)],   # every route needs a valid session + module access
    # API docs are off unless ENABLE_DOCS=1 — they'd otherwise publish the full API map
    docs_url="/docs" if os.getenv("ENABLE_DOCS") else None,
    redoc_url=None,
    openapi_url="/openapi.json" if os.getenv("ENABLE_DOCS") else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this to your frontend domain before going live
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uploaded bill photos live on the mounted volume, but are served through an
# authenticated route (not a public static mount) — signed-in users only.
file_storage._bills_path()


@app.get("/uploads/{file_path:path}", include_in_schema=False)
def get_upload(file_path: str):
    base = pathlib.Path(file_storage.UPLOADS_DIR).resolve()
    target = (base / file_path).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target)


app.include_router(vendors.router)
app.include_router(items.router)
app.include_router(warehouses.router)
app.include_router(purchase_orders.router)
app.include_router(grn.router)
app.include_router(stock.router)
app.include_router(production.router)
app.include_router(customers.router)
app.include_router(toll.router)
app.include_router(distributors.router)
app.include_router(sales.router)
app.include_router(expenses.router)
app.include_router(finance.router)
app.include_router(employees.router)
app.include_router(attendance.router)
app.include_router(payroll.router)
app.include_router(salary_advances.router)
app.include_router(bi.router)
app.include_router(settings.router)
app.include_router(stock_adjustments.router)
app.include_router(stock_transfers.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(accounts.router)


@app.get("/")
def root():
    return {"message": "Riwayat Oils and Fats ERP API — Phase 1: Procurement + Inventory, Phase 2: Production, Phase 3: Toll Processing, Phase 4: Packaging, Phase 5: Sales & Distribution, Phase 6: Finance, Phase 7: HR & Payroll, Phase 8: BI Dashboards"}
