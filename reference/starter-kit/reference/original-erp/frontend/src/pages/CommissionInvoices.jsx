import { useEffect, useState } from "react";
import { api } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, Badge, formatPKR, FormPanel, confirmDialog } from "../components/ui";
import PaymentStatusModal from "../components/PaymentStatusModal";
import { printInvoice } from "../printInvoice";

const PAYMENT_TONES = { paid: "green", unpaid: "red" };

export default function CommissionInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [productionOrders, setProductionOrders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("rate"); // "rate" or "flat"
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [productionOrderId, setProductionOrderId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [flatAmount, setFlatAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentModalInvoice, setPaymentModalInvoice] = useState(null);
  const [invoiceSettings, setInvoiceSettings] = useState(null);

  async function load() {
    const [invoiceData, customerData, prodData] = await Promise.all([
      api.getCommissionInvoices(), api.getCustomers(), api.getProductionOrders({}),
    ]);
    setInvoices(invoiceData);
    setCustomers(customerData);
    setProductionOrders(prodData.filter((p) => p.customer_id));
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { api.getInvoiceSettings().then(setInvoiceSettings); }, []);

  async function markUnpaid(invoice) {
    if (!(await confirmDialog(`Mark ${invoice.invoice_number} as unpaid? This reverses the recorded payment in the customer's ledger.`, { danger: false }))) return;
    await api.updateCommissionInvoicePaymentStatus(invoice.id, { payment_status: "unpaid" });
    load();
  }

  async function confirmPaid(payload) {
    await api.updateCommissionInvoicePaymentStatus(paymentModalInvoice.id, payload);
    load();
  }

  function handlePrint(row) {
    printInvoice(invoiceSettings, {
      docType: "Commission Invoice",
      invoiceNumber: row.invoice_number,
      date: row.invoice_date,
      partyLabel: "Bill To (Toll Customer)",
      partyName: customerLookup[row.customer_id] || "—",
      lines: [{
        description: row.quantity_processed
          ? `Processing commission — ${row.quantity_processed} units @ Rs. ${row.rate_per_unit}/unit`
          : "Processing commission",
        quantity: row.quantity_processed,
        rate: row.rate_per_unit,
        amount: row.amount,
      }],
      subtotal: row.amount,
      taxRate: 0,
      taxAmount: 0,
      total: row.amount,
      paymentStatus: row.payment_status,
      notes: row.notes,
    });
  }

  const customerLookup = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  function resetForm() {
    setInvoiceNumber(generateDocNumber("TINV")); setCustomerId(""); setProductionOrderId("");
    setQuantity(""); setRate(""); setFlatAmount(""); setNotes(""); setMode("rate");
  }

  function openForm() {
    resetForm();
    setShowForm((s) => !s);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        invoice_number: invoiceNumber,
        customer_id: Number(customerId),
        production_order_id: productionOrderId ? Number(productionOrderId) : null,
        notes,
      };
      if (mode === "rate") {
        payload.quantity_processed = Number(quantity);
        payload.rate_per_unit = Number(rate);
      } else {
        payload.amount = Number(flatAmount);
      }
      await api.createCommissionInvoice(payload);
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const computedTotal = mode === "rate" ? (Number(quantity) || 0) * (Number(rate) || 0) : Number(flatAmount) || 0;

  const filteredInvoices = invoices.filter((row) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || row.invoice_number.toLowerCase().includes(q)
      || (customerLookup[row.customer_id] || "").toLowerCase().includes(q)
      || (row.notes || "").toLowerCase().includes(q);
    const rowDate = new Date(row.invoice_date);
    const matchesFrom = !dateFrom || rowDate >= new Date(dateFrom);
    const matchesTo = !dateTo || rowDate <= new Date(`${dateTo}T23:59:59`);
    return matchesSearch && matchesFrom && matchesTo;
  });

  return (
    <div>
      <SectionTitle
        eyebrow="Toll / Job-Work"
        title="Commission Invoices"
        action={<Button onClick={openForm}>+ New Invoice</Button>}
      />

      {showForm && (
        <FormPanel wide title="New Invoice" onClose={() => setShowForm(false)}>
          {customers.length === 0 ? (
            <div className="text-text-muted text-sm">Add a customer first.</div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Invoice number" required value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
                <Select label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select customer&hellip;</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Select label="Related production order (optional)" value={productionOrderId} onChange={(e) => setProductionOrderId(e.target.value)}>
                  <option value="">None</option>
                  {productionOrders.filter((p) => !customerId || p.customer_id === Number(customerId)).map((p) => (
                    <option key={p.id} value={p.id}>{p.order_number} ({p.total_input_quantity} processed)</option>
                  ))}
                </Select>
              </div>

              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "rate"} onChange={() => setMode("rate")} />
                  Quantity &times; rate
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "flat"} onChange={() => setMode("flat")} />
                  Flat amount
                </label>
              </div>

              {mode === "rate" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="Quantity processed" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  <Input label="Rate per unit (Rs.)" type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
                </div>
              ) : (
                <Input label="Flat amount (Rs.)" type="number" value={flatAmount} onChange={(e) => setFlatAmount(e.target.value)} />
              )}

              <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

              <div className="flex items-center justify-between border-t border-border pt-4">
                <div className="stencil text-sm text-text-muted">
                  Invoice total: <span className="text-amber-soft">Rs. {formatPKR(computedTotal)}</span>
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

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="Search" placeholder="Invoice #, customer, or notes…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(search || dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear filters</Button>
        )}
      </div>

      <Card>
        <Table
          emptyLabel={invoices.length === 0 ? "No commission invoices yet." : "No invoices match your search/filter."}
          columns={[
            { key: "invoice_number", label: "Invoice #", mono: true },
            { key: "customer", label: "Customer", render: (row) => customerLookup[row.customer_id] || "—" },
            { key: "date", label: "Date", render: (row) => new Date(row.invoice_date).toLocaleDateString() },
            { key: "qty", label: "Qty processed", render: (row) => row.quantity_processed ?? "—" },
            { key: "rate", label: "Rate/unit", render: (row) => row.rate_per_unit ? `Rs. ${formatPKR(row.rate_per_unit)}` : "—" },
            { key: "amount", label: "Amount", mono: true, render: (row) => `Rs. ${formatPKR(row.amount)}` },
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
              render: (row) => <button type="button" className="text-xs text-amber-soft hover:underline" onClick={() => handlePrint(row)}>Print</button>,
            },
          ]}
          rows={filteredInvoices}
        />
      </Card>

      {paymentModalInvoice && (
        <PaymentStatusModal
          title={`Mark ${paymentModalInvoice.invoice_number} as Paid`}
          amountLabel="Invoice amount"
          amount={paymentModalInvoice.amount}
          direction="incoming"
          onClose={() => setPaymentModalInvoice(null)}
          onSubmit={confirmPaid}
        />
      )}
    </div>
  );
}
