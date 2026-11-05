import type { Clock } from "./clock";

/** What this file needs from the host. Written out here so core needs no Node or DOM typings. */
interface HostTime {
  readonly performance: { now(): number };
  setTimeout(handler: () => void, ms: number): unknown;
}

/**
 * THE ONLY FILE THAT READS THE REAL CLOCK (TR-1). The lint rule `mandi/no-ambient-time-random`
 * allows `Date.now`, `performance.now` and timers here and nowhere else.
 */
export function createSystemClock(): Clock {
  const host = globalThis as unknown as HostTime;
  return {
    nowMs: () => Date.now(),
    monotonicMs: () => Math.trunc(host.performance.now()),
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        host.setTimeout(resolve, ms);
      }),
  };
}
