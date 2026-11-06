import { NumericError } from "./errors";

/**
 * THE rounding rule of the whole product, written once (document 03, section 2; document 06,
 * section 2.1 and X-6): exact integer division, rounded to the nearest whole number, with a
 * halfway case going away from zero.
 *
 * For every positive amount this is "round half up" (2.5 gives 3). For a negative amount it is
 * the mirror image (-2.5 gives -3), so rounding a negative is the negative of rounding the
 * positive and a reversal always offsets the original to the paisa. Document 06 X-6 says only
 * "round half up"; the negative case is clarified in document 06 (decision X-13) and is to be
 * confirmed with the accountant together with Q-1.
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new NumericError("bad-argument", "division by zero");
  }
  let n = numerator;
  let d = denominator;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  const magnitude = negative ? -n : n;
  const quotient = magnitude / d;
  const remainder = magnitude % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
