import { readFileSync, writeFileSync } from "node:fs";
import { createTestRuntime } from "@mandi/core";
import type { DataStore, DbKind } from "@mandi/data";
import { createTestDatabase, postgresTestsEnabled, startTestPostgres, WITH_TEST_DOCUMENTS, type TestPostgres } from "@mandi/data/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { receiveBundle } from "./apply";
import { parseWireText, verifyBundleChain, verifyWireText, type Bundle } from "./bundle";
import { checkIntegrity } from "./integrity";
import { buildGoldenBundles, GOLDEN_WORLD_SEED, seedSyncWorld, tableHashes, TEST_REGISTRY } from "./testing";

/**
 * TL-4, the golden bundles: the same fixed bundles applied to an empty SQLite and an empty PostgreSQL
 * must give identical tables, to the hash. The bundles and the expected hashes are files; the builder
 * is checked against them so a drift is noticed. Rewrite them on purpose with UPDATE_GOLDEN=1.
 */
const BUNDLES_FILE = new URL("../golden/bundles.ndjson", import.meta.url);
const EXPECTED_FILE = new URL("../golden/expected-hashes.json", import.meta.url);
const TABLES = ["test_documents", "test_document_lines", "number_series", "test_stock", "bundles"] as const;
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

async function applyGolden(kind: DbKind, bundles: readonly Bundle[]): Promise<{ hashes: Record<string, string>; problems: unknown[]; companyId: string }> {
  const store = (await createTestDatabase(kind, pg)).open({ migrations: WITH_TEST_DOCUMENTS });
  opened.push(store);
  await store.migrate();
  const rt = createTestRuntime({ seed: GOLDEN_WORLD_SEED });
  const world = await seedSyncWorld(store, rt);
  for (const b of bundles) {
    const outcome = await receiveBundle(store, b, { registry: TEST_REGISTRY, ids: rt.ids, nowIso: "2026-07-01T00:00:00.000Z" });
    expect(outcome, `bundle ${String(b.node_seq)} of node ${b.node_id}`).toEqual({ status: "applied" });
  }
  return { hashes: await tableHashes(store, world.companyId, TABLES), problems: await checkIntegrity(store, { companyId: world.companyId }, TEST_REGISTRY), companyId: world.companyId };
}

describe("the golden bundle files", () => {
  it("are what the builder makes (a drift is a deliberate change: UPDATE_GOLDEN=1)", async () => {
    const built = await buildGoldenBundles();
    if (process.env["UPDATE_GOLDEN"] === "1") {
      writeFileSync(BUNDLES_FILE, built.bundlesText);
      const a = await applyGolden("sqlite", built.bundles);
      writeFileSync(EXPECTED_FILE, `${JSON.stringify({ tables: a.hashes }, null, 2)}\n`);
    }
    expect(readFileSync(BUNDLES_FILE, "utf8")).toBe(built.bundlesText);
  });

  it("are all valid bundles in canonical form with the right hashes, and each node's bundles form an unbroken chain", () => {
    const lines = readFileSync(BUNDLES_FILE, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(9);
    const bundles = lines.map((l) => {
      expect(verifyWireText(l)).toMatchObject({ ok: true, problems: [] });
      return parseWireText(l);
    });
    for (const nodeId of new Set(bundles.map((b) => b.node_id))) expect(verifyBundleChain(bundles.filter((b) => b.node_id === nodeId))).toEqual([]);
    expect(new Set(bundles.map((b) => b.node_id)).size).toBe(2);
  });
});

describe.each(KINDS)("the golden bundles applied to an empty %s", (kind) => {
  it("give the pinned hash of every table, pass the integrity checks, and equal the other database (TL-4)", async () => {
    const bundles = readFileSync(BUNDLES_FILE, "utf8").trimEnd().split("\n").map(parseWireText);
    const expected = (JSON.parse(readFileSync(EXPECTED_FILE, "utf8")) as { tables: Record<string, string> }).tables;
    const result = await applyGolden(kind, bundles);
    expect(result.problems).toEqual([]);
    expect(result.hashes).toEqual(expected);
  }, 120_000);
});
