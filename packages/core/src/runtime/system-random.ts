import { RandomBase, type RandomSource } from "./random";

/** What this file needs from the host (browsers, Electron, Android WebView and Node 20+ all have it). */
interface HostCrypto {
  readonly crypto: { getRandomValues(array: Uint32Array): Uint32Array };
}

/**
 * THE ONLY FILE THAT READS REAL RANDOMNESS (TR-2). The lint rule `mandi/no-ambient-time-random`
 * allows `crypto.getRandomValues` here and nowhere else.
 */
class SystemRandom extends RandomBase {
  readonly #host = globalThis as unknown as HostCrypto;
  readonly #word = new Uint32Array(1);

  nextUint32(): number {
    this.#host.crypto.getRandomValues(this.#word);
    return this.#word[0] ?? 0;
  }

  fork(_label: string): RandomSource {
    return new SystemRandom();
  }
}

export function createSystemRandom(): RandomSource {
  return new SystemRandom();
}
