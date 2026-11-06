import { describe, expect, it } from "vitest";
import { NumericError } from "./errors";

describe("NumericError", () => {
  it("is an Error with a name, a code and a message", () => {
    const e = new NumericError("overflow", "too big");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(NumericError);
    expect(e.name).toBe("NumericError");
    expect(e.code).toBe("overflow");
    expect(e.message).toBe("too big");
    expect(String(e)).toBe("NumericError: too big");
  });
});
