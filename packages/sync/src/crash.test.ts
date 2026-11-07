import { createTestRuntime, type TestRuntime } from "@mandi/core";
import { decodeRow, type DataStore, type DbKind } from "@mandi/data";
import { createTestDatabase, postgresTestsEnabled, startTestPostgres, WITH_TEST_DOCUMENTS, type TestDatabase, type TestPostgres } from "@mandi/data/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { receiveBundle } from "./apply";
import type { Bundle } from "./bundle";
import { checkIntegrity } from "./integrity";
import { recoverSeries } from "./numbering";
import { postTestDocument, seedSyncWorld, tableHashes, TEST_REGISTRY, type SyncWorld } from "./testing";

/**
 * Document 09, section 8.6, crash-point tests: for each of the main commands (apply a bundle, post with
 * number issue, recover a series) the operation is run and the connection is abandoned after each
 * database statement in turn, without commit or rollback, which is what the database sees when a
 * process dies. The database is then opened again, the start-up check runs, and the result must be
 * either wholly done or wholly absent, the integrity checks must pass, no number may exist without its
 * document (or the gap must be explained), and a retry must complete the work once.
 *
 * Not covered here: a real operating-system kill of the process, and power loss with unflushed writes
 * discarded (FI-7). Those need the simulator (BC-08) and the device lab.
 */
const KINDS: readonly DbKind[] = postgresTestsEnabled() ? ["sqlite", "postgres"] : ["sqlite"];
let pg: TestPostgres | undefined;
beforeAll(async () => {
  if (postgresTestsEnabled()) pg = await startTestPostgres();
}, 180_000);
afterAll(async () => {
  await pg?.stop();
});

class SimulatedCrash extends Error {
  constructor() {
    super("simulated crash");
    this.name = "SimulatedCrash";
  }
}

const closeQuietly = async (store: DataStore): Promise<void> => {
  await Promise.race([store.close().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
};

interface Harness {
  readonly db: TestDatabase;
  readonly world: SyncWorld;
}
async function fresh(kind: DbKind): Promise<Harness> {
  const db = await createTestDatabase(kind, pg);
  const store = db.open({ migrations: WITH_TEST_DOCUMENTS });
  await store.migrate();
  const world = await seedSyncWorld(store, createTestRuntime({ seed: "sync-world" }));
  await closeQuietly(store);
  return { db, world };
}

/** Run `work` on a store that abandons its connection after statement k (or never, when k is null); returns how many statements ran. */
async function run(h: Harness, k: number | null, work: (store: DataStore) => Promise<unknown>): Promise<{ crashed: boolean; statements: number }> {
  let count = 0;
  let crashed = false;
  const store = h.db.open({
    migrations: WITH_TEST_DOCUMENTS,
    hooks: {
      afterStatement: (info) => {
        count += 1;
        if (k !== null && count === k) {
          crashed = true;
          info.abandon();
          throw new SimulatedCrash();
        }
      },
    },
  });
  try {
    await work(store);
  } catch (error) {
    if (!crashed) throw error;
  }
  await closeQuietly(store);
  return { crashed, statements: count };
}

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === "bigint" ? `${v.toString()}n` : v);
/** Reopen the database as the program would after a crash: migrate (the start-up check), then read. */
async function restart<T>(h: Harness, read: (store: DataStore) => Promise<T>): Promise<T> {
  const store = h.db.open({ migrations: WITH_TEST_DOCUMENTS });
  try {
    await store.migrate();
    return await read(store);
  } finally {
    await closeQuietly(store);
  }
}
const stateOf = async (h: Harness, store: DataStore): Promise<string> => {
  const hashes = await tableHashes(store, h.world.companyId, ["test_documents", "test_document_lines", "number_series", "test_stock", "lost_numbers"]);
  const heads = (await store.installation().selectFrom("node_chain_heads").selectAll().orderBy("node_id").execute()).map((r) => decodeRow(store.catalogue, "node_chain_heads", r));
  const bundles = (await store.scoped({ companyId: h.world.companyId }).selectFrom("bundles").select(["id", "state"]).orderBy("id").execute()).map((r) => `${r.id}:${r.state}`);
  return JSON.stringify({ hashes, heads, bundles }, bigintReplacer);
};
const integrityOf = (h: Harness, store: DataStore) => checkIntegrity(store, { companyId: h.world.companyId }, TEST_REGISTRY);
const docNumbers = async (h: Harness, store: DataStore): Promise<number[]> =>
  (await store.scoped({ companyId: h.world.companyId }).selectFrom("test_documents" as never).select("number_seq" as never).execute() as unknown as { number_seq: bigint }[]).map((r) => Number(r.number_seq)).sort((a, b) => a - b);

describe.each(KINDS)("crash after every statement of applying a bundle on %s", (kind) => {
  it("is wholly done or wholly absent, passes the integrity checks, and a retry of the same bundle completes it once", async () => {
    // the bundles come from an author node
    const author = await fresh(kind);
    const authorStore = author.db.open({ migrations: WITH_TEST_DOCUMENTS });
    const authorRt = createTestRuntime({ seed: "author-run" });
    const bundles: Bundle[] = [];
    for (let i = 0; i < 2; i += 1) {
      authorRt.clock.advance(1000);
      bundles.push((await postTestDocument(authorStore, authorRt, author.world, author.world.one, { lines: [5n, 7n] })).bundle);
    }
    await closeQuietly(authorStore);
    const receive = (store: DataStore, b: Bundle) => receiveBundle(store, b, { registry: TEST_REGISTRY, ids: createTestRuntime({ seed: "receiver" }).ids, nowIso: "2026-07-01T00:00:10.000Z" });

    // reference states and the number of statements, from a run with no crash
    const ref = await fresh(kind);
    await run(ref, null, (s) => receive(s, bundles[0]!));
    const before = await restart(ref, (s) => stateOf(ref, s));
    const counted = await run(ref, null, (s) => receive(s, bundles[1]!));
    const after = await restart(ref, (s) => stateOf(ref, s));
    expect(counted.statements).toBeGreaterThan(10);
    expect(before).not.toBe(after);

    for (let k = 1; k <= counted.statements; k += 1) {
      const h = await fresh(kind);
      await run(h, null, (s) => receive(s, bundles[0]!));
      const crash = await run(h, k, (s) => receive(s, bundles[1]!));
      expect(crash.crashed, `statement ${String(k)}`).toBe(true);
      const outcome = await restart(h, async (s) => ({ state: await stateOf(h, s), problems: await integrityOf(h, s) }));
      expect(outcome.problems, `statement ${String(k)}: integrity`).toEqual([]);
      expect([before, after], `statement ${String(k)}: wholly done or wholly absent`).toContain(outcome.state);
      const retried = await run(h, null, async (s) => {
        const result = await receive(s, bundles[1]!);
        expect(result.status, `statement ${String(k)}: retry`).toBe(outcome.state === after ? "duplicate" : "applied");
      });
      expect(retried.crashed).toBe(false);
      const final = await restart(h, async (s) => ({ state: await stateOf(h, s), problems: await integrityOf(h, s) }));
      expect(final.state, `statement ${String(k)}: after the retry`).toBe(after);
      expect(final.problems).toEqual([]);
    }
  }, 600_000);

  it("a rejected bundle is also all or nothing: a crash while quarantining leaves it either kept with its exception or not recorded, and a retry records it once", async () => {
    const author = await fresh(kind);
    const authorStore = author.db.open({ migrations: WITH_TEST_DOCUMENTS });
    const authorRt = createTestRuntime({ seed: "author-run-2" });
    authorRt.clock.advance(1000);
    await postTestDocument(authorStore, authorRt, author.world, author.world.one, { lines: [1n] });
    authorRt.clock.advance(1000);
    const second = (await postTestDocument(authorStore, authorRt, author.world, author.world.one, { lines: [2n] })).bundle;
    await closeQuietly(authorStore);
    const receive = (store: DataStore) => receiveBundle(store, second, { registry: TEST_REGISTRY, ids: createTestRuntime({ seed: "receiver-2" }).ids, nowIso: "2026-07-01T00:00:10.000Z" });
    const counted = await run(await fresh(kind), null, receive); // delivered before its predecessor: sequence_gap, quarantined
    expect(counted.statements).toBeGreaterThan(5);
    for (let k = 1; k <= counted.statements; k += 1) {
      const h = await fresh(kind);
      const crash = await run(h, k, receive);
      expect(crash.crashed).toBe(true);
      const kept = await restart(h, async (s) => ({
        bundles: (await s.scoped({ companyId: h.world.companyId }).selectFrom("bundles").select(["id", "state"]).execute()).length,
        exceptions: (await s.scoped({ companyId: h.world.companyId }).selectFrom("exceptions").select(["id", "state"]).execute()).length,
        documents: (await docNumbers(h, s)).length,
        problems: await integrityOf(h, s),
      }));
      expect(kept.documents, `statement ${String(k)}`).toBe(0);
      expect(kept.problems).toEqual([]);
      expect([`${String(kept.bundles)}/${String(kept.exceptions)}`], `statement ${String(k)}: the bundle and its exception are recorded together or not at all`).toEqual([kept.bundles === kept.exceptions ? `${String(kept.bundles)}/${String(kept.exceptions)}` : "mismatch"]);
      await run(h, null, receive);
      const final = await restart(h, async (s) => ({
        bundles: (await s.scoped({ companyId: h.world.companyId }).selectFrom("bundles").select("id").execute()).length,
        exceptions: (await s.scoped({ companyId: h.world.companyId }).selectFrom("exceptions").select("id").execute()).length,
      }));
      expect(final, `statement ${String(k)}: after the retry`).toEqual({ bundles: 1, exceptions: 1 });
    }
  }, 600_000);
});

describe.each(KINDS)("crash after every statement of posting with a number issued on %s", (kind) => {
  it("burns no number: no number exists without its document, and a retry takes the number that is next", async () => {
    const post = (h: Harness, store: DataStore, seed: string) => {
      const rt = createTestRuntime({ seed });
      rt.clock.advance(1000);
      return postTestDocument(store, rt, h.world, h.world.one, { lines: [3n, 4n] });
    };
    const ref = await fresh(kind);
    const before = await restart(ref, (s) => stateOf(ref, s));
    const counted = await run(ref, null, (s) => post(ref, s, "post-run"));
    const after = await restart(ref, (s) => stateOf(ref, s));
    expect(counted.statements).toBeGreaterThan(15);
    for (let k = 1; k <= counted.statements; k += 1) {
      const h = await fresh(kind);
      const crash = await run(h, k, (s) => post(h, s, "post-run"));
      expect(crash.crashed, `statement ${String(k)}`).toBe(true);
      const outcome = await restart(h, async (s) => ({ state: await stateOf(h, s), numbers: await docNumbers(h, s), problems: await integrityOf(h, s) }));
      expect(outcome.problems, `statement ${String(k)}: integrity`).toEqual([]);
      expect([before, after], `statement ${String(k)}: wholly done or wholly absent`).toContain(outcome.state);
      expect(outcome.numbers).toEqual(outcome.state === after ? [1] : []);
      await run(h, null, (s) => post(h, s, "post-retry"));
      const final = await restart(h, async (s) => ({ numbers: await docNumbers(h, s), problems: await integrityOf(h, s) }));
      expect(final.numbers, `statement ${String(k)}: the retry takes the next number`).toEqual(outcome.state === after ? [1, 2] : [1]);
      expect(final.problems).toEqual([]);
    }
  }, 600_000);
});

describe.each(KINDS)("crash after every statement of recovering a series on %s", (kind) => {
  it("the jump of the counter and its lost_numbers entry happen together or not at all", async () => {
    const recover = (h: Harness) => (store: DataStore) =>
      recoverSeries(store, { companyId: h.world.companyId }, createTestRuntime({ seed: "recover" }), { locationId: h.world.one.locationId, deviceId: h.world.one.deviceId, docType: "TD", fiscalYearCode: "2627" }, { reason: "lost_device" });
    const read = async (h: Harness, s: DataStore) => {
      const db = s.scoped({ companyId: h.world.companyId });
      return { counter: (await db.selectFrom("number_series").select("next_number").execute()).map((r) => String(r.next_number)), lost: (await db.selectFrom("lost_numbers").select(["number_from", "number_to"]).execute()).map((r) => `${String(r.number_from)}-${String(r.number_to)}`) };
    };
    const ref = await fresh(kind);
    const counted = await run(ref, null, recover(ref));
    expect(await restart(ref, (s) => read(ref, s))).toEqual({ counter: ["101"], lost: ["1-100"] });
    for (let k = 1; k <= counted.statements; k += 1) {
      const h = await fresh(kind);
      const crash = await run(h, k, recover(h));
      expect(crash.crashed).toBe(true);
      const seen = await restart(h, (s) => read(h, s));
      expect([JSON.stringify({ counter: [], lost: [] }), JSON.stringify({ counter: ["101"], lost: ["1-100"] })], `statement ${String(k)}`).toContain(JSON.stringify(seen));
    }
  }, 300_000);
});

export type { TestRuntime };
