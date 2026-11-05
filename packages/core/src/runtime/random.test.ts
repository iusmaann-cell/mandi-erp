import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SeededRandom, Xoshiro128ss } from "./random";

const HALF = Number("0.5"); // a fraction on purpose: the source must refuse it (no float literals in this codebase)

function draw(r: { nextUint32(): number }, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(r.nextUint32());
  return out;
}

describe("Xoshiro128ss", () => {
  it("reproduces the published reference sequence for the state (1, 2, 3, 4)", () => {
    // xoshiro128** reference implementation (Blackman and Vigna, prng.di.unimi.it), first ten outputs.
    expect(draw(new Xoshiro128ss(1, 2, 3, 4), 10)).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849, 3729100597, 4258142804,
    ]);
  });

  it("does not get stuck on the all-zero state", () => {
    const r = new Xoshiro128ss(0, 0, 0, 0);
    expect(new Set(draw(r, 20)).size).toBeGreaterThan(1);
  });
});

describe("SeededRandom (TR-2)", () => {
  it("gives the same numbers for the same seed on every platform (golden values)", () => {
    // Integer operations only, so Node, Electron and the Android WebView must print these exact numbers.
    expect(draw(new SeededRandom("mandi-erp"), 6)).toEqual([4088102502, 485764952, 160956776, 3785285471, 889483266, 3919636015]);
    expect(Array.from(new SeededRandom("mandi-erp").bytes(6))).toEqual([102, 126, 171, 243, 88, 47]);
  });

  it("gives different numbers for different seeds", () => {
    expect(draw(new SeededRandom("a"), 4)).not.toEqual(draw(new SeededRandom("b"), 4));
  });

  it("remembers its seed so that it can be printed with a result (TS-8)", () => {
    expect(new SeededRandom("seed-42").seed).toBe("seed-42");
  });

  it("forks streams that are repeatable and independent of how much the parent has been used", () => {
    const a = new SeededRandom("world");
    const b = new SeededRandom("world");
    draw(b, 100); // using the parent does not change a fork
    expect(draw(a.fork("node-1"), 3)).toEqual(draw(b.fork("node-1"), 3));
    expect(draw(a.fork("node-1"), 3)).not.toEqual(draw(a.fork("node-2"), 3));
  });

  it("keeps the golden value of a fork", () => {
    expect(draw(new SeededRandom("mandi-erp").fork("node-1"), 3)).toEqual([3374417942, 3352931353, 558680030]);
  });
});

describe("nextInt and bytes", () => {
  it("stay in range for any bound and any seed (property)", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 4294967296 }), (seed, max) => {
        const r = new SeededRandom(seed);
        for (let i = 0; i < 20; i += 1) {
          const x = r.nextInt(max);
          if (!(Number.isInteger(x) && x >= 0 && x < max)) return false;
        }
        return true;
      }),
    );
  });

  it("nextInt(1) is always 0", () => {
    const r = new SeededRandom("one");
    expect(draw({ nextUint32: () => r.nextInt(1) }, 10)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("spreads values over a small range without obvious bias (6000 draws of nextInt(6))", () => {
    const r = new SeededRandom("dice");
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i += 1) {
      const face = r.nextInt(6);
      counts[face] = (counts[face] ?? 0) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(850); // expected 1000; a fair source never gets near this
    for (const c of counts) expect(c).toBeLessThan(1150);
  });

  it("rejects bounds outside 1 to 4294967296", () => {
    const r = new SeededRandom("x");
    for (const bad of [0, -1, 1 + HALF, 4294967297, Number.NaN]) {
      expect(() => r.nextInt(bad)).toThrow(RangeError);
    }
  });

  it("bytes returns exactly the length asked and is repeatable (property)", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 200 }), (seed, length) => {
        const a = new SeededRandom(seed).bytes(length);
        const b = new SeededRandom(seed).bytes(length);
        return a.length === length && a.every((v, i) => v === b[i]);
      }),
    );
  });

  it("bytes rejects a bad length", () => {
    expect(() => new SeededRandom("x").bytes(-1)).toThrow(RangeError);
    expect(() => new SeededRandom("x").bytes(2 + HALF)).toThrow(RangeError);
  });
});
