import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Card, SectionTitle, Button, Input, confirmDialog } from "../components/ui";

export default function InvoiceSettings() {
  const { isAdmin } = useAuth();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState("");
  const fileInputRef = useRef(null);

  async function load() {
    const data = await api.getInvoiceSettings();
    setSettings(data);
    setForm(data);
  }
  useEffect(() => { load(); }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(""); setMessage("");
    try {
      const updated = await api.updateInvoiceSettings({
        ...form,
        logo_width_mm: Number(form.logo_width_mm),
        logo_height_mm: Number(form.logo_height_mm),
      });
      setSettings(updated);
      setForm(updated);
      setMessage("Saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const updated = await api.uploadInvoiceLogo(file);
      setSettings(updated);
      setForm(updated);
      setMessage("Logo uploaded.");
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleReset() {
    if (resetConfirmText !== "DELETE EVERYTHING") return;
    if (!(await confirmDialog("This permanently deletes ALL data — vendors, items, orders, stock, everything except these print settings. There is no undo. Proceed?"))) return;
    setResetting(true);
    setResetResult("");
    try {
      const result = await api.resetAllData();
      setResetResult(result.message);
      setResetConfirmText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  if (!form) return <div className="text-text-muted text-sm">Loading&hellip;</div>;

  return (
    <div>
      <SectionTitle eyebrow="Settings" title="Invoice Printing" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Card>
          <div className="text-sm font-medium mb-4">Logo</div>
          <div className="flex items-center gap-4 mb-4">
            {form.logo_base64 ? (
              <img
                src={form.logo_base64}
                alt="Logo preview"
                style={{ width: `${form.logo_width_mm * 3}px`, height: `${form.logo_height_mm * 3}px`, objectFit: "contain" }}
                className="border border-border rounded bg-white p-1"
              />
            ) : (
              <div className="w-20 h-20 border border-dashed border-border rounded flex items-center justify-center text-xs text-text-muted">
                No logo
              </div>
            )}
            <div>
              <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload Logo"}
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <div className="text-xs text-text-muted mt-1">PNG or JPG, under 2MB. Preview is scaled 3x for visibility.</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Logo width (mm)" type="number" value={form.logo_width_mm} onChange={(e) => setForm({ ...form, logo_width_mm: e.target.value })} />
            <Input label="Logo height (mm)" type="number" value={form.logo_height_mm} onChange={(e) => setForm({ ...form, logo_height_mm: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm mt-3">
            <input type="checkbox" checked={form.show_logo} onChange={(e) => setForm({ ...form, show_logo: e.target.checked })} />
            Show logo on printed invoices
          </label>
        </Card>

        <Card>
          <div className="text-sm font-medium mb-4">Company Details</div>
          <div className="space-y-3">
            <Input label="Company name" value={form.company_name || ""} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
            <Input label="Address" value={form.company_address || ""} onChange={(e) => setForm({ ...form, company_address: e.target.value })} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Phone" value={form.company_phone || ""} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} />
              <Input label="Email" value={form.company_email || ""} onChange={(e) => setForm({ ...form, company_email: e.target.value })} />
            </div>
            <Input label="NTN / Tax number (optional)" value={form.ntn_number || ""} onChange={(e) => setForm({ ...form, ntn_number: e.target.value })} />
          </div>
        </Card>

        <Card className="col-span-2">
          <div className="text-sm font-medium mb-4">Print Appearance</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Accent color (hex)" value={form.accent_color || ""} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} />
            <div className="flex items-end pb-2">
              <div className="w-full h-9 rounded border border-border" style={{ backgroundColor: form.accent_color }} />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs text-text-muted mb-1">Footer text (printed at the bottom of every invoice)</label>
            <textarea
              className="field"
              rows={3}
              value={form.footer_text || ""}
              onChange={(e) => setForm({ ...form, footer_text: e.target.value })}
              placeholder="e.g. Thank you for your business. Goods once sold are not returnable."
            />
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Settings"}</Button>
        {message && <span className="text-green text-sm">{message}</span>}
        {error && <span className="text-red text-sm">{error}</span>}
      </div>

      {isAdmin && <Card className="mt-8 border-red/30">
        <div className="text-sm font-medium text-red mb-2">Danger Zone</div>
        <div className="text-xs text-text-muted mb-3">
          Permanently deletes every vendor, item, unit, warehouse, purchase order, GRN, production order, toll
          record, sales order, invoice, expense, employee, and stock movement — everything except these
          invoice-printing settings. There's no undo. Use this to clear test data and start fresh, not on a
          system with real business records you need to keep.
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder='Type DELETE EVERYTHING to confirm'
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value)}
            className="max-w-xs"
          />
          <Button
            variant="secondary"
            className="border-red text-red hover:bg-red/10"
            disabled={resetConfirmText !== "DELETE EVERYTHING" || resetting}
            onClick={handleReset}
          >
            {resetting ? "Deleting…" : "Delete All Data"}
          </Button>
        </div>
        {resetResult && <div className="text-xs text-green mt-2">{resetResult}</div>}
      </Card>}
    </div>
  );
}
