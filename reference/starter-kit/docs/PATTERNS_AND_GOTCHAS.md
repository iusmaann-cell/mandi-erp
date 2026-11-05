# Patterns worth copying, and bugs worth not repeating

## Accounting & inventory patterns (proven in production, in `reference/original-erp/`)
**1. Ledger, not balance column.** Money owed to a vendor, owed by a customer, and stock on hand are never stored as a running
number. They are the SUM of append-only ledger rows (`VendorLedgerEntry`, `CustomerLedgerEntry`, `DistributorLedgerEntry`,
`StockLedgerEntry`) with `direction`/sign, `amount`, `ref_type` (what created it: `GRN_BILL`, `PO_PAYMENT`, `SALES_INVOICE`,
`STOCK_TRANSFER_OUT`…) and `ref_id`. Fix mistakes with a reversing row — never edit history. Everything (balances, aging, P&L,
reports) is a query over the ledger, so numbers can never disagree with each other.

**2. Document → ledger side effects in ONE transaction.** Receiving goods (`routers/grn.py`) creates the GRN, GRN lines, stock-in
ledger rows at the purchase rate, a vendor bill ledger row (qty × rate × (1+GST%)), updates the PO line's received quantity and
status, saves the bill photo last (so a failed upload doesn't leave a half document). Copy that skeleton for any "document that
moves stock and money".

**3. Batches + FIFO.** Each receipt is a batch (`batch_no`, auto-generated `BATCH-<ddmmyy>-<ITEM>-<n>`). Consumption picks the oldest
batch with stock first (`_get_fifo_ordered_batches` in `routers/production.py`, `sales.py`), records the batch and its cost rate on
the consuming document, and writes negative ledger rows. Own stock and customer-owned ("toll") stock are separated by
`is_toll_stock` + `toll_customer_id` and never mixed.

**4. Costing.** Production order cost = Σ(input qty × batch rate); by-product value is subtracted; the primary output's unit cost =
(input cost − by-product value) / primary qty; that rate is stamped on the output lines and the `PRODUCTION_RECEIPT` ledger rows.
Sales dispatch stores `cogs_rate` per line (cost of goods sold). If a purchase rate is corrected later, `one_time_cleanup.correct_po_rate`
shows how to cascade the new rate through production, transfers and COGS (dry run first).

**5. Payments.** `PaymentMethodFields` + backend fields on ledger rows (`payment_method`, `cheque_number`, `cheque_bank`, `our_bank`,
`other_party_name`, `other_party_bank`, `vendor_bank_account_id`). A document can be paid in several (partial) payments, each a ledger
row; `payment_status` (unpaid/partial/paid) is derived. See `purchase_orders.py` (`/payments`) and `PaymentStatusModal.jsx`.

**6. Approval workflow.** Stock adjustments are created "pending" and applied only when someone with the `approve_stock_adjustments`
action approves (`routers/stock_adjustments.py`). Reuse for any "requester ≠ approver" control.

**7. Never hard-delete referenced rows.** Cancel instead of delete for documents that moved stock/money; soft-delete master data;
refuse deleting an item that still has stock (`routers/items.py: delete_item`).

**8. Reports.** Date-range reports use `reporting.range_bounds(start,end)` (local calendar days → UTC window). Each report has a JSON
endpoint for the screen and an `/excel` twin using `reporting.new_sheet`. Aging buckets (`finance.py: ap-aging`), P&L, expense report.

**9. Payroll.** Runs → payslip lines per employee; absence deduction rules, advance recovery, finalize/reopen. See `routers/payroll.py`,
`salary_advances.py`, `pages/Payroll.jsx`.

## Operational patterns
**Production data repair (`one_time_cleanup.py`).** Because the host's database can't be reached from outside, fixes are written as
code that runs on startup only when an env var is set; dry run by default; prints `[purge]` lines to the deploy logs; writes a JSON
backup to the uploads volume; one transaction; refuses on anything unexpected. Always: set var → read dry-run log → show owner → get
"confirm" → apply → verify "DONE" → blank the vars. Real examples inside: purge a PO with its receipts and bills, re-link batches
to a re-created item, delete invoices, correct rates with cascade, add a lot to a PO.

**Delivering code to a non-programmer.** Hand over the whole project folder as a zip + a `.patch` of the change + exact terminal
commands (`git add -A`, `git commit -m`, `git pull --rebase origin master`, `git push origin master`). Give each zip a unique
name (browsers rename duplicates `…(1).zip`, and the wrong zip gets pushed). Check the zip contains the change with a `grep -c`
before copying. Copy files with `rsync -a --exclude .git --exclude node_modules …` so git history is untouched.

## Bugs we hit — don't repeat
| Symptom | Cause | Fix |
|---|---|---|
| Browser says **"Failed to fetch"** when editing a record with lines | `update.dict(exclude_unset=True)` turns nested pydantic models into dicts; later code does `line.item_id` → AttributeError → 500 (CORS headers missing on a 500, so the browser reports a network error) | read nested lists from `update.<field>` when `"<field>" in data`, then `data.pop(...)` |
| Route `/items/report` returns 422 | declared after `/{item_id}` | declare static routes first |
| New column never appears in production | only `create_all` was used | keep `run_lightweight_migrations()` in startup; add columns, never rename |
| Added column is NULL for old rows | `ALTER TABLE ADD COLUMN` ignores the model default | the migrator back-fills scalar defaults — give new columns a default |
| Item deleted while it still had stock → orphan batches | delete had no guard | refuse delete when stock > 0; soft-delete when referenced |
| Report shows a payment for a deleted PO ("PO #2") | PO deleted but its ledger rows weren't | delete a document and all rows it created in one transaction; report labels orphans "(deleted)"; purge tool `PURGE_ORPHAN_PO_ID` |
| Wrong rate on a received PO, already consumed by production | rate copied into many tables | cascade correction (GRN line, stock-in, bill, PO line, production orders, transfers, COGS) — never edit one table |
| Host build fails with "buildkit/daemon error" | platform hiccup | redeploy a previously successful deployment; not a code bug |
| Changing a Railway variable doesn't print the cleanup log | identical value ⇒ no redeploy | change value or trigger redeploy; read logs with a time window (traffic logs bury startup lines) |
| `unzip: cannot find` after pasting commands | terminal converted `"` to curly quotes | paste commands without quotes / from plain text |
| Wrong folder pushed | project folder renamed locally (`tehzeeb_erp` vs `tehzeeb-erp`) | check which folder has `.git` before rsync |

## Style & wording
Plain-English messages ("This item still has stock (120 kg), so it can't be deleted. You can edit it instead."), numbers with
thousands separators, dates as `10 Sep 2026`, currency symbol only in headings/labels. Confirm destructive actions with
`confirmDialog`. Never show stack traces to the user.
