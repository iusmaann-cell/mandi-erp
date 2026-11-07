import { canonicalJson, type CompanyContext, type DataStore } from "@mandi/data";
import { verifyBundleChain, verifyWireText } from "./bundle";
import type { ApplyRegistry } from "./registry";
import { seriesKeyText } from "./numbering";

/**
 * The checks that run when a node starts again after a crash, and that the books integrity report will
 * grow (document 06, section 10; document 08, 8.7). After any interruption the database must be either
 * wholly done or wholly absent for every command; these are how that is asserted.
 */
export interface IntegrityProblem {
  readonly check: "guard_open" | "stored_bundle" | "chain" | "chain_head" | "quarantined_rows" | "number_gap" | "number_counter" | "orphan_number";
  readonly detail: string;
}

export async function checkIntegrity(store: DataStore, context: CompanyContext, registry: ApplyRegistry): Promise<IntegrityProblem[]> {
  const problems: IntegrityProblem[] = [];
  const add = (check: IntegrityProblem["check"], detail: string): void => {
    problems.push({ check, detail });
  };
  const db = store.scoped(context);
  const installation = store.installation();

  const guard = await installation.selectFrom("apply_guard").select("is_open").executeTakeFirstOrThrow();
  if (guard.is_open === true || (guard.is_open as unknown) === 1n) add("guard_open", "apply_guard is open outside applyBundle");

  // every stored bundle is intact, and each node's bundles form an unbroken chain
  const stored = await db.selectFrom("bundles").select(["id", "node_id", "node_seq", "hash", "payload_json", "state"]).execute();
  const byNode = new Map<string, ReturnType<typeof verifyWireText>["bundle"][]>();
  for (const row of stored.filter((r) => r.state !== "quarantined")) {
    // PostgreSQL returns jsonb in its own text form; the canonical form (X-15) is what the hash was computed over
    let text: string;
    try {
      text = canonicalJson(row.payload_json);
    } catch {
      add("stored_bundle", `bundle ${row.id}: the stored payload is not JSON`);
      continue;
    }
    const verified = verifyWireText(text);
    if (!verified.ok || verified.bundle === undefined) {
      add("stored_bundle", `bundle ${row.id} does not verify: ${verified.problems.join(", ")}`);
      continue;
    }
    if (verified.bundle.hash !== row.hash) add("stored_bundle", `bundle ${row.id}: the stored hash differs from its payload`);
    byNode.set(row.node_id, [...(byNode.get(row.node_id) ?? []), verified.bundle]);
  }
  for (const [nodeId, list] of byNode) {
    const bundles = list.filter((b): b is NonNullable<typeof b> => b !== undefined);
    // a node's chain may include other companies' bundles, so within one company only linkage between neighbours is checked
    const problemsInChain = verifyBundleChain(bundles, { startsAt: Math.min(...bundles.map((b) => b.node_seq)) }).filter((p) => p.kind === "hash_mismatch");
    for (const p of problemsInChain) add("chain", `node ${nodeId}: ${JSON.stringify(p)}`);
    const head = await installation.selectFrom("node_chain_heads").select(["last_seq", "last_hash"]).where("node_id", "=", nodeId).executeTakeFirst();
    const top = bundles.reduce((a, b) => (b.node_seq > a.node_seq ? b : a));
    if (head === undefined) add("chain_head", `node ${nodeId} has bundles but no chain head`);
    else if (BigInt(head.last_seq) < BigInt(top.node_seq)) add("chain_head", `node ${nodeId}: the chain head is behind its newest bundle`);
    else if (BigInt(head.last_seq) === BigInt(top.node_seq) && head.last_hash !== top.hash) add("chain_head", `node ${nodeId}: the chain head hash differs from the newest bundle`);
  }

  // class 1 rows exist only for applied bundles
  const quarantined = new Set(stored.filter((r) => r.state === "quarantined").map((r) => r.id));
  for (const [table, rule] of registry.tables) {
    const untyped = db as unknown as { selectFrom(t: string): { select(c: string[]): { execute(): Promise<Record<string, unknown>[]> } } };
    const column = rule.docNoColumn ?? "doc_no";
    const rows = await untyped.selectFrom(table).select(["bundle_id", column]).execute();
    for (const r of rows) if (quarantined.has(String(r["bundle_id"]))) add("quarantined_rows", `${table} has a row of the quarantined bundle ${String(r["bundle_id"])}`);
  }

  // number series: gap-free except explained ranges, and the counter equals the highest number plus one
  const lost = (await db.selectFrom("lost_numbers").select(["series_key_json", "number_from", "number_to"]).execute()).map((r) => ({ key: canonicalJson(r.series_key_json), from: BigInt(r.number_from), to: BigInt(r.number_to) }));
  const counters = await db.selectFrom("number_series").select(["location_id", "device_id", "doc_type", "fiscal_year_code", "next_number"]).execute();
  const seen = new Map<string, bigint[]>();
  for (const [table, rule] of registry.tables) {
    if (rule.numbering === undefined) continue;
    const untyped = db as unknown as { selectFrom(t: string): { selectAll(): { execute(): Promise<Record<string, unknown>[]> } } };
    for (const row of await untyped.selectFrom(table).selectAll().execute()) {
      const n = rule.numbering(decodeNumberInput(row));
      const text = seriesKeyText(n.series);
      seen.set(text, [...(seen.get(text) ?? []), n.seq]);
    }
  }
  for (const [text, seqs] of seen) {
    const sorted = [...seqs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const explained = (n: bigint): boolean => lost.some((l) => l.key === text && n >= l.from && n <= l.to);
    for (let i = 0; i < sorted.length; i += 1) {
      const expected = i === 0 ? 1n : (sorted[i - 1] ?? 0n) + 1n;
      const got = sorted[i] ?? 0n;
      for (let n = expected; n < got; n += 1n) if (!explained(n)) add("number_gap", `series ${text}: number ${n.toString()} was never used and is not in lost_numbers`);
      if (i > 0 && got === sorted[i - 1]) add("number_gap", `series ${text}: number ${got.toString()} is used twice`);
    }
    const top = sorted[sorted.length - 1] ?? 0n;
    const counter = counters.find((c) => seriesKeyText({ locationId: c.location_id, deviceId: c.device_id, docType: c.doc_type, fiscalYearCode: c.fiscal_year_code }) === text);
    if (counter === undefined) add("orphan_number", `series ${text} has documents but no counter`);
    else if (BigInt(counter.next_number) < top + 1n) add("number_counter", `series ${text}: the counter ${String(counter.next_number)} is behind the highest number ${top.toString()}`);
    else if (BigInt(counter.next_number) > top + 1n && !lost.some((l) => l.key === text)) add("number_counter", `series ${text}: the counter ${String(counter.next_number)} is ahead of the highest number ${top.toString()} with no lost_numbers entry`);
  }
  return problems;
}

/** A row as the database returns it, to what a numbering rule expects (whole numbers as bigint). */
function decodeNumberInput(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "number" ? BigInt(v) : v;
  return out;
}
