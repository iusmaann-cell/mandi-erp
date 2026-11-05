import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useNav, useAttention } from "../nav";
import Icon from "../components/Icon";
import { Card, Badge, Stat, formatPKR, formatShort } from "../components/ui";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function periodRange(key) {
  const now = new Date();
  if (key === "month") return [new Date(now.getFullYear(), now.getMonth(), 1), now];
  if (key === "year") return [new Date(now.getFullYear(), 0, 1), now];
  const s = new Date(now); s.setDate(s.getDate() - 30); return [s, now];
}
const PERIODS = [["month", "This month"], ["30", "Last 30 days"], ["year", "This year"]];

function Ring({ pct, label, sub }) {
  const p = Math.max(0, Math.min(100, pct));
  const r = 34, c = 2 * Math.PI * r;
  const col = p >= 90 ? "#B3342A" : p >= 75 ? "#C49A3A" : "#1F6B3A";
  return (
    <div className="flex flex-col items-center text-center gap-2">
      <div className="relative w-[84px] h-[84px]">
        <svg viewBox="0 0 84 84" className="w-full h-full -rotate-90">
          <circle cx="42" cy="42" r={r} fill="none" stroke="#E3EFE4" strokeWidth="9" />
          <circle cx="42" cy="42" r={r} fill="none" stroke={col} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${(c * p) / 100} ${c}`} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold text-forest stencil">{Math.round(p)}%</div>
      </div>
      <div className="text-[13px] font-bold text-forest leading-tight">{label}</div>
      <div className="text-[11px] text-text-muted -mt-1.5">{sub}</div>
    </div>
  );
}

function SalesChart({ data }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.sales, d.expenses]));
  return (
    <div>
      <div className="flex items-end justify-around gap-4 h-[200px] pt-2">
        {data.map((d) => (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end max-w-[140px]">
            <div className="flex items-end gap-1.5 w-full justify-center flex-1">
              <div className="w-1/2 max-w-[34px] rounded-t-[10px] bg-brand" style={{ height: `${Math.max(3, (d.sales / max) * 100)}%` }} title={`Sales Rs. ${formatPKR(d.sales)}`} />
              <div className="w-1/2 max-w-[34px] rounded-t-[10px] bg-gold" style={{ height: `${Math.max(3, (d.expenses / max) * 100)}%` }} title={`Expenses Rs. ${formatPKR(d.expenses)}`} />
            </div>
            <div className="text-xs font-bold text-text-muted">{d.label}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-5 justify-center mt-3 text-xs font-semibold text-text-muted">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-full bg-brand" />Sales</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-full bg-gold" />Expenses</span>
        <span className="text-text-muted/70">Rs. millions</span>
      </div>
    </div>
  );
}

const PO_TONE = { draft: "amber", approved: "blue", partially_received: "amber", received: "green", cancelled: "red" };

export default function Dashboard() {
  const { user, canOpenPage, can } = useAuth();
  const { navigate } = useNav();
  const { items: attention } = useAttention();
  const [period, setPeriod] = useState("month");
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [from, to] = periodRange(period);
        const params = { start_date: `${ymd(from)}T00:00:00`, end_date: `${ymd(to)}T23:59:59` };
        const safe = (p, fb = null) => p.catch(() => fb);
        const [pnl, trend, vendors, customers, distributors, whs, bal, pos] = await Promise.all([
          canOpenPage("reports") || canOpenPage("bi-dashboard") ? safe(api.getPnL(params)) : null,
          canOpenPage("bi-dashboard") ? safe(api.getRevenueTrend(3), []) : [],
          canOpenPage("vendors") ? safe(api.getVendors(), []) : [],
          canOpenPage("customers") ? safe(api.getCustomers(), []) : [],
          canOpenPage("distributors") ? safe(api.getDistributors(), []) : [],
          canOpenPage("warehouses") ? safe(api.getWarehouses(), []) : [],
          canOpenPage("stock") ? safe(api.getStockBalance(), []) : [],
          canOpenPage("purchase-orders") ? safe(api.getPurchaseOrders(), []) : [],
        ]);
        const sum = async (list, fn) => (await Promise.all(list.map((x) => safe(fn(x.id), { balance: 0 })))).reduce((s, b) => s + (b.balance || 0), 0);
        const [owe, toll, dist] = await Promise.all([sum(vendors, api.getVendorBalance), sum(customers, api.getCustomerBalance), sum(distributors, api.getDistributorBalance)]);
        if (off) return;
        setD({ pnl, trend: trend || [], vendors, owe, owed: toll + dist, whs, bal, pos });
      } catch (e) { if (!off) setError(e.message || "Something went wrong loading the dashboard."); }
    })();
    return () => { off = true; };
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const chart = useMemo(() => (d?.trend || []).map((t) => ({
    label: new Date(t.month || t.period || t.label || Date.now()).toLocaleString("en", { month: "short" }),
    sales: (t.sales_revenue || 0) + (t.commission_revenue || 0) > 0 ? ((t.sales_revenue || 0) + (t.commission_revenue || 0)) / 1e6 : 0,
    expenses: (t.expenses || 0) / 1e6,
  })), [d]);

  const tanks = useMemo(() => {
    if (!d) return [];
    const used = {};
    d.bal.forEach((r) => { used[r.warehouse_id] = (used[r.warehouse_id] || 0) + Number(r.quantity || 0); });
    return d.whs.filter((w) => Number(w.capacity) > 0).slice(0, 6).map((w) => ({
      id: w.id, name: w.name, pct: ((used[w.id] || 0) / Number(w.capacity)) * 100,
      sub: `${formatShort(used[w.id] || 0)} / ${formatShort(Number(w.capacity))}`,
    }));
  }, [d]);

  const vname = (id) => d?.vendors.find((v) => v.id === id)?.name || "—";
  const latest = d ? [...d.pos].sort((a, b) => new Date(b.order_date) - new Date(a.order_date)).slice(0, 5) : [];
  const hr = new Date().getHours();
  const greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const first = (user.full_name || user.username || "").split(" ")[0];
  const quick = [
    { page: "purchase-orders", label: "New purchase order", icon: "receipt" },
    { page: "grn", label: "Goods received", icon: "truck" },
    { page: "expenses", label: "Add expense", icon: "wallet" },
    { page: "stock-transfers", label: "Stock transfer", icon: "swap" },
  ].filter((q) => canOpenPage(q.page));
  const money = (v) => (v == null ? "—" : `Rs. ${formatShort(v)}`);

  if (error) return <div className="rounded-[20px] bg-[#FCEEEC] text-[#8E2A21] text-sm p-5">Couldn't load the dashboard: {error}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-extrabold text-forest leading-tight">{greet}, {first}</h1>
          <p className="text-text-muted text-sm mt-0.5">Here's how the mill is doing.</p>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
          {PERIODS.map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)}
              className={`shrink-0 min-h-[44px] px-5 rounded-full text-sm font-bold border transition-colors ${period === k ? "bg-forest text-white border-forest" : "bg-surface text-forest border-border hover:border-brand"}`}>{l}</button>
          ))}
        </div>
      </div>

      {!d ? <div className="text-text-muted text-sm py-10 text-center">Loading…</div> : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            <Stat icon="trend" tone="green" label="Sales" value={money(d.pnl?.total_revenue)} sub="This period" />
            <Stat icon="wallet" tone="yellow" label="Expenses" value={money(d.pnl?.total_expenses)} sub="This period" />
            <Stat icon="receipt" tone="red" label="We owe vendors" value={money(canOpenPage("vendors") ? d.owe : null)} sub="Right now" />
            <Stat icon="users" tone="blue" label="Owed to us" value={money(canOpenPage("distributors") || canOpenPage("customers") ? d.owed : null)} sub="Distributors and toll customers" />
          </div>

          {quick.length > 0 && (
            <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
              {quick.map((q) => (
                <button key={q.page} onClick={() => navigate(q.page, { action: "new" })}
                  className="shrink-0 min-h-[48px] pl-2 pr-5 rounded-full bg-surface border border-border text-forest font-bold text-sm flex items-center gap-2.5 hover:border-brand">
                  <span className="w-9 h-9 rounded-full bg-forest text-gold-soft flex items-center justify-center"><Icon name="plus" size={18} /></span>{q.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid lg:grid-cols-5 gap-4">
            {chart.length > 0 && (
              <Card className={tanks.length ? "lg:col-span-3" : "lg:col-span-5"}>
                <h2 className="font-display text-lg font-extrabold text-forest mb-2">Sales vs expenses</h2>
                <SalesChart data={chart} />
              </Card>
            )}
            {tanks.length > 0 && (
              <Card className={chart.length ? "lg:col-span-2" : "lg:col-span-5"}>
                <h2 className="font-display text-lg font-extrabold text-forest mb-4">Tank and store levels</h2>
                <div className="grid grid-cols-3 gap-x-2 gap-y-5">{tanks.map((t) => <Ring key={t.id} pct={t.pct} label={t.name} sub={t.sub} />)}</div>
              </Card>
            )}
          </div>

          <div className="grid lg:grid-cols-5 gap-4">
            {canOpenPage("purchase-orders") && (
              <Card className="lg:col-span-3 !p-0 overflow-hidden">
                <div className="flex items-center justify-between px-6 pt-5 pb-3">
                  <h2 className="font-display text-lg font-extrabold text-forest">Latest purchase orders</h2>
                  <button onClick={() => navigate("purchase-orders")} className="text-sm font-bold text-brand hover:underline min-h-[40px]">View all</button>
                </div>
                {latest.length === 0 ? <div className="px-6 pb-6 text-sm text-text-muted">No purchase orders yet.</div> : (
                  <div className="divide-y divide-border/70">
                    {latest.map((p) => {
                      const total = (p.lines || []).reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0);
                      return (
                        <button key={p.id} onClick={() => navigate("purchase-orders")} className="w-full text-left px-6 py-3.5 flex items-center gap-3 hover:bg-mint/60">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-forest truncate">{p.po_number} · {vname(p.vendor_id)}</div>
                            <div className="text-xs text-text-muted">{new Date(p.order_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · Rs. {formatPKR(total)}</div>
                          </div>
                          <Badge tone={PO_TONE[p.status] || "neutral"}>{String(p.status).replace(/_/g, " ")}</Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            )}
            <Card className={canOpenPage("purchase-orders") ? "lg:col-span-2" : "lg:col-span-5"}>
              <h2 className="font-display text-lg font-extrabold text-forest mb-2">Needs your attention</h2>
              {attention.length === 0 ? <div className="text-sm text-text-muted py-4">All clear — nothing needs your attention.</div> : (
                <div className="space-y-1">
                  {attention.map((a) => {
                    const t = { yellow: ["#FBF1D6", "#7A5A10"], red: ["#FCEEEC", "#8E2A21"], blue: ["#E6EEF6", "#1F4E79"], green: ["#E3F1E5", "#1B5E32"] }[a.tone];
                    return (
                      <button key={a.id} onClick={() => navigate(a.page)} className="w-full text-left flex items-start gap-3 p-2.5 rounded-[18px] hover:bg-mint">
                        <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: t[0], color: t[1] }}><Icon name={a.icon} size={18} /></span>
                        <span className="min-w-0"><span className="block text-sm font-bold text-forest">{a.title}</span><span className="block text-xs text-text-muted mt-0.5">{a.sub}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
