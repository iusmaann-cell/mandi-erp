const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export { BASE_URL };

// ---- session token -------------------------------------------------------
// Change this per project so two apps on the same domain/localhost never share a login.
const TOKEN_KEY = "erp_token";
let memoryToken = null;   // fallback if the browser blocks localStorage

export function getToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) return t;
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
  // ---- Sign-in ----
  getAuthStatus: () => request("/auth/status"),
  login: (username, password) => request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  getMe: () => request("/auth/me"),
  changePassword: (current_password, new_password) =>
    request("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),

  // ---- Accounts & roles (admin only) ----
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

  // ---- Company / invoice print settings ----
  getInvoiceSettings: () => request("/settings/invoice"),
  updateInvoiceSettings: (data) => request("/settings/invoice", { method: "PUT", body: JSON.stringify(data) }),
  uploadInvoiceLogo: async (file) => {
    const formData = new FormData();
    formData.append("file", file);          // multipart: do NOT set Content-Type, the browser adds the boundary
    const res = await authFetch(`${BASE_URL}/settings/invoice/logo`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || "Logo upload failed");
    return body;
  },

  // ---- Admin ----
  resetAllData: () => request("/admin/reset-all-data?confirm=RESET", { method: "POST" }),

  // ---- Items (EXAMPLE module — copy this block for each new module) ----
  getItems: () => request("/items/"),
  createItem: (data) => request("/items/", { method: "POST", body: JSON.stringify(data) }),
  updateItem: (id, data) => request(`/items/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteItem: (id) => request(`/items/${id}`, { method: "DELETE" }),
  // Excel/other downloads go through downloadFile() so the Authorization header is sent:
  //   downloadFile("/items/report", "item-list.xlsx")
};

// Dates on screen follow a fixed local offset from UTC (set VITE_UTC_OFFSET_HOURS; default 5 = Pakistan);
// the server stores UTC. These turn a stored timestamp into the local calendar day.
const LOCAL_MS = Number(import.meta.env.VITE_UTC_OFFSET_HOURS ?? 5) * 3600 * 1000;
export function pktDay(isoString) {
  if (!isoString) return "";
  const utc = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(isoString) ? isoString : `${isoString}Z`);
  return new Date(utc.getTime() + LOCAL_MS).toISOString().slice(0, 10);
}
export function pktToday() {
  return new Date(Date.now() + LOCAL_MS).toISOString().slice(0, 10);
}
export function formatDay(dayStr) {   // "2026-09-10" -> "10 Sep 2026"
  if (!dayStr) return "";
  const [y, m, d] = dayStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}
