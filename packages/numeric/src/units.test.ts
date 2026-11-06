import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NumericError } from "./errors";
import { milli } from "./types";
import { BASE_UNIT, factor, fromBase, isExactFromBase, isExactToBase, toBase } from "./units";

describe("factor (R-2: trading units with a fixed factor)", () => {
  it("keeps whole factors and reduces fractions to lowest terms", () => {
    expect(factor(50)).toEqual({ num: 50n, den: 1n });
    expect(factor(40n)).toEqual({ num: 40n, den: 1n });
    expect(factor(37_324, 1_000)).toEqual({ num: 9_331n, den: 250n });
    expect(factor(6, 12)).toEqual({ num: 1n, den: 2n });
    expect(factor(1, 12)).toEqual({ num: 1n, den: 12n });
    expect(factor(10n ** 15n, 10n ** 15n)).toEqual({ num: 1n, den: 1n });
  });

  it("the base unit is 1/1", () => {
    expect(BASE_UNIT).toEqual({ num: 1n, den: 1n });
  });

  it("refuses zero, negative, oversized and non-whole parts", () => {
    for (const bad of [() => factor(0), () => factor(-5), () => factor(5, 0), () => factor(5, -2), () => factor(10n ** 15n + 1n), () => factor(1, 10n ** 15n + 1n)]) {
      expect(bad).toThrow(NumericError);
    }
    expect(() => factor(0)).toThrow("a unit factor must be a positive fraction, got 0/1");
    expect(() => factor(5, -2)).toThrow("a unit factor must be a positive fraction, got 5/-2");
    expect(() => factor(Number("1.5"))).toThrow("a unit factor part must be a whole number, got 1.5");
    expect(() => factor(1, Number("0.5"))).toThrow("a unit factor part must be a whole number, got 0.5");
    for (const bad of [() => factor(Number("1.5")), () => factor(1, Number("0.5"))]) {
      try {
        bad();
      } catch (e) {
        expect((e as NumericError).code).toBe("not-integer");
      }
    }
    try {
      factor(0);
    } catch (e) {
      expect((e as NumericError).code).toBe("bad-factor");
    }
  });
});

describe("conversion to and from the base unit (R-3, PB-10)", () => {
  it("3.5 bags of 50 kg are 175 kg; 175 kg are 3.5 bags", () => {
    const bag = factor(50);
    expect(toBase(milli(3_500), bag)).toBe(175_000n);
    expect(fromBase(milli(175_000), bag)).toBe(3_500n);
  });

  it("maunds of 40 kg and cartons of 12 pieces", () => {
    expect(toBase(milli(2_000), factor(40))).toBe(80_000n);
    expect(toBase(milli(10_000), factor(12))).toBe(120_000n);
    expect(fromBase(milli(30_000), factor(12))).toBe(2_500n);
  });

  it("an awkward factor rounds to the nearest milli and says so", () => {
    const third = factor(1, 3);
    expect(toBase(milli(1_000), third)).toBe(333n); // 333.33
    expect(isExactToBase(milli(1_000), third)).toBe(false);
    expect(toBase(milli(3_000), third)).toBe(1_000n);
    expect(isExactToBase(milli(3_000), third)).toBe(true);
    expect(toBase(milli(2_000), third)).toBe(667n); // 666.67
    expect(fromBase(milli(1_000), third)).toBe(3_000n);
    expect(isExactFromBase(milli(1_000), third)).toBe(true);
    expect(isExactFromBase(milli(1_000), factor(7))).toBe(false);
  });

  it("negative quantities mirror positive ones", () => {
    expect(toBase(milli(-3_500), factor(50))).toBe(-175_000n);
    expect(toBase(milli(-1_000), factor(1, 3))).toBe(-333n);
    expect(fromBase(milli(-175_000), factor(50))).toBe(-3_500n);
  });

  it("PB-10: when the factor divides it, converting there and back returns the same quantity (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 40n), max: 1n << 40n }), fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 60 }), (entry, num, den) => {
        const f = factor(num, den);
        const exactThere = isExactToBase(milli(entry), f);
        const base = toBase(milli(entry), f);
        if (!exactThere) return true;
        return isExactFromBase(base, f) && fromBase(base, f) === entry;
      }),
    );
  });

  it("PB-10: otherwise no milli is created or lost beyond half a milli of rounding (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 40n), max: 1n << 40n }), fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 }), (entry, num, den) => {
        const f = factor(num, den);
        const base = toBase(milli(entry), f);
        const errorTimesDen = base * f.den - entry * f.num; // exact error, scaled by den
        const back = fromBase(base, f);
        const backError = back * f.num - base * f.den; // the same on the way back, scaled by num
        const abs = (v: bigint): bigint => (v < 0n ? -v : v);
        return abs(errorTimesDen) * 2n <= f.den && abs(backError) * 2n <= f.num;
      }),
    );
  });

  it("is exact exactly when the division leaves no remainder (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -100_000n, max: 100_000n }), fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 30 }), (entry, num, den) => {
        const f = factor(num, den);
        const exact = (entry * f.num) % f.den === 0n;
        return isExactToBase(milli(entry), f) === exact && (!exact || toBase(milli(entry), f) * f.den === entry * f.num);
      }),
    );
  });
});
