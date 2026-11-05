// Opens a new window with a styled, print-ready invoice and triggers the browser
// print dialog. Used by both Commission Invoices and Sales Invoices — the shape
// passed in is generic enough to cover a toll processing fee invoice or a
// product sales invoice.
export function printInvoice(settings, invoice) {
  const {
    docType,          // "Commission Invoice" | "Sales Invoice"
    invoiceNumber,
    date,
    partyLabel,       // "Bill To (Toll Customer)" | "Bill To (Distributor)"
    partyName,
    partyAddress,
    lines,            // [{ description, quantity, rate, amount }]
    subtotal,
    taxRate,
    taxAmount,
    total,
    paymentStatus,
    notes,
  } = invoice;

  const accent = settings?.accent_color || "#1F6B3A";
  const logoHtml = settings?.show_logo && settings?.logo_base64
    ? `<img src="${settings.logo_base64}" style="width:${settings.logo_width_mm}mm;height:${settings.logo_height_mm}mm;object-fit:contain;" />`
    : "";

  const lineRows = lines.map((l) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #ddd;">${l.description}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">${l.quantity ?? ""}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">${l.rate != null ? "Rs. " + Number(l.rate).toLocaleString() : ""}</td>
      <td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">Rs. ${Number(l.amount).toLocaleString()}</td>
    </tr>
  `).join("");

  const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${docType} ${invoiceNumber}</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 30px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${accent}; padding-bottom: 16px; margin-bottom: 24px; }
        .company-name { font-size: 22px; font-weight: bold; color: ${accent}; }
        .doc-title { font-size: 18px; font-weight: bold; text-align: right; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { background: #f5f5f5; padding: 8px; text-align: left; border-bottom: 2px solid #ccc; }
        .totals { margin-top: 16px; width: 300px; margin-left: auto; }
        .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
        .totals .grand { font-weight: bold; font-size: 16px; border-top: 2px solid #333; padding-top: 8px; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 12px; }
        .status { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .status.paid { background: #d4edda; color: #155724; }
        .status.unpaid { background: #f8d7da; color: #721c24; }
        @media print { body { margin: 10mm; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          ${logoHtml}
          <div class="company-name">${settings?.company_name || "Company"}</div>
          <div>${settings?.company_address || ""}</div>
          <div>${settings?.company_phone || ""} ${settings?.company_email || ""}</div>
          ${settings?.ntn_number ? `<div>NTN: ${settings.ntn_number}</div>` : ""}
        </div>
        <div>
          <div class="doc-title">${docType}</div>
          <div>#${invoiceNumber}</div>
          <div>${new Date(date).toLocaleDateString()}</div>
          <div style="margin-top:8px;"><span class="status ${paymentStatus}">${paymentStatus.toUpperCase()}</span></div>
        </div>
      </div>

      <div><strong>${partyLabel}:</strong><br/>${partyName}${partyAddress ? "<br/>" + partyAddress : ""}</div>

      <table>
        <thead><tr><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>${lineRows}</tbody>
      </table>

      <div class="totals">
        <div><span>Subtotal</span><span>Rs. ${Number(subtotal).toLocaleString()}</span></div>
        ${taxRate ? `<div><span>Tax (${taxRate}%)</span><span>Rs. ${Number(taxAmount).toLocaleString()}</span></div>` : ""}
        <div class="grand"><span>Total</span><span>Rs. ${Number(total).toLocaleString()}</span></div>
      </div>

      ${notes ? `<div style="margin-top:16px;"><strong>Notes:</strong> ${notes}</div>` : ""}

      <div class="footer">${settings?.footer_text || ""}</div>

      <script>window.onload = () => { window.print(); };</script>
    </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups to print the invoice.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
