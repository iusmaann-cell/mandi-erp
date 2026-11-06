import { runNumericDigest } from "@mandi/numeric";
import { describe, expect, it } from "vitest";
import { SeededRandom } from "./runtime/random";

/**
 * N-3, the layer 0 gate (document 09, 6.1): "a fixed list of 100,000 seeded operations is run in Node,
 * in Electron, and inside the Android WebView; the hash of all results must be identical."
 * This is the Node run. BC-10 runs the same call in the Android WebView and compares the digest;
 * the Electron run joins at BC-13. The numbers below are what every platform must print.
 */
const GATE = { seed: "n3-golden", operations: 100_000, digest: "3e15d93dda3f4d03a1d54cefea176587de9ee3829baa0305646cbb4182a2c78c", refusals: 7427 };

describe("N-3: the same answer everywhere (Node)", () => {
  it("100,000 seeded operations give the agreed digest", () => {
    const result = runNumericDigest(new SeededRandom(GATE.seed), GATE.operations);
    expect(result).toEqual({ digest: GATE.digest, operations: GATE.operations, refusals: GATE.refusals });
  });
});
