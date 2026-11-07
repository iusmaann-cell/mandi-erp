import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INT64_MAX, INT64_MIN } from "@mandi/numeric";
import { BundleFormatError, computeBundleHash, GENESIS_HASH, parseBundle, parseWireText, sealBundle, toWireText, verifyBundleChain, verifyWireText, type Bundle, type Draft } from "./bundle";

const ID = (n: number): string => `0192f3a1-7c10-7a2e-9d11-${n.toString(16).padStart(12, "0")}`;

function draft(seq: number, prev: string, rows = 2): Draft {
  return {
    bundle_id: ID(seq),
    company_id: ID(900),
    location_id: ID(901),
    node_id: ID(902),
    epoch: 3,
    node_seq: seq,
    prev_hash: prev,
    schema_version: 1,
    kind: "document",
    created_at: "2026-11-02T09:41:07.312Z",
    rows: Array.from({ length: rows }, (_, i) => ({ t: "weighment_slips", v: { id: ID(1000 + i), gross_milli: "18300000", tare_milli: "5800000", direction: "out", is_manual: false, note: null } })),
  };
}
function chain(length: number): Bundle[] {
  const out: Bundle[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= length; seq += 1) {
    const b = sealBundle(draft(seq, prev));
    out.push(b);
    prev = b.hash;
  }
  return out;
}

describe("sealing and hashing (document 06, 4.2)", () => {
  it("the hash is SHA-256 of the canonical form of everything but the hash and the signature", () => {
    const b = sealBundle(draft(1, GENESIS_HASH));
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.hash).toBe(computeBundleHash(draft(1, GENESIS_HASH)));
    expect(computeBundleHash({ ...draft(1, GENESIS_HASH) })).toBe(b.hash);
    const signed = { ...b, signature: "sig" };
    expect(verifyWireText(toWireText(signed)).ok).toBe(true); // a signature does not change the hash
  });

  it("is repeatable, and changes with any field, with row order, and with the row values", () => {
    const base = sealBundle(draft(1, GENESIS_HASH)).hash;
    expect(sealBundle(draft(1, GENESIS_HASH)).hash).toBe(base);
    expect(sealBundle({ ...draft(1, GENESIS_HASH), epoch: 4 }).hash).not.toBe(base);
    expect(sealBundle({ ...draft(1, GENESIS_HASH), kind: "system" }).hash).not.toBe(base);
    expect(sealBundle({ ...draft(1, GENESIS_HASH), location_id: null }).hash).not.toBe(base);
    const d = draft(1, GENESIS_HASH);
    expect(sealBundle({ ...d, rows: [...d.rows].reverse() }).hash).not.toBe(base); // the order of rows is part of the hash
    expect(sealBundle({ ...d, rows: [d.rows[0]!, { t: "weighment_slips", v: { ...d.rows[1]!.v, gross_milli: "18300001" } }] }).hash).not.toBe(base);
  });

  it("key order in the source object does not matter", () => {
    const d = draft(1, GENESIS_HASH);
    const reordered = Object.fromEntries(Object.entries(d).reverse()) as Draft;
    expect(computeBundleHash(reordered)).toBe(computeBundleHash(d));
  });
});

describe("PB-18: a bundle written as JSON and read back is identical", () => {
  it("whole numbers travel as strings and keep every digit above 2^53", () => {
    const big = [INT64_MAX.toString(), INT64_MIN.toString(), "9007199254740993", "-9007199254740993", "0"];
    const b = sealBundle({ ...draft(1, GENESIS_HASH), rows: big.map((v, i) => ({ t: "stock_ledger", v: { id: ID(i), qty_milli: v } })) });
    const back = parseWireText(toWireText(b));
    expect(back).toEqual(b);
    expect(back.rows.map((r) => r.v["qty_milli"])).toEqual(big);
    expect(verifyWireText(toWireText(back)).ok).toBe(true);
    expect(BigInt(Number(9007199254740993n))).not.toBe(9007199254740993n); // a JSON number would have lost it
  });

  it("any bundle survives the round trip (property)", () => {
    const value = fc.oneof(fc.string(), fc.boolean(), fc.constant(null), fc.bigInt({ min: INT64_MIN, max: INT64_MAX }).map((n) => n.toString()));
    const row = fc.record({ t: fc.constantFrom("a_table", "another_table", "x1"), v: fc.dictionary(fc.constantFrom("id", "qty_milli", "note", "flag", "z"), value) });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 6 }), fc.integer({ min: 1, max: 1_000_000 }), (rows, seq) => {
        const b = sealBundle({ ...draft(seq, GENESIS_HASH), rows });
        const text = toWireText(b);
        return JSON.stringify(parseWireText(text)) === JSON.stringify(parseBundle(JSON.parse(text))) && toWireText(parseWireText(text)) === text && verifyWireText(text).ok;
      }),
    );
  });
});

describe("PB-15: any change to a stored bundle, even one character, is detected", () => {
  const text = toWireText(sealBundle(draft(18, "9f".repeat(32), 3)));

  it("is a valid bundle in canonical form to begin with", () => {
    expect(verifyWireText(text)).toMatchObject({ ok: true, problems: [] });
  });

  it("every single-character substitution at every position is reported", () => {
    let tried = 0;
    for (let i = 0; i < text.length; i += 1) {
      for (const replacement of ["x", "0", "}", " "]) {
        if (text[i] === replacement) continue;
        const mutated = text.slice(0, i) + replacement + text.slice(i + 1);
        tried += 1;
        expect(verifyWireText(mutated).ok, `position ${String(i)} -> ${JSON.stringify(replacement)}`).toBe(false);
      }
    }
    expect(tried).toBeGreaterThan(text.length * 3);
  });

  it("every deletion and every insertion is reported", () => {
    for (let i = 0; i < text.length; i += 1) {
      expect(verifyWireText(text.slice(0, i) + text.slice(i + 1)).ok, `delete ${String(i)}`).toBe(false);
      expect(verifyWireText(`${text.slice(0, i)} ${text.slice(i)}`).ok, `insert space ${String(i)}`).toBe(false);
    }
  });

  it("a random change of any kind is reported (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: text.length - 1 }), fc.string({ minLength: 1, maxLength: 3 }), fc.integer({ min: 0, max: 3 }), (at, chars, removed) => {
        const mutated = text.slice(0, at) + chars + text.slice(at + removed);
        return mutated === text || !verifyWireText(mutated).ok;
      }),
      { numRuns: 500 },
    );
  });

  it("says what is wrong: not a bundle, not canonical, hash mismatch", () => {
    expect(verifyWireText("nonsense").problems).toEqual(["not_a_bundle"]);
    expect(verifyWireText(JSON.stringify(JSON.parse(text), null, 1)).problems).toContain("not_canonical");
    const changed = text.replace('"epoch":3', '"epoch":4');
    expect(verifyWireText(changed).problems).toEqual(["hash_mismatch"]);
    const reorder = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text) as object).reverse()));
    expect(verifyWireText(reorder).problems).toEqual(["not_canonical"]);
  });
});

describe("verifyBundleChain (PB-15, document 05 section 7.1)", () => {
  it("a whole chain, in any order, has no problem", () => {
    const c = chain(6);
    expect(verifyBundleChain(c)).toEqual([]);
    expect(verifyBundleChain([...c].reverse())).toEqual([]);
    expect(verifyBundleChain([])).toEqual([]);
  });

  it("a changed bundle shows as a hash mismatch", () => {
    const c = chain(4);
    c[1] = { ...c[1]!, rows: [] };
    expect(verifyBundleChain(c)).toEqual([{ kind: "hash_mismatch", bundleId: c[1]?.bundle_id, nodeSeq: 2 }]);
  });

  it("a lost bundle shows as a gap and a broken link", () => {
    const c = chain(5).filter((b) => b.node_seq !== 3);
    const problems = verifyBundleChain(c);
    expect(problems).toContainEqual({ kind: "gap", expected: 3, found: 4 });
    expect(problems.some((p) => p.kind === "prev_hash_mismatch")).toBe(true);
  });

  it("a rewritten history shows as broken links even when every hash is recomputed", () => {
    const c = chain(3);
    const forged = sealBundle({ ...draft(2, "ab".repeat(32)) });
    expect(verifyBundleChain([c[0]!, forged, c[2]!])).toContainEqual({ kind: "prev_hash_mismatch", bundleId: forged.bundle_id, nodeSeq: 2 });
  });

  it("a duplicate sequence number, a wrong start and a first bundle that does not start from genesis are reported", () => {
    const c = chain(3);
    expect(verifyBundleChain([...c, c[1]!]).some((p) => p.kind === "duplicate_seq")).toBe(true);
    expect(verifyBundleChain(c.slice(1))).toContainEqual({ kind: "wrong_start", found: 2 });
    expect(verifyBundleChain(c.slice(1), { startsAt: 2 })).toEqual([]);
    const notGenesis = sealBundle(draft(1, "cd".repeat(32)));
    expect(verifyBundleChain([notGenesis])).toContainEqual({ kind: "prev_hash_mismatch", bundleId: notGenesis.bundle_id, nodeSeq: 1 });
  });
});

describe("parseBundle refuses anything that is not exactly a bundle", () => {
  const good = sealBundle(draft(1, GENESIS_HASH));
  const bad = (change: Record<string, unknown>) => () => parseBundle({ ...good, ...change });

  it("accepts a good bundle, with or without a signature", () => {
    expect(parseBundle(good)).toEqual(good);
    expect(parseBundle({ ...good, signature: "s" }).signature).toBe("s");
  });

  it.each<[string, Record<string, unknown>]>([
    ["bundle_id not a uuid", { bundle_id: "x" }],
    ["upper-case uuid", { company_id: ID(1).toUpperCase() }],
    ["location_id a number", { location_id: 5 }],
    ["epoch zero", { epoch: 0 }],
    ["epoch a fraction", { epoch: Number("1.5") }],
    ["epoch a string", { epoch: "3" }],
    ["node_seq negative", { node_seq: -1 }],
    ["prev_hash short", { prev_hash: "abc" }],
    ["hash upper case", { hash: "A".repeat(64) }],
    ["unknown kind", { kind: "other" }],
    ["created_at not UTC milliseconds", { created_at: "2026-11-02 09:41:07" }],
    ["rows not a list", { rows: {} }],
    ["an extra field", { extra: 1 }],
    ["signature not text", { signature: 5 }],
    ["schema_version zero", { schema_version: 0 }],
  ])("%s", (_name, change) => {
    expect(bad(change)).toThrow(BundleFormatError);
  });

  it("refuses bad rows: a number where a string is needed, a nested object, an unknown field, no table", () => {
    expect(bad({ rows: [{ t: "x", v: { a: 5 } }] })).toThrow(/whole numbers travel as strings/);
    expect(bad({ rows: [{ t: "x", v: { a: { b: 1 } } }] })).toThrow(BundleFormatError);
    expect(bad({ rows: [{ t: "x", v: {}, extra: 1 }] })).toThrow(/unknown field/);
    expect(bad({ rows: [{ v: {} }] })).toThrow(/no table name/);
    expect(bad({ rows: [{ t: "X-Y", v: {} }] })).toThrow(BundleFormatError);
    expect(bad({ rows: [5] })).toThrow(BundleFormatError);
    expect(() => parseBundle(null)).toThrow(BundleFormatError);
    expect(() => parseBundle([])).toThrow(BundleFormatError);
    expect(() => parseWireText("{")).toThrow(/not JSON/);
  });
});
