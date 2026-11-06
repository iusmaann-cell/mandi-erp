import { createTestRuntime } from "@mandi/core";
import { INT64_MAX } from "@mandi/numeric";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanyContextError } from "./errors";
import { withApplyGuard } from "./guard";
import { checksumOf, MigrationError } from "./migrations/runner";
import { catalogueOf, MIGRATIONS } from "./migrations/scripts";
import { MIGRATION_2_EDITED, WITH_BAD_SCHEMA, WITH_TEST_TABLES } from "./migrations/test-fixtures";
import { checkSchema, diffSnapshots } from "./schema-test";
import type { DataStore } from "./store";
import { createTestDatabase, seedWorld, startTestPostgres, type TestDatabase, type TestPostgres } from "./testing";
import type { UntypedDb } from "./model";
import { decodeValue, PHYSICAL_TYPE, type DbKind } from "./types";
import { decodeRow } from "./rows";

/**
 * Document 09, TL-4: the same tests on SQLite and on a real PostgreSQL server. A rule that works on
 * one and not the other fails here (failure mode F-5).
 */
const KINDS: readonly DbKind[] = ["sqlite", "postgres"];
let pg: TestPostgres;
const opened: DataStore[] = [];

beforeAll(async () => {
  pg = await startTestPostgres();
}, 180_000);
afterAll(async () => {
  for (const store of opened) await store.close();
  await pg.stop();
});

const database = (kind: DbKind): Promise<TestDatabase> => createTestDatabase(kind, pg);
function track(store: DataStore): DataStore {
  opened.push(store);
  return store;
}
async function fresh(kind: DbKind, migrations = MIGRATIONS): Promise<DataStore> {
  const store = track((await database(kind)).open({ migrations }));
  await store.migrate();
  return store;
}
const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (e) {
    return e instanceof MigrationError ? e.code : e instanceof Error ? e.name : "other";
  }
  return "no error";
};
const now = new Date(createTestRuntime({ seed: "contract" }).clock.nowMs()).toISOString();

describe.each(KINDS)("migrations on %s", (kind) => {
  it("applies migration 1 and records its name, checksum and time", async () => {
    const store = track((await database(kind)).open());
    expect(await store.migrate()).toEqual({ applied: [1], alreadyApplied: [] });
    const rows = await store.installation().selectFrom("schema_migrations").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1n, name: "platform_tables", applied_at: now });
    expect(rows[0]?.checksum).toBe(checksumOf(MIGRATIONS[0]!, kind, []));
  });

  it("running again changes nothing", async () => {
    const store = await fresh(kind);
    expect(await store.migrate()).toEqual({ applied: [], alreadyApplied: [1] });
    expect(await store.installation().selectFrom("schema_migrations").select("id").execute()).toHaveLength(1);
  });

  it("golden checksum of migration 1: it must never be edited after release; change means a new migration", () => {
    expect(checksumOf(MIGRATIONS[0]!, kind, [])).toBe(GOLDEN_CHECKSUM[kind]);
  });

  it("a later migration is applied alone, on top of the earlier one, by a newer program", async () => {
    const db = await database(kind);
    const old = track(db.open());
    await old.migrate();
    const newer = track(db.open({ migrations: WITH_TEST_TABLES }));
    expect(await newer.migrate()).toEqual({ applied: [2], alreadyApplied: [1] });
    const names = (await newer.readSchema()).tables.map((t) => t.name);
    expect(names).toContain("test_facts");
    expect(names).toContain("test_projection");
  });

  it("an applied migration whose script has changed stops the run (checksum)", async () => {
    const db = await database(kind);
    const first = track(db.open({ migrations: WITH_TEST_TABLES }));
    await first.migrate();
    expect(await codeOf(track(db.open({ migrations: MIGRATION_2_EDITED })).migrate())).toBe("checksum_mismatch");
  });

  it("a stored checksum that was edited in the database stops the run", async () => {
    const store = await fresh(kind);
    await store.installation().updateTable("schema_migrations").set({ checksum: "0".repeat(64) }).where("id", "=", 1n).execute();
    expect(await codeOf(store.migrate())).toBe("checksum_mismatch");
  });

  it("a database newer than the program is refused (the program must be updated)", async () => {
    const db = await database(kind);
    await track(db.open({ migrations: WITH_TEST_TABLES })).migrate();
    expect(await codeOf(track(db.open()).migrate())).toBe("unknown_migration");
  });

  it("a renamed migration is refused", async () => {
    const store = await fresh(kind);
    await store.installation().updateTable("schema_migrations").set({ name: "something_else" }).where("id", "=", 1n).execute();
    expect(await codeOf(store.migrate())).toBe("name_mismatch");
  });

  it("a gap in the applied migrations is refused", async () => {
    const store = await fresh(kind);
    await store.installation().insertInto("schema_migrations").values({ id: 3n, name: "x", checksum: "y", applied_at: now }).execute();
    expect(await codeOf(store.migrate())).toBe("gap");
  });
});

// Checksums of migration 1 as first released. Pinned so that an edit to an applied migration is a visible, deliberate act.
const GOLDEN_CHECKSUM: Record<DbKind, string> = {
  sqlite: "b36ae045b72c812d2a9ca5534966e985fd3bb262ba294be4c544ec33715c980f",
  postgres: "0bf4fa06c2fb2f13bcefc479f972f8cadd6956ad30feb658a5b2352699af5d43",
};

describe.each(KINDS)("the schema test on %s (document 06, section 12)", (kind) => {
  it("finds no violation in the migrated schema", async () => {
    const store = await fresh(kind);
    expect(checkSchema(await store.readSchema(), catalogueOf())).toEqual([]);
  });

  it("reads every table, with the physical types of the type map", async () => {
    const store = await fresh(kind);
    const schema = await store.readSchema();
    expect(schema.tables.map((t) => t.name).sort()).toEqual(catalogueOf().tables.map((t) => t.name).sort());
    const companies = schema.tables.find((t) => t.name === "companies");
    const physical = (name: string) => companies?.columns.find((c) => c.name === name)?.physicalType.toLowerCase();
    if (kind === "sqlite") {
      expect([physical("id"), physical("settings_version"), physical("updated_at"), physical("is_active"), physical("name_en")]).toEqual(["text", "integer", "text", "integer", "text"]);
    } else {
      expect([physical("id"), physical("settings_version"), physical("updated_at"), physical("is_active"), physical("name_en")]).toEqual(["uuid", "bigint", "timestamp with time zone", "boolean", "text"]);
    }
    expect(PHYSICAL_TYPE[kind].int64.toLowerCase()).toBe(kind === "sqlite" ? "integer" : "bigint");
  });

  it("derives the logical type of every column of a sample table the same way", async () => {
    const store = await fresh(kind);
    const companies = (await store.readSchema()).tables.find((t) => t.name === "companies");
    const logical = Object.fromEntries(companies?.columns.map((c) => [c.name, c.logicalType]) ?? []);
    expect(logical).toMatchObject({ id: "id", company_id: "id", code: "text", legal_form: "enum", registration_date: "date", settings_version: "int64", is_active: "bool", updated_at: "ts" });
  });

  it("every foreign key between company tables is composite with company_id, and company_id is first in every company index", async () => {
    const store = await fresh(kind);
    const schema = await store.readSchema();
    const company = new Set(schema.tables.filter((t) => t.columns.some((c) => c.name === "company_id")).map((t) => t.name));
    for (const table of schema.tables.filter((t) => company.has(t.name))) {
      for (const fk of table.foreignKeys.filter((f) => company.has(f.refTable) && f.refTable !== "companies")) {
        expect(fk.columns[0], `${table.name} -> ${fk.refTable}`).toBe("company_id");
        expect(fk.refColumns[0]).toBe("company_id");
      }
      for (const index of table.indexes) expect(index.columns[0], `${table.name}.${index.name}`).toBe("company_id");
    }
  });

  it("FAILS on every kind of damage: float column, missing triggers, simple foreign key, missing company_id, bad index, installation table pointing at a company table", async () => {
    const store = await fresh(kind, WITH_BAD_SCHEMA);
    const catalogue = catalogueOf(WITH_BAD_SCHEMA).with([{ name: "bad_no_company", class: 3, scope: "company", columns: [{ name: "id", type: "id", nullable: false }, { name: "company_id", type: "id", nullable: false }], checks: [], indexes: [] }]);
    const violations = checkSchema(await store.readSchema(), catalogue);
    const has = (rule: string, table: string) => violations.some((v) => v.rule === rule && v.table === table);
    expect(has("floating-point", "bad_float"), "float column").toBe(true);
    expect(has("class1-triggers", "bad_facts"), "class 1 without triggers").toBe(true);
    expect(has("projection-guard", "bad_projection"), "projection without guard").toBe(true);
    expect(has("composite-fk", "bad_child"), "simple foreign key between company tables").toBe(true);
    expect(has("company-id", "bad_no_company"), "company table without company_id").toBe(true);
    expect(has("index-company-first", "locations"), "index that does not start with company_id").toBe(true);
    expect(has("installation-fk", "bad_installation"), "installation table pointing at a company table").toBe(true);
    expect(has("unknown-table", "bad_float"), "table not in the catalogue").toBe(true);
    expect(has("index-mismatch", "locations"), "extra index").toBe(true);
    expect(violations.length).toBeGreaterThan(10);
  });
});

describe("one schema on two databases (document 06, D-12)", () => {
  it("SQLite and PostgreSQL have identical schemas: same tables, columns, logical types, keys, indexes, triggers and checks", async () => {
    const a = await (await fresh("sqlite")).readSchema();
    const b = await (await fresh("postgres")).readSchema();
    expect(diffSnapshots(a, b)).toEqual([]);
    expect(a.tables.length).toBe(b.tables.length);
  });

  it("the comparison does find a difference when one database has an extra table, trigger or column", async () => {
    const a = await (await fresh("sqlite")).readSchema();
    const b = await (await fresh("postgres", WITH_TEST_TABLES)).readSchema();
    const diff = diffSnapshots(a, b);
    expect(diff.some((d) => d.startsWith("test_facts: only in postgres"))).toBe(true);
    const bad = await (await fresh("sqlite", WITH_BAD_SCHEMA)).readSchema();
    const clean = await (await fresh("postgres")).readSchema();
    expect(diffSnapshots(bad, clean).length).toBeGreaterThan(5);
    const t = a.tables.find((x) => x.name === "locations")!;
    const altered = { ...a, tables: a.tables.map((x) => (x.name === "locations" ? { ...t, triggers: [...t.triggers, { name: "trg_extra", event: "update" as const }] } : x)) };
    expect(diffSnapshots(a, altered).some((d) => d.includes("locations.triggers"))).toBe(true);
  });
});

describe.each(KINDS)("class 1 facts are never changed (document 06, D-2; SA-18) on %s", (kind) => {
  async function withEvent() {
    const store = await fresh(kind);
    const rt = createTestRuntime({ seed: "events" });
    const world = await seedWorld(store, rt);
    const db = store.scoped({ companyId: world.a.id });
    const id = rt.ids.newId();
    await db.insertInto("audit_events").values({ id, bundle_id: rt.ids.newId(), created_at: now, entity: "locations", entity_id: world.a.locationId, action: "created", detail_json: '{"b":1,"a":2}' }).execute();
    return { store, world, db, id };
  }

  it("appending is allowed", async () => {
    const { db } = await withEvent();
    expect(await db.selectFrom("audit_events").select("id").execute()).toHaveLength(1);
  });

  it("UPDATE is refused, for one row and for all rows", async () => {
    const { db, id } = await withEvent();
    await expect(db.updateTable("audit_events").set({ action: "changed" }).where("id", "=", id).execute()).rejects.toThrow(/append-only/);
    await expect(db.updateTable("audit_events").set({ action: "changed" }).execute()).rejects.toThrow(/append-only/);
    expect((await db.selectFrom("audit_events").select("action").executeTakeFirstOrThrow()).action).toBe("created");
  });

  it("DELETE is refused, for one row and for all rows", async () => {
    const { db, id } = await withEvent();
    await expect(db.deleteFrom("audit_events").where("id", "=", id).execute()).rejects.toThrow(/append-only/);
    await expect(db.deleteFrom("audit_events").execute()).rejects.toThrow(/append-only/);
    expect(await db.selectFrom("audit_events").select("id").execute()).toHaveLength(1);
  });

  it("an upsert that would overwrite a fact is refused too", async () => {
    const { db, id, world } = await withEvent();
    await expect(
      db.insertInto("audit_events").values({ id, bundle_id: "0195f3a4-0000-7000-8000-0000000000ff", created_at: now, entity: "x", entity_id: world.a.locationId, action: "overwritten" }).onConflict((oc) => oc.column("id").doUpdateSet({ action: "overwritten" })).execute(),
    ).rejects.toThrow(/append-only/);
  });

  it("a refused change inside a transaction rolls the whole transaction back", async () => {
    const { db, world } = await withEvent();
    const rt = createTestRuntime({ seed: "events-2" });
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto("audit_events").values({ id: rt.ids.newId(), bundle_id: rt.ids.newId(), created_at: now, entity: "x", entity_id: world.a.locationId, action: "second" }).execute();
        await trx.deleteFrom("audit_events").execute();
      }),
    ).rejects.toThrow(/append-only/);
    expect(await db.selectFrom("audit_events").select("id").execute()).toHaveLength(1);
  });
});

describe.each(KINDS)("the company wall (document 05, section 12; D-4) on %s", (kind) => {
  async function world() {
    const store = await fresh(kind);
    const rt = createTestRuntime({ seed: "wall" });
    const w = await seedWorld(store, rt);
    return { store, rt, w, a: store.scoped({ companyId: w.a.id }), b: store.scoped({ companyId: w.b.id }) };
  }

  it("a query without a company context cannot be made", async () => {
    const { store } = await world();
    for (const bad of [undefined, {}, { companyId: "" }, { companyId: "not-a-uuid" }, { companyId: 5 }, null]) {
      expect(() => store.scoped(bad as never)).toThrow(CompanyContextError);
    }
    expect(() => store.scoped(undefined as never)).toThrow(/company context/);
  });

  it("the installation handle refuses company tables, and still serves nodes, devices and owner groups", async () => {
    const { store, w } = await world();
    const installation = store.installation();
    await expect(installation.selectFrom("companies").selectAll().execute()).rejects.toThrow(CompanyContextError);
    await expect(installation.selectFrom("locations").selectAll().execute()).rejects.toThrow(/company table/);
    await expect(installation.deleteFrom("audit_events").execute()).rejects.toThrow(CompanyContextError);
    expect(await installation.selectFrom("nodes").select("id").execute()).toEqual([{ id: w.nodeId }]);
    expect(await installation.selectFrom("devices").select("id").execute()).toEqual([{ id: w.deviceId }]);
    expect(await installation.selectFrom("owner_groups").select("id").execute()).toEqual([{ id: w.ownerGroupId }]);
  });

  it("each company sees only its own rows, in every company table", async () => {
    const { a, b, w } = await world();
    expect((await a.selectFrom("companies").select("id").execute()).map((r) => r.id)).toEqual([w.a.id]);
    expect((await b.selectFrom("companies").select("id").execute()).map((r) => r.id)).toEqual([w.b.id]);
    expect((await a.selectFrom("locations").select("id").execute()).map((r) => r.id)).toEqual([w.a.locationId]);
    expect((await b.selectFrom("fiscal_years").select("id").execute()).map((r) => r.id)).toEqual([w.b.fiscalYearId]);
  });

  it("asking for another company's row by its id finds nothing", async () => {
    const { a, w } = await world();
    expect(await a.selectFrom("locations").selectAll().where("id", "=", w.b.locationId).execute()).toEqual([]);
    expect(await a.selectFrom("companies").selectAll().where("id", "=", w.b.id).executeTakeFirst()).toBeUndefined();
  });

  it("writing another company's company_id is refused", async () => {
    const { a, w, rt } = await world();
    await expect(a.insertInto("locations").values({ id: rt.ids.newId(), company_id: w.b.id, code: "XX", name_en: "x", name_ur: "x", kind: "shop", authority_kind: "cloud", updated_at: now }).execute()).rejects.toThrow(/not the context's/);
  });

  it("an insert without company_id lands in the context's company, and only there", async () => {
    const { a, b, rt, w } = await world();
    const id = rt.ids.newId();
    await a.insertInto("locations").values({ id, code: "SH", name_en: "Shop", name_ur: "دکان", kind: "shop", authority_kind: "cloud", updated_at: now }).execute();
    expect((await a.selectFrom("locations").select("id").where("id", "=", id).execute()).length).toBe(1);
    expect(await b.selectFrom("locations").select("id").where("id", "=", id).execute()).toEqual([]);
    expect((await a.selectFrom("locations").select("company_id").where("id", "=", id).executeTakeFirstOrThrow()).company_id).toBe(w.a.id);
  });

  it("UPDATE and DELETE reach only the context's rows, even when written for all rows", async () => {
    const { a, b } = await world();
    await a.updateTable("locations").set({ name_en: "Changed" }).execute();
    expect((await a.selectFrom("locations").select("name_en").executeTakeFirstOrThrow()).name_en).toBe("Changed");
    expect((await b.selectFrom("locations").select("name_en").executeTakeFirstOrThrow()).name_en).toBe("Godown");
    await a.deleteFrom("fiscal_years").execute();
    expect(await a.selectFrom("fiscal_years").select("id").execute()).toEqual([]);
    expect(await b.selectFrom("fiscal_years").select("id").execute()).toHaveLength(1);
  });

  it("company_id cannot be changed, so a row cannot be moved to another company", async () => {
    const { a, w } = await world();
    await expect(a.updateTable("locations").set({ company_id: w.b.id }).execute()).rejects.toThrow(/company_id cannot be changed/);
  });

  it("an upsert on another company's id changes nothing of theirs", async () => {
    const { a, b, w } = await world();
    await a
      .insertInto("locations")
      .values({ id: w.b.locationId, code: "ZZ", name_en: "Hijacked", name_ur: "x", kind: "shop", authority_kind: "cloud", updated_at: now })
      .onConflict((oc) => oc.column("id").doUpdateSet({ name_en: "Hijacked" }))
      .execute();
    expect((await b.selectFrom("locations").select("name_en").where("id", "=", w.b.locationId).executeTakeFirstOrThrow()).name_en).toBe("Godown");
    expect(await a.selectFrom("locations").select("id").where("id", "=", w.b.locationId).execute()).toEqual([]);
  });

  it("joins stay inside the company, and a left join keeps rows that have no match", async () => {
    const { a, b } = await world();
    const inner = await a.selectFrom("locations as l").innerJoin("fiscal_years as f", "f.company_id", "l.company_id").select(["l.code as lc", "f.code as fc"]).execute();
    expect(inner).toEqual([{ lc: "GD", fc: "FY27" }]);
    await a.deleteFrom("fiscal_years").execute();
    const left = await a.selectFrom("locations as l").leftJoin("fiscal_years as f", "f.company_id", "l.company_id").select(["l.code as lc", "f.code as fc"]).execute();
    expect(left).toEqual([{ lc: "GD", fc: null }]); // the location is kept although its joined row is gone
    const other = await b.selectFrom("locations as l").leftJoin("fiscal_years as f", "f.company_id", "l.company_id").select("f.code as fc").execute();
    expect(other).toEqual([{ fc: "FY27" }]);
  });

  it("a scalar subquery is inside the wall too", async () => {
    const { a } = await world();
    const row = await a.selectFrom("companies").select((eb) => eb.selectFrom("locations").select(eb.fn.countAll().as("n")).as("locations_seen")).executeTakeFirstOrThrow();
    expect(row.locations_seen).toBe(1n);
  });

  it("right and full joins on company tables are refused", async () => {
    const { a } = await world();
    await expect(a.selectFrom("locations as l").rightJoin("fiscal_years as f", "f.company_id", "l.company_id").select("l.id").execute()).rejects.toThrow(/right and full joins/);
  });

  it("the database refuses a row that refers to another company's row, even with the right company_id of its own (composite foreign key)", async () => {
    const { a, w, rt } = await world();
    await expect(
      a.insertInto("location_authorities").values({ id: rt.ids.newId(), location_id: w.b.locationId, node_id: w.nodeId, epoch: 1n, started_at: now, updated_at: now }).execute(),
    ).rejects.toThrow();
    expect(await a.selectFrom("location_authorities").select("id").execute()).toEqual([]);
    // the same row for its own company's location is accepted
    await a.insertInto("location_authorities").values({ id: rt.ids.newId(), location_id: w.a.locationId, node_id: w.nodeId, epoch: 1n, started_at: now, updated_at: now }).execute();
    expect(await a.selectFrom("location_authorities").select("id").execute()).toHaveLength(1);
  });

  it("the same code can exist in two companies, but not twice in one (unique per company)", async () => {
    const { a, rt } = await world();
    await expect(a.insertInto("locations").values({ id: rt.ids.newId(), code: "GD", name_en: "again", name_ur: "x", kind: "godown", authority_kind: "cloud", updated_at: now }).execute()).rejects.toThrow();
  });

  it("the other constraints of the first tables hold", async () => {
    const { a, rt } = await world();
    const id = rt.ids.newId();
    const loc = { code: "T1", name_en: "x", name_ur: "x", kind: "shop", authority_kind: "cloud", updated_at: now } as const;
    await expect(a.insertInto("locations").values({ ...loc, id, kind: "palace" as never }).execute()).rejects.toThrow(); // enumeration
    await expect(a.insertInto("locations").values({ ...loc, id, code: "TOOLONG" }).execute()).rejects.toThrow(); // code length 2 to 4
    await expect(a.insertInto("locations").values({ ...loc, id, current_epoch: 0n }).execute()).rejects.toThrow(); // epoch >= 1
    await expect(a.insertInto("fiscal_years").values({ id, code: "FY28", start_date: "2027-07-01", end_date: "2027-06-30", updated_at: now }).execute()).rejects.toThrow(); // end after start
    // SQLite refuses a non-canonical timestamp in the database; PostgreSQL's input is lenient, so encodeValue (types.ts) is what keeps both strict
    if (kind === "sqlite") await expect(a.insertInto("locations").values({ ...loc, id, updated_at: "yesterday" }).execute()).rejects.toThrow();
    await expect(a.insertInto("locations").values({ ...loc, id, current_node_id: rt.ids.newId() }).execute()).rejects.toThrow(); // unknown node
  });
});

describe.each(KINDS)("the apply guard and projection tables (document 06, D-3) on %s", (kind) => {
  async function setup() {
    const store = await fresh(kind, WITH_TEST_TABLES);
    const rt = createTestRuntime({ seed: "guard" });
    const w = await seedWorld(store, rt);
    const db = store.scoped({ companyId: w.a.id });
    const raw = db as unknown as UntypedDb;
    const row = (id: string) => ({ id, location_id: w.a.locationId, quantity_milli: 5_000n, as_of_at: now });
    return { store, rt, w, db, raw, row };
  }

  it("a projection table refuses insert, update and delete while the guard is closed", async () => {
    const { raw, row, rt } = await setup();
    await expect(raw.insertInto("test_projection").values(row(rt.ids.newId())).execute()).rejects.toThrow(/written only by applyBundle/);
    await expect(raw.updateTable("test_projection").set({ quantity_milli: 1n }).execute()).resolves.toBeDefined(); // no rows: the trigger is per row
  });

  it("opening the guard inside a transaction allows the write, and it is closed again afterwards", async () => {
    const { db, raw, row, rt } = await setup();
    const id = rt.ids.newId();
    await db.transaction().execute((trx) => withApplyGuard(trx, async () => {
      await (trx as unknown as UntypedDb).insertInto("test_projection").values(row(id)).execute();
    }));
    expect(await raw.selectFrom("test_projection").select("id").execute()).toEqual([{ id }]);
    expect(decodeValue("bool", (await db.selectFrom("apply_guard").select("is_open").executeTakeFirstOrThrow()).is_open)).toBe(false);
    await expect(raw.updateTable("test_projection").set({ quantity_milli: 9n }).where("id", "=", id).execute()).rejects.toThrow(/written only by applyBundle/);
    await expect(raw.deleteFrom("test_projection").where("id", "=", id).execute()).rejects.toThrow(/written only by applyBundle/);
    await expect(raw.insertInto("test_projection").values(row(rt.ids.newId())).execute()).rejects.toThrow(/written only by applyBundle/);
  });

  it("inside the guard, update and delete work too", async () => {
    const { db, raw, row, rt } = await setup();
    const id = rt.ids.newId();
    await db.transaction().execute((trx) => withApplyGuard(trx, async () => {
      const t = trx as unknown as UntypedDb;
      await t.insertInto("test_projection").values(row(id)).execute();
      await t.updateTable("test_projection").set({ quantity_milli: 7n }).where("id", "=", id).execute();
    }));
    expect((await raw.selectFrom("test_projection").select("quantity_milli").executeTakeFirstOrThrow()).quantity_milli).toBe(7n);
    await db.transaction().execute((trx) => withApplyGuard(trx, async () => {
      await (trx as unknown as UntypedDb).deleteFrom("test_projection").where("id", "=", id).execute();
    }));
    expect(await raw.selectFrom("test_projection").select("id").execute()).toEqual([]);
  });

  it("if the work fails, the transaction rolls back and the guard is closed", async () => {
    const { db, raw, row, rt } = await setup();
    await expect(
      db.transaction().execute((trx) => withApplyGuard(trx, async () => {
        await (trx as unknown as UntypedDb).insertInto("test_projection").values(row(rt.ids.newId())).execute();
        throw new Error("apply failed half way");
      })),
    ).rejects.toThrow("apply failed half way");
    expect(await raw.selectFrom("test_projection").select("id").execute()).toEqual([]);
    await expect(raw.insertInto("test_projection").values(row(rt.ids.newId())).execute()).rejects.toThrow(/written only by applyBundle/);
  });

  it("the guard can only be opened inside a transaction", async () => {
    const { db } = await setup();
    await expect(withApplyGuard(db, () => Promise.resolve(1))).rejects.toThrow(/inside a transaction/);
  });

  it("a class 1 test table refuses update and delete as every class 1 table does", async () => {
    const { raw, rt, w } = await setup();
    const id = rt.ids.newId();
    await raw.insertInto("test_facts").values({ id, company_id: w.a.id, bundle_id: rt.ids.newId(), created_at: now, note: "n" }).execute();
    await expect(raw.updateTable("test_facts").set({ note: "m" }).execute()).rejects.toThrow(/append-only/);
    await expect(raw.deleteFrom("test_facts").execute()).rejects.toThrow(/append-only/);
  });
});

describe.each(KINDS)("values read back the same way (physical type map) on %s", (kind) => {
  it("whole numbers survive the 64-bit edge, and one beyond is refused", async () => {
    const store = await fresh(kind);
    const w = await seedWorld(store, createTestRuntime({ seed: "values" }));
    const db = store.scoped({ companyId: w.a.id });
    await db.updateTable("companies").set({ settings_version: INT64_MAX }).execute();
    const row = await db.selectFrom("companies").select("settings_version").executeTakeFirstOrThrow();
    expect(row.settings_version).toBe(INT64_MAX);
    expect(typeof row.settings_version).toBe("bigint");
    await expect(db.updateTable("companies").set({ settings_version: INT64_MAX + 1n }).execute()).rejects.toThrow();
  });

  it("timestamps, dates, ids and JSON come back in one canonical form; flags decode to booleans", async () => {
    const store = await fresh(kind);
    const rt = createTestRuntime({ seed: "values-2" });
    const w = await seedWorld(store, rt);
    const db = store.scoped({ companyId: w.a.id });
    await db.updateTable("companies").set({ registration_date: "2026-06-30", is_active: false, updated_at: "2026-07-01T12:34:56.789Z" }).execute();
    const raw = await db.selectFrom("companies").selectAll().executeTakeFirstOrThrow();
    const row = decodeRow(catalogueOf(), "companies", raw);
    expect(row).toMatchObject({ registration_date: "2026-06-30", is_active: false, updated_at: "2026-07-01T12:34:56.789Z", id: w.a.id, company_id: w.a.id, version: 1n, fiscal_year_start_month: 7n });
    const id = rt.ids.newId();
    await db.insertInto("audit_events").values({ id, bundle_id: rt.ids.newId(), created_at: now, entity: "e", entity_id: w.a.locationId, action: "a", detail_json: '{ "b": 1,  "a": [1, 2] }' }).execute();
    const event = decodeRow(catalogueOf(), "audit_events", await db.selectFrom("audit_events").selectAll().executeTakeFirstOrThrow());
    expect(event.detail_json).toBe('{"a":[1,2],"b":1}');
  });

  it("JSON that is not JSON is refused by the database", async () => {
    const store = await fresh(kind);
    const rt = createTestRuntime({ seed: "values-3" });
    const w = await seedWorld(store, rt);
    const db = store.scoped({ companyId: w.a.id });
    await expect(db.insertInto("audit_events").values({ id: rt.ids.newId(), bundle_id: rt.ids.newId(), created_at: now, entity: "e", entity_id: w.a.locationId, action: "a", detail_json: "{bad" }).execute()).rejects.toThrow();
  });
});

describe("two databases, the same data (TL-4)", () => {
  it("the same inserts read back as identical canonical rows on SQLite and PostgreSQL", async () => {
    const tables = ["owner_groups", "nodes", "devices", "companies", "locations", "fiscal_years"] as const;
    const read = async (kind: DbKind) => {
      const store = await fresh(kind);
      const w = await seedWorld(store, createTestRuntime({ seed: "same-everywhere" }));
      const out: Record<string, unknown[]> = {};
      for (const t of tables) {
        const dbs = t === "owner_groups" || t === "nodes" || t === "devices" ? [store.installation()] : [store.scoped({ companyId: w.a.id }), store.scoped({ companyId: w.b.id })];
        const rows: unknown[] = [];
        for (const d of dbs) rows.push(...(await (d as unknown as UntypedDb).selectFrom(t).selectAll().orderBy("id").execute()).map((r: Record<string, unknown>) => decodeRow(catalogueOf(), t, r)));
        out[t] = rows;
      }
      return JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? `${v.toString()}n` : (v as unknown)));
    };
    const a = await read("sqlite");
    const b = await read("postgres");
    expect(a.length).toBeGreaterThan(1000);
    expect(b).toBe(a);
  });
});
