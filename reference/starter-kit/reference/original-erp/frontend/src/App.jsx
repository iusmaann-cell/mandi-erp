import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar, { NAV_SECTIONS } from "./components/Sidebar";
import Icon from "./components/Icon";
import { DialogHost } from "./components/Dialogs";
import { NavProvider, useNav, useAttention } from "./nav";
import Dashboard from "./pages/Dashboard";
import Vendors from "./pages/Vendors";
import Items from "./pages/Items";
import Warehouses from "./pages/Warehouses";
import PurchaseOrders from "./pages/PurchaseOrders";
import GRN from "./pages/GRN";
import Stock from "./pages/Stock";
import StockAdjustments from "./pages/StockAdjustments";
import StockTransfers from "./pages/StockTransfers";
import BOMs from "./pages/BOMs";
import ProductionOrders from "./pages/ProductionOrders";
import Customers from "./pages/Customers";
import TollIntake from "./pages/TollIntake";
import TollDelivery from "./pages/TollDelivery";
import CommissionInvoices from "./pages/CommissionInvoices";
import Distributors from "./pages/Distributors";
import SalesOrders from "./pages/SalesOrders";
import SalesDispatch from "./pages/SalesDispatch";
import SalesInvoices from "./pages/SalesInvoices";
import Expenses from "./pages/Expenses";
import Reports from "./pages/Reports";
import Employees from "./pages/Employees";
import Attendance from "./pages/Attendance";
import Payroll from "./pages/Payroll";
import AdvanceSalary from "./pages/AdvanceSalary";
import BIDashboard from "./pages/BIDashboard";
import InvoiceSettings from "./pages/InvoiceSettings";
import Accounts from "./pages/Accounts";
import { LoginPage, ForcePasswordChange } from "./pages/Login";
import { AuthProvider, useAuth } from "./auth";
import { PAGE_ORDER } from "./permissions";

const PAGES = {
  dashboard: Dashboard,
  vendors: Vendors,
  items: Items,
  warehouses: Warehouses,
  "purchase-orders": PurchaseOrders,
  grn: GRN,
  stock: Stock,
  "stock-adjustments": StockAdjustments,
  "stock-transfers": StockTransfers,
  boms: BOMs,
  "production-orders": ProductionOrders,
  customers: Customers,
  "toll-intake": TollIntake,
  "toll-delivery": TollDelivery,
  "commission-invoices": CommissionInvoices,
  distributors: Distributors,
  "sales-orders": SalesOrders,
  "sales-dispatch": SalesDispatch,
  "sales-invoices": SalesInvoices,
  expenses: Expenses,
  reports: Reports,
  employees: Employees,
  attendance: Attendance,
  "salary-advances": AdvanceSalary,
  payroll: Payroll,
  "bi-dashboard": BIDashboard,
  "invoice-settings": InvoiceSettings,
  accounts: Accounts,
};


export default function App() {
  return (
    <AuthProvider>
      <Gate />
      <DialogHost />
    </AuthProvider>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted text-sm">Loading…</div>;
  }
  if (!user) return <LoginPage />;
  if (user.must_change_password) return <ForcePasswordChange />;
  // key={user.id}: signing in as someone else always starts from a clean slate
  return <ShellWithNav key={user.id} />;
}

function ShellWithNav() {
  const { canOpenPage } = useAuth();
  const fallback = PAGE_ORDER.find((k) => canOpenPage(k)) || "dashboard";
  return (
    <NavProvider pages={Object.keys(PAGES)} fallback={canOpenPage("dashboard") ? "dashboard" : fallback}>
      <Shell />
    </NavProvider>
  );
}

const PAGE_LABEL = {
  dashboard: "Dashboard", "bi-dashboard": "Analytics",
  ...Object.fromEntries(NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.key, i.label]))),
};

const QUICK_ADD = [
  { page: "purchase-orders", label: "New purchase order", icon: "receipt" },
  { page: "grn", label: "Goods received", icon: "truck" },
  { page: "expenses", label: "Add expense", icon: "wallet" },
  { page: "stock-transfers", label: "Stock transfer", icon: "swap" },
];

function useClickAway(ref, fn) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) fn(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, fn]);
}

function SearchBox() {
  const { canOpenPage } = useAuth();
  const { navigate } = useNav();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => setFocus(false));
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return Object.entries(PAGE_LABEL).filter(([k, l]) => canOpenPage(k) && l.toLowerCase().includes(t)).slice(0, 7);
  }, [q, canOpenPage]);
  return (
    <div ref={ref} className="relative flex-1 max-w-[460px]">
      <Icon name="search" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
      <input className="field !pl-11 !min-h-[46px] !bg-surface" placeholder="Search pages…" value={q}
        onFocus={() => setFocus(true)} onChange={(e) => setQ(e.target.value)} />
      {focus && q.trim() && (
        <div className="absolute z-40 top-[52px] left-0 right-0 bg-surface rounded-[20px] shadow-frame border border-border p-2 anim-fade">
          {results.length === 0 && <div className="px-4 py-3 text-sm text-text-muted">No matching page.</div>}
          {results.map(([k, l]) => (
            <button key={k} onClick={() => { navigate(k); setQ(""); setFocus(false); }}
              className="w-full text-left px-4 min-h-[44px] rounded-full text-sm font-semibold text-text hover:bg-mint flex items-center gap-2">
              <Icon name="right" size={14} className="text-brand" />{l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AttentionList({ items, onPick }) {
  if (!items.length) return <div className="px-4 py-6 text-sm text-text-muted text-center">All clear — nothing needs your attention.</div>;
  const tone = { yellow: ["#FBF1D6", "#7A5A10"], red: ["#FCEEEC", "#8E2A21"], blue: ["#E6EEF6", "#1F4E79"], green: ["#E3F1E5", "#1B5E32"] };
  return items.map((a) => (
    <button key={a.id} onClick={() => onPick(a.page)} className="w-full text-left flex items-start gap-3 p-3 rounded-[18px] hover:bg-mint">
      <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: tone[a.tone][0], color: tone[a.tone][1] }}><Icon name={a.icon} size={18} /></span>
      <span className="min-w-0"><span className="block text-sm font-bold text-forest">{a.title}</span><span className="block text-xs text-text-muted mt-0.5">{a.sub}</span></span>
    </button>
  ));
}

function Bell({ attention }) {
  const { navigate } = useNav();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications"
        className="relative w-[46px] h-[46px] rounded-full bg-surface border border-border flex items-center justify-center text-forest hover:text-brand">
        <Icon name="bell" size={20} />
        {attention.length > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1 rounded-full bg-gold text-forest text-[11px] font-extrabold flex items-center justify-center">{attention.length}</span>}
      </button>
      {open && (
        <div className="absolute z-40 right-0 top-[54px] w-[360px] max-w-[92vw] bg-surface rounded-[24px] shadow-frame border border-border p-3 anim-fade">
          <div className="px-3 pt-1 pb-2 font-display font-extrabold text-forest">Needs your attention</div>
          <AttentionList items={attention} onPick={(p) => { setOpen(false); navigate(p); }} />
        </div>
      )}
    </div>
  );
}

function BottomNav({ onMore, attention }) {
  const { canOpenPage, can } = useAuth();
  const { active, navigate } = useNav();
  const [sheet, setSheet] = useState(false);
  const adds = QUICK_ADD.filter((a) => canOpenPage(a.page));
  const Tab = ({ page, icon, label }) => canOpenPage(page) ? (
    <button onClick={() => navigate(page)} className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] ${active === page ? "text-forest" : "text-text-muted"}`}>
      <span className={`px-4 py-1 rounded-full ${active === page ? "bg-gold-soft" : ""}`}><Icon name={icon} size={22} /></span>
      <span className="text-[11px] font-bold">{label}</span>
    </button>
  ) : <span className="flex-1" />;
  return (
    <>
      {sheet && (
        <div className="lg:hidden fixed inset-0 z-50 bg-forest/50 anim-fade" onClick={() => setSheet(false)}>
          <div className="anim-panel absolute bottom-0 inset-x-0 bg-surface rounded-t-[28px] p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-xl font-extrabold text-forest mb-3 px-1">Quick add</div>
            <div className="grid grid-cols-2 gap-3">
              {adds.map((a) => (
                <button key={a.page} onClick={() => { setSheet(false); navigate(a.page, { action: "new" }); }}
                  className="flex flex-col items-start gap-3 p-4 rounded-[22px] bg-mint text-forest font-bold text-sm text-left min-h-[92px]">
                  <span className="w-10 h-10 rounded-full bg-forest text-gold-soft flex items-center justify-center"><Icon name={a.icon} size={20} /></span>{a.label}
                </button>
              ))}
              {adds.length === 0 && <div className="col-span-2 text-sm text-text-muted p-2">Nothing to add with your role.</div>}
            </div>
          </div>
        </div>
      )}
      <nav className="lg:hidden md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-border flex items-end px-2 pb-[env(safe-area-inset-bottom)]">
        <Tab page="dashboard" icon="home" label="Home" />
        <Tab page="stock" icon="pkg" label="Stock" />
        <div className="flex-1 flex justify-center">
          {adds.length > 0 && <button onClick={() => setSheet(true)} aria-label="Quick add"
            className="-mt-6 w-14 h-14 rounded-full bg-gold text-forest shadow-frame flex items-center justify-center"><Icon name="plus" size={28} strokeWidth={2.6} /></button>}
        </div>
        <Tab page="bi-dashboard" icon="chart" label="Analytics" />
        <button onClick={onMore} className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-text-muted relative">
          <span className="px-4 py-1"><Icon name="grid" size={22} /></span><span className="text-[11px] font-bold">More</span>
          {attention.length > 0 && <span className="absolute top-2 right-[26%] w-2.5 h-2.5 rounded-full bg-gold" />}
        </button>
      </nav>
    </>
  );
}

function Shell() {
  const { user, canOpenPage, pageLevel } = useAuth();
  const { active } = useNav();
  const { items: attention } = useAttention();
  const [drawer, setDrawer] = useState(false);
  const Page = PAGES[active];
  const allowed = canOpenPage(active);
  const viewOnly = allowed && active !== "dashboard" && active !== "accounts" && pageLevel(active) === "view";
  const scroller = useRef(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); setDrawer(false); }, [active]);
  const initials = (user.full_name || user.username || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="h-[100dvh] bg-frame lg:p-4 md:p-3 font-body">
      <div className="h-full flex gap-3 lg:gap-4">
        <Sidebar mobileOpen={drawer} onCloseMobile={() => setDrawer(false)} />

        <div className="flex-1 min-w-0 flex flex-col bg-bg md:rounded-[28px] overflow-hidden">
          {/* Phone header */}
          <header className="md:hidden shrink-0 bg-forest text-white flex items-center gap-3 px-4 py-3 pt-[max(12px,env(safe-area-inset-top))]">
            <img src="/logo.png" alt="" className="w-10 h-10 rounded-full" />
            <div className="flex-1 min-w-0 leading-tight">
              <div className="font-display font-extrabold text-lg">Riwayat</div>
              <div className="text-[10px] tracking-[.2em] font-bold text-gold-soft">OILS &amp; FATS</div>
            </div>
            <Bell attention={attention} />
          </header>
          {/* Tablet / desktop top bar */}
          <header className="hidden md:flex shrink-0 items-center gap-3 px-6 lg:px-8 pt-5 pb-2">
            <button onClick={() => setDrawer(true)} aria-label="Open menu" className="lg:hidden w-[46px] h-[46px] rounded-full bg-surface border border-border flex items-center justify-center text-forest"><Icon name="menu" size={20} /></button>
            <SearchBox />
            <div className="flex-1" />
            <Bell attention={attention} />
            <div className="flex items-center gap-2.5 pl-1.5 pr-4 h-[46px] rounded-full bg-surface border border-border">
              <span className="w-8 h-8 rounded-full bg-forest text-gold-soft text-xs font-extrabold flex items-center justify-center">{initials}</span>
              <span className="text-sm font-bold text-forest max-w-[140px] truncate">{user.full_name}</span>
            </div>
          </header>

          <main ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-28 md:pb-8 md:px-6 lg:px-8">
            <div className="max-w-[1200px] mx-auto">
              {!allowed ? (
                <div className="border border-dashed border-border rounded-[24px] py-16 px-6 text-center text-text-muted text-sm bg-surface">
                  {PAGE_ORDER.some((k) => canOpenPage(k))
                    ? "Your role doesn't include access to this section."
                    : "Your account doesn't have access to any section yet. Ask an administrator to assign you a role."}
                </div>
              ) : (
                <>
                  {viewOnly && (
                    <div className="mb-4 text-[13px] font-semibold bg-[#FBF1D6] text-[#7A5A10] rounded-full px-5 py-3 flex items-center gap-2">
                      <Icon name="eye" size={16} /> View-only access — you can look at this section, but changes are blocked.
                    </div>
                  )}
                  <Page key={active} />
                </>
              )}
            </div>
          </main>
        </div>
      </div>
      <BottomNav attention={attention} onMore={() => setDrawer(true)} />
    </div>
  );
}
