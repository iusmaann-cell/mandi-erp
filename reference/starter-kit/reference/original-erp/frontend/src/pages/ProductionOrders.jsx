import { useEffect, useState } from "react";
import { api } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, formatPKR, FormPanel } from "../components/ui";

const PLANTS = [
  { value: "refining", label: "Refining" },
  { value: "hydrogenation", label: "Hydrogenation (Ghee)" },
  { value: "soap", label: "Soap" },
  { value: "packaging", label: "Packaging" },
];

function emptyInputLine() { return { item_id: "", warehouse_id: "", batch_no: "", quantity: "", use_own_stock: false }; }
function emptyOutputLine() { return { item_id: "", warehouse_id: "", batch_no: "", quantity: "", is_primary: true, is_loss: false, rate: "" }; }

export default function ProductionOrders() {
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [stock, setStock] = useState([]);
  const [boms, setBoms] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showStockHelper, setShowStockHelper] = useState(false);
  const [isToll, setIsToll] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [plant, setPlant] = useState("refining");
  const [bomId, setBomId] = useState("");
  const [notes, setNotes] = useState("");
  const [inputLines, setInputLines] = useState([emptyInputLine()]);
  const [outputLines, setOutputLines] = useState([emptyOutputLine()]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [plantFilter, setPlantFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all"); // all | own | toll
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [targetOutputQty, setTargetOutputQty] = useState("");
  const [recipeError, setRecipeError] = useState("");

  async function load() {
    const [orderData, itemData, whData, stockData, bomData, customerData] = await Promise.all([
      api.getProductionOrders(), api.getItems(), api.getWarehouses(), api.getStockBalance(), api.getBOMs(), api.getCustomers(),
    ]);
    setOrders(orderData);
    setItems(itemData);
    setWarehouses(whData);
    setStock(stockData);
    setBoms(bomData);
    setCustomers(customerData);
  }
  useEffect(() => { load(); }, []);

  const itemLookup = Object.fromEntries(items.map((i) => [i.id, i]));
  // Output item name(s) of an order: the primary output(s), else any non-loss output.
  const outputNames = (row) => {
    const lines = row.output_lines || [];
    const pick = lines.filter((l) => l.is_primary);
    const src = pick.length ? pick : lines.filter((l) => !l.is_loss);
    return [...new Set(src.map((l) => itemLookup[l.item_id]?.name).filter(Boolean))].join(", ");
  };
  const customerLookup = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  function updateInput(i, field, value) {
    const next = [...inputLines]; next[i] = { ...next[i], [field]: value }; setInputLines(next);
  }
  function updateOutput(i, field, value) {
    const next = [...outputLines]; next[i] = { ...next[i], [field]: value }; setOutputLines(next);
  }

  function toggleOutputLoss(i, checked) {
    const next = [...outputLines];
    next[i] = { ...next[i], is_loss: checked, is_primary: checked ? false : next[i].is_primary };
    setOutputLines(next);
  }

  function applyRecipeScale() {
    setRecipeError("");
    const bom = boms.find((b) => b.id === Number(bomId));
    if (!bom) {
      setRecipeError("Select a recipe first.");
      return;
    }
    const targetQty = Number(targetOutputQty);
    if (!targetQty || targetQty <= 0) {
      setRecipeError("Enter how much you want to produce first.");
      return;
    }
    const primaryLine = bom.output_lines.find((l) => l.is_primary);
    if (!primaryLine || !primaryLine.quantity) {
      setRecipeError("This recipe has no primary output defined — add one under BOMs / Recipes first.");
      return;
    }
    const scale = targetQty / primaryLine.quantity;

    setInputLines(bom.input_lines.map((l) => ({
      item_id: String(l.item_id), warehouse_id: "", batch_no: "",
      quantity: String(Math.round(l.quantity * scale * 1000) / 1000), use_own_stock: false,
    })));
    setOutputLines(bom.output_lines.map((l) => ({
      item_id: String(l.item_id), warehouse_id: "", batch_no: "",
      quantity: String(Math.round(l.quantity * scale * 1000) / 1000),
      is_primary: l.is_primary, is_loss: false, rate: "",
    })));
  }


  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      await api.createProductionOrder({
        order_number: orderNumber,
        plant,
        bom_id: bomId ? Number(bomId) : null,
        customer_id: isToll ? Number(customerId) : null,
        notes,
        input_lines: inputLines.filter((l) => l.item_id && l.warehouse_id && l.quantity).map((l) => ({
          item_id: Number(l.item_id), warehouse_id: Number(l.warehouse_id),
          batch_no: l.batch_no ? l.batch_no : null, quantity: Number(l.quantity),
          use_own_stock: isToll ? l.use_own_stock : false,
        })),
        output_lines: outputLines.filter((l) => l.item_id && l.warehouse_id && l.batch_no && l.quantity).map((l) => ({
          item_id: Number(l.item_id), warehouse_id: Number(l.warehouse_id), batch_no: l.batch_no,
          quantity: Number(l.quantity), is_primary: l.is_primary, is_loss: !!l.is_loss,
          rate: (isToll || l.is_primary || l.is_loss) ? null : Number(l.rate),
        })),
      });
      setOrderNumber(generateDocNumber("PRO")); setBomId(""); setNotes(""); setCustomerId(""); setIsToll(false);
      setInputLines([emptyInputLine()]); setOutputLines([emptyOutputLine()]);
      setTargetOutputQty(""); setRecipeError("");
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredOrders = orders.filter((row) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || row.order_number.toLowerCase().includes(q)
      || outputNames(row).toLowerCase().includes(q)
      || new Date(row.order_date).toLocaleDateString().toLowerCase().includes(q);
    const matchesPlant = plantFilter === "all" || row.plant === plantFilter;
    const matchesType = typeFilter === "all" || (typeFilter === "toll" ? !!row.customer_id : !row.customer_id);
    const orderDate = new Date(row.order_date);
    const matchesFrom = !dateFrom || orderDate >= new Date(dateFrom);
    const matchesTo = !dateTo || orderDate <= new Date(`${dateTo}T23:59:59`);
    return matchesSearch && matchesPlant && matchesType && matchesFrom && matchesTo;
  });

  return (
    <div>
      <SectionTitle
        eyebrow="Production"
        title="Production Orders"
        action={<Button onClick={() => { if (!showForm) setOrderNumber(generateDocNumber("PRO")); setShowForm((s) => !s); }}>+ New Production Order</Button>}
      />

      {showForm && (
        <FormPanel wide="xl" title="New Production Order" onClose={() => setShowForm(false)}>
          <div className="flex gap-4 text-sm mb-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!isToll} onChange={() => { setIsToll(false); setCustomerId(""); }} />
              Own production (Riwayat brand)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={isToll} onChange={() => setIsToll(true)} />
              Toll processing for a customer
            </label>
          </div>

          {isToll && (
            <div className="mb-4">
              <Select label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer&hellip;</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          )}

          <div className="mb-4">
            <button type="button" className="text-xs text-amber-soft underline" onClick={() => setShowStockHelper((s) => !s)}>
              {showStockHelper ? "Hide" : "Show"} stock on hand (for picking batch numbers)
            </button>
            {showStockHelper && (
              <div className="mt-2 max-h-40 overflow-y-auto border border-border rounded-md">
                <table className="w-full text-xs">
                  <tbody>
                    {(isToll ? stock.filter((s) => !s.is_toll_stock || s.toll_customer_id === Number(customerId)) : stock.filter((s) => !s.is_toll_stock)).map((s, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5">{s.item_name}</td>
                        <td className="px-3 py-1.5 text-text-muted">{s.warehouse_name}</td>
                        <td className="px-3 py-1.5 stencil text-amber-soft">{s.batch_no}</td>
                        <td className="px-3 py-1.5 stencil">{s.quantity}</td>
                        {isToll && (
                          <td className="px-3 py-1.5">
                            {s.is_toll_stock
                              ? <span className="text-red">{s.toll_customer_name || "customer"}</span>
                              : <span className="text-green">our own</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Production order number" placeholder="PROD-2026-0001" required value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
              <Select label="Plant" value={plant} onChange={(e) => setPlant(e.target.value)}>
                {PLANTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
              <Select label="Recipe (optional reference)" value={bomId} onChange={(e) => { setBomId(e.target.value); setRecipeError(""); }}>
                <option value="">No recipe reference</option>
                {boms.filter((b) => b.plant === plant).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>

            {bomId && (
              <div className="bg-surface-2 rounded-md p-3 flex items-end gap-3">
                <Input
                  label="How much do you want to produce?"
                  type="number"
                  placeholder="e.g. 100"
                  value={targetOutputQty}
                  onChange={(e) => setTargetOutputQty(e.target.value)}
                />
                <Button type="button" variant="secondary" onClick={applyRecipeScale}>Auto-fill from Recipe</Button>
                {recipeError && <span className="text-red text-sm">{recipeError}</span>}
              </div>
            )}
            <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

            <div>
              <div className="text-xs text-text-muted mb-2">
                Material consumed &mdash; enter total quantity needed, oldest stock is used automatically (FIFO).
                {isToll && " Defaults to this customer's stock; tick \"our own\" for lines like packaging materials that are yours, not theirs."}
                {" "}Only set a batch number if you specifically need to draw from one batch (e.g. QC hold on another).
              </div>
              <div className="space-y-3">
                {inputLines.map((line, i) => (
                  <div key={i} className="rounded-2xl border border-border bg-surface-2/60 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-forest">Input {i + 1}</div>
                      <Button type="button" variant="ghost" onClick={() => setInputLines(inputLines.filter((_, idx) => idx !== i))} disabled={inputLines.length === 1}>✕ Remove</Button>
                    </div>
                    <div className="space-y-3">
                      <Select label="Item" value={line.item_id} onChange={(e) => updateInput(i, "item_id", e.target.value)} title={itemLookup[Number(line.item_id)]?.name}>
                        <option value="">Select item&hellip;</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </Select>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Select label="Warehouse / tank" value={line.warehouse_id} onChange={(e) => updateInput(i, "warehouse_id", e.target.value)}>
                          <option value="">Select warehouse&hellip;</option>
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </Select>
                        <Input label="Quantity needed" type="number" placeholder="Qty needed" value={line.quantity} onChange={(e) => updateInput(i, "quantity", e.target.value)} />
                        <Input label="Specific batch (optional)" placeholder="Leave empty for FIFO" value={line.batch_no} onChange={(e) => updateInput(i, "batch_no", e.target.value)} />
                      </div>
                      {isToll && (
                        <label className="flex items-center gap-2 text-sm text-text-muted">
                          <input type="checkbox" checked={line.use_own_stock} onChange={(e) => updateInput(i, "use_own_stock", e.target.checked)} />
                          Use our own stock for this line
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="secondary" className="mt-2" onClick={() => setInputLines([...inputLines, emptyInputLine()])}>+ Add input</Button>
            </div>

            <div>
              <div className="text-xs text-text-muted mb-2">
                Output produced (new batch created for each line — quantities are pre-filled if you used
                "Auto-fill from Recipe" above, but you can still adjust any of them before saving)
              </div>
              <div className="space-y-3">
                {outputLines.map((line, i) => {
                  const selectedItem = itemLookup[Number(line.item_id)];
                  return (
                  <div key={i} className="rounded-2xl border border-border bg-surface-2/60 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-forest">Output {i + 1}</div>
                      <Button type="button" variant="ghost" onClick={() => setOutputLines(outputLines.filter((_, idx) => idx !== i))} disabled={outputLines.length === 1}>✕ Remove</Button>
                    </div>
                    <div className="space-y-3">
                      <Select label="Item" value={line.item_id} onChange={(e) => updateOutput(i, "item_id", e.target.value)} title={selectedItem?.name}>
                        <option value="">Select item&hellip;</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </Select>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Select label="Warehouse / tank" value={line.warehouse_id} onChange={(e) => updateOutput(i, "warehouse_id", e.target.value)}>
                          <option value="">Select warehouse&hellip;</option>
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </Select>
                        <div>
                          <Input label="Quantity" type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateOutput(i, "quantity", e.target.value)} />
                          {selectedItem?.density_kg_per_liter && line.quantity && (
                            <div className="text-xs text-text-muted mt-1">
                              &asymp; {(Number(line.quantity) * selectedItem.density_kg_per_liter).toFixed(1)} kg
                              at {selectedItem.density_kg_per_liter} kg/L
                            </div>
                          )}
                        </div>
                        <Input label="New batch no." placeholder="New batch no." value={line.batch_no} onChange={(e) => updateOutput(i, "batch_no", e.target.value)} />
                      </div>
                      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                        <label className="flex items-center gap-2 text-sm text-text-muted">
                          <input type="checkbox" checked={line.is_primary} onChange={(e) => updateOutput(i, "is_primary", e.target.checked)} disabled={line.is_loss} />
                          Primary product
                        </label>
                        {!isToll && (
                          <label className="flex items-center gap-2 text-sm text-text-muted">
                            <input type="checkbox" checked={!!line.is_loss} onChange={(e) => toggleOutputLoss(i, e.target.checked)} />
                            Process loss
                          </label>
                        )}
                        {!isToll && !line.is_primary && !line.is_loss && (
                          <div className="w-full sm:w-56">
                            <Input label="Byproduct rate (Rs.)" type="number" placeholder="Rate (Rs.)" value={line.rate} onChange={(e) => updateOutput(i, "rate", e.target.value)} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
              <div className="text-xs text-text-muted mt-2">
                {isToll
                  ? "The customer's own material costs nothing to your books. If any input line is marked \"our own\" (e.g. packaging materials), that cost is tracked separately so you can bill it — see \"Our material cost\" in the list below."
                  : "Primary product's cost is computed automatically as (total input cost − byproduct value) ÷ primary quantity. Byproducts need a rate (their recovery/scrap value)."}
              </div>
              <Button type="button" variant="secondary" className="mt-2" onClick={() => setOutputLines([...outputLines, emptyOutputLine()])}>+ Add output</Button>
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-4">
              <Button type="submit" disabled={isToll && !customerId}>Complete Production Order</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="Search" placeholder="Order #, output item or date…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select label="Plant" value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)} className="max-w-xs">
          <option value="all">All plants</option>
          {PLANTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        <Select label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="max-w-xs">
          <option value="all">Own + toll</option>
          <option value="own">Own production only</option>
          <option value="toll">Toll only</option>
        </Select>
        <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(search || plantFilter !== "all" || typeFilter !== "all" || dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setSearch(""); setPlantFilter("all"); setTypeFilter("all"); setDateFrom(""); setDateTo(""); }}>
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <Table
          emptyLabel={orders.length === 0 ? "No production orders yet." : "No production orders match your search/filter."}
          columns={[
            {
              key: "order_number", label: "Order #",
              render: (row) => (
                <div>
                  <div className="font-mono">{row.order_number}</div>
                  <div className="text-xs text-text-muted font-sans">{outputNames(row) || "—"}</div>
                </div>
              ),
            },
            { key: "plant", label: "Plant", render: (row) => <Badge tone="amber">{row.plant}</Badge> },
            {
              key: "type",
              label: "For",
              render: (row) => row.customer_id
                ? <Badge tone="red">{customerLookup[row.customer_id] || "Toll customer"}</Badge>
                : <Badge tone="green">Own (Riwayat)</Badge>,
            },
            { key: "date", label: "Date", render: (row) => new Date(row.order_date).toLocaleDateString() },
            { key: "input", label: "Input qty", render: (row) => row.total_input_quantity },
            { key: "output", label: "Primary output", render: (row) => row.total_primary_output_quantity },
            { key: "yield", label: "Yield", render: (row) => row.yield_percent ? `${row.yield_percent.toFixed(1)}%` : "—" },
            {
              key: "cost", label: "Our material cost", mono: true,
              render: (row) => row.customer_id
                ? <span>{row.total_input_cost ? `Rs. ${formatPKR(row.total_input_cost)}` : <span className="text-text-muted">—</span>}</span>
                : `Rs. ${formatPKR(row.total_input_cost)}`,
            },
          ]}
          rows={filteredOrders}
        />
      </Card>
    </div>
  );
}
