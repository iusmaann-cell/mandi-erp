import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import ChangePasswordForm from "../components/ChangePasswordForm";
import Icon from "../components/Icon";

/* Two-panel desktop / bottom-sheet phone layout shared by sign-in and choose-password. */
function AuthLayout({ children }) {
  return (
    <div className="min-h-[100dvh] font-body flex flex-col lg:flex-row bg-forest lg:bg-ivory">
      <div className="relative bg-forest overflow-hidden flex flex-col items-center justify-center text-center
        h-[290px] lg:h-auto lg:min-h-[100dvh] lg:w-[600px] lg:shrink-0 px-6">
        <svg className="absolute inset-0 w-full h-full opacity-30 pointer-events-none" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#C49A3A" strokeWidth="1.5">
          <path d="M-40 820V330a340 340 0 0 1 680 0v490" />
          <path d="M20 820V340a280 280 0 0 1 560 0v480" />
        </svg>
        <img src="/logo.png" alt="Riwayat Oils and Fats" className="relative w-[170px] lg:w-[340px] rounded-full" />
        <div className="relative hidden lg:block mt-8">
          <div className="text-gold-soft text-sm font-bold tracking-[.3em]">PURITY. QUALITY. TRUST.</div>
          <div className="text-white font-display text-2xl font-extrabold mt-6">Mill Management System</div>
          <div className="text-white/65 text-sm mt-1">Procurement · Production · Sales · Finance</div>
        </div>
      </div>
      <div className="flex-1 flex items-stretch lg:items-center justify-center -mt-8 lg:mt-0 px-0 lg:px-10">
        <div className="w-full lg:max-w-[440px] lg:flex-none bg-surface rounded-t-[32px] lg:rounded-[28px] lg:shadow-frame p-7 sm:p-10 pb-10">
          {children}
          <div className="mt-8 text-center text-xs text-text-muted">© Riwayat Oils and Fats</div>
        </div>
      </div>
    </div>
  );
}

function IconField({ icon, right, ...props }) {
  return (
    <div className="relative">
      <Icon name={icon} size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
      <input className={`field !pl-11 ${right ? "!pr-12" : ""} ${props.invalid ? "field-error" : ""}`} {...props} invalid={undefined} />
      {right}
    </div>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasUsers, setHasUsers] = useState(true);

  useEffect(() => { api.getAuthStatus().then((s) => setHasUsers(s.has_users)).catch(() => {}); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try { await signIn(username.trim(), password); }
    catch (err) { setError(err.message || "Could not sign in"); }
    finally { setBusy(false); }
  }

  const locked = /lock|too many|attempt/i.test(error);
  return (
    <AuthLayout>
      <h1 className="font-display text-[28px] font-extrabold text-forest">Welcome back</h1>
      <p className="text-text-muted text-sm mt-1 mb-6">Sign in with your username to open the mill.</p>
      {error && (
        <div role="alert" className="mb-5 rounded-[20px] bg-[#FCEEEC] border border-[#F0C9C4] px-4 py-3.5">
          <div className="font-bold text-[#8E2A21] text-sm">{locked ? "Too many attempts" : "Incorrect username or password"}</div>
          <div className="text-[13px] text-[#8E2A21]/85 mt-0.5">
            {locked ? error : "Check your details and try again. After 5 wrong attempts this username is locked for 5 minutes."}
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="block text-[13px] font-bold text-forest mb-1.5">Username</span>
          <IconField icon="user" invalid={!!error} autoComplete="username" autoCapitalize="none" value={username}
            onChange={(e) => setUsername(e.target.value)} required autoFocus placeholder="Your username" />
        </label>
        <label className="block">
          <span className="block text-[13px] font-bold text-forest mb-1.5">Password</span>
          <IconField icon="lock" invalid={!!error} type={show ? "text" : "password"} autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required placeholder="Your password"
            right={<button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-text-muted hover:text-brand flex items-center justify-center">
              <Icon name={show ? "eyeoff" : "eye"} size={18} /></button>} />
        </label>
        <button type="submit" disabled={busy}
          className="w-full min-h-[56px] rounded-full bg-forest text-white font-extrabold text-base flex items-center justify-center gap-2 hover:bg-brand transition-colors disabled:opacity-60">
          {busy ? "Signing in…" : <>Sign in <Icon name="arrow" size={18} /></>}
        </button>
      </form>
      {!hasUsers && (
        <div className="mt-5 rounded-[20px] bg-[#FBF1D6] text-[#7A5A10] text-[13px] px-4 py-3">
          No accounts exist yet. Set <b>ADMIN_USERNAME</b> and <b>ADMIN_PASSWORD</b> on the backend service (Railway → Variables) and let it redeploy, then sign in here.
        </div>
      )}
      <p className="mt-6 text-center text-[13px] text-text-muted">
        Forgot your password? Ask an administrator to reset it from <b className="text-forest">Settings → Accounts</b>.
      </p>
    </AuthLayout>
  );
}

// Shown instead of the app when an administrator issued a temporary password.
export function ForcePasswordChange() {
  const { user, signOut } = useAuth();
  return (
    <AuthLayout>
      <span className="inline-block rounded-full bg-gold-soft text-forest text-[11px] font-extrabold tracking-[.14em] px-3.5 py-1.5 mb-4">TEMPORARY PASSWORD</span>
      <h1 className="font-display text-[28px] font-extrabold text-forest">Choose a new password</h1>
      <p className="text-text-muted text-sm mt-1 mb-6">Hi {user.full_name} — an administrator set your password. Pick your own before you continue.</p>
      <ChangePasswordForm temporary />
      <button type="button" onClick={signOut} className="mt-5 w-full text-sm font-bold text-brand hover:underline min-h-[44px]">Sign out</button>
    </AuthLayout>
  );
}
