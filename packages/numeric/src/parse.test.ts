import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type DigitMode, formatScaled, type Grouping } from "./format";
import { INT64_MAX, INT64_MIN } from "./limits";
import { parseScaled, type ParseErrorCode } from "./parse";

const ok = (text: string, scale: number, allowNegative = false) => {
  const r = parseScaled(text, { scale, allowNegative });
  return r.ok ? r.value : r.code;
};

describe("parseScaled: typed input (N-6)", () => {
  it.each([
    ["125000.5", 2, 12_500_050n],
    ["1,25,000.50", 2, 12_500_050n], // lakh grouping
    ["1,250,000.50", 2, 125_000_050n], // million grouping
    ["12,50,000", 2, 125_000_000n],
    ["1,25,00,000.00", 2, 1_250_000_000n],
    ["1,000", 2, 100_000n], // fits both groupings
    ["100,000", 2, 10_000_000n],
    ["10,000", 3, 10_000_000n],
    ["0", 2, 0n],
    ["0.5", 2, 50n],
    [".5", 2, 50n],
    ["5.", 2, 500n],
    ["007", 2, 700n],
    ["12", 0, 12n],
    ["12.000", 0, 12n],
    ["1.500", 3, 1_500n],
    ["1.2500", 2, 125n], // extra digits are zeros
    ["0.000001", 6, 1n],
  ] as [string, number, bigint][])("%s at scale %s is %s", (text, scale, expected) => {
    expect(ok(text, scale)).toBe(expected);
  });

  it("reads Urdu digits, Arabic-Indic digits and separators, direction marks and spaces", () => {
    expect(ok("۱,۲۵,۰۰۰.۵۰", 2)).toBe(12_500_050n);
    expect(ok("١٢٥٠٠٠٫٥", 2)).toBe(12_500_050n);
    expect(ok("١٬٢٥٬٠٠٠", 2)).toBe(12_500_000n);
    expect(ok("\u200f۱۲۵\u200e", 2)).toBe(12_500n);
    expect(ok("\u061c125", 2)).toBe(12_500n);
    expect(ok("  125  ", 2)).toBe(12_500n);
  });

  it("negative input: refused unless the field may hold it", () => {
    expect(ok("-5", 2)).toBe("negative-not-allowed");
    expect(ok("-5", 2, true)).toBe(-500n);
    expect(ok("\u22125.25", 2, true)).toBe(-525n);
    expect(ok("-0", 2)).toBe("negative-not-allowed");
    expect(ok("-0", 2, true)).toBe(0n);
    expect(ok("-1,25,000.50", 2, true)).toBe(-12_500_050n);
  });

  it.each<[string, ParseErrorCode]>([
    ["", "empty"],
    ["   ", "empty"],
    ["-", "empty"],
    ["\u200f", "empty"],
    ["+5", "bad-sign"],
    ["--5", "bad-sign"],
    ["-+5", "bad-sign"],
    ["- 5", "invalid-character"],
    ["1.2.3", "bad-decimal-point"],
    ["1..2", "bad-decimal-point"],
    ["12a", "invalid-character"],
    ["1 250", "invalid-character"],
    ["1e3", "invalid-character"],
    [".", "invalid-character"],
    ["١٢٣x", "invalid-character"],
    [",", "bad-grouping"],
    [",5", "bad-grouping"],
    ["1,2,3", "bad-grouping"],
    ["12,34", "bad-grouping"], // neither lakh nor million
    ["125,5", "bad-grouping"], // a European decimal comma: refused, never guessed
    ["1,25,0000", "bad-grouping"],
    ["1,2500", "bad-grouping"],
    ["123,45,000", "bad-grouping"],
    ["0,500", "bad-grouping"], // could be a European 0.5
    ["1.5,0", "bad-grouping"],
    ["1.234", "too-many-decimals"],
  ])("refuses %j with %s", (text, code) => {
    expect(ok(text, 2, true)).toBe(code);
  });

  it("refuses more decimals than the field holds, per scale; extra zeros are harmless", () => {
    expect(ok("1.2345", 3)).toBe("too-many-decimals");
    expect(ok("1.2340", 3)).toBe(1_234n);
    expect(ok("1.0001", 3)).toBe("too-many-decimals");
    expect(ok("1.5", 0)).toBe("too-many-decimals");
    expect(ok("0.0000001", 6)).toBe("too-many-decimals");
    expect(ok("1.1234567", 6)).toBe("too-many-decimals");
  });

  it("64-bit limits: the edges are accepted, one beyond is refused", () => {
    expect(ok("92233720368547758.07", 2)).toBe(INT64_MAX);
    expect(ok("92233720368547758.08", 2)).toBe("out-of-range");
    expect(ok("-92233720368547758.08", 2, true)).toBe(INT64_MIN);
    expect(ok("-92233720368547758.09", 2, true)).toBe("out-of-range");
    expect(ok("99999999999999999999999", 2)).toBe("out-of-range");
  });

  it("PB-19: formatting with lakh or million grouping, in either digit mode, and parsing back returns the same number (property)", () => {
    const grouping = fc.constantFrom<Grouping>("lakh", "million");
    const digits = fc.constantFrom<DigitMode>("western", "eastern");
    fc.assert(
      fc.property(fc.bigInt({ min: INT64_MIN, max: INT64_MAX }), fc.integer({ min: 0, max: 6 }), grouping, digits, (v, scale, g, d) => {
        const text = formatScaled(v, { scale, grouping: g, digits: d });
        const back = parseScaled(text, { scale, allowNegative: true });
        return back.ok && back.value === v;
      }),
    );
  });

  it("never produces a value from text it should have refused (property: whatever parses, formats back to an equal number)", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(..."0123456789,.-+ x\u200f۱٢".split("")), maxLength: 14 }), fc.integer({ min: 0, max: 6 }), (text, scale) => {
        const r = parseScaled(text, { scale, allowNegative: true });
        if (!r.ok) return true;
        const again = parseScaled(formatScaled(r.value, { scale }), { scale, allowNegative: true });
        return again.ok && again.value === r.value;
      }),
      { numRuns: 2000 },
    );
  });
});
