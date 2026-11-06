import { NumericError } from "./errors";
import { divRound } from "./round";
import { type Milli, milli } from "./types";

/**
 * Trading units (document 01, R-1 to R-3). Every item has a base unit; another unit is a fixed
 * fraction of it: `num / den` base units in one of that unit. 1 bag of 50 kg is 50/1; 1 piece of a
 * carton of 12 is 1/12; a maund of 37.324 kg is 37324/1000 (stored in lowest terms, 9331/250).
 */
export interface Factor {
  readonly num: bigint;
  readonly den: bigint;
}

const MAX_PART = 1_000_000_000_000_000n; // 10^15: far beyond any pack size, far below overflow trouble

function gcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** A unit factor in lowest terms. Both parts must be whole and positive. */
export function factor(num: bigint | number, den: bigint | number = 1n): Factor {
  const n = typeof num === "number" ? toBig(num) : num;
  const d = typeof den === "number" ? toBig(den) : den;
  if (n <= 0n || d <= 0n || n > MAX_PART || d > MAX_PART) {
    throw new NumericError("bad-factor", `a unit factor must be a positive fraction, got ${n.toString()}/${d.toString()}`);
  }
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

function toBig(value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new NumericError("not-integer", `a unit factor part must be a whole number, got ${String(value)}`);
  }
  return BigInt(value);
}

/** The factor of the base unit itself. */
export const BASE_UNIT: Factor = { num: 1n, den: 1n };

/** A quantity typed in a trading unit (thousandths of that unit) as base-unit milli, rounded to the nearest milli. */
export function toBase(entryQty: Milli, unit: Factor): Milli {
  return milli(divRound(entryQty * unit.num, unit.den));
}

/** A base-unit quantity as thousandths of a trading unit, rounded to the nearest. */
export function fromBase(baseQty: Milli, unit: Factor): Milli {
  return milli(divRound(baseQty * unit.den, unit.num));
}

/** True when `toBase` loses nothing: no rounding to show on the document (PB-10). */
export function isExactToBase(entryQty: Milli, unit: Factor): boolean {
  return (entryQty * unit.num) % unit.den === 0n;
}

/** True when `fromBase` loses nothing. */
export function isExactFromBase(baseQty: Milli, unit: Factor): boolean {
  return (baseQty * unit.den) % unit.num === 0n;
}
