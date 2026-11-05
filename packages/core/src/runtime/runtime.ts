import { type Clock, ManualClock } from "./clock";
import { createIdSource, type IdSource } from "./ids";
import { type RandomSource, SeededRandom } from "./random";
import { createSystemClock } from "./system-clock";
import { createSystemRandom } from "./system-random";

/** Everything the engine may ask the outside world for: time, randomness and new identifiers. */
export interface Runtime {
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly ids: IdSource;
}

export function createRuntime(clock: Clock, random: RandomSource): Runtime {
  return { clock, random, ids: createIdSource(clock, random) };
}

/** The real thing, for the apps. */
export function createSystemRuntime(): Runtime {
  return createRuntime(createSystemClock(), createSystemRandom());
}

export interface TestRuntime extends Runtime {
  readonly clock: ManualClock;
  readonly random: SeededRandom;
  readonly seed: string;
}

export interface TestRuntimeOptions {
  /** Printed with every test result (TS-8) so a failing run can be replayed. */
  readonly seed: string;
  /** Wall time at the start; default 2026-07-01T00:00:00Z (a fiscal year start in Pakistan). */
  readonly startWallMs?: number;
}

/** A repeatable world for tests: a clock that moves only when told, and a seeded random source. */
export function createTestRuntime(options: TestRuntimeOptions): TestRuntime {
  const clock = new ManualClock(options.startWallMs ?? Date.UTC(2026, 6, 1));
  const random = new SeededRandom(options.seed);
  return { clock, random, ids: createIdSource(clock, random), seed: options.seed };
}
