// Opens a print-ready page (company header + one or more tables) and triggers the browser's print
// dialog — from there it can also be saved as a PDF. Used by the item list and the stock report.
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function printReport(settings, { title, subtitle, sections }) {
  const accent = settings?.accent_color || "#1F6B3A";
  const logo = settings?.show_logo && settings?.logo_base64
    ? `<img src="${settings.logo_base64}" style="height:16mm;object-fit:contain;margin-right:12px" />` : "";
  const company = esc(settings?.company_name || "Riwayat Oils and Fats");

  const tables = sections.map((s) => `
    ${s.heading ? `<h2>${esc(s.heading)}</h2>` : ""}
    ${s.note ? `<div class="note">${esc(s.note)}</div>` : ""}
    <table>
      <thead><tr>${s.columns.map((c) => `<th style="text-align:${c.align || "left"}">${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>
        ${s.rows.length === 0 ? `<tr><td colspan="${s.columns.length}" class="empty">${esc(s.empty || "Nothing to show")}</td></tr>` : ""}
        ${s.rows.map((r) => `<tr>${r.map((cell, i) => `<td style="text-align:${s.columns[i].align || "left"}">${esc(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody>
      ${s.footer ? `<tfoot><tr><td colspan="${s.columns.length}" style="text-align:right">${esc(s.footer)}</td></tr></tfoot>` : ""}
    </table>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1c2a22; font-size: 12px; }
    .head { display:flex; align-items:center; border-bottom: 3px solid ${accent}; padding-bottom: 8px; margin-bottom: 14px; }
    .co { font-size: 18px; font-weight: 700; color: ${accent}; }
    h1 { font-size: 16px; margin: 0 0 2px; }
    .sub { color: #5b6b62; margin-bottom: 12px; }
    h2 { font-size: 13px; margin: 18px 0 4px; color: ${accent}; }
    .note { color:#5b6b62; font-size: 11px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    th { background: ${accent}; color: #fff; padding: 6px 7px; font-size: 11px; }
    td { padding: 5px 7px; border-bottom: 1px solid #dfe5e1; }
    tfoot td { font-weight: 700; background: #f1f5f2; }
    .empty { color:#77857d; font-style: italic; }
    thead { display: table-header-group; }
  </style></head><body>
    <div class="head">${logo}<div><div class="co">${company}</div></div></div>
    <h1>${esc(title)}</h1><div class="sub">${esc(subtitle || "")}</div>
    ${tables}
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) throw new Error("Your browser blocked the print window — allow pop-ups for this site and try again.");
  w.document.write(html);
  w.document.close();
}
