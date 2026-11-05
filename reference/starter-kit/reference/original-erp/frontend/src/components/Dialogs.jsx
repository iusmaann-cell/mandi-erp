import { useEffect, useState } from "react";
import Icon from "./Icon";

/*
  Styled replacements for window.confirm() and alert().

    if (!(await confirmDialog("Delete this vendor?"))) return;
    notify("Could not save", "error");

  <DialogHost /> is mounted once in the app shell and listens for these calls.
*/

export function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("ui:confirm", { detail: { message, ...opts, resolve } }));
  });
}

export function notify(message, tone = "info", title) {
  window.dispatchEvent(new CustomEvent("ui:toast", { detail: { message, tone, title } }));
}

const TOAST_TONES = {
  success: { fg: "#1B5E32", bg: "#E3F1E5", icon: "check", title: "Done" },
  error: { fg: "#B3342A", bg: "#FCEEEC", icon: "alert", title: "Something went wrong" },
  warning: { fg: "#7A5A10", bg: "#FBF1D6", icon: "clock", title: "Please check" },
  info: { fg: "#1F4E79", bg: "#E6EEF6", icon: "info", title: "Note" },
};

let toastId = 0;

export function DialogHost() {
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onConfirm = (e) => setConfirmState(e.detail);
    const onToast = (e) => {
      const id = ++toastId;
      setToasts((t) => [...t, { id, ...e.detail }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), e.detail.tone === "error" ? 8000 : 5000);
    };
    window.addEventListener("ui:confirm", onConfirm);
    window.addEventListener("ui:toast", onToast);
    return () => {
      window.removeEventListener("ui:confirm", onConfirm);
      window.removeEventListener("ui:toast", onToast);
    };
  }, []);

  function answer(value) {
    confirmState?.resolve(value);
    setConfirmState(null);
  }

  useEffect(() => {
    if (!confirmState) return;
    const onKey = (e) => { if (e.key === "Escape") answer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmState]);

  const danger = confirmState ? confirmState.danger !== false : true;

  return (
    <>
      {confirmState && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-forest/55 p-4 anim-fade"
          onClick={() => answer(false)}
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={confirmState.title || "Please confirm"}
            className="w-full max-w-md bg-surface rounded-[28px] p-7 shadow-frame flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-[52px] h-[52px] rounded-full flex items-center justify-center"
              style={{ background: danger ? "#FCEEEC" : "#E3F1E5", color: danger ? "#B3342A" : "#1B5E32" }}
            >
              <Icon name={danger ? "alert" : "check"} size={24} />
            </div>
            <div>
              <div className="text-xl font-extrabold text-text">{confirmState.title || (danger ? "Are you sure?" : "Please confirm")}</div>
              <div className="text-sm text-text-muted mt-1.5 leading-relaxed whitespace-pre-line">{confirmState.message}</div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => answer(false)}
                className="flex-1 h-12 rounded-full border-[1.5px] border-border bg-white font-bold text-sm text-text hover:border-gold"
              >
                {confirmState.cancelLabel || "Keep it"}
              </button>
              <button
                type="button"
                onClick={() => answer(true)}
                className={`flex-1 h-12 rounded-full font-bold text-sm text-white ${danger ? "bg-red hover:bg-[#9a2c23]" : "bg-forest hover:bg-[#145230]"}`}
              >
                {confirmState.confirmLabel || (danger ? "Yes, delete" : "Yes, continue")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed z-[80] top-3 left-3 right-3 sm:left-auto sm:right-6 sm:top-6 sm:w-[380px] flex flex-col gap-3 pointer-events-none">
        {toasts.map((t) => {
          const tone = TOAST_TONES[t.tone] || TOAST_TONES.info;
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto anim-toast flex items-center gap-3.5 bg-white rounded-[20px] border border-border/70 shadow-frame px-4 py-3.5"
              style={{ borderLeft: `6px solid ${tone.fg}` }}
            >
              <div className="w-[38px] h-[38px] rounded-full flex items-center justify-center shrink-0" style={{ background: tone.bg, color: tone.fg }}>
                <Icon name={tone.icon} size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold text-text">{t.title || tone.title}</div>
                <div className="text-xs text-text-muted break-words">{t.message}</div>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                className="text-text-muted hover:text-text"
                onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
