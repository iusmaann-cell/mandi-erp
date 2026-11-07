import { describe, expect, it } from "vitest";
import { DEFAULT_PADDING, fiscalYearCodeOf, formatDocNo, RECOVERY_MARGIN, seriesKeyText } from "./numbering";

describe("fiscal year of a document date (R-26: July to June)", () => {
  it.each([
    ["2026-07-01", 7, "2627"],
    ["2026-06-30", 7, "2526"],
    ["2027-06-30", 7, "2627"],
    ["2027-07-01", 7, "2728"],
    ["2026-12-31", 7, "2627"],
    ["2026-01-01", 7, "2526"],
    ["2099-07-01", 7, "9900"],
    ["2026-04-01", 4, "2627"],
    ["2026-03-31", 4, "2526"],
    ["2026-01-01", 1, "2626"],
    ["2026-12-31", 1, "2626"],
  ])("%s with the year starting in month %s is %s", (date, start, code) => {
    expect(fiscalYearCodeOf(date, start)).toBe(code);
  });
  it("defaults to a July start and refuses a date that is not a date", () => {
    expect(fiscalYearCodeOf("2026-08-15")).toBe("2627");
    for (const bad of ["2026-8-15", "15/08/2026", "", "2026-08-15T00:00:00Z"]) expect(() => fiscalYearCodeOf(bad)).toThrow(RangeError);
  });
});

describe("printed numbers (document 06, 5.1)", () => {
  it("SI-GA-02-2627-000045: six digits, and the sequence keeps growing past them", () => {
    expect(formatDocNo("SI-GA-02-2627", 45n)).toBe("SI-GA-02-2627-000045");
    expect(formatDocNo("SI-GA-02-2627", 1n)).toBe("SI-GA-02-2627-000001");
    expect(formatDocNo("SI-GA-02-2627", 999999n)).toBe("SI-GA-02-2627-999999");
    expect(formatDocNo("SI-GA-02-2627", 1000000n)).toBe("SI-GA-02-2627-1000000");
    expect(formatDocNo("X", 7n, 3)).toBe("X-007");
    expect(DEFAULT_PADDING).toBe(6);
  });
  it("the recovery margin is 100 (working default)", () => {
    expect(RECOVERY_MARGIN).toBe(100n);
  });
  it("the series key text does not depend on field order", () => {
    const a = seriesKeyText({ locationId: "l", deviceId: "d", docType: "SI", fiscalYearCode: "2627" });
    const b = seriesKeyText({ fiscalYearCode: "2627", docType: "SI", deviceId: "d", locationId: "l" });
    expect(a).toBe(b);
    expect(a).toBe('{"deviceId":"d","docType":"SI","fiscalYearCode":"2627","locationId":"l"}');
  });
});
