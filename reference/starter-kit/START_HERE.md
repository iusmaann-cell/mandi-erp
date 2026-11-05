# ERP Starter Kit — start here

A tested, reusable foundation extracted from a real, in-production ERP (an oil-mill business: purchasing,
stock, production, sales, finance, HR). It gives you a **working app on day one**: sign-in, roles and
permissions, an admin accounts screen, a responsive app shell (sidebar, search, notifications, phone nav),
a UI component library, Excel exports, file uploads, company/invoice settings, safe database upgrades, a
production-data-repair pattern, and deploy instructions — plus one example module to copy.

```
erp-starter-kit/
  START_HERE.md            <- you are here (incl. the prompt to paste into Claude)
  CLAUDE.md                <- short rules file; Claude Code reads it automatically
  backend/                 <- FastAPI + SQLAlchemy API (runs as-is)
  frontend/                <- React 19 + Vite + Tailwind v4 app (runs as-is)
  docs/                    <- ARCHITECTURE, BACKEND_GUIDE, FRONTEND_GUIDE, PATTERNS_AND_GOTCHAS,
                              DEPLOY_RAILWAY, REFERENCE_MAP
  reference/original-erp/  <- the FULL original source, read-only, to copy proven patterns from
```

## 1. Run it (5 minutes)

Needs Python 3.11+ and Node 20+ (see MAC_SETUP notes at the bottom if on a new Mac).

```bash
# Terminal 1 — API
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
ADMIN_USERNAME=admin ADMIN_PASSWORD=ChangeMe12345 uvicorn app.main:app --reload --port 8000

# Terminal 2 — web app
cd frontend
npm install
npm run dev            # opens http://localhost:5173
```

Sign in with `admin` / `ChangeMe12345`. The first admin account is created from those two environment
variables when the database has no users. Data lives in `backend/app.db` (SQLite) locally; set
`DATABASE_URL` to a Postgres URL in production (the same code runs on both).

## 2. The prompt to give Claude (copy everything inside the box)

> I'm starting a new project from my ERP Starter Kit (this folder). Before doing anything, read
> `CLAUDE.md`, then `docs/ARCHITECTURE.md`, `docs/BACKEND_GUIDE.md`, `docs/FRONTEND_GUIDE.md` and
> `docs/PATTERNS_AND_GOTCHAS.md`. `docs/REFERENCE_MAP.md` tells you which file in `reference/original-erp/`
> to copy when I need a feature the original ERP already solved (stock/FIFO ledger, vendor/customer
> ledgers, payments, purchase flow, production costing, payroll, Excel reports, print layouts...).
>
> **My new project:** *<describe the business, who uses it, the 5–10 things it must track, and the
> user roles — e.g. "a clothing wholesaler: suppliers, products with sizes, purchase orders, stock in two
> shops, sales invoices, customer credit; roles: owner, shop staff, accountant">*
>
> **How I want you to work:**
> 1. First propose the data model (tables + relationships) and the list of modules/screens, and wait for my OK.
> 2. Then build module by module, following the "new module checklist" in `docs/BACKEND_GUIDE.md`
>    (model → schema → router → register in `security.MODULES` + `main.py` → api.js → page → `permissions.js`
>    → `Sidebar.jsx` → `App.jsx`). Use `backend/app/routers/items.py` and `frontend/src/pages/Items.jsx` as the template.
> 3. Rebrand first: `frontend/src/brand.js`, colours in `frontend/src/index.css`, logo/icons in `frontend/public/`,
>    `APP_NAME` env var, token key in `frontend/src/api.js`, the default company name in `models.py`.
> 4. Test every backend change by running it locally (the smoke test in `CLAUDE.md`), and `npm run build` for the frontend.
> 5. Never edit or delete production data by hand — use the dry-run-first pattern in `backend/app/one_time_cleanup.py`.
> 6. Keep my instructions for the business rules in `docs/PROJECT_DECISIONS.md` (create it) so they survive across chats.
> 7. Explain things simply: I am not a programmer.

## 3. What is reusable vs. what is an example

| Part | Status | Where |
|---|---|---|
| Sign-in, sessions, password rules, lockout | Reusable as-is | `backend/app/security.py`, `routers/auth.py` |
| Users, roles, per-module view/edit permissions, extra "actions" | Reusable as-is | `routers/accounts.py`, `pages/Accounts.jsx` |
| Database setup + automatic column additions | Reusable as-is | `backend/app/database.py` |
| Excel report helpers (styled sheets, totals, local-time dates) | Reusable as-is | `backend/app/reporting.py` |
| File uploads on a persistent disk + authenticated download | Reusable as-is | `file_storage.py`, `main.py` |
| Company / invoice print settings (logo, colours, footer) | Reusable as-is | `routers/settings.py`, `pages/InvoiceSettings.jsx` |
| App shell: sidebar, phone nav, search, bell, view-only banner | Reusable as-is | `frontend/src/App.jsx`, `components/Sidebar.jsx`, `nav.jsx` |
| UI kit: Card, Button, Input, Select, Table (cards on phones), Modal, FormPanel, Badge, Stat, SearchSelect, confirm/toast | Reusable as-is | `components/ui.jsx`, `Dialogs.jsx` |
| Payment method sub-form (cash / cheque / online), bill photo picker | Reusable | `components/PaymentMethodFields.jsx`, `BillPhotoUpload.jsx` |
| Print-to-PDF report helper, document numbering | Reusable | `printReport.js`, `docNumbers.js` |
| Safe production data repair (dry run, backup, rollback) | Pattern + template | `backend/app/one_time_cleanup.py` |
| "Items" module | **Example — copy then delete/replace** | `routers/items.py`, `pages/Items.jsx` |
| Stock ledger, FIFO, vendor/customer ledgers, purchase→receive→pay, production costing, payroll | **In `reference/` only** — copy when your business needs them | see `docs/REFERENCE_MAP.md` |

## 4. New-Mac setup (if needed)
Install Homebrew, then `brew install python@3.11 node git`. Full step-by-step for a first-time Mac user is in
your `MAC_SETUP.md` (from the original project).
