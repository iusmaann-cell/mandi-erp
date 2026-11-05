import { useEffect, useState } from "react";
import { api } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, FormPanel } from "../components/ui";

function emptyLine() { return { item_id: "", warehouse_id: "", batch_no: "", quantity: "" }; }

export default function TollDelivery() {
  const [deliveries, setDeliveries] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [stock, setStock] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showStockHelper, setShowStockHelper] = useState(false);
  const [deliveryNumber, setDeliveryNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function load() {
    const [deliveryData, customerData, itemData, whData, stockData] = await Promise.all([
      api.getTollDeliveries(), api.getCustomers(), api.getItems(), api.getWarehouses(), api.getStockBalance(),
    ]);
    setDeliveries(deliveryData);
    setCustomers(customerData);
    setItems(itemData);
    setWarehouses(whData);
    setStock(stockData.filter((s) => s.is_toll_stock));
  }
  useEffect(() => { load(); }, []);

  const customerLookup = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  function updateLine(i, field, value) {
    const next = [...lines]; next[i] = { ...next[i], [field]: value }; setLines(next);
  }

  function openForm() {
    setDeliveryNumber(generateDocNumber("TDEL"));
    setShowForm((s) => !s);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      await api.createTollDelivery({
        delivery_number: deliveryNumber,
        customer_id: Number(customerId),
        vehicle_no: vehicleNo,
        lines: lines.filter((l) => l.item_id && l.warehouse_id && l.quantity).map((l) => ({
          item_id: Number(l.item_id), warehouse_id: Number(l.warehouse_id),
          batch_no: l.batch_no ? l.batch_no : null, quantity: Number(l.quantity),
        })),
      });
      setDeliveryNumber(generateDocNumber("TDEL")); setVehicleNo(""); setLines([emptyLine()]);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const customerStock = customerId ? stock.filter((s) => s.toll_customer_id === Number(customerId)) : [];

  const filteredDeliveries = deliveries.filter((row) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || row.delivery_number.toLowerCase().includes(q)
      || (customerLookup[row.customer_id] || "").toLowerCase().includes(q)
      || (row.vehicle_no || "").toLowerCase().includes(q);
    const rowDate = new Date(row.delivery_date);
    const matchesFrom = !dateFrom || rowDate >= new Date(dateFrom);
    const matchesTo = !dateTo || rowDate <= new Date(`${dateTo}T23:59:59`);
    return matchesSearch && matchesFrom && matchesTo;
  });

  return (
    <div>
      <SectionTitle
        eyebrow="Toll / Job-Work"
        title="Toll Delivery"
        action={<Button onClick={openForm}>+ Dispatch to Customer</Button>}
      />

      {showForm && (
        <FormPanel wide title="Dispatch to Customer" onClose={() => setShowForm(false)}>
          {customers.length === 0 ? (
            <div className="text-text-muted text-sm">Add a customer first.</div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Delivery number" required value={deliveryNumber} onChange={(e) => setDeliveryNumber(e.target.value)} />
                <Select label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select customer&hellip;</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Input label="Vehicle no. (optional)" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
              </div>

              {customerId && (
                <div>
                  <button type="button" className="text-xs text-amber-soft underline" onClick={() => setShowStockHelper((s) => !s)}>
                    {showStockHelper ? "Hide" : "Show"} {customerLookup[customerId]}'s stock on hand
                  </button>
                  {showStockHelper && (
                    <div className="mt-2 max-h-32 overflow-y-auto border border-border rounded-md">
                      <table className="w-full text-xs">
                        <tbody>
                          {customerStock.map((s, i) => (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="px-3 py-1.5">{s.item_name}</td>
                              <td className="px-3 py-1.5 text-text-muted">{s.warehouse_name}</td>
                              <td className="px-3 py-1.5 stencil text-amber-soft">{s.batch_no}</td>
                              <td className="px-3 py-1.5 stencil">{s.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="text-xs text-text-muted mb-2">
                  Goods dispatched &mdash; enter total quantity, oldest stock for this customer is used automatically (FIFO).
                </div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1.5fr_1fr_1.5fr_auto] gap-3">
                      <Select value={line.item_id} onChange={(e) => updateLine(i, "item_id", e.target.value)}>
                        <option value="">Item&hellip;</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </Select>
                      <Select value={line.warehouse_id} onChange={(e) => updateLine(i, "warehouse_id", e.target.value)}>
                        <option value="">Warehouse&hellip;</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </Select>
                      <Input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                      <Input placeholder="Specific batch (optional)" value={line.batch_no} onChange={(e) => updateLine(i, "batch_no", e.target.value)} />
                      <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>✕</Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="mt-2" onClick={() => setLines([...lines, emptyLine()])}>+ Add line</Button>
              </div>

              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button type="submit">Save Delivery</Button>
                {error && <span className="text-red text-sm">{error}</span>}
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="Search" placeholder="Delivery #, customer, or vehicle…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(search || dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear filters</Button>
        )}
      </div>

      <Card>
        <Table
          emptyLabel={deliveries.length === 0 ? "No toll deliveries yet." : "No deliveries match your search/filter."}
          columns={[
            { key: "delivery_number", label: "Delivery #", mono: true },
            { key: "customer", label: "Customer", render: (row) => customerLookup[row.customer_id] || "—" },
            { key: "date", label: "Date", render: (row) => new Date(row.delivery_date).toLocaleDateString() },
            { key: "batches", label: "Batches", mono: true, render: (row) => row.lines.map((l) => l.batch_no).join(", ") },
            { key: "qty", label: "Total qty", render: (row) => row.lines.reduce((s, l) => s + l.quantity, 0) },
          ]}
          rows={filteredDeliveries}
        />
      </Card>
    </div>
  );
}
