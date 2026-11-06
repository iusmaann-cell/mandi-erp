import { describe, expect, it } from "vitest";
import { NumericError } from "./errors";
import { formatCost, formatKind, formatMilli, formatMilliFixed, formatPaisa, formatPercent, formatRate, formatScaled, groupDigits } from "./format";
import { INT64_MAX, INT64_MIN } from "./limits";

describe("groupDigits (document 07, 9.4)", () => {
  it.each([
    ["", "lakh", ""],
    ["5", "lakh", "5"],
    ["999", "lakh", "999"],
    ["1000", "lakh", "1,000"],
    ["12345", "lakh", "12,345"],
    ["123456", "lakh", "1,23,456"],
    ["1250000", "lakh", "12,50,000"],
    ["12500000", "lakh", "1,25,00,000"],
    ["125000000", "lakh", "12,50,00,000"],
    ["1234567890", "lakh", "1,23,45,67,890"],
    ["1000", "million", "1,000"],
    ["123456", "million", "123,456"],
    ["1250000", "million", "1,250,000"],
    ["12500000", "million", "12,500,000"],
    ["1234567890", "million", "1,234,567,890"],
  ] as const)("%s in %s grouping is %s", (digits, grouping, expected) => {
    expect(groupDigits(digits, grouping)).toBe(expected);
  });
});

describe("formatScaled", () => {
  it("shows the document's examples: 12,50,000.00 and 1,25,00,000.00, or in million grouping 1,250,000.00", () => {
    expect(formatScaled(125_000_000n, { scale: 2 })).toBe("12,50,000.00");
    expect(formatScaled(1_250_000_000n, { scale: 2 })).toBe("1,25,00,000.00");
    expect(formatScaled(125_000_000n, { scale: 2, grouping: "million" })).toBe("1,250,000.00");
    expect(formatScaled(125_000_000n, { scale: 2, grouping: "lakh" })).toBe("12,50,000.00");
  });

  it("lakh and crore grouping is the default and Western digits are the default", () => {
    expect(formatScaled(1_250_000_000n, { scale: 2 })).toBe(formatScaled(1_250_000_000n, { scale: 2, grouping: "lakh", digits: "western" }));
  });

  it("writes Urdu digits on request", () => {
    expect(formatScaled(125_000_000n, { scale: 2, digits: "eastern" })).toBe("۱۲,۵۰,۰۰۰.۰۰");
    expect(formatScaled(-50n, { scale: 2, digits: "eastern" })).toBe("-۰.۵۰");
  });

  it("negative values get a minus sign; zero never does, even when a small negative rounds to zero", () => {
    expect(formatScaled(-123_450n, { scale: 2 })).toBe("-1,234.50");
    expect(formatScaled(0n, { scale: 2 })).toBe("0.00");
    expect(formatScaled(-4n, { scale: 3, maxDecimals: 2 })).toBe("0.00");
    expect(formatScaled(-5n, { scale: 3, maxDecimals: 2 })).toBe("-0.01");
  });

  it("decimals: fixed by default, trimmed down to a minimum, rounded when fewer than stored", () => {
    expect(formatScaled(12_500_000n, { scale: 3 })).toBe("12,500.000");
    expect(formatScaled(12_500_000n, { scale: 3, minDecimals: 0 })).toBe("12,500");
    expect(formatScaled(12_500_500n, { scale: 3, minDecimals: 0 })).toBe("12,500.5");
    expect(formatScaled(12_500_120n, { scale: 3, minDecimals: 1 })).toBe("12,500.12");
    expect(formatScaled(12_500_000n, { scale: 3, minDecimals: 2 })).toBe("12,500.00");
    expect(formatScaled(1_234_567n, { scale: 6, maxDecimals: 2 })).toBe("1.23");
    expect(formatScaled(1_235_000n, { scale: 6, maxDecimals: 2 })).toBe("1.24"); // 1.235 -> 1.24 (half up)
    expect(formatScaled(1_234_999n, { scale: 6, maxDecimals: 2 })).toBe("1.23");
    expect(formatScaled(1_995_000n, { scale: 6, maxDecimals: 2 })).toBe("2.00"); // carries into the integer part
    expect(formatScaled(7n, { scale: 0 })).toBe("7");
    expect(formatScaled(7n, { scale: 3, maxDecimals: 0 })).toBe("0");
    expect(formatScaled(500n, { scale: 3, maxDecimals: 0 })).toBe("1");
    expect(formatScaled(499n, { scale: 3, maxDecimals: 0 })).toBe("0");
  });

  it("shows the 64-bit extremes in full", () => {
    expect(formatScaled(INT64_MAX, { scale: 2, grouping: "million" })).toBe("92,233,720,368,547,758.07");
    expect(formatScaled(INT64_MIN, { scale: 2, grouping: "million" })).toBe("-92,233,720,368,547,758.08");
  });

  it("refuses decimals that make no sense", () => {
    // each case breaks exactly one of: whole scale, whole max, whole min, 0 <= min, min <= max, max <= scale
    for (const options of [
      { scale: Number("2.5"), maxDecimals: 2, minDecimals: 2 },
      { scale: 3, maxDecimals: Number("1.5"), minDecimals: 1 },
      { scale: 3, maxDecimals: 2, minDecimals: Number("0.5") },
      { scale: 2, maxDecimals: 2, minDecimals: -1 },
      { scale: 3, maxDecimals: 1, minDecimals: 2 },
      { scale: 2, maxDecimals: 3, minDecimals: 0 },
      { scale: -1 },
      { scale: 2, maxDecimals: -1 },
    ]) {
      let caught: unknown;
      try {
        formatScaled(1n, options);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NumericError);
      expect((caught as NumericError).code).toBe("bad-argument");
      expect((caught as NumericError).message).toBe("decimals must satisfy 0 <= min <= max <= scale");
    }
  });
});

describe("how each kind of number is shown (document 07, 9.4)", () => {
  it("amounts always have two decimals", () => {
    expect(formatPaisa(202_000_000n)).toBe("20,20,000.00");
    expect(formatPaisa(5n)).toBe("0.05");
    expect(formatPaisa(-100_000n, { grouping: "million" })).toBe("-1,000.00");
  });

  it("quantities: up to three decimals, zeros dropped in lists; always three on the weighment panel", () => {
    expect(formatMilli(12_500_000n)).toBe("12,500");
    expect(formatMilli(12_500_250n, { grouping: "million" })).toBe("12,500.25");
    expect(formatMilliFixed(12_500_000n)).toBe("12,500.000");
    expect(formatMilliFixed(1n)).toBe("0.001");
  });

  it("rates: two decimals, up to four only when typed with more", () => {
    expect(formatRate(2_300_000n)).toBe("230.00");
    expect(formatRate(2_301_250n)).toBe("230.125");
    expect(formatRate(2_301_251n)).toBe("230.1251");
    expect(formatRate(2_300_100n)).toBe("230.01");
  });

  it("unit cost: six stored, two shown", () => {
    expect(formatCost(202_000_000n)).toBe("202.00");
    expect(formatCost(202_123_456n)).toBe("202.12");
    expect(formatCost(202_125_000n)).toBe("202.13");
  });

  it("percentages: up to four decimals, trailing zeros dropped", () => {
    expect(formatPercent(180_000n)).toBe("18");
    expect(formatPercent(2_500n)).toBe("0.25");
    expect(formatPercent(1n)).toBe("0.0001");
    expect(formatPercent(0n)).toBe("0");
  });

  it("formatKind picks the right style for each kind of value", () => {
    expect(formatKind("paisa", 125_000_000n)).toBe("12,50,000.00");
    expect(formatKind("milli", 12_500_000n)).toBe("12,500");
    expect(formatKind("micro", 202_123_456n)).toBe("202.12");
    expect(formatKind("r4", 2_300_000n)).toBe("230.00");
    expect(formatKind("p4", 180_000n)).toBe("18");
    expect(formatKind("paisa", 125_000_000n, { grouping: "million", digits: "eastern" })).toBe("۱,۲۵۰,۰۰۰.۰۰");
  });
});
