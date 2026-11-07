import type { IdSource } from "@mandi/core";
import { withApplyGuard, type Catalogue, type DataStore, type TxHandles, type UntypedDb } from "@mandi/data";
import { NumericError } from "@mandi/numeric";
import { BUNDLE_SCHEMA_VERSION, computeBundleHash, GENESIS_HASH, toWireText, type Bundle } from "./bundle";
import { derivedId } from "./ids";
import { seriesKeyText } from "./numbering";
import type { ApplyContext, ApplyRegistry, ExceptionReason, NumberedRow, Rejection, SeriesKey } from "./registry";
import { fromWireRow, RowError, type DecodedRow } from "./rows";

/**
 * Document 06, section 4.3: THE function that writes class 1 facts (D-1). It runs the same five steps on
 * the authoring node (inside the posting transaction, mode "author"), on every other node and on the
 * cloud (mode "receive"), in one database transaction:
 *
 *   1 envelope   epoch, node_seq, prev_hash, hash, schema version
 *   2 content    rows well formed, numbers unused, the registered validators
 *   3 insert     the bundle's own row, then its rows, in order
 *   4 projections number counters, the node's chain head, the registered projectors, with the apply guard open
 *   5 record     (the bundle's row is written at the start of step 3: the rows it owns point at it)
 *
 * A rejection writes nothing. The author is told (ApplyRejected); a receiver keeps the bundle in the
 * exceptions queue (receiveBundle).
 */
export type ApplyMode = "author" | "receive";

export interface ApplyOptions {
  readonly mode: ApplyMode;
  readonly registry: ApplyRegistry;
  readonly catalogue: Catalogue;
  readonly nowIso: string;
  /** The bundle schema versions this program accepts (document 06, section 13: the cloud accepts two versions back). */
  readonly schema?: { readonly min: number; readonly max: number };
  /** Set by the cloud when it accepts a bundle. */
  readonly centralSeq?: bigint;
}

export class ApplyRejected extends Error {
  readonly code: ExceptionReason;
  readonly detail: string;
  constructor(rejection: Rejection) {
    super(`${rejection.code}: ${rejection.detail}`);
    this.name = "ApplyRejected";
    this.code = rejection.code;
    this.detail = rejection.detail;
  }
}

const reject = (code: ExceptionReason, detail: string): ApplyRejected => new ApplyRejected({ code, detail });

/** A failure the database raised about the data (constraint, trigger), as opposed to a failure of the connection. */
function isDataError(error: unknown): boolean {
  const e = error as { readonly code?: unknown; readonly message?: unknown };
  if (typeof e.code === "string" && (e.code.startsWith("23") || e.code.startsWith("22"))) return true; // PostgreSQL: integrity constraint violation, data exception (a number out of range)
  if (e instanceof NumericError && e.code === "overflow") return true;
  // SQLite: constraint failures, our triggers, and a bigint that does not fit 64 bits
  return typeof e.message === "string" && /constraint|append-only|written only by applyBundle|too large to bind|out of range/i.test(e.message);
}

type Untyped = UntypedDb;

export type ApplyOutcome = { readonly status: "applied" } | { readonly status: "duplicate" };

export async function applyBundleInTransaction(tx: TxHandles, bundle: Bundle, options: ApplyOptions): Promise<ApplyOutcome> {
  const { scoped, installation } = tx;
  if (bundle.company_id !== tx.companyId) throw reject("other", "the bundle belongs to another company than this transaction");

  // Idempotent: a bundle already applied is acknowledged again and ignored (rule 2).
  const existing = await scoped.selectFrom("bundles").select(["id", "hash", "state"]).where("id", "=", bundle.bundle_id).executeTakeFirst();
  if (existing !== undefined && existing.state !== "quarantined") {
    if (existing.hash === bundle.hash) return { status: "duplicate" };
    throw reject("other", `bundle id ${bundle.bundle_id} is already used by a bundle with different content`);
  }

  // ---- step 1: envelope ----------------------------------------------------------------------------
  const schema = options.schema ?? { min: BUNDLE_SCHEMA_VERSION, max: BUNDLE_SCHEMA_VERSION };
  if (bundle.schema_version > schema.max || bundle.schema_version < schema.min) {
    throw reject("schema_unsupported", `the bundle has schema version ${String(bundle.schema_version)}; this program accepts ${String(schema.min)} to ${String(schema.max)}`);
  }
  const { hash: _hash, signature: _signature, ...draft } = bundle;
  if (computeBundleHash(draft) !== bundle.hash) throw reject("other", "the bundle's hash does not match its content");

  if (bundle.location_id !== null) {
    const location = await scoped.selectFrom("locations").select(["current_epoch", "current_node_id"]).where("id", "=", bundle.location_id).executeTakeFirst();
    if (location === undefined) throw reject("other", `unknown location ${bundle.location_id}`);
    const current = BigInt(location.current_epoch);
    const epoch = BigInt(bundle.epoch);
    if (epoch < current) throw reject("stale_epoch", `the bundle is from epoch ${epoch.toString()}; the location is at epoch ${current.toString()}`);
    if (epoch > current) throw reject("other", `the bundle is from epoch ${epoch.toString()}, ahead of the location's epoch ${current.toString()} known here (the authority change has not arrived)`);
    const authority = await scoped.selectFrom("location_authorities").select("node_id").where("location_id", "=", bundle.location_id).where("epoch", "=", epoch).executeTakeFirst();
    const authorityNode = authority?.node_id ?? location.current_node_id;
    if (authorityNode !== null && authorityNode !== bundle.node_id) throw reject("other", "the bundle's node is not the authority of its location at that epoch");
  }

  const head = await installation.selectFrom("node_chain_heads").select(["last_seq", "last_hash"]).where("node_id", "=", bundle.node_id).executeTakeFirst();
  const expectedSeq = (head === undefined ? 0n : BigInt(head.last_seq)) + 1n;
  if (BigInt(bundle.node_seq) !== expectedSeq) throw reject("sequence_gap", `expected node_seq ${expectedSeq.toString()} from this node, got ${String(bundle.node_seq)}`);
  if (bundle.prev_hash !== (head === undefined ? GENESIS_HASH : head.last_hash)) throw reject("other", "prev_hash does not match the hash of the previous bundle of this node");

  // ---- step 2: content -----------------------------------------------------------------------------
  let rows: DecodedRow[];
  try {
    rows = bundle.rows.map((r) => fromWireRow(options.catalogue, r, bundle.company_id, bundle.bundle_id));
  } catch (error) {
    if (error instanceof RowError) throw reject("other", error.message);
    throw error;
  }
  const context: ApplyContext = { tx, bundle, rows, catalogue: options.catalogue };

  const numbered: { readonly row: DecodedRow; readonly number: NumberedRow; readonly column: string }[] = [];
  for (const row of rows) {
    const rule = options.registry.tables.get(row.table);
    if (rule?.numbering !== undefined) numbered.push({ row, number: rule.numbering(row.app), column: rule.docNoColumn ?? "doc_no" });
  }
  const seen = new Set<string>();
  for (const n of numbered) {
    if (seen.has(`${n.row.table}|${n.number.docNo}`)) throw reject("duplicate_number", `${n.number.docNo} appears twice in the bundle`);
    seen.add(`${n.row.table}|${n.number.docNo}`);
    const used = await (scoped as Untyped).selectFrom(n.row.table).select("id").where(n.column, "=", n.number.docNo).executeTakeFirst();
    if (used !== undefined) throw reject("duplicate_number", `${n.number.docNo} is already used`);
  }
  for (const validator of options.registry.validators) {
    const rejection = await validator(context);
    if (rejection !== undefined) throw new ApplyRejected(rejection);
  }

  // ---- step 3: insert (the bundle's row first: the rows it owns point at it) -------------------------
  const bundleRow = {
    location_id: bundle.location_id,
    node_id: bundle.node_id,
    epoch: BigInt(bundle.epoch),
    node_seq: BigInt(bundle.node_seq),
    prev_hash: bundle.prev_hash,
    hash: bundle.hash,
    schema_version: BigInt(bundle.schema_version),
    kind: bundle.kind,
    payload_json: toWireText(bundle),
    created_at: bundle.created_at,
    state: options.mode === "author" ? ("pending" as const) : ("accepted" as const),
    central_seq: options.centralSeq ?? null,
    signature: bundle.signature ?? null,
  };
  try {
    if (existing === undefined) await scoped.insertInto("bundles").values({ id: bundle.bundle_id, ...bundleRow }).execute();
    else {
      await scoped.updateTable("bundles").set(bundleRow).where("id", "=", bundle.bundle_id).execute();
      // a quarantined bundle that now applies: its open exceptions are resolved (a person need not close what no longer applies)
      await scoped.updateTable("exceptions").set({ state: "resolved", resolved_at: options.nowIso, resolution_note: "applied on retry" }).where("bundle_id", "=", bundle.bundle_id).where("state", "=", "open").execute();
    }
    for (const row of rows) await (scoped as Untyped).insertInto(row.table).values(row.insert).execute();
  } catch (error) {
    if (isDataError(error)) throw reject("other", `the database refused the bundle: ${error instanceof Error ? error.message : "constraint failed"}`);
    throw error;
  }

  // ---- step 4: projections (guard open). A projection that cannot be derived from the facts (a quantity beyond
  // 64 bits, say) is a defect of the bundle, so it rejects the bundle like any other bad content: a bundle must never
  // be a poison message that fails the same way on every retry.
  try {
    await projectAll();
  } catch (error) {
    if (isDataError(error)) throw reject("other", `a projection could not be derived: ${error instanceof Error ? error.message : "data error"}`);
    throw error;
  }
  return { status: "applied" };

  async function projectAll(): Promise<void> {
    await withApplyGuard(scoped, async () => {
    const highest = new Map<string, { readonly key: SeriesKey; readonly seq: bigint; readonly docNo: string }>();
    for (const n of numbered) {
      const text = seriesKeyText(n.number.series);
      const current = highest.get(text);
      if (current === undefined || n.number.seq > current.seq) highest.set(text, { key: n.number.series, seq: n.number.seq, docNo: n.number.docNo });
    }
    for (const [text, top] of highest) {
      const row = await scoped
        .selectFrom("number_series")
        .select(["id", "next_number"])
        .where("location_id", "=", top.key.locationId)
        .where("device_id", "=", top.key.deviceId)
        .where("doc_type", "=", top.key.docType)
        .where("fiscal_year_code", "=", top.key.fiscalYearCode)
        .executeTakeFirst();
      if (row === undefined) {
        await scoped
          .insertInto("number_series")
          .values({ id: derivedId("number_series", `${tx.companyId}|${text}`), location_id: top.key.locationId, device_id: top.key.deviceId, doc_type: top.key.docType, fiscal_year_code: top.key.fiscalYearCode, prefix: top.docNo.slice(0, top.docNo.lastIndexOf("-")), next_number: top.seq + 1n, last_issued_at: bundle.created_at })
          .execute();
      } else if (top.seq + 1n > BigInt(row.next_number)) {
        await scoped.updateTable("number_series").set({ next_number: top.seq + 1n, last_issued_at: bundle.created_at }).where("id", "=", row.id).execute();
      }
    }
    for (const projector of options.registry.projectors) await projector(context);
    if (head === undefined) {
      await installation.insertInto("node_chain_heads").values({ id: derivedId("node_chain_head", bundle.node_id), node_id: bundle.node_id, last_seq: BigInt(bundle.node_seq), last_hash: bundle.hash, updated_at: bundle.created_at }).execute();
    } else {
      await installation.updateTable("node_chain_heads").set({ last_seq: BigInt(bundle.node_seq), last_hash: bundle.hash, updated_at: bundle.created_at }).where("node_id", "=", bundle.node_id).execute();
    }
    });
  }
}

export type ReceiveOutcome = { readonly status: "applied" } | { readonly status: "duplicate" } | { readonly status: "quarantined"; readonly code: ExceptionReason; readonly detail: string };

export interface ReceiveOptions {
  readonly registry: ApplyRegistry;
  readonly ids: IdSource;
  readonly nowIso: string;
  readonly schema?: { readonly min: number; readonly max: number };
  readonly centralSeq?: bigint;
}

/**
 * A bundle arriving from elsewhere (another node, the cloud): applied in one transaction; if it is
 * rejected, nothing of it is applied and the bundle is kept, quarantined, with an open entry in the
 * exceptions queue (rule 3: a rejected bundle is not lost). Failures of the connection are not
 * rejections: they propagate and the bundle is retried.
 */
export async function receiveBundle(store: DataStore, bundle: Bundle, options: ReceiveOptions): Promise<ReceiveOutcome> {
  const context = { companyId: bundle.company_id };
  try {
    return await store.transaction(context, (tx) =>
      applyBundleInTransaction(tx, bundle, {
        mode: "receive",
        registry: options.registry,
        catalogue: store.catalogue,
        nowIso: options.nowIso,
        ...(options.schema === undefined ? {} : { schema: options.schema }),
        ...(options.centralSeq === undefined ? {} : { centralSeq: options.centralSeq }),
      }),
    );
  } catch (error) {
    if (!(error instanceof ApplyRejected)) throw error;
    await quarantine(store, bundle, error, options);
    return { status: "quarantined", code: error.code, detail: error.detail };
  }
}

async function quarantine(store: DataStore, bundle: Bundle, rejection: ApplyRejected, options: ReceiveOptions): Promise<void> {
  const context = { companyId: bundle.company_id };
  try {
    await store.transaction(context, async (tx) => {
      const existing = await tx.scoped.selectFrom("bundles").select(["id", "state"]).where("id", "=", bundle.bundle_id).executeTakeFirst();
      if (existing !== undefined && existing.state !== "quarantined") throw new Error("an applied bundle has this id");
      const row = {
        location_id: bundle.location_id,
        node_id: bundle.node_id,
        epoch: BigInt(bundle.epoch),
        node_seq: BigInt(bundle.node_seq),
        prev_hash: bundle.prev_hash,
        hash: bundle.hash,
        schema_version: BigInt(bundle.schema_version),
        kind: bundle.kind,
        payload_json: toWireText(bundle),
        created_at: bundle.created_at,
        state: "quarantined" as const,
        central_seq: null,
        signature: bundle.signature ?? null,
      };
      if (existing === undefined) await tx.scoped.insertInto("bundles").values({ id: bundle.bundle_id, ...row }).execute();
      else await tx.scoped.updateTable("bundles").set(row).where("id", "=", bundle.bundle_id).execute();
      const open = await tx.scoped.selectFrom("exceptions").select("id").where("bundle_id", "=", bundle.bundle_id).where("state", "=", "open").executeTakeFirst();
      if (open === undefined) {
        await tx.scoped.insertInto("exceptions").values({ id: options.ids.newId(), bundle_id: bundle.bundle_id, reason_code: rejection.code, detail: rejection.detail, created_at: options.nowIso }).execute();
      } else {
        await tx.scoped.updateTable("exceptions").set({ reason_code: rejection.code, detail: rejection.detail }).where("id", "=", open.id).execute();
      }
    });
  } catch (error) {
    if (!isDataError(error) && !(error instanceof Error && error.message === "an applied bundle has this id")) throw error;
    // The bundle cannot be stored (it names a node or location this database does not know, or its slot is taken):
    // the rejection is still never silent. It is recorded without the bundle.
    await store.transaction(context, async (tx) => {
      await tx.scoped.insertInto("exceptions").values({ id: options.ids.newId(), bundle_id: null, reason_code: rejection.code, detail: `bundle ${bundle.bundle_id} (node_seq ${String(bundle.node_seq)}) could not be kept: ${rejection.detail}`, created_at: options.nowIso }).execute();
    });
  }
}
