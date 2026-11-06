/**
 * SHA-256 in plain integer arithmetic, so the cross-platform digest (N-3) is computed the same way in
 * Node, Electron and the Android WebView, with no dependence on any host's crypto. The round
 * constants are not typed in: they are the fractional parts of the cube roots (round constants) and
 * square roots (starting state) of the first primes, computed here with exact integer roots, and the
 * tests check the result against the published test vectors.
 */

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length) / 2n + 1n);
  for (;;) {
    const y = (x + n / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

function icbrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length) / 3n + 1n);
  for (;;) {
    const y = (2n * x + n / (x * x)) / 3n;
    if (y >= x) return x;
    x = y;
  }
}

function firstPrimes(count: number): number[] {
  const primes: number[] = [];
  for (let candidate = 2; primes.length < count; candidate += 1) {
    if (primes.every((p) => candidate % p !== 0)) primes.push(candidate);
  }
  return primes;
}

const LOW_32 = 0xffffffffn;
const PRIMES = firstPrimes(64);
const ROUND_CONSTANTS = Uint32Array.from(PRIMES, (p) => Number(icbrt(BigInt(p) << 96n) & LOW_32));
const INITIAL_STATE = Uint32Array.from(PRIMES.slice(0, 8), (p) => Number(isqrt(BigInt(p) << 64n) & LOW_32));

const at = (a: Uint32Array, i: number): number => a[i] ?? 0;
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export class Sha256 {
  readonly #state = Uint32Array.from(INITIAL_STATE);
  readonly #block = new Uint8Array(64);
  readonly #words = new Uint32Array(64);
  #blockLength = 0;
  #byteCount = 0;

  update(bytes: Uint8Array): this {
    for (const b of bytes) {
      this.#block[this.#blockLength] = b;
      this.#blockLength += 1;
      if (this.#blockLength === 64) {
        this.#compress();
        this.#blockLength = 0;
      }
    }
    this.#byteCount += bytes.length;
    return this;
  }

  /** The digest as 64 lower-case hex characters. Call once, after the last update. */
  hex(): string {
    const bitLength = BigInt(this.#byteCount) * 8n;
    const padding = [0x80];
    while ((this.#blockLength + padding.length) % 64 !== 56) padding.push(0);
    for (let shift = 56n; shift >= 0n; shift -= 8n) padding.push(Number((bitLength >> shift) & 0xffn));
    this.update(Uint8Array.from(padding));
    return Array.from(this.#state, (w) => w.toString(16).padStart(8, "0")).join("");
  }

  #compress(): void {
    const w = this.#words;
    for (let i = 0; i < 16; i += 1) {
      const o = i * 4;
      w[i] = ((this.#block[o] ?? 0) << 24) | ((this.#block[o + 1] ?? 0) << 16) | ((this.#block[o + 2] ?? 0) << 8) | (this.#block[o + 3] ?? 0);
    }
    for (let i = 16; i < 64; i += 1) {
      const a = at(w, i - 15);
      const b = at(w, i - 2);
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = at(w, i - 16) + s0 + at(w, i - 7) + s1;
    }
    let a = at(this.#state, 0);
    let b = at(this.#state, 1);
    let c = at(this.#state, 2);
    let d = at(this.#state, 3);
    let e = at(this.#state, 4);
    let f = at(this.#state, 5);
    let g = at(this.#state, 6);
    let h = at(this.#state, 7);
    for (let i = 0; i < 64; i += 1) {
      const t1: number = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + at(ROUND_CONSTANTS, i) + at(w, i)) >>> 0;
      const t2: number = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    next.forEach((v, i) => {
      this.#state[i] = at(this.#state, i) + v;
    });
  }
}

/** The derived constants, exposed so the tests can check them against the published ones. */
export const sha256Internals = { isqrt, icbrt, firstPrimes, ROUND_CONSTANTS, INITIAL_STATE } as const;

/** UTF-8 bytes of a string (host-independent: no TextEncoder needed). */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Sha256().update(bytes).hex();
}
