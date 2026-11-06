export type NumericErrorCode =
  | "overflow" // a value does not fit 64 bits (never wrapped, always refused)
  | "not-integer" // a number that is not a whole, safe integer was given
  | "bad-wire" // text that is not a canonical whole number
  | "bad-argument" // a value that makes no sense here (zero divisor, negative quantity to consume ...)
  | "bad-factor"; // a unit factor that is not a positive fraction

/** Every refusal of the numeric module. Callers can switch on `code`. */
export class NumericError extends Error {
  readonly code: NumericErrorCode;

  constructor(code: NumericErrorCode, message: string) {
    super(message);
    this.name = "NumericError";
    this.code = code;
  }
}
