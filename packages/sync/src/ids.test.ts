import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { derivedId } from "./ids";

describe("derivedId", () => {
  it("is a lower-case version 8 uuid, the same every time for the same input", () => {
    const id = derivedId("number_series", "company|key");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(derivedId("number_series", "company|key")).toBe(id);
  });
  it("differs when the namespace or the text differs", () => {
    expect(derivedId("a", "x")).not.toBe(derivedId("b", "x"));
    expect(derivedId("a", "x")).not.toBe(derivedId("a", "y"));
    expect(derivedId("ab", "c")).not.toBe(derivedId("a", "bc"));
  });
  it("is always well formed (property)", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (n, t) => /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(derivedId(n, t))));
  });
});
