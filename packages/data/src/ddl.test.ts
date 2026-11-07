import { describe, expect, it } from "vitest";
import { Catalogue, col, dflt, table } from "./catalogue/define";
import { appendOnlyTriggers, createTable, foreignKeysOf, guardTriggers, ident, indexesOf, postgresFunctions, seedApplyGuard } from "./migrations/ddl";
import { catalogueOf, MIGRATIONS, statementsOf } from "./migrations/scripts";

const parent = table({ name: "godowns", class: 3, scope: "company", columns: [col.text("code")], indexes: [{ columns: ["code"], unique: true }] });
const node = table({ name: "boxes", class: 3, scope: "installation", columns: [col.text("name")] });
const child = table({
  name: "bags",
  class: 2,
  scope: "company",
  columns: [col.ref("godown_id", "godowns"), col.ref("box_id", "boxes", { null: true }), col.ref("user_id", "users", { null: true, pending: true }), col.enum("grade", ["a", "b"] as const, { default: dflt.text("a") })],
  indexes: [{ columns: ["godown_id"], unique: false }],
});
const nodes = table({ name: "nodes", class: 3, scope: "installation", columns: [col.text("name")] });
const catalogue = new Catalogue([parent, node, nodes, child]);

describe("identifiers", () => {
  it("quote a plain name and refuse anything else", () => {
    expect(ident("company_id")).toBe('"company_id"');
    for (const bad of ["", "Company", "1abc", "a-b", "a b", 'a"b', "a;drop", "x".repeat(64)]) expect(() => ident(bad)).toThrow(/not a valid identifier/);
    expect(ident("x".repeat(63))).toHaveLength(65);
  });
});

describe("foreign keys (document 06, D-4)", () => {
  it("company tables refer to each other with composite keys and to their company by company_id", () => {
    expect(foreignKeysOf(child, catalogue)).toEqual([
      { name: "fk_bags__company", columns: ["company_id"], refTable: "companies", refColumns: ["id"] },
      { name: "fk_bags__godown_id", columns: ["company_id", "godown_id"], refTable: "godowns", refColumns: ["company_id", "id"] },
      { name: "fk_bags__box_id", columns: ["box_id"], refTable: "boxes", refColumns: ["id"] },
      { name: "fk_bags__updated_by_node_id", columns: ["updated_by_node_id"], refTable: "nodes", refColumns: ["id"] },
    ]);
  });

  it("a table that is itself the company has no company key; installation tables have none", () => {
    expect(foreignKeysOf(node, catalogue)).toEqual([]);
    expect(foreignKeysOf(table({ name: "companies", class: 3, scope: "company", columns: [] }), new Catalogue([])).map((f) => f.name)).toEqual([]);
  });

  it("a pending reference is skipped until its table exists, then required", () => {
    expect(foreignKeysOf(child, catalogue).some((f) => f.name === "fk_bags__user_id")).toBe(false);
    const users = table({ name: "users", class: 3, scope: "company", columns: [col.text("login")] });
    expect(foreignKeysOf(child, catalogue.with([users])).find((f) => f.name === "fk_bags__user_id")).toEqual({ name: "fk_bags__user_id", columns: ["company_id", "user_id"], refTable: "users", refColumns: ["company_id", "id"] });
  });

  it("refuses a reference to an unknown table that is not pending, and a non-company table referring to a company table", () => {
    const lost = table({ name: "lost", class: 3, scope: "company", columns: [col.ref("x_id", "nowhere")] });
    expect(() => foreignKeysOf(lost, catalogue)).toThrow(/unknown table nowhere/);
    const wrong = table({ name: "wrong", class: 3, scope: "installation", columns: [col.ref("g_id", "godowns")] });
    expect(() => foreignKeysOf(wrong, catalogue)).toThrow(/cannot refer to company table godowns/);
  });

  it("a table may refer to itself", () => {
    const tree = table({ name: "tree", class: 3, scope: "company", columns: [col.ref("parent_id", "tree", { null: true })] });
    expect(foreignKeysOf(tree, new Catalogue([tree])).find((f) => f.name === "fk_tree__parent_id")?.refTable).toBe("tree");
  });
});

describe("indexes", () => {
  it("company_id is first in every index, and (company_id, id) is always unique", () => {
    expect(indexesOf(child)).toEqual([
      { name: "ux_bags__company_id_id", columns: ["company_id", "id"], unique: true },
      { name: "ix_bags__company_id_godown_id", columns: ["company_id", "godown_id"], unique: false },
    ]);
    expect(indexesOf(parent)[1]).toEqual({ name: "ux_godowns__company_id_code", columns: ["company_id", "code"], unique: true });
  });
  it("installation tables get only the indexes they ask for", () => {
    expect(indexesOf(node)).toEqual([]);
    expect(indexesOf(table({ name: "devs", class: 3, scope: "installation", columns: [col.text("code")], indexes: [{ columns: ["code"], unique: true }] }))).toEqual([{ name: "ux_devs__code", columns: ["code"], unique: true }]);
  });
});

describe("createTable", () => {
  it("SQLite: strict table, forms checked in place of types, composite keys, triggers none for class 2", () => {
    const [create, ...rest] = createTable(child, "sqlite", catalogue);
    expect(create).toMatch(/\) STRICT$/);
    expect(create).toMatch(/"id" TEXT NOT NULL/);
    expect(create).toMatch(/"company_id" TEXT NOT NULL/);
    expect(create).toMatch(/"version" INTEGER NOT NULL DEFAULT 1/);
    expect(create).toMatch(/"is_active" INTEGER NOT NULL DEFAULT 1/);
    expect(create).toMatch(/"field_versions_json" TEXT NOT NULL DEFAULT '\{\}'/);
    expect(create).toMatch(/"grade" TEXT NOT NULL DEFAULT 'a'/);
    expect(create).toMatch(/CONSTRAINT "pk_bags" PRIMARY KEY \("id"\)/);
    expect(create).toMatch(/CONSTRAINT "fk_bags__godown_id" FOREIGN KEY \("company_id", "godown_id"\) REFERENCES "godowns" \("company_id", "id"\)/);
    expect(create).toMatch(/CONSTRAINT "ck_bags_id__id" CHECK \("id" = lower\("id"\) AND length\("id"\) = 36\)/);
    expect(create).toMatch(/CONSTRAINT "ck_bags_updated_at__ts" CHECK \("updated_at" GLOB/);
    expect(create).toMatch(/CONSTRAINT "ck_bags_is_active__bool" CHECK \("is_active" IN \(0, 1\)\)/);
    expect(create).toMatch(/CONSTRAINT "ck_bags_field_versions_json__json" CHECK \(json_valid\("field_versions_json"\)\)/);
    expect(create).toMatch(/CONSTRAINT "ck_bags_grade__enum" CHECK \("grade" IN \('a', 'b'\)\)/);
    expect(create).toMatch(/CONSTRAINT "ck_bags_version_positive__rule" CHECK \(version >= 1\)/);
    expect(rest).toHaveLength(2);
    expect(rest.every((s) => /^CREATE (UNIQUE )?INDEX/.test(s))).toBe(true);
  });

  it("PostgreSQL: native types, no form checks except enumerations", () => {
    const [create] = createTable(child, "postgres", catalogue);
    expect(create).not.toMatch(/STRICT/);
    expect(create).toMatch(/"id" uuid NOT NULL/);
    expect(create).toMatch(/"version" bigint NOT NULL DEFAULT 1/);
    expect(create).toMatch(/"is_active" boolean NOT NULL DEFAULT true/);
    expect(create).toMatch(/"field_versions_json" jsonb NOT NULL DEFAULT '\{\}'/);
    expect(create).toMatch(/"updated_at" timestamptz NOT NULL/);
    expect(create).toMatch(/CONSTRAINT "ck_bags_grade__enum" CHECK/);
    expect(create).not.toMatch(/__ts"|__bool"|__json"|__id"/);
  });

  it("can ask for IF NOT EXISTS (used only for schema_migrations)", () => {
    expect(createTable(node, "sqlite", catalogue, { ifNotExists: true })[0]).toMatch(/^CREATE TABLE IF NOT EXISTS "boxes"/);
  });

  it("class 1 gets immutability triggers, class P gets the guard triggers, others get none", () => {
    const facts = table({ name: "facts", class: 1, scope: "company", columns: [] });
    const proj = table({ name: "stock", class: "P", scope: "company", columns: [] });
    const cat = new Catalogue([facts, proj, child, parent, node, nodes]);
    expect(createTable(facts, "sqlite", cat).filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(2);
    expect(createTable(facts, "postgres", cat).filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(3); // plus TRUNCATE
    expect(createTable(proj, "sqlite", cat).filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(3);
    expect(createTable(proj, "postgres", cat).filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(3);
    expect(createTable(child, "sqlite", cat).some((s) => s.startsWith("CREATE TRIGGER"))).toBe(false);
  });

  it("refuses an enumeration value that is not a plain word", () => {
    const bad = table({ name: "bad", class: 3, scope: "company", columns: [col.enum("k", ["ok", "no'way"])] });
    expect(() => createTable(bad, "sqlite", new Catalogue([bad]))).toThrow(/bad enumeration value/);
  });

  it("a default text with a quote is escaped", () => {
    const t = table({ name: "quotes", class: 3, scope: "installation", columns: [col.text("x", { default: dflt.text("it's") })] });
    expect(createTable(t, "sqlite", new Catalogue([t]))[0]).toMatch(/DEFAULT 'it''s'/);
  });
});

describe("triggers and helpers", () => {
  it("append-only triggers refuse update and delete with a message naming the table", () => {
    const [update, del] = appendOnlyTriggers("audit_events", "sqlite");
    expect(update).toMatch(/BEFORE UPDATE ON "audit_events" BEGIN SELECT RAISE\(ABORT, 'class 1 table is append-only: audit_events'\); END/);
    expect(del).toMatch(/BEFORE DELETE ON "audit_events"/);
    expect(appendOnlyTriggers("audit_events", "postgres").map((s) => /BEFORE (\w+) ON/.exec(s)?.[1])).toEqual(["UPDATE", "DELETE", "TRUNCATE"]);
  });

  it("guard triggers check apply_guard", () => {
    const s = guardTriggers("stock", "sqlite");
    expect(s).toHaveLength(3);
    expect(s[0]).toMatch(/BEFORE INSERT ON "stock" WHEN \(SELECT is_open FROM apply_guard WHERE id = 1\) = 0 BEGIN SELECT RAISE\(ABORT, 'projection table is written only by applyBundle: stock'\)/);
    expect(guardTriggers("stock", "postgres")[2]).toMatch(/BEFORE DELETE ON "stock" FOR EACH ROW EXECUTE FUNCTION mandi_require_apply_guard\(\)/);
  });

  it("the PostgreSQL functions and the guard seed", () => {
    expect(postgresFunctions()).toHaveLength(2);
    expect(postgresFunctions()[0]).toMatch(/mandi_raise_append_only/);
    expect(postgresFunctions()[1]).toMatch(/mandi_require_apply_guard/);
    expect(seedApplyGuard("sqlite")).toMatch(/VALUES \(1, 0\)$/);
    expect(seedApplyGuard("postgres")).toMatch(/VALUES \(1, false\)$/);
  });
});

describe("migration 1", () => {
  it("produces the same tables for both databases, in an order foreign keys allow", () => {
    const names = (kind: "sqlite" | "postgres") =>
      statementsOf(MIGRATIONS[0]!, kind, [])
        .map((s) => /^CREATE TABLE "(\w+)"/.exec(s)?.[1])
        .filter((n): n is string => n !== undefined);
    expect(names("sqlite")).toEqual(names("postgres"));
    expect(names("sqlite")).toEqual(["apply_guard", "owner_groups", "nodes", "devices", "companies", "locations", "bundles", "location_authorities", "fiscal_years", "audit_events"]);
  });

  it("the catalogue is schema_migrations plus the tables of migrations 1 and 2", () => {
    expect(catalogueOf().tables.map((t) => t.name)).toEqual(["schema_migrations", "apply_guard", "owner_groups", "nodes", "devices", "companies", "locations", "bundles", "location_authorities", "fiscal_years", "audit_events", "number_series", "lost_numbers", "exceptions", "node_chain_heads"]);
    expect(catalogueOf().companyTables()).toEqual(new Set(["companies", "locations", "bundles", "location_authorities", "fiscal_years", "audit_events", "number_series", "lost_numbers", "exceptions"]));
  });

  it("only audit_events is class 1 here, and every statement of the PostgreSQL migration is a single statement", () => {
    expect(catalogueOf().tables.filter((t) => t.class === 1).map((t) => t.name)).toEqual(["audit_events"]);
    for (const s of statementsOf(MIGRATIONS[0]!, "postgres", [])) expect(s.includes(";") ? /\$\$/.test(s) : true).toBe(true);
  });
});
