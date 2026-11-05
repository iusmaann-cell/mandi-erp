/**
 * TR-2: random numbers and nonces come from one source that a test can seed. Only whole numbers
 * are produced (no floating point anywhere in the engine).
 */
export interface RandomSource {
  /** A whole number from 0 to 4294967295. */
  nextUint32(): number;
  /** A whole number from 0 up to but not including `maxExclusive` (1 to 4294967296), unbiased. */
  nextInt(maxExclusive: number): number;
  /** `length` random bytes. */
  bytes(length: number): Uint8Array;
  /** An independent stream; with a seeded source the same label always gives the same stream. */
  fork(label: string): RandomSource;
}

const TWO_POW_32 = 4294967296;

function assertLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`length must be a whole number, 0 or more (got ${String(length)})`);
  }
}

/** Shared by every source: derive `nextInt` and `bytes` from `nextUint32`. */
export abstract class RandomBase implements RandomSource {
  abstract nextUint32(): number;
  abstract fork(label: string): RandomSource;

  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_POW_32) {
      throw new RangeError(`maxExclusive must be a whole number from 1 to 4294967296 (got ${String(maxExclusive)})`);
    }
    // Rejection sampling: values at or above `limit` would favour small results, so draw again.
    const limit = TWO_POW_32 - (TWO_POW_32 % maxExclusive);
    let x = this.nextUint32();
    while (x >= limit) {
      x = this.nextUint32();
    }
    return x % maxExclusive;
  }

  bytes(length: number): Uint8Array {
    assertLength(length);
    const out = new Uint8Array(length);
    let i = 0;
    while (i < length) {
      let word = this.nextUint32();
      for (let b = 0; b < 4 && i < length; b += 1) {
        out[i] = word & 0xff;
        word >>>= 8;
        i += 1;
      }
    }
    return out;
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** xoshiro128** (Blackman and Vigna): small, fast, and the same on every platform. */
export class Xoshiro128ss extends RandomBase {
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;
  readonly #label: string;

  constructor(s0: number, s1: number, s2: number, s3: number, label = "state") {
    super();
    this.#s0 = s0 | 0;
    this.#s1 = s1 | 0;
    this.#s2 = s2 | 0;
    this.#s3 = s3 | 0;
    this.#label = label;
    if ((this.#s0 | this.#s1 | this.#s2 | this.#s3) === 0) {
      this.#s0 = 1; // the all-zero state never changes; avoid it
    }
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.#s1, 5), 7), 9) >>> 0;
    const t = this.#s1 << 9;
    this.#s2 ^= this.#s0;
    this.#s3 ^= this.#s1;
    this.#s1 ^= this.#s2;
    this.#s0 ^= this.#s3;
    this.#s2 ^= t;
    this.#s3 = rotl(this.#s3, 11);
    return result;
  }

  fork(label: string): RandomSource {
    return new SeededRandom(`${this.#label}/${label}`);
  }
}

/** Turns a seed text into four 32-bit words (cyrb128, public domain). */
function hashSeed(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i += 1) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * A seeded, repeatable source: the same seed text gives the same numbers on every platform.
 * Seeds are printed with every test result (TS-8) so a failure can be replayed.
 */
export class SeededRandom extends Xoshiro128ss {
  readonly seed: string;

  constructor(seed: string) {
    const [a, b, c, d] = hashSeed(seed);
    super(a, b, c, d, seed);
    this.seed = seed;
  }
}
