import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

/* Navigation: hash routing (#/page) + one-shot "intent" so quick-add buttons
   can open a page's form (e.g. navigate("purchase-orders", {action:"new"})). */
const NavContext = createContext(null);

export function NavProvider({ pages, fallback, children }) {
  const parse = () => {
    const k = window.location.hash.replace(/^#\/?/, "").split("?")[0];
    return pages.includes(k) ? k : null;
  };
  const [active, setActive] = useState(() => parse() || fallback);
  const intent = useRef(null);
  const [tick, setTick] = useState(0);   // bumps on every navigate so pages already open notice a new intent

  useEffect(() => {
    const onHash = () => setActive(parse() || fallback);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  const navigate = useCallback((key, opts = {}) => {
    intent.current = opts.action ? { key, action: opts.action } : null;
    setTick((t) => t + 1);
    if (window.location.hash === `#/${key}`) setActive(key);
    else window.location.hash = `#/${key}`;
  }, []);

  const consumeIntent = useCallback((key) => {
    const i = intent.current;
    if (i && i.key === key) { intent.current = null; return i.action; }
    return null;
  }, []);

  return <NavContext.Provider value={{ active, navigate, consumeIntent, tick }}>{children}</NavContext.Provider>;
}

export function useNav() { return useContext(NavContext); }

/* Page hook: run fn(action) once when arriving with an intent (e.g. "new"). */
export function useIntent(key, fn) {
  const { consumeIntent, tick } = useNav();
  useEffect(() => {
    const a = consumeIntent(key);
    if (a) fn(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
}

/* Things that need attention — feeds the bell and the dashboard. */
export function useAttention() {
  const { canOpenPage } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const out = [];
    const safe = (p) => p.catch(() => null);
    const [adj, pos, its, bal, whs] = await Promise.all([
      canOpenPage("stock-adjustments") ? safe(api.getStockAdjustments()) : null,
      canOpenPage("purchase-orders") ? safe(api.getPurchaseOrders()) : null,
      canOpenPage("items") ? safe(api.getItems()) : null,
      canOpenPage("stock") ? safe(api.getStockBalance()) : null,
      canOpenPage("warehouses") ? safe(api.getWarehouses()) : null,
    ]);
    if (Array.isArray(adj)) {
      const n = adj.filter((a) => a.status === "pending").length;
      if (n) out.push({ id: "adj", tone: "yellow", icon: "alert", page: "stock-adjustments",
        title: `${n} stock adjustment${n > 1 ? "s" : ""} waiting for approval`, sub: "Review and approve or reject" });
    }
    if (Array.isArray(pos)) {
      const unpaid = pos.filter((p) => p.payment_status === "unpaid" && p.status !== "draft" && p.status !== "cancelled");
      if (unpaid.length) out.push({ id: "po", tone: "red", icon: "receipt", page: "purchase-orders",
        title: `${unpaid.length} purchase order${unpaid.length > 1 ? "s" : ""} not paid yet`, sub: "Open Purchase Orders to record payment" });
    }
    if (Array.isArray(its) && Array.isArray(bal)) {
      const qty = {};
      bal.forEach((r) => { qty[r.item_id] = (qty[r.item_id] || 0) + Number(r.quantity || 0); });
      const low = its.filter((i) => Number(i.reorder_level) > 0 && (qty[i.id] || 0) < Number(i.reorder_level));
      if (low.length) out.push({ id: "low", tone: "yellow", icon: "box", page: "stock",
        title: `${low.length} item${low.length > 1 ? "s" : ""} below reorder level`,
        sub: low.slice(0, 3).map((i) => i.name).join(", ") + (low.length > 3 ? "…" : "") });
    }
    if (Array.isArray(whs) && Array.isArray(bal)) {
      const used = {};
      bal.forEach((r) => { used[r.warehouse_id] = (used[r.warehouse_id] || 0) + Number(r.quantity || 0); });
      const full = whs.filter((w) => Number(w.capacity) > 0 && (used[w.id] || 0) / Number(w.capacity) >= 0.9);
      if (full.length) out.push({ id: "full", tone: "blue", icon: "tank", page: "warehouses",
        title: `${full.map((w) => w.name).join(", ")} ${full.length > 1 ? "are" : "is"} almost full`, sub: "90% or more of capacity used" });
    }
    setItems(out);
    setLoading(false);
  }, [canOpenPage]);

  useEffect(() => { load(); }, [load]);
  return { items, loading, reload: load };
}
