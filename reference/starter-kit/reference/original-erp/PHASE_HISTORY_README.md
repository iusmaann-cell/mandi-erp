# Riwayat Oils and Fats ERP — Phase 1-8 + Improvement Phases 1-17: Procurement, Inventory, Production, Toll Processing, Packaging, Sales, Finance, HR & Payroll, BI Dashboards

## Important: database migrations

Starting this phase, the backend auto-detects and adds any new columns that earlier
phases' tables are missing (`run_lightweight_migrations()` in `database.py`, runs on
every startup). This matters because `create_all()` only creates brand-new tables —
it silently does NOT add new columns to tables that already exist on a live database
(like your Render Postgres instance). If Phase 3 was deployed before this fix, it's
possible some toll-related inserts were failing on the live site even though local
testing looked fine — this update should self-heal that on the next deploy. No action
needed on your end beyond redeploying; watch the Render logs on first boot for lines
like `[migration] Added missing column ...` confirming it ran.

## Improvement Phase 12 — Accounts, roles & sign-in (READ BEFORE DEPLOYING)

The whole system now requires sign-in. **Before (or right when) you deploy**, add these two variables to the
`tehzeeb-erp-api` service on Railway (Variables tab):

| Variable | Value |
|---|---|
| `ADMIN_USERNAME` | the login name you want, e.g. `usman` |
| `ADMIN_PASSWORD` | a strong password, at least 8 characters |

On startup, if no accounts exist yet, the first Administrator is created from these. After that, the variables are
ignored (changing them does not change the password). If you ever get locked out, set `ADMIN_FORCE_RESET=1` next to
those two variables, redeploy, sign in, then delete `ADMIN_FORCE_RESET`.

Optional: `SECRET_KEY` (any long random text) to sign sessions with your own key; without it the app generates and stores one itself.
`ENABLE_DOCS=1` turns the `/docs` API pages back on (off by default).

**Managing people:** Settings → Accounts.
- **Users** — create accounts, assign a role, reset passwords, disable (signs them out instantly) or delete. New/reset passwords are temporary by default: the person must choose their own at first sign-in.
- **Roles & Access** — build roles (Storekeeper, Accountant, …). For each section choose *No access / View only / View & edit*. Tick *Administrator* for full access. Special permission: *Approve stock adjustments*.
- **My Password** — anyone can change their own; this signs their other devices out.

**What is enforced (on the server, not just hidden in the menu):**
- Every request needs a valid session; view-only roles are blocked from any add/change/delete.
- Only Administrators can open Accounts or use the Danger Zone reset. The reset now keeps accounts and roles.
- Stock-adjustment approval needs the special permission, and the approver is recorded from the login (can't be typed in).
- Bill photos are no longer public URLs; they need a signed-in session.
- 5 wrong passwords locks that username for 5 minutes. The last active Administrator can't be deleted, disabled or demoted.
- Basic lists (vendors, items, warehouses, customers, distributors, recipes) are readable by any signed-in user so dropdowns work; balances and ledgers stay behind their own section. Some screens can read the data they need from a neighbouring section (e.g. Goods Received reads Purchase Orders).

**Known limits:** sessions last 7 days; the sign-in throttle resets when the server restarts; who *created* each record isn't tracked yet (only stock-adjustment approvals record a user).

## Improvement Phase 13 — Stock transfers between warehouses and tanks

New page: Procurement → **Stock Transfers**. Pick the item, the source and destination warehouse/tank, the quantity, and (optionally) a specific batch.
- Oldest batch leaves first (FIFO), splitting across batches as needed; or pin one batch.
- The same batches arrive at the destination with their **batch number and cost rate unchanged**, and keep their **original age**, so later FIFO consumption and costing stay correct. Total stock is conserved — every transfer posts matching OUT and IN ledger entries.
- **Toll customers' material** can be transferred too (choose "Toll: <customer>" under *Whose stock*); it stays that customer's. Our own stock can't be moved into a "toll customer stock" area.
- If the destination has a **capacity** set (Warehouses page), a transfer that would overflow it is refused with the remaining room shown.
- Transfers can't be edited or deleted (append-only ledger) — record a transfer back to correct a mistake. Each transfer records who made it.
- **Access:** new permission "Stock Transfers" in Settings → Accounts → Roles. Existing roles don't have it until you tick it (Admins always do). Having it also lets that role read Stock levels, which the form needs.

## Improvement Phase 17 — Edit / delete payroll runs, batch numbers with item name

- **Batch numbers** (Phase 16 rule, refined): `BATCH-<d><mm><yy>-<ITEMNAME>-<n>`, e.g. `BATCH-41026-VITAMINA-3`.
- **Payroll runs can be edited and deleted.**
  - *Draft* runs: Edit (run number, period, notes, optional "recalculate from attendance" — changing the period recalculates every payslip and keeps allowances/deductions already typed) and Delete, from the runs list or the run page. Anyone with Payroll edit access.
  - *Finalized* runs: editing reopens the run to draft (the salary expenses it posted are removed until it is finalized again); deleting also removes those expenses so reports stay correct. These two need the new role permission **"Reopen or delete finalized payroll runs"** (administrators always have it).
  - Salary expenses posted from now on carry the payroll run's id (`expenses.payroll_run_id`); runs finalized earlier are matched by their description.

## Improvement Phase 16 — Receiving, batches, freight, advances, PO delete permission

- **Goods Received** now shows each item's name (with code, unit, ordered / remaining quantity) above the quantity box.
- **Automatic batch numbers**: `BATCH-<d><mm><yy>-<ITEMNAME>-<n>` in Pakistan time (item name in capitals, no spaces), where `n` is that item's running batch count — e.g. the 3rd batch of Vitamin A on 4 Oct 2026 is `BATCH-41026-VITAMINA-3`. The box is pre-filled and can be edited; if left blank the server fills it in.
- **Freight charges** (optional) when receiving. Stored on the GRN and on the PO (`freight_charges`), shown on its own line ("Goods Rs. X + Freight Rs. Y"), posted as a separate `GRN_FREIGHT` debit on the vendor's ledger and as its own column in the PO Excel report. Goods value and the GRN bill entry are unchanged.
- **Advance payment** when creating a PO (cash / cheque / online). Posted as a `PO_ADVANCE` credit on the vendor ledger; "Mark paid" then asks only for the balance (goods + freight − paid). A PO fully covered by its advance is marked paid straight away. If freight is added after a PO was marked paid, it goes back to unpaid for the freight balance.
- **Deleting a purchase order** now needs the new role permission **"Delete purchase orders"** (Settings → Accounts → roles). Administrators always have it; other roles do not until it is ticked. The delete button is hidden for everyone else, and the server refuses the request too. Deleting a PO also removes its advance/payment postings from the vendor ledger.

## Improvement Phase 15 — Full UI redesign ("Riwayat Oils and Fats")

The whole interface was redesigned (mockups approved first, then built). No backend behaviour changed.

- **Brand**: the app is now *Riwayat Oils and Fats*. Logo-derived palette (forest, brand green, gold, ivory), Plus Jakarta Sans, pill-shaped inputs and buttons, rounded cards. Colour tokens live in `frontend/src/index.css` (`@theme`).
- **Shell**: framed desktop layout with a forest sidebar; slim icon rail on tablets; slide-in drawer + green header + bottom bar (Home / Stock / gold **+** quick-add / Analytics / More) on phones. Top bar has page search and a notifications bell.
- **Routing**: pages now have addresses (`#/purchase-orders`), so refresh and the browser Back button work.
- **Needs your attention** (bell + Dashboard): stock adjustments awaiting approval, unpaid purchase orders, items below reorder level, tanks 90%+ full — only for modules the person's role can open.
- **Sign-in / choose-password** screens redesigned (two-panel on desktop, bottom sheet on phones).
- **Dashboard**: greeting, Sales / Expenses / We owe vendors / Owed to us, quick-add pills, sales-vs-expenses chart, tank rings, latest POs. **Analytics** (was BI Dashboards) restyled with a KPI row.
- **Forms** open as a slide-over panel (bottom sheet on phones) instead of pushing the page down. Tables become cards on phones.
- **Dialogs**: browser `confirm()` / `alert()` pop-ups replaced by styled confirm dialogs and toasts (`components/Dialogs.jsx`).
- **Rename**: UI text, API title, Excel report headings. The default invoice company name "Tehzeeb" is migrated to "Riwayat Oils and Fats" on startup (custom names are left alone). The login token key is now `riwayat_token`; existing sessions carry over. `render.yaml` service names and the SQLite filename were intentionally not renamed.

## Improvement Phase 14 — Back-dated expenses and Excel reports

- **Back-dated expenses (administrators only).** On Finance → Expenses, administrators get an *Expense date* field on the form (default today, can't be in the future) and can also change the date when editing. Everyone else's expenses are always dated today, and the server refuses any attempt to enter or change one to a past date.
- **Expense report.** Finance → Expenses: pick a From and To date, then **Download Excel Report**. One line per expense (date, category, cost centre, description, notes, how it was paid with cheque/bank details, amount), a **total after every day**, and a **gross total** at the end.
- **Purchase order report.** Procurement → Purchase Orders: pick From/To, then **Download Excel Report** (POs are picked by their PO date). Three sheets: *Purchase Orders* (items described, PO amount, amount paid, balance due, and every payment listed with method/cheque/bank details; daily totals and gross total), *Payments* (one row per payment, totalled by the day it was paid, with a gross total), and *PO Line Items* (qty × rate per item, with daily and gross totals). Cancelled POs are left out and named in a note.
- Days are Pakistan-time calendar days everywhere (screen and Excel). Access: anyone with View on Expenses / Purchase Orders can download that report.

## What's built so far

**Phase 1 — Procurement + Inventory**
- Vendors (with running ledger balance, not a static field)
- Units of Measure
- Items (crude oil, chemicals, packaging, finished goods)
- Warehouses (tanks, stores, finished goods, and a dedicated **toll customer stock** type)
- Purchase Orders
- GRN (Goods Received Note) — receiving a GRN automatically:
  - adds stock to the correct warehouse/batch
  - posts a debit to the vendor ledger
  - updates the PO's received quantity and status
- Stock balance report (batch-wise, with toll stock clearly separated)
- **Edit/delete** across vendors, items, warehouses, purchase orders (soft-delete;
  purchase orders that already have a GRN against them can only be cancelled, not
  deleted, since stock and ledger entries depend on them)

**Phase 2 — Production (refining, hydrogenation, soap)**
- BOMs/recipes — expected input→output ratios per plant, used as a reference template
- Production Orders — the actual batch run:
  - consumes real stock **automatically via FIFO** (oldest batch first, split across
    as many batches as needed) — no manual batch math required, though a specific
    batch can still be pinned when needed (e.g. QC hold on another batch)
  - produces new stock batch(es) as output — a primary product plus optional byproducts
  - **costing**: byproducts are valued at their entered recovery rate first; the
    *remaining* input cost is allocated to the primary product per unit — so scrap
    value never distorts your actual product cost
  - tracks yield % automatically (primary output ÷ input, per batch) for efficiency reporting

**Phase 3 — Toll / Job-Work Processing**
- **Customers** — separate from vendors; money flows the opposite direction (they
  owe you a processing fee, not the other way around)
- **Toll Intake** — customer material arriving at the mill, tagged to that specific
  customer, no cost/vendor ledger impact since you never own it
- **Toll Production Orders** — reuses the Phase 2 production engine, but every batch
  is tagged to one customer. The stock ledger tracks *which customer* owns toll
  stock, not just "is it toll stock" — so two customers' material sitting in the
  same tank is never mixed or cross-consumed. FIFO consumption for a toll order only
  ever draws from that customer's own batches, and posts zero cost to your own
  books. Toggle "Own production" vs "Toll processing for a customer" right in the
  Production Orders form.
- **Toll Delivery** — dispatch processed goods back to the customer, FIFO by default
  from that customer's stock only
- **Commission Invoices** — the actual revenue event: charge a fee (quantity × rate,
  or a flat amount) for the processing service, posted to a customer ledger
  separate from the vendor ledger

**Phase 4 — Packaging**
- No new module needed — packaging IS a production order (bulk product + packaging
  materials in, packed SKU out), so it reuses the exact same engine from Phase 2/3.
  "Packaging" is now a selectable plant everywhere BOMs and Production Orders appear.
- **Mixed-ownership toll packaging** — the one genuinely new piece of logic: packing
  a toll customer's oil into *your own* bottles means one order now spans two
  different owners at once. Each input line can be marked "our own" (defaults to
  the customer's stock otherwise), so:
  - The customer's oil costs nothing to your books (as with any toll order)
  - Your bottles/caps/labels are costed at their real rate, tracked as "our
    material cost" on the order — this is what you'd bill the customer for
    materials, on top of your processing commission
  - The packed output still belongs entirely to the customer as toll stock
- **Item pack size fields** — optional `pack_size` (e.g. "5L", "1kg") and
  `units_per_case` on items, for defining SKUs clearly (e.g. "Riwayat Cooking Oil
  5L" vs. the bulk "Refined Oil" it's packed from)
- Note: the "yield %" metric on a packaging order isn't very meaningful (it divides
  output by the sum of bulk product + packaging material quantities, which are
  different units) — it's fine to ignore that field specifically for packaging runs;
  it's still accurate for refining/hydrogenation/soap batches.

## Running it locally

```bash
cd backend
pip install -r requirements.txt --break-system-packages
uvicorn app.main:app --reload
```

Then open **http://localhost:8000/docs** — FastAPI auto-generates an interactive UI
where you can test every endpoint without writing any frontend code yet.

By default it uses a local SQLite file (`tehzeeb_erp.db`) so you don't need to install
Postgres to try it out. When you're ready to deploy, set the `DATABASE_URL` environment
variable to your Postgres connection string and nothing else changes.

## Frontend

A React dashboard is included so you (or your store clerk) don't need to use `/docs`
directly. Covers: Dashboard, Vendors, Items, Warehouses, Purchase Orders, Goods
Received (GRN), Stock Balance (owned vs. toll-customer stock, attributed to the
specific customer), BOMs/Recipes, Production Orders (own or toll, with a toggle),
Toll Customers, Toll Intake, Toll Delivery, and Commission Invoices.

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. It talks to the backend at `http://localhost:8000` by
default — make sure the backend (above) is running first. To point it at a different
backend URL (e.g. after deploying), create a `frontend/.env` file:

```
VITE_API_URL=https://your-deployed-backend-url.com
```

## Deploying to Render (cloud)

A `render.yaml` Blueprint is included at the project root — it defines the API service,
the frontend static site, and a free Postgres database in one file, so Render sets up
all three together instead of you configuring each by hand.

1. **Push this project to a GitHub repo** (create a new repo on GitHub, then from this
   folder: `git init && git add . && git commit -m "Tehzeeb ERP Phase 1" && git remote add origin <your-repo-url> && git push -u origin main`)
2. Go to **render.com** → sign in → **New +** → **Blueprint**
3. Connect the GitHub repo you just pushed
4. Render reads `render.yaml` automatically and shows you 3 resources to create:
   `tehzeeb-erp-api`, `tehzeeb-erp-frontend`, `tehzeeb-erp-db` — click **Apply**
5. First deploy takes a few minutes. Once done:
   - Your API is live at `https://tehzeeb-erp-api.onrender.com`
   - Your app is live at `https://tehzeeb-erp-frontend.onrender.com`
6. **Verify the frontend can reach the API** — open the frontend URL, check the Dashboard
   loads without errors. If it doesn't, go to the frontend service → Environment →
   confirm `VITE_API_URL` exactly matches your actual API URL from step 5, then
   **Manual Deploy → Clear build cache & deploy** (Vite bakes this in at build time,
   so just changing the env var isn't enough — it needs a rebuild).
7. **Tighten security before real use**: in `backend/app/main.py`, change
   `allow_origins=["*"]` to `allow_origins=["https://tehzeeb-erp-frontend.onrender.com"]`
   so only your frontend can call the API.

Note: Render's free tier spins down after 15 minutes of inactivity and takes ~30-60
seconds to wake up on the next request — fine for testing, worth upgrading to a paid
instance ($7/mo+) before you rely on this daily at the mill.

### Troubleshooting: build fails on `pydantic-core` / Rust/cargo error
Render sometimes defaults to a very new Python version that doesn't have prebuilt
wheels for some dependencies yet, causing pip to try compiling from source — which
fails in Render's build sandbox. Fixed by pinning Python to 3.11 via `backend/runtime.txt`
and the `PYTHON_VERSION` env var in `render.yaml` (both already included). If you pulled
this project before that fix, just `git pull`, commit, and push again to redeploy.

## Next steps (in order)
1. **Deploy the update** — commit, push (to whichever branch your Railway
   service actually watches).
2. **You test it**:
   - Add a vendor with a couple of items they supply and a couple of bank
     accounts, then search for them by an item name instead of their own name.
   - Mark a purchase order paid using more than one payment method (e.g. part
     cash, part into one of the vendor's saved bank accounts, part into
     another) — confirm the running "allocated / remaining" total in the modal
     keeps you honest, and that it won't let you confirm until the splits add
     up exactly.
   - Click into that vendor's ledger afterward and confirm each split shows up
     as its own line with the right payment method/account — that's the "check
     later how it was paid" record.
   - Try the same split-payment flow on a Commission Invoice and a Sales
     Invoice.
3. **What's left on the original roadmap**: QC workflows (lab tests, hold/release)
   is the one remaining lower-priority item, and Employee Accounts/login remains
   the natural next larger phase (see the note at the end of Improvement Phase 6).

## Improvement Phase 11 — Vendor Items & Bank Accounts, Split Payments

- **Vendors can now be linked to the items they supply** (optional, many
  items per vendor) — shown as tags on the vendor list, and searchable: typing
  an item name in the vendor search box finds every vendor who supplies it.
- **Vendors can have multiple registered bank accounts** (bank name, account
  title, account number). Editing a vendor's account list is safe by the same
  soft-delete convention used everywhere else in the app — removing an account
  from the list doesn't erase it if a past payment already references it, it
  just stops offering it for new payments.
- **Split payments** — marking a Purchase Order, Commission Invoice, or Sales
  Invoice paid no longer forces a single payment method. Add as many payment
  lines as needed (cash, a cheque, a specific bank transfer), each with its own
  amount; a running "Rs. X allocated of Rs. Y" indicator keeps you from
  confirming until the splits add up to the full amount exactly — this isn't a
  partial-payment feature, just multiple methods covering one full payment.
  For vendor (purchase order) payments specifically, an online-transfer split
  can be attributed to one of the vendor's saved bank accounts by name instead
  of typing the bank details in by hand each time.
  - Every split is stored as its own ledger entry, so a vendor/customer/
    distributor's ledger shows exactly how a payment was actually split —
    e.g. Rs. 5,000,000 cash + Rs. 3,000,000 into "HBL — 1111-2222-3333" +
    Rs. 7,000,000 into "UBL — 4444-5555-6666" for one PO, each fully visible
    and auditable later, not collapsed into one opaque total.
  - Marking something back to unpaid reverses every split that made up that
    payment, not just one — toggling back and forth never leaves stray entries.

## Improvement Phase 10 — Bill Photos Moved to Railway Storage; Camera/Gallery Fix

- **Bill photos (GRN and expense receipts) now save directly to a persistent
  volume on the Railway backend service**, instead of Google Drive. This was a
  deliberate call when the app was still on Render (whose free-tier disk is
  wiped on every redeploy — unsafe for compulsory audit records), but now that
  we're on Railway, a real persistent volume is available the same way Postgres
  already uses one, so the external dependency is no longer needed. One less
  thing to configure (no more Drive service accounts, OAuth tokens, or "Drive
  API not enabled" errors), and one less point of failure.
  - Set up on Railway: a volume named `api-uploads` is mounted at `/data` on
    the backend service, with `UPLOADS_DIR=/data/uploads` telling the app where
    to write. Already provisioned and confirmed healthy — nothing further to do
    unless you're setting this up on a fresh Railway project later, in which
    case repeat those two steps (create a volume, mount it, set the env var).
  - Old bill photos already stored on Google Drive from before this change
    keep working exactly as before — their links still point to Drive and still
    open normally. Only new uploads go to the new location.
  - `google_drive.py`, `google-api-python-client`, and `google-auth` have been
    removed from the codebase entirely, since nothing uses them anymore.
- **Fixed the camera-only bug**: the bill photo picker had a `capture`
  attribute that forces mobile browsers straight into the camera app, skipping
  the normal system chooser that offers both "Take Photo" and "Choose from
  Library." Removed — you now get the standard picker with both options, on
  both GRN receiving and expense logging.

## Bugfix — deleted items/units blocked reuse of their name, code, or symbol

Soft-delete (used everywhere in this app so deleting something doesn't break
historical records that reference it) had a real gap: the deleted row kept its
original name/code/symbol, and the database's uniqueness rule doesn't know or
care that a row is "deleted" — so trying to create a new item or unit with the
same identifying value failed with a confusing "already exists" error, even
right after deleting the very thing you were trying to replace.

Fixed two ways:
- **Going forward**: deleting an item or unit now also renames its identifying
  field (code for items; name and symbol for units) on the now-inactive row, so
  the original value is immediately free for reuse.
- **For anything deleted before this fix**: a **"Purge Deleted Items"** /
  **"Purge Deleted Units"** button on the Items page permanently removes
  inactive rows that nothing still references — checked dynamically against
  every table in the schema with a foreign key to items/units (not a hardcoded
  list), so it's safe to run even as the schema grows in later phases. Anything
  still actually referenced (by stock, a purchase order, a BOM, etc.) is left
  alone and reported rather than deleted.

## Improvement Phase 9 — Units of Measure: Full CRUD & Bulk Upload

- Units of measure (previously create-only, with no way to see, edit, or remove
  what you'd added) now have a proper management view — click "Manage Units" on
  the Items page for a table of every unit with Edit and Delete actions.
- **Delete is a soft-delete**, same convention as items/vendors/customers
  elsewhere in the app — a removed unit disappears from selection dropdowns for
  new items, but any existing item that already uses it keeps working normally,
  since the underlying record isn't actually erased.
- **Bulk upload** for units, matching the same pattern as item bulk upload:
  download an .xlsx template (name, symbol columns), fill it in, upload it back.
  Either every row in the file succeeds or none do — a duplicate or blank row
  can't leave you with a half-finished import.

## A note on deployment: verify your Git branch matches what your host watches

If a push doesn't trigger an auto-redeploy, check two things before assuming
something's broken:
- **Branch match** — run `git branch` locally and compare against what your
  hosting service (Render/Railway) is configured to deploy from. A mismatch here
  (e.g. pushing to `main` while the host watches `master`) means your pushes
  silently never trigger anything.
- **Webhook health** — even with a matching branch, the GitHub↔host connection
  can occasionally stop firing (this happened once during this project's Railway
  setup). If deployments stay stale despite `git log -1` showing your commit is
  genuinely on the right branch and remote, reconnecting the service to the repo
  (same repo, same branch) from the host's dashboard re-establishes the webhook.

## Improvement Phase 8 — Expenses: Date Filter & Receipt Preview

- **Date range filter** on the Expenses list, same pattern used elsewhere in the
  app (from/to date pickers, clear-filter button).
- **Receipt preview** — a "Preview" button next to each expense's bill photo now
  opens it inline in a modal (using Google Drive's embeddable-thumbnail endpoint)
  instead of always having to open Google Drive in a new tab. An "Open" link is
  still there alongside it for viewing the original file directly in Drive if the
  inline preview doesn't render for some file type.

## Improvement Phase 7 — Mobile Responsiveness

- **Sidebar navigation** is now a slide-in drawer on phones/narrow screens (below
  Tailwind's `md` breakpoint, 768px) — a hamburger button in a new mobile header
  bar opens it as an overlay with a dismissible backdrop, and tapping any nav item
  closes it automatically. On tablets/desktops it behaves exactly as before
  (always visible, no behavior change).
- **Forms** — every 2- and 3-column form grid across the app (vendor/item/PO
  details, stat card grids, etc.) now stacks to a single column on phones,
  widening to its normal multi-column layout from `sm` (640px) up.
- **Line-item editors** — the more complex rows (PO lines, GRN lines, production
  order inputs/outputs, sales order/dispatch lines, toll intake/delivery lines)

  used fixed multi-column layouts with up to 8 fields crammed side-by-side. These
  now stack to one field per line on phones and only switch to the packed desktop
  layout from `sm` up, so filling one in on a phone means scrolling down through
  clearly separated fields instead of squinting at squeezed columns.
- **Page padding and headers** shrink appropriately on small screens rather than
  wasting phone screen space on desktop-sized margins.
- Tables already scrolled horizontally on overflow from early on — unchanged, just
  confirmed still correct alongside everything else.
- Also fixed a small bug found while making these changes: Stock Adjustments was
  accidentally listed twice in the sidebar.

## Improvement Phase 6 — Recipe-Driven Production, Stock Adjustments, Loss Tracking

This phase came out of a detailed walkthrough of the real production workflow
(crude → refining → tank → packaging → dispatch) and the specific pain points in
it — worth reading the reasoning here since it explains *why* things work the way
they do, not just what changed.

- **Recipe-driven auto-calculation for production orders** — previously, BOMs/
  recipes were reference-only; you still typed every input and output quantity by
  hand even with a recipe attached. Now: pick a recipe, enter how much you want to
  produce (e.g. "100 cartons"), click "Auto-fill from Recipe," and every input and
  output line gets pre-filled by scaling the recipe's ratios — still fully editable
  afterward if the actual batch needs a tweak. This directly targets the "manually
  calculating how much oil a packaging run needs" problem.
- **Stock Adjustments** (Inventory → Stock Adjustments) — a proper way to correct
  the book quantity of your own stock (never toll customers' material) against a
  physical check, e.g. a tank dip reading disagrees with what production orders
  say should be there. This exists because Tank 1's contents can't be measured
  precisely, which means two numbers in the refining→packaging workflow are
  always estimates — small errors were guaranteed to compound over time with no
  way to correct them. Every adjustment requires a reason comment and posts to
  the stock ledger immediately (an increase creates a new batch with a value you
  specify; a decrease FIFO-consumes existing batches). There's a pending/approved
  status for audit review, but **it isn't access-controlled** — there's no login
  system yet to restrict who can click "Approve," so treat it as a paper trail for
  now, not a real permission gate. Deliberately no delete/edit on adjustments
  once created — a mistake gets corrected with an offsetting adjustment, not
  erased, so the audit trail stays honest.
- **Loss vs. byproduct distinction** — production order outputs now have a third
  option alongside Primary and Byproduct: **Loss**. A byproduct (like sediment)
  has real recovery value entered as a rate; loss (evaporation, spillage) has
  none and creates no stock — it exists purely so shrinkage shows up as a
  labeled, visible line in the batch record instead of being an invisible gap
  only inferable from input-minus-output math.
- **Density field on items** (optional, e.g. 0.92 kg/L for most vegetable oils) —
  shown as a small cross-check calculator next to quantity fields in production
  orders when relevant. This is informational only and never silently converts
  or overwrites a number you typed — the actual conversion between what crude oil
  is weighed in (kg/MT) and what packaging is measured in (liters) still needs a
  human decision, this just saves you doing the multiplication by hand.
- **Known limitation worth being upfront about**: your description of Step 3
  (one packaging run producing tins, pouches, *and* cartons of bottles all at
  once) will still be rejected — that's the same mixed-SKU safeguard from an
  earlier phase, kept intentionally because averaging different SKUs' costs
  together would be wrong. You'll need one production order per finished SKU per
  packaging campaign; the new auto-calculation above at least makes each of
  those quick to fill in.
- **Next natural phase: Employee Accounts.** The pending/approved status on
  stock adjustments is built to slot into real role-based access — once accounts
  exist, restricting "Approve" to admin users is a small addition on top of what's
  here already, rather than something retrofitted insecurely now.

## Improvement Phase 5 — Dashboard Date Filter & Compulsory Bill Photos

- **Dashboard date range filter** — every transactional figure (open POs, GRNs,
  production batches, average yield, revenue, open sales orders, net profit) now
  reflects a selectable date range (quick buttons for 7d/30d/1y, or pick custom
  dates). Balances owed (AP/AR) stay as **current** figures regardless of the
  range, since a balance is a point-in-time snapshot, not something that happened
  "within" a period — this is labeled clearly on each card so it's never
  ambiguous which figures move with the date picker and which don't.
- **Compulsory bill photos on GRN and Expense creation**, stored in **Google
  Drive** rather than local disk or the database. This was a deliberate call,
  not a default — see the reasoning in `backend/app/google_drive.py` and the
  setup steps above. Short version: Render's free-tier disk is wiped on every
  redeploy (unsafe for compulsory audit records), and the database isn't a good
  place to store a fast-growing library of photos. Drive is external to both,
  free at a scale that covers years of bill photos, and needs zero changes when
  you eventually move hosting to Oracle Cloud.
  - Both GRN and Expense creation now reject the request outright if no photo is
    attached, or if the file isn't a recognized image type (JPEG/PNG/WEBP/HEIC),
    or if it's over 5MB.
  - Editing an existing expense does **not** require re-uploading a photo — the
    requirement only applies at creation.
  - Each GRN and expense in its list shows a "View" link that opens the photo
    directly from Google Drive.
- **Important**: until the Google Drive environment variables above are set on
  Render, every attempt to create a GRN or expense will fail with an explicit
  "Google Drive isn't configured" error. That's intentional — better a clear
  failure than a silently missing bill photo.

## Improvement Phase 4 — Payment Tracking, Ledgers, Printable Invoices, Invoice Settings

This is the largest single update so far — it touches Procurement, Toll, Sales, and
Finance all at once, so test it thoroughly before relying on it for real bookkeeping.

- **Payment status + method, everywhere money changes hands**: Purchase Orders,
  Commission Invoices, and Sales Invoices can each be marked paid/unpaid from their
  list view. Marking paid asks for a payment method:
  - **Cash** — no extra detail needed
  - **Cheque** — cheque number + bank (plus a depositing bank field for money
    coming *in*, i.e. commission/sales payments)
  - **Online transfer** — the other party's name and bank, plus your own bank
  Marking paid posts a real ledger entry (a credit) with that detail attached;
  toggling back to unpaid removes that exact entry, so the ledger never drifts.
- **Vendor / Toll Customer / Distributor ledgers**: click any name in those three
  lists to drill into their full ledger — every bill and payment, with the payment
  method detail shown per entry, filterable by date range, with a running balance
  computed as of the end of that range.
- **Printable invoices**: Commission Invoices and Sales Invoices each have a Print
  button that opens a formatted, print-ready version (via the browser's print
  dialog) — company header, logo, line items, totals, and a paid/unpaid stamp.
- **Invoice Settings** (Settings → Invoice Printing): upload a logo (PNG/JPG, under
  2MB, stored directly in the database so it survives redeploys), set its printed
  size in mm, company name/address/phone/email/NTN, an accent color, and footer
  text — all of it applied automatically to every printed invoice.
- **Expenses** now also record a payment method (same cash/cheque/online options,
  phrased for money going *out*).
- Scope note: this phase does not yet support **partial payments** — an invoice or
  PO is either fully paid or fully unpaid. If you need to record a partial payment
  against a bill, let me know and that can be a fast follow-up.

## Improvement Phase 3 — Sales-Side Auto-Numbering & Search

- **Distributors** got a new `distributor_number` field (didn't exist before, same
  pattern as Toll Customers in Phase 2) with its own uniqueness check, plus search
  across number, name, contact, phone, city, and address.
- **Auto-generated numbers**, still fully editable: Sales Orders (`SO-YYMMDD-HHMMSS`),
  Dispatch (`DO-YYMMDD-HHMMSS`), Sales Invoices (`SINV-YYMMDD-HHMMSS`) — same
  date+time-to-the-second format as Improvement Phase 2, for the same
  collision-avoidance reason.
- **Search + filters added** to Sales Orders (SO #/date/distributor search, plus
  status, distributor, and date-range filters) and Dispatch (DO #/SO #/vehicle/date
  search, plus date-range filter — the dispatch list now also shows which SO each
  one belongs to, which it didn't display before).

## Improvement Phase 2 — Auto-Numbering & More Search

- **Auto-generated document numbers**, all still fully editable: Purchase Orders,
  GRN, Production Orders, Toll Intake, and Toll Delivery use
  `PREFIX-YYMMDD-HHMMSS` (date and time down to the second, so two documents
  created close together never collide) — e.g. `PO-260820-143512`. Toll Customers
  use a simple sequential number instead (`CUST-0001`, `CUST-0002`, ...) since
  there's no meaningful "date" for a customer record. Commission Invoices use
  `TINV-YYMMDD-HHMMSS`.
  - Note: this replaced a straightforward reading of the format you gave
    (`PO-20826-0315`) — that's one digit short for a full date, so I went with a
    complete, collision-safe date+time encoding instead. Since the field is
    editable, you can always type your own format when creating a record.
- **Toll Customers** got a new `customer_number` field (didn't exist before) with
  its own uniqueness check, plus search across number, name, contact, phone, and
  address.
- **Search + filters added** to Production Orders (order # or date, plus plant,
  own/toll, and date-range filters), Toll Intake (intake #/customer/vehicle, date
  range), Toll Delivery (delivery #/customer/vehicle, date range), and Commission
  Invoices (invoice #/customer/notes, date range).

## Improvement Phase 1 — Navigation & Search UX

- **Collapsible sidebar sections** — each section (Procurement, Production, Toll,
  Sales, Finance, HR & Payroll) now expands/collapses, and auto-opens the section
  containing whichever page you're on. Fixes the sidebar getting unwieldy as more
  phases were added.
- **Vendors** — search by name or phone, plus a balance filter (all / owing / settled).
- **Items** — search by name or code, filter by type and unit, and a **bulk upload**
  flow: download an .xlsx template (with a reference sheet of valid units and item
  types built in), fill it in, upload it back. Either the whole file succeeds or
  none of it does — a typo in one row can't leave you with a half-finished import.
- **Purchase Orders** — search by PO number or vendor name, filter by status, and a
  date range filter on order date.
- **Stock** — now warehouse-first: a card per warehouse showing item/batch counts
  and owned stock value, click through to see that warehouse's full stock list.
  Plus a dedicated search that finds stock by **GRN number, toll intake number,
  toll customer name, or batch number** — useful when you know a reference number
  but not which warehouse or item it ended up in.

## Phase 8 — BI Dashboards

- **Revenue & Net Profit Trend** — stacked sales + commission revenue, expenses, and
  a net profit line, by month. The one chart that answers "is the business actually
  improving," not just a single period's snapshot.
- **Sales by Distributor** — revenue concentration over the last 90 days, so you can
  see how dependent the business is on any one buyer.
- **Expense Breakdown** — by category, over the last 90 days.
- **Production Yield Trend** — average yield % by month, filterable per plant, for
  spotting whether a plant's process is drifting over time rather than just looking
  at one batch at a time.
- **Inventory Value by Type** — how much capital is currently tied up in crude oil
  vs. packaging materials vs. finished goods.
- All of this is computed from the same underlying data as the Phase 6 Reports —
  this page is a different (visual, trend-oriented) lens on it, not a separate
  source of truth.

## Phase 7 — HR & Payroll

- **Employees** — permanent, contract, or daily-wage, with an optional plant
  assignment for cost-center attribution (unassigned = general/admin).
- **Attendance** — mark present/absent/leave/half-day per employee per day, plus
  overtime hours. A day-view grid, one page per date, upserts if you correct a mark.
- **Payroll runs** — pick a period, and it computes a draft payslip per employee
  straight from their attendance in that period:
  - Salaried (permanent/contract): full monthly salary minus a per-day deduction
    for unpaid absence (a 30-day month convention); leave is paid, a half-day
    counts as half an unpaid absence.
  - Daily-wage: paid only for days actually worked (present + half of half-days);
    absence and leave are unpaid, matching typical mill practice.
  - Overtime hours × the employee's overtime rate, on top of either.
  - Allowances and deductions are editable per payslip before finalizing.
- **Finalizing** locks the run and posts the total net pay straight to Phase 6's
  Expenses — split into one entry per plant (cost center) plus one for
  general/admin — so payroll cost flows into P&L automatically, no manual re-entry.

## Phase 6 — Finance & Compliance

**Important scope note**: this is a reporting layer computed from the existing
sub-ledgers (vendor/customer/distributor ledgers, stock costing, sales/commission
invoices) — not a formal double-entry general ledger with a chart of accounts. That's
a much bigger undertaking and, honestly, more than a single mill's ERP needs at this
stage. The numbers below are accurate rollups of your real transactions, but they are
not a substitute for an accountant preparing statutory financial statements or an
FBR sales tax return — treat them as an operational dashboard, not filed accounts.

- **Expenses** — log overhead costs (salaries, utilities, rent, maintenance,
  transport, fuel, admin) with an optional plant/cost-center tag, so P&L reflects
  real profitability, not just gross margin on goods sold.
- **P&L** — for any date range: sales revenue + commission revenue − COGS = gross
  profit; minus expenses = net profit. COGS is pulled directly from the cost basis
  recorded at dispatch time (`cogs_rate`), which itself traces back through
  production costing to the original purchase cost — so it's a real number, not an
  estimate.
- **P&L by SKU** — revenue, COGS, and margin % per product, more useful than
  plant-wise since one SKU (e.g. a packed bottle) passes through more than one plant.
- **AP/AR Aging** — separately for vendors (what you owe), distributors (what they
  owe you), and toll customers (what they owe you). Uses a simplified but standard
  approach: payments are applied against the oldest bills first, then whatever's
  left unpaid is bucketed by age (0-30 / 31-60 / 61-90 / 90+ days).
- **Sales Tax Summary** — output tax collected from your sales invoices for a period.
  Doesn't yet track input tax paid on purchases (that would need tax fields added to
  Purchase Orders/GRN, deliberately left out of this phase to avoid touching
  already-tested Phase 1 code) — so this shows gross output tax only, not net
  payable. Confirm with your accountant before using for an actual FBR return.
- **Financial Snapshot** — a point-in-time pulse check: total AP, total AR (both
  kinds), current inventory value, and cumulative revenue/COGS/expenses to date.

## Phase 5 — Sales & Distribution

- **Distributors** — buyers of your own-brand goods (Riwayat oil, ghee, soap).
  Separate from toll Customers: money flows the normal direction (they owe you),
  same shape as a vendor relationship but reversed, with its own running ledger.
- **Sales Orders** — same edit/delete/cancel safety pattern as Purchase Orders: once
  a dispatch exists against a line, the order can only be cancelled, not edited or
  deleted, since stock and ledger entries already depend on it.
- **Dispatch (Delivery Challan)** — the goods actually leaving the mill. FIFO by
  default from your own finished-goods stock (never toll stock — that still leaves
  via Toll Delivery). Each dispatch line records the stock's cost rate at the time
  (`cogs_rate`) even though Sales itself doesn't compute margin — that number is
  there for Phase 6's P&L to use directly instead of re-deriving it.
- **Sales Invoices** — the revenue event: subtotal + tax rate (e.g. 17% GST) posted
  to the distributor's ledger. Can be built from a sales order's lines automatically,
  or entered manually for cases like a cash sale with no prior order.
- Note: this covers your own-brand revenue (Riwayat oil/ghee/soap to distributors).
  Toll revenue (Commission Invoices) was already built in Phase 3 — the two stay
  separate since they're fundamentally different transactions.

## Phase 18 — details panels, PO edit rules, searchable items

- Clicking a purchase order, a goods-received note or a vendor now opens a read-only details panel (edit/ledger buttons are inside it).
- Purchase orders can be edited only with the new **Edit purchase orders** permission (admins always have it; grant it to a role in Settings → Accounts). Partially received POs are editable: received lines keep their item/rate and can't drop below the received quantity, the vendor is locked, new lines can be added.
- Cancel is hidden (and refused by the server) once a PO is completed/fully received or fully paid.
- Item and vendor pickers on the PO form are type-to-search dropdowns.

## Phase 19 — partial payments on purchase orders

- PO details panel → **Record payment**: enter a date, amount (up to the balance due) and method (cash / cheque / online, splittable). Repeat as often as needed (e.g. 300,000 on the 1st, 500,000 on the 10th). The PO flips to *paid* automatically when nothing is owed.
- The panel lists every payment (advance + part-payments); a part-payment entered by mistake can be deleted (also removed from the vendor ledger).
- API: `GET/POST /purchase-orders/{id}/payments`, `DELETE /purchase-orders/{id}/payments/{entry_id}`. "Mark paid" still pays the whole remaining balance in one go.

## Phase 20 — GST, expense report, advance salary, payroll upgrades

- **GST:** purchase orders and sales orders have a "GST" toggle + rate. GST orders carry a GST badge and a GST / Non-GST filter. PO totals, balance due and the vendor bill (on goods received) include the GST; the GST of a PO can't change once goods are received. A sales order's rate carries onto its invoice.
- **Expense report** (Reports → Expense Report, with Excel download): every daily expense plus PO payments made in the date range, a total per day and a gross total, and two single freight lines (purchase orders / expenses) that are already included in the totals.
- **Expense freight:** optional freight field on an expense; stored as part of the total and shown/reported separately.
- **Advance Salary** page (HR & Payroll): record advances per employee, per-employee ledger of advances and payroll recoveries. New permission module "Advance Salary".
- **Payroll:** each payslip has an editable "advance deducted" (the rest stays owed and is offered next month); automatic absence deduction (4 free absent days, then salary ÷ 30 per day, editable); payment method (cash / online / cheque) per employee. Finalizing posts salary expenses per cost-center and payment method; the cost recorded is the pay before advance recovery (the advance itself was never an expense).

## Phase 21 — item list and full stock report

- **Items:** "Print list" (print-ready page, can be saved as PDF) and "Download list" (Excel) — all active items with type, unit, pack size, reorder level and owned stock on hand (low items flagged in Excel).
- **Stock:** "Print full report" and "Full stock report (Excel)" — every warehouse / tank with each batch, quantity, ownership (owned vs. toll customer) and value, a value subtotal per warehouse, totals by item across all warehouses, and the total value of owned stock. Empty tanks are listed too.

## Phase 22 — one-off PO purge (temporary)

`backend/app/one_time_cleanup.py` removes one purchase order completely (its GRNs, the stock they added, and its vendor-ledger entries) **only when** the env var `PURGE_PO_NUMBER` is set. `PURGE_PO_DRY_RUN` defaults to dry-run (prints a "[purge]" report to the deploy logs); set it to `0` to delete. It refuses if the received stock was already used or moved, and writes a JSON backup to `uploads/purge_backups/` first. Remove both variables afterwards (and this file in a later release).

Purchase orders that already have goods received cannot be deleted — the server refuses and the Delete button is hidden; cancel them instead.

## Phase 23 — orphan payment cleanup (temporary)

Setting `PURGE_ORPHAN_PO_ID=<id>` (with `PURGE_PO_DRY_RUN`, default dry run) removes advance/payment ledger entries left behind by a purchase order that no longer exists (it refuses if a PO with that id still exists, and backs up first). The expense report now labels such payments "PO #N (deleted)". Remove the variables after use.

## Phase 24 — fix: editing a recipe (BOM) or a sales order failed with "Failed to fetch"

The update endpoints read the order/recipe lines from a plain dict instead of the validated model, so saving an edit that included lines crashed the server (HTTP 500, which the browser reports as "Failed to fetch"). Fixed in `routers/production.py` (recipes) and `routers/sales.py` (sales orders).

## Phase 25 — production order form redesign

The New Production Order panel is wider, and every input/output line is now its own card: the item picker takes the full width (so long item names show in full), with warehouse, quantity and batch underneath, all labelled. Flags (primary / process loss / byproduct rate) sit on their own row.

## Phase 26 — items with stock can't be deleted; relink batches of a deleted item

- `DELETE /items/{id}` is refused while any batch of that item still has stock on hand (owned or toll); the Items page shows why. Such an item can still be edited.
- `one_time_cleanup.py` can move the stock batches of an already-deleted item onto a (new or existing) active item: set `RELINK_ITEM_NAME` and `RELINK_BATCHES` (comma-separated batch numbers). Dry run by default (`PURGE_PO_DRY_RUN`), set to `0` to apply; refuses if a batch belongs to an active item; JSON backup in `uploads/purge_backups/`. Remove the variables afterwards.

## Phase 27 — delete unpaid sales invoices

Sales Invoices has a **Delete** link on every unpaid invoice (not shown on paid ones). It removes the invoice, its lines and the amount it posted to the distributor's ledger; stock is untouched. The server refuses invoices with a payment (mark unpaid first). New permission **Delete unpaid sales invoices** (Settings → Accounts → Roles; administrators always have it).
`one_time_cleanup.py` can remove named invoices: `PURGE_SALES_INVOICES=SINV-…,SINV-…` (dry run unless `PURGE_PO_DRY_RUN=0`; backup to `purge_backups/`). Remove the variable afterwards.

## Phase 28 — correct the rate / quantity of each receiving of a purchase order (temporary)

`one_time_cleanup.py`: `PO_RATE_FIX="<PO number>=<rate>"` (one rate for every receiving) or `PO_RATE_FIX="<PO number>=9920@26,8575@26,12425>9750@21,..."` (one `quantity@rate` per receiving, matched by its current quantity; `old>new` also corrects the quantity). Dry run unless `PURGE_PO_DRY_RUN=0`. Keeps the PO, receivings and stock and corrects goods-received lines, stock-in entries, vendor bills (with GST), the PO line (received quantity, average rate; a completed PO's ordered quantity is set to what was received) and the cost of production orders that already used the stock. Payments and freight are untouched. Refuses if a corrected batch would go negative or a production output was used again. JSON backup in `purge_backups/`. Remove the variable afterwards.

## Phase 29 — PO correction follows the cost all the way down

The correction in Phase 28 now also re-costs production orders that used the output of a corrected production order (any depth), and the cost of goods sold on sales dispatches of that stock. It still refuses when the stock was also moved, transferred or adjusted.

## Phase 30 — PO correction also follows warehouse transfers

Corrected cost now follows stock moved between warehouses/tanks (the IN and OUT ledger lines are re-rated and anything produced or sold from the destination is re-costed). Transfers of a toll customer's stock, and stock adjustments on corrected batches, still stop the correction.

## Phase 31 — add a lot to an existing PO (one-time tool)

`one_time_cleanup.py`: `PO_ADD_LOT="<PO number>=<qty>@<rate>[,<qty>@<rate>...]"` adds new receiving(s) to an existing PO — a new GRN + batch, stock-in entry and vendor bill (GST included), same item/warehouse as the PO's latest receiving. The PO line's ordered/received quantity grows by the lot and its rate becomes the weighted average. Dry run unless `PURGE_PO_DRY_RUN=0`; JSON backup in `purge_backups/` (`addlot_*.json`). Remove the variable afterwards.

## Phase 32 — output item shown in the production order list

`ProductionOrders.jsx`: the Order # column now shows the output item name (primary output; any non-loss output if none is primary) under the order number, and the search box also matches the output item name. Frontend only.
