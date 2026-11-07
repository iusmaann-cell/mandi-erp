import { describe, expect, it } from "vitest";
import { canonicalize, CanonicalError } from "./canonical";

describe("canonicalize (document 06, 4.2)", () => {
  it("sorts keys at every depth and writes no spaces", () => {
    expect(canonicalize({ b: 1, a: { z: [3, { y: "x", x: null }], c: true } })).toBe('{"a":{"c":true,"z":[3,{"x":null,"y":"x"}]},"b":1}');
  });
  it("keeps list order (it is meaning) and writes strings with JSON escapes", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize("a\"b\\c\n")).toBe('"a\\"b\\\\c\\n"');
    expect(canonicalize("گودام")).toBe('"گودام"');
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
  });
  it("accepts whole numbers within 2^53 and refuses everything that is not a whole number", () => {
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(-7)).toBe("-7");
    expect(canonicalize(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    for (const bad of [Number("1.5"), Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)]) expect(() => canonicalize(bad)).toThrow(CanonicalError);
  });
  it("refuses values a bundle cannot hold: bigint (it must be a string), undefined, functions, symbols", () => {
    expect(() => canonicalize(5n)).toThrow(/bigint/);
    expect(() => canonicalize(undefined)).toThrow(CanonicalError);
    expect(() => canonicalize(() => 1)).toThrow(CanonicalError);
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalError);
    expect(() => canonicalize(Symbol("x"))).toThrow(CanonicalError);
  });
  it("is the same text whatever order the keys were written in", () => {
    expect(canonicalize({ a: 1, b: 2, c: 3 })).toBe(canonicalize({ c: 3, a: 1, b: 2 }));
  });
});
