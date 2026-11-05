import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { api } from "../api";
import { useIntent } from "../nav";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, FormPanel } from "../components/ui";

const fmtQty = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function StockTransfers() {
  const [transfers, setTransfers] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [stock, setStock] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [number, setNumber] = useState("");
  const [itemId, setItemId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [owner, setOwner] = useState("own");      // "own" or a toll customer id
  const [batchNo, setBatchNo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    const [t, i, w, s] = await Promise.all([
      api.getStockTransfers(), api.getItems(), api.getWarehouses(), api.getStockBalance(),
    ]);
    setTransfers(t); setItems(i); setWarehouses(w.filter((x) => x.is_active !== 0)); setStock(s);
  }
  useEffect(() => { load(); }, []);
  useIntent("stock-transfers", () => openForm());

  function openForm() {
    setNumber(generateDocNumber("TRF"));
    setItemId(""); setFromId(""); setToId(""); setOwner("own"); setBatchNo(""); setQuantity(""); setNotes("");
    setError("");
    setShowForm(true);
  }

  // What's actually sitting in the chosen source, for the chosen item
  const sourceStock = useMemo(
    () => (itemId && fromId ? stock.filter((s) => s.item_id === Number(itemId) && s.warehouse_id === Number(fromId)) : []),
    [stock, itemId, fromId],
  );
  // Own stock + one entry per toll customer that has this item there
  const owners = useMemo(() => {
    const list = [];
    if (sourceStock.some((s) => !s.is_toll_stock)) list.push({ key: "own", label: "Our own stock" });
    const seen = new Set();
    sourceStock.filter((s) => s.is_toll_stock).forEach((s) => {
      if (!seen.has(s.toll_customer_id)) { seen.add(s.toll_customer_id); list.push({ key: String(s.toll_customer_id), label: `Toll: ${s.toll_customer_name}` }); }
    });
    return list;
  }, [sourceStock]);

  // Keep the owner choice valid when the source/item changes
  useEffect(() => {
    if (owners.length && !owners.some((o) => o.key === owner)) setOwner(owners[0].key);
    setBatchNo("");
  }, [owners]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownerBatches = sourceStock.filter((s) => (owner === "own" ? !s.is_toll_stock : String(s.toll_customer_id) === owner));
  const available = ownerBatches.reduce((sum, s) => sum + s.quantity, 0);
  const pinned = ownerBatches.find((s) => s.batch_no === batchNo);
  const maxQty = batchNo ? pinned?.quantity ?? 0 : available;
  const destination = warehouses.find((w) => w.id === Number(toId));
  const destOnHand = destination ? stock.filter((s) => s.warehouse_id === destination.id).reduce((sum, s) => sum + s.quantity, 0) : 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.createStockTransfer({
        transfer_number: number,
        item_id: Number(itemId),
        from_warehouse_id: Number(fromId),
        to_warehouse_id: Number(toId),
        quantity: Number(quantity),
        toll_customer_id: owner === "own" ? null : Number(owner),
        batch_no: batchNo || null,
        notes: notes || null,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const q = search.trim().toLowerCase();
  const rows = transfers.filter((t) =>
    (!filterWarehouse || t.from_warehouse_id === Number(filterWarehouse) || t.to_warehouse_id === Number(filterWarehouse)) &&
    (!q || `${t.transfer_number} ${t.item_name} ${t.from_warehouse_name} ${t.to_warehouse_name} ${t.toll_customer_name || ""} ${t.notes || ""}`.toLowerCase().includes(q)),
  );

  return (
    <div>
      <SectionTitle
        eyebrow="Inventory"
        title="Stock Transfers"
        action={<Button onClick={() => (showForm ? setShowForm(false) : openForm())}>+ New Transfer</Button>}
      />

      <div className="mb-5 rounded-[22px] bg-mint text-forest/90 text-[13.5px] leading-relaxed px-5 py-4 flex gap-3"><Icon name="info" size={20} className="shrink-0 mt-0.5 text-brand" /><div>
          Move stock from one warehouse or tank to another. The oldest batch leaves first (or pick a specific batch), and the same
          batches arrive at the destination with their cost and age unchanged — nothing is added or lost, and a toll customer's material
          stays theirs. A transfer can't be edited; if one was a mistake, record a transfer back.
        </div></div>

      {showForm && (
        <FormPanel wide title="New Transfer" onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Transfer number" value={number} onChange={(e) => setNumber(e.target.value)} required />
              <Select label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
                <option value="">Select item…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              </Select>
              <Select label="From (source)" value={fromId} onChange={(e) => setFromId(e.target.value)} required>
                <option value="">Select warehouse / tank…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
              <Select label="To (destination)" value={toId} onChange={(e) => setToId(e.target.value)} required>
                <option value="">Select warehouse / tank…</option>
                {warehouses.filter((w) => w.id !== Number(fromId)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
              <Select label="Whose stock" value={owner} onChange={(e) => { setOwner(e.target.value); setBatchNo(""); }} disabled={owners.length === 0}>
                {owners.length === 0 && <option value="own">—</option>}
                {owners.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </Select>
              <Select label="Batch" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} disabled={ownerBatches.length === 0}>
                <option value="">Oldest first (FIFO)</option>
                {ownerBatches.map((s) => <option key={s.batch_no} value={s.batch_no}>{s.batch_no} — {fmtQty(s.quantity)} available</option>)}
              </Select>
              <Input label="Quantity" type="number" step="any" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              <div className="sm:col-span-2">
                <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Moved to settling tank before refining" />
              </div>
            </div>

            {itemId && fromId && (
              <div className="text-xs text-text-muted">
                {ownerBatches.length === 0
                  ? "There is no stock of this item in the selected source."
                  : <>Available to move: <span className="text-text">{fmtQty(maxQty)}</span>{batchNo ? ` (batch ${batchNo})` : ` across ${ownerBatches.length} batch(es)`}.</>}
                {destination?.capacity ? <> Destination "{destination.name}" holds {fmtQty(destOnHand)} of {fmtQty(destination.capacity)} capacity.</> : null}
              </div>
            )}
            {error && <div className="text-sm text-red">{error}</div>}
            <Button type="submit" disabled={saving}>{saving ? "Transferring…" : "Record Transfer"}</Button>
          </form>
        </FormPanel>
      )}

      <div className="flex gap-3 mb-3 flex-wrap">
        <input
          className="field flex-1 min-w-[180px]"
          placeholder="Search transfers…" value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select className="field sm:!w-auto" value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)}>
          <option value="">All warehouses / tanks</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <Table
        emptyLabel="No transfers recorded yet."
        columns={[
          { key: "transfer_number", label: "Transfer #", mono: true },
          { key: "date", label: "Date", render: (t) => new Date(t.transfer_date).toLocaleDateString() },
          { key: "item", label: "Item", render: (t) => t.item_name },
          { key: "route", label: "From → To", render: (t) => <span>{t.from_warehouse_name} <span className="text-amber-soft">→</span> {t.to_warehouse_name}</span> },
          { key: "qty", label: "Quantity", render: (t) => fmtQty(t.quantity) },
          {
            key: "owner", label: "Stock",
            render: (t) => t.is_toll_stock ? <Badge tone="amber">Toll: {t.toll_customer_name}</Badge> : <Badge>Own</Badge>,
          },
          {
            key: "batches", label: "Batches moved",
            render: (t) => <span className="text-xs text-text-muted">{t.lines.map((l) => `${l.batch_no} (${fmtQty(l.quantity)})`).join(", ")}</span>,
          },
          {
            key: "notes", label: "Notes",
            render: (t) => <div className="text-xs">{t.notes}{t.created_by && <div className="text-[10px] text-text-muted">by {t.created_by}</div>}</div>,
          },
        ]}
        rows={rows}
      />
    </div>
  );
}
