import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NumericError } from "./errors";
import { formatScaled } from "./format";
import { costOf, percentOf, unitCostMicro } from "./money";
import { divRound } from "./round";
import { micro, milli, p4, paisa } from "./types";
import { factor, toBase } from "./units";

/** An independent statement of the rule: floor((2n + d) / 2d) for n >= 0, mirrored for negatives. */
function oracle(n: bigint, d: bigint): bigint {
  const sign = (n < 0n ? -1n : 1n) * (d < 0n ? -1n : 1n);
  const a = n < 0n ? -n : n;
  const b = d < 0n ? -d : d;
  return sign * ((2n * a + b) / (2n * b));
}

describe("divRound (N-1: rounding at every halfway case)", () => {
  it.each([
    [5n, 2n, 3n], // 2.5 -> 3
    [3n, 2n, 2n], // 1.5 -> 2
    [1n, 2n, 1n], // 0.5 -> 1
    [4n, 10n, 0n], // 0.4 -> 0
    [49n, 100n, 0n], // 0.49 -> 0
    [4999n, 10000n, 0n], // 0.4999 -> 0
    [5000n, 10000n, 1n], // 0.5 -> 1
    [5001n, 10000n, 1n],
    [10n, 5n, 2n], // exact
    [0n, 7n, 0n],
    [-5n, 2n, -3n], // -2.5 -> -3 (half away from zero)
    [-3n, 2n, -2n],
    [-1n, 2n, -1n],
    [-4999n, 10000n, 0n],
    [-5000n, 10000n, -1n],
    [-10n, 5n, -2n],
    [5n, -2n, -3n], // a negative divisor behaves the same
    [-5n, -2n, 3n],
    [1n, 3n, 0n],
    [2n, 3n, 1n],
    [-1n, 3n, 0n],
    [-2n, 3n, -1n],
  ])("%s / %s gives %s", (n, d, expected) => {
    expect(divRound(n, d)).toBe(expected);
  });

  it("refuses division by zero, with its own code and message", () => {
    let caught: unknown;
    try {
      divRound(1n, 0n);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NumericError);
    expect((caught as NumericError).code).toBe("bad-argument");
    expect((caught as NumericError).message).toBe("division by zero");
  });

  it("agrees with the independent statement of the rule (property, 64-bit and far beyond)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 200n), max: 1n << 200n }), fc.bigInt({ min: 1n, max: 1n << 100n }), fc.boolean(), (n, d, flip) => {
        const divisor = flip ? -d : d;
        return divRound(n, divisor) === oracle(n, divisor);
      }),
    );
  });

  it("rounding a negative is the negative of rounding the positive (so a reversal offsets to the paisa)", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 1n << 120n }), fc.bigInt({ min: 1n, max: 1n << 60n }), (n, d) => divRound(-n, d) === -divRound(n, d)));
  });

  it("is within half a unit of the exact quotient (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 100n), max: 1n << 100n }), fc.bigInt({ min: 1n, max: 1n << 50n }), (n, d) => {
        const r = divRound(n, d);
        const diff = (r * d - n) * 2n;
        return (diff < 0n ? -diff : diff) <= d;
      }),
    );
  });
});

describe("N-1 at each scale: x.5 rounds up, x.4999 rounds down, negatives mirror", () => {
  it("paisa (cost of a quantity)", () => {
    expect(costOf(milli(1), micro(5_000_000))).toBe(1n); // 0.5 paisa
    expect(costOf(milli(1), micro(4_999_999))).toBe(0n); // 0.4999999 paisa
    expect(costOf(milli(-1), micro(5_000_000))).toBe(-1n);
    expect(costOf(milli(-1), micro(4_999_999))).toBe(0n);
    expect(costOf(milli(3), micro(5_000_000))).toBe(2n); // 1.5 paisa
  });

  it("milli (a quantity converted to base units)", () => {
    const half = factor(1, 2);
    expect(toBase(milli(1), half)).toBe(1n); // 0.5 milli
    expect(toBase(milli(3), half)).toBe(2n); // 1.5 milli
    expect(toBase(milli(-1), half)).toBe(-1n);
    expect(toBase(milli(-3), half)).toBe(-2n);
    expect(toBase(milli(2), half)).toBe(1n); // exact
  });

  it("micro (a unit cost from a total)", () => {
    expect(unitCostMicro(paisa(1), milli(20_000_000))).toBe(1n); // 0.5 micro
    expect(unitCostMicro(paisa(1), milli(20_000_001))).toBe(0n); // just under
    expect(unitCostMicro(paisa(-1), milli(20_000_000))).toBe(-1n);
    expect(unitCostMicro(paisa(3), milli(20_000_000))).toBe(2n); // 1.5 micro
  });

  it("p4 (a percentage of an amount)", () => {
    expect(percentOf(paisa(1), p4(500_000))).toBe(1n); // 50% of 1 paisa = 0.5
    expect(percentOf(paisa(1), p4(499_999))).toBe(0n);
    expect(percentOf(paisa(-1), p4(500_000))).toBe(-1n);
    expect(percentOf(paisa(3), p4(500_000))).toBe(2n); // 1.5
  });

  it("r4 (a rate shown to fewer decimals) and the other scales on display", () => {
    expect(formatScaled(50n, { scale: 4, maxDecimals: 2 })).toBe("0.01"); // 0.0050 -> 0.01
    expect(formatScaled(49n, { scale: 4, maxDecimals: 2 })).toBe("0.00"); // 0.0049 -> 0.00
    expect(formatScaled(-50n, { scale: 4, maxDecimals: 2 })).toBe("-0.01");
    expect(formatScaled(-49n, { scale: 4, maxDecimals: 2 })).toBe("0.00"); // rounds to zero: no minus sign
    expect(formatScaled(5n, { scale: 3, maxDecimals: 2 })).toBe("0.01"); // 0.005 -> 0.01
    expect(formatScaled(4n, { scale: 3, maxDecimals: 2 })).toBe("0.00");
  });
});
