import { createTestRuntime, type TestRuntime } from "@mandi/core";
import { canonicalJson, decodeRow, withApplyGuard, type DataStore, type DbKind, type UntypedDb } from "@mandi/data";
import { createTestDatabase, postgresTestsEnabled, startTestPostgres, WITH_TEST_DOCUMENTS, type TestPostgres } from "@mandi/data/testing";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplyRejected, receiveBundle, type ReceiveOutcome } from "./apply";
import { sealBundle, toWireText, type Bundle } from "./bundle";
import { checkIntegrity } from "./integrity";
import { fiscalYearCodeOf, NumberIssuer, recoverSeries } from "./numbering";
import { postTestDocument, seedSyncWorld, tableHashes, TEST_REGISTRY, type PostInput, type SyncWorld } from "./testing";

const KINDS: readonly DbKind[] = postgresTestsEnabled() ? ["sqlite", "postgres"] : ["sqlite"];
let pg: TestPostgres | undefined;
const opened: DataStore[] = [];
beforeAll(async () => {
  if (postgresTestsEnabled()) pg = await startTestPostgres();
}, 180_000);
afterAll(async () => {
  try {
    for (const s of opened) await s.close();
  } finally {
    await pg?.stop();
  }
});

interface Node {
  readonly store: DataStore;
  readonly rt: TestRuntime;
  readonly world: SyncWorld;
}
/** A database with the trivial document type and the same seeded world (same ids) as every other node of a test. */
async function makeNode(kind: DbKind): Promise<Node> {
  const store = (await createTestDatabase(kind, pg)).open({ migrations: WITH_TEST_DOCUMENTS });
  opened.push(store);
  await store.migrate();
  const rt = createTestRuntime({ seed: "sync-world" });
  return { store, rt, world: await seedSyncWorld(store, rt) };
}
const iso = (n: Node): string => new Date(n.rt.clock.nowMs()).toISOString();
const deliver = (n: Node, b: Bundle): Promise<ReceiveOutcome> => receiveBundle(n.store, b, { registry: TEST_REGISTRY, ids: n.rt.ids, nowIso: iso(n) });
const post = async (n: Node, place: "one" | "two", input: PostInput) => {
  n.rt.clock.advance(1000);
  return postTestDocument(n.store, n.rt, n.world, n.world[place], input);
};
const db = (n: Node): UntypedDb => n.store.scoped({ companyId: n.world.companyId }) as UntypedDb;
const rows = (n: Node, table: string): Promise<Record<string, unknown>[]> => db(n).selectFrom(table).selectAll().orderBy("id").execute();
const countOf = async (n: Node, table: string): Promise<number> => (await rows(n, table)).length;
const issues = (n: Node) => checkIntegrity(n.store, { companyId: n.world.companyId }, TEST_REGISTRY);

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? `${v.toString()}n` : v);
/** Everything that must be the same wherever the same bundles have been applied: facts, projections, chain heads. */
async function state(n: Node): Promise<string> {
  const hashes = await tableHashes(n.store, n.world.companyId, ["test_documents", "test_document_lines", "number_series", "test_stock"]);
  const heads = (await n.store.installation().selectFrom("node_chain_heads").selectAll().orderBy("node_id").execute()).map((r) => decodeRow(n.store.catalogue, "node_chain_heads", r));
  return JSON.stringify({ hashes, heads }, bigintReplacer);
}

const strip = (b: Bundle) => {
  const { hash: _h, signature: _s, ...draft } = b;
  return draft;
};
/** A bundle changed and sealed again: a valid chain link carrying different content. */
const reseal = (b: Bundle, change: Partial<ReturnType<typeof strip>>): Bundle => sealBundle({ ...strip(b), ...change });
const mapRow = (b: Bundle, table: string, change: Record<string, string | boolean | null>): Bundle =>
  reseal(b, { rows: b.rows.map((r) => (r.t === table ? { t: r.t, v: { ...r.v, ...change } } : r)) });

describe.each(KINDS)("authoring and numbering on %s (document 06, section 5; PB-16)", (kind) => {
  it("issues consecutive numbers in the form SI-GA-02-2627-000045, keeps the counter, the stock and the chain head", async () => {
    const n = await makeNode(kind);
    const a = await post(n, "one", { lines: [5000n, 2500n] });
    const b = await post(n, "one", { lines: [1000n] });
    expect(a.docNo).toBe("TD-GA-01-2627-000001");
    expect(b.docNo).toBe("TD-GA-01-2627-000002");
    expect((await rows(n, "number_series"))[0]).toMatchObject({ prefix: "TD-GA-01-2627", next_number: 3n });
    expect((await rows(n, "test_stock"))[0]?.["qty_milli"]).toBe(8500n);
    const head = await n.store.installation().selectFrom("node_chain_heads").selectAll().executeTakeFirstOrThrow();
    expect(head.last_seq).toBe(2n);
    expect(head.last_hash).toBe(b.bundle.hash);
    expect(b.bundle.prev_hash).toBe(a.bundle.hash);
    expect(a.bundle.node_seq).toBe(1);
    expect(b.bundle.node_seq).toBe(2);
    expect(await issues(n)).toEqual([]);
  });

  it("a bundle written here is pending (the outbox), and carries its own full content", async () => {
    const n = await makeNode(kind);
    const p = await post(n, "one", { lines: [1n] });
    const stored = await db(n).selectFrom("bundles").selectAll().executeTakeFirstOrThrow();
    expect(stored.state).toBe("pending");
    expect(canonicalJson(String(stored.payload_json))).toBe(toWireText(p.bundle));
    expect(stored.node_seq).toBe(1n);
  });

  it("numbers are per device, per location and per fiscal year; a back-dated document continues its own year", async () => {
    const n = await makeNode(kind);
    await post(n, "one", { lines: [1n] });
    expect((await post(n, "one", { lines: [1n], deviceId: n.world.oneSecondDevice })).docNo).toBe("TD-GA-02-2627-000001");
    expect((await post(n, "two", { lines: [1n] })).docNo).toBe("TD-GB-01-2627-000001");
    expect((await post(n, "one", { lines: [1n], docDate: "2027-07-05" })).docNo).toBe("TD-GA-01-2728-000001");
    expect((await post(n, "one", { lines: [1n], docDate: "2026-06-30" })).docNo).toBe("TD-GA-01-2526-000001");
    expect((await post(n, "one", { lines: [1n], docDate: "2026-09-01" })).docNo).toBe("TD-GA-01-2627-000002");
    expect(await countOf(n, "number_series")).toBe(5);
    expect(await issues(n)).toEqual([]);
  });

  it("a save that is rejected burns no number and leaves no trace", async () => {
    const n = await makeNode(kind);
    await post(n, "one", { lines: [1n] });
    const before = await state(n);
    await expect(post(n, "one", { lines: [5n], totalMilli: 6n })).rejects.toMatchObject({ name: "ApplyRejected", code: "unbalanced_journal" });
    expect(await state(n)).toBe(before);
    expect(await countOf(n, "bundles")).toBe(1);
    expect(await countOf(n, "exceptions")).toBe(0); // the author is told; nothing is quarantined at the author
    expect((await post(n, "one", { lines: [2n] })).docNo).toBe("TD-GA-01-2627-000002");
  });

  it("a transaction that issues numbers and then fails does not move the counter (it is read, not written, until the bundle applies)", async () => {
    const n = await makeNode(kind);
    await post(n, "one", { lines: [1n] });
    const key = { locationId: n.world.one.locationId, deviceId: n.world.one.deviceId, docType: "TD", fiscalYearCode: fiscalYearCodeOf("2026-08-15") };
    await expect(
      n.store.transaction({ companyId: n.world.companyId }, async (tx) => {
        const issuer = new NumberIssuer(tx);
        expect((await issuer.issue(key)).seq).toBe(2n);
        expect((await issuer.issue(key)).seq).toBe(3n); // two numbers of one series in one transaction are consecutive
        throw new Error("the save failed after the numbers were issued");
      }),
    ).rejects.toThrow("the save failed");
    expect((await rows(n, "number_series"))[0]?.["next_number"]).toBe(2n);
    expect((await post(n, "one", { lines: [1n] })).docNo).toBe("TD-GA-01-2627-000002");
  });

  it("PB-16: numbers stay unique and gap-free per series through any mix of saves, rejected saves, devices and years (property)", async () => {
    const op = fc.constantFrom("one", "one-device-2", "two", "year-2728", "rejected");
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 9 }), async (ops) => {
        const n = await makeNode(kind);
        for (const o of ops) {
          try {
            if (o === "one") await post(n, "one", { lines: [1n] });
            if (o === "one-device-2") await post(n, "one", { lines: [1n], deviceId: n.world.oneSecondDevice });
            if (o === "two") await post(n, "two", { lines: [1n] });
            if (o === "year-2728") await post(n, "one", { lines: [1n], docDate: "2027-08-01" });
            if (o === "rejected") await post(n, "one", { lines: [1n], totalMilli: 99n });
          } catch (e) {
            if (!(e instanceof ApplyRejected)) throw e;
          }
        }
        const bySeries = new Map<string, bigint[]>();
        for (const r of await rows(n, "test_documents")) {
          const k = `${String(r["location_id"])}|${String(r["device_id"])}|${String(r["fiscal_year_code"])}`;
          bySeries.set(k, [...(bySeries.get(k) ?? []), BigInt(r["number_seq"] as bigint)]);
        }
        for (const seqs of bySeries.values()) {
          const sorted = [...seqs].sort((a, b) => (a < b ? -1 : 1));
          expect(sorted).toEqual(sorted.map((_, i) => BigInt(i + 1)));
        }
        const docNos = (await rows(n, "test_documents")).map((r) => r["doc_no"]);
        expect(new Set(docNos).size).toBe(docNos.length);
        expect(await issues(n)).toEqual([]);
      }),
      { numRuns: 8 },
    );
  }, 120_000);
});

describe.each(KINDS)("receiving bundles on %s (document 06, section 4.3)", (kind) => {
  it("applies on another database to exactly the same facts, projections and chain heads", async () => {
    const author = await makeNode(kind);
    const cloud = await makeNode(kind);
    const bundles = [(await post(author, "one", { lines: [5000n, 2500n] })).bundle, (await post(author, "one", { lines: [100n] })).bundle, (await post(author, "two", { lines: [7n] })).bundle];
    for (const b of bundles) expect(await deliver(cloud, b)).toEqual({ status: "applied" });
    expect(await state(cloud)).toBe(await state(author));
    expect((await db(cloud).selectFrom("bundles").select("state").execute()).map((r) => String(r["state"]))).toEqual(["accepted", "accepted", "accepted"]);
    expect(await issues(cloud)).toEqual([]);
  });

  it("PB-13: applying a bundle twice is the same as applying it once", async () => {
    const author = await makeNode(kind);
    const cloud = await makeNode(kind);
    const b = (await post(author, "one", { lines: [4n, 5n] })).bundle;
    expect(await deliver(cloud, b)).toEqual({ status: "applied" });
    const once = await state(cloud);
    expect(await deliver(cloud, b)).toEqual({ status: "duplicate" });
    expect(await deliver(cloud, b)).toEqual({ status: "duplicate" });
    expect(await state(cloud)).toBe(once);
    expect(await countOf(cloud, "bundles")).toBe(1);
    // and at the author, whose own bundle is already applied
    expect(await deliver(author, b)).toEqual({ status: "duplicate" });
  });

  it("PB-13 (property): any pattern of repeated deliveries gives the same state", async () => {
    const author = await makeNode(kind);
    const bundles = [(await post(author, "one", { lines: [1n] })).bundle, (await post(author, "one", { lines: [2n] })).bundle, (await post(author, "two", { lines: [3n] })).bundle];
    const reference = await state(author);
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 0, maxLength: 6 }), async (repeats) => {
        const cloud = await makeNode(kind);
        for (const b of bundles) await deliver(cloud, b);
        for (const i of repeats) expect((await deliver(cloud, bundles[i]!)).status).toBe("duplicate");
        expect(await state(cloud)).toBe(reference);
      }),
      { numRuns: 6 },
    );
  }, 120_000);

  it("PB-14: bundles of two locations applied in every interleaving give the same final state (each location has one writer)", async () => {
    const author = await makeNode(kind);
    const one = [(await post(author, "one", { lines: [10n] })).bundle, (await post(author, "one", { lines: [20n, 5n] })).bundle, (await post(author, "one", { lines: [30n], deviceId: author.world.oneSecondDevice })).bundle];
    const two = [(await post(author, "two", { lines: [1n] })).bundle, (await post(author, "two", { lines: [2n] })).bundle, (await post(author, "two", { lines: [3n, 4n] })).bundle];
    const masks: boolean[][] = [];
    for (let m = 0; m < 64; m += 1) {
      const bits = [0, 1, 2, 3, 4, 5].map((i) => ((m >> i) & 1) === 1);
      if (bits.filter(Boolean).length === 3) masks.push(bits); // exactly three from node 1: all 20 interleavings
    }
    expect(masks).toHaveLength(20);
    let reference: string | undefined;
    for (const mask of masks) {
      const cloud = await makeNode(kind);
      let i = 0;
      let j = 0;
      for (const fromOne of mask) await deliver(cloud, fromOne ? one[i++]! : two[j++]!);
      const s = await state(cloud);
      reference ??= s;
      expect(s).toBe(reference);
      expect(await countOf(cloud, "test_documents")).toBe(6);
    }
    expect(reference).toBe(await state(author));
  }, 180_000);

  it("PB-14 (property): in any delivery order, retrying what was refused, the final state is the same", async () => {
    const author = await makeNode(kind);
    const all = [
      (await post(author, "one", { lines: [1n] })).bundle,
      (await post(author, "two", { lines: [2n] })).bundle,
      (await post(author, "one", { lines: [3n] })).bundle,
      (await post(author, "two", { lines: [4n] })).bundle,
      (await post(author, "one", { lines: [5n] })).bundle,
    ];
    const reference = await state(author);
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length }), async (order) => {
        const cloud = await makeNode(kind);
        for (let pass = 0; pass < all.length; pass += 1) {
          let progress = false;
          for (const b of order) if ((await deliver(cloud, b)).status === "applied") progress = true;
          if (!progress) break;
        }
        expect(await state(cloud)).toBe(reference);
        expect(await issues(cloud)).toEqual([]);
        expect(await countOf(cloud, "exceptions")).toBeGreaterThanOrEqual(0);
        expect((await db(cloud).selectFrom("exceptions").select("state").where("state", "=", "open").execute()).length).toBe(0); // everything refused was applied later, so nothing stays open
      }),
      { numRuns: 6 },
    );
  }, 180_000);
});

describe.each(KINDS)("rejected bundles are quarantined, never lost, never half applied (document 05, section 7.3) on %s", (kind) => {
  async function pair() {
    const author = await makeNode(kind);
    const cloud = await makeNode(kind);
    return { author, cloud };
  }
  const quarantinedWith = async (n: Node, code: string) => {
    const ex = await rows(n, "exceptions");
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ reason_code: code, state: "open" });
    return ex[0];
  };
  const untouched = async (n: Node, before: string) => {
    expect(await state(n)).toBe(before);
    expect(await countOf(n, "test_documents")).toBe(0);
  };

  it("sequence_gap: a bundle that arrives before its predecessor waits, and applies once the predecessor has", async () => {
    const { author, cloud } = await pair();
    const b1 = (await post(author, "one", { lines: [1n] })).bundle;
    const b2 = (await post(author, "one", { lines: [2n] })).bundle;
    const before = await state(cloud);
    const first = await deliver(cloud, b2);
    expect(first).toMatchObject({ status: "quarantined", code: "sequence_gap" });
    await untouched(cloud, before);
    expect((await rows(cloud, "bundles"))[0]).toMatchObject({ id: b2.bundle_id, state: "quarantined" });
    await quarantinedWith(cloud, "sequence_gap");
    expect(await deliver(cloud, b1)).toEqual({ status: "applied" });
    expect(await deliver(cloud, b2)).toEqual({ status: "applied" });
    expect(await state(cloud)).toBe(await state(author));
    expect((await rows(cloud, "exceptions"))[0]).toMatchObject({ state: "resolved", resolution_note: "applied on retry" });
    expect(await countOf(cloud, "bundles")).toBe(2);
  });

  it("delivering a refused bundle again does not pile up exceptions: the open one is updated", async () => {
    const { author, cloud } = await pair();
    await post(author, "one", { lines: [1n] });
    const b2 = (await post(author, "one", { lines: [2n] })).bundle;
    await deliver(cloud, b2);
    await deliver(cloud, b2);
    await deliver(cloud, b2);
    expect(await countOf(cloud, "exceptions")).toBe(1);
    expect(await countOf(cloud, "bundles")).toBe(1);
  });

  it("stale_epoch: a bundle from a location whose authority has since changed is refused", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    await db(cloud).updateTable("locations").set({ current_epoch: 2n }).where("id", "=", cloud.world.one.locationId).execute();
    const before = await state(cloud);
    expect(await deliver(cloud, b)).toMatchObject({ status: "quarantined", code: "stale_epoch" });
    await untouched(cloud, before);
    await quarantinedWith(cloud, "stale_epoch");
  });

  it("an epoch ahead of what this database knows waits (the authority change has not arrived), and applies when it has", async () => {
    const { author, cloud } = await pair();
    await db(author).updateTable("locations").set({ current_epoch: 2n }).where("id", "=", author.world.one.locationId).execute();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    expect(b.epoch).toBe(2);
    expect(await deliver(cloud, b)).toMatchObject({ status: "quarantined", code: "other" });
    expect((await quarantinedWith(cloud, "other"))?.["detail"]).toMatch(/ahead of the location's epoch/);
    await db(cloud).updateTable("locations").set({ current_epoch: 2n }).where("id", "=", cloud.world.one.locationId).execute();
    expect(await deliver(cloud, b)).toEqual({ status: "applied" });
  });

  it("a bundle from a node that is not the authority of the location is refused", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    const forged = reseal(b, { node_id: cloud.world.two.nodeId });
    expect(await deliver(cloud, forged)).toMatchObject({ status: "quarantined", code: "other" });
    expect((await quarantinedWith(cloud, "other"))?.["detail"]).toMatch(/not the authority/);
  });

  it("schema_unsupported: a newer bundle is refused; an older one inside the accepted window is not", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    const newer = reseal(b, { schema_version: 2 });
    expect(await deliver(cloud, newer)).toMatchObject({ status: "quarantined", code: "schema_unsupported" });
    expect(await receiveBundle(cloud.store, newer, { registry: TEST_REGISTRY, ids: cloud.rt.ids, nowIso: iso(cloud), schema: { min: 1, max: 2 } })).toEqual({ status: "applied" });
  });

  it("a bundle whose content was changed after it was sealed is refused (hash)", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    const tampered: Bundle = { ...b, rows: b.rows.map((r) => (r.t === "test_document_lines" ? { t: r.t, v: { ...r.v, qty_milli: "999" } } : r)) };
    const before = await state(cloud);
    expect(await deliver(cloud, tampered)).toMatchObject({ status: "quarantined", code: "other" });
    expect((await quarantinedWith(cloud, "other"))?.["detail"]).toMatch(/hash/);
    await untouched(cloud, before);
  });

  it("a bundle whose prev_hash is not the chain head is refused", async () => {
    const { author, cloud } = await pair();
    const b1 = (await post(author, "one", { lines: [1n] })).bundle;
    const b2 = (await post(author, "one", { lines: [2n] })).bundle;
    await deliver(cloud, b1);
    expect(await deliver(cloud, reseal(b2, { prev_hash: "ab".repeat(32) }))).toMatchObject({ status: "quarantined", code: "other" });
    expect((await quarantinedWith(cloud, "other"))?.["detail"]).toMatch(/prev_hash/);
  });

  it("unbalanced_journal: the content rule (here: lines add up to the total) is checked, and nothing is written", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [5n, 5n] })).bundle;
    const wrong = mapRow(b, "test_documents", { total_milli: "11" });
    const before = await state(cloud);
    expect(await deliver(cloud, wrong)).toMatchObject({ status: "quarantined", code: "unbalanced_journal" });
    await untouched(cloud, before);
    expect(await countOf(cloud, "test_document_lines")).toBe(0);
    expect(await countOf(cloud, "number_series")).toBe(0);
    expect(await cloud.store.installation().selectFrom("node_chain_heads").select("id").execute()).toEqual([]);
  });

  it("duplicate_number: a number that is already used is refused", async () => {
    const { author, cloud } = await pair();
    const b1 = (await post(author, "one", { lines: [1n] })).bundle;
    const b2 = (await post(author, "one", { lines: [2n] })).bundle;
    await deliver(cloud, b1);
    const clash = mapRow(b2, "test_documents", { doc_no: String(b1.rows[0]?.v["doc_no"]) });
    expect(await deliver(cloud, clash)).toMatchObject({ status: "quarantined", code: "duplicate_number" });
    expect(await countOf(cloud, "test_documents")).toBe(1);
  });

  it("a number twice in one bundle is refused", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    const doc = b.rows.find((r) => r.t === "test_documents")!;
    const second = { t: doc.t, v: { ...doc.v, id: "0192f0b4-0000-7000-8000-0000000000ee" } };
    expect(await deliver(cloud, reseal(b, { rows: [...b.rows, second] }))).toMatchObject({ status: "quarantined", code: "duplicate_number" });
  });

  it("a row the database refuses (a constraint) rolls the whole bundle back, even the rows before it", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n, 2n] })).bundle;
    const lines = b.rows.filter((r) => r.t === "test_document_lines");
    const duplicateLineNumber = reseal(b, { rows: [...b.rows.filter((r) => r.t !== "test_document_lines"), lines[0]!, { t: lines[1]!.t, v: { ...lines[1]!.v, line_no: lines[0]!.v["line_no"] ?? null } }] });
    const before = await state(cloud);
    const outcome = await deliver(cloud, duplicateLineNumber);
    expect(outcome).toMatchObject({ status: "quarantined", code: "other" });
    expect((outcome as { detail: string }).detail).toMatch(/database refused/);
    await untouched(cloud, before);
    expect(await countOf(cloud, "test_document_lines")).toBe(0);
  });

  it("rows that are not facts, or not well formed, are refused: another company, a derived table, an unknown column, a bundle_id inside a row", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    const doc = b.rows.find((r) => r.t === "test_documents")!;
    const cases: [string, Bundle][] = [
      ["another company", mapRow(b, "test_documents", { company_id: "0192f0b4-0000-7000-8000-0000000000cc" })],
      ["a projection table", reseal(b, { rows: [...b.rows, { t: "number_series", v: { company_id: b.company_id } }] })],
      ["an unknown column", mapRow(b, "test_documents", { surprise: "1" })],
      ["a bundle_id in a row", mapRow(b, "test_documents", { bundle_id: b.bundle_id })],
      ["a number that is not canonical", mapRow(b, "test_documents", { number_seq: "01" })],
      ["a missing column", reseal(b, { rows: b.rows.map((r) => (r === doc ? { t: r.t, v: Object.fromEntries(Object.entries(r.v).filter(([k]) => k !== "doc_no")) } : r)) })],
    ];
    for (const [name, bad] of cases) {
      const outcome = await deliver(cloud, bad);
      expect(outcome, name).toMatchObject({ status: "quarantined", code: "other" });
      expect(await countOf(cloud, "test_documents"), name).toBe(0);
    }
  });

  it("a bundle from a node this database does not know cannot be stored; the refusal is still recorded, without the bundle", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    const stranger = reseal(b, { node_id: "0192f0b4-0000-7000-8000-0000000000ff" });
    expect(await deliver(cloud, stranger)).toMatchObject({ status: "quarantined", code: "other" });
    expect(await countOf(cloud, "bundles")).toBe(0);
    const ex = await rows(cloud, "exceptions");
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ bundle_id: null, state: "open" });
    expect(String(ex[0]?.["detail"])).toMatch(/could not be kept/);
  });

  it("the same bundle id used again with different content is refused and never replaces the applied one", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    await deliver(cloud, b);
    const before = await state(cloud);
    const other = mapRow(b, "test_document_lines", { qty_milli: "2" });
    const outcome = await deliver(cloud, other);
    expect(outcome).toMatchObject({ status: "quarantined", code: "other" });
    expect(await state(cloud)).toBe(before);
    expect((await rows(cloud, "bundles"))[0]).toMatchObject({ id: b.bundle_id, state: "accepted" });
  });

  it("a bundle whose projection would overflow 64 bits is rejected, not a crash that repeats on every retry (no poison message)", async () => {
    const { author, cloud } = await pair();
    const b1 = (await post(author, "one", { lines: [9223372036854775807n] })).bundle;
    const b2 = (await post(author, "one", { lines: [-9223372036854775807n] })).bundle;
    // the author itself refuses a document that would push the stock beyond 64 bits (stock is back to 0 after b2: fill it, then one more)
    await post(author, "one", { lines: [9223372036854775807n] });
    await expect(post(author, "one", { lines: [1n] })).rejects.toMatchObject({ name: "ApplyRejected", code: "other" });
    expect((await rows(author, "bundles")).length).toBe(3); // the rejected save left nothing behind
    expect(await deliver(cloud, b1)).toEqual({ status: "applied" });
    const before = await state(cloud);
    const overflowing = mapRow(mapRow(b2, "test_document_lines", { qty_milli: "9223372036854775807" }), "test_documents", { total_milli: "9223372036854775807" });
    const outcome = await deliver(cloud, overflowing);
    expect(outcome).toMatchObject({ status: "quarantined", code: "other" });
    expect((outcome as { detail: string }).detail).toMatch(/projection could not be derived/);
    expect(await state(cloud)).toBe(before);
    expect(await deliver(cloud, overflowing)).toMatchObject({ status: "quarantined" }); // the same answer every time, never an exception
  });

  it("an unexpected failure (not a rejection) is not swallowed: it propagates and nothing is quarantined", async () => {
    const { author, cloud } = await pair();
    const b = (await post(author, "one", { lines: [1n] })).bundle;
    const broken = { ...TEST_REGISTRY, validators: [() => Promise.reject(new Error("the validator itself crashed"))] };
    await expect(receiveBundle(cloud.store, b, { registry: broken, ids: cloud.rt.ids, nowIso: iso(cloud) })).rejects.toThrow("the validator itself crashed");
    expect(await countOf(cloud, "bundles")).toBe(0);
    expect(await countOf(cloud, "exceptions")).toBe(0);
  });
});

describe.each(KINDS)("integrity checks after the fact on %s (PB-15, document 08 section 8.7)", (kind) => {
  it("find a bundle changed in storage, even by one character, and a counter that was moved by hand", async () => {
    const n = await makeNode(kind);
    await post(n, "one", { lines: [1n] });
    const b2 = (await post(n, "one", { lines: [2n] })).bundle;
    expect(await issues(n)).toEqual([]);
    // 1. change one value of a stored bundle (bundles are class S: the database allows it, the hash chain must not)
    const stored = await db(n).selectFrom("bundles").select("payload_json").where("id", "=", b2.bundle_id).executeTakeFirstOrThrow();
    const original = canonicalJson(String(stored.payload_json));
    const changed = original.replace('"qty_milli":"2"', '"qty_milli":"3"');
    expect(changed).not.toBe(original);
    await db(n).updateTable("bundles").set({ payload_json: changed }).where("id", "=", b2.bundle_id).execute();
    expect((await issues(n)).some((p) => p.check === "stored_bundle" && p.detail.includes(b2.bundle_id))).toBe(true);
    await db(n).updateTable("bundles").set({ payload_json: original }).where("id", "=", b2.bundle_id).execute();
    expect(await issues(n)).toEqual([]);
    // 2. move a counter by hand (only possible with the guard open)
    await n.store.transaction({ companyId: n.world.companyId }, (tx) => withApplyGuard(tx.scoped, () => tx.scoped.updateTable("number_series").set({ next_number: 9n }).execute()));
    expect((await issues(n)).some((p) => p.check === "number_counter")).toBe(true);
  });

  it("find a chain head that does not match the newest bundle", async () => {
    const n = await makeNode(kind);
    await post(n, "one", { lines: [1n] });
    await n.store.transaction({ companyId: n.world.companyId }, (tx) => withApplyGuard(tx.scoped, () => tx.installation.updateTable("node_chain_heads").set({ last_hash: "cd".repeat(32) }).execute()));
    expect((await issues(n)).some((p) => p.check === "chain_head")).toBe(true);
  });

  it("find a number that was never used and is not explained, and accept it once it is explained in lost_numbers", async () => {
    const author = await makeNode(kind);
    const n = await makeNode(kind);
    const b1 = (await post(author, "one", { lines: [1n] })).bundle;
    const b2 = (await post(author, "one", { lines: [1n] })).bundle;
    // a bundle that skips number 2: the document of b2 claims number 3 (the apply path does not forbid a jump; the integrity run is the alarm)
    const skipping = mapRow(mapRow(b2, "test_documents", { number_seq: "3", doc_no: "TD-GA-01-2627-000003" }), "test_documents", {});
    expect(await deliver(n, b1)).toEqual({ status: "applied" });
    expect(await deliver(n, skipping)).toEqual({ status: "applied" });
    const problems = await issues(n);
    expect(problems.filter((p) => p.check === "number_gap").map((p) => p.detail)).toEqual([expect.stringContaining("number 2 was never used")]);
    // explained: a lost_numbers entry for exactly that number, written by the recovery path's own table
    await db(n)
      .insertInto("lost_numbers")
      .values({ id: n.rt.ids.newId(), series_key_json: JSON.stringify({ deviceId: n.world.one.deviceId, docType: "TD", fiscalYearCode: "2627", locationId: n.world.one.locationId }), number_from: 2n, number_to: 2n, reason: "lost_device", recorded_at: iso(n) })
      .execute();
    expect((await issues(n)).filter((p) => p.check === "number_gap")).toEqual([]);
  });

  it("find a number used twice (the same sequence number under two printed numbers)", async () => {
    const author = await makeNode(kind);
    const n = await makeNode(kind);
    const b1 = (await post(author, "one", { lines: [1n] })).bundle;
    const b2 = (await post(author, "one", { lines: [1n] })).bundle;
    expect(await deliver(n, b1)).toEqual({ status: "applied" });
    // the second document claims sequence 1 again under a different printed number
    expect(await deliver(n, mapRow(b2, "test_documents", { number_seq: "1", doc_no: "TD-GA-01-2627-000009" }))).toEqual({ status: "applied" });
    expect((await issues(n)).some((p) => p.check === "number_gap" && p.detail.includes("used twice"))).toBe(true);
  });
});

describe.each(KINDS)("recovering a series after a lost device (document 06, section 5.2) on %s", (kind) => {
  const key = (n: Node) => ({ locationId: n.world.one.locationId, deviceId: n.world.one.deviceId, docType: "TD", fiscalYearCode: "2627" });

  it("jumps the counter ahead by 100 and records the skipped range, so the gap is explained", async () => {
    const n = await makeNode(kind);
    for (let i = 0; i < 3; i += 1) await post(n, "one", { lines: [1n] });
    const result = await recoverSeries(n.store, { companyId: n.world.companyId }, n.rt, key(n), { reason: "lost_device" });
    expect(result).toEqual({ from: 4n, to: 103n, nextNumber: 104n });
    expect((await rows(n, "lost_numbers"))[0]).toMatchObject({ number_from: 4n, number_to: 103n, reason: "lost_device" });
    expect((await post(n, "one", { lines: [1n] })).docNo).toBe("TD-GA-01-2627-000104");
    expect(await issues(n)).toEqual([]); // the gap 4 to 103 is explained
  });

  it("starts from what the cloud knows when that is higher, and on a series that has no row yet", async () => {
    const n = await makeNode(kind);
    const result = await recoverSeries(n.store, { companyId: n.world.companyId }, n.rt, key(n), { reason: "restore", knownHighest: 50n });
    expect(result).toEqual({ from: 51n, to: 150n, nextNumber: 151n });
    expect((await post(n, "one", { lines: [1n] })).docNo).toBe("TD-GA-01-2627-000151");
    expect((await rows(n, "number_series"))[0]).toMatchObject({ prefix: "TD-GA-01-2627", next_number: 152n });
  });

  it("a document found later on the old device, with a number below the jump, still syncs", async () => {
    const author = await makeNode(kind);
    const replacement = await makeNode(kind);
    const bundles: Bundle[] = [];
    for (let i = 0; i < 4; i += 1) bundles.push((await post(author, "one", { lines: [1n] })).bundle);
    for (const b of bundles.slice(0, 3)) await deliver(replacement, b); // the replacement was restored from a backup that has numbers 1 to 3
    await recoverSeries(replacement.store, { companyId: replacement.world.companyId }, replacement.rt, key(replacement), { reason: "lost_device" });
    expect((await rows(replacement, "number_series"))[0]?.["next_number"]).toBe(104n);
    expect(await deliver(replacement, bundles[3]!)).toEqual({ status: "applied" }); // number 4 from the old device
    expect((await rows(replacement, "number_series"))[0]?.["next_number"]).toBe(104n); // the counter did not move back
    expect(await issues(replacement)).toEqual([]);
  });
});
