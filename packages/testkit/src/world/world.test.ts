import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { catalogueOf, MIGRATIONS } from "@mandi/data";
import { fromWire } from "@mandi/numeric";
import { describe, expect, it } from "vitest";
import { buildDataSet, DEFAULT_SEEDS } from "./build";
import type { DataSet } from "./dataset";
import { exportFixture, fingerprint } from "./export";
import { schemaFixture } from "./schema-fixture";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIXTURES = new URL("../../../../fixtures/", import.meta.url);
const UPDATE = process.env["UPDATE_FIXTURES"] === "1";

/** Compare a generated fixture with its file; with UPDATE_FIXTURES=1 write the file instead (and read the diff). */
function checkFixture(name: string, text: string): void {
  const file = new URL(name, FIXTURES);
  if (UPDATE) writeFileSync(file, text);
  expect(readFileSync(file, "utf8")).toBe(text);
}

const urduOrNull = (s: string | null): boolean => s === null || /[\u0600-\u06ff]/.test(s);

describe("the world builder (document 09, section 6.2)", () => {
  it("rebuilds exactly from its seed, to the identifier, and differs for another seed", () => {
    for (const id of ["DS-1", "DS-2"] as const) {
      expect(buildDataSet(id)).toEqual(buildDataSet(id));
      expect(buildDataSet(id, "another-seed")).not.toEqual(buildDataSet(id));
      expect(buildDataSet(id).seed).toBe(DEFAULT_SEEDS[id]);
    }
    expect(fingerprint(buildDataSet("DS-2"))).toBe(fingerprint(buildDataSet("DS-2")));
    expect(fingerprint(buildDataSet("DS-2"))).not.toBe(fingerprint(buildDataSet("DS-2", "x")));
  });

  describe("DS-1 Golden minimal: the inputs of WE-1 to WE-4", () => {
    const ds = buildDataSet("DS-1");
    it("has one company, Godown A and Shop B, three items and four parties", () => {
      expect(ds.company).toMatchObject({ code: "MT", fiscal_year_start_month: 7 });
      expect(ds.locations.map((l) => l.code)).toEqual(["GA", "SB"]);
      expect(ds.items.map((i) => i.code)).toEqual(["RICE-BAS", "WHEAT", "OIL"]);
      expect(ds.parties.map((p) => p.code)).toEqual(["SUP-NOOR", "CAR-FAST", "CUS-KARIM", "CUS-BILAL"]);
      expect(ds.parties.map((p) => p.kind)).toEqual(["supplier", "carrier", "customer", "customer"]);
      expect(ds.opening).toEqual({ batches: [], balances: [] }); // the examples start from nothing
    });
    it("rice is sold in bags of 50 kg and maunds of 40 kg, as in the examples (200 bags are 10,000 kg)", () => {
      const rice = ds.items.find((i) => i.code === "RICE-BAS");
      expect(rice?.units.map((u) => [u.code, u.factor])).toEqual([["BAG", { num: "50", den: "1" }], ["MAUND", { num: "40", den: "1" }]]);
      expect(ds.items.find((i) => i.code === "OIL")?.units[0]?.factor).toEqual({ num: "12", den: "1" });
    });
    it("customer credit limits are in paisa, written as whole-number text", () => {
      expect(ds.parties.map((p) => p.credit_limit_paisa)).toEqual(["0", "0", "500000000", "300000000"]);
    });
  });

  describe("DS-2 Day in the life", () => {
    const ds = buildDataSet("DS-2");
    it("has 20 items, 15 parties and two locations, with every kind of party", () => {
      expect(ds.items).toHaveLength(20);
      expect(ds.parties).toHaveLength(15);
      expect(ds.locations).toHaveLength(2);
      for (const kind of ["supplier", "customer", "carrier"]) expect(ds.parties.some((p) => p.kind === kind), kind).toBe(true);
    });
    it("has opening stock as batches and opening balances that point at real items, locations and parties", () => {
      expect(ds.opening.batches).toHaveLength(12);
      expect(ds.opening.balances).toHaveLength(8);
      for (const b of ds.opening.batches) {
        expect(ds.items.some((i) => i.code === b.item_code)).toBe(true);
        expect(ds.locations.some((l) => l.code === b.location_code)).toBe(true);
        expect(fromWire(b.qty_milli)).toBeGreaterThan(0n);
        expect(fromWire(b.unit_cost_micro)).toBeGreaterThan(0n);
        expect(b.received_on).toMatch(/^2026-06-\d{2}$/);
      }
      for (const b of ds.opening.balances) {
        expect(ds.parties.some((p) => p.code === b.party_code)).toBe(true);
        expect(fromWire(b.amount_paisa)).toBeGreaterThan(0n);
      }
    });
    it("has exactly one item and one party with no Urdu name (R-29 point 5), and Urdu on the rest", () => {
      expect(ds.items.filter((i) => i.name_ur === null)).toHaveLength(1);
      expect(ds.parties.filter((p) => p.name_ur === null)).toHaveLength(1);
      expect(ds.items.every((i) => urduOrNull(i.name_ur))).toBe(true);
      expect(ds.parties.every((p) => urduOrNull(p.name_ur))).toBe(true);
    });
  });

  it("holds for any seed: unique codes and identifiers, well-formed ids, whole numbers as canonical text, every kind of party present (property)", () => {
    for (let n = 0; n < 40; n += 1) {
      const ds: DataSet = buildDataSet("DS-2", `seed-${String(n)}`);
      const ids = [ds.company.id, ...ds.locations.map((l) => l.id), ...ds.items.map((i) => i.id), ...ds.parties.map((p) => p.id)];
      expect(new Set(ids).size, `seed ${String(n)}`).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ds.items.map((i) => i.code)).size).toBe(20);
      expect(new Set(ds.parties.map((p) => p.code)).size).toBe(15);
      for (const kind of ["supplier", "customer", "carrier"]) expect(ds.parties.some((p) => p.kind === kind), `seed ${String(n)} ${kind}`).toBe(true);
      for (const p of ds.parties) expect(fromWire(p.credit_limit_paisa)).toBeGreaterThan(0n);
      for (const b of ds.opening.batches) expect(fromWire(b.qty_milli) % 1000n).toBe(0n);
    }
  });

  it("every name is English, and Urdu names are Urdu script (D-11)", () => {
    for (const id of ["DS-1", "DS-2"] as const) {
      const ds = buildDataSet(id);
      for (const x of [...ds.items, ...ds.parties, ...ds.locations]) expect(x.name_en.length).toBeGreaterThan(1);
      expect(/[\u0600-\u06ff]/.test(ds.company.name_ur)).toBe(true);
    }
  });
});

describe("fixtures are produced by tools, not by hand (TR-11)", () => {
  it("exports readable JSON with sorted keys and one trailing newline, and nothing is lost on the way back", () => {
    const text = exportFixture({ b: 1, a: { z: "x", c: [3, { y: 1, x: 2 }] } });
    expect(text).toBe('{\n  "a": {\n    "c": [\n      3,\n      {\n        "x": 2,\n        "y": 1\n      }\n    ],\n    "z": "x"\n  },\n  "b": 1\n}\n');
    const ds = buildDataSet("DS-2");
    expect(JSON.parse(exportFixture(ds))).toEqual(JSON.parse(JSON.stringify(ds)));
  });

  it("the data set files are what the builder makes (a change is deliberate: UPDATE_FIXTURES=1)", () => {
    checkFixture("ds-1.json", exportFixture(buildDataSet("DS-1")));
    checkFixture("ds-2.json", exportFixture(buildDataSet("DS-2")));
  });

  it("each schema version has its golden fixture; an applied migration that was edited shows up here (15.2, item 6)", () => {
    for (let n = 1; n <= MIGRATIONS.length; n += 1) {
      const fixture = exportFixture(schemaFixture(catalogueOf(MIGRATIONS.slice(0, n))));
      const file = new URL(`schema-v${String(n)}.json`, FIXTURES);
      // the newest version may be rewritten on request; an older version is written only if it is missing, never overwritten
      if (UPDATE && (n === MIGRATIONS.length || !existsSync(file))) writeFileSync(file, fixture);
      expect(readFileSync(file, "utf8"), `schema after migration ${String(n)}`).toBe(fixture);
    }
  });

  it("the schema fixture says what a table is: class, scope, columns, keys and indexes", () => {
    const fixture = schemaFixture(catalogueOf()) as { tables: { name: string; columns: { name: string }[]; foreign_keys: unknown[]; indexes: { name: string }[] }[] };
    const locations = fixture.tables.find((t) => t.name === "locations");
    expect(locations?.columns.map((c) => c.name)).toContain("company_id");
    expect(locations?.indexes.map((i) => i.name)).toContain("ux_locations__company_id_id");
    expect(locations?.foreign_keys.length).toBeGreaterThan(1);
  });
});
