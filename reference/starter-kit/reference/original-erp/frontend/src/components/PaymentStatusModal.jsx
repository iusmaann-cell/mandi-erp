import { useState } from "react";
import { pktToday } from "../api";
import { Modal, Button, Input, formatPKR } from "./ui";
import PaymentMethodFields, { emptyPaymentDetail } from "./PaymentMethodFields";

function emptySplit(prefillAmount = "") {
  return { ...emptyPaymentDetail(), amount: prefillAmount };
}

// Shared "mark as paid" dialog for POs, commission invoices, and sales invoices.
// `direction` = "outgoing" (we're paying, e.g. a vendor bill) or "incoming"
// (someone's paying us, e.g. a commission/sales invoice). `amount` is the raw
// numeric total owed (not pre-formatted) — the modal needs the real number to
// validate that the splits add up correctly, and formats it for display itself.
// `vendorBankAccounts` (outgoing only, optional): passed through to each split
// so a payment can be attributed to one of the vendor's registered accounts.
export default function PaymentStatusModal({ title, amountLabel, amount, direction, vendorBankAccounts = [], partial = false, onClose, onSubmit }) {
  const [splits, setSplits] = useState([emptySplit(!partial && amount != null ? String(amount) : "")]);
  const [payDate, setPayDate] = useState(pktToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const allocated = splits.reduce((s, sp) => s + (Number(sp.amount) || 0), 0);
  const remaining = (amount || 0) - allocated;
  const isBalanced = partial ? (allocated > 0 && remaining > -0.01) : Math.abs(remaining) < 0.01;

  function updateSplit(i, patch) {
    const next = [...splits];
    next[i] = { ...next[i], ...patch };
    setSplits(next);
  }

  function addSplit() {
    setSplits([...splits, emptySplit(remaining > 0 ? String(remaining) : "")]);
  }

  function removeSplit(i) {
    setSplits(splits.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (partial && !isBalanced) {
      setError(allocated <= 0 ? "Enter the amount you are paying." : `That is Rs. ${formatPKR(-remaining)} more than the balance due.`);
      return;
    }
    if (!partial && !isBalanced) {
      setError(`Splits must add up to the full amount — Rs. ${formatPKR(Math.abs(remaining))} ${remaining > 0 ? "left to allocate" : "over the total"}.`);
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        ...(partial ? { payment_date: `${payDate}T12:00:00` } : { payment_status: "paid" }),
        splits: splits.map((sp) => ({
          amount: Number(sp.amount),
          payment_method: sp.payment_method,
          cheque_number: sp.cheque_number || null,
          cheque_bank: sp.cheque_bank || null,
          our_bank: sp.our_bank || null,
          other_party_name: sp.other_party_name || null,
          other_party_bank: sp.other_party_bank || null,
          vendor_bank_account_id: sp.vendor_bank_account_id || null,
        })),
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide={splits.length > 1}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {amount != null && (
          <div className="text-sm text-text-muted">
            {amountLabel || "Amount"}: <span className="text-amber-soft stencil">Rs. {formatPKR(amount)}</span>
          </div>
        )}

        {partial && <Input label="Payment date" type="date" required value={payDate} onChange={(e) => setPayDate(e.target.value)} />}

        <div className="space-y-4">
          {splits.map((split, i) => (
            <div key={i} className={splits.length > 1 ? "bg-surface-2 rounded-md p-3 space-y-3" : "space-y-3"}>
              {splits.length > 1 && (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-text-muted uppercase tracking-wide">Payment {i + 1}</div>
                  <button type="button" className="text-xs text-red hover:underline" onClick={() => removeSplit(i)}>Remove</button>
                </div>
              )}
              <Input
                label="Amount (Rs.)" type="number" required
                value={split.amount}
                onChange={(e) => updateSplit(i, { amount: e.target.value })}
              />
              <PaymentMethodFields
                value={split}
                onChange={(v) => updateSplit(i, v)}
                direction={direction}
                vendorBankAccounts={vendorBankAccounts}
              />
            </div>
          ))}
        </div>

        <Button type="button" variant="secondary" onClick={addSplit}>+ Add another payment method</Button>

        <div className={`text-xs ${isBalanced ? "text-green" : "text-goldtext font-semibold"}`}>
          {partial
            ? `Paying Rs. ${formatPKR(allocated)} now — Rs. ${formatPKR(Math.max(remaining, 0))} will still be owed after this`
            : `Rs. ${formatPKR(allocated)} allocated of Rs. ${formatPKR(amount || 0)}`}
          {!partial && !isBalanced && (remaining > 0 ? ` — Rs. ${formatPKR(remaining)} remaining` : ` — Rs. ${formatPKR(-remaining)} over`)}
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={saving || !isBalanced}>{saving ? "Saving…" : (partial ? "Record payment" : "Confirm Paid")}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          {error && <span className="text-red text-sm">{error}</span>}
        </div>
      </form>
    </Modal>
  );
}
