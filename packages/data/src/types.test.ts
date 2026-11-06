import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INT64_MAX, INT64_MIN } from "@mandi/numeric";
import { canonicalJson, CANONICAL_TIMESTAMP, decodeValue, encodeValue, FORBIDDEN_PHYSICAL_TYPES, normalizeTimestamp, PHYSICAL_TYPE } from "./types";

describe("physical type map (document 06, 2.2)", () => {
  it("is the table of the document, for both databases", () => {
    expect(PHYSICAL_TYPE.sqlite).toEqual({ id: "TEXT", int64: "INTEGER", text: "TEXT", date: "TEXT", ts: "TEXT", bool: "INTEGER", json: "TEXT", enum: "TEXT" });
    expect(PHYSICAL_TYPE.postgres).toEqual({ id: "uuid", int64: "bigint", text: "text", date: "date", ts: "timestamptz", bool: "boolean", json: "jsonb", enum: "text" });
  });

  it("no mapped type is a floating-point or decimal type (D-6)", () => {
    for (const kind of ["sqlite", "postgres"] as const) {
      for (const type of Object.values(PHYSICAL_TYPE[kind])) expect(FORBIDDEN_PHYSICAL_TYPES.test(type)).toBe(false);
    }
  });

  it.each(["real", "REAL", "float", "double precision", "numeric", "decimal", "money", "serial", "float8"])("the forbidden-type check catches %s", (type) => {
    expect(FORBIDDEN_PHYSICAL_TYPES.test(type)).toBe(true);
  });
  it.each(["integer", "bigint", "text", "uuid", "timestamp with time zone", "boolean", "jsonb", "date"])("and leaves %s alone", (type) => {
    expect(FORBIDDEN_PHYSICAL_TYPES.test(type)).toBe(false);
  });
});

describe("normalizeTimestamp", () => {
  it.each([
    ["2026-07-01T12:34:56.789Z", "2026-07-01T12:34:56.789Z"],
    ["2026-07-01 12:34:56.789+00", "2026-07-01T12:34:56.789Z"],
    ["2026-07-01 12:34:56.789123+00", "2026-07-01T12:34:56.789Z"], // PostgreSQL keeps microseconds; we keep milliseconds
    ["2026-07-01 12:34:56+00", "2026-07-01T12:34:56.000Z"],
    ["2026-07-01 12:34:56", "2026-07-01T12:34:56.000Z"],
    ["2026-07-01T12:34:56.5Z", "2026-07-01T12:34:56.500Z"],
    ["2026-07-01 17:34:56.789+05", "2026-07-01T12:34:56.789Z"], // Pakistan time to UTC
    ["2026-07-01 17:34:56.789+05:00", "2026-07-01T12:34:56.789Z"],
    ["2026-07-01 08:04:56.789-04:30", "2026-07-01T12:34:56.789Z"],
    ["2026-07-01 12:34:56.789+0000", "2026-07-01T12:34:56.789Z"],
    ["2026-07-01 12:34:56.789+0530", "2026-07-01T07:04:56.789Z"],
  ])("%s gives %s", (input, expected) => {
    expect(normalizeTimestamp(input)).toBe(expected);
    expect(CANONICAL_TIMESTAMP.test(normalizeTimestamp(input))).toBe(true);
  });

  it("refuses text that is not a timestamp", () => {
    for (const bad of ["", "yesterday", "2026-07-01", "2026-13-01T00:00:00Z extra", "12:00:00"]) expect(() => normalizeTimestamp(bad)).toThrow(TypeError);
  });

  it("the canonical form is a fixed point (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (ms) => {
        const iso = new Date(ms).toISOString();
        return normalizeTimestamp(iso) === iso && CANONICAL_TIMESTAMP.test(iso);
      }),
    );
  });
});

describe("decodeValue and encodeValue", () => {
  it("whole numbers become bigint from any driver form, and null stays null", () => {
    expect(decodeValue("int64", 5n)).toBe(5n);
    expect(decodeValue("int64", 5)).toBe(5n);
    expect(decodeValue("int64", "9223372036854775807")).toBe(INT64_MAX);
    expect(decodeValue("int64", null)).toBeNull();
    expect(decodeValue("int64", undefined)).toBeNull();
    expect(() => decodeValue("int64", true)).toThrow(TypeError);
  });

  it("flags are read from SQLite integers and PostgreSQL booleans alike", () => {
    expect(decodeValue("bool", 1n)).toBe(true);
    expect(decodeValue("bool", 0n)).toBe(false);
    expect(decodeValue("bool", 1)).toBe(true);
    expect(decodeValue("bool", 0)).toBe(false);
    expect(decodeValue("bool", true)).toBe(true);
    expect(decodeValue("bool", false)).toBe(false);
    expect(() => decodeValue("bool", 2n)).toThrow(TypeError);
  });

  it("timestamps, ids, dates, text, enums and JSON", () => {
    expect(decodeValue("ts", "2026-07-01 12:34:56.789+00")).toBe("2026-07-01T12:34:56.789Z");
    expect(decodeValue("ts", new Date("2026-07-01T12:34:56.789Z"))).toBe("2026-07-01T12:34:56.789Z");
    expect(decodeValue("id", "0195F3A4-0000-7000-8000-000000000001")).toBe("0195f3a4-0000-7000-8000-000000000001");
    expect(decodeValue("date", "2026-07-01")).toBe("2026-07-01");
    expect(decodeValue("text", "x")).toBe("x");
    expect(decodeValue("enum", "open")).toBe("open");
    expect(decodeValue("json", '{"a":1}')).toBe('{"a":1}');
    expect(decodeValue("json", { a: 1 })).toBe('{"a":1}');
    // what PostgreSQL's jsonb returns and what SQLite returns for the same row are one text
    expect(decodeValue("json", '{"a": [1, 2], "b": 1}')).toBe(decodeValue("json", '{"b":1,"a":[1,2]}'));
  });

  it("encodes whole numbers as bigint and JSON as text, and passes the rest through", () => {
    expect(encodeValue("int64", 5)).toBe(5n);
    expect(encodeValue("int64", "7")).toBe(7n);
    expect(encodeValue("int64", INT64_MIN)).toBe(INT64_MIN);
    expect(encodeValue("json", { a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(encodeValue("json", '{"a":1}')).toBe('{"a":1}');
    expect(encodeValue("text", "x")).toBe("x");
    expect(encodeValue("ts", "2026-07-01T12:34:56.789Z")).toBe("2026-07-01T12:34:56.789Z");
    expect(encodeValue("date", "2026-07-01")).toBe("2026-07-01");
    expect(encodeValue("id", "0195f3a4-0000-7000-8000-000000000001")).toBe("0195f3a4-0000-7000-8000-000000000001");
    expect(encodeValue("bool", true)).toBe(true);
    expect(encodeValue("text", null)).toBeNull();
    expect(encodeValue("int64", undefined)).toBeNull();
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops spaces", () => {
    expect(canonicalJson('{ "b": 1, "a": { "z": [ {"y":2,"x":1} ], "c": null } }')).toBe('{"a":{"c":null,"z":[{"x":1,"y":2}]},"b":1}');
    expect(canonicalJson("[3, 1, 2]")).toBe("[3,1,2]"); // array order is meaning, never sorted
    expect(canonicalJson('"text"')).toBe('"text"');
    expect(canonicalJson("null")).toBe("null");
  });
  it("is idempotent and keeps the meaning (property)", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        const text = JSON.stringify(value);
        const once = canonicalJson(text);
        return canonicalJson(once) === once && JSON.stringify(JSON.parse(once)) === once;
      }),
    );
  });
  it("refuses text that is not JSON", () => {
    expect(() => canonicalJson("{bad")).toThrow(SyntaxError);
  });
});

describe("encodeValue keeps PostgreSQL as strict as SQLite about forms", () => {
  it.each(["yesterday", "now", "infinity", "-infinity", "epoch", "2026-07-01", "2026-07-01T12:34:56Z", "2026-07-01 12:34:56.789", "2026-07-01T12:34:56.789+05:00", "2026-13-01T00:00:00.000Z", "2026-02-30T00:00:00.000Z", ""])("refuses the timestamp %j", (bad) => {
    expect(() => encodeValue("ts", bad)).toThrow(TypeError);
  });
  it.each(["today", "2026-7-1", "01/07/2026", "2026-02-30", "2026-13-01", "20260701", "2026-07-01T00:00:00.000Z"])("refuses the date %j", (bad) => {
    expect(() => encodeValue("date", bad)).toThrow(TypeError);
  });
  it.each(["", "not-a-uuid", "0195F3A4-0000-7000-8000-000000000001", "0195f3a4000070008000000000000001"])("refuses the id %j", (bad) => {
    expect(() => encodeValue("id", bad)).toThrow(TypeError);
  });
  it("refuses values of the wrong kind", () => {
    expect(() => encodeValue("ts", 5)).toThrow(TypeError);
    expect(() => encodeValue("date", new Date(0))).toThrow(TypeError);
    expect(() => encodeValue("id", 5)).toThrow(TypeError);
  });
});
