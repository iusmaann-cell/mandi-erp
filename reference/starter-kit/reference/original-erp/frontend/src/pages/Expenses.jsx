import { useEffect, useState } from "react";
import { useIntent } from "../nav";
import { api, resolveFileUrl, downloadFile, pktDay, pktToday, formatDay } from "../api";
import { useAuth } from "../auth";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, RowActions, Modal, formatPKR, FormPanel, notify } from "../components/ui";
import PaymentMethodFields, { emptyPaymentDetail, paymentMethodLabel } from "../components/PaymentMethodFields";
import BillPhotoUpload from "../components/BillPhotoUpload";

const CATEGORIES = ["salaries", "utilities", "rent", "maintenance", "transport", "fuel", "admin", "other"];
const PLANTS = ["refining", "hydrogenation", "soap", "packaging"];

const emptyForm = { expense_date: "", category: "salaries", plant: "", amount: "", freight_charges: "", description: "", notes: "", ...emptyPaymentDetail() };

function receiptPreviewUrl(expense) {
  // Older records (before the Google Drive -> server-storage switch) only have
  // a Drive file id and need Drive's embeddable-thumbnail endpoint. New records
  // are served directly from our own server, so the stored URL is already a
  // real, directly-loadable image.
  if (expense.bill_photo_drive_file_id) {
    return `https://drive.google.com/thumbnail?id=${expense.bill_photo_drive_file_id}&sz=w1200`;
  }
  return resolveFileUrl(expense.bill_photo_url);
}

export default function Expenses() {
  const { isAdmin } = useAuth();
  const [originalDay, setOriginalDay] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [billPhoto, setBillPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [previewExpense, setPreviewExpense] = useState(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  async function load() {
    setExpenses(await api.getExpenses());
  }
  useEffect(() => { load(); }, []);
  useIntent("expenses", () => startCreate());

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, expense_date: pktToday() });
    setOriginalDay("");
    setBillPhoto(null);
    setShowForm(true);
  }

  function startEdit(exp) {
    setEditingId(exp.id);
    setOriginalDay(pktDay(exp.expense_date));
    setForm({
      expense_date: pktDay(exp.expense_date),
      category: exp.category, plant: exp.plant || "",
      amount: Math.max((exp.amount || 0) - (exp.freight_charges || 0), 0), freight_charges: exp.freight_charges || "", description: exp.description || "", notes: exp.notes || "",
      payment_method: exp.payment_method || "cash", cheque_number: exp.cheque_number || "", cheque_bank: exp.cheque_bank || "",
      our_bank: exp.our_bank || "", other_party_name: exp.other_party_name || "", other_party_bank: exp.other_party_bank || "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!editingId && !billPhoto) {
      setError("A photo of the bill/receipt is required.");
      return;
    }
    try {
      const { expense_date, ...rest } = form;
      const base = Number(form.amount) || 0;
      const freight = Number(form.freight_charges) || 0;
      // The amount saved is the total paid; the freight part is recorded alongside so reports can show it separately.
      const payload = { ...rest, plant: form.plant || null, amount: base + freight, freight_charges: freight };
      // Only administrators may pick a date; everyone else's expenses are dated today by the server.
      // Noon is sent so the chosen day can never slip across a timezone boundary.
      if (isAdmin && expense_date && expense_date !== originalDay) payload.expense_date = `${expense_date}T12:00:00`;
      setSaving(true);
      if (editingId) {
        await api.updateExpense(editingId, payload);
      } else {
        await api.createExpense(payload, billPhoto);
      }
      setForm(emptyForm);
      setBillPhoto(null);
      setEditingId(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    await api.deleteExpense(id);
    load();
  }

  function openPreview(exp) {
    setPreviewFailed(false);
    setPreviewExpense(exp);
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadFile(`/expenses/report?start_date=${dateFrom}&end_date=${dateTo}`, `expenses_${dateFrom}_to_${dateTo}.xlsx`);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDownloading(false);
    }
  }

  const filteredExpenses = expenses.filter((row) => {
    const day = pktDay(row.expense_date);   // same Pakistan-time day the Excel report uses
    return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  });

  return (
    <div>
      <SectionTitle
        eyebrow="Finance"
        title="Expenses"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Expense</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Expense" : "New Expense"} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {isAdmin && (
              <Input
                label="Expense date (administrators can back-date)" type="date" required max={pktToday()}
                value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />
            )}
            <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select label="Plant (optional — leave blank for general/admin)" value={form.plant} onChange={(e) => setForm({ ...form, plant: e.target.value })}>
              <option value="">General / Admin</option>
              {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Input label="Amount (Rs.)" type="number" required min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Input label="Freight charges (Rs., optional)" type="number" min="0" value={form.freight_charges} onChange={(e) => setForm({ ...form, freight_charges: e.target.value })}
              hint={Number(form.freight_charges) > 0 ? `Total paid: Rs. ${formatPKR((Number(form.amount) || 0) + Number(form.freight_charges))} (freight is kept and reported separately)` : "Leave blank if there was no freight."} />
            <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="col-span-1 sm:col-span-2">
              <div className="text-xs text-text-muted mb-2">Payment method (how this expense was paid)</div>
              <PaymentMethodFields value={form} onChange={(v) => setForm({ ...form, ...v })} direction="outgoing" />
            </div>
            {!editingId && (
              <div className="col-span-1 sm:col-span-2">
                <BillPhotoUpload file={billPhoto} onChange={setBillPhoto} />
              </div>
            )}
            <div className="col-span-1 sm:col-span-2 flex items-center gap-3">
              <Button type="submit" disabled={saving}>{saving ? "Uploading & Saving…" : editingId ? "Save Changes" : "Save Expense"}</Button>
              {error && <span className="text-red text-sm">{error}</span>}
            </div>
          </form>
        </FormPanel>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear filter</Button>
        )}
        <Button variant="secondary" onClick={handleDownload} disabled={!dateFrom || !dateTo || downloading}
          title={!dateFrom || !dateTo ? "Pick a From and To date first" : "Excel report with daily and gross totals"}>
          {downloading ? "Preparing…" : "⬇ Download Excel Report"}
        </Button>
      </div>

      <Card>
        <Table
          emptyLabel={expenses.length === 0 ? "No expenses logged yet. Add salaries, utilities, rent, etc. to see real profitability, not just gross margin." : "No expenses match this date range."}
          columns={[
            { key: "date", label: "Date", render: (row) => formatDay(pktDay(row.expense_date)) },
            { key: "category", label: "Category", render: (row) => <Badge tone="amber">{row.category}</Badge> },
            { key: "plant", label: "Cost center", render: (row) => row.plant || "General/Admin" },
            { key: "description", label: "Description", render: (row) => row.description || "—" },
            { key: "amount", label: "Amount", mono: true, render: (row) => (
              <div className="leading-snug">
                <div>Rs. {formatPKR(row.amount)}</div>
                {(row.freight_charges || 0) > 0 && <div className="text-[11px] font-normal text-text-muted">incl. freight Rs. {formatPKR(row.freight_charges)}</div>}
              </div>
            ) },
            { key: "payment", label: "Paid via", render: (row) => paymentMethodLabel(row) },
            {
              key: "bill", label: "Bill photo",
              render: (row) => row.bill_photo_url
                ? (
                  <div className="flex items-center gap-2">
                    <button type="button" className="text-xs text-amber-soft hover:underline" onClick={() => openPreview(row)}>Preview</button>
                    <a href={resolveFileUrl(row.bill_photo_url)} target="_blank" rel="noreferrer" className="text-xs text-text-muted hover:underline">Open</a>
                  </div>
                )
                : <span className="text-xs text-text-muted">—</span>,
            },
            {
              key: "actions", label: "",
              render: (row) => (
                <RowActions
                  onEdit={() => startEdit(row)}
                  onDelete={() => handleDelete(row.id)}
                  deleteConfirm="Delete this expense entry?"
                />
              ),
            },
          ]}
          rows={filteredExpenses}
        />
      </Card>

      {previewExpense && (
        <Modal title={`Receipt — ${previewExpense.description || previewExpense.category}`} onClose={() => setPreviewExpense(null)} wide>
          {previewFailed ? (
            <div className="text-sm text-text-muted py-8 text-center">
              Couldn't load a preview here.
              <br />
              <a href={resolveFileUrl(previewExpense.bill_photo_url)} target="_blank" rel="noreferrer" className="text-amber-soft hover:underline">
                Open it directly instead
              </a>
            </div>
          ) : (
            <img
              src={receiptPreviewUrl(previewExpense)}
              alt="Receipt"
              className="w-full h-auto rounded-md border border-border"
              onError={() => setPreviewFailed(true)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
