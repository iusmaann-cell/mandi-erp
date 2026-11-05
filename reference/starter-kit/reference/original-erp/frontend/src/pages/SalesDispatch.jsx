import { useEffect, useState } from "react";
import { api } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, FormPanel } from "../components/ui";

function emptyLine() { return { sales_order_line_id: "", item_id: "", warehouse_id: "", quantity: "", batch_no: "" }; }

export default function SalesDispatch() {
  const [dispatches, setDispatches] = useState([]);
  const [allSos, setAllSos] = useState([]);
  const [sos, setSos] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [stock, setStock] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showStockHelper, setShowStockHelper] = useState(false);
  const [dispatchNumber, setDispatchNumber] = useState("");
  const [soId, setSoId] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function load() {
    const [dispatchData, allSoData, whData, stockData] = await Promise.all([
      api.getSalesDispatches(), api.getSalesOrders(), api.getWarehouses(), api.getStockBalance(),
    ]);
    setDispatches(dispatchData);
    setAllSos(allSoData);
    setSos(allSoData.filter((s) => s.status === "approved" || s.status === "partially_dispatched"));
    setWarehouses(whData);
    setStock(stockData.filter((s) => !s.is_toll_stock));
  }
  useEffect(() => { load(); }, []);

  const soLookup = Object.fromEntries(sos.map((s) => [s.id, s]));
  const allSoLookup = Object.fromEntries(allSos.map((s) => [s.id, s]));
  const selectedSo = soId ? soLookup[Number(soId)] : null;

  function selectSo(id) {
    setSoId(id);
    const so = soLookup[Number(id)];
    if (!so) { setLines([emptyLine()]); return; }
    setLines(
      so.lines
        .filter((l) => l.dispatched_quantity < l.quantity - 1e-6)
        .map((l) => ({
          sales_order_line_id: l.id,
          item_id: l.item_id,
          warehouse_id: "",
          quantity: l.quantity - l.dispatched_quantity,
          batch_no: "",
        }))
    );
  }

  function updateLine(i, field, value) {
    const next = [...lines]; next[i] = { ...next[i], [field]: value }; setLines(next);
  }

  function openForm() {
    setDispatchNumber(generateDocNumber("DO"));
    setShowForm((s) => !s);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      const payloadLines = lines
        .filter((l) => l.sales_order_line_id && l.warehouse_id && l.quantity)
        .map((l) => ({
          sales_order_line_id: Number(l.sales_order_line_id), item_id: Number(l.item_id),
          warehouse_id: Number(l.warehouse_id), quantity: Number(l.quantity),
          batch_no: l.batch_no ? l.batch_no : null,
        }));
      if (payloadLines.length === 0) {
        setError("Fill in warehouse and quantity for at least one line.");
        return;
      }
      await api.createSalesDispatch({
        dispatch_number: dispatchNumber, sales_order_id: Number(soId), vehicle_no: vehicleNo, lines: payloadLines,
      });
      setDispatchNumber(generateDocNumber("DO")); setVehicleNo(""); setSoId(""); setLines([emptyLine()]);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredDispatches = dispatches.filter((row) => {
    const q = search.trim().toLowerCase();
    const soNumber = allSoLookup[row.sales_order_id]?.so_number || "";
    const matchesSearch = !q
      || row.dispatch_number.toLowerCase().includes(q)
      || soNumber.toLowerCase().includes(q)
      || (row.vehicle_no || "").toLowerCase().includes(q)
      || new Date(row.dispatch_date).toLocaleDateString().toLowerCase().includes(q);
    const rowDate = new Date(row.dispatch_date);
    const matchesFrom = !dateFrom || rowDate >= new Date(dateFrom);
    const matchesTo = !dateTo || rowDate <= new Date(`${dateTo}T23:59:59`);
    return matchesSearch && matchesFrom && matchesTo;
  });

  return (
    <div>
      <SectionTitle
        eyebrow="Sales"
        title="Dispatch (Delivery Challan)"
        action={<Button onClick={openForm}>+ New Dispatch</Button>}
      />

      {showForm && (
        <FormPanel wide title="New Dispatch" onClose={() => setShowForm(false)}>
          {sos.length === 0 ? (
            <div className="text-text-muted text-sm">No open sales orders to dispatch against. Create one first.</div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select label="Sales order" value={soId} onChange={(e) => selectSo(e.target.value)}>
                  <option value="">Select SO&hellip;</option>
                  {sos.map((s) => <option key={s.id} value={s.id}>{s.so_number}</option>)}
                </Select>
                <Input label="Dispatch (DO) number" required value={dispatchNumber} onChange={(e) => setDispatchNumber(e.target.value)} />
                <Input label="Vehicle no. (optional)" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
              </div>

              {lines.length > 0 && selectedSo && (
                <div>
                  <button type="button" className="text-xs text-amber-soft underline mb-2" onClick={() => setShowStockHelper((s) => !s)}>
                    {showStockHelper ? "Hide" : "Show"} finished goods stock on hand
                  </button>
                  {showStockHelper && (
                    <div className="mb-3 max-h-32 overflow-y-auto border border-border rounded-md">
                      <table className="w-full text-xs">
                        <tbody>
                          {stock.map((s, i) => (
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
                  <div className="text-xs text-text-muted mb-2">Dispatching &mdash; oldest stock is used automatically (FIFO)</div>
                  <div className="space-y-3">
                    {lines.map((line, i) => (
                      <div key={line.sales_order_line_id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-3 items-end bg-surface-2 rounded-md p-3">
                        <Input label="Quantity to dispatch" type="number" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                        <Select label="Warehouse" value={line.warehouse_id} onChange={(e) => updateLine(i, "warehouse_id", e.target.value)}>
                          <option value="">Select&hellip;</option>
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </Select>
                        <Input label="Specific batch (optional)" value={line.batch_no} onChange={(e) => updateLine(i, "batch_no", e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button type="submit" disabled={!soId}>Save Dispatch</Button>
                {error && <span className="text-red text-sm">{error}</span>}
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="Search" placeholder="DO #, SO #, vehicle, or date…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(search || dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear filters</Button>
        )}
      </div>

      <Card>
        <Table
          emptyLabel={dispatches.length === 0 ? "No dispatches yet." : "No dispatches match your search/filter."}
          columns={[
            { key: "dispatch_number", label: "Dispatch #", mono: true },
            { key: "so_number", label: "SO #", mono: true, render: (row) => allSoLookup[row.sales_order_id]?.so_number || "—" },
            { key: "vehicle_no", label: "Vehicle", render: (row) => row.vehicle_no || "—" },
            { key: "date", label: "Date", render: (row) => new Date(row.dispatch_date).toLocaleDateString() },
            { key: "batches", label: "Batches", mono: true, render: (row) => row.lines.map((l) => l.batch_no).join(", ") },
            { key: "qty", label: "Total quantity", render: (row) => row.lines.reduce((s, l) => s + l.quantity, 0) },
          ]}
          rows={filteredDispatches}
        />
      </Card>
    </div>
  );
}
