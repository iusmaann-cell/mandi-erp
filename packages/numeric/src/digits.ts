/**
 * Digit modes (document 07, section 9.3): Western 0-9 by default, or the Extended Arabic-Indic
 * digits used for Urdu (U+06F0 to U+06F9). Parsing accepts both, and also the Arabic-Indic digits
 * of U+0660 to U+0669 and the Arabic decimal and thousands separators.
 */
const EASTERN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;
const ARABIC_DECIMAL = "\u066b";
const ARABIC_THOUSANDS = "\u066c";
const MINUS_SIGN = "\u2212";

export function toEasternDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => String.fromCharCode(EASTERN_ZERO + d.charCodeAt(0) - 48));
}

/** Western digits, ".", "," and "-" for every accepted spelling. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[\u06f0-\u06f9]/g, (d) => String.fromCharCode(48 + d.charCodeAt(0) - EASTERN_ZERO))
    .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(48 + d.charCodeAt(0) - ARABIC_ZERO))
    .replaceAll(ARABIC_DECIMAL, ".")
    .replaceAll(ARABIC_THOUSANDS, ",")
    .replaceAll(MINUS_SIGN, "-");
}
