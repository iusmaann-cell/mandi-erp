"""
One-off data cleanup, driven by environment variables so nothing runs unless asked:

  PURGE_PO_NUMBER   the purchase order to remove completely (e.g. PO-261003-190121)
  PURGE_PO_DRY_RUN  anything except "0" only PRINTS what would be removed (default). Set "0" to delete.

Removing a PO this way also removes the goods-received notes against it, the stock those notes
added, and every vendor-ledger entry that came from the PO (bills, freight, advance, payments).
It refuses (and changes nothing) if any of that stock has since been moved, consumed or adjusted,
because deleting it would corrupt the stock ledger. A JSON backup of every removed row is written
to the uploads volume before anything is deleted. The report goes to the deploy logs ("[purge]").
"""
import os
import json
import datetime
import pathlib

from . import models, file_storage
from .database import SessionLocal


def _row(obj):
    out = {}
    for c in obj.__table__.columns:
        v = getattr(obj, c.name)
        out[c.name] = v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else getattr(v, "value", v)
    return out


def purge_orphan_payments():
    """PURGE_ORPHAN_PO_ID=<id>: remove advance/payment ledger entries whose purchase order no longer exists.
    Refuses if a PO with that id still exists. Dry run unless PURGE_PO_DRY_RUN=0. Backs up first."""
    raw = (os.getenv("PURGE_ORPHAN_PO_ID") or "").strip()
    if not raw.isdigit():
        return
    po_id = int(raw)
    dry = os.getenv("PURGE_PO_DRY_RUN", "1") != "0"
    db = SessionLocal()
    try:
        if db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == po_id).first():
            print(f"[purge] orphan check: PO id {po_id} still exists — refusing, nothing changed")
            return
        rows = db.query(models.VendorLedgerEntry).filter(
            models.VendorLedgerEntry.ref_type.in_(("PO_ADVANCE", "PO_PAYMENT")),
            models.VendorLedgerEntry.ref_id == po_id).all()
        print(f"[purge] {'DRY RUN — ' if dry else ''}orphan entries for deleted PO id {po_id}: "
              f"{[(e.id, e.ref_type, e.vendor_id, e.amount, str(e.entry_date)[:10]) for e in rows]}")
        if not rows or dry:
            print("[purge]   nothing deleted." if dry else "[purge]   nothing to delete.")
            return
        folder = pathlib.Path(file_storage.UPLOADS_DIR) / "purge_backups"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"orphan_PO{po_id}_{datetime.datetime.utcnow():%Y%m%d_%H%M%S}.json"
        path.write_text(json.dumps({"vendor_ledger": [_row(e) for e in rows]}, indent=2, default=str))
        print(f"[purge]   backup written: {path}")
        for e in rows:
            db.delete(e)
        db.commit()
        print(f"[purge]   DONE — {len(rows)} orphan entr{'y' if len(rows) == 1 else 'ies'} removed.")
    except Exception as e:
        db.rollback()
        print(f"[purge]   FAILED, nothing changed: {e}")
    finally:
        db.close()


def relink_batches():
    """RELINK_ITEM_NAME + RELINK_BATCHES (comma separated): stock batches whose item was deleted are
    moved onto an active item of that name (created if it doesn't exist, copying the old item's type,
    unit and pack details). Every row that carries one of those batch numbers for the old item is moved.
    Refuses if a batch belongs to an item that is still active. Dry run unless PURGE_PO_DRY_RUN=0."""
    name = (os.getenv("RELINK_ITEM_NAME") or "").strip()
    batches = [b.strip() for b in (os.getenv("RELINK_BATCHES") or "").split(",") if b.strip()]
    if not name or not batches:
        return
    dry = os.getenv("PURGE_PO_DRY_RUN", "1") != "0"
    db = SessionLocal()
    try:
        entries = db.query(models.StockLedgerEntry).filter(models.StockLedgerEntry.batch_no.in_(batches)).all()
        print(f"[purge] {'DRY RUN — ' if dry else ''}relink batches {batches} to item '{name}'")
        if not entries:
            print("[purge]   no stock entries carry those batch numbers — nothing to do")
            return
        old_ids = sorted({e.item_id for e in entries})
        old_items = {i.id: i for i in db.query(models.Item).filter(models.Item.id.in_(old_ids)).all()}
        for oid in old_ids:
            it = old_items.get(oid)
            net = {}
            for e in entries:
                if e.item_id == oid:
                    k = (e.batch_no, e.warehouse_id)
                    net[k] = net.get(k, 0.0) + e.quantity
            print(f"[purge]   current item id {oid}: name={getattr(it, 'name', '?')!r} code={getattr(it, 'code', '?')!r} "
                  f"active={getattr(it, 'is_active', '?')} | batch/warehouse net qty: {net}")
        active_old = [oid for oid in old_ids if old_items.get(oid) and old_items[oid].is_active]
        if active_old:
            print(f"[purge]   ABORTED — these batches belong to an item that is still active (ids {active_old}); nothing changed")
            return
        target = db.query(models.Item).filter(
            models.Item.is_active == 1, models.Item.name.ilike(name)).first()
        template = old_items.get(old_ids[0])
        if target:
            print(f"[purge]   will use the existing active item id {target.id} ({target.code})")
        else:
            print(f"[purge]   will create a new item '{name}' "
                  f"(type/unit/pack copied from deleted item id {template.id if template else '?'})")
        tables = [t for t in models.Base.metadata.tables.values()
                  if "item_id" in t.columns and "batch_no" in t.columns]
        counts = {}
        for t in tables:
            n = db.execute(t.select().where(t.c.batch_no.in_(batches), t.c.item_id.in_(old_ids))).fetchall()
            if n:
                counts[t.name] = len(n)
        print(f"[purge]   rows that will move to the new item: {counts}")
        if dry:
            print("[purge]   dry run only — nothing changed. Set PURGE_PO_DRY_RUN=0 to apply.")
            return
        if not target:
            base = "".join(ch for ch in name.upper() if ch.isalnum())[:20] or "ITEM"
            code, n = base, 1
            while db.query(models.Item).filter(models.Item.code == code).first():
                n += 1
                code = f"{base}-{n}"
            target = models.Item(
                code=code, name=name,
                item_type=template.item_type if template else models.ItemType.packaging,
                uom_id=template.uom_id if template else db.query(models.UnitOfMeasure).first().id,
                reorder_level=getattr(template, "reorder_level", None), pack_size=getattr(template, "pack_size", None),
                units_per_case=getattr(template, "units_per_case", None),
                density_kg_per_liter=getattr(template, "density_kg_per_liter", None), is_active=1)
            db.add(target)
            db.flush()
        backup = {"target_item_id": target.id, "old_item_ids": old_ids, "moved": {}}
        for t in tables:
            rows = db.execute(t.select().where(t.c.batch_no.in_(batches), t.c.item_id.in_(old_ids))).fetchall()
            if rows:
                backup["moved"][t.name] = [{"id": r._mapping["id"], "old_item_id": r._mapping["item_id"]} for r in rows]
                db.execute(t.update().where(t.c.batch_no.in_(batches), t.c.item_id.in_(old_ids)).values(item_id=target.id))
        folder = pathlib.Path(file_storage.UPLOADS_DIR) / "purge_backups"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"relink_{datetime.datetime.utcnow():%Y%m%d_%H%M%S}.json"
        path.write_text(json.dumps(backup, indent=2, default=str))
        db.commit()
        print(f"[purge]   backup written: {path}")
        print(f"[purge]   DONE — batches {batches} now belong to item id {target.id} '{target.name}' ({target.code}).")
    except Exception as e:
        db.rollback()
        print(f"[purge]   FAILED, nothing changed: {e}")
    finally:
        db.close()


def purge_sales_invoices():
    """PURGE_SALES_INVOICES=<number>,<number>: remove UNPAID sales invoices and what they posted to the
    distributor's ledger. Refuses any invoice that has a payment. Dry run unless PURGE_PO_DRY_RUN=0."""
    numbers = [n.strip() for n in (os.getenv("PURGE_SALES_INVOICES") or "").split(",") if n.strip()]
    if not numbers:
        return
    dry = os.getenv("PURGE_PO_DRY_RUN", "1") != "0"
    db = SessionLocal()
    try:
        todo = []
        for number in numbers:
            inv = db.query(models.SalesInvoice).filter(models.SalesInvoice.invoice_number == number).first()
            if not inv:
                print(f"[purge] invoice {number}: not found — nothing to do (already removed?)")
                continue
            ledger = db.query(models.DistributorLedgerEntry).filter(
                models.DistributorLedgerEntry.ref_type.in_(("SALES_INVOICE", "SALES_PAYMENT")),
                models.DistributorLedgerEntry.ref_id == inv.id).all()
            paid = inv.payment_status == models.PaymentStatus.paid or any(e.ref_type == "SALES_PAYMENT" for e in ledger)
            print(f"[purge] {'DRY RUN — ' if dry else ''}invoice {number} (id {inv.id}) distributor {inv.distributor_id} "
                  f"date {str(inv.invoice_date)[:10]} total {inv.total_amount:,.2f} status {inv.payment_status.value} "
                  f"lines {len(inv.lines)} ledger entries {[(e.ref_type, e.amount) for e in ledger]}")
            if paid:
                print(f"[purge]   SKIPPED — {number} has a payment recorded; mark it unpaid first")
                continue
            todo.append((inv, ledger))
        if dry or not todo:
            print("[purge]   dry run only — nothing deleted." if dry else "[purge]   nothing to delete.")
            return
        backup = [{"invoice": _row(i), "lines": [_row(l) for l in i.lines], "ledger": [_row(e) for e in led]} for i, led in todo]
        folder = pathlib.Path(file_storage.UPLOADS_DIR) / "purge_backups"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"sales_invoices_{datetime.datetime.utcnow():%Y%m%d_%H%M%S}.json"
        path.write_text(json.dumps(backup, indent=2, default=str))
        print(f"[purge]   backup written: {path}")
        for inv, led in todo:
            for e in led:
                db.delete(e)
            db.delete(inv)
        db.commit()
        print(f"[purge]   DONE — removed {[i.invoice_number for i, _ in todo]}.")
    except Exception as e:
        db.rollback()
        print(f"[purge]   FAILED, nothing changed: {e}")
    finally:
        db.close()


def _parse_lots(text):
    """'9920@26,8575@26,12425>9750@26' -> [(old_qty, new_qty, rate)]  ('old>new' changes the quantity too)."""
    lots = []
    for part in [x.strip() for x in text.split(",") if x.strip()]:
        qty_txt, _, rate_txt = part.partition("@")
        old_txt, _, new_txt = qty_txt.partition(">")
        old = float(old_txt)
        lots.append((old, float(new_txt) if new_txt else old, float(rate_txt)))
    return lots


def correct_po_rate():
    """PO_RATE_FIX="<PO number>=<rate>"  (one rate for every receiving) or
       PO_RATE_FIX="<PO number>=<qty>@<rate>,<qty>@<rate>,<old qty>><new qty>@<rate>,..."  (one entry per receiving,
       matched to the existing receivings by their current quantity; 'old>new' also corrects the quantity).
    Keeps the PO, its receivings and stock and corrects rate/quantity everywhere they were copied: goods-received
    lines, stock-in entries, vendor bills (GRN_BILL, GST included), the PO line (received qty, average rate) and the
    production orders that already used this stock (input cost, output unit cost, output stock rate).
    Payments and freight are untouched. Refuses (changes nothing) if a corrected stock batch would go negative or a
    production output was used again. Dry run unless PURGE_PO_DRY_RUN=0; JSON backup of every old value first."""
    spec = (os.getenv("PO_RATE_FIX") or "").strip()
    if not spec or "=" not in spec:
        return
    po_number, _, rest = spec.partition("=")
    po_number = po_number.strip()
    dry = os.getenv("PURGE_PO_DRY_RUN", "1") != "0"
    db = SessionLocal()
    try:
        po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.po_number == po_number).first()
        if not po:
            print(f"[purge] {po_number}: not found")
            return
        gst = po.gst_rate or 0.0
        grns = db.query(models.GRN).filter(models.GRN.purchase_order_id == po.id).all()
        grn_ids = [g.id for g in grns]
        grn_no = {g.id: g.grn_number for g in grns}
        grn_lines = db.query(models.GRNLine).filter(models.GRNLine.grn_id.in_(grn_ids)).order_by(models.GRNLine.id).all() if grn_ids else []
        stock_in = db.query(models.StockLedgerEntry).filter(
            models.StockLedgerEntry.ref_type == "GRN", models.StockLedgerEntry.ref_id.in_(grn_ids)).all() if grn_ids else []
        bills = db.query(models.VendorLedgerEntry).filter(
            models.VendorLedgerEntry.ref_type == "GRN_BILL", models.VendorLedgerEntry.ref_id.in_(grn_ids)).all() if grn_ids else []
        blockers = []

        # ---- decide the new quantity + rate of every receiving line ----
        plan = {}   # grn line id -> (new_qty, new_rate)
        if "@" in rest:
            pool = list(grn_lines)
            for old, new_q, r in _parse_lots(rest):
                hit = next((l for l in pool if abs(l.quantity - old) < 1e-6), None)
                if hit is None:
                    blockers.append(f"no receiving with quantity {old:g} is left to match '{old:g}@{r:g}'")
                    continue
                pool.remove(hit)
                plan[hit.id] = (new_q, r)
            for l in pool:
                blockers.append(f"receiving {grn_no[l.grn_id]} (batch {l.batch_no}, qty {l.quantity:g}) is not in the list you gave")
        else:
            rate_all = float(rest)
            if rate_all <= 0:
                print("[purge] PO_RATE_FIX: rate must be above zero — nothing to do")
                return
            plan = {l.id: (l.quantity, rate_all) for l in grn_lines}

        print(f"[purge] {'DRY RUN — ' if dry else ''}correct {po_number} (id {po.id}, status {po.status.value}, gst {gst:g}%): "
              f"{len(grns)} receivings, PO line(s) qty/rate {[(l.quantity, l.rate, l.received_quantity) for l in po.lines]}")
        backup = {"po_lines": [(l.id, l.quantity, l.rate, l.received_quantity) for l in po.lines], "po_status": po.status.value,
                  "grn_lines": [(l.id, l.quantity, l.rate) for l in grn_lines],
                  "stock_in": [(e.id, e.quantity, e.rate) for e in stock_in], "bills": [(b.id, b.amount) for b in bills],
                  "production": []}
        changes = []   # (obj, attr, new)
        batch_rate = {}    # (item, warehouse, batch) -> new rate
        grn_total = {}
        recv_q, recv_v = {}, {}   # per po_line_id
        for l in grn_lines:
            if l.id not in plan:
                continue
            nq, nr = plan[l.id]
            print(f"[purge]   {grn_no[l.grn_id]} batch {l.batch_no}: {l.quantity:g} @ {l.rate:g} -> {nq:g} @ {nr:g} = {nq * nr:,.2f}")
            changes += [(l, "quantity", nq), (l, "rate", nr)]
            batch_rate[(l.item_id, l.warehouse_id, l.batch_no)] = nr
            grn_total[l.grn_id] = grn_total.get(l.grn_id, 0.0) + nq * nr
            recv_q[l.po_line_id] = recv_q.get(l.po_line_id, 0.0) + nq
            recv_v[l.po_line_id] = recv_v.get(l.po_line_id, 0.0) + nq * nr
            for e in stock_in:
                if e.ref_id == l.grn_id and e.batch_no == l.batch_no and e.item_id == l.item_id:
                    changes += [(e, "quantity", nq), (e, "rate", nr)]
            if nq < l.quantity - 1e-9:
                net = sum(x.quantity for x in db.query(models.StockLedgerEntry).filter(
                    models.StockLedgerEntry.item_id == l.item_id, models.StockLedgerEntry.warehouse_id == l.warehouse_id,
                    models.StockLedgerEntry.batch_no == l.batch_no).all())
                if net + (nq - l.quantity) < -1e-6:
                    blockers.append(f"batch {l.batch_no} has only {net:g} left, so it can't be reduced by {l.quantity - nq:g}")
        for b in bills:
            new_amt = round(grn_total.get(b.ref_id, 0.0) * (1 + gst / 100.0), 2)
            changes.append((b, "amount", new_amt))
        print(f"[purge]   vendor bills total: {sum(b.amount for b in bills):,.2f} -> "
              f"{sum(round(grn_total.get(b.ref_id, 0.0) * (1 + gst / 100.0), 2) for b in bills):,.2f}  (GST {gst:g}% included)")

        # ---- PO line: received quantity, average rate; close-out ordered quantity if it was completed ----
        for l in po.lines:
            rq = recv_q.get(l.id)
            if rq is None:
                continue
            avg = recv_v[l.id] / rq if rq else l.rate
            new_ordered = rq if po.status == models.POStatus.completed else max(l.quantity, rq)
            print(f"[purge]   PO line: ordered {l.quantity:g} -> {new_ordered:g}, received {l.received_quantity:g} -> {rq:g}, "
                  f"average rate {l.rate:g} -> {avg:.6f}")
            changes += [(l, "received_quantity", rq), (l, "quantity", new_ordered), (l, "rate", avg)]
            if new_ordered - rq <= 1e-6:
                changes.append((po, "status", models.POStatus.completed))
            else:
                changes.append((po, "status", models.POStatus.partially_received))

        # ---- everything downstream that used this stock: production orders (and what they made), sales dispatches ----
        changed = dict(batch_rate)      # (item, warehouse, batch) -> corrected cost rate
        plans = {}                      # production order id -> plan
        all_entries = db.query(models.StockLedgerEntry).all()
        for _pass in range(30):
            touched = sorted({e.ref_id for e in all_entries
                              if e.ref_type == "PRODUCTION_ISSUE" and (e.item_id, e.warehouse_id, e.batch_no) in changed})
            grew = False
            for oid in touched:
                order = db.query(models.ProductionOrder).filter(models.ProductionOrder.id == oid).first()
                if order is None or order.customer_id is not None:
                    blockers.append(f"production order id {oid} is missing or a toll run")
                    continue
                in_lines = db.query(models.ProductionOrderInputLine).filter(
                    models.ProductionOrderInputLine.production_order_id == oid).all()
                out_lines = db.query(models.ProductionOrderOutputLine).filter(
                    models.ProductionOrderOutputLine.production_order_id == oid).all()
                new_in_rate = lambda il: changed.get((il.item_id, il.warehouse_id, il.batch_no), il.rate)
                new_cost = sum(il.quantity * new_in_rate(il) for il in in_lines if not il.is_toll_stock)
                by_value = sum(ol.quantity * ol.rate for ol in out_lines if not ol.is_primary and not ol.is_loss)
                prim_qty = sum(ol.quantity for ol in out_lines if ol.is_primary)
                if prim_qty <= 0 or new_cost - by_value < 0:
                    blockers.append(f"production order {order.order_number}: new cost would not cover byproduct value")
                    continue
                new_unit = (new_cost - by_value) / prim_qty
                plans[oid] = {"order": order, "in_lines": in_lines, "out_lines": out_lines, "new_cost": new_cost,
                              "new_unit": new_unit, "old_cost": order.total_input_cost or 0.0,
                              "old_unit": next((ol.rate for ol in out_lines if ol.is_primary), None)}
                for ol in out_lines:
                    if ol.is_primary:
                        key = (ol.item_id, ol.warehouse_id, ol.batch_no)
                        if abs(changed.get(key, -1.0) - new_unit) > 1e-9:
                            changed[key] = new_unit
                            grew = True
            # stock moved between warehouses keeps its batch number and cost, so the new rate follows it
            for e in all_entries:
                if e.ref_type == "STOCK_TRANSFER_OUT" and (e.item_id, e.warehouse_id, e.batch_no) in changed:
                    if e.is_toll_stock:
                        blockers.append(f"transfer #{e.ref_id} moved a toll customer's stock of batch {e.batch_no}")
                        continue
                    rate = changed[(e.item_id, e.warehouse_id, e.batch_no)]
                    for t in all_entries:
                        if t.ref_type == "STOCK_TRANSFER_IN" and t.ref_id == e.ref_id and t.item_id == e.item_id \
                                and t.batch_no == e.batch_no and abs(t.quantity + e.quantity) < 1e-6:
                            key_in = (t.item_id, t.warehouse_id, t.batch_no)
                            if abs(changed.get(key_in, -1.0) - rate) > 1e-9:
                                changed[key_in] = rate
                                grew = True
            if not grew:
                break
        else:
            blockers.append("the chain of production orders is too long or circular")

        moved = [e for e in all_entries if e.ref_type in ("STOCK_TRANSFER_OUT", "STOCK_TRANSFER_IN")
                 and (e.item_id, e.warehouse_id, e.batch_no) in changed and not e.is_toll_stock]
        if moved:
            print(f"[purge]   warehouse transfers affected: {len(moved)} ledger line(s) re-rated")
            backup["transfers"] = [(e.id, e.rate) for e in moved]
            for e in moved:
                changes.append((e, "rate", changed[(e.item_id, e.warehouse_id, e.batch_no)]))

        for oid in sorted(plans):
            pl = plans[oid]
            order = pl["order"]
            print(f"[purge]   production {order.order_number} (id {oid}): input cost {pl['old_cost']:,.2f} -> {pl['new_cost']:,.2f}; "
                  f"primary unit cost {pl['old_unit']} -> {pl['new_unit']:,.4f}; outputs "
                  f"{[(ol.item_id, ol.batch_no, ol.quantity) for ol in pl['out_lines']]}")
            issue_entries = [e for e in all_entries if e.ref_type == "PRODUCTION_ISSUE" and e.ref_id == oid]
            receipts = [e for e in all_entries if e.ref_type == "PRODUCTION_RECEIPT" and e.ref_id == oid]
            backup["production"].append({"order_id": oid, "total_input_cost": pl["old_cost"],
                                         "input_lines": [(il.id, il.rate) for il in pl["in_lines"]],
                                         "issues": [(e.id, e.rate) for e in issue_entries],
                                         "output_lines": [(ol.id, ol.rate) for ol in pl["out_lines"]],
                                         "receipts": [(e.id, e.rate) for e in receipts]})
            for il in pl["in_lines"]:
                key = (il.item_id, il.warehouse_id, il.batch_no)
                if key in changed:
                    changes.append((il, "rate", changed[key]))
            for e in issue_entries:
                key = (e.item_id, e.warehouse_id, e.batch_no)
                if key in changed:
                    changes.append((e, "rate", changed[key]))
            changes.append((pl["order"], "total_input_cost", pl["new_cost"]))
            out_keys = set()
            for ol in pl["out_lines"]:
                if ol.is_primary:
                    changes.append((ol, "rate", pl["new_unit"]))
                    out_keys.add((ol.item_id, ol.warehouse_id, ol.batch_no))
            for e in receipts:
                if (e.item_id, e.warehouse_id, e.batch_no) in out_keys:
                    changes.append((e, "rate", pl["new_unit"]))

        # sales dispatches that sold corrected stock: cost of goods sold follows the corrected rate
        dispatch_entries = [e for e in all_entries if e.ref_type == "SALES_DISPATCH"
                            and (e.item_id, e.warehouse_id, e.batch_no) in changed]
        if dispatch_entries:
            d_lines = db.query(models.SalesDispatchLine).all()
            old_cogs = new_cogs = 0.0
            for e in dispatch_entries:
                key = (e.item_id, e.warehouse_id, e.batch_no)
                changes.append((e, "rate", changed[key]))
                for dl in d_lines:
                    if dl.dispatch_id == e.ref_id and (dl.item_id, dl.warehouse_id, dl.batch_no) == key:
                        old_cogs += dl.quantity * (dl.cogs_rate or 0.0)
                        new_cogs += dl.quantity * changed[key]
                        changes.append((dl, "cogs_rate", changed[key]))
            print(f"[purge]   sales dispatches affected: {len(dispatch_entries)} line(s); cost of goods sold {old_cogs:,.2f} -> {new_cogs:,.2f}")
            backup["dispatch"] = [(e.id, e.rate) for e in dispatch_entries]

        allowed_out = {"PRODUCTION_ISSUE", "SALES_DISPATCH", "STOCK_TRANSFER_OUT", "STOCK_TRANSFER_IN"}
        for e in all_entries:
            if (e.item_id, e.warehouse_id, e.batch_no) in changed and e.ref_type not in allowed_out \
                    and e.ref_type not in ("GRN", "PRODUCTION_RECEIPT") and not (e.ref_type == "GRN" and e.ref_id in grn_ids):
                blockers.append(f"batch {e.batch_no} was also touched by {e.ref_type} #{e.ref_id} (qty {e.quantity:g}) — not handled automatically")
        for e in all_entries:
            if e.ref_type == "PRODUCTION_RECEIPT" and (e.item_id, e.warehouse_id, e.batch_no) in changed \
                    and e.ref_id not in plans:
                blockers.append(f"batch {e.batch_no} comes from production order #{e.ref_id}, which wasn't recalculated")
        if blockers:
            print("[purge]   ABORTED — nothing changed, because:")
            for x in sorted(set(blockers)):
                print(f"[purge]     {x}")
            return
        paid = sum(e.amount for e in db.query(models.VendorLedgerEntry).filter(
            models.VendorLedgerEntry.ref_type.in_(("PO_ADVANCE", "PO_PAYMENT")), models.VendorLedgerEntry.ref_id == po.id).all())
        print(f"[purge]   payments recorded on this PO stay as they are: Rs. {paid:,.2f}")
        if dry:
            print("[purge]   dry run only — nothing changed. Set PURGE_PO_DRY_RUN=0 to apply.")
            return
        folder = pathlib.Path(file_storage.UPLOADS_DIR) / "purge_backups"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"ratefix_{po_number}_{datetime.datetime.utcnow():%Y%m%d_%H%M%S}.json"
        path.write_text(json.dumps(backup, indent=2, default=str))
        print(f"[purge]   backup written: {path}")
        for obj, attr, val in changes:
            setattr(obj, attr, val)
        db.commit()
        print(f"[purge]   DONE — {po_number} corrected.")
    except Exception as e:
        db.rollback()
        print(f"[purge]   FAILED, nothing changed: {e}")
    finally:
        db.close()


def add_po_lot():
    """PO_ADD_LOT="<PO number>=<qty>@<rate>[,<qty>@<rate>...]"  adds new receiving(s) (GRN + stock-in + vendor bill)
    to an existing PO, same item/warehouse as its latest receiving. The PO line's ordered/received quantity grows by the
    lot and its rate becomes the weighted average. Dry run unless PURGE_PO_DRY_RUN=0."""
    spec = (os.getenv("PO_ADD_LOT") or "").strip()
    if not spec or "=" not in spec:
        return
    from .routers.grn import _auto_batch_no
    po_number, _, rest = spec.partition("=")
    po_number = po_number.strip()
    dry = os.getenv("PURGE_PO_DRY_RUN", "1") != "0"
    db = SessionLocal()
    try:
        po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.po_number == po_number).first()
        if not po:
            print(f"[purge] {po_number}: not found")
            return
        last = db.query(models.GRNLine).join(models.GRN, models.GRN.id == models.GRNLine.grn_id).filter(
            models.GRN.purchase_order_id == po.id).order_by(models.GRNLine.id.desc()).first()
        if last is None:
            print(f"[purge] {po_number}: no receiving to copy item/warehouse from — aborted")
            return
        po_line = db.query(models.PurchaseOrderLine).filter(models.PurchaseOrderLine.id == last.po_line_id).first()
        gst = po.gst_rate or 0.0
        lots = []
        for part in rest.split(","):
            q, _, r = part.strip().partition("@")
            lots.append((float(q), float(r)))
        print(f"[purge] {'DRY RUN — ' if dry else ''}add {len(lots)} lot(s) to {po_number} (id {po.id}, status {po.status.value}, gst {gst:g}%), "
              f"item {last.item_id}, warehouse {last.warehouse_id}; PO line now ordered {po_line.quantity:g} / received {po_line.received_quantity:g} @ {po_line.rate:g}")
        backup = {"po_line": (po_line.id, po_line.quantity, po_line.rate, po_line.received_quantity),
                  "po_status": po.status.value, "created_grn_numbers": []}
        tot_q, tot_v = po_line.received_quantity, po_line.received_quantity * po_line.rate
        now = datetime.datetime.utcnow()
        for i, (q, r) in enumerate(lots):
            if q <= 0 or r <= 0:
                print("[purge]   quantity and rate must be above zero — aborted")
                return
            grn_no = f"GRN-{(now + datetime.timedelta(seconds=i)).strftime('%y%m%d-%H%M%S')}"
            batch = _auto_batch_no(db, last.item_id)
            amount = round(q * r * (1 + gst / 100.0), 2)
            print(f"[purge]   {grn_no} batch {batch}: {q:g} @ {r:g} = {q * r:,.2f}; vendor bill {amount:,.2f}")
            backup["created_grn_numbers"].append(grn_no)
            tot_q += q
            tot_v += q * r
            if dry:
                continue
            g = models.GRN(grn_number=grn_no, purchase_order_id=po.id, freight_amount=0.0,
                           notes="Added lot (correction)", received_date=now)
            db.add(g)
            db.flush()
            db.add(models.GRNLine(grn_id=g.id, po_line_id=po_line.id, item_id=last.item_id,
                                  warehouse_id=last.warehouse_id, batch_no=batch, quantity=q, rate=r))
            db.add(models.StockLedgerEntry(item_id=last.item_id, warehouse_id=last.warehouse_id, batch_no=batch,
                                           quantity=q, rate=r, is_toll_stock=0, ref_type="GRN", ref_id=g.id))
            db.add(models.VendorLedgerEntry(vendor_id=po.vendor_id, direction=models.LedgerDirection.debit,
                                            amount=amount, ref_type="GRN_BILL", ref_id=g.id,
                                            notes=f"Bill for GRN {grn_no}" + (f" (incl. {gst:g}% GST)" if gst else "")))
            db.flush()
        new_avg = tot_v / tot_q
        print(f"[purge]   PO line: ordered {po_line.quantity:g} -> {tot_q:g}, received {po_line.received_quantity:g} -> {tot_q:g}, average rate {po_line.rate:g} -> {new_avg:.6f}")
        if dry:
            print("[purge]   dry run only — nothing changed")
            db.rollback()
            return
        po_line.quantity = tot_q
        po_line.received_quantity = tot_q
        po_line.rate = new_avg
        po.status = models.POStatus.completed
        if po.payment_status == models.PaymentStatus.paid:
            po.payment_status = models.PaymentStatus.unpaid
        bdir = pathlib.Path(os.getenv("UPLOADS_DIR", "uploads")) / "purge_backups"
        bdir.mkdir(parents=True, exist_ok=True)
        bf = bdir / f"addlot_{po_number}_{datetime.datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        bf.write_text(json.dumps(backup, default=str, indent=1))
        db.commit()
        print(f"[purge]   backup written: {bf}")
        print(f"[purge]   DONE — lot(s) added to {po_number}.")
    except Exception as e:
        db.rollback()
        print(f"[purge] add lot FAILED: {e}")
    finally:
        db.close()


def run():
    correct_po_rate()
    add_po_lot()
    purge_sales_invoices()
    relink_batches()
    purge_orphan_payments()
    po_number = (os.getenv("PURGE_PO_NUMBER") or "").strip()
    if not po_number:
        return
    dry = os.getenv("PURGE_PO_DRY_RUN", "1") != "0"
    db = SessionLocal()
    try:
        po = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.po_number == po_number).first()
        if not po:
            print(f"[purge] {po_number}: not found — nothing to do (already removed?)")
            return
        grns = db.query(models.GRN).filter(models.GRN.purchase_order_id == po.id).all()
        grn_ids = [g.id for g in grns]
        grn_lines = db.query(models.GRNLine).filter(models.GRNLine.grn_id.in_(grn_ids)).all() if grn_ids else []
        stock = db.query(models.StockLedgerEntry).filter(
            models.StockLedgerEntry.ref_type == "GRN", models.StockLedgerEntry.ref_id.in_(grn_ids)).all() if grn_ids else []
        ledger = []
        if grn_ids:
            ledger += db.query(models.VendorLedgerEntry).filter(
                models.VendorLedgerEntry.ref_type.in_(("GRN_BILL", "GRN_FREIGHT")),
                models.VendorLedgerEntry.ref_id.in_(grn_ids)).all()
        ledger += db.query(models.VendorLedgerEntry).filter(
            models.VendorLedgerEntry.ref_type.in_(("PO_ADVANCE", "PO_PAYMENT")),
            models.VendorLedgerEntry.ref_id == po.id).all()

        # Has any of this stock been used since? Any other ledger entry on the same batch means yes.
        stock_ids = {s.id for s in stock}
        blockers = []
        for key in {(s.item_id, s.warehouse_id, s.batch_no) for s in stock}:
            others = db.query(models.StockLedgerEntry).filter(
                models.StockLedgerEntry.item_id == key[0], models.StockLedgerEntry.warehouse_id == key[1],
                models.StockLedgerEntry.batch_no == key[2]).all()
            for o in others:
                if o.id not in stock_ids:
                    blockers.append(f"item {key[0]} / warehouse {key[1]} / batch {key[2]}: {o.ref_type} #{o.ref_id} qty {o.quantity}")

        paid_in = sum(e.amount for e in ledger if e.ref_type in ("PO_ADVANCE", "PO_PAYMENT"))
        print(f"[purge] {'DRY RUN — ' if dry else ''}{po_number} (id {po.id}, status {po.status.value}, payment {po.payment_status.value})")
        print(f"[purge]   PO lines: {len(po.lines)} | GRNs: {[g.grn_number for g in grns]} | GRN lines: {len(grn_lines)}")
        print(f"[purge]   stock ledger entries to remove: {[(s.item_id, s.warehouse_id, s.batch_no, s.quantity) for s in stock]}")
        print(f"[purge]   vendor ledger entries to remove: {[(e.ref_type, e.amount) for e in ledger]}")
        print(f"[purge]   payments recorded against this PO that will disappear from the vendor ledger: Rs. {paid_in:,.2f}")
        if blockers:
            print("[purge]   ABORTED — this stock has been used/moved since receipt, nothing was changed:")
            for b in blockers:
                print(f"[purge]     {b}")
            return
        if dry:
            print("[purge]   dry run only — nothing deleted. Set PURGE_PO_DRY_RUN=0 to delete.")
            return

        backup = {
            "purchase_order": _row(po), "po_lines": [_row(l) for l in po.lines], "grns": [_row(g) for g in grns],
            "grn_lines": [_row(l) for l in grn_lines], "stock_ledger": [_row(s) for s in stock],
            "vendor_ledger": [_row(e) for e in ledger],
        }
        folder = pathlib.Path(file_storage.UPLOADS_DIR) / "purge_backups"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{po_number}_{datetime.datetime.utcnow():%Y%m%d_%H%M%S}.json"
        path.write_text(json.dumps(backup, indent=2, default=str))
        print(f"[purge]   backup written: {path}")

        for e in ledger:
            db.delete(e)
        for s in stock:
            db.delete(s)
        for l in grn_lines:
            db.delete(l)
        for g in grns:
            db.delete(g)
        db.flush()
        db.delete(po)   # its lines go with it
        db.commit()
        print(f"[purge]   DONE — {po_number}, its GRNs, stock and vendor-ledger entries are removed.")
    except Exception as e:
        db.rollback()
        print(f"[purge]   FAILED, nothing changed: {e}")
    finally:
        db.close()
