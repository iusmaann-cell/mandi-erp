import { describe, expect, it } from "vitest";
import { normalizeDigits, toEasternDigits } from "./digits";

describe("digit modes (document 07, 9.3)", () => {
  it("writes Western digits as Urdu digits and leaves everything else alone", () => {
    expect(toEasternDigits("0123456789")).toBe("۰۱۲۳۴۵۶۷۸۹");
    expect(toEasternDigits("12,50,000.50")).toBe("۱۲,۵۰,۰۰۰.۵۰");
    expect(toEasternDigits("-abc")).toBe("-abc");
    expect(toEasternDigits("")).toBe("");
  });

  it("reads Urdu digits, Arabic-Indic digits and the Arabic separators as Western text", () => {
    expect(normalizeDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normalizeDigits("١٢٥٠٠٠٫٥٠")).toBe("125000.50");
    expect(normalizeDigits("١٬٢٥٬٠٠٠")).toBe("1,25,000");
    expect(normalizeDigits("\u22125")).toBe("-5");
    expect(normalizeDigits("12,50.0 x")).toBe("12,50.0 x");
  });

  it("is the exact inverse of toEasternDigits on digits", () => {
    for (let n = 0; n < 10; n += 1) {
      expect(normalizeDigits(toEasternDigits(String(n)))).toBe(String(n));
    }
  });
});
