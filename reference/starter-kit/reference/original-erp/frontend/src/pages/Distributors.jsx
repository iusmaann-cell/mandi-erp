import { useEffect, useState } from "react";
import { api } from "../api";
import { generateSequentialNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Table, RowActions, formatPKR, FormPanel } from "../components/ui";
import LedgerDetail from "../components/LedgerDetail";

const emptyForm = { distributor_number: "", name: "", contact_person: "", phone: "", address: "", city: "", payment_terms: "", credit_limit: "", opening_balance: 0 };

export default function Distributors() {
  const [distributors, setDistributors] = useState([]);
  const [balances, setBalances] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedDistributor, setSelectedDistributor] = useState(null);

  async function load() {
    setLoading(true);
    const data = await api.getDistributors();
    setDistributors(data);
    const balMap = {};
    await Promise.all(
      data.map(async (d) => {
        const b = await api.getDistributorBalance(d.id);
        balMap[d.id] = b.balance;
      })
    );
    setBalances(balMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, distributor_number: generateSequentialNumber("DIST", distributors.map((d) => d.distributor_number)) });
    setShowForm(true);
  }

  function startEdit(d) {
    setEditingId(d.id);
    setForm({
      distributor_number: d.distributor_number || "",
      name: d.name, contact_person: d.contact_person || "", phone: d.phone || "",
      address: d.address || "", city: d.city || "", payment_terms: d.payment_terms || "",
      credit_limit: d.credit_limit ?? "", opening_balance: d.opening_balance,
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        ...form,
        credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
        opening_balance: Number(form.opening_balance) || 0,
      };
      if (editingId) {
        await api.updateDistributor(editingId, payload);
      } else {
        await api.createDistributor(payload);
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
    await api.deleteDistributor(id);
    load();
  }

  const filteredDistributors = distributors.filter((d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (d.distributor_number || "").toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      (d.contact_person || "").toLowerCase().includes(q) ||
      (d.phone || "").toLowerCase().includes(q) ||
      (d.city || "").toLowerCase().includes(q) ||
      (d.address || "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {selectedDistributor ? (
        <LedgerDetail
          partyName={selectedDistributor.name}
          fetchLedger={(params) => api.getDistributorLedger(selectedDistributor.id, params)}
          debitLabel="Billed"
          creditLabel="Received"
          balanceLabel="Owed to us"
          balanceTone="green"
          onBack={() => setSelectedDistributor(null)}
        />
      ) : (
      <>
      <SectionTitle
        eyebrow="Sales"
        title="Distributors"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Distributor</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Distributor" : "New Distributor"} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Distributor number" required value={form.distributor_number} onChange={(e) => setForm({ ...form, distributor_number: e.target.value })} />
            <Input label="Distributor name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Contact person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input label="Payment terms" placeholder="e.g. Net 30" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
            <Input label="Credit limit (optional, Rs.)" type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
            <Input label="Opening balance (Rs.)" type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
            <div className="col-span-2 flex items-center gap-3">
              <Button type="submit">{editingId ? "Save Changes" : "Save Distributor"}</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}

      <div className="flex gap-3 mb-4">
        <Input placeholder="Search by number, name, phone, city, contact, or address…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
      </div>

      <Card>
        {loading ? (
          <div className="text-text-muted text-sm">Loading distributors&hellip;</div>
        ) : (
          <Table
            emptyLabel={distributors.length === 0 ? "No distributors yet. Add your first buyer of Riwayat products." : "No distributors match your search."}
            columns={[
              { key: "distributor_number", label: "Number", mono: true, render: (row) => row.distributor_number || "—" },
              {
                key: "name", label: "Distributor",
                render: (row) => (
                  <button type="button" className="text-amber-soft hover:underline text-left" onClick={() => setSelectedDistributor(row)}>
                    {row.name}
                  </button>
                ),
              },
              { key: "city", label: "City" },
              { key: "phone", label: "Phone" },
              { key: "payment_terms", label: "Terms" },
              {
                key: "balance",
                label: "Owed to us",
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
                    deleteConfirm={`Remove ${row.name} from active distributors? Past orders and ledger history are kept.`}
                  />
                ),
              },
            ]}
            rows={filteredDistributors}
          />
        )}
      </Card>
      </>
      )}
    </div>
  );
}
