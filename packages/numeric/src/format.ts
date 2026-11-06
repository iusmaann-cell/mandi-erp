import { toEasternDigits } from "./digits";
import { NumericError } from "./errors";
import { divRound } from "./round";
import { SCALE, type ScaleKind } from "./types";

export type Grouping = "lakh" | "million";
export type DigitMode = "western" | "eastern";

export interface FormatOptions {
  /** Decimal places of the value being shown (paisa 2, milli 3, micro 6, r4 4, p4 4). */
  readonly scale: number;
  /** The most decimals to show (default: all of them). Fewer than `scale` rounds. */
  readonly maxDecimals?: number;
  /** The fewest decimals to show (default: `maxDecimals`, so the number has a fixed width). Trailing zeros above this are dropped. */
  readonly minDecimals?: number;
  /** Lakh and crore grouping (12,50,000.00) is the default for Pakistani users; million grouping (1,250,000.00) is the other (document 07, section 9.4). */
  readonly grouping?: Grouping;
  /** Western digits by default; Urdu digits on request (document 07, section 9.3). */
  readonly digits?: DigitMode;
}

/** Add a comma every three digits from the right, then every two (lakh) or three (million). */
export function groupDigits(digits: string, grouping: Grouping): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const size = grouping === "lakh" ? 2 : 3;
  const parts: string[] = [];
  for (let end = head.length; end > 0; end -= size) {
    parts.unshift(head.slice(Math.max(0, end - size), end));
  }
  return `${parts.join(",")},${tail}`;
}

/** A scaled whole number as text. A negative value gets a leading "-", and zero never does. */
export function formatScaled(value: bigint, options: FormatOptions): string {
  const max = options.maxDecimals ?? options.scale;
  const min = options.minDecimals ?? max;
  if (!(Number.isSafeInteger(options.scale) && Number.isSafeInteger(max) && Number.isSafeInteger(min) && min >= 0 && min <= max && max <= options.scale)) {
    throw new NumericError("bad-argument", "decimals must satisfy 0 <= min <= max <= scale");
  }
  const rounded = divRound(value, 10n ** BigInt(options.scale - max));
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;
  const unit = 10n ** BigInt(max);
  let fraction = (magnitude % unit).toString().padStart(max, "0");
  while (fraction.length > min && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  const integer = groupDigits((magnitude / unit).toString(), options.grouping ?? "lakh");
  const text = `${negative ? "-" : ""}${integer}${fraction === "" ? "" : `.${fraction}`}`;
  return options.digits === "eastern" ? toEasternDigits(text) : text;
}

type Display = Pick<FormatOptions, "grouping" | "digits">;

/**
 * How each kind of number is shown on screens and printouts (document 07, section 9.4). Rates and
 * unit costs show two decimals; a rate shows up to four only when it was typed with more.
 */
export const formatPaisa = (v: bigint, d: Display = {}): string => formatScaled(v, { ...d, scale: SCALE.paisa });
/** Quantities in lists: up to three decimals, trailing zeros dropped (12,500). */
export const formatMilli = (v: bigint, d: Display = {}): string => formatScaled(v, { ...d, scale: SCALE.milli, minDecimals: 0 });
/** Weighment panel and slips: always three decimals. */
export const formatMilliFixed = (v: bigint, d: Display = {}): string => formatScaled(v, { ...d, scale: SCALE.milli });
export const formatRate = (v: bigint, d: Display = {}): string => formatScaled(v, { ...d, scale: SCALE.r4, minDecimals: 2 });
/** Unit cost: six are stored, two are shown (rounded for display only). */
export const formatCost = (v: bigint, d: Display = {}): string => formatScaled(v, { ...d, scale: SCALE.micro, maxDecimals: 2 });
export const formatPercent = (v: bigint, d: Display = {}): string => formatScaled(v, { ...d, scale: SCALE.p4, minDecimals: 0 });

export function formatKind(kind: ScaleKind, value: bigint, d: Display = {}): string {
  switch (kind) {
    case "paisa":
      return formatPaisa(value, d);
    case "milli":
      return formatMilli(value, d);
    case "micro":
      return formatCost(value, d);
    case "r4":
      return formatRate(value, d);
    case "p4":
      return formatPercent(value, d);
  }
}
