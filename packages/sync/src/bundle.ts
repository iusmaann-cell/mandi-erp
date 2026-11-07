import { sha256Hex, utf8Bytes } from "@mandi/numeric";
import { canonicalize, CanonicalError, type Json } from "./canonical";

/**
 * Document 06, section 4.2 and document 05, section 7.1: the bundle, the unit of sync. One save action
 * is one bundle; its rows are inserts only, in dependency order, and the order is part of the hash.
 */
export const BUNDLE_SCHEMA_VERSION = 1;
export const GENESIS_HASH = "0".repeat(64);

/** A column value on the wire: whole numbers as decimal strings, JSON columns as canonical JSON text. */
export type WireValue = string | boolean | null;
export interface WireRow {
  readonly t: string;
  readonly v: Readonly<Record<string, WireValue>>;
}
export type BundleKind = "document" | "system" | "import";

export interface Bundle {
  readonly bundle_id: string;
  readonly company_id: string;
  readonly location_id: string | null;
  readonly node_id: string;
  readonly epoch: number;
  readonly node_seq: number;
  readonly prev_hash: string;
  readonly hash: string;
  readonly schema_version: number;
  readonly kind: BundleKind;
  readonly created_at: string;
  readonly rows: readonly WireRow[];
  /** The node's signature over `hash` (document 08, 5.4). Not part of the hash; the security package fills it in. */
  readonly signature?: string;
}

export type Draft = Omit<Bundle, "hash" | "signature">;

/** The SHA-256 of the canonical form of everything but `hash` and `signature`. */
export function computeBundleHash(draft: Draft): string {
  return sha256Hex(utf8Bytes(canonicalize(draft)));
}

export function sealBundle(draft: Draft): Bundle {
  return { ...draft, hash: computeBundleHash(draft) };
}

/** The text a bundle travels and is stored as. */
export function toWireText(bundle: Bundle): string {
  return canonicalize(bundle);
}

export class BundleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleFormatError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ENVELOPE_KEYS = new Set(["bundle_id", "company_id", "location_id", "node_id", "epoch", "node_seq", "prev_hash", "hash", "schema_version", "kind", "created_at", "rows", "signature"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function need(condition: boolean, message: string): asserts condition {
  if (!condition) throw new BundleFormatError(message);
}
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

/** Strict reading of a bundle object. Anything that is not exactly a bundle is refused with a message; nothing is guessed. */
export function parseBundle(input: unknown): Bundle {
  need(isRecord(input), "a bundle must be an object");
  for (const key of Object.keys(input)) need(ENVELOPE_KEYS.has(key), `unknown bundle field: ${key}`);
  const b = input;
  need(typeof b["bundle_id"] === "string" && UUID.test(b["bundle_id"]), "bundle_id must be a lower-case uuid");
  need(typeof b["company_id"] === "string" && UUID.test(b["company_id"]), "company_id must be a lower-case uuid");
  need(b["location_id"] === null || (typeof b["location_id"] === "string" && UUID.test(b["location_id"])), "location_id must be a uuid or null");
  need(typeof b["node_id"] === "string" && UUID.test(b["node_id"]), "node_id must be a lower-case uuid");
  need(positiveInteger(b["epoch"]), "epoch must be a whole number from 1");
  need(positiveInteger(b["node_seq"]), "node_seq must be a whole number from 1");
  need(typeof b["prev_hash"] === "string" && HASH.test(b["prev_hash"]), "prev_hash must be 64 hex characters");
  need(typeof b["hash"] === "string" && HASH.test(b["hash"]), "hash must be 64 hex characters");
  need(positiveInteger(b["schema_version"]), "schema_version must be a whole number from 1");
  need(b["kind"] === "document" || b["kind"] === "system" || b["kind"] === "import", "kind must be document, system or import");
  need(typeof b["created_at"] === "string" && TIMESTAMP.test(b["created_at"]), "created_at must be a UTC millisecond timestamp");
  need(Array.isArray(b["rows"]), "rows must be a list");
  need(b["signature"] === undefined || typeof b["signature"] === "string", "signature must be text");
  const rows: WireRow[] = (b["rows"] as unknown[]).map((r, i) => {
    need(isRecord(r), `row ${String(i)} must be an object`);
    for (const key of Object.keys(r)) need(key === "t" || key === "v", `row ${String(i)} has an unknown field ${key}`);
    need(typeof r["t"] === "string" && /^[a-z][a-z0-9_]*$/.test(r["t"]), `row ${String(i)} has no table name`);
    need(isRecord(r["v"]), `row ${String(i)} has no values`);
    const values: Record<string, WireValue> = {};
    for (const [name, value] of Object.entries(r["v"])) {
      need(value === null || typeof value === "string" || typeof value === "boolean", `row ${String(i)} column ${name}: a value must be text, true, false or null (whole numbers travel as strings)`);
      values[name] = value;
    }
    return { t: r["t"], v: values };
  });
  return {
    bundle_id: b["bundle_id"],
    company_id: b["company_id"],
    location_id: b["location_id"],
    node_id: b["node_id"],
    epoch: b["epoch"],
    node_seq: b["node_seq"],
    prev_hash: b["prev_hash"],
    hash: b["hash"],
    schema_version: b["schema_version"],
    kind: b["kind"],
    created_at: b["created_at"],
    rows,
    ...(typeof b["signature"] === "string" ? { signature: b["signature"] } : {}),
  };
}

export function parseWireText(text: string): Bundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BundleFormatError("the bundle is not JSON");
  }
  return parseBundle(parsed);
}

export type BundleProblem = "not_a_bundle" | "not_canonical" | "hash_mismatch";

/**
 * Checks a received or stored bundle text: it must be a bundle, be written in canonical form (so a
 * changed space or a reordered key is a change too), and carry the hash of its own content. Any single
 * character changed anywhere is reported (PB-15).
 */
export function verifyWireText(text: string): { readonly ok: boolean; readonly problems: readonly BundleProblem[]; readonly bundle?: Bundle } {
  let bundle: Bundle;
  try {
    bundle = parseWireText(text);
  } catch (error) {
    if (error instanceof BundleFormatError || error instanceof CanonicalError) return { ok: false, problems: ["not_a_bundle"] };
    throw error;
  }
  const problems: BundleProblem[] = [];
  if (toWireText(bundle) !== text) problems.push("not_canonical");
  const { hash: _hash, signature: _signature, ...draft } = bundle;
  if (computeBundleHash(draft) !== bundle.hash) problems.push("hash_mismatch");
  return problems.length === 0 ? { ok: true, problems, bundle } : { ok: false, problems, bundle };
}

export type ChainProblem =
  | { readonly kind: "hash_mismatch"; readonly bundleId: string; readonly nodeSeq: number }
  | { readonly kind: "gap"; readonly expected: number; readonly found: number }
  | { readonly kind: "prev_hash_mismatch"; readonly bundleId: string; readonly nodeSeq: number }
  | { readonly kind: "duplicate_seq"; readonly nodeSeq: number }
  | { readonly kind: "wrong_start"; readonly found: number };

/**
 * One node's bundles, in any order, checked as a chain (PB-15): every hash recomputes, node_seq is 1, 2,
 * 3 with no gap, each prev_hash is the hash of the bundle before it, and the first starts from the genesis
 * hash. A lost, altered, reordered or inserted bundle shows as a problem.
 */
export function verifyBundleChain(bundles: readonly Bundle[], options: { readonly startsAt?: number } = {}): ChainProblem[] {
  const problems: ChainProblem[] = [];
  const ordered = [...bundles].sort((a, b) => a.node_seq - b.node_seq);
  const first = options.startsAt ?? 1;
  let previous: Bundle | undefined;
  for (const bundle of ordered) {
    const { hash: _hash, signature: _signature, ...draft } = bundle;
    if (computeBundleHash(draft) !== bundle.hash) problems.push({ kind: "hash_mismatch", bundleId: bundle.bundle_id, nodeSeq: bundle.node_seq });
    if (previous === undefined) {
      if (bundle.node_seq !== first) problems.push({ kind: "wrong_start", found: bundle.node_seq });
      else if (first === 1 && bundle.prev_hash !== GENESIS_HASH) problems.push({ kind: "prev_hash_mismatch", bundleId: bundle.bundle_id, nodeSeq: bundle.node_seq });
    } else if (bundle.node_seq === previous.node_seq) {
      problems.push({ kind: "duplicate_seq", nodeSeq: bundle.node_seq });
    } else {
      if (bundle.node_seq !== previous.node_seq + 1) problems.push({ kind: "gap", expected: previous.node_seq + 1, found: bundle.node_seq });
      if (bundle.prev_hash !== previous.hash) problems.push({ kind: "prev_hash_mismatch", bundleId: bundle.bundle_id, nodeSeq: bundle.node_seq });
    }
    previous = bundle;
  }
  return problems;
}

export type { Json };
