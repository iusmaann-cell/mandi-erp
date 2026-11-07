import { createTestRuntime } from "@mandi/core";
import { createTestDatabase, WITH_TEST_DOCUMENTS } from "@mandi/data/testing";
import { INT64_MAX } from "@mandi/numeric";
import { toWireText, type Bundle } from "../bundle";
import { postTestDocument, seedSyncWorld, type SyncWorld } from "./index";

/**
 * The golden bundles (document 06, section 13; document 09, TL-4): a fixed list of bundles, built by
 * a fixed scenario, stored as files in packages/sync/golden. The contract suite applies the files, not
 * the builder's output, to an empty SQLite and an empty PostgreSQL and compares a hash of every table.
 * A change to the bundle format or to a rule shows up as a changed file (run the tests with
 * UPDATE_GOLDEN=1 to rewrite them on purpose, and read the diff).
 */
export const GOLDEN_WORLD_SEED = "golden-world";

export interface GoldenSet {
  readonly bundles: readonly Bundle[];
  /** Text of the bundles file: one canonical bundle per line. */
  readonly bundlesText: string;
}

export async function buildGoldenBundles(): Promise<GoldenSet> {
  const database = await createTestDatabase("sqlite");
  const store = database.open({ migrations: WITH_TEST_DOCUMENTS });
  try {
    await store.migrate();
    const world: SyncWorld = await seedSyncWorld(store, createTestRuntime({ seed: GOLDEN_WORLD_SEED }));
    const rt = createTestRuntime({ seed: "golden-scenario" });
    const post = async (place: "one" | "two", lines: readonly bigint[], extra: { docDate?: string; deviceId?: string } = {}) => {
      rt.clock.advance(60_000);
      return (await postTestDocument(store, rt, world, world[place], { lines, ...extra })).bundle;
    };
    const bundles: Bundle[] = [
      await post("two", [INT64_MAX]), // the 64-bit edge, in a fact and in a projection
      await post("one", [5000n, 2500n]),
      await post("two", [-INT64_MAX]), // a return that brings the stock back to zero
      await post("two", [1n]),
      await post("one", [7n, 7n, 7n], { docDate: "2027-07-02", deviceId: world.oneSecondDevice }), // another device, the next fiscal year
      await post("one", []), // a document with no lines
      await post("two", [123_456_789_012_345n], { docDate: "2026-06-30" }), // the last day of the previous fiscal year
      await post("one", [1n]),
      await post("two", [2n, 3n]),
    ];
    return { bundles, bundlesText: `${bundles.map(toWireText).join("\n")}\n` };
  } finally {
    await store.close();
  }
}
