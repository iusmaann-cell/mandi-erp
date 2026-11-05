import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";

const START = Date.UTC(2026, 6, 1); // 2026-07-01T00:00:00Z, a fiscal year start
const HALF = Number("0.5"); // a fraction on purpose: the clock must refuse it (no float literals in this codebase)

describe("ManualClock (TR-1)", () => {
  it("starts where it is told and does not move by itself", () => {
    const clock = new ManualClock(START);
    expect(clock.nowMs()).toBe(START);
    expect(clock.monotonicMs()).toBe(0);
    expect(clock.nowMs()).toBe(START);
  });

  it("steps wall and monotonic time together", () => {
    const clock = new ManualClock(START);
    clock.advance(1500);
    expect(clock.nowMs()).toBe(START + 1500);
    expect(clock.monotonicMs()).toBe(1500);
  });

  it("can be made wrong without disturbing durations", () => {
    const clock = new ManualClock(START);
    clock.advance(10);
    clock.setWallMs(Date.UTC(2020, 0, 1)); // a device with the wrong year
    expect(clock.nowMs()).toBe(Date.UTC(2020, 0, 1));
    expect(clock.monotonicMs()).toBe(10);
    clock.advance(5);
    expect(clock.nowMs()).toBe(Date.UTC(2020, 0, 1) + 5);
    expect(clock.monotonicMs()).toBe(15);
  });

  it("can jump back and forward", () => {
    const clock = new ManualClock(START);
    clock.jumpWallMs(-3_600_000);
    expect(clock.nowMs()).toBe(START - 3_600_000);
    clock.jumpWallMs(7_200_000);
    expect(clock.nowMs()).toBe(START + 3_600_000);
    expect(clock.monotonicMs()).toBe(0);
  });

  it("wakes sleepers only when their time has come, in due order", async () => {
    const clock = new ManualClock(START);
    const woke: string[] = [];
    const a = clock.sleep(300).then(() => woke.push("a"));
    const b = clock.sleep(100).then(() => woke.push("b"));
    const c = clock.sleep(100).then(() => woke.push("c")); // same due time as b: first asked, first woken
    expect(clock.pendingSleepers).toBe(3);
    clock.advance(99);
    await Promise.resolve();
    expect(woke).toEqual([]);
    clock.advance(1);
    await Promise.all([b, c]);
    expect(woke).toEqual(["b", "c"]);
    clock.advance(200);
    await a;
    expect(woke).toEqual(["b", "c", "a"]);
    expect(clock.pendingSleepers).toBe(0);
  });

  it("advanceAsync lets a loop that sleeps see the right time at every wake-up", async () => {
    const clock = new ManualClock(START);
    const seen: number[] = [];
    const loop = (async () => {
      for (let i = 0; i < 3; i += 1) {
        await clock.sleep(1000);
        seen.push(clock.monotonicMs());
      }
    })();
    await clock.advanceAsync(3500);
    await loop;
    expect(seen).toEqual([1000, 2000, 3000]);
    expect(clock.monotonicMs()).toBe(3500);
  });

  it("does not wake a sleeper early, and wakes it exactly when due", async () => {
    const clock = new ManualClock(START);
    let woke = false;
    void clock.sleep(10).then(() => {
      woke = true;
    });
    await clock.advanceAsync(9);
    expect(woke).toBe(false);
    await clock.advanceAsync(1);
    expect(woke).toBe(true);
  });

  it("refuses values that are not whole non-negative milliseconds", () => {
    expect(() => new ManualClock(-1)).toThrow(RangeError);
    const clock = new ManualClock(START);
    expect(() => {
      clock.advance(-1);
    }).toThrow(RangeError);
    expect(() => {
      clock.advance(HALF);
    }).toThrow(RangeError);
    expect(() => {
      void clock.sleep(Number.NaN);
    }).toThrow(RangeError);
    expect(() => {
      clock.jumpWallMs(HALF);
    }).toThrow(RangeError);
    expect(() => {
      clock.setWallMs(-5);
    }).toThrow(RangeError);
  });
});
