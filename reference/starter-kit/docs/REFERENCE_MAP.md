# "I need X" → "copy Y from `reference/original-erp/`"

All paths are inside `reference/original-erp/` (`backend/app/...`, `frontend/src/...`). The original is an oil-mill ERP; the
vocabulary (GRN, tank, toll, ghee) belongs to that business — keep the structure, rename the words.

| I need… | Backend | Frontend |
|---|---|---|
| **Buy goods: purchase order → receive → pay** (partial payments, GST, freight, cancel rules, edit rights, Excel reports) | `routers/purchase_orders.py`, `routers/grn.py`, models `PurchaseOrder*`, `GRN*`, `VendorLedgerEntry` | `pages/PurchaseOrders.jsx`, `pages/GRN.jsx`, `components/PODetail.jsx`, `GRNDetail.jsx`, `PaymentStatusModal.jsx` |
| **Supplier master, bank accounts, ledger & balance, item↔vendor price list** | `routers/vendors.py` | `pages/Vendors.jsx`, `components/LedgerDetail.jsx` |
| **Stock on hand by batch/warehouse**, batch search, stock report (print/Excel) | `routers/stock.py`, model `StockLedgerEntry` | `pages/Stock.jsx` |
| **Stock transfers** between warehouses (batch + cost preserved) | `routers/stock_transfers.py` | `pages/StockTransfers.jsx` |
| **Stock adjustments with approval** | `routers/stock_adjustments.py` | `pages/StockAdjustments.jsx` |
| **Item master with units of measure, reorder level, bulk Excel upload, purge-inactive** | `routers/items.py` (full version) | `pages/Items.jsx` (full version) |
| **Warehouses/stores with capacity** | `routers/warehouses.py` | `pages/Warehouses.jsx` |
| **Recipes (bill of materials) + production orders with FIFO consumption and costing**, by-products, losses, yield % | `routers/production.py`, models `BOM*`, `ProductionOrder*` | `pages/BOMs.jsx`, `pages/ProductionOrders.jsx` |
| **Job-work / service for customer-owned goods** (intake, delivery, commission invoices) | `routers/toll.py`, `customers.py` | `pages/Toll*.jsx`, `CommissionInvoices.jsx`, `Customers.jsx` |
| **Sales: orders → dispatch (FIFO, COGS) → invoices → receipts**, customer/distributor ledgers | `routers/sales.py`, `distributors.py` | `pages/SalesOrders.jsx`, `SalesDispatch.jsx`, `SalesInvoices.jsx`, `Distributors.jsx`, `printInvoice.js` |
| **Expenses** (categories, back-dating rules, bill photo, payment method) | `routers/expenses.py` | `pages/Expenses.jsx`, `components/BillPhotoUpload.jsx` |
| **Finance reports**: P&L, AP/AR aging, sales-tax summary, expense report (+Excel) | `routers/finance.py` | `pages/Reports.jsx` |
| **HR**: employees, attendance, advance salary, payroll runs with deductions | `routers/employees.py`, `attendance.py`, `salary_advances.py`, `payroll.py` | `pages/Employees.jsx`, `Attendance.jsx`, `AdvanceSalary.jsx`, `Payroll.jsx` |
| **Dashboards & charts** (KPI tiles, trends, period filters) | `routers/bi.py` | `pages/Dashboard.jsx`, `BIDashboard.jsx` |
| **Fixing live data safely** (purge a document with all its side-effects, re-link rows, correct a rate everywhere) | `one_time_cleanup.py` (original, 600+ lines) | — |
| **Complete model catalogue** (every table & column) | `models.py`, `schemas.py` | — |
| **Build history / why each feature exists** | `../PHASE_HISTORY_README.md` | — |

## How to port a feature (recipe)
1. Read the original router + its models + schemas; list the tables it touches.
2. Copy ONLY the models it needs into `backend/app/models.py` (rename for your domain), plus their schemas.
3. Copy the router, fix imports (`from .. import models, schemas, reporting`), keep the ledger/transaction structure intact.
4. Register the module (`security.MODULES`, `main.py`) and any extra `ACTIONS` the original used (search for `require_action`).
5. Copy the page(s) and components, add `api.js` lines (search the original `api.js` for the endpoints), then permissions/nav/App.
6. Test with a limited role and an empty database; then with realistic data.
Do not copy `one_time_cleanup.py` parts that refer to the original's tables.
