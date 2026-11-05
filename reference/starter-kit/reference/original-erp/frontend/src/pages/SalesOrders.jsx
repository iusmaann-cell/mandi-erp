import { useEffect, useState } from "react";
import { api } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, RowActions, formatPKR, FormPanel, confirmDialog, notify } from "../components/ui";

const STATUS_TONES = { draft: "neutral", approved: "amber", partially_dispatched: "amber", completed: "green", cancelled: "red" };
const STATUSES = ["draft", "approved", "partially_dispatched", "completed", "cancelled"];

function emptyLine() { return { item_id: "", quantity: "", rate: "" }; }

export default function SalesOrders() {
  const [sos, setSos] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [soNumber, setSoNumber] = useState("");
  const [distributorId, setDistributorId] = useState("");
  const [notes, setNotes] = useState("");
  const [gstOn, setGstOn] = useState(false);
  const [gstRate, setGstRate] = useState("18");
  const [gstFilter, setGstFilter] = useState("all");
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [distributorFilter, setDistributorFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function load() {
    const [soData, distributorData, itemData] = await Promise.all([
      api.getSalesOrders(), api.getDistributors(), api.getItems("finished_good"),
    ]);
    setSos(soData);
    setDistributors(distributorData);
    setItems(itemData);
  }
  useEffect(() => { load(); }, []);

  function hasDispatches(so) {
    return so.lines.some((l) => l.dispatched_quantity > 0);
  }

  function resetForm() {
    setSoNumber(generateDocNumber("SO")); setNotes(""); setLines([emptyLine()]); setGstOn(false); setGstRate("18");
    setDistributorId(distributors[0]?.id || "");
  }

  function startCreate() {
    setEditingId(null);
    resetForm();
    setShowForm(true);
  }

  function startEdit(so) {
    setEditingId(so.id);
    setSoNumber(so.so_number);
    setDistributorId(so.distributor_id);
    setNotes(so.notes || "");
    setGstOn((so.gst_rate || 0) > 0); setGstRate(String(so.gst_rate > 0 ? so.gst_rate : 18));
    setLines(so.lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity, rate: l.rate })));
    setShowForm(true);
  }

  function updateLine(i, field, value) {
    const next = [...lines]; next[i] = { ...next[i], [field]: value }; setLines(next);
  }

  const goodsSum = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const gstPct = gstOn ? (Number(gstRate) || 0) : 0;
  const gstSum = goodsSum * gstPct / 100;
  const total = goodsSum + gstSum;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        so_number: soNumber,
        distributor_id: Number(distributorId),
        notes,
        gst_rate: gstPct,
        lines: lines.filter((l) => l.item_id && l.quantity && l.rate).map((l) => ({
          item_id: Number(l.item_id), quantity: Number(l.quantity), rate: Number(l.rate),
        })),
      };
      if (editingId) {
        await api.updateSalesOrder(editingId, payload);
      } else {
        await api.createSalesOrder(payload);
      }
      setEditingId(null);
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(so) {
    try {
      await api.deleteSalesOrder(so.id);
      load();
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleCancel(so) {
    await api.cancelSalesOrder(so.id);
    load();
  }

  const distributorLookup = Object.fromEntries(distributors.map((d) => [d.id, d.name]));

  const filteredSos = sos.filter((so) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || so.so_number.toLowerCase().includes(q)
      || new Date(so.order_date).toLocaleDateString().toLowerCase().includes(q)
      || (distributorLookup[so.distributor_id] || "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || so.status === statusFilter;
    const matchesDistributor = distributorFilter === "all" || String(so.distributor_id) === distributorFilter;
    const orderDate = new Date(so.order_date);
    const matchesFrom = !dateFrom || orderDate >= new Date(dateFrom);
    const matchesTo = !dateTo || orderDate <= new Date(`${dateTo}T23:59:59`);
    const matchesGst = gstFilter === "all" || (gstFilter === "gst" ? (so.gst_rate || 0) > 0 : !(so.gst_rate > 0));
    return matchesSearch && matchesStatus && matchesDistributor && matchesFrom && matchesTo && matchesGst;
  });

  return (
    <div>
      <SectionTitle
        eyebrow="Sales"
        title="Sales Orders"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Sales Order</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Sales Order" : "New Sales Order"} onClose={() => setShowForm(false)}>
          {distributors.length === 0 || items.length === 0 ? (
            <div className="text-text-muted text-sm">Add at least one distributor and one finished-good item (packed SKU) before creating a sales order.</div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="SO number" required value={soNumber} onChange={(e) => setSoNumber(e.target.value)} />
                <Select label="Distributor" value={distributorId} onChange={(e) => setDistributorId(e.target.value)}>
                  {distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
                <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="rounded-[22px] bg-surface-2 p-4 space-y-3">
                <label className="flex items-center gap-3 text-sm font-bold text-forest min-h-[44px] cursor-pointer">
                  <input type="checkbox" className="w-5 h-5" checked={gstOn} onChange={(e) => setGstOn(e.target.checked)} />
                  GST sale — GST is charged on this order
                </label>
                {gstOn && (
                  <Input label="GST rate (%)" type="number" min="0" max="100" step="0.01" value={gstRate} onChange={(e) => setGstRate(e.target.value)}
                    hint="Added on top of the goods value, and carried onto the invoice made from this order." />
                )}
              </div>

              <div>
                <div className="text-xs text-text-muted mb-2">Line items (packed SKUs)</div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
                      <Select label={i === 0 ? "Item" : undefined} value={line.item_id} onChange={(e) => updateLine(i, "item_id", e.target.value)}>
                        <option value="">Select SKU&hellip;</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.pack_size ? ` (${it.pack_size})` : ""}</option>)}
                      </Select>
                      <Input label={i === 0 ? "Quantity" : undefined} type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                      <Input label={i === 0 ? "Rate (Rs.)" : undefined} type="number" placeholder="Rate" value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                      <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>✕</Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="mt-3" onClick={() => setLines([...lines, emptyLine()])}>+ Add line</Button>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4">
                <div className="stencil text-sm text-text-muted">
                  {gstSum > 0 && <span className="mr-3">Goods Rs. {formatPKR(goodsSum)} + GST Rs. {formatPKR(gstSum)} ·</span>}
                  Total: <span className="text-amber-soft">Rs. {formatPKR(total)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit">{editingId ? "Save Changes" : "Save Sales Order"}</Button>
                  {error && <span className="text-red text-sm">{error}</span>}
                </div>
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="Search" placeholder="SO number or date…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-xs">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </Select>
        <Select label="Distributor" value={distributorFilter} onChange={(e) => setDistributorFilter(e.target.value)} className="max-w-xs">
          <option value="all">All distributors</option>
          {distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select label="GST" value={gstFilter} onChange={(e) => setGstFilter(e.target.value)} className="max-w-xs">
          <option value="all">All orders</option>
          <option value="gst">GST orders only</option>
          <option value="non">Non-GST only</option>
        </Select>
        <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(search || statusFilter !== "all" || distributorFilter !== "all" || gstFilter !== "all" || dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setSearch(""); setStatusFilter("all"); setDistributorFilter("all"); setGstFilter("all"); setDateFrom(""); setDateTo(""); }}>
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <Table
          emptyLabel={sos.length === 0 ? "No sales orders yet." : "No sales orders match your search/filter."}
          columns={[
            { key: "so_number", label: "SO Number", mono: true, render: (row) => (
              <span>{row.so_number}{(row.gst_rate || 0) > 0 && <span className="ml-2 align-middle"><Badge tone="amber">GST {row.gst_rate}%</Badge></span>}</span>
            ) },
            { key: "distributor", label: "Distributor", render: (row) => distributorLookup[row.distributor_id] || "—" },
            { key: "order_date", label: "Date", render: (row) => new Date(row.order_date).toLocaleDateString() },
            {
              key: "value", label: "Value", mono: true,
              render: (row) => {
                const goods = row.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
                const gst = goods * (row.gst_rate || 0) / 100;
                return (
                  <div className="leading-snug">
                    <div className="font-bold">Rs. {formatPKR(goods + gst)}</div>
                    {gst > 0 && <div className="text-[11px] font-normal text-text-muted">Goods Rs. {formatPKR(goods)} + GST Rs. {formatPKR(gst)}</div>}
                  </div>
                );
              },
            },
            { key: "status", label: "Status", render: (row) => <Badge tone={STATUS_TONES[row.status]}>{row.status.replace(/_/g, " ")}</Badge> },
            {
              key: "actions",
              label: "",
              render: (row) => {
                const blocked = hasDispatches(row);
                if (blocked) {
                  return row.status === "cancelled"
                    ? <span className="text-text-muted text-xs">—</span>
                    : (
                      <button
                        type="button"
                        className="text-xs text-amber-soft hover:underline"
                        onClick={async () => { if ((await confirmDialog(`Cancel ${row.so_number}? It already has dispatches, so it can't be deleted, but cancelling marks it closed.`, { confirmLabel: "Yes, cancel it" }))) handleCancel(row); }}
                      >
                        Cancel
                      </button>
                    );
                }
                return (
                  <RowActions
                    onEdit={() => startEdit(row)}
                    onDelete={() => handleDelete(row)}
                    deleteConfirm={`Delete ${row.so_number}? This can't be undone.`}
                  />
                );
              },
            },
          ]}
          rows={filteredSos}
        />
      </Card>
    </div>
  );
}
