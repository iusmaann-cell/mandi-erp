import { assertInt64, type ScaleKind, type Scaled } from "./types";

/** Sums, differences and comparisons of one kind of value. Every result is checked against 64 bits. */
function checked<K extends ScaleKind>(value: bigint): Scaled<K> {
  return assertInt64(value, "result") as Scaled<K>;
}

export function add<K extends ScaleKind>(a: Scaled<K>, b: Scaled<K>): Scaled<K> {
  return checked<K>(a + b);
}

export function sub<K extends ScaleKind>(a: Scaled<K>, b: Scaled<K>): Scaled<K> {
  return checked<K>(a - b);
}

export function negate<K extends ScaleKind>(a: Scaled<K>): Scaled<K> {
  const v: bigint = a;
  return checked<K>(-v);
}

export function abs<K extends ScaleKind>(a: Scaled<K>): Scaled<K> {
  const v: bigint = a;
  return checked<K>(v < 0n ? -v : v);
}

export function compare<K extends ScaleKind>(a: Scaled<K>, b: Scaled<K>): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Sum of many values of one kind; the running total is checked at every step. */
export function sum<K extends ScaleKind>(values: readonly Scaled<K>[]): Scaled<K> {
  let total = 0n;
  for (const v of values) {
    total = assertInt64(total + v, "running total");
  }
  return total as Scaled<K>;
}
