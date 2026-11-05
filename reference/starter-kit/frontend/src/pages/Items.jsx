import { useEffect, useState } from "react";
import { api, downloadFile } from "../api";
import { useAuth } from "../auth";
import { Card, SectionTitle, Button, Input, Textarea, Table, RowActions, FormPanel, formatPKR, notify } from "../components/ui";
import { useIntent } from "../nav";
import { generateSequentialNumber } from "../docNumbers";

/* EXAMPLE PAGE — the template for every master-data screen:
   list in a <Table>, create/edit in a <FormPanel>, delete via <RowActions> (asks for confirmation),
   errors shown inline or as a toast, buttons hidden unless the role allows them. */
const emptyForm = { code: "", name: "", unit_price: "", notes: "" };

export default function Items() {
  const { can, canDo } = useAuth();          // can("items","edit") -> module level; canDo("delete_items") -> extra action
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  const load = async () => setItems(await api.getItems());
  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, code: generateSequentialNumber("ITM", items.map((i) => i.code)) });
    setShowForm(true);
  }
  function startEdit(it) {
    setEditingId(it.id);
    setForm({ code: it.code, name: it.name, unit_price: it.unit_price, notes: it.notes || "" });
    setShowForm(true);
  }
  // Quick-add buttons elsewhere call navigate("items", { action: "new" }) -> opens the form here.
  useIntent("items", (action) => { if (action === "new") startCreate(); });

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = { ...form, unit_price: Number(form.unit_price) || 0 };
      if (editingId) await api.updateItem(editingId, payload);
      else await api.createItem(payload);
      setShowForm(false);
      load();
    } catch (err) { setError(err.message); }
  }

  async function handleDelete(id) {
    try { await api.deleteItem(id); load(); }
    catch (err) { notify(err.message, "error", "Can't delete this item"); }
  }

  const canEdit = can("items", "edit");
  return (
    <div>
      <SectionTitle
        eyebrow="Catalogue"
        title="Items"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => downloadFile("/items/report", "item-list.xlsx").catch((e) => notify(e.message, "error"))}>Excel</Button>
            {canEdit && <Button onClick={startCreate}>+ New Item</Button>}
          </div>
        }
      />
      {showForm && (
        <FormPanel title={editingId ? "Edit Item" : "New Item"} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Unit price" type="number" step="any" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
            <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="sm:col-span-2 flex items-center gap-3">
              <Button type="submit">{editingId ? "Save Changes" : "Save Item"}</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}
      <Card>
        <Table
          emptyLabel="No items yet. Add your first one."
          rows={items}
          columns={[
            { key: "code", label: "Code", mono: true },
            { key: "name", label: "Name" },
            { key: "unit_price", label: "Unit price", mono: true, render: (r) => formatPKR(r.unit_price) },
            { key: "actions", label: "", render: (row) => canEdit ? (
              <RowActions
                onEdit={() => startEdit(row)}
                onDelete={canDo("delete_items") ? () => handleDelete(row.id) : undefined}
                deleteConfirm={`Delete ${row.name}?`}
              />
            ) : null },
          ]}
        />
      </Card>
    </div>
  );
}
