import { useEffect, useState } from "react";
import { api, downloadFile, formatDay } from "../api";
import { Card, SectionTitle, Button, Input, Table, Badge, formatPKR, notify } from "../components/ui";

const TABS = [
  { key: "pnl", label: "P&L" },
  { key: "expense-report", label: "Expense Report" },
  { key: "by-item", label: "P&L by SKU" },
  { key: "ap-aging", label: "AP Aging" },
  { key: "ar-aging", label: "AR Aging" },
  { key: "sales-tax", label: "Sales Tax" },
  { key: "snapshot", label: "Snapshot" },
];

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function DateRangePicker({ start, end, setStart, setEnd }) {
  return (
    <div className="flex gap-3 items-end mb-4">
      <Input label="From" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      <Input label="To" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
    </div>
  );
}

function StatRow({ label, value, tone, bold }) {
  return (
    <div className={`flex justify-between py-2 border-b border-border last:border-0 ${bold ? "font-semibold" : ""}`}>
      <span className="text-text-muted text-sm">{label}</span>
      <span className={`stencil text-sm ${tone === "red" ? "text-red" : tone === "green" ? "text-green" : "text-text"}`}>
        Rs. {formatPKR(value)}
      </span>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState("pnl");
  const [start, setStart] = useState(todayStr(-30));
  const [end, setEnd] = useState(todayStr());

  const [pnl, setPnl] = useState(null);
  const [byItem, setByItem] = useState([]);
  const [apAging, setApAging] = useState([]);
  const [arAgingDist, setArAgingDist] = useState([]);
  const [arAgingToll, setArAgingToll] = useState([]);
  const [salesTax, setSalesTax] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [expReport, setExpReport] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(false);

  const dateParams = { start_date: `${start}T00:00:00`, end_date: `${end}T23:59:59` };

  async function loadTab() {
    setLoading(true);
    try {
      if (tab === "pnl") setPnl(await api.getPnL(dateParams));
      if (tab === "expense-report") setExpReport(await api.getExpenseReport(start, end));
      if (tab === "by-item") setByItem(await api.getPnLByItem(dateParams));
      if (tab === "ap-aging") setApAging(await api.getAPAging());
      if (tab === "ar-aging") {
        setArAgingDist(await api.getARAgingDistributors());
        setArAgingToll(await api.getARAgingTollCustomers());
      }
      if (tab === "sales-tax") setSalesTax(await api.getSalesTaxSummary(dateParams));
      if (tab === "snapshot") setSnapshot(await api.getFinancialSnapshot());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTab(); }, [tab]);

  function refresh() { loadTab(); }

  return (
    <div>
      <SectionTitle eyebrow="Finance" title="Reports" />

      <div className="flex gap-2 mb-6 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 min-h-[44px] px-5 rounded-full text-sm font-bold border transition-colors ${tab === t.key ? "bg-forest text-white border-forest" : "bg-surface text-forest border-border hover:border-brand"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {["pnl", "expense-report", "by-item", "sales-tax"].includes(tab) && (
        <div className="flex items-end gap-3 mb-4">
          <DateRangePicker start={start} end={end} setStart={setStart} setEnd={setEnd} />
          <Button variant="secondary" onClick={refresh}>Apply</Button>
        </div>
      )}

      {loading && <div className="text-text-muted text-sm">Loading&hellip;</div>}

      {!loading && tab === "pnl" && pnl && (
        <Card className="max-w-lg">
          <div className="text-xs text-text-muted uppercase tracking-wide mb-3">
            {new Date(pnl.start_date).toLocaleDateString()} &ndash; {new Date(pnl.end_date).toLocaleDateString()}
          </div>
          <StatRow label="Sales revenue" value={pnl.sales_revenue} />
          <StatRow label="Commission revenue" value={pnl.commission_revenue} />
          <StatRow label="Total revenue" value={pnl.total_revenue} bold />
          <StatRow label="Cost of goods sold" value={pnl.cogs} tone="red" />
          <StatRow label="Gross profit" value={pnl.gross_profit} bold tone={pnl.gross_profit >= 0 ? "green" : "red"} />
          <StatRow label="Expenses" value={pnl.total_expenses} tone="red" />
          <StatRow label="Net profit" value={pnl.net_profit} bold tone={pnl.net_profit >= 0 ? "green" : "red"} />
        </Card>
      )}

      {tab === "expense-report" && (
        <div className="mb-4">
          <Button variant="secondary" disabled={downloading} onClick={async () => {
            setDownloading(true);
            try { await downloadFile(`/reports/expense-report/excel?start_date=${start}&end_date=${end}`, `expense_report_${start}_to_${end}.xlsx`); }
            catch (err) { notify(err.message, "error"); }
            finally { setDownloading(false); }
          }}>{downloading ? "Preparing…" : "⬇ Download Excel Report"}</Button>
        </div>
      )}

      {!loading && tab === "expense-report" && expReport && (
        <div className="space-y-4">
          {expReport.days.length === 0 && <Card><div className="text-sm text-text-muted">Nothing was paid out in this period.</div></Card>}
          {expReport.days.map((d) => (
            <Card key={d.date}>
              <div className="flex items-baseline justify-between mb-2">
                <div className="font-bold text-forest">{formatDay(d.date)}</div>
                <div className="stencil text-sm">Day total <span className="text-amber-soft font-bold">Rs. {formatPKR(d.total)}</span></div>
              </div>
              <div className="divide-y divide-border/60">
                {d.rows.map((r, i) => (
                  <div key={i} className="py-2 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.type === "Expense" ? "amber" : "neutral"}>{r.type}</Badge>
                        <span className="font-semibold">{r.reference}</span>
                        {r.description && <span className="text-text-muted">· {r.description}</span>}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">{r.paid_via}{r.freight > 0 ? ` · incl. freight Rs. ${formatPKR(r.freight)}` : ""}</div>
                    </div>
                    <div className="stencil font-bold whitespace-nowrap">Rs. {formatPKR(r.amount)}</div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          <Card className="max-w-lg">
            <StatRow label="Expenses" value={expReport.expenses_total} />
            <StatRow label="Purchase-order payments" value={expReport.po_payments_total} />
            <StatRow label="Gross total" value={expReport.gross_total} bold tone="red" />
            <div className="text-xs text-text-muted uppercase tracking-wide mt-4 mb-1">Freight charges (already inside the totals above)</div>
            <StatRow label="Freight — purchase orders" value={expReport.freight_purchase_orders} />
            <StatRow label="Freight — expenses" value={expReport.freight_expenses} />
          </Card>
        </div>
      )}

      {!loading && tab === "by-item" && (
        <Card>
          <Table
            emptyLabel="No sales in this date range."
            columns={[
              { key: "item_name", label: "SKU" },
              { key: "quantity_sold", label: "Qty sold" },
              { key: "revenue", label: "Revenue", mono: true, render: (r) => `Rs. ${formatPKR(r.revenue)}` },
              { key: "cogs", label: "COGS", mono: true, render: (r) => `Rs. ${formatPKR(r.cogs)}` },
              { key: "gross_profit", label: "Gross profit", mono: true, render: (r) => `Rs. ${formatPKR(r.gross_profit)}` },
              { key: "margin", label: "Margin", render: (r) => r.margin_percent != null ? `${r.margin_percent.toFixed(1)}%` : "—" },
            ]}
            rows={byItem}
          />
        </Card>
      )}

      {!loading && tab === "ap-aging" && (
        <Card>
          <div className="text-xs text-text-muted mb-3">What we owe vendors, aged by how long each unpaid bill has been outstanding.</div>
          <Table
            emptyLabel="No outstanding vendor balances."
            columns={[
              { key: "party_name", label: "Vendor" },
              { key: "current", label: "Current (0-30d)", mono: true, render: (r) => formatPKR(r.current) },
              { key: "days_31_60", label: "31-60d", mono: true, render: (r) => formatPKR(r.days_31_60) },
              { key: "days_61_90", label: "61-90d", mono: true, render: (r) => formatPKR(r.days_61_90) },
              { key: "over_90", label: "90d+", mono: true, render: (r) => <span className="text-red">{formatPKR(r.over_90)}</span> },
              { key: "total_outstanding", label: "Total", mono: true, render: (r) => `Rs. ${formatPKR(r.total_outstanding)}` },
            ]}
            rows={apAging}
          />
        </Card>
      )}

      {!loading && tab === "ar-aging" && (
        <div className="space-y-6">
          <Card>
            <div className="text-xs text-text-muted mb-3">What distributors owe us for goods sold, aged.</div>
            <Table
              emptyLabel="No outstanding distributor balances."
              columns={[
                { key: "party_name", label: "Distributor" },
                { key: "current", label: "Current (0-30d)", mono: true, render: (r) => formatPKR(r.current) },
                { key: "days_31_60", label: "31-60d", mono: true, render: (r) => formatPKR(r.days_31_60) },
                { key: "days_61_90", label: "61-90d", mono: true, render: (r) => formatPKR(r.days_61_90) },
                { key: "over_90", label: "90d+", mono: true, render: (r) => <span className="text-red">{formatPKR(r.over_90)}</span> },
                { key: "total_outstanding", label: "Total", mono: true, render: (r) => `Rs. ${formatPKR(r.total_outstanding)}` },
              ]}
              rows={arAgingDist}
            />
          </Card>
          <Card>
            <div className="text-xs text-text-muted mb-3">What toll customers owe us for processing commission, aged.</div>
            <Table
              emptyLabel="No outstanding toll customer balances."
              columns={[
                { key: "party_name", label: "Toll customer" },
                { key: "current", label: "Current (0-30d)", mono: true, render: (r) => formatPKR(r.current) },
                { key: "days_31_60", label: "31-60d", mono: true, render: (r) => formatPKR(r.days_31_60) },
                { key: "days_61_90", label: "61-90d", mono: true, render: (r) => formatPKR(r.days_61_90) },
                { key: "over_90", label: "90d+", mono: true, render: (r) => <span className="text-red">{formatPKR(r.over_90)}</span> },
                { key: "total_outstanding", label: "Total", mono: true, render: (r) => `Rs. ${formatPKR(r.total_outstanding)}` },
              ]}
              rows={arAgingToll}
            />
          </Card>
        </div>
      )}

      {!loading && tab === "sales-tax" && salesTax && (
        <Card className="max-w-lg">
          <div className="text-xs text-text-muted uppercase tracking-wide mb-3">
            {new Date(salesTax.start_date).toLocaleDateString()} &ndash; {new Date(salesTax.end_date).toLocaleDateString()}
          </div>
          <StatRow label="Taxable sales" value={salesTax.taxable_sales} />
          <StatRow label="Output tax collected" value={salesTax.output_tax_collected} bold />
          <div className="flex justify-between py-2 text-sm text-text-muted">
            <span>Invoice count</span>
            <span className="stencil">{salesTax.invoice_count}</span>
          </div>
          <div className="text-xs text-text-muted mt-3 border-t border-border pt-3">
            This is output tax only, computed from your sales invoices — it doesn't yet track input tax
            paid on purchases, and isn't a validated FBR filing format. Have your accountant confirm the
            actual return before submission.
          </div>
        </Card>
      )}

      {!loading && tab === "snapshot" && snapshot && (
        <Card className="max-w-lg">
          <div className="text-xs text-text-muted uppercase tracking-wide mb-3">
            As of {new Date(snapshot.as_of).toLocaleString()}
          </div>
          <StatRow label="Accounts payable (owed to vendors)" value={snapshot.total_accounts_payable} tone="red" />
          <StatRow label="Accounts receivable — distributors" value={snapshot.total_accounts_receivable_distributors} tone="green" />
          <StatRow label="Accounts receivable — toll customers" value={snapshot.total_accounts_receivable_toll} tone="green" />
          <StatRow label="Inventory value (owned stock)" value={snapshot.total_inventory_value} />
          <StatRow label="Sales revenue to date" value={snapshot.total_sales_revenue_to_date} />
          <StatRow label="Commission revenue to date" value={snapshot.total_commission_revenue_to_date} />
          <StatRow label="COGS to date" value={snapshot.total_cogs_to_date} />
          <StatRow label="Expenses to date" value={snapshot.total_expenses_to_date} />
          <div className="text-xs text-text-muted mt-3 border-t border-border pt-3">
            A quick pulse check pulled from the sub-ledgers already in the system — not a formal trial
            balance from a double-entry general ledger. For statutory accounts, have an accountant
            prepare proper financial statements.
          </div>
        </Card>
      )}
    </div>
  );
}
