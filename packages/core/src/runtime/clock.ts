/**
 * TR-1: all code takes time from one clock object that a test can set, step and make wrong.
 * The real clock is read in exactly one file (system-clock.ts); a lint rule forbids it elsewhere.
 */
export interface Clock {
  /**
   * Wall-clock time: whole milliseconds since 1970-01-01T00:00:00Z. It can be wrong (a device
   * with a bad clock) and it can jump, so it is never used to measure durations.
   */
  nowMs(): number;
  /** Monotonic milliseconds: never goes backwards and ignores wall-clock changes. For durations. */
  monotonicMs(): number;
  /** Resolves after at least `ms` monotonic milliseconds. */
  sleep(ms: number): Promise<void>;
}

function assertWholeMs(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a whole number of milliseconds, 0 or more (got ${String(value)})`);
  }
}

interface Sleeper {
  readonly dueMono: number;
  readonly seq: number;
  readonly resolve: () => void;
}

/**
 * A clock that only moves when the test says so. Wall time and monotonic time start at the
 * given values; `advance` moves both together; `setWallMs` and `jumpWallMs` move only the wall
 * clock, which is how a test makes the clock wrong (a device set to the wrong day, a clock that
 * jumps back) without touching durations.
 */
export class ManualClock implements Clock {
  #wall: number;
  #mono = 0;
  #seq = 0;
  #sleepers: Sleeper[] = [];

  constructor(startWallMs: number) {
    assertWholeMs(startWallMs, "startWallMs");
    this.#wall = startWallMs;
  }

  nowMs(): number {
    return this.#wall;
  }

  monotonicMs(): number {
    return this.#mono;
  }

  sleep(ms: number): Promise<void> {
    assertWholeMs(ms, "sleep ms");
    return new Promise<void>((resolve) => {
      this.#sleepers.push({ dueMono: this.#mono + ms, seq: this.#seq, resolve });
      this.#seq += 1;
    });
  }

  /** Step both clocks forward, waking every sleeper that falls due, in due order. */
  advance(ms: number): void {
    assertWholeMs(ms, "advance ms");
    const target = this.#mono + ms;
    for (;;) {
      const next = this.#nextDue(target);
      if (next === undefined) {
        break;
      }
      this.#moveTo(next.dueMono);
      next.resolve();
    }
    this.#moveTo(target);
  }

  /**
   * Like `advance`, but lets each woken sleeper's continuation run before the clock moves on, so
   * code that sleeps in a loop sees the right time at each wake-up.
   */
  async advanceAsync(ms: number): Promise<void> {
    assertWholeMs(ms, "advance ms");
    const target = this.#mono + ms;
    for (;;) {
      const next = this.#nextDue(target);
      if (next === undefined) {
        break;
      }
      this.#moveTo(next.dueMono);
      next.resolve();
      await flushMicrotasks();
    }
    this.#moveTo(target);
    await flushMicrotasks();
  }

  /** Make the wall clock say `ms` from now on; durations are unaffected. */
  setWallMs(ms: number): void {
    assertWholeMs(ms, "wall ms");
    this.#wall = ms;
  }

  /** Move the wall clock by `deltaMs` (negative = jump back); durations are unaffected. */
  jumpWallMs(deltaMs: number): void {
    if (!Number.isSafeInteger(deltaMs)) {
      throw new RangeError("deltaMs must be a whole number");
    }
    this.setWallMs(this.#wall + deltaMs);
  }

  /** How many sleepers are waiting (for tests). */
  get pendingSleepers(): number {
    return this.#sleepers.length;
  }

  #nextDue(target: number): Sleeper | undefined {
    let best: Sleeper | undefined;
    for (const s of this.#sleepers) {
      if (s.dueMono <= target && (best === undefined || s.dueMono < best.dueMono || (s.dueMono === best.dueMono && s.seq < best.seq))) {
        best = s;
      }
    }
    if (best !== undefined) {
      this.#sleepers = this.#sleepers.filter((s) => s !== best);
    }
    return best;
  }

  #moveTo(mono: number): void {
    const delta = mono - this.#mono;
    this.#mono = mono;
    this.#wall += delta;
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await Promise.resolve();
  }
}
