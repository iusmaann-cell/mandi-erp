import type { Clock } from "./clock";
import type { RandomSource } from "./random";

/** Document 06, D-5: every row gets a permanent time-ordered UUID (version 7) where it is created. */
export interface IdSource {
  newId(): string;
}

const MAX_MS = 281474976710655; // 2^48 - 1: the timestamp field is 48 bits
const COUNTER_START_LIMIT = 2048; // start the 12-bit counter in the lower half so it can count up
const COUNTER_MAX = 4095;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

/**
 * Makes UUIDv7 ids that never go backwards from one generator, even if the wall clock does: if the
 * clock goes back (or stands still) the last timestamp is reused and a 12-bit counter counts up.
 */
export function createIdSource(clock: Clock, random: RandomSource): IdSource {
  let lastMs = -1;
  let counter = 0;
  return {
    newId(): string {
      let ms = clock.nowMs();
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_MS) {
        throw new RangeError(`clock value ${String(ms)} cannot be placed in a UUIDv7 timestamp`);
      }
      if (ms > lastMs) {
        counter = random.nextInt(COUNTER_START_LIMIT);
      } else {
        ms = lastMs;
        counter += 1;
        if (counter > COUNTER_MAX) {
          ms = lastMs + 1; // counter full: borrow the next millisecond
          counter = random.nextInt(COUNTER_START_LIMIT);
        }
      }
      lastMs = ms;
      const tail = random.bytes(8);
      tail[0] = ((tail[0] ?? 0) & 0x3f) | 0x80; // variant 10
      const time = ms.toString(16).padStart(12, "0");
      const counterHex = counter.toString(16).padStart(3, "0");
      const t = hex(tail);
      return `${time.slice(0, 8)}-${time.slice(8)}-7${counterHex}-${t.slice(0, 4)}-${t.slice(4)}`;
    },
  };
}

export function isUuidV7(text: string): boolean {
  return UUID_V7.test(text);
}

/** The creation time embedded in a UUIDv7, in whole milliseconds since 1970. */
export function uuidV7TimestampMs(id: string): number {
  if (!isUuidV7(id)) {
    throw new TypeError(`not a UUIDv7: ${id}`);
  }
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
