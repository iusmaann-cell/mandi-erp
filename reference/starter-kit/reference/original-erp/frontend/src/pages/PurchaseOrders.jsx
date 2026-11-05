import { useEffect, useState } from "react";
import { useIntent } from "../nav";
import { api, downloadFile, pktDay } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, SearchSelect, Table, Badge, RowActions, formatPKR, FormPanel, confirmDialog, notify } from "../components/ui";
import PODetail from "../components/PODetail";
import PaymentStatusModal from "../components/PaymentStatusModal";
import PaymentMethodFields, { emptyPaymentDetail } from "../components/PaymentMethodFields";
import { useAuth } from "../auth";

const STATUS_TONES = { draft: "neutral", approved: "amber", partially_received: "amber", completed: "green", cancelled: "red" };
const STATUSES = ["draft", "approved", "partially_received", "completed", "cancelled"];
const PAYMENT_TONES = { paid: "green", unpaid: "red" };

function emptyLine() {
  return { item_id: "", quantity: "", rate: "" };
}

export default function PurchaseOrders() {
  const [pos, setPos] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [poNumber, setPoNumber] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [notes, setNotes] = useState("");
  const [gstOn, setGstOn] = useState(false);
  const [gstRate, setGstRate] = useState("18");
  const [gstFilter, setGstFilter] = useState("all");
  const [lines, setLines] = useState([emptyLine()]);
  const { canDo } = useAuth();
  const canDelete = canDo("delete_purchase_orders");
  const canEditPO = canDo("edit_purchase_orders");   // administrators only, unless a role is given it
  const [detailPo, setDetailPo] = useState(null);
  const [payAdvance, setPayAdvance] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceDetail, setAdvanceDetail] = useState(emptyPaymentDetail());
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentModalPo, setPaymentModalPo] = useState(null);
  const [partPayPo, setPartPayPo] = useState(null);
  const [downloading, setDownloading] = useState(false);

  async function load() {
    const [poData, vendorData, itemData] = await Promise.all([
      api.getPurchaseOrders(),
      api.getVendors(),
      api.getItems(),
    ]);
    setPos(poData.sort((a, b) => b.id - a.id));
    setVendors(vendorData);
    setItems(itemData);
  }

  useEffect(() => { load(); }, []);

  // Opened via Quick add → wait for the vendor list so the form starts with a vendor chosen
  const [wantNew, setWantNew] = useState(false);
  useIntent("purchase-orders", () => setWantNew(true));
  useEffect(() => {
    if (wantNew && vendors.length) { startCreate(); setWantNew(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantNew, vendors]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadFile(`/purchase-orders/report?start_date=${dateFrom}&end_date=${dateTo}`, `purchase_orders_${dateFrom}_to_${dateTo}.xlsx`);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setDownloading(false);
    }
  }

  function hasReceipts(po) {
    return po.lines.some((l) => l.received_quantity > 0);
  }

  function resetForm() {
    setPoNumber(generateDocNumber("PO")); setNotes(""); setLines([emptyLine()]); setGstOn(false); setGstRate("18");
    setPayAdvance(false); setAdvanceAmount(""); setAdvanceDetail(emptyPaymentDetail());
    setVendorId(vendors[0]?.id || "");
  }

  function startCreate() {
    setEditingId(null);
    resetForm();
    setShowForm(true);
  }

  function startEdit(po) {
    setEditingId(po.id);
    setPayAdvance(false);
    setPoNumber(po.po_number);
    setVendorId(po.vendor_id);
    setNotes(po.notes || "");
    setGstOn((po.gst_rate || 0) > 0); setGstRate(String(po.gst_rate > 0 ? po.gst_rate : 18));
    setLines(po.lines.map((l) => ({ id: l.id, item_id: l.item_id, quantity: l.quantity, rate: l.rate, received: l.received_quantity || 0 })));
    setShowForm(true);
  }

  function updateLine(i, field, value) {
    const next = [...lines];
    next[i] = { ...next[i], [field]: value };
    setLines(next);
  }

  function addLine() { setLines([...lines, emptyLine()]); }
  function removeLine(i) { setLines(lines.filter((_, idx) => idx !== i)); }

  const goodsSum = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const gstPct = gstOn ? (Number(gstRate) || 0) : 0;
  const gstSum = goodsSum * gstPct / 100;
  const total = goodsSum + gstSum;   // goods + GST (freight is added later, when goods arrive)
  const editingHasReceipts = !!editingId && lines.some((l) => l.received > 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        po_number: poNumber,
        vendor_id: Number(vendorId),
        notes,
        gst_rate: gstPct,
        lines: lines
          .filter((l) => l.item_id && l.quantity && l.rate)
          .map((l) => ({ ...(l.id ? { id: l.id } : {}), item_id: Number(l.item_id), quantity: Number(l.quantity), rate: Number(l.rate) })),
      };
      if (editingId) {
        await api.updatePurchaseOrder(editingId, payload);
      } else {
        if (payAdvance) {
          const amt = Number(advanceAmount);
          if (!(amt > 0)) { setError("Enter the advance amount, or untick the advance option."); return; }
          if (amt > total + 0.01) { setError("The advance can't be more than the PO total."); return; }
          payload.advance_splits = [{
            amount: amt,
            payment_method: advanceDetail.payment_method,
            cheque_number: advanceDetail.cheque_number || null,
            cheque_bank: advanceDetail.cheque_bank || null,
            our_bank: advanceDetail.our_bank || null,
            other_party_name: advanceDetail.other_party_name || null,
            other_party_bank: advanceDetail.other_party_bank || null,
            vendor_bank_account_id: advanceDetail.vendor_bank_account_id || null,
          }];
        }
        await api.createPurchaseOrder(payload);
      }
      setEditingId(null);
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(po) {
    try {
      await api.deletePurchaseOrder(po.id);
      load();
    } catch (err) {
      notify(err.message, "error");
    }
  }

  // Cancel only makes sense while a PO is still open: not once everything is received or it is paid in full.
  function canCancel(po) {
    return hasReceipts(po) && po.status !== "cancelled" && po.status !== "completed" && po.payment_status !== "paid";
  }

  async function askCancel(po) {
    if (!(await confirmDialog(`Cancel ${po.po_number}? It already has goods received, so it can't be deleted, but cancelling marks it closed.`, { confirmLabel: "Yes, cancel it" }))) return;
    try {
      await api.cancelPurchaseOrder(po.id);
      setDetailPo(null);
      load();
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function markUnpaid(po) {
    if (!(await confirmDialog(`Mark ${po.po_number} as unpaid? This reverses the recorded payment in the vendor's ledger.`, { danger: false }))) return;
    await api.updatePOPaymentStatus(po.id, { payment_status: "unpaid" });
    load();
  }

  // Nothing left to pay (the advance covered it all) → just mark it paid; otherwise ask how.
  async function startPaying(po) {
    if ((po.balance_due || 0) <= 0.01) {
      try { await api.updatePOPaymentStatus(po.id, { payment_status: "paid", splits: [] }); load(); }
      catch (err) { notify(err.message, "error"); }
      return;
    }
    setPaymentModalPo(po);
  }

  async function confirmPaid(payload) {
    await api.updatePOPaymentStatus(paymentModalPo.id, payload);
    load();
  }

  async function confirmPartPayment(payload) {
    await api.addPOPayment(partPayPo.id, payload);
    load();
  }

  const vendorLookup = Object.fromEntries(vendors.map((v) => [v.id, v.name]));

  const filteredPos = pos.filter((po) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || po.po_number.toLowerCase().includes(q) || (vendorLookup[po.vendor_id] || "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || po.status === statusFilter;
    const day = pktDay(po.order_date);   // same Pakistan-time day the Excel report uses
    const matchesFrom = !dateFrom || day >= dateFrom;
    const matchesTo = !dateTo || day <= dateTo;
    const matchesGst = gstFilter === "all" || (gstFilter === "gst" ? (po.gst_rate || 0) > 0 : !(po.gst_rate > 0));
    return matchesSearch && matchesStatus && matchesFrom && matchesTo && matchesGst;
  });

  return (
    <div>
      <SectionTitle
        eyebrow="Procurement"
        title="Purchase Orders"
        action={<Button onClick={() => (showForm ? setShowForm(false) : startCreate())}>+ New Purchase Order</Button>}
      />

      {showForm && (
        <FormPanel wide title={editingId ? "Edit Purchase Order" : "New Purchase Order"} onClose={() => setShowForm(false)}>
          {vendors.length === 0 || items.length === 0 ? (
            <div className="text-text-muted text-sm">Add at least one vendor and one item before creating a purchase order.</div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="PO number" placeholder="PO-2026-0001" required value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                <SearchSelect label="Vendor" value={vendorId} onChange={setVendorId}
                  disabled={editingId && lines.some((l) => l.received > 0)}
                  hint={editingId && lines.some((l) => l.received > 0) ? "Goods are already received, so the vendor can't change." : undefined}
                  options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
                <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="rounded-[22px] bg-surface-2 p-4 space-y-3">
                <label className={`flex items-center gap-3 text-sm font-bold text-forest min-h-[44px] ${editingHasReceipts ? "opacity-60" : "cursor-pointer"}`}>
                  <input type="checkbox" className="w-5 h-5" checked={gstOn} disabled={editingHasReceipts} onChange={(e) => setGstOn(e.target.checked)} />
                  GST purchase — GST is charged on this order
                </label>
                {gstOn && (
                  <Input label="GST rate (%)" type="number" min="0" max="100" step="0.01" disabled={editingHasReceipts}
                    value={gstRate} onChange={(e) => setGstRate(e.target.value)}
                    hint={editingHasReceipts ? "Goods are already received, so the GST setting can't change." : "Added on top of the goods value; shown separately on the order and its bills."} />
                )}
              </div>

              <div>
                <div className="text-xs text-text-muted mb-2">Line items</div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-3 items-end">
                      <SearchSelect label={i === 0 ? "Item" : undefined} value={line.item_id} onChange={(v) => updateLine(i, "item_id", v)}
                        disabled={line.received > 0} placeholder="Type to search items…"
                        options={items.map((it) => ({ value: it.id, label: it.name, sub: it.code }))}
                        hint={line.received > 0 ? `${line.received} already received` : undefined} />
                      <Input label={i === 0 ? "Quantity" : undefined} type="number" placeholder="Qty" min={line.received || undefined} value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                      <Input label={i === 0 ? "Rate (Rs.)" : undefined} type="number" placeholder="Rate" disabled={line.received > 0} value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                      <Button type="button" variant="ghost" onClick={() => removeLine(i)} disabled={lines.length === 1 || line.received > 0}>✕</Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" className="mt-3" onClick={addLine}>+ Add line</Button>
              </div>

              {editingId ? (
                (pos.find((p) => p.id === editingId)?.advance_amount || 0) > 0 && (
                  <div className="rounded-[20px] bg-mint text-forest text-sm px-4 py-3">
                    Advance already paid: <b className="stencil">Rs. {formatPKR(pos.find((p) => p.id === editingId).advance_amount)}</b>
                  </div>
                )
              ) : (
                <div className="rounded-[22px] bg-surface-2 p-4 space-y-3">
                  <label className="flex items-center gap-3 text-sm font-bold text-forest cursor-pointer min-h-[44px]">
                    <input type="checkbox" className="w-5 h-5" checked={payAdvance} onChange={(e) => setPayAdvance(e.target.checked)} />
                    Pay an advance to the vendor now
                  </label>
                  {payAdvance && (
                    <>
                      <Input label="Advance amount (Rs.)" type="number" min="0" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)}
                        hint={total > 0 ? `PO total is Rs. ${formatPKR(total)}. Whatever is not paid now stays as balance due.` : "Add line items first so the PO total is known."} />
                      <PaymentMethodFields value={advanceDetail} onChange={setAdvanceDetail} direction="outgoing"
                        vendorBankAccounts={vendors.find((v) => String(v.id) === String(vendorId))?.bank_accounts || []} />
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-border pt-4">
                <div className="stencil text-sm text-text-muted">
                  {gstSum > 0 && <span className="mr-3">Goods Rs. {formatPKR(goodsSum)} + GST Rs. {formatPKR(gstSum)} ·</span>}
                  Total: <span className="text-amber-soft">Rs. {formatPKR(total)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit">{editingId ? "Save Changes" : "Save Purchase Order"}</Button>
                  {error && <span className="text-red text-sm">{error}</span>}
                </div>
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <Input label="Search" placeholder="PO number or vendor…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-xs">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </Select>
        <Select label="GST" value={gstFilter} onChange={(e) => setGstFilter(e.target.value)} className="max-w-xs">
          <option value="all">All orders</option>
          <option value="gst">GST orders only</option>
          <option value="non">Non-GST only</option>
        </Select>
        <Input label="From date" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Input label="To date" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(search || statusFilter !== "all" || gstFilter !== "all" || dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setSearch(""); setStatusFilter("all"); setGstFilter("all"); setDateFrom(""); setDateTo(""); }}>
            Clear filters
          </Button>
        )}
        <Button variant="secondary" onClick={handleDownload} disabled={!dateFrom || !dateTo || downloading}
          title={!dateFrom || !dateTo ? "Pick a From and To date first" : "Excel report with payments, daily and gross totals"}>
          {downloading ? "Preparing…" : "⬇ Download Excel Report"}
        </Button>
      </div>

      <Card>
        <Table
          onRowClick={(row) => setDetailPo(row)}
          emptyLabel={pos.length === 0 ? "No purchase orders yet." : "No purchase orders match your search/filter."}
          columns={[
            { key: "po_number", label: "PO Number", mono: true, render: (row) => (
              <span>{row.po_number}{(row.gst_rate || 0) > 0 && <span className="ml-2 align-middle"><Badge tone="amber">GST {row.gst_rate}%</Badge></span>}</span>
            ) },
            { key: "vendor", label: "Vendor", render: (row) => vendorLookup[row.vendor_id] || "—" },
            { key: "order_date", label: "Date", render: (row) => new Date(row.order_date).toLocaleDateString() },
            {
              key: "value",
              label: "Value",
              mono: true,
              render: (row) => {
                const goods = row.goods_total ?? row.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
                const freight = row.freight_charges || 0;
                const gst = row.gst_amount || 0;
                return (
                  <div className="leading-snug">
                    <div className="font-bold">Rs. {formatPKR(goods + gst + freight)}</div>
                    {(freight > 0 || gst > 0) && (
                      <div className="text-[11px] font-normal text-text-muted">
                        Goods Rs. {formatPKR(goods)}{gst > 0 && ` + GST Rs. ${formatPKR(gst)}`}{freight > 0 && ` + Freight Rs. ${formatPKR(freight)}`}
                      </div>
                    )}
                  </div>
                );
              },
            },
            { key: "status", label: "Status", render: (row) => <Badge tone={STATUS_TONES[row.status]}>{row.status.replace(/_/g, " ")}</Badge> },
            {
              key: "payment_status", label: "Payment",
              render: (row) => (
                <div className="leading-snug">
                  <button
                    type="button"
                    onClick={() => row.payment_status === "paid" ? markUnpaid(row) : startPaying(row)}
                    title="Click to change payment status"
                  >
                    <Badge tone={PAYMENT_TONES[row.payment_status]}>{row.payment_status}</Badge>
                  </button>
                  {row.payment_status !== "paid" && row.amount_paid > 0 && (
                    <div className="text-[11px] text-text-muted mt-1">Paid Rs. {formatPKR(row.amount_paid)} · Due Rs. {formatPKR(row.balance_due)}</div>
                  )}
                </div>
              ),
            },
            {
              key: "actions",
              label: "",
              render: (row) => {
                const cancelled = row.status === "cancelled";
                const received = hasReceipts(row);
                const showEdit = canEditPO && !cancelled;
                const showDelete = canDelete && !received;
                const showCancel = canCancel(row);
                if (!showEdit && !showDelete && !showCancel) return <span className="text-text-muted text-xs">—</span>;
                return (
                  <div className="flex items-center gap-3">
                    <RowActions
                      onEdit={showEdit ? () => startEdit(row) : undefined}
                      onDelete={showDelete ? () => handleDelete(row) : undefined}
                      deleteConfirm={`Delete ${row.po_number}? This can't be undone.`}
                    />
                    {showCancel && (
                      <button type="button" className="text-xs text-amber-soft hover:underline" onClick={() => askCancel(row)}>Cancel</button>
                    )}
                  </div>
                );
              },
            },
          ]}
          rows={filteredPos}
        />
      </Card>

      {detailPo && (() => {
        const live = pos.find((p) => p.id === detailPo.id) || detailPo;   // stays fresh after a payment
        const cancelled = live.status === "cancelled";
        return (
          <PODetail
            po={live}
            vendor={vendors.find((v) => v.id === live.vendor_id)}
            items={items}
            onClose={() => setDetailPo(null)}
            onChanged={load}
            actions={(
              <>
                {!cancelled && live.payment_status !== "paid" && (live.balance_due || 0) > 0.01 && (
                  <Button onClick={() => { setDetailPo(null); setPartPayPo(live); }}>Record payment</Button>
                )}
                {live.payment_status === "paid"
                  ? <Button variant="secondary" onClick={() => markUnpaid(live)}>Mark unpaid</Button>
                  : !cancelled && <Button variant="secondary" onClick={() => { setDetailPo(null); startPaying(live); }}>Mark paid</Button>}
                {canCancel(live) && <Button variant="secondary" onClick={() => askCancel(live)}>Cancel PO</Button>}
                {canEditPO && !cancelled && <Button onClick={() => { setDetailPo(null); startEdit(live); }}>Edit</Button>}
              </>
            )}
          />
        );
      })()}

      {partPayPo && (
        <PaymentStatusModal
          partial
          title={`Record payment — ${partPayPo.po_number}`}
          amountLabel="Balance due"
          amount={partPayPo.balance_due}
          direction="outgoing"
          vendorBankAccounts={vendors.find((v) => v.id === partPayPo.vendor_id)?.bank_accounts || []}
          onClose={() => setPartPayPo(null)}
          onSubmit={confirmPartPayment}
        />
      )}

      {paymentModalPo && (
        <PaymentStatusModal
          title={`Mark ${paymentModalPo.po_number} as Paid`}
          amountLabel={paymentModalPo.amount_paid > 0 ? "Balance due" : "PO total"}
          amount={paymentModalPo.balance_due}
          direction="outgoing"
          vendorBankAccounts={vendors.find((v) => v.id === paymentModalPo.vendor_id)?.bank_accounts || []}
          onClose={() => setPaymentModalPo(null)}
          onSubmit={confirmPaid}
        />
      )}
    </div>
  );
}
