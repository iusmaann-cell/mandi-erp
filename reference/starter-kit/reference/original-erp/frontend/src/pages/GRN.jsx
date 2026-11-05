import { useEffect, useState } from "react";
import { useIntent } from "../nav";
import { api, resolveFileUrl, pktToday } from "../api";
import { generateDocNumber } from "../docNumbers";
import { Card, SectionTitle, Button, Input, Select, Table, formatPKR, FormPanel } from "../components/ui";
import BillPhotoUpload from "../components/BillPhotoUpload";
import GRNDetail from "../components/GRNDetail";

export default function GRN() {
  const [grns, setGrns] = useState([]);
  const [pos, setPos] = useState([]);
  const [allPos, setAllPos] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [detailGrn, setDetailGrn] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [items, setItems] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [freight, setFreight] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [grnNumber, setGrnNumber] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [receiveLines, setReceiveLines] = useState([]); // one per PO line still open
  const [billPhoto, setBillPhoto] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [grnData, poData, whData, itemData, uomData, vendData] = await Promise.all([api.getGRNs(), api.getPurchaseOrders(), api.getWarehouses(), api.getItems(), api.getUOMs(), api.getVendors()]);
    setAllPos(poData);
    setVendors(vendData);
    setGrns(grnData.sort((a, b) => b.id - a.id));
    setPos(poData.filter((p) => p.status === "approved" || p.status === "partially_received"));
    setWarehouses(whData);
    setItems(itemData);
    setUoms(uomData);
  }

  const itemById = Object.fromEntries(items.map((it) => [it.id, it]));
  const uomOf = (it) => uoms.find((u) => u.id === it?.uom_id)?.symbol || "";

  // Batch numbers are generated as BATCH-<d><mm><yy>-<ITEMNAME>-<n>, e.g. BATCH-41026-VITAMINA-3 =
  // the 3rd batch of Vitamin A on 4 Oct 2026. n counts every batch already received for the item.
  // The server uses the same rule, so a blank box is filled in there too.
  const itemTag = (it) => (it?.name || "").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "") || (it?.code || "").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "") || `ITEM${it?.id}`;
  function autoBatchNos(lines, grnList = grns) {
    const [y, m, d] = pktToday().split("-");
    const stem = `BATCH-${Number(d)}${m}${y.slice(2)}`;
    const base = {};
    grnList.forEach((g) => g.lines.forEach((l) => { base[l.item_id] = (base[l.item_id] || 0) + 1; }));
    const seen = {};
    return lines.map((l) => {
      seen[l.item_id] = (seen[l.item_id] || 0) + 1;
      return `${stem}-${itemTag(itemById[l.item_id])}-${(base[l.item_id] || 0) + seen[l.item_id]}`;
    });
  }

  useEffect(() => { load(); }, []);
  useIntent("grn", () => { setGrnNumber(generateDocNumber("GRN")); setShowForm(true); });

  function selectPo(poId) {
    setSelectedPoId(poId);
    const po = pos.find((p) => p.id === Number(poId));
    if (!po) { setReceiveLines([]); return; }
    const open = po.lines
      .filter((l) => l.received_quantity < l.quantity - 1e-6)
      .map((l) => ({
        po_line_id: l.id,
        item_id: l.item_id,
        ordered: l.quantity,
        remaining: l.quantity - l.received_quantity,
        quantity: l.quantity - l.received_quantity,
        rate: l.rate,
        warehouse_id: "",
        batch_no: "",
      }));
    const nos = autoBatchNos(open);
    setReceiveLines(open.map((l, i) => ({ ...l, batch_no: nos[i] })));
  }

  function updateLine(i, field, value) {
    const next = [...receiveLines];
    next[i] = { ...next[i], [field]: value };
    setReceiveLines(next);
  }

  const goodsValue = receiveLines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    if (!billPhoto) {
      setError("A photo of the vendor's bill is required.");
      return;
    }
    try {
      const lines = receiveLines
        .filter((l) => l.quantity && l.warehouse_id)
        .map((l) => ({
          po_line_id: l.po_line_id,
          item_id: l.item_id,
          warehouse_id: Number(l.warehouse_id),
          batch_no: l.batch_no,
          quantity: Number(l.quantity),
          rate: Number(l.rate),
        }));
      if (lines.length === 0) {
        setError("Choose a warehouse (and the quantity received) for at least one line.");
        return;
      }
      setSaving(true);
      await api.createGRN({
        grn_number: grnNumber,
        purchase_order_id: Number(selectedPoId),
        vehicle_no: vehicleNo,
        freight_amount: Number(freight) || 0,
        lines,
      }, billPhoto);
      setGrnNumber("");
      setVehicleNo("");
      setFreight("");
      setSelectedPoId("");
      setReceiveLines([]);
      setBillPhoto(null);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionTitle
        eyebrow="Procurement"
        title="Goods Received (GRN)"
        action={<Button onClick={() => { if (!showForm) setGrnNumber(generateDocNumber("GRN")); setShowForm((s) => !s); }}>+ Receive Goods</Button>}
      />

      {showForm && (
        <FormPanel wide title="Receive Goods" onClose={() => setShowForm(false)}>
          {pos.length === 0 ? (
            <div className="text-text-muted text-sm">No open purchase orders to receive against. Create one first.</div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select label="Purchase order" value={selectedPoId} onChange={(e) => selectPo(e.target.value)}>
                  <option value="">Select PO&hellip;</option>
                  {pos.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
                </Select>
                <Input label="GRN number" placeholder="GRN-2026-0001" required value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} />
                <Input label="Vehicle no. (optional)" placeholder="BWP-1234" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
              </div>

              {receiveLines.length > 0 && (
                <div>
                  <div className="text-[13px] font-bold text-forest mb-2">Items to receive</div>
                  <div className="space-y-3">
                    {receiveLines.map((line, i) => {
                      const it = itemById[line.item_id];
                      const unit = uomOf(it);
                      return (
                        <div key={line.po_line_id} className="rounded-[22px] bg-surface-2 p-4 space-y-3">
                          <div>
                            <div className="text-[17px] font-extrabold text-forest leading-tight">{it?.name || `Item #${line.item_id}`}</div>
                            <div className="text-xs text-text-muted mt-0.5">
                              {it?.code ? `${it.code} · ` : ""}Ordered {line.ordered}{unit ? ` ${unit}` : ""} · Remaining {line.remaining}{unit ? ` ${unit}` : ""} · Rate Rs. {formatPKR(line.rate)}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Input label={`Quantity received${unit ? ` (${unit})` : ""}`} type="number" max={line.remaining} value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                            <Input label="Rate (Rs.)" type="number" value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                            <Select label="Warehouse" value={line.warehouse_id} onChange={(e) => updateLine(i, "warehouse_id", e.target.value)}>
                              <option value="">Select&hellip;</option>
                              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </Select>
                            <Input label="Batch / lot no." hint="Made automatically — you can change it" value={line.batch_no} onChange={(e) => updateLine(i, "batch_no", e.target.value)} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 rounded-[22px] bg-mint p-4 space-y-3">
                    <Input label="Freight charges (Rs., optional)" type="number" min="0" placeholder="0"
                      hint="Transport cost for this delivery. Added to the PO's total but shown on its own line, never mixed into the goods value."
                      value={freight} onChange={(e) => setFreight(e.target.value)} />
                    <div className="text-sm text-forest space-y-0.5">
                      <div className="flex justify-between"><span>Goods received</span><span className="stencil font-bold">Rs. {formatPKR(goodsValue)}</span></div>
                      <div className="flex justify-between"><span>Freight</span><span className="stencil font-bold">Rs. {formatPKR(Number(freight) || 0)}</span></div>
                      <div className="flex justify-between border-t border-forest/15 pt-1 mt-1"><span className="font-bold">Total</span><span className="stencil font-extrabold">Rs. {formatPKR(goodsValue + (Number(freight) || 0))}</span></div>
                    </div>
                  </div>
                </div>
              )}

              <BillPhotoUpload file={billPhoto} onChange={setBillPhoto} />

              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button type="submit" disabled={!selectedPoId || saving}>{saving ? "Uploading & Saving…" : "Save GRN"}</Button>
                {error && <span className="text-red text-sm">{error}</span>}
              </div>
            </form>
          )}
        </FormPanel>
      )}

      <Card>
        <Table
          emptyLabel="No goods received yet."
          columns={[
            { key: "grn_number", label: "GRN Number", mono: true },
            { key: "vehicle_no", label: "Vehicle", render: (row) => row.vehicle_no || "—" },
            { key: "received_date", label: "Date", render: (row) => new Date(row.received_date).toLocaleDateString() },
            { key: "batches", label: "Batches", mono: true, render: (row) => row.lines.map((l) => l.batch_no).join(", ") },
            {
              key: "qty",
              label: "Total quantity",
              render: (row) => row.lines.reduce((s, l) => s + l.quantity, 0),
            },
            { key: "freight", label: "Freight", render: (row) => row.freight_amount > 0 ? `Rs. ${formatPKR(row.freight_amount)}` : "—" },
            {
              key: "bill", label: "Bill photo",
              render: (row) => row.bill_photo_url
                ? <a href={resolveFileUrl(row.bill_photo_url)} target="_blank" rel="noreferrer" className="text-xs text-amber-soft hover:underline">View</a>
                : <span className="text-xs text-text-muted">—</span>,
            },
          ]}
          rows={grns}
          onRowClick={(row) => setDetailGrn(row)}
        />
      </Card>

      {detailGrn && (() => {
        const po = allPos.find((p) => p.id === detailGrn.purchase_order_id);
        const vendor = vendors.find((v) => v.id === po?.vendor_id);
        return <GRNDetail grn={detailGrn} po={po} vendor={vendor} items={items} uoms={uoms} warehouses={warehouses} onClose={() => setDetailGrn(null)} />;
      })()}
    </div>
  );
}
