import { catalogueOf } from "@mandi/data";
import { WITH_TEST_DOCUMENTS } from "@mandi/data/testing";
import { describe, expect, it } from "vitest";
import { fromWireRow, RowError, toWireRow } from "./rows";

const catalogue = catalogueOf(WITH_TEST_DOCUMENTS);
const COMPANY = "0192f0b4-0000-7000-8000-000000000001";
const BUNDLE = "0192f0b4-0000-7000-8000-0000000000b1";
const DOC = "0192f0b4-0000-7000-8000-0000000000d1";
const LOC = "0192f0b4-0000-7000-8000-0000000000a1";
const DEV = "0192f0b4-0000-7000-8000-0000000000e1";

const record = { id: DOC, doc_type: "TD", doc_no: "TD-GA-01-2627-000001", location_id: LOC, device_id: DEV, fiscal_year_code: "2627", number_seq: 1n, doc_date: "2026-08-15", total_milli: 9223372036854775807n, created_at: "2026-08-15T09:00:00.000Z" };

describe("toWireRow", () => {
  it("writes whole numbers as decimal strings, adds company_id, and nothing else", () => {
    const row = toWireRow(catalogue, "test_documents", COMPANY, record);
    expect(row.t).toBe("test_documents");
    expect(row.v).toMatchObject({ company_id: COMPANY, number_seq: "1", total_milli: "9223372036854775807", doc_date: "2026-08-15" });
    expect(Object.keys(row.v)).not.toContain("bundle_id");
  });

  it("accepts a safe number or a canonical string for a whole-number column, and writes the same text", () => {
    const a = toWireRow(catalogue, "test_documents", COMPANY, { ...record, number_seq: 7 });
    const b = toWireRow(catalogue, "test_documents", COMPANY, { ...record, number_seq: "7" });
    expect(a.v["number_seq"]).toBe("7");
    expect(b.v["number_seq"]).toBe("7");
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["a fraction", { number_seq: Number("1.5") }, /whole number/],
    ["a number beyond 2^53", { number_seq: 2 ** 53 }, /whole number/],
    ["a bad id", { id: "x" }, /canonical|uuid/],
    ["a bad date", { doc_date: "15/08/2026" }, /date/],
    ["a bad timestamp", { created_at: "yesterday" }, /timestamp/],
    ["an unknown column", { nope: 1 }, /no column nope/],
    ["company_id given", { company_id: COMPANY }, /set by the bundle/],
    ["bundle_id given", { bundle_id: BUNDLE }, /set by the bundle/],
    ["text where a number is needed", { number_seq: "1.0" }, /canonical/],
  ])("refuses %s", (_name, change, message) => {
    expect(() => toWireRow(catalogue, "test_documents", COMPANY, { ...record, ...change })).toThrow(RowError);
    expect(() => toWireRow(catalogue, "test_documents", COMPANY, { ...record, ...change })).toThrow(message);
  });

  it("refuses a missing required column and an unknown table", () => {
    const { doc_no: _omit, ...without } = record;
    expect(() => toWireRow(catalogue, "test_documents", COMPANY, without)).toThrow(/doc_no is required/);
    expect(() => toWireRow(catalogue, "nowhere", COMPANY, record)).toThrow(/unknown table/);
  });

  it("writes JSON, booleans and enumerations in their one form", () => {
    const row = toWireRow(catalogue, "audit_events", COMPANY, { id: DOC, entity: "e", entity_id: DOC, action: "a", detail_json: { b: 1, a: [true] }, created_at: "2026-08-15T09:00:00.000Z" });
    expect(row.v["detail_json"]).toBe('{"a":[true],"b":1}');
    expect(() => toWireRow(catalogue, "audit_events", COMPANY, { id: DOC, entity: "e", entity_id: DOC, action: "a", detail_json: "{bad", created_at: "2026-08-15T09:00:00.000Z" })).toThrow();
  });
});

describe("fromWireRow", () => {
  const wire = toWireRow(catalogue, "test_documents", COMPANY, record);

  it("reads a row back to database values and application values, and sets bundle_id", () => {
    const row = fromWireRow(catalogue, wire, COMPANY, BUNDLE);
    expect(row.insert["number_seq"]).toBe(1n);
    expect(row.insert["total_milli"]).toBe(9223372036854775807n);
    expect(row.insert["bundle_id"]).toBe(BUNDLE);
    expect(row.app["number_seq"]).toBe(1n);
    expect(row.app["doc_no"]).toBe("TD-GA-01-2627-000001");
  });

  const bad = (change: Record<string, unknown>) => () => fromWireRow(catalogue, { t: "test_documents", v: { ...wire.v, ...change } as never }, COMPANY, BUNDLE);

  it("refuses a row of another company", () => {
    expect(bad({ company_id: "0192f0b4-0000-7000-8000-000000000002" })).toThrow(/another company/);
    expect(() => fromWireRow(catalogue, { t: "test_documents", v: { id: DOC } }, COMPANY, BUNDLE)).toThrow(/another company/);
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["a bundle_id in the row", { bundle_id: BUNDLE }, /set by the bundle/],
    ["an unknown column", { zz: "1" }, /no column zz/],
    ["a number that is not a canonical string", { number_seq: "007" }, /canonical/],
    ["a fraction", { number_seq: "1.5" }, /canonical/],
    ["a number out of 64-bit range", { total_milli: "9223372036854775808" }, /does not fit/],
    ["null in a required column", { doc_no: null }, /cannot be empty/],
    ["a number as a JSON number", { number_seq: 1 }, /decimal string/],
    ["an upper-case id", { id: DOC.toUpperCase() }, /lower-case uuid/],
    ["a bad date", { doc_date: "2026-8-1" }, /not a date/],
    ["a bad timestamp", { created_at: "2026-08-15 09:00:00" }, /canonical/],
  ])("refuses %s", (_n, change, message) => {
    expect(bad(change)).toThrow(RowError);
    expect(bad(change)).toThrow(message);
  });

  it("refuses a column missing from the row, a table that does not exist, and a table that is not class 1", () => {
    const { doc_no: _omit, ...partial } = wire.v;
    expect(() => fromWireRow(catalogue, { t: "test_documents", v: partial }, COMPANY, BUNDLE)).toThrow(/doc_no is required/);
    expect(() => fromWireRow(catalogue, { t: "nowhere", v: { company_id: COMPANY } }, COMPANY, BUNDLE)).toThrow(/unknown table/);
    expect(() => fromWireRow(catalogue, { t: "locations", v: { company_id: COMPANY } }, COMPANY, BUNDLE)).toThrow(/not a class 1 table/);
    expect(() => fromWireRow(catalogue, { t: "number_series", v: { company_id: COMPANY } }, COMPANY, BUNDLE)).toThrow(/only facts travel/);
  });

  it("refuses JSON that is not in canonical form, and enumerations and booleans that are wrong", () => {
    const audit = toWireRow(catalogue, "audit_events", COMPANY, { id: DOC, entity: "e", entity_id: DOC, action: "a", created_at: "2026-08-15T09:00:00.000Z" });
    const read = (change: Record<string, unknown>) => () => fromWireRow(catalogue, { t: "audit_events", v: { ...audit.v, ...change } as never }, COMPANY, BUNDLE);
    expect(read({ detail_json: '{ "a": 1 }' })).toThrow(/canonical JSON/);
    expect(read({ detail_json: "{bad" })).toThrow(/not JSON/);
    expect(read({ detail_json: '{"a":1}' })).not.toThrow();
    expect(() => fromWireRow(catalogue, { t: "bundles", v: { company_id: COMPANY } }, COMPANY, BUNDLE)).toThrow(/not a class 1/);
  });
});
