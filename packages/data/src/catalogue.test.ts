import type { Selectable } from "kysely";
import { describe, expect, it } from "vitest";
import { Catalogue, col, table } from "./catalogue/define";
import { catalogueOf } from "./migrations/scripts";
import type { PlatformDatabase } from "./model";

describe("the table builder (document 06, 2.3)", () => {
  it("adds id and company_id to a company table, only id to an installation table, nothing to a system table", () => {
    expect(table({ name: "a", class: 3, scope: "company", columns: [] }).columns.map((c) => c.name)).toEqual(["id", "company_id", "version", "updated_at", "updated_by_user_id"]);
    expect(table({ name: "a", class: 3, scope: "installation", columns: [] }).columns.map((c) => c.name)).toEqual(["id", "version", "updated_at", "updated_by_user_id"]);
    expect(table({ name: "a", class: "S", scope: "system", columns: [col.int("id")] }).columns.map((c) => c.name)).toEqual(["id"]);
  });

  it("class 1 gets bundle_id and created_at; class 2 gets the master data columns; projections and summaries get none", () => {
    expect(table({ name: "a", class: 1, scope: "company", columns: [] }).columns.map((c) => c.name)).toEqual(["id", "company_id", "bundle_id", "created_at"]);
    expect(table({ name: "a", class: 2, scope: "company", columns: [] }).columns.map((c) => c.name)).toEqual(["id", "company_id", "version", "field_versions_json", "updated_at", "updated_by_node_id", "is_active"]);
    expect(table({ name: "a", class: "P", scope: "company", columns: [] }).columns.map((c) => c.name)).toEqual(["id", "company_id"]);
    expect(table({ name: "a", class: 4, scope: "company", columns: [] }).columns.map((c) => c.name)).toEqual(["id", "company_id"]);
  });

  it("classes 2 and 3 get the version check; the others do not", () => {
    expect(table({ name: "a", class: 3, scope: "company", columns: [] }).checks).toEqual([{ name: "version_positive", rule: "version >= 1" }]);
    expect(table({ name: "a", class: 2, scope: "company", columns: [] }).checks).toEqual([{ name: "version_positive", rule: "version >= 1" }]);
    expect(table({ name: "a", class: 1, scope: "company", columns: [] }).checks).toEqual([]);
  });

  it("the standard foreign-key columns point where document 06 says (bundle pending, user pending, node real)", () => {
    const c1 = table({ name: "a", class: 1, scope: "company", columns: [] });
    expect(c1.columns.find((c) => c.name === "bundle_id")?.references).toEqual({ table: "bundles", pending: true });
    const c3 = table({ name: "a", class: 3, scope: "company", columns: [] });
    expect(c3.columns.find((c) => c.name === "updated_by_user_id")).toMatchObject({ nullable: true, references: { table: "users", pending: true } });
    const c2 = table({ name: "a", class: 2, scope: "company", columns: [] });
    expect(c2.columns.find((c) => c.name === "updated_by_node_id")?.references).toEqual({ table: "nodes" });
  });
});

describe("the catalogue", () => {
  it("refuses two tables with one name, and finds tables by name", () => {
    const t = table({ name: "x", class: 3, scope: "installation", columns: [] });
    expect(() => new Catalogue([t, t])).toThrow(/one name/);
    expect(new Catalogue([t]).get("x")).toBe(t);
    expect(new Catalogue([t]).has("y")).toBe(false);
  });

  it("every table name and column name is a plain snake_case word (document 06, 2.4) and every column is unique in its table", () => {
    for (const t of catalogueOf().tables) {
      expect(t.name, t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      const names = t.columns.map((c) => c.name);
      expect(new Set(names).size, `${t.name} has a repeated column`).toBe(names.length);
      for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
      if (t.name !== "companies") for (const c of t.columns.filter((x) => x.references !== undefined)) expect(c.name, `${t.name}.${c.name}`).toMatch(/_id$/);
    }
  });

  it("D-11: every master-like platform table that names things has an English and an Urdu name", () => {
    for (const name of ["owner_groups", "companies", "locations"]) {
      const names = catalogueOf().get(name)?.columns.map((c) => c.name) ?? [];
      expect(names).toContain("name_en");
      expect(names).toContain("name_ur");
    }
  });

  it("no column is a floating-point or decimal kind: the logical types have no such member (D-6)", () => {
    const types = new Set(catalogueOf().tables.flatMap((t) => t.columns.map((c) => c.type)));
    for (const type of types) expect(["id", "int64", "text", "date", "ts", "bool", "json", "enum"]).toContain(type);
  });
});

/** Compile-time and run-time agreement between the typed model (model.ts) and the catalogue. */
const sample: { [K in keyof PlatformDatabase]: Selectable<PlatformDatabase[K]> } = {
  owner_groups: { id: "", name_en: "", name_ur: "", version: 1n, updated_at: "", updated_by_user_id: null },
  nodes: { id: "", kind: "cloud", name: "", public_key: null, status: "pending", enrolled_at: null, app_version: null, last_seen_at: null, version: 1n, updated_at: "", updated_by_user_id: null },
  devices: { id: "", node_id: "", kind: "android", code: "", name: "", public_key: null, status: "pending", enrolled_at: null, app_version: null, last_seen_at: null, version: 1n, updated_at: "", updated_by_user_id: null },
  companies: { id: "", company_id: "", owner_group_id: "", code: "", name_en: "", name_ur: "", legal_form: null, ntn: null, strn: null, registration_date: null, fiscal_year_start_month: 7n, settings_version: 0n, is_active: true, version: 1n, updated_at: "", updated_by_user_id: null },
  locations: { id: "", company_id: "", code: "", name_en: "", name_ur: "", kind: "godown", authority_kind: "cloud", current_node_id: null, current_epoch: 1n, is_active: true, version: 1n, updated_at: "", updated_by_user_id: null },
  location_authorities: { id: "", company_id: "", location_id: "", node_id: "", epoch: 1n, started_at: "", ended_at: null, reason: null, version: 1n, updated_at: "", updated_by_user_id: null },
  fiscal_years: { id: "", company_id: "", code: "", start_date: "", end_date: "", status: "open", version: 1n, updated_at: "", updated_by_user_id: null },
  audit_events: { id: "", company_id: "", user_id: null, node_id: null, device_id: null, entity: "", entity_id: "", action: "", detail_json: "{}", bundle_id: "", created_at: "" },
  bundles: { id: "", company_id: "", location_id: null, node_id: "", epoch: 1n, node_seq: 1n, prev_hash: "", hash: "", schema_version: 1n, kind: "document", payload_json: "{}", created_at: "", state: "pending", central_seq: null, acked_at: null, signature: null },
  number_series: { id: "", company_id: "", location_id: "", device_id: "", doc_type: "", fiscal_year_code: "", prefix: "", padding: 6n, next_number: 1n, last_issued_at: null },
  lost_numbers: { id: "", company_id: "", series_key_json: "{}", number_from: 1n, number_to: 1n, reason: "restore", recorded_at: "" },
  exceptions: { id: "", company_id: "", bundle_id: null, reason_code: "other", detail: "", state: "open", created_at: "", resolved_by_user_id: null, resolved_at: null, resolution_note: null },
  node_chain_heads: { id: "", node_id: "", last_seq: 1n, last_hash: "", updated_at: "" },
  apply_guard: { id: 1n, is_open: false },
  schema_migrations: { id: 1n, name: "", checksum: "", applied_at: "" },
};

describe("the typed model matches the catalogue", () => {
  it("has exactly the tables of the catalogue, and exactly their columns", () => {
    expect(Object.keys(sample).sort()).toEqual(catalogueOf().tables.map((t) => t.name).sort());
    for (const t of catalogueOf().tables) {
      expect(Object.keys(sample[t.name as keyof PlatformDatabase]).sort(), t.name).toEqual(t.columns.map((c) => c.name).sort());
    }
  });
});
