import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NumericError } from "./errors";
import { INT64_MAX, INT64_MIN } from "./limits";
import { fromWire, toWire } from "./wire";

describe("whole numbers on the wire (PB-18)", () => {
  it("round-trips every 64-bit value, including the extremes and values above 2^53 (property)", () => {
    fc.assert(fc.property(fc.bigInt({ min: INT64_MIN, max: INT64_MAX }), (v) => fromWire(toWire(v)) === v));
    for (const v of [0n, 1n, -1n, INT64_MAX, INT64_MIN, 9007199254740993n, -9007199254740993n]) {
      expect(fromWire(toWire(v))).toBe(v);
    }
  });

  it("a number written as JSON and read back is identical, and a plain JSON number would not be", () => {
    const v = 9007199254740993n; // 2^53 + 1
    const bundle = { qty_milli: toWire(v), amount_paisa: toWire(-v) };
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
    expect(fromWire((JSON.parse(JSON.stringify(bundle)) as typeof bundle).qty_milli)).toBe(v);
    expect(BigInt(Number(v))).not.toBe(v); // this is the loss the strings avoid
  });

  it("writes canonical decimal text", () => {
    expect(toWire(0n)).toBe("0");
    expect(toWire(-42n)).toBe("-42");
    expect(toWire(INT64_MAX)).toBe("9223372036854775807");
    expect(toWire(INT64_MIN)).toBe("-9223372036854775808");
  });

  it("refuses to write a value that is not 64-bit", () => {
    expect(() => toWire(INT64_MAX + 1n)).toThrow(/does not fit/);
    expect(() => toWire(INT64_MIN - 1n)).toThrow(NumericError);
  });

  it.each(["", " ", "01", "00", "+1", "-0", "- 1", " 1", "1 ", "1.0", "1e3", "0x10", "1,000", "--1", "١٢٣", "۱۲۳", "NaN", "null", "1\n"])("refuses the non-canonical text %j", (text) => {
    expect(() => fromWire(text)).toThrow(NumericError);
    expect(() => fromWire(text)).toThrow(/canonical/);
  });

  it("accepts canonical text and refuses 64-bit overflow with its own code", () => {
    expect(fromWire("0")).toBe(0n);
    expect(fromWire("-1")).toBe(-1n);
    expect(fromWire("10")).toBe(10n);
    expect(fromWire("9223372036854775807")).toBe(INT64_MAX);
    expect(fromWire("-9223372036854775808")).toBe(INT64_MIN);
    for (const text of ["9223372036854775808", "-9223372036854775809", "99999999999999999999999"]) {
      try {
        fromWire(text);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(NumericError);
        expect((e as NumericError).code).toBe("overflow");
        expect((e as NumericError).message).toBe(`${text} does not fit in 64 bits`);
      }
    }
  });
});
