import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { abs, add, compare, negate, sub, sum } from "./arith";
import { NumericError } from "./errors";
import { INT64_MAX, INT64_MIN } from "./limits";
import { assertInt64, micro, milli, p4, paisa, r4, SCALE, scaled } from "./types";

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof NumericError ? e.code : "other";
  }
  return undefined;
};

describe("scaled types", () => {
  it("document 06, 2.1: the decimals of each type", () => {
    expect(SCALE).toEqual({ paisa: 2, milli: 3, micro: 6, r4: 4, p4: 4 });
  });

  it("builds from a bigint, a safe integer, or canonical text", () => {
    expect(paisa(202_000_000n)).toBe(202_000_000n);
    expect(milli(10_000_000)).toBe(10_000_000n);
    expect(micro("202000000")).toBe(202_000_000n);
    expect(r4(-5)).toBe(-5n);
    expect(p4("180000")).toBe(180_000n);
    expect(scaled("paisa", 0)).toBe(0n);
  });

  it("refuses a number that is not a whole safe integer (never silently truncated)", () => {
    for (const bad of [Number("1.5"), Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)]) {
      expect(codeOf(() => paisa(bad))).toBe("not-integer");
    }
    expect(paisa(Number.MAX_SAFE_INTEGER)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("refuses text that is not canonical, and anything beyond 64 bits", () => {
    expect(codeOf(() => paisa("1.5"))).toBe("bad-wire");
    expect(codeOf(() => paisa("007"))).toBe("bad-wire");
    expect(codeOf(() => milli(INT64_MAX + 1n))).toBe("overflow");
    expect(codeOf(() => milli("9223372036854775808"))).toBe("overflow");
    expect(milli(INT64_MAX)).toBe(INT64_MAX);
    expect(milli(INT64_MIN)).toBe(INT64_MIN);
  });

  it("every refusal names the kind of value, the value, and why", () => {
    const makers = { paisa, milli, micro, r4, p4 } as const;
    for (const [kind, make] of Object.entries(makers)) {
      expect(() => make(INT64_MAX + 1n)).toThrow(`${kind} 9223372036854775808 does not fit in 64 bits`);
      expect(() => make(Number("1.5"))).toThrow(`${kind} needs a whole number, got 1.5`);
      expect(() => make(`${INT64_MIN - 1n}`)).toThrow("-9223372036854775809 does not fit in 64 bits");
    }
  });

  it("assertInt64 names what was refused", () => {
    expect(assertInt64(5n)).toBe(5n);
    expect(() => assertInt64(INT64_MAX + 1n, "the total")).toThrow(/the total 9223372036854775808 does not fit/);
    expect(() => assertInt64(INT64_MIN - 1n)).toThrow(/value -9223372036854775809/);
  });
});

describe("arithmetic of one kind of value", () => {
  it("adds, subtracts, negates and takes absolute values", () => {
    expect(add(paisa(5), paisa(7))).toBe(12n);
    expect(sub(paisa(5), paisa(7))).toBe(-2n);
    expect(negate(paisa(5))).toBe(-5n);
    expect(negate(paisa(-5))).toBe(5n);
    expect(abs(paisa(-5))).toBe(5n);
    expect(abs(paisa(5))).toBe(5n);
    expect(abs(paisa(0))).toBe(0n);
  });

  it("compares", () => {
    expect(compare(paisa(1), paisa(2))).toBe(-1);
    expect(compare(paisa(2), paisa(1))).toBe(1);
    expect(compare(paisa(2), paisa(2))).toBe(0);
  });

  it("refuses to wrap at the 64-bit edge, in every operation", () => {
    expect(add(paisa(INT64_MAX), paisa(0))).toBe(INT64_MAX);
    expect(codeOf(() => add(paisa(INT64_MAX), paisa(1)))).toBe("overflow");
    expect(codeOf(() => add(paisa(INT64_MIN), paisa(-1)))).toBe("overflow");
    expect(codeOf(() => sub(paisa(INT64_MIN), paisa(1)))).toBe("overflow");
    expect(codeOf(() => sub(paisa(INT64_MAX), paisa(-1)))).toBe("overflow");
    expect(codeOf(() => negate(paisa(INT64_MIN)))).toBe("overflow"); // -(-2^63) does not fit
    expect(codeOf(() => abs(paisa(INT64_MIN)))).toBe("overflow");
    expect(negate(paisa(INT64_MAX))).toBe(-INT64_MAX);
    expect(abs(paisa(INT64_MAX))).toBe(INT64_MAX);
  });

  it("a failed sum says which total overflowed", () => {
    expect(() => sum([paisa(INT64_MAX), paisa(1)])).toThrow("running total 9223372036854775808 does not fit in 64 bits");
    expect(() => add(paisa(INT64_MAX), paisa(1))).toThrow("result 9223372036854775808 does not fit in 64 bits");
  });

  it("sum totals many values and checks the running total at every step", () => {
    expect(sum<"paisa">([])).toBe(0n);
    expect(sum([paisa(1), paisa(2), paisa(3)])).toBe(6n);
    expect(sum([paisa(INT64_MAX), paisa(0)])).toBe(INT64_MAX);
    expect(codeOf(() => sum([paisa(INT64_MAX), paisa(1), paisa(-1)]))).toBe("overflow"); // fits at the end, not on the way
  });

  it("matches plain bigint arithmetic whenever it fits (property)", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 62n), max: 1n << 62n }), fc.bigInt({ min: -(1n << 62n), max: 1n << 62n }), (a, b) => add(paisa(a), paisa(b)) === a + b && sub(paisa(a), paisa(b)) === a - b && compare(paisa(a), paisa(b)) === (a < b ? -1 : a > b ? 1 : 0)));
  });
});
