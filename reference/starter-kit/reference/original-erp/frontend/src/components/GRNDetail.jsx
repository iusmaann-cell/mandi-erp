import { resolveFileUrl } from "../api";
import { Modal, DetailRow, formatPKR } from "./ui";

/* Read-only details of one goods-received note. */
export default function GRNDetail({ grn, po, vendor, items, uoms, warehouses, onClose }) {
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const unit = (it) => uoms.find((u) => u.id === it?.uom_id)?.symbol || "";
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || "—";
  const goods = grn.lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const freight = grn.freight_amount || 0;

  return (
    <Modal wide title={grn.grn_number} subtitle={po ? `Against ${po.po_number}${vendor ? ` · ${vendor.name}` : ""}` : undefined} onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-[22px] bg-surface-2 px-5 py-2">
          <DetailRow label="Received on">{new Date(grn.received_date).toLocaleString()}</DetailRow>
          {po && <DetailRow label="Purchase order">{po.po_number}</DetailRow>}
          {vendor && <DetailRow label="Vendor">{vendor.name}</DetailRow>}
          <DetailRow label="Vehicle no.">{grn.vehicle_no || "—"}</DetailRow>
          {grn.notes && <DetailRow label="Notes">{grn.notes}</DetailRow>}
        </div>

        <div>
          <div className="text-[13px] font-bold text-forest mb-2">Items received</div>
          <div className="space-y-2">
            {grn.lines.map((l) => {
              const it = itemById[l.item_id];
              return (
                <div key={l.id} className="rounded-[20px] bg-surface-2 p-4">
                  <div className="flex justify-between gap-3">
                    <div className="font-extrabold text-forest leading-tight">{it?.name || `Item #${l.item_id}`}</div>
                    <div className="stencil font-bold whitespace-nowrap">Rs. {formatPKR(l.quantity * l.rate)}</div>
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {l.quantity}{unit(it) ? ` ${unit(it)}` : ""} × Rs. {formatPKR(l.rate)} · into {whName(l.warehouse_id)}
                  </div>
                  <div className="text-xs mt-1">Batch <span className="stencil font-bold text-forest">{l.batch_no}</span></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[22px] bg-mint px-5 py-3 text-sm text-forest space-y-1">
          <div className="flex justify-between"><span>Goods received</span><span className="stencil font-bold">Rs. {formatPKR(goods)}</span></div>
          <div className="flex justify-between"><span>Freight</span><span className="stencil font-bold">Rs. {formatPKR(freight)}</span></div>
          <div className="flex justify-between border-t border-forest/15 pt-1 mt-1"><span className="font-bold">Total</span><span className="stencil font-extrabold">Rs. {formatPKR(goods + freight)}</span></div>
        </div>

        {grn.bill_photo_url && (
          <div>
            <div className="text-[13px] font-bold text-forest mb-2">Vendor's bill</div>
            <a href={resolveFileUrl(grn.bill_photo_url)} target="_blank" rel="noreferrer" className="block rounded-[22px] overflow-hidden border border-border bg-surface-2">
              <img src={resolveFileUrl(grn.bill_photo_url)} alt="Vendor bill" className="w-full max-h-[360px] object-contain" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              <div className="px-4 py-3 text-sm font-bold text-brand">Open full size</div>
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}
