// Which permission module (defined in backend/app/security.py MODULES) guards each page.
// "__admin__" = administrators only. Keys here must also be in App.jsx PAGES and Sidebar NAV_SECTIONS.
export const PAGE_MODULE = {
  dashboard: "dashboard",
  items: "items",
  "invoice-settings": "invoice_settings",
  accounts: "__admin__",
};

export const PAGE_ORDER = Object.keys(PAGE_MODULE);
