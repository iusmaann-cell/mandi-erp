import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { useNav } from "../nav";
import Icon from "./Icon";

export const NAV_SECTIONS = [
  { label: "Procurement", icon: "pkg", items: [
    { key: "vendors", label: "Vendors" },
    { key: "items", label: "Items" },
    { key: "warehouses", label: "Warehouses" },
    { key: "purchase-orders", label: "Purchase Orders" },
    { key: "grn", label: "Goods Received" },
    { key: "stock", label: "Stock" },
    { key: "stock-adjustments", label: "Stock Adjustments" },
    { key: "stock-transfers", label: "Stock Transfers" },
  ]},
  { label: "Production", icon: "factory", items: [
    { key: "boms", label: "Recipes (BOMs)" },
    { key: "production-orders", label: "Production Orders" },
  ]},
  { label: "Toll / Job-Work", icon: "repeat", items: [
    { key: "customers", label: "Toll Customers" },
    { key: "toll-intake", label: "Toll Intake" },
    { key: "toll-delivery", label: "Toll Delivery" },
    { key: "commission-invoices", label: "Commission Invoices" },
  ]},
  { label: "Sales", icon: "trend", items: [
    { key: "distributors", label: "Distributors" },
    { key: "sales-orders", label: "Sales Orders" },
    { key: "sales-dispatch", label: "Dispatch" },
    { key: "sales-invoices", label: "Sales Invoices" },
  ]},
  { label: "Finance", icon: "wallet", items: [
    { key: "expenses", label: "Expenses" },
    { key: "reports", label: "Reports" },
  ]},
  { label: "HR & Payroll", icon: "users", items: [
    { key: "employees", label: "Employees" },
    { key: "attendance", label: "Attendance" },
    { key: "salary-advances", label: "Advance Salary" },
    { key: "payroll", label: "Payroll" },
  ]},
  { label: "Settings", icon: "gear", items: [
    { key: "invoice-settings", label: "Invoice Printing" },
    { key: "accounts", label: "Accounts" },
  ]},
];

export const sectionForKey = (key) => NAV_SECTIONS.find((s) => s.items.some((i) => i.key === key))?.label;

function NavBtn({ active, icon, children, onClick, rail }) {
  return (
    <button
      onClick={onClick}
      title={rail ? children : undefined}
      className={`w-full flex items-center gap-3 rounded-full min-h-[46px] text-[14.5px] font-semibold transition-colors
        ${rail ? "justify-center px-0" : "px-4"}
        ${active ? "bg-gold-soft text-forest" : "text-white/85 hover:bg-white/10"}`}
    >
      <Icon name={icon} size={20} />
      {!rail && <span className="truncate">{children}</span>}
    </button>
  );
}

/* Forest sidebar. lg+: static. Below lg: drawer (opened from the top bar).
   md–lg shows a slim icon rail that opens the drawer. */
export default function Sidebar({ mobileOpen, onCloseMobile }) {
  const { user, signOut, canOpenPage } = useAuth();
  const { active, navigate } = useNav();
  const sections = NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => canOpenPage(i.key)) }))
    .filter((s) => s.items.length);
  const [open, setOpen] = useState(() => new Set([sectionForKey(active)].filter(Boolean)));

  useEffect(() => {
    const s = sectionForKey(active);
    if (s) setOpen((p) => (p.has(s) ? p : new Set(p).add(s)));
  }, [active]);

  const toggle = (l) => setOpen((p) => { const n = new Set(p); n.has(l) ? n.delete(l) : n.add(l); return n; });
  const go = (k) => { navigate(k); onCloseMobile?.(); };
  const initials = (user.full_name || user.username || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const body = (rail) => (
    <>
      <div className={`shrink-0 flex items-center gap-3 ${rail ? "justify-center py-5" : "px-6 pt-7 pb-5"}`}>
        <img src="/logo.png" alt="" className={rail ? "w-11 h-11 rounded-full" : "w-12 h-12 rounded-full"} />
        {!rail && (
          <div className="leading-tight">
            <div className="font-display text-[22px] font-extrabold text-white">Riwayat</div>
            <div className="text-[10.5px] tracking-[.22em] font-bold text-gold-soft">OILS &amp; FATS</div>
          </div>
        )}
        {!rail && <button type="button" onClick={onCloseMobile} aria-label="Close menu"
          className="lg:hidden ml-auto w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center"><Icon name="x" size={18} /></button>}
      </div>
      <nav className={`flex-1 min-h-0 overflow-y-auto no-scrollbar ${rail ? "px-2" : "px-4"} pb-4 space-y-1`}>
        {canOpenPage("dashboard") && <NavBtn rail={rail} icon="dash" active={active === "dashboard"} onClick={() => go("dashboard")}>Dashboard</NavBtn>}
        {canOpenPage("bi-dashboard") && <NavBtn rail={rail} icon="chart" active={active === "bi-dashboard"} onClick={() => go("bi-dashboard")}>Analytics</NavBtn>}
        {sections.map((s) => {
          const isOpen = open.has(s.label);
          const has = s.items.some((i) => i.key === active);
          return (
            <div key={s.label}>
              {rail ? (
                <NavBtn rail icon={s.icon} active={has} onClick={() => go(s.items[0].key)}>{s.label}</NavBtn>
              ) : (
                <>
                  <button onClick={() => toggle(s.label)}
                    className={`w-full flex items-center gap-3 px-4 min-h-[46px] rounded-full text-[14.5px] font-semibold transition-colors
                      ${has && !isOpen ? "bg-white/10 text-white" : "text-white/85 hover:bg-white/10"}`}>
                    <Icon name={s.icon} size={20} />
                    <span className="flex-1 text-left">{s.label}</span>
                    <Icon name="down" size={16} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="ml-[38px] my-1 border-l border-white/15 pl-3 space-y-0.5">
                      {s.items.map((i) => (
                        <button key={i.key} onClick={() => go(i.key)}
                          className={`w-full text-left px-3 min-h-[40px] rounded-full text-[13.5px] font-medium transition-colors
                            ${active === i.key ? "bg-gold-soft text-forest font-bold" : "text-white/70 hover:text-white hover:bg-white/10"}`}>
                          {i.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </nav>
      <div className={`shrink-0 border-t border-white/10 ${rail ? "p-2" : "p-4"}`}>
        {rail ? (
          <button onClick={signOut} title="Sign out" className="w-full min-h-[46px] rounded-full text-white/85 hover:bg-white/10 flex items-center justify-center"><Icon name="logout" size={20} /></button>
        ) : (
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-full bg-gold-soft text-forest font-extrabold text-sm flex items-center justify-center shrink-0">{initials}</div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-white text-sm font-bold truncate">{user.full_name}</div>
              <div className="text-white/60 text-xs truncate">{user.role_name}</div>
            </div>
            <button onClick={signOut} title="Sign out" aria-label="Sign out" className="w-10 h-10 rounded-full text-white/85 hover:bg-white/10 flex items-center justify-center"><Icon name="logout" size={18} /></button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Tablet icon rail */}
      <aside className="hidden md:flex lg:hidden w-[76px] shrink-0 bg-forest flex-col h-full rounded-[28px] overflow-hidden">{body(true)}</aside>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[264px] shrink-0 bg-forest flex-col h-full rounded-[28px] overflow-hidden">{body(false)}</aside>
      {/* Drawer (phone + tablet) */}
      {mobileOpen && <div className="lg:hidden fixed inset-0 z-40 bg-forest/55 anim-fade" onClick={onCloseMobile} />}
      <aside className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[292px] max-w-[88vw] bg-forest flex flex-col rounded-r-[28px] transition-transform duration-200
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>{body(false)}</aside>
    </>
  );
}
