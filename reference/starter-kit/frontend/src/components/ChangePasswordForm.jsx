import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, Input } from "./ui";

export default function ChangePasswordForm({ onDone, temporary = false }) {
  const { applyNewSession } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (next.length < 8) return setError("New password must be at least 8 characters");
    if (next !== confirm) return setError("The two new passwords don't match");
    setSaving(true);
    try {
      const session = await api.changePassword(current, next);
      applyNewSession(session);   // keeps this device signed in; other devices are signed out
      setCurrent(""); setNext(""); setConfirm("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input label={temporary ? "Temporary password" : "Current password"} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <Input label="New password" hint="Use at least 8 characters." type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {error && <div className="text-sm font-semibold bg-[#FCEEEC] text-[#8E2A21] border border-[#F0C9C4] rounded-[18px] px-4 py-3">{error}</div>}
      <Button type="submit" size="lg" className={temporary ? "w-full" : ""} disabled={saving}>{saving ? "Saving…" : temporary ? "Save and continue" : "Change password"}</Button>
    </form>
  );
}
