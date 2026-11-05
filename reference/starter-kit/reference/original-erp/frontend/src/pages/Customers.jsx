import { useEffect, useState } from "react";
import { api } from "../api";
import { generateSequentialNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Table, RowActions, formatPKR, FormPanel } from "../components/ui";
import LedgerDetail from "../components/LedgerDetail";

const emptyForm = { customer_number: "", name: "", contact_person: "", phone: "", address: "" };

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [balances, setBalances] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  async function load() {
    setLoading(true);
    const data = await api.getCustomers();
    setCustomers(data);
    const balMap = {};
    await Promise.all(
      data.map(async (c) => {
        const b = await api.getCustomerBalance(c.id);
        balMap[c.id] = b.balance;
      })
    );
    setBalances(balMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, customer_number: generateSequentialNumber("CUST", customers.map((c) => c.customer_number)) });
    setShowForm(true);
  }

  function startEdit(customer) {
    setEditingId(customer.id);
    setForm({
      customer_number: customer.customer_number || "",
      name: customer.name,
      contact_person: customer.contact_person || "",
      phone: customer.phone || "",
      address: customer.address || "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      if (editingId) {
        await api.updateCustomer(editingId, form);
      } else {
        await api.createCustomer(form);
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
    await api.deleteCustomer(id);
    load();
  }

  const filteredCustomers = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.customer_number || "").toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.contact_person || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.address || "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      {selectedCustomer ? (
        <LedgerDetail
          partyName={selectedCustomer.name}
          fetchLedger={(params) => api.getCustomerLedger(selectedCustomer.id, params)}
          debitLabel="Billed"
          creditLabel="Received"
          balanceLabel="Owed to us"
          balanceTone="green"
          onBack={() => setSelectedCustomer(null)}
        />
      ) : (
      <>
      <SectionTitle
        eyebrow="Toll / Job-Work"
        title="Customers"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Customer</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Customer" : "New Customer"} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Customer number" required value={form.customer_number} onChange={(e) => setForm({ ...form, customer_number: e.target.value })} />
            <Input label="Customer name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Contact person" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <div className="col-span-2 flex items-center gap-3">
              <Button type="submit">{editingId ? "Save Changes" : "Save Customer"}</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}

      <div className="flex gap-3 mb-4">
        <Input placeholder="Search by number, name, phone, contact, or address…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
      </div>

      <Card>
        {loading ? (
          <div className="text-text-muted text-sm">Loading customers&hellip;</div>
        ) : (
          <Table
            emptyLabel={customers.length === 0 ? "No toll customers yet. Add the first company sending you material to process." : "No customers match your search."}
            columns={[
              { key: "customer_number", label: "Number", mono: true, render: (row) => row.customer_number || "—" },
              {
                key: "name", label: "Customer",
                render: (row) => (
                  <button type="button" className="text-amber-soft hover:underline text-left" onClick={() => setSelectedCustomer(row)}>
                    {row.name}
                  </button>
                ),
              },
              { key: "contact_person", label: "Contact" },
              { key: "phone", label: "Phone" },
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
                    deleteConfirm={`Remove ${row.name} from active customers? Past toll history and ledger are kept.`}
                  />
                ),
              },
            ]}
            rows={filteredCustomers}
          />
        )}
      </Card>
      </>
      )}
    </div>
  );
}
