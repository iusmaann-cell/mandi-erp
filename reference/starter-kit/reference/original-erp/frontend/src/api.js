const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export { BASE_URL };

// ---- session token -------------------------------------------------------
const TOKEN_KEY = "riwayat_token";
const OLD_TOKEN_KEY = "tehzeeb_token"; // read once so existing sessions survive the rename
let memoryToken = null;   // fallback if the browser blocks localStorage

export function getToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) return t;
    const old = localStorage.getItem(OLD_TOKEN_KEY);   // session from before the rename
    if (old) { localStorage.setItem(TOKEN_KEY, old); localStorage.removeItem(OLD_TOKEN_KEY); return old; }
    return memoryToken;
  } catch { return memoryToken; }
}
export function setToken(token) {
  memoryToken = token || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked — memory copy still works for this tab */ }
}

// Bill photos saved on the server come back as relative paths (e.g.
// "/uploads/bills/xxx.jpg"). Those are now behind sign-in, and an <img>/<a> can't
// send an Authorization header, so the session token rides along as ?token=.
// Older records from the Google Drive era have full "https://drive.google.com/..."
// URLs, which are used as-is.
export function resolveFileUrl(url) {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const token = getToken();
  const sep = url.includes("?") ? "&" : "?";
  return `${BASE_URL}${url}${token ? `${sep}token=${encodeURIComponent(token)}` : ""}`;
}

// fetch() + Authorization header + automatic sign-out if the server says the
// session is no longer valid.
export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event("auth:expired"));
  }
  return res;
}

// Downloads a file that sits behind sign-in (a plain <a href> can't send the token).
export async function downloadFile(path, filename) {
  const res = await authFetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Download failed");
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request(path, options = {}) {
  const res = await authFetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : (body.detail ? "Please check the form and try again" : `Request failed: ${res.status}`));
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Vendors
  getVendors: () => request("/vendors/"),
  createVendor: (data) => request("/vendors/", { method: "POST", body: JSON.stringify(data) }),
  updateVendor: (id, data) => request(`/vendors/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteVendor: (id) => request(`/vendors/${id}`, { method: "DELETE" }),
  getVendorBalance: (id) => request(`/vendors/${id}/balance`),
  recordPayment: (id, amount, notes) =>
    request(`/vendors/${id}/payment?amount=${amount}&notes=${encodeURIComponent(notes || "")}`, { method: "POST" }),

  // UOM
  getUOMs: () => request("/uom/"),
  createUOM: (data) => request("/uom/", { method: "POST", body: JSON.stringify(data) }),
  updateUOM: (id, data) => request(`/uom/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUOM: (id) => request(`/uom/${id}`, { method: "DELETE" }),
  purgeInactiveUOMs: () => request("/uom/purge-inactive", { method: "POST" }),
  bulkUploadUOMs: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await authFetch(`${BASE_URL}/uom/bulk-upload`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body.detail;
      const err = new Error(typeof detail === "string" ? detail : detail?.message || "Upload failed");
      err.rowErrors = typeof detail === "object" ? detail?.errors : null;
      throw err;
    }
    return body;
  },

  // Items
  getItemListReport: () => request("/items/report"),
  getStockReport: () => request("/stock/report"),
  getItems: (itemType) => request(`/items/${itemType ? `?item_type=${itemType}` : ""}`),
  createItem: (data) => request("/items/", { method: "POST", body: JSON.stringify(data) }),
  bulkUploadItems: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await authFetch(`${BASE_URL}/items/bulk-upload`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body.detail;
      const err = new Error(typeof detail === "string" ? detail : detail?.message || "Upload failed");
      err.rowErrors = typeof detail === "object" ? detail?.errors : null;
      throw err;
    }
    return body;
  },
  updateItem: (id, data) => request(`/items/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteItem: (id) => request(`/items/${id}`, { method: "DELETE" }),
  purgeInactiveItems: () => request("/items/purge-inactive", { method: "POST" }),

  // Warehouses
  getWarehouses: () => request("/warehouses/"),
  createWarehouse: (data) => request("/warehouses/", { method: "POST", body: JSON.stringify(data) }),
  updateWarehouse: (id, data) => request(`/warehouses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteWarehouse: (id) => request(`/warehouses/${id}`, { method: "DELETE" }),

  // Purchase Orders
  getPurchaseOrders: () => request("/purchase-orders/"),
  createPurchaseOrder: (data) => request("/purchase-orders/", { method: "POST", body: JSON.stringify(data) }),
  updatePurchaseOrder: (id, data) => request(`/purchase-orders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePurchaseOrder: (id) => request(`/purchase-orders/${id}`, { method: "DELETE" }),
  cancelPurchaseOrder: (id) => request(`/purchase-orders/${id}/cancel`, { method: "PATCH" }),
  getPurchaseOrder: (id) => request(`/purchase-orders/${id}`),

  // GRN
  getGRNs: () => request("/grn/"),
  createGRN: async (data, billPhotoFile) => {
    const formData = new FormData();
    formData.append("data", JSON.stringify(data));
    formData.append("bill_photo", billPhotoFile);
    const res = await authFetch(`${BASE_URL}/grn/`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Failed to save GRN");
    return body;
  },

  // Stock
  getStockBalance: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/stock/balance${qs ? `?${qs}` : ""}`);
  },
  getWarehouseStockSummary: () => request("/stock/warehouse-summary"),
  searchStock: (q) => request(`/stock/search?q=${encodeURIComponent(q)}`),

  // BOMs
  getBOMs: (plant) => request(`/boms/${plant ? `?plant=${plant}` : ""}`),
  createBOM: (data) => request("/boms/", { method: "POST", body: JSON.stringify(data) }),
  updateBOM: (id, data) => request(`/boms/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBOM: (id) => request(`/boms/${id}`, { method: "DELETE" }),
  getBOM: (id) => request(`/boms/${id}`),

  // Production Orders
  getProductionOrders: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/production-orders/${qs ? `?${qs}` : ""}`);
  },
  createProductionOrder: (data) => request("/production-orders/", { method: "POST", body: JSON.stringify(data) }),
  getProductionOrder: (id) => request(`/production-orders/${id}`),

  // Customers (toll)
  getCustomers: () => request("/customers/"),
  createCustomer: (data) => request("/customers/", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCustomer: (id) => request(`/customers/${id}`, { method: "DELETE" }),
  getCustomerBalance: (id) => request(`/customers/${id}/balance`),
  recordCustomerPayment: (id, amount, notes) =>
    request(`/customers/${id}/payment?amount=${amount}&notes=${encodeURIComponent(notes || "")}`, { method: "POST" }),

  // Toll Intake
  getTollIntakes: (customerId) => request(`/toll-intakes/${customerId ? `?customer_id=${customerId}` : ""}`),
  createTollIntake: (data) => request("/toll-intakes/", { method: "POST", body: JSON.stringify(data) }),

  // Toll Delivery
  getTollDeliveries: (customerId) => request(`/toll-deliveries/${customerId ? `?customer_id=${customerId}` : ""}`),
  createTollDelivery: (data) => request("/toll-deliveries/", { method: "POST", body: JSON.stringify(data) }),

  // Commission Invoices
  getCommissionInvoices: (customerId) => request(`/commission-invoices/${customerId ? `?customer_id=${customerId}` : ""}`),
  createCommissionInvoice: (data) => request("/commission-invoices/", { method: "POST", body: JSON.stringify(data) }),

  // Distributors
  getDistributors: () => request("/distributors/"),
  createDistributor: (data) => request("/distributors/", { method: "POST", body: JSON.stringify(data) }),
  updateDistributor: (id, data) => request(`/distributors/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteDistributor: (id) => request(`/distributors/${id}`, { method: "DELETE" }),
  getDistributorBalance: (id) => request(`/distributors/${id}/balance`),
  recordDistributorPayment: (id, amount, notes) =>
    request(`/distributors/${id}/payment?amount=${amount}&notes=${encodeURIComponent(notes || "")}`, { method: "POST" }),

  // Sales Orders
  getSalesOrders: () => request("/sales-orders/"),
  createSalesOrder: (data) => request("/sales-orders/", { method: "POST", body: JSON.stringify(data) }),
  updateSalesOrder: (id, data) => request(`/sales-orders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSalesOrder: (id) => request(`/sales-orders/${id}`, { method: "DELETE" }),
  cancelSalesOrder: (id) => request(`/sales-orders/${id}/cancel`, { method: "PATCH" }),
  getSalesOrder: (id) => request(`/sales-orders/${id}`),

  // Sales Dispatch
  getSalesDispatches: () => request("/sales-dispatches/"),
  createSalesDispatch: (data) => request("/sales-dispatches/", { method: "POST", body: JSON.stringify(data) }),

  // Sales Invoices
  getSalesInvoices: (distributorId) => request(`/sales-invoices/${distributorId ? `?distributor_id=${distributorId}` : ""}`),
  deleteSalesInvoice: (id) => request(`/sales-invoices/${id}`, { method: "DELETE" }),
  createSalesInvoice: (data) => request("/sales-invoices/", { method: "POST", body: JSON.stringify(data) }),

  // Expenses
  getExpenses: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/expenses/${qs ? `?${qs}` : ""}`);
  },
  createExpense: async (data, billPhotoFile) => {
    const formData = new FormData();
    formData.append("data", JSON.stringify(data));
    formData.append("bill_photo", billPhotoFile);
    const res = await authFetch(`${BASE_URL}/expenses/`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Failed to save expense");
    return body;
  },
  updateExpense: (id, data) => request(`/expenses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteExpense: (id) => request(`/expenses/${id}`, { method: "DELETE" }),

  // Finance Reports
  getPnL: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports/pnl${qs ? `?${qs}` : ""}`);
  },
  getPnLByItem: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports/pnl-by-item${qs ? `?${qs}` : ""}`);
  },
  getExpensesByPlant: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports/expenses-by-plant${qs ? `?${qs}` : ""}`);
  },
  getAPAging: () => request("/reports/ap-aging"),
  getARAgingDistributors: () => request("/reports/ar-aging-distributors"),
  getARAgingTollCustomers: () => request("/reports/ar-aging-toll-customers"),
  getSalesTaxSummary: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/reports/sales-tax-summary${qs ? `?${qs}` : ""}`);
  },
  getFinancialSnapshot: () => request("/reports/financial-snapshot"),

  // Employees
  getEmployees: (plant) => request(`/employees/${plant ? `?plant=${plant}` : ""}`),
  createEmployee: (data) => request("/employees/", { method: "POST", body: JSON.stringify(data) }),
  updateEmployee: (id, data) => request(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteEmployee: (id) => request(`/employees/${id}`, { method: "DELETE" }),

  // Attendance
  markAttendance: (data) => request("/attendance/mark", { method: "POST", body: JSON.stringify(data) }),
  getAttendance: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/attendance/${qs ? `?${qs}` : ""}`);
  },

  // Payroll
  getPayrollRuns: () => request("/payroll/runs/"),
  createPayrollRun: (data) => request("/payroll/runs/", { method: "POST", body: JSON.stringify(data) }),
  getPayrollRun: (id) => request(`/payroll/runs/${id}`),
  updatePayslipLine: (runId, lineId, data) => request(`/payroll/runs/${runId}/lines/${lineId}`, { method: "PUT", body: JSON.stringify(data) }),
  updatePayrollRun: (id, data) => request(`/payroll/runs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  reopenPayrollRun: (id) => request(`/payroll/runs/${id}/reopen`, { method: "PATCH" }),
  deletePayrollRun: (id) => request(`/payroll/runs/${id}`, { method: "DELETE" }),
  finalizePayrollRun: (id) => request(`/payroll/runs/${id}/finalize`, { method: "PATCH" }),

  // Salary advances
  getSalaryAdvances: (employeeId) => request(`/salary-advances/${employeeId ? `?employee_id=${employeeId}` : ""}`),
  addSalaryAdvance: (data) => request("/salary-advances/", { method: "POST", body: JSON.stringify(data) }),
  updateSalaryAdvance: (id, data) => request(`/salary-advances/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSalaryAdvance: (id) => request(`/salary-advances/${id}`, { method: "DELETE" }),
  getAdvanceBalances: () => request("/salary-advances/balances"),
  getAdvanceLedger: (employeeId) => request(`/salary-advances/ledger/${employeeId}`),

  // Expense report (expenses + PO payments, by day)
  getExpenseReport: (start, end) => request(`/reports/expense-report?start_date=${start}&end_date=${end}`),

  // BI Dashboards
  getRevenueTrend: (months = 6) => request(`/bi/revenue-trend?months=${months}`),
  getProductionYieldTrend: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/bi/production-yield-trend${qs ? `?${qs}` : ""}`);
  },
  getInventoryValueByType: () => request("/bi/inventory-value-by-type"),
  getSalesByDistributor: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/bi/sales-by-distributor${qs ? `?${qs}` : ""}`);
  },
  getExpenseBreakdown: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/bi/expense-breakdown${qs ? `?${qs}` : ""}`);
  },

  // Payment status (POs, commission invoices, sales invoices)
  getPOPayments: (id) => request(`/purchase-orders/${id}/payments`),
  addPOPayment: (id, data) => request(`/purchase-orders/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
  deletePOPayment: (id, entryId) => request(`/purchase-orders/${id}/payments/${entryId}`, { method: "DELETE" }),
  updatePOPaymentStatus: (id, data) => request(`/purchase-orders/${id}/payment-status`, { method: "PATCH", body: JSON.stringify(data) }),
  updateCommissionInvoicePaymentStatus: (id, data) => request(`/commission-invoices/${id}/payment-status`, { method: "PATCH", body: JSON.stringify(data) }),
  updateSalesInvoicePaymentStatus: (id, data) => request(`/sales-invoices/${id}/payment-status`, { method: "PATCH", body: JSON.stringify(data) }),

  // Ledgers (with payment detail)
  getVendorLedger: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/vendors/${id}/ledger${qs ? `?${qs}` : ""}`);
  },
  getCustomerLedger: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/customers/${id}/ledger${qs ? `?${qs}` : ""}`);
  },
  getDistributorLedger: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/distributors/${id}/ledger${qs ? `?${qs}` : ""}`);
  },

  // Invoice print settings
  getInvoiceSettings: () => request("/settings/invoice"),
  updateInvoiceSettings: (data) => request("/settings/invoice", { method: "PUT", body: JSON.stringify(data) }),
  uploadInvoiceLogo: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await authFetch(`${BASE_URL}/settings/invoice/logo`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || "Logo upload failed");
    return body;
  },

  // Stock Adjustments
  getStockAdjustments: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/stock-adjustments/${qs ? `?${qs}` : ""}`);
  },
  createStockAdjustment: (data) => request("/stock-adjustments/", { method: "POST", body: JSON.stringify(data) }),
  approveStockAdjustment: (id) => request(`/stock-adjustments/${id}/approve`, { method: "PATCH", body: JSON.stringify({}) }),

  // Stock Transfers
  getStockTransfers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/stock-transfers/${qs ? `?${qs}` : ""}`);
  },
  createStockTransfer: (data) => request("/stock-transfers/", { method: "POST", body: JSON.stringify(data) }),

  // Sign-in
  getAuthStatus: () => request("/auth/status"),
  login: (username, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  getMe: () => request("/auth/me"),
  changePassword: (current_password, new_password) =>
    request("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),

  // Accounts & roles (admin only)
  getAccountModules: () => request("/accounts/modules"),
  getRoles: () => request("/accounts/roles"),
  createRole: (data) => request("/accounts/roles", { method: "POST", body: JSON.stringify(data) }),
  updateRole: (id, data) => request(`/accounts/roles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRole: (id) => request(`/accounts/roles/${id}`, { method: "DELETE" }),
  getUsers: () => request("/accounts/users"),
  createUser: (data) => request("/accounts/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/accounts/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  resetUserPassword: (id, new_password, must_change_password = true) =>
    request(`/accounts/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ new_password, must_change_password }) }),
  deleteUser: (id) => request(`/accounts/users/${id}`, { method: "DELETE" }),

  // Admin
  resetAllData: () => request("/admin/reset-all-data?confirm=RESET", { method: "POST" }),
};

// Dates on screen and in the Excel reports follow Pakistan time (UTC+5); the
// server stores UTC. These turn a stored timestamp into the Pakistan calendar day.
const PKT_MS = 5 * 3600 * 1000;
export function pktDay(isoString) {
  if (!isoString) return "";
  const utc = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(isoString) ? isoString : `${isoString}Z`);
  return new Date(utc.getTime() + PKT_MS).toISOString().slice(0, 10);
}
export function pktToday() {
  return new Date(Date.now() + PKT_MS).toISOString().slice(0, 10);
}
export function formatDay(dayStr) {   // "2026-09-10" -> "10 Sep 2026"
  if (!dayStr) return "";
  const [y, m, d] = dayStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}
