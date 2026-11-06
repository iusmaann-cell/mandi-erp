import { normalizeDigits } from "./digits";
import { INT64_MAX, INT64_MIN } from "./limits";

export type ParseErrorCode =
  | "empty"
  | "invalid-character"
  | "bad-sign"
  | "negative-not-allowed"
  | "bad-decimal-point"
  | "bad-grouping"
  | "too-many-decimals"
  | "out-of-range";

export type ParseResult = { readonly ok: true; readonly value: bigint } | { readonly ok: false; readonly code: ParseErrorCode };

export interface ParseOptions {
  /** Decimal places of the target type (paisa 2, milli 3, micro 6, r4 4, p4 4). */
  readonly scale: number;
  /** Negative input is refused unless the field may hold it. */
  readonly allowNegative?: boolean;
}

// Left-to-right and Arabic-letter marks that RTL text adds around numbers.
const DIRECTION_MARKS = /[\u200e\u200f\u061c]/g;
const LAKH_GROUPS = /^[0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3}$/;
const MILLION_GROUPS = /^[0-9]{1,3}(?:,[0-9]{3})+$/;
const BODY = /^[0-9,]*\.?[0-9,]*$/;

const fail = (code: ParseErrorCode): ParseResult => ({ ok: false, code });

/**
 * Typed input to a scaled whole number (N-6). Accepts "125000.5", "1,25,000.50" (lakh grouping),
 * "1,250,000" (million grouping), Western or Urdu digits, and Arabic separators. Refuses, with a
 * code, anything that could be read two ways or that would silently lose digits:
 *   - commas that do not form lakh or million groups ("12,34", "125,5"), or a comma in the decimals
 *   - a grouped number that starts with 0 ("0,500" could be a European 0.5)
 *   - more decimals than the field holds (extra zeros are fine: "1.500" for a quantity of 3 decimals is
 *     accepted at scale 3, and "1.2500" at scale 2 is accepted because the extra digits are zeros)
 *   - a sign other than a leading minus, and a minus where the field cannot be negative
 */
export function parseScaled(text: string, options: ParseOptions): ParseResult {
  let s = normalizeDigits(text.replace(DIRECTION_MARKS, "")).trim();
  if (s === "") return fail("empty");

  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
    if (s === "") return fail("empty");
  }
  if (s.startsWith("-") || s.startsWith("+")) return fail("bad-sign");

  if (s.split(".").length > 2) return fail("bad-decimal-point");
  if (!BODY.test(s)) return fail("invalid-character");

  const dot = s.indexOf(".");
  const integerText = dot < 0 ? s : s.slice(0, dot);
  const fractionText = dot < 0 ? "" : s.slice(dot + 1);
  if (integerText === "" && fractionText === "") return fail("invalid-character");
  if (fractionText.includes(",")) return fail("bad-grouping");

  if (integerText.includes(",")) {
    if (integerText.startsWith("0")) return fail("bad-grouping");
    if (!LAKH_GROUPS.test(integerText) && !MILLION_GROUPS.test(integerText)) return fail("bad-grouping");
  }

  const extra = fractionText.slice(options.scale);
  if (/[1-9]/.test(extra)) return fail("too-many-decimals");
  const fraction = fractionText.slice(0, options.scale).padEnd(options.scale, "0");
  const magnitude = BigInt(`0${integerText.replaceAll(",", "")}${fraction}`);

  if (negative && options.allowNegative !== true) return fail("negative-not-allowed");
  const value = negative ? -magnitude : magnitude;
  if (value < INT64_MIN || value > INT64_MAX) return fail("out-of-range");
  return { ok: true, value };
}
