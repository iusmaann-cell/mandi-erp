import { createTestRuntime, type TestRuntime } from "@mandi/core";
import { decodeRow, type DataStore, type UntypedDb } from "@mandi/data";
import { sha256Hex, utf8Bytes } from "@mandi/numeric";
import { applyBundleInTransaction, ApplyRejected } from "../apply";
import { authorBundle } from "../author";
import { canonicalize } from "../canonical";
import { derivedId } from "../ids";
import { fiscalYearCodeOf, NumberIssuer } from "../numbering";
import { createRegistry, type ApplyRegistry } from "../registry";
import { toWireRow } from "../rows";
import type { Bundle } from "../bundle";

/**
 * Test support for the bundle machinery (document 09, TL-4). The trivial document type (test_documents,
 * test_document_lines, test_stock: see @mandi/data/testing) stands in for real documents until they exist.
 */

export const TEST_REGISTRY: ApplyRegistry = createRegistry({
  tables: {
    test_documents: {
      numbering: (app) => ({
        series: { locationId: String(app["location_id"]), deviceId: String(app["device_id"]), docType: String(app["doc_type"]), fiscalYearCode: String(app["fiscal_year_code"]) },
        seq: BigInt(app["number_seq"] as bigint),
        docNo: String(app["doc_no"]),
      }),
    },
  },
  validators: [
    // the stand-in for "every journal entry balances": a document's lines add up to its total
    (context) => {
      for (const doc of context.rows.filter((r) => r.table === "test_documents")) {
        const lines = context.rows.filter((r) => r.table === "test_document_lines" && r.app["document_id"] === doc.app["id"]);
        const sum = lines.reduce((a, l) => a + (l.app["qty_milli"] as bigint), 0n);
        if (sum !== (doc.app["total_milli"] as bigint)) return Promise.resolve({ code: "unbalanced_journal" as const, detail: `document ${String(doc.app["doc_no"])}: the lines add up to ${sum.toString()} but the total is ${String(doc.app["total_milli"])}` });
      }
      return Promise.resolve(undefined);
    },
  ],
  projectors: [
    // the stand-in for stock balances: quantity per location follows the lines
    async (context) => {
      const perLocation = new Map<string, bigint>();
      for (const line of context.rows.filter((r) => r.table === "test_document_lines")) {
        const doc = context.rows.find((r) => r.table === "test_documents" && r.app["id"] === line.app["document_id"]);
        const location = String(doc?.app["location_id"]);
        perLocation.set(location, (perLocation.get(location) ?? 0n) + (line.app["qty_milli"] as bigint));
      }
      const db = context.tx.scoped as UntypedDb;
      for (const [location, qty] of perLocation) {
        const row = await db.selectFrom("test_stock").select(["id", "qty_milli"]).where("location_id", "=", location).executeTakeFirst();
        if (row === undefined) await db.insertInto("test_stock").values({ id: derivedId("test_stock", `${context.tx.companyId}|${location}`), location_id: location, qty_milli: qty }).execute();
        else await db.updateTable("test_stock").set({ qty_milli: BigInt(row.qty_milli as bigint) + qty }).where("id", "=", row.id).execute();
      }
    },
  ],
});

export interface Place {
  readonly nodeId: string;
  readonly deviceId: string;
  readonly locationId: string;
}
export interface SyncWorld {
  readonly companyId: string;
  readonly ownerGroupId: string;
  /** Two sites: node 1 is the authority of location 1, node 2 of location 2. Device 03 is a second device of node 1. */
  readonly one: Place;
  readonly two: Place;
  readonly oneSecondDevice: string;
}

/** One company, two godowns each served by its own node and device (code 01), and a second device (code 02) on the first node. */
export async function seedSyncWorld(store: DataStore, rt: TestRuntime): Promise<SyncWorld> {
  const now = new Date(rt.clock.nowMs()).toISOString();
  const installation = store.installation();
  const ownerGroupId = rt.ids.newId();
  await installation.insertInto("owner_groups").values({ id: ownerGroupId, name_en: "Sync Traders", name_ur: "سنک ٹریڈرز", updated_at: now }).execute();
  const nodes = [rt.ids.newId(), rt.ids.newId()] as const;
  const devices = [rt.ids.newId(), rt.ids.newId(), rt.ids.newId()] as const;
  for (const [i, id] of nodes.entries()) await installation.insertInto("nodes").values({ id, kind: "site_node", name: `Node ${String(i + 1)}`, updated_at: now }).execute();
  await installation.insertInto("devices").values({ id: devices[0], node_id: nodes[0], kind: "windows_pc", code: "01", name: "PC 1", updated_at: now }).execute();
  await installation.insertInto("devices").values({ id: devices[1], node_id: nodes[1], kind: "windows_pc", code: "01", name: "PC 2", updated_at: now }).execute();
  await installation.insertInto("devices").values({ id: devices[2], node_id: nodes[0], kind: "android", code: "02", name: "Tablet 1", updated_at: now }).execute();
  const companyId = rt.ids.newId();
  const db = store.scoped({ companyId });
  await db.insertInto("companies").values({ id: companyId, owner_group_id: ownerGroupId, code: "SY", name_en: "Sync Co", name_ur: "سنک", updated_at: now }).execute();
  const locations = [rt.ids.newId(), rt.ids.newId()] as const;
  for (const [i, id] of locations.entries()) {
    await db.insertInto("locations").values({ id, code: i === 0 ? "GA" : "GB", name_en: `Godown ${String(i + 1)}`, name_ur: "گودام", kind: "godown", authority_kind: "site_node", current_node_id: nodes[i] ?? null, updated_at: now }).execute();
    await db.insertInto("location_authorities").values({ id: rt.ids.newId(), location_id: id, node_id: nodes[i] ?? "", epoch: 1n, started_at: now, updated_at: now }).execute();
  }
  await db.insertInto("fiscal_years").values({ id: rt.ids.newId(), code: "2627", start_date: "2026-07-01", end_date: "2027-06-30", updated_at: now }).execute();
  return {
    companyId,
    ownerGroupId,
    one: { nodeId: nodes[0], deviceId: devices[0], locationId: locations[0] },
    two: { nodeId: nodes[1], deviceId: devices[1], locationId: locations[1] },
    oneSecondDevice: devices[2],
  };
}

export interface PostInput {
  readonly lines: readonly bigint[];
  readonly docDate?: string;
  /** Use another device of the node than the place's own. */
  readonly deviceId?: string;
  /** Claim a total other than the sum of the lines (to make the document wrong). */
  readonly totalMilli?: bigint;
}

export interface Posted {
  readonly bundle: Bundle;
  readonly docNo: string;
  readonly seq: bigint;
}

/**
 * What the posting transaction of the engine does, in miniature (document 06, 4.3): issue the number, build
 * the rows, author the bundle, apply it, all in one transaction. A rejection rolls the whole thing back.
 */
export async function postTestDocument(store: DataStore, rt: TestRuntime, world: SyncWorld, place: Place, input: PostInput): Promise<Posted> {
  const docDate = input.docDate ?? "2026-08-15";
  const deviceId = input.deviceId ?? place.deviceId;
  const catalogue = store.catalogue;
  return store.transaction({ companyId: world.companyId }, async (tx) => {
    const issued = await new NumberIssuer(tx).issue({ locationId: place.locationId, deviceId, docType: "TD", fiscalYearCode: fiscalYearCodeOf(docDate) });
    const docId = rt.ids.newId();
    const now = new Date(rt.clock.nowMs()).toISOString();
    const total = input.totalMilli ?? input.lines.reduce((a, b) => a + b, 0n);
    const rows = [
      toWireRow(catalogue, "test_documents", world.companyId, { id: docId, doc_type: "TD", doc_no: issued.docNo, location_id: place.locationId, device_id: deviceId, fiscal_year_code: fiscalYearCodeOf(docDate), number_seq: issued.seq, doc_date: docDate, total_milli: total, created_at: now }),
      ...input.lines.map((qty, i) => toWireRow(catalogue, "test_document_lines", world.companyId, { id: rt.ids.newId(), document_id: docId, line_no: BigInt(i + 1), qty_milli: qty, created_at: now })),
    ];
    const bundle = await authorBundle(tx, rt, { locationId: place.locationId, nodeId: place.nodeId, kind: "document", rows });
    await applyBundleInTransaction(tx, bundle, { mode: "author", registry: TEST_REGISTRY, catalogue, nowIso: now });
    return { bundle, docNo: issued.docNo, seq: issued.seq };
  });
}

/** A hash of the contents of the named tables of one company, rows in id order, in canonical application form: equal on SQLite and PostgreSQL when the data is equal (TL-4). */
export async function tableHash(store: DataStore, companyId: string, table: string): Promise<string> {
  const db = store.scoped({ companyId }) as unknown as { selectFrom(t: string): { selectAll(): { orderBy(c: string): { execute(): Promise<Record<string, unknown>[]> } } } };
  const rows = await db.selectFrom(table).selectAll().orderBy("id").execute();
  const decoded = rows.map((r) => decodeRow(store.catalogue, table, r));
  const text = JSON.stringify(decoded, (_k, v) => (typeof v === "bigint" ? `${v.toString()}n` : (v as unknown)));
  return sha256Hex(utf8Bytes(text));
}

export async function tableHashes(store: DataStore, companyId: string, tables: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = await tableHash(store, companyId, t);
  return out;
}

export { ApplyRejected, canonicalize, createTestRuntime };
export { buildGoldenBundles, GOLDEN_WORLD_SEED, type GoldenSet } from "./golden";
