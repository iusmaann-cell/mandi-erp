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

/* Things that need attention — feeds the bell icon and the dashboard list.
   Each entry: { id, tone: "yellow"|"red"|"blue"|"green", icon, page, title, sub }.
   Pattern: only fetch what the user may open (canOpenPage), swallow errors per fetch so one failing
   call never blanks the bell, and compute the alerts client-side. Replace the example with yours
   (e.g. unpaid invoices, low stock, documents waiting for approval). */
export function useAttention() {
  const { canOpenPage } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const out = [];
    const safe = (p) => p.catch(() => null);
    const list = canOpenPage("items") ? await safe(api.getItems()) : null;
    if (Array.isArray(list)) {
      const free = list.filter((i) => !Number(i.unit_price));
      if (free.length) out.push({ id: "noprice", tone: "yellow", icon: "alert", page: "items",
        title: `${free.length} item${free.length > 1 ? "s" : ""} without a price`, sub: "Open Items to set a unit price" });
    }
    setItems(out);
    setLoading(false);
  }, [canOpenPage]);

  useEffect(() => { load(); }, [load]);
  return { items, loading, reload: load };
}
