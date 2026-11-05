import { useEffect, useState } from "react";
import { api, pktToday, formatDay, pktDay } from "../api";
import { Card, SectionTitle, Button, Input, Select, Textarea, Table, Badge, RowActions, Modal, FormPanel, formatPKR, notify } from "../components/ui";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online transfer" },
  { value: "cheque", label: "Cheque" },
];
const methodLabel = (m) => METHODS.find((x) => x.value === m)?.label || "Cash";

const emptyForm = () => ({ employee_id: "", advance_date: pktToday(), amount: "", payment_method: "cash", notes: "" });

export default function AdvanceSalary() {
  const [employees, setEmployees] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [balances, setBalances] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [ledger, setLedger] = useState(null);
  const [filterEmp, setFilterEmp] = useState("all");

  async function load() {
    const [emps, adv, bal] = await Promise.all([api.getEmployees(), api.getSalaryAdvances(), api.getAdvanceBalances()]);
    setEmployees(emps);
    setAdvances(adv);
    setBalances(bal);
  }
  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null); setForm({ ...emptyForm(), employee_id: employees[0]?.id || "" }); setError(""); setShowForm(true);
  }
  function startEdit(a) {
    setEditingId(a.id);
    setForm({ employee_id: a.employee_id, advance_date: pktDay(a.advance_date), amount: a.amount, payment_method: a.payment_method || "cash", notes: a.notes || "" });
    setError(""); setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const amount = Number(form.amount);
    if (!(amount > 0)) { setError("Enter the advance amount."); return; }
    setSaving(true);
    try {
      const payload = { advance_date: `${form.advance_date}T12:00:00`, amount, payment_method: form.payment_method, notes: form.notes || null };
      if (editingId) await api.updateSalaryAdvance(editingId, payload);
      else await api.addSalaryAdvance({ ...payload, employee_id: Number(form.employee_id) });
      setShowForm(false); load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(a) {
    try { await api.deleteSalaryAdvance(a.id); load(); } catch (err) { notify(err.message, "error"); }
  }

  async function openLedger(employeeId) {
    try { setLedger(await api.getAdvanceLedger(employeeId)); } catch (err) { notify(err.message, "error"); }
  }

  const totalOwed = balances.reduce((s, b) => s + b.outstanding, 0);
  const shown = advances.filter((a) => filterEmp === "all" || String(a.employee_id) === filterEmp);

  return (
    <div>
      <SectionTitle eyebrow="HR & Payroll" title="Advance Salary" action={<Button onClick={startCreate}>+ New Advance</Button>} />

      {showForm && (
        <FormPanel title={editingId ? "Edit Advance" : "New Advance"} onClose={() => setShowForm(false)}>
          {employees.length === 0 ? (
            <div className="text-text-muted text-sm">Add employees first.</div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Select label="Employee" value={form.employee_id} disabled={!!editingId} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </Select>
              <Input label="Date given" type="date" required max={pktToday()} value={form.advance_date} onChange={(e) => setForm({ ...form, advance_date: e.target.value })} />
              <Input label="Amount (Rs.)" type="number" min="1" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              <Select label="Paid by" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
              <Textarea label="Note (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <div className="text-xs text-text-muted">The advance is taken back when you generate payroll — you choose how much to deduct each month and the rest stays owed.</div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Advance"}</Button>
                {error && <span className="text-red text-sm">{error}</span>}
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <Card className="mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[13px] font-bold text-forest">Advances still owed by employees</div>
          <div className="stencil text-sm text-text-muted">Total <span className="text-amber-soft font-bold">Rs. {formatPKR(totalOwed)}</span></div>
        </div>
        <Table
          onRowClick={(row) => openLedger(row.employee_id)}
          emptyLabel="No advances given yet."
          columns={[
            { key: "employee_name", label: "Employee" },
            { key: "advanced", label: "Advanced", mono: true, render: (r) => `Rs. ${formatPKR(r.advanced)}` },
            { key: "recovered", label: "Deducted in payroll", mono: true, render: (r) => `Rs. ${formatPKR(r.recovered)}` },
            { key: "outstanding", label: "Still owed", mono: true, render: (r) => (
              <span className={r.outstanding > 0 ? "text-goldtext font-bold" : "text-text-muted"}>Rs. {formatPKR(r.outstanding)}</span>
            ) },
            { key: "ledger", label: "", render: (r) => <button type="button" className="text-xs text-amber-soft hover:underline" onClick={() => openLedger(r.employee_id)}>Ledger</button> },
          ]}
          rows={balances}
        />
      </Card>

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Select label="Employee" value={filterEmp} onChange={(e) => setFilterEmp(e.target.value)} className="max-w-xs">
          <option value="all">All employees</option>
          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </Select>
      </div>

      <Card>
        <Table
          emptyLabel="No advances recorded."
          columns={[
            { key: "date", label: "Date", render: (r) => formatDay(pktDay(r.advance_date)) },
            { key: "employee_name", label: "Employee" },
            { key: "amount", label: "Amount", mono: true, render: (r) => `Rs. ${formatPKR(r.amount)}` },
            { key: "method", label: "Paid by", render: (r) => <Badge tone="neutral">{methodLabel(r.payment_method)}</Badge> },
            { key: "notes", label: "Note", render: (r) => r.notes || "—" },
            { key: "actions", label: "", render: (r) => (
              <RowActions onEdit={() => startEdit(r)} onDelete={() => handleDelete(r)} deleteConfirm={`Delete this advance of Rs. ${formatPKR(r.amount)} for ${r.employee_name}?`} />
            ) },
          ]}
          rows={shown}
        />
      </Card>

      {ledger && (
        <Modal wide title={ledger.employee_name} subtitle="Advance salary ledger" onClose={() => setLedger(null)}>
          <div className="space-y-4">
            <div className="rounded-[22px] bg-mint px-5 py-3 text-sm text-forest flex justify-between">
              <span className="font-bold">Still owed</span>
              <span className="stencil font-extrabold">Rs. {formatPKR(ledger.outstanding)}</span>
            </div>
            {ledger.entries.length === 0 ? (
              <div className="text-sm text-text-muted">Nothing recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {ledger.entries.map((e, i) => (
                  <div key={i} className="rounded-[20px] bg-surface-2 px-4 py-3 text-sm flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-text">{e.label}</div>
                      <div className="text-xs text-text-muted">{formatDay(pktDay(e.date))}{e.method ? ` · ${methodLabel(e.method)}` : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className={`stencil font-bold ${e.debit > 0 ? "text-red" : "text-green"}`}>{e.debit > 0 ? "+" : "−"} Rs. {formatPKR(e.debit || e.credit)}</div>
                      <div className="text-xs text-text-muted">Owed after: Rs. {formatPKR(e.balance)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
