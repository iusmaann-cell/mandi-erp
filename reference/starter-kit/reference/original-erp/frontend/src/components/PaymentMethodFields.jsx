import { Select, Input } from "./ui";

// Shared payment-method sub-form used everywhere money changes hands: marking a
// PO/invoice paid, or logging an expense. `direction` controls field labels only —
// "outgoing" = we're paying someone (vendor bill, expense), "incoming" = someone
// is paying us (toll commission, sales invoice). Storage fields are the same
// either way (cheque_number, cheque_bank, our_bank, other_party_name, other_party_bank).
//
// `vendorBankAccounts` (optional, outgoing only): when a vendor has registered
// accounts, offer a dropdown to pick one instead of typing the bank freehand —
// selecting one sets vendor_bank_account_id and auto-fills the display fields;
// switching to "Type manually" clears vendor_bank_account_id again.
export default function PaymentMethodFields({ value, onChange, direction = "outgoing", vendorBankAccounts = [] }) {
  function set(field, val) {
    onChange({ ...value, [field]: val });
  }

  const incoming = direction === "incoming";
  const hasVendorAccounts = !incoming && vendorBankAccounts.length > 0;

  function selectVendorAccount(idStr) {
    if (!idStr) {
      onChange({ ...value, vendor_bank_account_id: null });
      return;
    }
    const account = vendorBankAccounts.find((a) => String(a.id) === idStr);
    onChange({
      ...value,
      vendor_bank_account_id: account.id,
      other_party_name: account.account_title || account.bank_name,
      other_party_bank: account.bank_name,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        {["cash", "cheque", "online"].map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" checked={value.payment_method === m} onChange={() => set("payment_method", m)} />
            {m === "cash" ? "Cash" : m === "cheque" ? "Cheque" : "Online Transfer"}
          </label>
        ))}
      </div>

      {value.payment_method === "cheque" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Cheque number" value={value.cheque_number || ""} onChange={(e) => set("cheque_number", e.target.value)} />
          <Input label={incoming ? "Cheque drawn on (bank)" : "Bank"} value={value.cheque_bank || ""} onChange={(e) => set("cheque_bank", e.target.value)} />
          {incoming && (
            <Input label="Depositing bank (ours)" value={value.our_bank || ""} onChange={(e) => set("our_bank", e.target.value)} />
          )}
        </div>
      )}

      {value.payment_method === "online" && (
        <div className="space-y-3">
          {hasVendorAccounts && (
            <Select
              label="Pay into"
              value={value.vendor_bank_account_id ? String(value.vendor_bank_account_id) : ""}
              onChange={(e) => selectVendorAccount(e.target.value)}
            >
              <option value="">Type bank details manually&hellip;</option>
              {vendorBankAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.bank_name} — {a.account_number}{a.account_title ? ` (${a.account_title})` : ""}</option>
              ))}
            </Select>
          )}
          {(!hasVendorAccounts || !value.vendor_bank_account_id) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {incoming ? (
                <>
                  <Input label="Sender name" value={value.other_party_name || ""} onChange={(e) => set("other_party_name", e.target.value)} />
                  <Input label="Sender's bank" value={value.other_party_bank || ""} onChange={(e) => set("other_party_bank", e.target.value)} />
                  <Input label="Receiving bank (ours)" value={value.our_bank || ""} onChange={(e) => set("our_bank", e.target.value)} />
                </>
              ) : (
                <>
                  <Input label="Our sending bank" value={value.our_bank || ""} onChange={(e) => set("our_bank", e.target.value)} />
                  <Input label="Receiver name" value={value.other_party_name || ""} onChange={(e) => set("other_party_name", e.target.value)} />
                  <Input label="Receiver's bank" value={value.other_party_bank || ""} onChange={(e) => set("other_party_bank", e.target.value)} />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function emptyPaymentDetail() {
  return {
    payment_method: "cash", cheque_number: "", cheque_bank: "", our_bank: "",
    other_party_name: "", other_party_bank: "", vendor_bank_account_id: null,
  };
}

export function paymentMethodLabel(entry) {
  if (!entry.payment_method) return "—";
  if (entry.payment_method === "cash") return "Cash";
  if (entry.payment_method === "cheque") return `Cheque #${entry.cheque_number || "—"} (${entry.cheque_bank || "—"})`;
  if (entry.payment_method === "online") {
    if (entry.vendor_bank_account_label) return `Online: ${entry.vendor_bank_account_label}`;
    return `Online: ${entry.other_party_name || "—"} (${entry.other_party_bank || "—"})`;
  }
  return entry.payment_method;
}
