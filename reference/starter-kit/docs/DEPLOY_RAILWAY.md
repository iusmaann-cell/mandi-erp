# Deploying (Railway; the same shape works on Render/Fly/any VPS)

## One-time setup
1. Put the project on GitHub (monorepo: `backend/` and `frontend/` folders). Branch `master` (or `main`).
2. Railway → **New Project** → add **PostgreSQL**.
3. Add a service from the repo for the **API**: *Root directory* `backend`, build: `pip install -r requirements.txt`
   (Nixpacks detects Python from `runtime.txt`), start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
   Variables: `DATABASE_URL` = reference to the Postgres service's connection string (use the *private* URL), `ADMIN_USERNAME`,
   `ADMIN_PASSWORD` (≥ 8 chars), `UPLOADS_DIR=/data/uploads`. Optional: `SECRET_KEY` (long random), `LOCAL_UTC_OFFSET_HOURS`, `APP_NAME`.
4. Attach a **Volume** to the API service, mount path `/data` — without a real volume, uploaded files vanish on every redeploy.
5. Generate a public domain for the API.
6. Add a second service from the same repo for the **frontend**: *Root directory* `frontend`, build `npm install && npm run build`,
   publish dir `dist`, SPA fallback (all paths → `index.html`). Variable `VITE_API_URL` = the API's public https URL (build-time!
   redeploy after changing it). Optional `VITE_UTC_OFFSET_HOURS`.
7. Open the frontend URL, sign in with the admin credentials, change the password, create roles and users in **Accounts**.

## Day-to-day
`git push` → Railway rebuilds and redeploys both services. Schema additions apply automatically at API start (migrator).
Backups: use the host's Postgres backups plus the `purge_backups` JSON files for data repairs; download uploads from the volume if needed.

## Go-live hardening checklist
- [ ] `allow_origins=["*"]` in `main.py` → your frontend origin only.
- [ ] `ENABLE_DOCS` unset (API docs hidden).
- [ ] Strong `ADMIN_PASSWORD`, then remove `ADMIN_PASSWORD`/`ADMIN_FORCE_RESET` variables once accounts exist.
- [ ] Volume mounted and `UPLOADS_DIR` points into it.
- [ ] `one_time_cleanup` variables blank (`PURGE_DRY_RUN=1`).
- [ ] Changed the `TOKEN_KEY` in `frontend/src/api.js` so two apps on one domain never share a login.

## Local development
See `START_HERE.md`. Frontend dev server on 5173, API on 8000 (CORS is open in dev). Mac users: install Homebrew, then
`brew install python@3.11 node git`.

## Reading logs when a data repair runs
Deploy logs show lines starting `[purge]`. Filter on `purge`; if nothing shows, use a time window around the deploy start (HTTP
traffic lines can push startup lines out of a "last N lines" view).
