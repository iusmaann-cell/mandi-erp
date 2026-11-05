import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, RowActions, formatPKR, FormPanel, Modal, DetailRow } from "../components/ui";
import LedgerDetail from "../components/LedgerDetail";

const emptyForm = { name: "", contact_person: "", phone: "", payment_terms: "", opening_balance: 0 };
const BALANCE_FILTERS = [
  { value: "all", label: "All vendors" },
  { value: "owing", label: "Balance owed" },
  { value: "settled", label: "Settled" },
];

function emptyBankAccountRow() {
  return { id: null, bank_name: "", account_title: "", account_number: "" };
}

export default function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [balances, setBalances] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState("all");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [detailVendor, setDetailVendor] = useState(null);

  async function load() {
    setLoading(true);
    const [vendorData, itemData] = await Promise.all([api.getVendors(), api.getItems()]);
    setVendors(vendorData);
    setItems(itemData);
    const balMap = {};
    await Promise.all(
      vendorData.map(async (v) => {
        const b = await api.getVendorBalance(v.id);
        balMap[v.id] = b.balance;
      })
    );
    setBalances(balMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const itemLookup = Object.fromEntries(items.map((i) => [i.id, i.name]));

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedItemIds([]);
    setBankAccounts([]);
    setError("");
    setShowForm(true);
  }

  function startEdit(vendor) {
    setEditingId(vendor.id);
    setForm({
      name: vendor.name,
      contact_person: vendor.contact_person || "",
      phone: vendor.phone || "",
      payment_terms: vendor.payment_terms || "",
      opening_balance: vendor.opening_balance,
    });
    setSelectedItemIds(vendor.item_ids || []);
    setBankAccounts((vendor.bank_accounts || []).map((a) => ({ ...a })));
    setError("");
    setShowForm(true);
  }

  function toggleItem(itemId) {
    setSelectedItemIds((prev) => prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]);
  }

  function updateBankAccount(i, field, value) {
    const next = [...bankAccounts]; next[i] = { ...next[i], [field]: value }; setBankAccounts(next);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        ...form,
        opening_balance: Number(form.opening_balance) || 0,
        item_ids: selectedItemIds,
        bank_accounts: bankAccounts
          .filter((a) => a.bank_name && a.account_number)
          .map((a) => ({ id: a.id || null, bank_name: a.bank_name, account_title: a.account_title || null, account_number: a.account_number })),
      };
      if (editingId) {
        await api.updateVendor(editingId, payload);
      } else {
        await api.createVendor(payload);
      }
      setForm(emptyForm);
      setSelectedItemIds([]);
      setBankAccounts([]);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    await api.deleteVendor(id);
    load();
  }

  const filteredVendors = vendors.filter((v) => {
    const q = search.trim().toLowerCase();
    const suppliedItemNames = (v.item_ids || []).map((id) => itemLookup[id] || "").join(" ").toLowerCase();
    const matchesSearch = !q
      || v.name.toLowerCase().includes(q)
      || (v.phone || "").toLowerCase().includes(q)
      || suppliedItemNames.includes(q);
    const bal = balances[v.id] ?? 0;
    const matchesBalance = balanceFilter === "all" || (balanceFilter === "owing" ? bal > 0 : bal <= 0);
    return matchesSearch && matchesBalance;
  });

  return (
    <div>
      {selectedVendor ? (
        <LedgerDetail
          partyName={selectedVendor.name}
          fetchLedger={(params) => api.getVendorLedger(selectedVendor.id, params)}
          debitLabel="Billed"
          creditLabel="Paid"
          balanceLabel="Owed to vendor"
          onBack={() => setSelectedVendor(null)}
        />
      ) : (
      <>
      <SectionTitle
        eyebrow="Procurement"
        title="Vendors"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Vendor</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Vendor" : "New Vendor"} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Vendor name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Contact person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Input label="Payment terms" placeholder="e.g. Net 15" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
              <Input label="Opening balance (Rs.)" type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">Items purchased from this vendor (optional)</label>
              {items.length === 0 ? (
                <div className="text-xs text-text-muted">No items in the master list yet.</div>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-border rounded-md p-2 bg-surface-2">
                  {items.map((it) => (
                    <label key={it.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                      <input type="checkbox" checked={selectedItemIds.includes(it.id)} onChange={() => toggleItem(it.id)} />
                      {it.name} <span className="text-text-muted text-xs">({it.code})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-text-muted">Bank accounts (optional — for recording split payments later)</label>
                <Button type="button" variant="secondary" onClick={() => setBankAccounts([...bankAccounts, emptyBankAccountRow()])}>+ Add account</Button>
              </div>
              <div className="space-y-2">
                {bankAccounts.map((acc, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-[1.2fr_1.2fr_1.5fr_auto] gap-2">
                    <Input placeholder="Bank name" value={acc.bank_name} onChange={(e) => updateBankAccount(i, "bank_name", e.target.value)} />
                    <Input placeholder="Account title (optional)" value={acc.account_title || ""} onChange={(e) => updateBankAccount(i, "account_title", e.target.value)} />
                    <Input placeholder="Account number" value={acc.account_number} onChange={(e) => updateBankAccount(i, "account_number", e.target.value)} />
                    <Button type="button" variant="ghost" onClick={() => setBankAccounts(bankAccounts.filter((_, idx) => idx !== i))}>✕</Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit">{editingId ? "Save Changes" : "Save Vendor"}</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <Input placeholder="Search by name, phone, or item…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} className="max-w-xs">
          {BALANCE_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
      </div>

      <Card>
        {loading ? (
          <div className="text-text-muted text-sm">Loading vendors&hellip;</div>
        ) : (
          <Table
            emptyLabel={vendors.length === 0 ? "No vendors yet. Add your first crude oil supplier above." : "No vendors match your search/filter."}
            columns={[
              {
                key: "name", label: "Vendor",
                render: (row) => (
                  <button type="button" className="text-amber-soft hover:underline text-left" onClick={() => setDetailVendor(row)}>
                    {row.name}
                  </button>
                ),
              },
              { key: "contact_person", label: "Contact" },
              { key: "phone", label: "Phone" },
              {
                key: "items", label: "Supplies",
                render: (row) => (row.item_ids || []).length === 0
                  ? <span className="text-text-muted text-xs">—</span>
                  : (
                    <div className="flex flex-wrap gap-1">
                      {(row.item_ids || []).slice(0, 3).map((id) => <Badge key={id} tone="neutral">{itemLookup[id] || "?"}</Badge>)}
                      {(row.item_ids || []).length > 3 && <span className="text-text-muted text-xs">+{row.item_ids.length - 3} more</span>}
                    </div>
                  ),
              },
              {
                key: "balance",
                label: "Balance owed",
                mono: true,
                render: (row) => (
                  <span className={balances[row.id] > 0 ? "text-goldtext font-bold" : "text-text-muted"}>
                    Rs. {formatPKR(balances[row.id] ?? 0)}
                  </span>
                ),
              },
              {
                key: "actions",
                label: "",
                render: (row) => (
                  <RowActions
                    onEdit={() => startEdit(row)}
                    onDelete={() => handleDelete(row.id)}
                    deleteConfirm={`Remove ${row.name} from active vendors? Past purchase orders and ledger history are kept.`}
                  />
                ),
              },
            ]}
            rows={filteredVendors}
            onRowClick={(row) => setDetailVendor(row)}
          />
        )}
      </Card>
      </>
      )}
      {detailVendor && (
        <Modal
          wide
          title={detailVendor.name}
          subtitle="Vendor details"
          onClose={() => setDetailVendor(null)}
          footer={
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="secondary" onClick={() => { const v = detailVendor; setDetailVendor(null); setSelectedVendor(v); }}>View ledger</Button>
              <Button onClick={() => { const v = detailVendor; setDetailVendor(null); startEdit(v); }}>Edit</Button>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="rounded-[22px] bg-surface-2 px-5 py-2">
              <DetailRow label="Contact person">{detailVendor.contact_person || "—"}</DetailRow>
              <DetailRow label="Phone">{detailVendor.phone || "—"}</DetailRow>
              <DetailRow label="Payment terms">{detailVendor.payment_terms || "—"}</DetailRow>
              <DetailRow label="Opening balance">Rs. {formatPKR(detailVendor.opening_balance || 0)}</DetailRow>
              <DetailRow label="Balance owed">Rs. {formatPKR(balances[detailVendor.id] ?? 0)}</DetailRow>
            </div>
            <div>
              <div className="text-[13px] font-bold text-forest mb-2">Items supplied</div>
              {(detailVendor.item_ids || []).length === 0
                ? <div className="text-sm text-text-muted">None linked.</div>
                : <div className="flex flex-wrap gap-1">{detailVendor.item_ids.map((id) => <Badge key={id} tone="neutral">{itemLookup[id] || "?"}</Badge>)}</div>}
            </div>
            <div>
              <div className="text-[13px] font-bold text-forest mb-2">Bank accounts</div>
              {(detailVendor.bank_accounts || []).length === 0
                ? <div className="text-sm text-text-muted">No bank accounts saved.</div>
                : <div className="space-y-2">{detailVendor.bank_accounts.map((a, i) => (
                    <div key={a.id ?? i} className="rounded-[20px] bg-surface-2 p-4 text-sm">
                      <div className="font-semibold">{a.bank_name}</div>
                      <div className="text-text-muted">{a.account_title}</div>
                      <div className="font-mono">{a.account_number}</div>
                    </div>
                  ))}</div>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
