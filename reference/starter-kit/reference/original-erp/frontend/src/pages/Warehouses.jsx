import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, RowActions, FormPanel } from "../components/ui";

const WH_TYPES = [
  { value: "tank", label: "Tank (crude oil)" },
  { value: "raw_material_store", label: "Raw Material Store" },
  { value: "packaging_store", label: "Packaging Store" },
  { value: "finished_goods", label: "Finished Goods Warehouse" },
  { value: "toll_customer_stock", label: "Toll Customer Stock" },
];

const TYPE_TONES = {
  tank: "amber",
  raw_material_store: "neutral",
  packaging_store: "neutral",
  finished_goods: "green",
  toll_customer_stock: "red",
};

const emptyForm = { name: "", warehouse_type: "tank", capacity: "" };

export default function Warehouses() {
  const [warehouses, setWarehouses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  async function load() {
    setWarehouses(await api.getWarehouses());
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function startEdit(wh) {
    setEditingId(wh.id);
    setForm({ name: wh.name, warehouse_type: wh.warehouse_type, capacity: wh.capacity ?? "" });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = { ...form, capacity: form.capacity ? Number(form.capacity) : null };
      if (editingId) {
        await api.updateWarehouse(editingId, payload);
      } else {
        await api.createWarehouse(payload);
      }
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    await api.deleteWarehouse(id);
    load();
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Masters"
        title="Warehouses"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Warehouse</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Warehouse" : "New Warehouse"} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <Input label="Name" placeholder="Crude Tank 1" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label="Type" value={form.warehouse_type} onChange={(e) => setForm({ ...form, warehouse_type: e.target.value })}>
              {WH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <Input label="Capacity (optional)" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            <div className="col-span-3 flex items-center gap-3">
              <Button type="submit">{editingId ? "Save Changes" : "Save Warehouse"}</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}

      <Card>
        <Table
          emptyLabel="No warehouses yet. Add your tanks and stores to start receiving stock."
          columns={[
            { key: "name", label: "Name" },
            { key: "warehouse_type", label: "Type", render: (row) => <Badge tone={TYPE_TONES[row.warehouse_type]}>{row.warehouse_type.replace(/_/g, " ")}</Badge> },
            { key: "capacity", label: "Capacity", render: (row) => row.capacity ?? "—" },
            {
              key: "actions",
              label: "",
              render: (row) => (
                <RowActions
                  onEdit={() => startEdit(row)}
                  onDelete={() => handleDelete(row.id)}
                  deleteConfirm={`Remove ${row.name} from active warehouses? Past stock history is kept.`}
                />
              ),
            },
          ]}
          rows={warehouses}
        />
      </Card>
    </div>
  );
}
