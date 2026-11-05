import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { confirmDialog } from "./Dialogs";

export { confirmDialog, notify } from "./Dialogs";

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-surface border border-border/70 rounded-3xl p-5 sm:p-6 shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, action, subtitle }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-bold tracking-wide text-brand/80 mb-1">{eyebrow}</div>}
        <h1 className="font-display text-2xl sm:text-[30px] font-extrabold text-forest tracking-tight leading-tight">{title}</h1>
        {subtitle && <div className="text-sm sm:text-[15px] text-text-muted mt-1.5">{subtitle}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function Button({ children, variant = "primary", size = "md", className = "", ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { lg: "h-14 px-7 text-base", md: "h-12 px-6 text-sm", sm: "h-10 px-4 text-xs" };
  const variants = {
    primary: "bg-forest text-white hover:bg-[#145230]",
    secondary: "bg-white text-text border-[1.5px] border-border hover:border-gold",
    ghost: "text-text-muted hover:text-text hover:bg-surface-2",
    danger: "bg-red text-white hover:bg-[#9a2c23]",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

function FieldLabel({ label }) {
  return label ? <span className="block text-[13px] font-semibold text-text mb-2">{label}</span> : null;
}

export function Input({ label, hint, error, className = "", ...props }) {
  return (
    <label className="block w-full sm:w-auto">
      <FieldLabel label={label} />
      <input className={`field ${error ? "field-error" : ""} ${className}`} {...props} />
      {hint && !error && <span className="block text-xs text-text-muted mt-1.5">{hint}</span>}
      {error && <span className="block text-xs font-semibold text-red mt-1.5">{error}</span>}
    </label>
  );
}

export function Select({ label, hint, children, className = "", ...props }) {
  return (
    <label className="block w-full sm:w-auto">
      <FieldLabel label={label} />
      <select className={`field ${className}`} {...props}>
        {children}
      </select>
      {hint && <span className="block text-xs text-text-muted mt-1.5">{hint}</span>}
    </label>
  );
}

export function Textarea({ label, hint, className = "", ...props }) {
  return (
    <label className="block">
      <FieldLabel label={label} />
      <textarea className={`field ${className}`} {...props} />
      {hint && <span className="block text-xs text-text-muted mt-1.5">{hint}</span>}
    </label>
  );
}

/*
  Table: a real table from md upwards; on phones every row becomes a card —
  the first column is the heading, the rest are "label: value" lines, and a
  column with no label (edit / delete buttons) sits at the bottom.
*/
// onRowClick(row): makes each row (and phone card) open something, e.g. a details panel.
// Clicks on buttons / links / inputs inside the row keep doing their own thing.
export function Table({ columns, rows, emptyLabel = "Nothing here yet.", onRowClick }) {
  const clickProps = (row) => onRowClick ? {
    onClick: (e) => { if (!e.target.closest("button, a, input, select, label, textarea")) onRowClick(row); },
    role: "button", tabIndex: 0,
    onKeyDown: (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row); },
  } : {};
  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2/60 border border-dashed border-border py-10 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-mint text-brand flex items-center justify-center">
          <Icon name="box" size={22} />
        </div>
        <div className="text-sm text-text-muted max-w-sm">{emptyLabel}</div>
      </div>
    );
  }
  const [first, ...rest] = columns;
  return (
    <>
      <div className="hidden md:block overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-muted text-[11px] font-bold uppercase tracking-wider">
              {columns.map((col) => (
                <th key={col.key} className="text-left px-3 py-2.5 font-bold whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} {...clickProps(row)} className={`border-t border-[#EEF1EB] hover:bg-surface-2/70 transition-colors ${onRowClick ? "cursor-pointer" : ""}`}>
                {columns.map((col) => (
                  <td key={col.key} className={`px-3 py-3.5 align-middle ${col.mono ? "stencil" : ""}`}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden flex flex-col gap-3">
        {rows.map((row, i) => {
          const cell = (col) => (col.render ? col.render(row) : row[col.key]);
          const labelled = rest.filter((c) => c.label);
          const actions = rest.filter((c) => !c.label);
          return (
            <div key={i} {...clickProps(row)} className={`rounded-2xl bg-surface-2/80 p-4 flex flex-col gap-2.5 ${onRowClick ? "cursor-pointer active:bg-mint" : ""}`}>
              <div className="text-[15px] font-bold text-text break-words">{cell(first)}</div>
              {labelled.map((col) => (
                <div key={col.key} className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-text-muted shrink-0">{col.label}</span>
                  <span className={`text-right min-w-0 break-words ${col.mono ? "stencil" : ""}`}>{cell(col)}</span>
                </div>
              ))}
              {actions.map((col) => {
                const content = cell(col);
                return content ? (
                  <div key={col.key} className="pt-2 mt-0.5 border-t border-border/60 flex justify-end">{content}</div>
                ) : null;
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Badge({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-[#ECEFEA] text-text-muted",
    amber: "bg-[#FBF1D6] text-goldtext",
    green: "bg-[#E3F1E5] text-green",
    red: "bg-[#FCEEEC] text-[#8E2A21]",
    blue: "bg-[#E6EEF6] text-[#1F4E79]",
  };
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  );
}

export function IconButton({ icon, label, onClick, tone = "neutral", disabled, title }) {
  const tones = {
    neutral: "bg-surface-2 text-text hover:text-brand",
    danger: "bg-[#FCEEEC] text-red hover:bg-[#f8ded9]",
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={title || label}
      disabled={disabled}
      onClick={onClick}
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

export function RowActions({ onEdit, onDelete, deleteLabel = "Delete", deleteConfirm = "Are you sure?", deleteDisabledReason, skipConfirm = false }) {
  return (
    <div className="flex items-center gap-2">
      {onEdit && <IconButton icon="edit" label="Edit" onClick={onEdit} />}
      {onDelete && (
        deleteDisabledReason ? (
          <IconButton icon="trash" label={deleteLabel} tone="danger" disabled title={deleteDisabledReason} />
        ) : (
          <IconButton
            icon="trash"
            label={deleteLabel}
            tone="danger"
            onClick={async () => {
              if (skipConfirm || await confirmDialog(deleteConfirm, { title: `${deleteLabel}?`, confirmLabel: `Yes, ${deleteLabel.toLowerCase()}` })) onDelete();
            }}
          />
        )
      )}
    </div>
  );
}

export function formatPKR(amount) {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(amount || 0);
}

/* Short money for big numbers: 18,400,000 → 18.4M. */
export function formatShort(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  return formatPKR(n);
}

/*
  Slide-over panel: slides in from the right on tablets/PCs, rises from the
  bottom as a full-width sheet on phones. Used for every "add / edit" form.
*/
export function Modal({ title, subtitle, onClose, children, wide = false, footer }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-forest/45 anim-fade" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`anim-panel bg-surface w-full ${wide === "xl" ? "md:max-w-[min(980px,96vw)]" : wide ? "md:max-w-[680px]" : "md:max-w-[480px]"}
          max-h-[92vh] md:max-h-none md:h-full rounded-t-[28px] md:rounded-t-none md:rounded-l-[32px]
          shadow-frame flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 sm:px-8 pt-6 sm:pt-7 pb-4 shrink-0">
          <div className="min-w-0">
            <h3 className="font-display text-xl sm:text-[22px] font-extrabold text-forest leading-tight">{title}</h3>
            {subtitle && <div className="text-sm text-text-muted mt-1">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 shrink-0 rounded-full bg-surface-2 text-text flex items-center justify-center hover:text-brand"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 sm:px-8 pb-6">{children}</div>
        {footer && <div className="shrink-0 border-t border-border/60 px-6 sm:px-8 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/* A form shown in the slide-over. Pages use it instead of an inline card. */
export function FormPanel({ title, subtitle, onClose, children, wide }) {
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} wide={wide}>
      {children}
    </Modal>
  );
}

export function Stat({ icon = "chart", tone = "green", label, value, sub }) {
  const tones = {
    green: ["#E3F1E5", "#1B5E32"],
    yellow: ["#FBF1D6", "#7A5A10"],
    red: ["#FCEEEC", "#8E2A21"],
    blue: ["#E6EEF6", "#1F4E79"],
  };
  const [bg, fg] = tones[tone] || tones.green;
  return (
    <Card className="flex flex-col gap-3.5 !p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-text-muted">{label}</div>
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: bg, color: fg }}>
          <Icon name={icon} size={20} />
        </div>
      </div>
      <div className="text-[26px] sm:text-[28px] font-extrabold text-forest tracking-tight leading-none stencil">{value}</div>
      {sub && <div className="text-xs text-text-muted leading-snug">{sub}</div>}
    </Card>
  );
}


/* Type-to-filter dropdown. options: [{ value, label, sub? }]. onChange gets the chosen value. */
export function SearchSelect({ label, value, onChange, options, placeholder = "Type to search…", disabled = false, hint }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const selected = options.find((o) => String(o.value) === String(value));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.sub || ""}`.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => { setActive(0); }, [query]);

  function pick(o) { onChange(o.value); setOpen(false); setQuery(""); }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); setQuery(""); }
  }

  return (
    <div className="block" ref={boxRef}>
      <FieldLabel label={label} />
      <div className="relative">
        <input
          className="field"
          disabled={disabled}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : (selected ? selected.label : "")}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {open && !disabled && (
          <div className="absolute z-30 left-0 right-0 top-[52px] max-h-64 overflow-y-auto bg-surface rounded-[20px] border border-border shadow-frame p-1.5">
            {shown.length === 0 && <div className="px-4 py-3 text-sm text-text-muted">No match</div>}
            {shown.map((o, i) => (
              <button
                type="button" key={o.value}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-4 min-h-[44px] py-1.5 rounded-full text-sm ${i === active ? "bg-mint text-forest font-bold" : "text-text"} ${String(o.value) === String(value) ? "font-bold" : ""}`}
              >
                {o.label}{o.sub && <span className="text-text-muted text-xs ml-2">{o.sub}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {hint && <span className="block text-xs text-text-muted mt-1.5">{hint}</span>}
    </div>
  );
}

/* Read-only "label: value" rows for details panels. */
export function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm border-b border-border/50 last:border-0">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="text-right min-w-0 break-words font-semibold text-text">{children ?? "—"}</span>
    </div>
  );
}
