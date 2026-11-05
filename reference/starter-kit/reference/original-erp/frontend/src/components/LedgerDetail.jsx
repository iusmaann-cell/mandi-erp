import { useEffect, useState } from "react";
import { Card, Button, Input, Table, Badge, formatPKR } from "./ui";
import { paymentMethodLabel } from "./PaymentMethodFields";

function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

// Generic ledger drill-down: used when clicking a vendor, toll customer, or
// distributor from their list. `fetchLedger` should call the right API method
// for that entity and return { entries, period_debit, period_credit, balance_as_of_end }.
// `debitLabel`/`creditLabel` let each context phrase the two directions correctly
// (e.g. "Billed" vs "Owed to us" have opposite meaning between a vendor and a customer).
export default function LedgerDetail({ partyName, fetchLedger, debitLabel, creditLabel, balanceLabel, balanceTone = "amber", onBack }) {
  const [dateFrom, setDateFrom] = useState(monthAgoStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const result = await fetchLedger({
        start_date: `${dateFrom}T00:00:00`,
        end_date: `${dateTo}T23:59:59`,
      });
      setData(result);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [dateFrom, dateTo]);

  return (
    <div>
      <button type="button" className="text-sm text-amber-soft hover:underline mb-4" onClick={onBack}>
        &larr; Back to list
      </button>

      <Card className="mb-4">
        <div className="font-display text-lg font-semibold mb-3">{partyName}</div>
        <div className="flex items-end gap-3">
          <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </div>
      </Card>

      {loading ? (
        <div className="text-text-muted text-sm">Loading&hellip;</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Card>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">{debitLabel} (this period)</div>
              <div className="stencil text-xl">Rs. {formatPKR(data.period_debit)}</div>
            </Card>
            <Card>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">{creditLabel} (this period)</div>
              <div className="stencil text-xl">Rs. {formatPKR(data.period_credit)}</div>
            </Card>
            <Card>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">{balanceLabel} (as of {dateTo})</div>
              <div className={`stencil text-xl ${balanceTone === "amber" ? "text-goldtext" : "text-green"}`}>
                Rs. {formatPKR(data.balance_as_of_end)}
              </div>
            </Card>
          </div>

          <Card>
            <Table
              emptyLabel="No ledger activity in this date range."
              columns={[
                { key: "entry_date", label: "Date", render: (row) => new Date(row.entry_date).toLocaleDateString() },
                { key: "ref_type", label: "Type", render: (row) => <Badge tone={row.direction === "debit" ? "amber" : "green"}>{row.ref_type.replace(/_/g, " ")}</Badge> },
                { key: "amount", label: "Amount", mono: true, render: (row) => `Rs. ${formatPKR(row.amount)}` },
                { key: "direction", label: "Direction", render: (row) => row.direction === "debit" ? debitLabel : creditLabel },
                { key: "payment", label: "Payment detail", render: (row) => paymentMethodLabel(row) },
                { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
              ]}
              rows={data.entries}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
