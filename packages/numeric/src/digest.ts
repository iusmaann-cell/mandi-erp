import { add, sub, sum } from "./arith";
import { NumericError } from "./errors";
import { type DigitMode, formatScaled, type Grouping } from "./format";
import { consumptionCost, costOf, lineAmount, percentOf, unitCostMicro } from "./money";
import { parseScaled } from "./parse";
import { Sha256, utf8Bytes } from "./sha256";
import { fromBase, factor, isExactFromBase, isExactToBase, toBase } from "./units";
import { micro, milli, p4, paisa, r4, SCALE, type ScaleKind } from "./types";
import { fromWire, toWire } from "./wire";

/**
 * N-3 (document 09, section 6.1): the same answer everywhere. A fixed list of seeded operations is
 * run in Node, in Electron and inside the Android WebView, and the hash of every result must be
 * identical. This is the harness: the three environments each call `runNumericDigest` with a seeded
 * random source and compare the hex digest. It needs only integer arithmetic and takes its random
 * numbers through the small structural interface below, so it works with the engine's SeededRandom
 * without this package depending on it.
 */
export interface DigestRandom {
  nextUint32(): number;
  nextInt(maxExclusive: number): number;
}

export interface DigestResult {
  /** SHA-256 of all result lines, 64 hex characters. */
  readonly digest: string;
  readonly operations: number;
  /** How many operations ended in a refusal (overflow and the like); refusals are results too and are hashed. */
  readonly refusals: number;
}

function randomBits(r: DigestRandom, bits: number): bigint {
  let value = 0n;
  for (let got = 0; got < bits; got += 32) {
    value = (value << 32n) | BigInt(r.nextUint32());
  }
  return value & ((1n << BigInt(bits)) - 1n);
}

/** A random whole number of up to `maxBits` bits, positive or negative. */
function signedBits(r: DigestRandom, maxBits: number): bigint {
  const v = randomBits(r, 1 + r.nextInt(maxBits));
  return r.nextInt(2) === 0 ? v : -v;
}

/** Mostly realistic sizes, sometimes the whole 64-bit range (so overflow is exercised too). */
function sized(r: DigestRandom, realisticBits: number): bigint {
  return signedBits(r, r.nextInt(4) === 3 ? 63 : realisticBits);
}

function positive(r: DigestRandom, maxBits: number): bigint {
  return randomBits(r, 1 + r.nextInt(maxBits)) + 1n;
}

const KINDS: readonly ScaleKind[] = ["paisa", "milli", "micro", "r4", "p4"];
const GROUPINGS: readonly Grouping[] = ["lakh", "million"];
const DIGITS: readonly DigitMode[] = ["western", "eastern"];

function attempt(fn: () => string): { text: string; refused: boolean } {
  try {
    return { text: fn(), refused: false };
  } catch (error) {
    if (error instanceof NumericError) return { text: `ERR:${error.code}`, refused: true };
    throw error;
  }
}

function randomFactor(r: DigestRandom) {
  return factor(1 + r.nextInt(2000), 1 + r.nextInt(1000));
}

type Op = (r: DigestRandom) => string;

const OPERATIONS: readonly Op[] = [
  (r) => {
    const q = sized(r, 34);
    const rate = sized(r, 27);
    const f = randomFactor(r);
    return `lineAmount|${toWire(q)}|${toWire(rate)}|${f.num}/${f.den}|${toWire(lineAmount(milli(q), r4(rate), f))}`;
  },
  (r) => {
    const q = sized(r, 34);
    const c = sized(r, 30);
    return `costOf|${toWire(q)}|${toWire(c)}|${toWire(costOf(milli(q), micro(c)))}`;
  },
  (r) => {
    const total = sized(r, 40);
    const q = r.nextInt(8) === 0 ? 0n : positive(r, 34);
    return `unitCostMicro|${toWire(total)}|${toWire(q)}|${toWire(unitCostMicro(paisa(total), milli(q)))}`;
  },
  (r) => {
    const a = sized(r, 40);
    const p = sized(r, 22);
    return `percentOf|${toWire(a)}|${toWire(p)}|${toWire(percentOf(paisa(a), p4(p)))}`;
  },
  (r) => {
    const q = sized(r, 34);
    const f = randomFactor(r);
    const base = toBase(milli(q), f);
    const back = fromBase(base, f);
    return `convert|${toWire(q)}|${f.num}/${f.den}|${toWire(base)}|${toWire(back)}|${String(isExactToBase(milli(q), f))}|${String(isExactFromBase(base, f))}`;
  },
  (r) => {
    const qty = positive(r, 34);
    const value = positive(r, 40);
    const pick = r.nextInt(3);
    const consumed = pick === 0 ? qty : pick === 1 ? randomBits(r, 33) % (qty + 1n) : qty + 1n;
    const cost = signedBits(r, 30);
    return `consume|${toWire(qty)}|${toWire(value)}|${toWire(consumed)}|${toWire(cost)}|${toWire(consumptionCost({ qty: milli(qty), value: paisa(value) }, milli(consumed), micro(cost)))}`;
  },
  (r) => {
    const values = Array.from({ length: 1 + r.nextInt(5) }, () => paisa(signedBits(r, 63)));
    const a = values[0] ?? paisa(0);
    const b = values[values.length - 1] ?? paisa(0);
    const parts = [`sum|${values.map(toWire).join(",")}`];
    parts.push(attempt(() => toWire(add(a, b))).text, attempt(() => toWire(sub(a, b))).text, attempt(() => toWire(sum(values))).text);
    return parts.join("|");
  },
  (r) => {
    const kind = KINDS[r.nextInt(KINDS.length)] ?? "paisa";
    const scale = SCALE[kind];
    const v = signedBits(r, 63);
    const max = r.nextInt(scale + 1);
    const min = r.nextInt(max + 1);
    const grouping = GROUPINGS[r.nextInt(2)] ?? "lakh";
    const digits = DIGITS[r.nextInt(2)] ?? "western";
    const text = formatScaled(v, { scale, maxDecimals: max, minDecimals: min, grouping, digits });
    const full = formatScaled(v, { scale, grouping, digits });
    const parsed = parseScaled(full, { scale, allowNegative: true });
    return `format|${kind}|${toWire(v)}|${max}|${min}|${grouping}|${digits}|${text}|${full}|${parsed.ok ? toWire(parsed.value) : parsed.code}`;
  },
  (r) => {
    const scale = r.nextInt(7);
    const v = signedBits(r, 50);
    const base = formatScaled(v, { scale, grouping: GROUPINGS[r.nextInt(2)] ?? "lakh", digits: DIGITS[r.nextInt(2)] ?? "western" });
    const noise = ["", ",", ".", "x", " ", "..", ",,", "-", "+", "\u200f", ".0", "00", ",5"][r.nextInt(13)] ?? "";
    const cut = r.nextInt(base.length + 1);
    const text = r.nextInt(2) === 0 ? base : `${base.slice(0, cut)}${noise}${base.slice(cut)}`;
    const parsed = parseScaled(text, { scale, allowNegative: r.nextInt(2) === 0 });
    return `parse|${scale}|${text}|${parsed.ok ? toWire(parsed.value) : parsed.code}`;
  },
  (r) => {
    const v = signedBits(r, 64);
    const text = r.nextInt(3) === 0 ? `${r.nextInt(2) === 0 ? "0" : ""}${v.toString()}` : toWire(v);
    return `wire|${text}|${toWire(fromWire(text))}`;
  },
];

/** Run `operations` seeded operations and hash every result line. Same random source and count give the same digest on every platform. */
export function runNumericDigest(random: DigestRandom, operations: number): DigestResult {
  const sha = new Sha256();
  let refusals = 0;
  for (let i = 0; i < operations; i += 1) {
    const index = random.nextInt(OPERATIONS.length);
    const op = OPERATIONS[index];
    if (op === undefined) throw new Error("operation table is empty");
    const { text, refused } = attempt(() => op(random));
    if (refused) refusals += 1;
    sha.update(utf8Bytes(`${i}|${index}|${text}\n`));
  }
  return { digest: sha.hex(), operations, refusals };
}
