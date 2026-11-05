import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, RowActions, FormPanel } from "../components/ui";

const PLANTS = [
  { value: "refining", label: "Refining" },
  { value: "hydrogenation", label: "Hydrogenation (Ghee)" },
  { value: "soap", label: "Soap" },
  { value: "packaging", label: "Packaging" },
];

function emptyInputLine() { return { item_id: "", quantity: "" }; }
function emptyOutputLine() { return { item_id: "", quantity: "", is_primary: true }; }

export default function BOMs() {
  const [boms, setBoms] = useState([]);
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [plant, setPlant] = useState("refining");
  const [refSize, setRefSize] = useState("100");
  const [notes, setNotes] = useState("");
  const [inputLines, setInputLines] = useState([emptyInputLine()]);
  const [outputLines, setOutputLines] = useState([emptyOutputLine()]);
  const [error, setError] = useState("");

  async function load() {
    setBoms(await api.getBOMs());
    setItems(await api.getItems());
  }
  useEffect(() => { load(); }, []);

  const itemLookup = Object.fromEntries(items.map((i) => [i.id, i]));

  function updateInput(i, field, value) {
    const next = [...inputLines]; next[i] = { ...next[i], [field]: value }; setInputLines(next);
  }
  function updateOutput(i, field, value) {
    const next = [...outputLines]; next[i] = { ...next[i], [field]: value }; setOutputLines(next);
  }

  function resetForm() {
    setName(""); setPlant("refining"); setRefSize("100"); setNotes("");
    setInputLines([emptyInputLine()]); setOutputLines([emptyOutputLine()]);
  }

  function startCreate() {
    setEditingId(null);
    resetForm();
    setShowForm(true);
  }

  function startEdit(bom) {
    setEditingId(bom.id);
    setName(bom.name);
    setPlant(bom.plant);
    setRefSize(String(bom.reference_batch_size));
    setNotes(bom.notes || "");
    setInputLines(bom.input_lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })));
    setOutputLines(bom.output_lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity, is_primary: l.is_primary })));
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        name, plant, reference_batch_size: Number(refSize), notes,
        input_lines: inputLines.filter((l) => l.item_id && l.quantity).map((l) => ({ item_id: Number(l.item_id), quantity: Number(l.quantity) })),
        output_lines: outputLines.filter((l) => l.item_id && l.quantity).map((l) => ({ item_id: Number(l.item_id), quantity: Number(l.quantity), is_primary: l.is_primary })),
      };
      if (editingId) {
        await api.updateBOM(editingId, payload);
      } else {
        await api.createBOM(payload);
      }
      setEditingId(null);
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(bom) {
    await api.deleteBOM(bom.id);
    load();
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Production"
        title="BOMs / Recipes"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New BOM</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit BOM" : "New BOM"} onClose={() => setShowForm(false)}>
          {items.length === 0 ? (
            <div className="text-text-muted text-sm">Add items first (crude oil, finished goods, byproducts).</div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Recipe name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunflower Oil Refining - Standard" />
                <Select label="Plant" value={plant} onChange={(e) => setPlant(e.target.value)}>
                  {PLANTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
                <Input label="Reference batch size" type="number" value={refSize} onChange={(e) => setRefSize(e.target.value)} />
              </div>
              <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

              <div>
                <div className="text-xs text-text-muted mb-2">Inputs (per reference batch size above)</div>
                <div className="space-y-2">
                  {inputLines.map((line, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-3">
                      <Select value={line.item_id} onChange={(e) => updateInput(i, "item_id", e.target.value)}>
                        <option value="">Select item&hellip;</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </Select>
                      <Input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateInput(i, "quantity", e.target.value)} />
                      <Button type="button" variant="ghost" onClick={() => setInputLines(inputLines.filter((_, idx) => idx !== i))} disabled={inputLines.length === 1}>✕</Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="mt-2" onClick={() => setInputLines([...inputLines, emptyInputLine()])}>+ Add input</Button>
              </div>

              <div>
                <div className="text-xs text-text-muted mb-2">Outputs (primary product + byproducts)</div>
                <div className="space-y-2">
                  {outputLines.map((line, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-center">
                      <Select value={line.item_id} onChange={(e) => updateOutput(i, "item_id", e.target.value)}>
                        <option value="">Select item&hellip;</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </Select>
                      <Input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateOutput(i, "quantity", e.target.value)} />
                      <label className="flex items-center gap-2 text-sm text-text-muted">
                        <input type="checkbox" checked={line.is_primary} onChange={(e) => updateOutput(i, "is_primary", e.target.checked)} />
                        Primary
                      </label>
                      <Button type="button" variant="ghost" onClick={() => setOutputLines(outputLines.filter((_, idx) => idx !== i))} disabled={outputLines.length === 1}>✕</Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="mt-2" onClick={() => setOutputLines([...outputLines, emptyOutputLine()])}>+ Add output</Button>
              </div>

              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button type="submit">{editingId ? "Save Changes" : "Save Recipe"}</Button>
                {error && <span className="text-red text-sm">{error}</span>}
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <Card>
        <Table
          emptyLabel="No recipes yet. Define your first BOM to guide production orders."
          columns={[
            { key: "name", label: "Recipe" },
            { key: "plant", label: "Plant", render: (row) => <Badge tone="amber">{row.plant}</Badge> },
            { key: "ref", label: "Reference size", render: (row) => row.reference_batch_size },
            {
              key: "inputs",
              label: "Inputs",
              render: (row) => row.input_lines.map((l) => `${l.quantity} ${itemLookup[l.item_id]?.name || ""}`).join(", "),
            },
            {
              key: "outputs",
              label: "Outputs",
              render: (row) => row.output_lines.map((l) => `${l.quantity} ${itemLookup[l.item_id]?.name || ""}${l.is_primary ? "" : " (byproduct)"}`).join(", "),
            },
            {
              key: "actions",
              label: "",
              render: (row) => (
                <RowActions
                  onEdit={() => startEdit(row)}
                  onDelete={() => handleDelete(row)}
                  deleteConfirm={`Remove "${row.name}" from active recipes? Past production orders keep their own recorded data either way.`}
                />
              ),
            },
          ]}
          rows={boms}
        />
      </Card>
    </div>
  );
}
