import { describe, expect, it } from "vitest";
import { type DigestRandom, runNumericDigest } from "./digest";

/** A tiny repeatable source (xorshift32) so these tests need nothing from other packages. */
class TestRandom implements DigestRandom {
  #state: number;
  constructor(seed: number) {
    this.#state = seed >>> 0 || 1;
  }
  nextUint32(): number {
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state;
  }
  nextInt(maxExclusive: number): number {
    return this.nextUint32() % maxExclusive;
  }
}

describe("N-3 digest harness", () => {
  it("is repeatable: the same source and count give the same digest", () => {
    const a = runNumericDigest(new TestRandom(7), 2_000);
    const b = runNumericDigest(new TestRandom(7), 2_000);
    expect(a).toEqual(b);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the seed or the count changes", () => {
    const base = runNumericDigest(new TestRandom(7), 500).digest;
    expect(runNumericDigest(new TestRandom(8), 500).digest).not.toBe(base);
    expect(runNumericDigest(new TestRandom(7), 501).digest).not.toBe(base);
  });

  it("hashes nothing for no operations (the SHA-256 of empty input)", () => {
    expect(runNumericDigest(new TestRandom(7), 0)).toEqual({
      digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      operations: 0,
      refusals: 0,
    });
  });

  it("reports the number of operations and counts refusals (overflow and the like are results too)", () => {
    const r = runNumericDigest(new TestRandom(7), 5_000);
    expect(r.operations).toBe(5_000);
    expect(r.refusals).toBeGreaterThan(100);
    expect(r.refusals).toBeLessThan(2_500);
  });

  it("golden digest of a fixed run: any change to any rule it exercises changes this value", () => {
    // A regression pin, not a proof of correctness: the correctness of each rule is proved by the oracle tests
    // in the other files. This value exists so that a difference between platforms or versions cannot hide.
    expect(runNumericDigest(new TestRandom(12345), 3_000)).toEqual({
      digest: "525238c7e9eb954cd1e27d49694a601f3234c4a64e3993c750122bc088eb23d8",
      operations: 3_000,
      refusals: 214,
    });
  });
});
