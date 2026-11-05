import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { createIdSource, isUuidV7, uuidV7TimestampMs } from "./ids";
import { SeededRandom } from "./random";

const START = Date.UTC(2026, 6, 1);

function ids(clock: ManualClock, seed = "ids") {
  return createIdSource(clock, new SeededRandom(seed));
}

describe("UUIDv7 ids (document 06, D-5)", () => {
  it("has the version 7 layout and carries the creation time", () => {
    const clock = new ManualClock(START);
    const id = ids(clock).newId();
    expect(isUuidV7(id)).toBe(true);
    expect(id).toHaveLength(36);
    expect(uuidV7TimestampMs(id)).toBe(START);
  });

  it("is repeatable from the same seed and clock (golden values)", () => {
    const source = ids(new ManualClock(START), "mandi-erp");
    expect(source.newId()).toBe("019f1af9-b400-7666-982f-f41c68019809");
    expect(source.newId()).toBe("019f1af9-b400-7667-9fdf-9ee102700435");
  });

  it("differs across seeds", () => {
    const a = ids(new ManualClock(START), "a").newId();
    const b = ids(new ManualClock(START), "b").newId();
    expect(a).not.toBe(b);
  });

  it("sorts in creation order when time moves forward", () => {
    const clock = new ManualClock(START);
    const source = ids(clock);
    const made: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      made.push(source.newId());
      clock.advance(i % 3); // sometimes 0 ms: same millisecond
    }
    expect([...made].sort()).toEqual(made);
    expect(new Set(made).size).toBe(made.length);
  });

  it("never goes backwards when the wall clock does (a device with a wrong clock)", () => {
    const clock = new ManualClock(START);
    const source = ids(clock);
    const before = source.newId();
    clock.jumpWallMs(-86_400_000); // a day back
    const after = source.newId();
    expect(after > before).toBe(true);
    expect(uuidV7TimestampMs(after)).toBe(uuidV7TimestampMs(before)); // reuses the last time, counts up
  });

  it("stays unique and ordered when thousands are made in one millisecond (counter overflow)", () => {
    const clock = new ManualClock(START);
    const source = ids(clock);
    const made: string[] = [];
    for (let i = 0; i < 10_000; i += 1) made.push(source.newId());
    expect(new Set(made).size).toBe(10_000);
    expect([...made].sort()).toEqual(made);
  });

  it("is strictly increasing for any mix of steps, jumps and bursts (property)", () => {
    const op = fc.oneof(
      fc.record({ kind: fc.constant("advance" as const), ms: fc.integer({ min: 0, max: 5000 }) }),
      fc.record({ kind: fc.constant("jump" as const), ms: fc.integer({ min: -100_000_000, max: 100_000_000 }) }),
      fc.record({ kind: fc.constant("burst" as const), ms: fc.integer({ min: 1, max: 30 }) }),
    );
    fc.assert(
      fc.property(fc.string(), fc.array(op, { maxLength: 60 }), (seed, ops) => {
        const clock = new ManualClock(START);
        const source = ids(clock, seed);
        let last = source.newId();
        for (const o of ops) {
          const count = o.kind === "burst" ? o.ms : 1;
          if (o.kind === "advance") clock.advance(o.ms);
          if (o.kind === "jump") clock.jumpWallMs(o.ms);
          for (let i = 0; i < count; i += 1) {
            const next = source.newId();
            if (!(next > last) || !isUuidV7(next)) return false;
            last = next;
          }
        }
        return true;
      }),
    );
  });

  it("refuses a clock value that does not fit the 48-bit timestamp", () => {
    const clock = new ManualClock(START);
    clock.setWallMs(281474976710656); // 2^48
    expect(() => ids(clock).newId()).toThrow(RangeError);
  });

  it("recognises only real UUIDv7 text", () => {
    expect(isUuidV7("019f1af9-b400-7666-982f-f41c68019809")).toBe(true);
    expect(isUuidV7("019f1af9-b400-4666-982f-f41c68019809")).toBe(false); // version 4
    expect(isUuidV7("019f1af9-b400-7666-182f-f41c68019809")).toBe(false); // wrong variant
    expect(isUuidV7("not an id")).toBe(false);
    expect(() => uuidV7TimestampMs("nope")).toThrow(TypeError);
  });
});
