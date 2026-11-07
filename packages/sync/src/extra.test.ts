import { createTestRuntime, type TestRuntime } from "@mandi/core";
import { catalogueOf, withApplyGuard, type DataStore, type DbKind } from "@mandi/data";
import { createTestDatabase, postgresTestsEnabled, startTestPostgres, WITH_TEST_DOCUMENTS, type TestPostgres } from "@mandi/data/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorBundle } from "./author";
import { checkIntegrity } from "./integrity";
import { NumberIssuer } from "./numbering";
import { fromWireRow, RowError, toWireRow } from "./rows";
import { postTestDocument, seedSyncWorld, TEST_REGISTRY, type SyncWorld } from "./testing";

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

async function makeNode(kind: DbKind): Promise<{ store: DataStore; rt: TestRuntime; world: SyncWorld }> {
  const store = (await createTestDatabase(kind, pg)).open({ migrations: WITH_TEST_DOCUMENTS });
  opened.push(store);
  await store.migrate();
  const rt = createTestRuntime({ seed: "sync-extra" });
  return { store, rt, world: await seedSyncWorld(store, rt) };
}

const catalogue = catalogueOf(WITH_TEST_DOCUMENTS);
const COMPANY = "0192f0b4-0000-7000-8000-000000000001";
const ID = "0192f0b4-0000-7000-8000-0000000000d1";
const TS = "2026-08-15T09:00:00.000Z";
const audit = { id: ID, entity: "e", entity_id: ID, action: "a", created_at: TS };

describe("rows of every column type (document 05, section 7.1)", () => {
  it("writes booleans, enumerations, text and JSON objects, and null for an optional column", () => {
    const row = toWireRow(catalogue, "audit_events", COMPANY, { ...audit, user_id: null, detail_json: { z: 1, a: [true, null] } });
    expect(row.v).toMatchObject({ user_id: null, detail_json: '{"a":[true,null],"z":1}', entity: "e" });
    expect(() => toWireRow(catalogue, "audit_events", COMPANY, { ...audit, entity: 5 })).toThrow(/must be text/);
    expect(() => toWireRow(catalogue, "audit_events", COMPANY, { ...audit, id: null })).toThrow(/required/);
  });

  it("refuses a wrong boolean and an enumeration value that is not allowed", () => {
    const locations = { id: ID, code: "GD", name_en: "x", name_ur: "x", kind: "godown", authority_kind: "site_node", updated_at: TS };
    // locations is not a bundle table, but toWireRow converts any catalogue table (the apply step is what refuses non-facts)
    expect(toWireRow(catalogue, "locations", COMPANY, { ...locations, is_active: true }).v["is_active"]).toBe(true);
    expect(() => toWireRow(catalogue, "locations", COMPANY, { ...locations, is_active: "yes" })).toThrow(/true or false/);
    expect(() => toWireRow(catalogue, "locations", COMPANY, { ...locations, kind: "palace" })).toThrow(/not one of/);
    expect(() => toWireRow(catalogue, "locations", COMPANY, { ...locations, kind: 5 })).toThrow(/not one of/);
  });

  it("reads null for an optional column, and refuses wrong kinds of value on the wire", () => {
    const wire = toWireRow(catalogue, "audit_events", COMPANY, { ...audit, user_id: null });
    expect(fromWireRow(catalogue, wire, COMPANY, ID).insert["user_id"]).toBeNull();
    const read = (change: Record<string, unknown>) => () => fromWireRow(catalogue, { t: "audit_events", v: { ...wire.v, ...change } as never }, COMPANY, ID);
    expect(read({ entity: 5 })).toThrow(RowError);
    expect(read({ detail_json: 5 })).toThrow(/JSON text/);
    expect(read({ entity_id: 5 })).toThrow(RowError);
    expect(read({ created_at: true })).toThrow(RowError);
  });
});

describe.each(KINDS)("author, numbering and integrity corners on %s", (kind) => {
  it("authors a system bundle that belongs to no location (epoch 1), and refuses an unknown location", async () => {
    const n = await makeNode(kind);
    await n.store.transaction({ companyId: n.world.companyId }, async (tx) => {
      const b = await authorBundle(tx, n.rt, { locationId: null, nodeId: n.world.one.nodeId, kind: "system", rows: [] });
      expect(b).toMatchObject({ location_id: null, epoch: 1, node_seq: 1, kind: "system" });
      await expect(authorBundle(tx, n.rt, { locationId: "0192f0b4-0000-7000-8000-0000000000aa", nodeId: n.world.one.nodeId, kind: "document", rows: [] })).rejects.toThrow(/unknown location/);
    });
  });

  it("the number issuer refuses an unknown location or device", async () => {
    const n = await makeNode(kind);
    await n.store.transaction({ companyId: n.world.companyId }, async (tx) => {
      const issuer = new NumberIssuer(tx);
      const good = { locationId: n.world.one.locationId, deviceId: n.world.one.deviceId, docType: "TD", fiscalYearCode: "2627" };
      await expect(issuer.issue({ ...good, locationId: "0192f0b4-0000-7000-8000-0000000000aa" })).rejects.toThrow(/unknown location/);
      await expect(issuer.issue({ ...good, deviceId: "0192f0b4-0000-7000-8000-0000000000bb" })).rejects.toThrow(/unknown device/);
      expect((await issuer.issue(good)).docNo).toBe("TD-GA-01-2627-000001");
    });
  });

  const guarded = (n: { store: DataStore; world: SyncWorld }, work: (tx: Parameters<Parameters<DataStore["transaction"]>[1]>[0]) => Promise<unknown>) =>
    n.store.transaction({ companyId: n.world.companyId }, (tx) => withApplyGuard(tx.scoped, () => work(tx)));
  const problems = async (n: { store: DataStore; world: SyncWorld }) => (await checkIntegrity(n.store, { companyId: n.world.companyId }, TEST_REGISTRY)).map((p) => p.check);

  it("reports a document series without a counter, a counter ahead of its documents with nothing to explain it, and a node with bundles but no chain head", async () => {
    const n = await makeNode(kind);
    await postTestDocument(n.store, n.rt, n.world, n.world.one, { lines: [1n] });
    expect(await problems(n)).toEqual([]);
    await guarded(n, (tx) => tx.scoped.updateTable("number_series").set({ next_number: 50n }).execute());
    expect(await problems(n)).toContain("number_counter"); // ahead, and no lost_numbers entry
    await guarded(n, (tx) => tx.scoped.deleteFrom("number_series").execute());
    expect(await problems(n)).toContain("orphan_number");
    await guarded(n, (tx) => tx.installation.deleteFrom("node_chain_heads").execute());
    expect(await problems(n)).toContain("chain_head");
  });

  it("reports an apply guard left open, and a chain head behind its newest bundle", async () => {
    const n = await makeNode(kind);
    await postTestDocument(n.store, n.rt, n.world, n.world.one, { lines: [1n] });
    await postTestDocument(n.store, n.rt, n.world, n.world.one, { lines: [2n] });
    await n.store.transaction({ companyId: n.world.companyId }, async (tx) => {
      await tx.installation.updateTable("apply_guard").set({ is_open: true }).execute();
    });
    expect(await problems(n)).toContain("guard_open");
    await n.store.transaction({ companyId: n.world.companyId }, async (tx) => {
      await tx.installation.updateTable("apply_guard").set({ is_open: false }).execute();
    });
    await guarded(n, (tx) => tx.installation.updateTable("node_chain_heads").set({ last_seq: 1n }).execute());
    expect(await problems(n)).toContain("chain_head");
  });
});
