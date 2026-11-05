import { describe, expect, it } from "vitest";
import { createSystemClock } from "./system-clock";
import { createSystemRandom } from "./system-random";
import { createSystemRuntime, createTestRuntime } from "./runtime";
import { isUuidV7, uuidV7TimestampMs } from "./ids";
import { PRODUCT_NAME } from "../product";

describe("test runtime", () => {
  it("starts at 2026-07-01 and prints its seed", () => {
    const rt = createTestRuntime({ seed: "abc" });
    expect(rt.seed).toBe("abc");
    expect(rt.clock.nowMs()).toBe(Date.UTC(2026, 6, 1));
  });

  it("makes ids from its own clock and seed, so two runs with one seed agree", () => {
    const a = createTestRuntime({ seed: "same", startWallMs: Date.UTC(2027, 0, 15) });
    const b = createTestRuntime({ seed: "same", startWallMs: Date.UTC(2027, 0, 15) });
    const idsA = [a.ids.newId(), a.ids.newId(), a.ids.newId()];
    const idsB = [b.ids.newId(), b.ids.newId(), b.ids.newId()];
    expect(idsA).toEqual(idsB);
    expect(uuidV7TimestampMs(idsA[0] ?? "")).toBe(Date.UTC(2027, 0, 15));
  });

  it("lets a test make the clock wrong and still get ordered ids", () => {
    const rt = createTestRuntime({ seed: "wrong-clock" });
    const first = rt.ids.newId();
    rt.clock.setWallMs(Date.UTC(1999, 0, 1));
    expect(rt.ids.newId() > first).toBe(true);
  });
});

describe("system runtime (the real thing)", () => {
  it("reads a plausible wall clock and a monotonic clock that does not go back", () => {
    const clock = createSystemClock();
    expect(clock.nowMs()).toBeGreaterThan(Date.UTC(2026, 0, 1));
    const a = clock.monotonicMs();
    const b = clock.monotonicMs();
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it("sleeps for real", async () => {
    const clock = createSystemClock();
    const t0 = clock.monotonicMs();
    await clock.sleep(5);
    expect(clock.monotonicMs()).toBeGreaterThanOrEqual(t0);
  });

  it("draws real random numbers within range, and different each time", () => {
    const random = createSystemRandom();
    for (let i = 0; i < 50; i += 1) {
      const x = random.nextUint32();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(4294967295);
      expect(random.nextInt(10)).toBeLessThan(10);
    }
    const a = random.bytes(16);
    const b = random.bytes(16);
    expect(a).toHaveLength(16);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(random.fork("x").nextUint32()).toBeTypeOf("number");
  });

  it("makes UUIDv7 ids from the real clock", () => {
    const rt = createSystemRuntime();
    expect(isUuidV7(rt.ids.newId())).toBe(true);
  });
});

describe("product name (AR-2)", () => {
  it("is the working name", () => {
    expect(PRODUCT_NAME).toBe("Mandi ERP");
  });
});
