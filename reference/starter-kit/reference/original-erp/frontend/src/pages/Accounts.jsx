import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Input, Modal, SectionTitle, Select, Table, confirmDialog, notify } from "../components/ui";
import ChangePasswordForm from "../components/ChangePasswordForm";

const TABS = [
  { key: "users", label: "Users" },
  { key: "roles", label: "Roles & Access" },
  { key: "me", label: "My Password" },
];

function fmtDate(d) {
  return d ? new Date(d.endsWith("Z") ? d : d + "Z").toLocaleString() : "Never";
}

// ------------------------------------------------------------------- Users
function UsersTab() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);   // { type: "create" | "edit" | "reset", user? }
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  async function load() {
    try {
      const [u, r] = await Promise.all([api.getUsers(), api.getRoles()]);
      setUsers(u);
      setRoles(r);
      setError("");
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  function open(type, user) {
    setModalError("");
    if (type === "create") setForm({ username: "", full_name: "", role_id: roles.find((r) => !r.is_admin)?.id || roles[0]?.id || "", password: "", must_change_password: true });
    if (type === "edit") setForm({ full_name: user.full_name, role_id: user.role_id, is_active: user.is_active });
    if (type === "reset") setForm({ new_password: "", must_change_password: true });
    setModal({ type, user });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setModalError("");
    try {
      if (modal.type === "create") await api.createUser({ ...form, role_id: Number(form.role_id) });
      if (modal.type === "edit") await api.updateUser(modal.user.id, { ...form, role_id: Number(form.role_id) });
      if (modal.type === "reset") await api.resetUserPassword(modal.user.id, form.new_password, form.must_change_password);
      setModal(null);
      load();
    } catch (err) { setModalError(err.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(u) {
    if (!(await confirmDialog(`Permanently delete the account "${u.username}"? To just block access, use Edit → uncheck Active instead.`))) return;
    try { await api.deleteUser(u.id); load(); } catch (err) { notify(err.message, "error"); }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
        <div className="text-xs text-text-muted">Each person signs in with their own username. Their role decides what they can see and change.</div>
        <Button onClick={() => open("create")} disabled={roles.length === 0}>+ New Account</Button>
      </div>
      {error && <div className="text-sm text-red mb-3">{error}</div>}
      <Table
        columns={[
          { key: "username", label: "Username", mono: true, render: (u) => <span>{u.username}{u.id === me.id && <span className="text-text-muted"> (you)</span>}</span> },
          { key: "full_name", label: "Name" },
          { key: "role", label: "Role", render: (u) => <Badge tone={u.is_admin ? "amber" : "neutral"}>{u.role_name}</Badge> },
          {
            key: "status", label: "Status",
            render: (u) => (
              <div className="flex gap-1 flex-wrap">
                <Badge tone={u.is_active ? "green" : "red"}>{u.is_active ? "active" : "disabled"}</Badge>
                {u.must_change_password && <Badge tone="amber">temp password</Badge>}
              </div>
            ),
          },
          { key: "last", label: "Last sign-in", render: (u) => <span className="text-xs text-text-muted">{fmtDate(u.last_login_at)}</span> },
          {
            key: "actions", label: "",
            render: (u) => (
              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                <button type="button" className="text-amber-soft hover:underline" onClick={() => open("edit", u)}>Edit</button>
                <button type="button" className="text-amber-soft hover:underline" onClick={() => open("reset", u)}>Reset password</button>
                {u.id !== me.id && <button type="button" className="text-red hover:underline" onClick={() => handleDelete(u)}>Delete</button>}
              </div>
            ),
          },
        ]}
        rows={users}
      />

      {modal && (
        <Modal
          title={modal.type === "create" ? "New Account" : modal.type === "edit" ? `Edit ${modal.user.username}` : `Reset password — ${modal.user.username}`}
          onClose={() => setModal(null)}
        >
          <form onSubmit={submit} className="space-y-3">
            {modal.type === "create" && (
              <Input label="Username (lowercase letters, numbers, . _ -)" value={form.username} autoCapitalize="none"
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} required />
            )}
            {modal.type !== "reset" && (
              <>
                <Input label="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
                <Select label="Role" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} required>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_admin ? " (full access)" : ""}</option>)}
                </Select>
              </>
            )}
            {modal.type === "edit" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.is_active} disabled={modal.user.id === me.id}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Active — uncheck to block this person from signing in (signs them out immediately)
              </label>
            )}
            {modal.type === "create" && (
              <Input label="Temporary password (min 8 characters)" type="text" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            )}
            {modal.type === "reset" && (
              <Input label="New temporary password (min 8 characters)" type="text" value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })} required />
            )}
            {modal.type !== "edit" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.must_change_password} onChange={(e) => setForm({ ...form, must_change_password: e.target.checked })} />
                Make them choose their own password at next sign-in
              </label>
            )}
            {modal.type === "reset" && <div className="text-xs text-text-muted">All of this person's current sessions will be signed out.</div>}
            {modalError && <div className="text-xs text-red">{modalError}</div>}
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              <Button type="button" variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Roles
const LEVEL_LABELS = { none: "No access", view: "View only", edit: "View & edit" };

function RolesTab() {
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState({ modules: [], actions: [] });
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);   // null | "new" | role object
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  async function load() {
    try {
      const [r, c] = await Promise.all([api.getRoles(), api.getAccountModules()]);
      setRoles(r);
      setCatalog(c);
      setError("");
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  function open(role) {
    setModalError("");
    setEditing(role || "new");
    setForm(role
      ? { name: role.name, description: role.description || "", is_admin: role.is_admin, modules: { ...role.modules }, actions: [...role.actions] }
      : { name: "", description: "", is_admin: false, modules: {}, actions: [] });
  }

  function setLevel(key, level) {
    setForm((f) => ({ ...f, modules: { ...f.modules, [key]: level } }));
  }
  function setAll(level) {
    setForm((f) => ({ ...f, modules: Object.fromEntries(catalog.modules.map((m) => [m.key, level])) }));
  }
  function toggleAction(key) {
    setForm((f) => ({ ...f, actions: f.actions.includes(key) ? f.actions.filter((a) => a !== key) : [...f.actions, key] }));
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setModalError("");
    try {
      if (editing === "new") await api.createRole(form);
      else await api.updateRole(editing.id, form);
      setEditing(null);
      load();
    } catch (err) { setModalError(err.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(role) {
    if (!(await confirmDialog(`Delete the role "${role.name}"?`))) return;
    try { await api.deleteRole(role.id); load(); } catch (err) { notify(err.message, "error"); }
  }

  const sections = [...new Set(catalog.modules.map((m) => m.section))];
  const isSystem = editing && editing !== "new" && editing.is_system;

  return (
    <div>
      <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
        <div className="text-xs text-text-muted">
          A role is a named set of permissions (e.g. Storekeeper, Accountant). Changes apply to everyone in that role immediately.
        </div>
        <Button onClick={() => open(null)}>+ New Role</Button>
      </div>
      {error && <div className="text-sm text-red mb-3">{error}</div>}
      <Table
        columns={[
          { key: "name", label: "Role", render: (r) => <div><span className="font-medium">{r.name}</span>{r.description && <div className="text-xs text-text-muted">{r.description}</div>}</div> },
          {
            key: "access", label: "Access",
            render: (r) => r.is_admin
              ? <Badge tone="amber">Full access</Badge>
              : <span className="text-xs text-text-muted">
                  {Object.values(r.modules).filter((v) => v === "edit").length} edit · {Object.values(r.modules).filter((v) => v === "view").length} view-only
                  {r.actions.length > 0 && ` · ${r.actions.length} special`}
                </span>,
          },
          { key: "users", label: "Accounts", render: (r) => r.user_count },
          {
            key: "actions", label: "",
            render: (r) => (
              <div className="flex items-center gap-3 text-xs">
                <button type="button" className="text-amber-soft hover:underline" onClick={() => open(r)}>Edit</button>
                {!r.is_system && <button type="button" className="text-red hover:underline" onClick={() => handleDelete(r)}>Delete</button>}
              </div>
            ),
          },
        ]}
        rows={roles}
      />

      {editing && form && (
        <Modal title={editing === "new" ? "New Role" : `Edit role — ${editing.name}`} onClose={() => setEditing(null)} wide>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Role name" value={form.name} disabled={isSystem} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input label="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={form.is_admin} disabled={isSystem}
                onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} />
              <span>
                <span className="font-medium">Administrator — full access to everything</span>
                <span className="block text-xs text-text-muted">Includes managing accounts and the Danger Zone data reset. Give this to as few people as possible.</span>
              </span>
            </label>

            {!form.is_admin && (
              <>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-text-muted">Set every module to:</span>
                  {["none", "view", "edit"].map((lv) => (
                    <button key={lv} type="button" onClick={() => setAll(lv)}
                      className="px-2 py-1 rounded border border-border hover:border-amber text-text-muted hover:text-text">
                      {LEVEL_LABELS[lv]}
                    </button>
                  ))}
                </div>

                <div className="border border-border rounded-md divide-y divide-border">
                  {sections.map((section) => (
                    <div key={section}>
                      <div className="px-3 py-1.5 bg-surface-2 text-[11px] uppercase tracking-widest text-text-muted">{section}</div>
                      {catalog.modules.filter((m) => m.section === section).map((m) => {
                        const level = form.modules[m.key] || "none";
                        return (
                          <div key={m.key} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                            <div className="text-sm">{m.label}</div>
                            <div className="flex gap-3 text-xs">
                              {["none", "view", "edit"].map((lv) => (
                                <label key={lv} className={`flex items-center gap-1 cursor-pointer ${level === lv ? "text-amber-soft" : "text-text-muted"}`}>
                                  <input type="radio" name={`perm-${m.key}`} checked={level === lv} onChange={() => setLevel(m.key, lv)} />
                                  {LEVEL_LABELS[lv]}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <div>
                  <div className="text-xs text-text-muted mb-1.5">Special permissions</div>
                  {catalog.actions.map((a) => (
                    <label key={a.key} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.actions.includes(a.key)} onChange={() => toggleAction(a.key)} />
                      {a.label}
                    </label>
                  ))}
                </div>

                <div className="text-xs text-text-muted border-t border-border pt-3">
                  Good to know: any signed-in user can see the basic lists of vendors, items, warehouses, customers, distributors and recipes so
                  dropdowns work — but not balances or ledgers. Screens also read the related data they need (for example Goods Received can read
                  Purchase Orders, and Production Orders can read Stock) without being given those sections. Invoice branding is readable by everyone so invoices can be printed.
                </div>
              </>
            )}

            {modalError && <div className="text-xs text-red">{modalError}</div>}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Role"}</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- Page
export default function Accounts() {
  const [tab, setTab] = useState("users");
  const [changed, setChanged] = useState(false);

  return (
    <div>
      <SectionTitle eyebrow="Settings" title="Accounts" />
      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); setChanged(false); }}
            className={`shrink-0 min-h-[44px] px-5 rounded-full text-sm font-bold border transition-colors whitespace-nowrap
              ${tab === t.key ? "bg-forest text-white border-forest" : "bg-surface text-forest border-border hover:border-brand"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "roles" && <RolesTab />}
      {tab === "me" && (
        <Card className="max-w-sm">
          <ChangePasswordForm onDone={() => setChanged(true)} />
          {changed && <div className="text-xs text-green mt-3">Password changed. Your other devices have been signed out.</div>}
        </Card>
      )}
    </div>
  );
}
