import { NumericError } from "./errors";
import { INT64_MAX, INT64_MIN } from "./limits";
import { fromWire } from "./wire";

/**
 * The five scaled whole-number types of document 06, section 2.1. All are int64 and all are whole
 * numbers; the scale says what one unit means:
 *   paisa  0.01 rupee          milli  0.001 of a base unit        micro  0.000001 rupee per base unit
 *   r4     0.0001 rupee per rate unit                              p4     0.0001 percent point (18% = 180000)
 * Each is a bigint with a brand, so a Paisa cannot be passed where a Milli is expected.
 * Only this package may multiply or divide them (lint rule mandi/no-money-arithmetic).
 */
export type ScaleKind = "paisa" | "milli" | "micro" | "r4" | "p4";
export type Scaled<K extends ScaleKind> = bigint & { readonly __scale: K };
export type Paisa = Scaled<"paisa">;
export type Milli = Scaled<"milli">;
export type Micro = Scaled<"micro">;
export type R4 = Scaled<"r4">;
export type P4 = Scaled<"p4">;

/** Decimal places of each type. */
export const SCALE: Readonly<Record<ScaleKind, number>> = { paisa: 2, milli: 3, micro: 6, r4: 4, p4: 4 };

export { INT64_MAX, INT64_MIN };

/** Refuse anything outside the signed 64-bit range. Returns the value so it can be used in place. */
export function assertInt64(value: bigint, what = "value"): bigint {
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new NumericError("overflow", `${what} ${value.toString()} does not fit in 64 bits`);
  }
  return value;
}

/** Build a scaled value from a bigint, a safe integer, or canonical whole-number text. */
export function scaled<K extends ScaleKind>(kind: K, value: bigint | number | string): Scaled<K> {
  let v: bigint;
  if (typeof value === "bigint") {
    v = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new NumericError("not-integer", `${kind} needs a whole number, got ${String(value)}`);
    }
    v = BigInt(value);
  } else {
    v = fromWire(value);
  }
  return assertInt64(v, kind) as Scaled<K>;
}

export const paisa = (value: bigint | number | string): Paisa => scaled("paisa", value);
export const milli = (value: bigint | number | string): Milli => scaled("milli", value);
export const micro = (value: bigint | number | string): Micro => scaled("micro", value);
export const r4 = (value: bigint | number | string): R4 => scaled("r4", value);
export const p4 = (value: bigint | number | string): P4 => scaled("p4", value);
