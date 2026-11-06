import { NumericError } from "./errors";
import { INT64_MAX, INT64_MIN } from "./limits";

const CANONICAL = /^(?:0|-?[1-9][0-9]*)$/;

/**
 * In bundles and in the programming interface, whole numbers travel as decimal strings
 * (document 05, section 7.1; document 06, section 2.2), so nothing above 2^53 loses a digit.
 */
export function toWire(value: bigint): string {
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new NumericError("overflow", `${value.toString()} does not fit in 64 bits`);
  }
  return value.toString();
}

/** Strict: digits only, no sign except "-", no leading zeros, no "-0", no spaces, 64-bit range. */
export function fromWire(text: string): bigint {
  if (!CANONICAL.test(text)) {
    throw new NumericError("bad-wire", `not a canonical whole number: ${JSON.stringify(text)}`);
  }
  const value = BigInt(text);
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new NumericError("overflow", `${text} does not fit in 64 bits`);
  }
  return value;
}
