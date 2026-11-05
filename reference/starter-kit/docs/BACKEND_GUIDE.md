# Backend guide (`backend/app/`)

## File-by-file
| File | What it does | Touch it when |
|---|---|---|
| `main.py` | Builds the app, startup sequence, CORS, authenticated `/uploads`, registers routers | adding a router |
| `database.py` | engine/session (`DATABASE_URL`), `get_db`, `run_lightweight_migrations()` | rarely |
| `models.py` | SQLAlchemy tables. Core: `Role`, `User`, `AuthSecret`, `InvoiceSettings`. Example: `Item` | every new table |
| `schemas.py` | Pydantic request/response models (`*Create`, `*Update`, `*Out`) | every new endpoint |
| `security.py` | passwords, tokens, `MODULES`, `ACTIONS`, `authorize()`, `require_action()`, admin bootstrap | every new module / extra permission |
| `reporting.py` | Excel helpers + local-time helpers (`pkt_today`, `range_bounds`) | building reports |
| `file_storage.py` | save uploaded images to `UPLOADS_DIR` with random names; returns a relative URL | new upload types |
| `one_time_cleanup.py` | env-var driven, dry-run-first production data fixes | when live data must be corrected |
| `routers/auth.py` | login, me, change-password, status | never |
| `routers/accounts.py` | users + roles CRUD with "never lock out the last admin" rules (admin-only) | never |
| `routers/admin.py` | "reset all data" danger-zone (keeps users/roles/settings) | adjust `PRESERVED_TABLES` |
| `routers/settings.py` | company / invoice-print settings + logo (stored as data-URL in DB) | never |
| `routers/items.py` | **example module** (CRUD, soft delete, Excel report, extra permission) | copy it |

## Environment variables
| Name | Meaning |
|---|---|
| `DATABASE_URL` | default `sqlite:///./app.db`; Postgres URL in production (Railway gives `postgresql://…`) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | create the first admin when no users exist (password ≥ 8 chars). Needed once |
| `ADMIN_FORCE_RESET=1` | lock-out recovery: resets that admin's password on next start — remove afterwards |
| `SECRET_KEY` | optional token-signing key (otherwise generated and stored in the DB) |
| `UPLOADS_DIR` | folder for uploads; on a host this must be a mounted persistent volume |
| `LOCAL_UTC_OFFSET_HOURS` | business time zone as a fixed offset (default 5) |
| `APP_NAME` | API title |
| `ENABLE_DOCS=1` | exposes `/docs` (Swagger) — keep off in production |
| `PURGE_*`, `PURGE_DRY_RUN` | see `one_time_cleanup.py` |

## New module checklist (do ALL of these, in this order)
Example: adding **Suppliers**.
1. **Model** — `models.py`: `class Supplier(Base)` with `id`, fields, `is_active = Column(Integer, default=1)`, `created_at`.
2. **Schemas** — `schemas.py`: `SupplierCreate`, `SupplierUpdate` (all Optional), `SupplierOut` (`class Config: from_attributes = True`).
3. **Router** — copy `routers/items.py` → `routers/suppliers.py`; `APIRouter(prefix="/suppliers", tags=[...])`.
   Put static routes (`/report`) above `/{supplier_id}`.
4. **Permission module** — `security.py` `MODULES`: `("suppliers", "Suppliers", "Procurement", ["suppliers"])`.
   (If other modules' forms need the supplier dropdown, also add `"suppliers"` to `LOOKUP_PREFIXES`.)
   Extra rights → add to `ACTIONS` and guard routes with `dependencies=[Depends(require_action("..."))]`.
5. **Register** — `main.py`: import the router and add it to the `for r in (...)` tuple.
6. **Frontend api** — `api.js`: `getSuppliers`, `createSupplier`, `updateSupplier`, `deleteSupplier`.
7. **Page** — copy `pages/Items.jsx` → `pages/Suppliers.jsx`.
8. **Frontend registration (3 places)** — `permissions.js` `PAGE_MODULE` (`suppliers: "suppliers"`), `Sidebar.jsx` `NAV_SECTIONS`,
   `App.jsx` `PAGES`.
9. **Test** — run the smoke test in `CLAUDE.md` with a limited role (create role with `{"suppliers":"view"}`, a user in it, check
   GET=200, POST=403) and `npm run build`.

## Writing routes — conventions
- Signature: `def name(body: schemas.XCreate, db: Session = Depends(get_db))`. Commit once at the end; on a validation failure
  raise `HTTPException(400, "plain English")` BEFORE `db.commit()` so nothing is half-saved.
- Multi-row operations (a document with lines) must `db.flush()` to get the parent id, add children, then a single `db.commit()`.
- Uniqueness: check explicitly and return a friendly 400 (don't rely on the DB error).
- Deleting: if anything references the row (`_is_referenced_anywhere` in `items.py`) soft-delete (`is_active=0`) instead.
- Money/quantity maths: use floats, but compare with a tolerance (`> x + 1e-6`), and `round(v, 2)` when posting money to a ledger.
- Current user inside a route: `from ..security import current_user` → `current_user(request)` (add `request: Request`).
- Excel download: build a workbook with `reporting.new_sheet / write_row / write_total_row`, return `reporting.workbook_response(wb, "name.xlsx")`.
- Upload: `file: UploadFile = File(...)`, `await file.read()`, validate type/size, then `file_storage.save_bill_photo(bytes, filename)` →
  store the returned relative `url` on the row. For JSON + file in one request, send `data` as a JSON string form field
  (see `reference/original-erp/backend/app/routers/grn.py`).

## Document numbering
Frontend pre-fills numbers (`docNumbers.js`: `PREFIX-YYMMDD-HHMMSS`, or `PREFIX-0001` sequential) in editable inputs; the backend
only enforces uniqueness. Batch numbers can be generated server-side (see `grn.py: _auto_batch_no`).

## Extending permissions
- New module → `MODULES`. New special right → `ACTIONS`. Both appear automatically in Accounts → Roles & Access (the screen reads
  `/accounts/modules`). Frontend: `can("module","edit")` and `canDo("action")` from `useAuth()`.
- Roles are data, not code: the owner creates "Storekeeper", "Accountant" etc. in the UI.
