import { useEffect, useState } from "react";
import { api } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, formatPKR, FormPanel, confirmDialog, notify } from "../components/ui";
import PaymentStatusModal from "../components/PaymentStatusModal";
import { printInvoice } from "../printInvoice";
import { useAuth } from "../auth";

const PAYMENT_TONES = { paid: "green", unpaid: "red" };

function emptyLine() { return { item_id: "", quantity: "", rate: "" }; }

export default function SalesInvoices() {
  const { canDo } = useAuth();
  const canDelete = canDo("delete_sales_invoices");
  const [invoices, setInvoices] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [items, setItems] = useState([]);
  const [sos, setSos] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [distributorId, setDistributorId] = useState("");
  const [soId, setSoId] = useState("");
  const [taxRate, setTaxRate] = useState("17");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState("");
  const [paymentModalInvoice, setPaymentModalInvoice] = useState(null);
  const [invoiceSettings, setInvoiceSettings] = useState(null);

  async function load() {
    const [invoiceData, distributorData, itemData, soData] = await Promise.all([
      api.getSalesInvoices(), api.getDistributors(), api.getItems("finished_good"), api.getSalesOrders(),
    ]);
    setInvoices(invoiceData);
    setDistributors(distributorData);
    setItems(itemData);
    setSos(soData);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { api.getInvoiceSettings().then(setInvoiceSettings); }, []);

  async function handleDelete(invoice) {
    if (!(await confirmDialog(`Delete invoice ${invoice.invoice_number} (Rs. ${formatPKR(invoice.total_amount)})? It is removed from the distributor's ledger. This can't be undone.`, { title: "Delete invoice?", confirmLabel: "Yes, delete" }))) return;
    try {
      await api.deleteSalesInvoice(invoice.id);
      notify(`${invoice.invoice_number} deleted`, "success");
      load();
    } catch (err) {
      notify(err.message, "error", "Can't delete this invoice");
    }
  }

  async function markUnpaid(invoice) {
    if (!(await confirmDialog(`Mark ${invoice.invoice_number} as unpaid? This reverses the recorded payment in the distributor's ledger.`, { danger: false }))) return;
    await api.updateSalesInvoicePaymentStatus(invoice.id, { payment_status: "unpaid" });
    load();
  }

  async function confirmPaid(payload) {
    await api.updateSalesInvoicePaymentStatus(paymentModalInvoice.id, payload);
    load();
  }

  function handlePrint(row) {
    printInvoice(invoiceSettings, {
      docType: "Sales Invoice",
      invoiceNumber: row.invoice_number,
      date: row.invoice_date,
      partyLabel: "Bill To (Distributor)",
      partyName: distributorLookup[row.distributor_id] || "—",
      lines: row.lines.map((l) => ({
        description: itemLookup[l.item_id]?.name || `Item #${l.item_id}`,
        quantity: l.quantity,
        rate: l.rate,
        amount: l.amount,
      })),
      subtotal: row.subtotal,
      taxRate: row.tax_rate,
      taxAmount: row.tax_amount,
      total: row.total_amount,
      paymentStatus: row.payment_status,
      notes: row.notes,
    });
  }

  const distributorLookup = Object.fromEntries(distributors.map((d) => [d.id, d.name]));
  const itemLookup = Object.fromEntries(items.map((i) => [i.id, i]));

  function selectSo(id) {
    setSoId(id);
    const so = sos.find((s) => s.id === Number(id));
    if (so) {
      setDistributorId(so.distributor_id);
      setLines(so.lines.map((l) => ({ item_id: l.item_id, quantity: l.quantity, rate: l.rate })));
      setTaxRate(String(so.gst_rate || 0));   // the order's GST setting carries over to its invoice
    }
  }

  function updateLine(i, field, value) {
    const next = [...lines]; next[i] = { ...next[i], [field]: value }; setLines(next);
  }

  function resetForm() {
    setInvoiceNumber(generateDocNumber("SINV")); setDistributorId(""); setSoId(""); setTaxRate("17"); setNotes(""); setLines([emptyLine()]);
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const taxAmount = subtotal * (Number(taxRate) || 0) / 100;
  const total = subtotal + taxAmount;

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      await api.createSalesInvoice({
        invoice_number: invoiceNumber,
        distributor_id: Number(distributorId),
        sales_order_id: soId ? Number(soId) : null,
        tax_rate: Number(taxRate) || 0,
        notes,
        lines: lines.filter((l) => l.item_id && l.quantity && l.rate).map((l) => ({
          item_id: Number(l.item_id), quantity: Number(l.quantity), rate: Number(l.rate),
        })),
      });
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Sales"
        title="Sales Invoices"
        action={<Button onClick={() => { if (!showForm) setInvoiceNumber(generateDocNumber("SINV")); setShowForm((s) => !s); }}>+ New Invoice</Button>}
      />

      {showForm && (
        <FormPanel wide title="New Invoice" onClose={() => setShowForm(false)}>
          {distributors.length === 0 ? (
            <div className="text-text-muted text-sm">Add a distributor first.</div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Invoice number" placeholder="INV-2026-0001" required value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                <Select label="From sales order (optional, autofills lines)" value={soId} onChange={(e) => selectSo(e.target.value)}>
                  <option value="">None &mdash; enter lines manually</option>
                  {sos.map((s) => <option key={s.id} value={s.id}>{s.so_number}</option>)}
                </Select>
                <Select label="Distributor" value={distributorId} onChange={(e) => setDistributorId(e.target.value)}>
                  <option value="">Select distributor&hellip;</option>
                  {distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </div>

              <div>
                <div className="text-xs text-text-muted mb-2">Line items</div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
                      <Select value={line.item_id} onChange={(e) => updateLine(i, "item_id", e.target.value)}>
                        <option value="">Select SKU&hellip;</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.pack_size ? ` (${it.pack_size})` : ""}</option>)}
                      </Select>
                      <Input type="number" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                      <Input type="number" placeholder="Rate" value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                      <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>✕</Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="mt-2" onClick={() => setLines([...lines, emptyLine()])}>+ Add line</Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Tax rate (%)" type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4">
                <div className="stencil text-sm text-text-muted space-x-4">
                  <span>Subtotal: Rs. {formatPKR(subtotal)}</span>
                  <span>Tax: Rs. {formatPKR(taxAmount)}</span>
                  <span className="text-amber-soft">Total: Rs. {formatPKR(total)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit">Save Invoice</Button>
                  {error && <span className="text-red text-sm">{error}</span>}
                </div>
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <Card>
        <Table
          emptyLabel="No sales invoices yet."
          columns={[
            { key: "invoice_number", label: "Invoice #", mono: true },
            { key: "distributor", label: "Distributor", render: (row) => distributorLookup[row.distributor_id] || "—" },
            { key: "date", label: "Date", render: (row) => new Date(row.invoice_date).toLocaleDateString() },
            { key: "subtotal", label: "Subtotal", mono: true, render: (row) => `Rs. ${formatPKR(row.subtotal)}` },
            { key: "tax", label: "Tax", mono: true, render: (row) => `${row.tax_rate}% (Rs. ${formatPKR(row.tax_amount)})` },
            { key: "total", label: "Total", mono: true, render: (row) => `Rs. ${formatPKR(row.total_amount)}` },
            {
              key: "payment_status", label: "Payment",
              render: (row) => (
                <button type="button" onClick={() => row.payment_status === "paid" ? markUnpaid(row) : setPaymentModalInvoice(row)} title="Click to change payment status">
                  <Badge tone={PAYMENT_TONES[row.payment_status]}>{row.payment_status}</Badge>
                </button>
              ),
            },
            {
              key: "print", label: "",
              render: (row) => (
                <div className="flex items-center gap-4">
                  <button type="button" className="text-xs text-amber-soft hover:underline" onClick={() => handlePrint(row)}>Print</button>
                  {canDelete && row.payment_status !== "paid" && (
                    <button type="button" className="text-xs text-red hover:underline" onClick={() => handleDelete(row)}>Delete</button>
                  )}
                </div>
              ),
            },
          ]}
          rows={invoices}
        />
      </Card>

      {paymentModalInvoice && (
        <PaymentStatusModal
          title={`Mark ${paymentModalInvoice.invoice_number} as Paid`}
          amountLabel="Invoice total"
          amount={paymentModalInvoice.total_amount}
          direction="incoming"
          onClose={() => setPaymentModalInvoice(null)}
          onSubmit={confirmPaid}
        />
      )}
    </div>
  );
}
