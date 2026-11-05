import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, RowActions, formatPKR, FormPanel } from "../components/ui";

const EMPLOYMENT_TYPES = [
  { value: "permanent", label: "Permanent" },
  { value: "contract", label: "Contract" },
  { value: "daily_wage", label: "Daily Wage" },
];
const PLANTS = ["refining", "hydrogenation", "soap", "packaging"];
const TYPE_TONES = { permanent: "green", contract: "amber", daily_wage: "neutral" };

const emptyForm = {
  name: "", father_name: "", cnic: "", phone: "", address: "", designation: "",
  plant: "", employment_type: "permanent", basic_salary: "", daily_wage_rate: "",
  overtime_rate_per_hour: "", bank_account: "",
};

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  async function load() {
    setEmployees(await api.getEmployees());
  }
  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function startEdit(emp) {
    setEditingId(emp.id);
    setForm({
      name: emp.name, father_name: emp.father_name || "", cnic: emp.cnic || "",
      phone: emp.phone || "", address: emp.address || "", designation: emp.designation || "",
      plant: emp.plant || "", employment_type: emp.employment_type,
      basic_salary: emp.basic_salary ?? "", daily_wage_rate: emp.daily_wage_rate ?? "",
      overtime_rate_per_hour: emp.overtime_rate_per_hour ?? "", bank_account: emp.bank_account || "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        ...form,
        plant: form.plant || null,
        basic_salary: form.basic_salary ? Number(form.basic_salary) : null,
        daily_wage_rate: form.daily_wage_rate ? Number(form.daily_wage_rate) : null,
        overtime_rate_per_hour: form.overtime_rate_per_hour ? Number(form.overtime_rate_per_hour) : null,
      };
      if (editingId) {
        await api.updateEmployee(editingId, payload);
      } else {
        await api.createEmployee(payload);
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
    await api.deleteEmployee(id);
    load();
  }

  return (
    <div>
      <SectionTitle
        eyebrow="HR & Payroll"
        title="Employees"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Employee</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Employee" : "New Employee"} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Father's name" value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} />
            <Input label="CNIC" value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Designation" placeholder="e.g. Boiler Operator" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            <Select label="Plant (optional — leave blank for admin/general)" value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })}>
              <option value="">General / Admin</option>
              {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Select label="Employment type" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            {form.employment_type === "daily_wage" ? (
              <Input label="Daily wage rate (Rs.)" type="number" required value={form.daily_wage_rate} onChange={(e) => setForm({ ...form, daily_wage_rate: e.target.value })} />
            ) : (
              <Input label="Basic salary / month (Rs.)" type="number" required value={form.basic_salary} onChange={(e) => setForm({ ...form, basic_salary: e.target.value })} />
            )}
            <Input label="Overtime rate / hour (optional, Rs.)" type="number" value={form.overtime_rate_per_hour} onChange={(e) => setForm({ ...form, overtime_rate_per_hour: e.target.value })} />
            <Input label="Bank account (optional)" value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
            <Input label="Address (optional)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <div className="col-span-3 flex items-center gap-3">
              <Button type="submit">{editingId ? "Save Changes" : "Save Employee"}</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}

      <Card>
        <Table
          emptyLabel="No employees yet. Add your mill staff to start tracking attendance and payroll."
          columns={[
            { key: "name", label: "Name" },
            { key: "designation", label: "Designation", render: (row) => row.designation || "—" },
            { key: "plant", label: "Cost center", render: (row) => row.plant || "General/Admin" },
            { key: "type", label: "Type", render: (row) => <Badge tone={TYPE_TONES[row.employment_type]}>{row.employment_type.replace("_", " ")}</Badge> },
            {
              key: "rate", label: "Rate", mono: true,
              render: (row) => row.employment_type === "daily_wage"
                ? `Rs. ${formatPKR(row.daily_wage_rate)}/day`
                : `Rs. ${formatPKR(row.basic_salary)}/mo`,
            },
            {
              key: "actions", label: "",
              render: (row) => (
                <RowActions
                  onEdit={() => startEdit(row)}
                  onDelete={() => handleDelete(row.id)}
                  deleteConfirm={`Remove ${row.name} from active employees? Past attendance and payslips are kept.`}
                />
              ),
            },
          ]}
          rows={employees}
        />
      </Card>
    </div>
  );
}
