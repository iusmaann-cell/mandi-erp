# Rules for working in this repository (read first)

This repo started from the ERP Starter Kit. Stack: FastAPI + SQLAlchemy (SQLite locally, PostgreSQL in
production) in `backend/`, React 19 + Vite + Tailwind v4 (no router library, no TypeScript) in `frontend/`.
Docs: `START_HERE.md`, `docs/*`. Proven patterns to copy: `reference/original-erp/` (see `docs/REFERENCE_MAP.md`).

## Non-negotiable conventions
1. **Security is central.** `security.authorize` is a global dependency on the whole app. A URL's FIRST segment
   must be listed in `security.MODULES` or non-admins get 403 (deny by default). Don't add per-route auth by hand;
   use `Depends(require_action("..."))` only for extra permissions.
2. **Database changes are additive only.** `database.run_lightweight_migrations()` adds MISSING columns at startup.
   Never rename/drop/retype a column on a live DB. New columns: plain Integer/String/Text/Float, nullable or with a
   scalar default (the migrator back-fills defaults). Flags are Integer 0/1. Avoid new Enum columns.
3. **Never delete history that other records reference.** Ledgers (stock, vendor, customer) are append-only; fix
   mistakes with a reversing entry. Master data is soft-deleted (`is_active = 0`) once referenced.
4. **Update schemas use `update.dict(exclude_unset=True)`** — and nested lists must be read from `update.<field>`,
   not from that dict (nested pydantic models become dicts => 500 => browser "Failed to fetch").
5. **Static routes before `/{id}` routes** in a router (e.g. `/report` before `/{item_id}`).
6. **Timestamps are naive UTC**; convert for display/range filters with `reporting.pkt_date/range_bounds` (backend) and
   `pktDay/pktToday` (frontend). Offset comes from `LOCAL_UTC_OFFSET_HOURS` / `VITE_UTC_OFFSET_HOURS`.
7. **Errors the user sees must be plain English** via `HTTPException(status_code=400, detail="...")`; the frontend
   `request()` helper turns `detail` into `Error.message`. Show it with `notify(...)` or inline.
8. **Production data fixes go through `one_time_cleanup.py`** (env-var driven, dry run by default, JSON backup,
   one transaction). Show the user the dry-run report and get an explicit "confirm" before applying. Blank the
   variables afterwards. Never run ad-hoc SQL against production.
9. **Every new screen/permission needs 4 registrations** — see `docs/BACKEND_GUIDE.md` "New module checklist".
10. Keep UI components from `components/ui.jsx`; keep the visual language (rounded pills, tokens in `index.css`).

## Smoke test (run after backend changes)
```bash
cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -q -r requirements.txt
DATABASE_URL=sqlite:////tmp/t.db UPLOADS_DIR=/tmp/tup ADMIN_USERNAME=admin ADMIN_PASSWORD=Admin12345 \
  uvicorn app.main:app --port 8781 &   # wait until `curl -s localhost:8781/` answers, then:
TOKEN=$(curl -s -XPOST localhost:8781/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"Admin12345"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s localhost:8781/items/ -H "authorization: Bearer $TOKEN"        # 200 + JSON
curl -s -o /dev/null -w "%{http_code}\n" localhost:8781/items/          # 401 without a token
fuser -k 8781/tcp                                                        # stop the server (don't use pkill -f)
```
Frontend: `cd frontend && npm install && npm run build` must pass. Local API URL defaults to `http://localhost:8000`
(`VITE_API_URL` overrides it).

## Working with the owner
He is a business owner, not a programmer: explain in plain words, give exact copy-paste terminal commands, show
before/after numbers for any data change, and ask for confirmation before anything destructive. When he asks for
a change that needs pushing to GitHub, hand over the whole updated project folder (zipped) plus a patch file.
