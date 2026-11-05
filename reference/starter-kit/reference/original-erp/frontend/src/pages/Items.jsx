import { useEffect, useRef, useState } from "react";
import { api, downloadFile, pktToday } from "../api";
import { printReport } from "../printReport";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, RowActions, FormPanel, confirmDialog, notify } from "../components/ui";

const ITEM_TYPES = [
  { value: "crude_oil", label: "Crude Oil" },
  { value: "chemical", label: "Chemical" },
  { value: "packaging", label: "Packaging Material" },
  { value: "finished_good", label: "Finished Good" },
];

const TYPE_TONES = { crude_oil: "amber", chemical: "red", packaging: "neutral", finished_good: "green" };

const emptyForm = { code: "", name: "", item_type: "crude_oil", uom_id: "", reorder_level: "", pack_size: "", units_per_case: "", density_kg_per_liter: "" };
const emptyUomForm = { name: "", symbol: "" };

export default function Items() {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showUomSection, setShowUomSection] = useState(false);
  const [showUomForm, setShowUomForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingUomId, setEditingUomId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [uomForm, setUomForm] = useState(emptyUomForm);
  const [error, setError] = useState("");
  const [uomError, setUomError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [uomFilter, setUomFilter] = useState("all");
  const [uploadResult, setUploadResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uomUploadResult, setUomUploadResult] = useState(null);
  const [uomUploading, setUomUploading] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);
  const [uomPurgeResult, setUomPurgeResult] = useState(null);
  const fileInputRef = useRef(null);
  const uomFileInputRef = useRef(null);

  async function load() {
    const [itemData, uomData] = await Promise.all([api.getItems(), api.getUOMs()]);
    setItems(itemData);
    setUoms(uomData);
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, uom_id: uoms[0]?.id || "" });
    setShowForm(true);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm({ code: item.code, name: item.name, item_type: item.item_type, uom_id: item.uom_id, reorder_level: item.reorder_level ?? "", pack_size: item.pack_size || "", units_per_case: item.units_per_case ?? "", density_kg_per_liter: item.density_kg_per_liter ?? "" });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = { ...form, uom_id: Number(form.uom_id), reorder_level: form.reorder_level ? Number(form.reorder_level) : null, units_per_case: form.units_per_case ? Number(form.units_per_case) : null, pack_size: form.pack_size || null, density_kg_per_liter: form.density_kg_per_liter ? Number(form.density_kg_per_liter) : null };
      if (editingId) {
        await api.updateItem(editingId, payload);
      } else {
        await api.createItem(payload);
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
    try {
      await api.deleteItem(id);
      load();
    } catch (err) {
      notify(err.message, "error", "Can't delete this item");
    }
  }

  function startCreateUom() {
    setEditingUomId(null);
    setUomForm(emptyUomForm);
    setUomError("");
    setShowUomForm(true);
  }

  function startEditUom(uom) {
    setEditingUomId(uom.id);
    setUomForm({ name: uom.name, symbol: uom.symbol });
    setUomError("");
    setShowUomForm(true);
  }

  async function handleSubmitUom(e) {
    e.preventDefault();
    setUomError("");
    try {
      if (editingUomId) {
        await api.updateUOM(editingUomId, uomForm);
      } else {
        await api.createUOM(uomForm);
      }
      setUomForm(emptyUomForm);
      setEditingUomId(null);
      setShowUomForm(false);
      load();
    } catch (err) {
      setUomError(err.message);
    }
  }

  async function handleDeleteUom(id) {
    await api.deleteUOM(id);
    load();
  }

  async function handlePurgeUoms() {
    if (!(await confirmDialog("Permanently remove deleted units that are no longer used by any item? This can't be undone (but anything still in use is left alone)."))) return;
    const result = await api.purgeInactiveUOMs();
    setUomPurgeResult(result);
    load();
  }

  async function handlePurgeItems() {
    if (!(await confirmDialog("Permanently remove deleted items that have no history against them (stock, orders, etc.)? This can't be undone (but anything still referenced is left alone)."))) return;
    const result = await api.purgeInactiveItems();
    setPurgeResult(result);
    load();
  }

  async function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const result = await api.bulkUploadItems(file);
      setUploadResult({ success: true, message: result.message });
      load();
    } catch (err) {
      setUploadResult({ success: false, message: err.message, rowErrors: err.rowErrors });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUomFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUomUploading(true);
    setUomUploadResult(null);
    try {
      const result = await api.bulkUploadUOMs(file);
      setUomUploadResult({ success: true, message: result.message });
      load();
    } catch (err) {
      setUomUploadResult({ success: false, message: err.message, rowErrors: err.rowErrors });
    } finally {
      setUomUploading(false);
      if (uomFileInputRef.current) uomFileInputRef.current.value = "";
    }
  }

  const uomLookup = Object.fromEntries(uoms.map((u) => [u.id, u.symbol]));

  const filteredItems = items.filter((it) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q);
    const matchesType = typeFilter === "all" || it.item_type === typeFilter;
    const matchesUom = uomFilter === "all" || String(it.uom_id) === uomFilter;
    return matchesSearch && matchesType && matchesUom;
  });

  async function handlePrintList() {
    setBusy(true);
    try {
      const [rows, settings] = await Promise.all([api.getItemListReport(), api.getInvoiceSettings().catch(() => null)]);
      printReport(settings, {
        title: "Item List",
        subtitle: `${rows.length} active items · ${new Date().toLocaleDateString()}`,
        sections: [{
          columns: [
            { label: "Code" }, { label: "Item" }, { label: "Type" }, { label: "Unit" }, { label: "Pack" },
            { label: "Reorder at", align: "right" }, { label: "On hand", align: "right" },
          ],
          rows: rows.map((r) => [r.code, r.name, r.item_type.replace(/_/g, " "), r.unit, r.pack_size || "—",
            r.reorder_level ?? "—", r.on_hand]),
          empty: "No items yet.",
        }],
      });
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadList() {
    setBusy(true);
    try {
      await downloadFile("/items/report/excel", `item_list_${pktToday()}.xlsx`);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Masters"
        title="Items"
        action={
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={handlePrintList} disabled={busy}>🖨 Print list</Button>
            <Button variant="secondary" onClick={handleDownloadList} disabled={busy}>⬇ Download list</Button>
            <Button variant="ghost" onClick={handlePurgeItems}>Purge Deleted Items</Button>
            <Button variant="secondary" onClick={() => setShowUomSection((s) => !s)}>
              {showUomSection ? "Hide Units" : "Manage Units"}
            </Button>
            <Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Item</Button>
          </div>
        }
      />

      {purgeResult && (
        <div className="text-xs text-text-muted mb-4">
          Removed {purgeResult.purged_count} unused deleted item{purgeResult.purged_count === 1 ? "" : "s"}.
          {purgeResult.kept_in_use.length > 0 && ` ${purgeResult.kept_in_use.length} left alone (still referenced by stock or order history).`}
        </div>
      )}

      {showUomSection && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Units of Measure</div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handlePurgeUoms}>Purge Deleted Units</Button>
              <Button variant="secondary" onClick={() => (showUomForm ? setShowUomForm(false) : startCreateUom())}>
                {showUomForm ? "Cancel" : "+ New Unit"}
              </Button>
            </div>
          </div>
          {uomPurgeResult && (
            <div className="text-xs text-text-muted mb-3">
              Removed {uomPurgeResult.purged_count} unused deleted unit{uomPurgeResult.purged_count === 1 ? "" : "s"}.
              {uomPurgeResult.kept_in_use.length > 0 && ` ${uomPurgeResult.kept_in_use.length} left alone (still in use by an item).`}
            </div>
          )}

          {showUomForm && (
            <form onSubmit={handleSubmitUom} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end mb-4 bg-surface-2 rounded-md p-3">
              <Input label="Unit name" placeholder="Metric Ton" required value={uomForm.name} onChange={(e) => setUomForm({ ...uomForm, name: e.target.value })} />
              <Input label="Symbol" placeholder="MT" required value={uomForm.symbol} onChange={(e) => setUomForm({ ...uomForm, symbol: e.target.value })} />
              <div className="flex items-center gap-3">
                <Button type="submit">{editingUomId ? "Save Changes" : "Save Unit"}</Button>
                {uomError && <span className="text-red text-xs">{uomError}</span>}
              </div>
            </form>
          )}

          <div className="mb-4 border-t border-border pt-4">
            <div className="text-xs text-text-muted mb-2">
              Bulk upload units from Excel — download the template, fill in name + symbol, upload it back.
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => downloadFile("/uom/bulk-upload/template", "uom_template.xlsx").catch((e) => notify(e.message, "error"))}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 text-text border border-border hover:border-amber transition-colors"
              >
                Download Template
              </button>
              <Button variant="secondary" onClick={() => uomFileInputRef.current?.click()} disabled={uomUploading}>
                {uomUploading ? "Uploading…" : "Upload Filled Template"}
              </Button>
              <input ref={uomFileInputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={handleUomFileSelected} />
            </div>
            {uomUploadResult && (
              <div className={`mt-2 text-xs ${uomUploadResult.success ? "text-green" : "text-red"}`}>
                {uomUploadResult.message}
                {uomUploadResult.rowErrors && (
                  <ul className="mt-1 list-disc list-inside">
                    {uomUploadResult.rowErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          <Table
            emptyLabel="No units yet. Add your first one above, e.g. Metric Ton."
            columns={[
              { key: "name", label: "Name" },
              { key: "symbol", label: "Symbol", mono: true },
              {
                key: "actions", label: "",
                render: (row) => (
                  <RowActions
                    onEdit={() => startEditUom(row)}
                    onDelete={() => handleDeleteUom(row.id)}
                    deleteConfirm={`Remove ${row.name} (${row.symbol})? Items already using it are unaffected.`}
                  />
                ),
              },
            ]}
            rows={uoms}
          />
        </Card>
      )}

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Item" : "New Item"} onClose={() => setShowForm(false)}>
          {uoms.length === 0 ? (
            <div className="text-text-muted text-sm">Add a unit of measure first (e.g. Metric Ton) — click "Manage Units" above.</div>
          ) : (
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Item code" placeholder="CRD-001" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              <Input label="Item name" placeholder="Crude Sunflower Oil" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Select label="Item type" value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value })}>
                {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <Select label="Unit of measure" value={form.uom_id} onChange={(e) => setForm({ ...form, uom_id: e.target.value })}>
                {uoms.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
              </Select>
              <Input label="Reorder level (optional)" type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} />
              <Input label="Pack size (optional)" placeholder="e.g. 5L, 1kg" value={form.pack_size} onChange={(e) => setForm({ ...form, pack_size: e.target.value })} />
              <Input label="Units per case (optional)" type="number" placeholder="e.g. 12" value={form.units_per_case} onChange={(e) => setForm({ ...form, units_per_case: e.target.value })} />
              <Input label="Density kg/L (optional, for oils)" type="number" placeholder="e.g. 0.92" value={form.density_kg_per_liter} onChange={(e) => setForm({ ...form, density_kg_per_liter: e.target.value })} />
              <div className="col-span-1 sm:col-span-2 flex items-center gap-3">
                <Button type="submit">{editingId ? "Save Changes" : "Save Item"}</Button>
                {error && <span className="text-red text-sm">{error}</span>}
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <Card className="mb-6">
        <div className="text-sm font-medium mb-2">Bulk upload items from Excel</div>
        <div className="text-xs text-text-muted mb-3">
          Download the template, fill in your items (code, name, type, unit symbol, and optional pack details),
          then upload it here. Either every row in the file is created, or none are — so a mistake in one row
          won't leave you with a half-finished import.
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => downloadFile("/items/bulk-upload/template", "items_template.xlsx").catch((e) => notify(e.message, "error"))}
            className="px-4 py-2 rounded-md text-sm font-medium bg-surface-2 text-text border border-border hover:border-amber transition-colors"
          >
            Download Template
          </button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "Upload Filled Template"}
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={handleFileSelected} />
        </div>
        {uploadResult && (
          <div className={`mt-3 text-sm ${uploadResult.success ? "text-green" : "text-red"}`}>
            {uploadResult.message}
            {uploadResult.rowErrors && (
              <ul className="mt-1 list-disc list-inside text-xs">
                {uploadResult.rowErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-3 mb-4">
        <Input placeholder="Search by name or code…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="max-w-xs">
          <option value="all">All types</option>
          {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Select value={uomFilter} onChange={(e) => setUomFilter(e.target.value)} className="max-w-xs">
          <option value="all">All units</option>
          {uoms.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
        </Select>
      </div>

      <Card>
        <Table
          emptyLabel={items.length === 0 ? "No items yet. Add a unit of measure, then your first item." : "No items match your search/filter."}
          columns={[
            { key: "code", label: "Code", mono: true },
            { key: "name", label: "Name" },
            { key: "item_type", label: "Type", render: (row) => <Badge tone={TYPE_TONES[row.item_type]}>{row.item_type.replace("_", " ")}</Badge> },
            { key: "uom", label: "Unit", render: (row) => uomLookup[row.uom_id] || "—" },
            { key: "pack_size", label: "Pack size", render: (row) => row.pack_size || "—" },
            { key: "reorder_level", label: "Reorder level", render: (row) => row.reorder_level ?? "—" },
            {
              key: "actions",
              label: "",
              render: (row) => (
                <RowActions
                  onEdit={() => startEdit(row)}
                  onDelete={() => handleDelete(row.id)}
                  deleteConfirm={`Remove ${row.name} from active items? Past stock and order history are kept.`}
                />
              ),
            },
          ]}
          rows={filteredItems}
        />
      </Card>
    </div>
  );
}
