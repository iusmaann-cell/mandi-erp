# Architecture

## The big picture
```
Browser (React SPA, hash routing "#/items")
   │  fetch() + header  Authorization: Bearer <signed token>
   ▼
FastAPI app  ──►  global dependency security.authorize  (every request, every route)
   │                 1. verify token  2. reload user from DB  3. map URL's first segment -> module
   │                 4. check role: GET needs "view", POST/PUT/PATCH/DELETE need "edit"
   ▼
Routers (one file per module)  ──►  SQLAlchemy models  ──►  SQLite (dev) / PostgreSQL (prod)
   │
   └─► uploads on a persistent disk (served only through an authenticated route)
```
No separate auth service, no Redis, no queue: one API process + one database + one disk. That is deliberate —
it is cheap to host and easy to reason about for a small business.

## Tech stack and versions (pinned — upgrade deliberately)
Backend: Python 3.11, FastAPI 0.115, SQLAlchemy 2.0, Pydantic 2, uvicorn, openpyxl, psycopg2-binary, python-multipart.
Frontend: React 19, Vite 8, Tailwind CSS v4 (CSS-first `@theme` tokens in `index.css`), Recharts (charts). No TypeScript, no router
library, no state library: React state + small context providers (`auth.jsx`, `nav.jsx`).

## Request flow in detail (security)
1. `POST /auth/login` → verifies PBKDF2-SHA256 password (240k iterations, per-user salt) → returns `{token, user}`.
   5 wrong passwords lock that username for 5 minutes (in memory). A dummy hash is verified for unknown usernames so timing
   doesn't reveal which usernames exist.
2. Token = `base64(json{u:userId, v:token_version, exp}).HMAC-SHA256`. Signing key = `SECRET_KEY` env var, or a random key
   stored once in table `auth_secret` (so sessions survive restarts with zero setup). Lifetime 7 days.
3. Every request re-loads the user: a deactivated user, a changed role, or a bumped `token_version` (password change/reset)
   takes effect immediately — that is why tokens are "stateless" yet revocable.
4. Roles hold JSON permissions: `{"modules": {"items": "view"|"edit"}, "actions": ["delete_items"]}`. A role with `is_admin=1`
   bypasses everything. Admin-only prefixes: `accounts`, `admin`.
5. Exceptions to plain module checks (all in `security.authorize`): *lookup prefixes* (any signed-in user may GET master
   data lists for dropdowns, but never `/balance` or `/ledger`), *READ_ALSO* (a screen's role may need read access to another
   module), `/settings` GET open to all (printing needs branding), `/uploads` needs a token (header or `?token=` for `<img>`),
   users flagged `must_change_password` can only reach `/auth/*`.
6. Files: `<img src>`/`<a href>` can't send headers, so the frontend `resolveFileUrl()` appends `?token=`.

## Data & migrations
- `Base.metadata.create_all` creates missing tables at startup; `run_lightweight_migrations()` then ADDs missing columns
  (and back-fills the model's scalar default into existing rows). It never renames, drops or retypes — by design.
- Same code on SQLite and Postgres: avoid DB-specific SQL; booleans are 0/1 integers; no Enum columns for new fields.
- Production data repairs: `one_time_cleanup.py` (dry-run first, JSON backup, single transaction, blank the variable after).

## Frontend structure
- `main.jsx` → `App.jsx` → `<AuthProvider>` → `Gate` (loading → LoginPage → ForcePasswordChange → `Shell`).
- `Shell` = sidebar (`components/Sidebar.jsx`) + top bar (page search, bell with `useAttention()` alerts, user chip) + the
  active page + phone bottom-nav with a quick-add sheet. The page is looked up in `PAGES` by the hash route; pages the role
  cannot open show a friendly message; "view" roles get a yellow view-only banner.
- Permissions on the client are for UX only (hide buttons); the server enforces everything.
- `api.js` is the only place that calls `fetch`; every endpoint is one line in the `api` object.
- Long-running state lives in pages; there is no global store. Cross-page "open the form" uses `navigate(page,{action:"new"})`
  + `useIntent(page, fn)`.

## Deployment shape (Railway, but any host works)
API service (Python, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`) + Postgres + a volume mounted at `UPLOADS_DIR`;
static frontend service (build `npm run build`, publish `dist`, SPA rewrite to `index.html`, env `VITE_API_URL`).
See `DEPLOY_RAILWAY.md`.
