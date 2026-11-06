import { DummyDriver, Kysely, sql, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type CompiledQuery } from "kysely";
import { describe, expect, it } from "vitest";
import { CompanyContextError } from "./errors";
import { catalogueOf } from "./migrations/scripts";
import type { PlatformDatabase } from "./model";
import { companyScopePlugin, installationScopePlugin } from "./scoped";

const COMPANY_TABLES = catalogueOf().companyTables();
const A = "0195f3a4-0000-7000-8000-00000000000a";
const B = "0195f3a4-0000-7000-8000-00000000000b";

const dummy = {
  createAdapter: () => new SqliteAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
  createQueryCompiler: () => new SqliteQueryCompiler(),
};
const scopedTo = (company: string) => new Kysely<PlatformDatabase>({ dialect: dummy, plugins: [companyScopePlugin(company, COMPANY_TABLES)] });
const installation = new Kysely<PlatformDatabase>({ dialect: dummy, plugins: [installationScopePlugin(COMPANY_TABLES)] });
const db = scopedTo(A);

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
const wall = /"company_id" = \?/g;
const compile = (q: { compile(): CompiledQuery }): { sql: string; parameters: readonly unknown[] } => q.compile();

describe("SELECT", () => {
  it("adds the company to WHERE, as a parameter", () => {
    const q = compile(db.selectFrom("locations").select("id"));
    expect(q.sql).toMatch(/from "locations" where "locations"\."company_id" = \?$/);
    expect(q.parameters).toEqual([A]);
  });

  it("keeps the caller's own conditions and adds the wall with AND", () => {
    const q = compile(db.selectFrom("locations").select("id").where("code", "=", "GD").where("is_active", "=", true));
    expect(q.sql).toMatch(/where "code" = \? and "is_active" = \? and "locations"\."company_id" = \?$/);
    expect(q.parameters).toEqual(["GD", true, A]);
  });

  it("a qualified condition the caller wrote themselves is recognised and not repeated; an unqualified one is not trusted", () => {
    expect(count(compile(db.selectFrom("locations").select("id").where("locations.company_id", "=", A)).sql, wall)).toBe(1);
    // an unqualified column could belong to any table in a join, so the wall is added anyway
    expect(count(compile(db.selectFrom("locations").select("id").where("company_id", "=", A)).sql, wall)).toBe(2);
  });

  it("another company's id written by the caller does not replace the wall: both apply, so nothing is returned", () => {
    const q = compile(db.selectFrom("locations").select("id").where("company_id", "=", B));
    expect(q.parameters).toEqual([B, A]);
    expect(count(q.sql, wall)).toBe(2);
  });

  it("a condition inside an OR is never trusted: the wall is still added", () => {
    const q = compile(db.selectFrom("locations").select("id").where((eb) => eb.or([eb("company_id", "=", A), eb("code", "=", "GD")])));
    expect(q.sql).toMatch(/\(("locations"\.)?"company_id" = \? or "code" = \?\) and "locations"\."company_id" = \?$/);
  });

  it("a different context gives a different parameter, and one context never leaks into another", () => {
    expect(compile(scopedTo(B).selectFrom("locations").select("id")).parameters).toEqual([B]);
    expect(compile(db.selectFrom("locations").select("id")).parameters).toEqual([A]);
  });

  it("uses the alias when the table has one", () => {
    const q = compile(db.selectFrom("locations as l").select("l.id"));
    expect(q.sql).toMatch(/where "l"\."company_id" = \?$/);
  });

  it("tables that are not behind the wall are left alone", () => {
    expect(compile(db.selectFrom("nodes").select("id")).sql).not.toMatch(/company_id/);
    expect(compile(db.selectFrom("owner_groups").select("id")).sql).not.toMatch(/company_id/);
    expect(compile(db.selectFrom("apply_guard").select("is_open")).sql).not.toMatch(/company_id/);
  });

  it("an inner join puts the joined table's company in ON and the main table's in WHERE", () => {
    const q = compile(db.selectFrom("locations as l").innerJoin("fiscal_years as f", "f.company_id", "l.company_id").select(["l.id", "f.code"]));
    expect(q.sql).toMatch(/inner join "fiscal_years" as "f" on "f"\."company_id" = "l"\."company_id" and "f"\."company_id" = \? where "l"\."company_id" = \?$/);
    expect(q.parameters).toEqual([A, A]);
  });

  it("a left join keeps its meaning: the joined table's company is in ON, not WHERE", () => {
    const q = compile(db.selectFrom("locations as l").leftJoin("fiscal_years as f", "f.company_id", "l.company_id").select(["l.id", "f.code"]));
    expect(q.sql).toMatch(/left join "fiscal_years" as "f" on "f"\."company_id" = "l"\."company_id" and "f"\."company_id" = \? where "l"\."company_id" = \?$/);
  });

  it("joining a company table to an installation table scopes only the company table", () => {
    const q = compile(db.selectFrom("locations as l").innerJoin("nodes as n", "n.id", "l.current_node_id").select(["l.id", "n.name"]));
    expect(count(q.sql, wall)).toBe(1);
    expect(q.sql).toMatch(/where "l"\."company_id" = \?$/);
  });

  it("scopes subqueries in WHERE, in the select list, and in CTEs", () => {
    const inWhere = compile(db.selectFrom("companies").select("id").where("id", "in", db.selectFrom("locations").select("company_id")));
    expect(count(inWhere.sql, wall)).toBe(2);
    const inList = compile(db.selectFrom("companies").select((eb) => eb.selectFrom("locations").select(eb.fn.countAll().as("n")).as("total")));
    expect(count(inList.sql, wall)).toBe(2);
    const cte = compile(db.with("mine", (qb) => qb.selectFrom("locations").select("id")).selectFrom("mine").select("id"));
    expect(count(cte.sql, wall)).toBe(1);
    expect(cte.parameters).toEqual([A]);
  });

  it("scopes a table in a derived table (subquery in FROM)", () => {
    const q = compile(db.selectFrom(db.selectFrom("locations").select("id").as("d")).select("d.id"));
    expect(count(q.sql, wall)).toBe(1);
  });

  it("a cross join to a company table is scoped in WHERE", () => {
    const q = compile(db.selectFrom("nodes as n").crossJoin("locations as l").select("l.id"));
    expect(q.sql).toMatch(/where "l"\."company_id" = \?$/);
  });

  it("refuses right and full joins on company tables (they would let rows of other companies through)", () => {
    expect(() => compile(db.selectFrom("locations as l").rightJoin("fiscal_years as f", "f.company_id", "l.company_id").select("l.id"))).toThrow(CompanyContextError);
    expect(() => compile(db.selectFrom("locations as l").fullJoin("fiscal_years as f", "f.company_id", "l.company_id").select("l.id"))).toThrow(/right and full joins/);
    expect(() => compile(db.selectFrom("nodes as n").fullJoin("locations as l", "l.current_node_id", "n.id").select("l.id"))).toThrow(CompanyContextError);
  });

  it("right and full joins between tables that are not behind the wall are fine", () => {
    expect(() => compile(db.selectFrom("nodes as n").rightJoin("devices as d", "d.node_id", "n.id").select("d.id"))).not.toThrow();
  });
});

describe("UPDATE and DELETE", () => {
  it("UPDATE only touches the company's rows", () => {
    const q = compile(db.updateTable("locations").set({ name_en: "X" }).where("code", "=", "GD"));
    expect(q.sql).toMatch(/where "code" = \? and "locations"\."company_id" = \?$/);
    expect(q.parameters).toEqual(["X", "GD", A]);
  });

  it("UPDATE of every row is still only the company's", () => {
    expect(compile(db.updateTable("locations").set({ is_active: false })).sql).toMatch(/where "locations"\."company_id" = \?$/);
  });

  it("UPDATE with an alias", () => {
    const q = compile(db.updateTable("locations as l").set({ name_en: "X" }));
    expect(q.sql).toMatch(/where "l"\."company_id" = \?$/);
  });

  it("company_id cannot be changed", () => {
    expect(() => compile(db.updateTable("locations").set({ company_id: B }))).toThrow(CompanyContextError);
    expect(() => compile(db.updateTable("locations").set({ company_id: B }))).toThrow(/company_id cannot be changed/);
  });

  it("DELETE only touches the company's rows", () => {
    const q = compile(db.deleteFrom("fiscal_years").where("code", "=", "FY27"));
    expect(q.sql).toMatch(/where "code" = \? and "fiscal_years"\."company_id" = \?$/);
    expect(compile(db.deleteFrom("fiscal_years")).sql).toMatch(/where "fiscal_years"\."company_id" = \?$/);
  });

  it("UPDATE and DELETE on tables outside the wall are unchanged", () => {
    expect(compile(db.updateTable("nodes").set({ name: "x" })).sql).not.toMatch(/company_id/);
    expect(compile(db.deleteFrom("devices")).sql).not.toMatch(/company_id/);
  });

  it("scopes subqueries inside an UPDATE", () => {
    const q = compile(db.updateTable("locations").set({ name_en: "X" }).where("id", "in", db.selectFrom("fiscal_years").select("company_id")));
    expect(count(q.sql, wall)).toBe(2);
  });
});

const NOW = "2026-07-01T00:00:00.000Z";
const location = { id: "0195f3a4-0000-7000-8000-000000000001", code: "GD", name_en: "G", name_ur: "گ", kind: "godown", authority_kind: "site_node", updated_at: NOW, updated_by_user_id: null } as const;

describe("INSERT", () => {
  it("fills in company_id", () => {
    const q = compile(db.insertInto("locations").values(location));
    expect(q.sql).toMatch(/\("id", "code", "name_en", "name_ur", "kind", "authority_kind", "updated_at", "updated_by_user_id", "company_id"\) values/);
    expect(q.parameters.at(-1)).toBe(A);
  });

  it("fills in company_id for every row of a multi-row insert", () => {
    const q = compile(db.insertInto("locations").values([location, { ...location, id: "0195f3a4-0000-7000-8000-000000000002", code: "SH" }]));
    expect(q.parameters.filter((p) => p === A)).toHaveLength(2);
  });

  it("accepts a company_id that is the context's, once, in place", () => {
    const q = compile(db.insertInto("locations").values({ ...location, company_id: A }));
    expect(count(q.sql, /"company_id"/g)).toBe(1);
    expect(q.parameters.filter((p) => p === A)).toHaveLength(1);
  });

  it("refuses a company_id that is another company's, in any row", () => {
    expect(() => compile(db.insertInto("locations").values({ ...location, company_id: B }))).toThrow(CompanyContextError);
    expect(() => compile(db.insertInto("locations").values([location, { ...location, id: "0195f3a4-0000-7000-8000-000000000003", company_id: B }]))).toThrow(/not the context's/);
  });

  it("refuses insert-from-select and default values on company tables", () => {
    expect(() => compile(db.insertInto("locations").columns(["id"]).expression(db.selectFrom("locations").select("id")))).toThrow(CompanyContextError);
    expect(() => compile(db.insertInto("locations").defaultValues())).toThrow(/explicit values/);
  });

  it("an upsert's DO UPDATE only touches the company's own row, even when the conflict is on id alone", () => {
    const q = compile(db.insertInto("locations").values(location).onConflict((oc) => oc.column("id").doUpdateSet({ name_en: "H" })));
    expect(q.sql).toMatch(/on conflict \("id"\) do update set "name_en" = \? where "locations"\."company_id" = \?$/);
    expect(q.parameters.at(-1)).toBe(A);
  });

  it("an upsert cannot change company_id; DO NOTHING is untouched", () => {
    expect(() => compile(db.insertInto("locations").values(location).onConflict((oc) => oc.column("id").doUpdateSet({ company_id: B })))).toThrow(/company_id cannot be changed/);
    expect(compile(db.insertInto("locations").values(location).onConflict((oc) => oc.column("id").doNothing())).sql).toMatch(/on conflict \("id"\) do nothing$/);
  });

  it("inserting into a table outside the wall adds nothing", () => {
    const q = compile(db.insertInto("nodes").values({ id: "0195f3a4-0000-7000-8000-000000000009", kind: "site_node", name: "n", updated_at: NOW }));
    expect(q.sql).not.toMatch(/company_id/);
  });
});

describe("the installation handle", () => {
  it("allows tables outside the wall", () => {
    for (const q of [installation.selectFrom("nodes").select("id"), installation.selectFrom("owner_groups").select("id"), installation.selectFrom("devices").innerJoin("nodes", "nodes.id", "devices.node_id").select("devices.id"), installation.selectFrom("schema_migrations").select("id"), installation.selectFrom("apply_guard").select("id")]) {
      expect(() => compile(q)).not.toThrow();
    }
  });

  it("refuses every company table, in any position", () => {
    expect(() => compile(installation.selectFrom("companies").select("id"))).toThrow(CompanyContextError);
    expect(() => compile(installation.selectFrom("nodes").innerJoin("locations", "locations.current_node_id", "nodes.id").select("nodes.id"))).toThrow(/company table: it needs a company context/);
    expect(() => compile(installation.deleteFrom("audit_events"))).toThrow(CompanyContextError);
    expect(() => compile(installation.updateTable("fiscal_years").set({ code: "x" }))).toThrow(CompanyContextError);
    expect(() => compile(installation.insertInto("locations").values(location))).toThrow(CompanyContextError);
    expect(() => compile(installation.selectFrom("nodes").select("id").where("id", "in", installation.selectFrom("locations").select("id")))).toThrow(CompanyContextError);
  });
});

describe("raw SQL cannot be analysed (the lint rule mandi/no-raw-sql is the guard for it)", () => {
  it("a raw fragment inside a scoped query is passed through unchanged", () => {
    const q = compile(db.selectFrom("nodes").select(sql<number>`1`.as("one")));
    expect(q.sql).not.toMatch(/company_id/);
  });
});
