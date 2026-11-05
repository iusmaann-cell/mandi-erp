import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal, confirmDialog, notify, Badge, Button, DetailRow, formatPKR } from "./ui";

const STATUS_TONES = { draft: "neutral", approved: "amber", partially_received: "amber", completed: "green", cancelled: "red" };

/* Read-only details of one purchase order, opened by clicking it in the list.
   Everything is shown here so nothing has to be opened in the edit form just to look. */
export default function PODetail({ po, vendor, items, onClose, actions, onChanged }) {
  const [payments, setPayments] = useState([]);
  const [grns, setGrns] = useState(null);
  const [uoms, setUoms] = useState([]);
  const [warehouses, setWarehouses] = useState([]);

  useEffect(() => {
    api.getGRNs().then((g) => setGrns(g.filter((x) => x.purchase_order_id === po.id))).catch(() => setGrns(null));
    api.getUOMs().then(setUoms).catch(() => {});
    api.getWarehouses().then(setWarehouses).catch(() => {});
  }, [po.id]);
  useEffect(() => {
    api.getPOPayments(po.id).then(setPayments).catch(() => setPayments([]));
  }, [po.id, po.amount_paid]);
  async function removePayment(pay) {
    if (!(await confirmDialog(`Delete this payment of Rs. ${formatPKR(pay.amount)}? It is also removed from the vendor ledger.`))) return;
    try { await api.deletePOPayment(po.id, pay.id); onChanged?.(); } catch (e) { notify(e.message, "error"); }
  }

  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const unit = (it) => uoms.find((u) => u.id === it?.uom_id)?.symbol || "";
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || "—";
  const goods = po.goods_total ?? po.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const freight = po.freight_charges || 0;
  const paid = po.amount_paid || 0;
  const due = po.balance_due ?? Math.max(goods + (po.gst_amount || 0) + freight - paid, 0);

  return (
    <Modal
      wide
      title={po.po_number}
      subtitle={vendor?.name || "—"}
      onClose={onClose}
      footer={actions ? <div className="flex flex-wrap gap-2 justify-end">{actions}</div> : null}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS_TONES[po.status]}>{po.status.replace(/_/g, " ")}</Badge>
          <Badge tone={po.payment_status === "paid" ? "green" : "red"}>{po.payment_status}</Badge>
          {(po.gst_rate || 0) > 0 && <Badge tone="amber">GST {po.gst_rate}%</Badge>}
        </div>

        <div className="rounded-[22px] bg-surface-2 px-5 py-2">
          <DetailRow label="PO date">{new Date(po.order_date).toLocaleDateString()}</DetailRow>
          <DetailRow label="Vendor">{vendor?.name}</DetailRow>
          {vendor?.phone && <DetailRow label="Vendor phone">{vendor.phone}</DetailRow>}
          {po.notes && <DetailRow label="Notes">{po.notes}</DetailRow>}
        </div>

        <div>
          <div className="text-[13px] font-bold text-forest mb-2">Items</div>
          <div className="space-y-2">
            {po.lines.map((l) => {
              const it = itemById[l.item_id];
              const pct = l.quantity ? Math.min(100, ((l.received_quantity || 0) / l.quantity) * 100) : 0;
              return (
                <div key={l.id} className="rounded-[20px] bg-surface-2 p-4">
                  <div className="flex justify-between gap-3">
                    <div className="font-extrabold text-forest leading-tight">{it?.name || `Item #${l.item_id}`}</div>
                    <div className="stencil font-bold whitespace-nowrap">Rs. {formatPKR(l.quantity * l.rate)}</div>
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    Ordered {l.quantity}{unit(it) ? ` ${unit(it)}` : ""} × Rs. {formatPKR(l.rate)}
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-white overflow-hidden"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div>
                  <div className="text-xs text-text-muted mt-1">
                    Received {l.received_quantity || 0} of {l.quantity}{unit(it) ? ` ${unit(it)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[22px] bg-mint px-5 py-3 text-sm text-forest space-y-1">
          <div className="flex justify-between"><span>Goods value</span><span className="stencil font-bold">Rs. {formatPKR(goods)}</span></div>
          {(po.gst_amount || 0) > 0 && <div className="flex justify-between"><span>GST ({po.gst_rate}%)</span><span className="stencil font-bold">Rs. {formatPKR(po.gst_amount)}</span></div>}
          {freight > 0 && <div className="flex justify-between"><span>Freight</span><span className="stencil font-bold">Rs. {formatPKR(freight)}</span></div>}
          <div className="flex justify-between border-t border-forest/15 pt-1 mt-1"><span className="font-bold">Total</span><span className="stencil font-extrabold">Rs. {formatPKR(goods + (po.gst_amount || 0) + freight)}</span></div>
          {(po.advance_amount || 0) > 0 && <div className="flex justify-between"><span>Advance paid</span><span className="stencil font-bold">Rs. {formatPKR(po.advance_amount)}</span></div>}
          <div className="flex justify-between"><span>Paid so far</span><span className="stencil font-bold">Rs. {formatPKR(paid)}</span></div>
          <div className="flex justify-between"><span className="font-bold">Balance due</span><span className="stencil font-extrabold">Rs. {formatPKR(due)}</span></div>
        </div>

        <div>
          <div className="text-[13px] font-bold text-forest mb-2">Payments</div>
          {payments.length === 0 ? (
            <div className="text-sm text-text-muted">No payments yet.</div>
          ) : (
            <div className="space-y-2">
              {payments.map((pay) => (
                <div key={pay.id} className="rounded-[20px] bg-surface-2 px-4 py-3 text-sm flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-forest stencil">Rs. {formatPKR(pay.amount)}</div>
                    <div className="text-xs text-text-muted">
                      {new Date(pay.entry_date).toLocaleDateString()} · {pay.kind === "advance" ? "Advance" : (pay.payment_method || "Payment").replace(/_/g, " ")}
                    </div>
                  </div>
                  {pay.kind === "payment" && onChanged && (
                    <button type="button" className="text-xs text-red hover:underline" onClick={() => removePayment(pay)}>Delete</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {grns && (
          <div>
            <div className="text-[13px] font-bold text-forest mb-2">Goods received against this PO</div>
            {grns.length === 0 ? (
              <div className="text-sm text-text-muted">Nothing received yet.</div>
            ) : (
              <div className="space-y-2">
                {grns.map((g) => (
                  <div key={g.id} className="rounded-[20px] bg-surface-2 p-4 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-extrabold text-forest stencil">{g.grn_number}</span>
                      <span className="text-text-muted">{new Date(g.received_date).toLocaleDateString()}</span>
                    </div>
                    {g.vehicle_no && <div className="text-xs text-text-muted mt-0.5">Vehicle {g.vehicle_no}</div>}
                    <div className="mt-2 space-y-1">
                      {g.lines.map((l) => (
                        <div key={l.id} className="flex justify-between gap-3 text-[13px]">
                          <span>{itemById[l.item_id]?.name || `Item #${l.item_id}`} · <span className="stencil">{l.batch_no}</span> · {whName(l.warehouse_id)}</span>
                          <span className="stencil font-bold whitespace-nowrap">{l.quantity}</span>
                        </div>
                      ))}
                    </div>
                    {g.freight_amount > 0 && <div className="text-xs text-text-muted mt-2">Freight Rs. {formatPKR(g.freight_amount)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
