import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Stat, formatPKR, formatShort } from "../components/ui";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, PieChart, Pie, Cell,
} from "recharts";

const COLORS = {
  amber: "#1F6B3A",      // brand green (legacy key name)
  amberSoft: "#4C8B2B",  // leaf
  gold: "#C49A3A",
  green: "#1B5E32",
  red: "#B3342A",
  blue: "#1F4E79",
  purple: "#7A5A10",
  border: "#DDE4DB",
  textMuted: "#55675B",
};
const PIE_COLORS = ["#1F6B3A", "#C49A3A", "#4C8B2B", "#1F4E79", "#B3342A", "#0E3B1F"];

const PLANTS = ["refining", "hydrogenation", "soap", "packaging"];

function tooltipStyle() {
  return { background: "#fff", border: "1px solid #DDE4DB", borderRadius: 16, fontSize: 12, boxShadow: "0 8px 24px rgba(14,59,31,.12)" };
}

function ChartCard({ title, children, action }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="font-display text-lg font-extrabold text-forest">{title}</div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function BIDashboard() {
  const [months, setMonths] = useState(6);
  const [plant, setPlant] = useState("");
  const [revenueTrend, setRevenueTrend] = useState([]);
  const [yieldTrend, setYieldTrend] = useState([]);
  const [salesByDistributor, setSalesByDistributor] = useState([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState([]);
  const [inventoryByType, setInventoryByType] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [rt, yt, sbd, eb, ivt] = await Promise.all([
        api.getRevenueTrend(months),
        api.getProductionYieldTrend({ months, ...(plant ? { plant } : {}) }),
        api.getSalesByDistributor(),
        api.getExpenseBreakdown(),
        api.getInventoryValueByType(),
      ]);
      setRevenueTrend(rt);
      setYieldTrend(yt);
      setSalesByDistributor(sbd.slice(0, 8));
      setExpenseBreakdown(eb);
      setInventoryByType(ivt);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [months, plant]);

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-extrabold text-forest leading-tight">Analytics</h1>
          <p className="text-text-muted text-sm mt-0.5">Trends across sales, expenses, production and stock.</p>
        </div>
        <div className="flex gap-2">
          {[3, 6, 12].map((m) => (
            <button key={m} onClick={() => setMonths(m)}
              className={`min-h-[44px] px-5 rounded-full text-sm font-bold border transition-colors ${months === m ? "bg-forest text-white border-forest" : "bg-surface text-forest border-border hover:border-brand"}`}>{m} months</button>
          ))}
        </div>
      </div>

      {revenueTrend.length > 0 && (() => {
        const sum = (k) => revenueTrend.reduce((s, r) => s + (r[k] || 0), 0);
        const rev = sum("sales_revenue") + sum("commission_revenue");
        return (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-5">
            <Stat icon="trend" tone="green" label="Revenue" value={`Rs. ${formatShort(rev)}`} sub={`Last ${months} months`} />
            <Stat icon="wallet" tone="yellow" label="Expenses" value={`Rs. ${formatShort(sum("expenses"))}`} sub={`Last ${months} months`} />
            <Stat icon="chart" tone={sum("net_profit") >= 0 ? "green" : "red"} label="Net profit" value={`Rs. ${formatShort(sum("net_profit"))}`} sub={`Last ${months} months`} />
            <Stat icon="receipt" tone="blue" label="Commission revenue" value={`Rs. ${formatShort(sum("commission_revenue"))}`} sub="Toll / job-work" />
          </div>
        );
      })()}

      {loading && <div className="text-text-muted text-sm mb-4">Loading&hellip;</div>}

      <div className="space-y-4 sm:space-y-5">
        <ChartCard title="Revenue &amp; Net Profit Trend">
          {revenueTrend.length === 0 ? (
            <div className="text-text-muted text-sm py-8 text-center">No revenue data in this range yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={revenueTrend}>
                <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke={COLORS.textMuted} fontSize={12} />
                <YAxis stroke={COLORS.textMuted} fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(v) => `Rs. ${formatPKR(v)}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="sales_revenue" name="Sales Revenue" stackId="rev" fill={COLORS.amber} radius={[0, 0, 0, 0]} />
                <Bar dataKey="commission_revenue" name="Commission Revenue" stackId="rev" fill={COLORS.amberSoft} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill={COLORS.gold} />
                <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke="#0E3B1F" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
          <ChartCard title="Sales by Distributor (last 90 days)">
            {salesByDistributor.length === 0 ? (
              <div className="text-text-muted text-sm py-8 text-center">No sales invoices yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={salesByDistributor} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke={COLORS.textMuted} fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="distributor_name" stroke={COLORS.textMuted} fontSize={12} width={110} />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v) => `Rs. ${formatPKR(v)}`} />
                  <Bar dataKey="revenue" fill={COLORS.amber} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Expense Breakdown (last 90 days)">
            {expenseBreakdown.length === 0 ? (
              <div className="text-text-muted text-sm py-8 text-center">No expenses logged yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={expenseBreakdown} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={90} label={(d) => d.category}>
                    {expenseBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v) => `Rs. ${formatPKR(v)}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
          <ChartCard
            title="Production Yield Trend"
            action={
              <select className="field !w-40 !min-h-[40px] !py-1 text-sm" value={plant} onChange={(e) => setPlant(e.target.value)}>
                <option value="">All plants</option>
                {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            }
          >
            {yieldTrend.length === 0 ? (
              <div className="text-text-muted text-sm py-8 text-center">No completed production batches in this range yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={yieldTrend}>
                  <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
                  <XAxis dataKey="month" stroke={COLORS.textMuted} fontSize={12} />
                  <YAxis stroke={COLORS.textMuted} fontSize={12} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v, name) => name === "avg_yield_percent" ? `${v.toFixed(1)}%` : v} />
                  <Line type="monotone" dataKey="avg_yield_percent" name="Avg Yield %" stroke={COLORS.amber} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Inventory Value by Type">
            {inventoryByType.length === 0 ? (
              <div className="text-text-muted text-sm py-8 text-center">No owned stock on hand.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={inventoryByType} dataKey="value" nameKey="item_type" cx="50%" cy="50%" outerRadius={90} label={(d) => d.item_type.replace("_", " ")}>
                    {inventoryByType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v) => `Rs. ${formatPKR(v)}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
