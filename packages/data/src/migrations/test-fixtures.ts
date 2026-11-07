import { col, table, type TableDef } from "../catalogue/define";
import { MIGRATIONS, type Migration } from "./scripts";

/*
 * Migrations used ONLY by tests (never listed in MIGRATIONS). One adds well-formed tables of each
 * class so the guard and immutability helpers can be exercised; the other builds deliberately wrong
 * schemas so the schema test can be shown to fail. Raw SQL is allowed here because this is a
 * migrations folder.
 */

export const TEST_FACTS: TableDef = table({ name: "test_facts", class: 1, scope: "company", columns: [col.text("note")] });
export const TEST_PROJECTION: TableDef = table({
  name: "test_projection",
  class: "P",
  scope: "company",
  columns: [col.ref("location_id", "locations"), col.int("quantity_milli"), col.ts("as_of_at")],
});

/**
 * A trivial document type for proving the bundle machinery before any real document exists (BC-04): a
 * document with a printed number, its lines, and a stock projection per location.
 */
export const TEST_DOCUMENTS: TableDef = table({
  name: "test_documents",
  class: 1,
  scope: "company",
  columns: [
    col.text("doc_type"),
    col.text("doc_no"),
    col.ref("location_id", "locations"),
    col.ref("device_id", "devices"),
    col.text("fiscal_year_code"),
    col.int("number_seq"),
    col.date("doc_date"),
    col.int("total_milli"),
  ],
  checks: [{ name: "number_seq_positive", rule: "number_seq >= 1" }],
  indexes: [{ columns: ["doc_no"], unique: true }],
});
export const TEST_DOCUMENT_LINES: TableDef = table({
  name: "test_document_lines",
  class: 1,
  scope: "company",
  columns: [col.ref("document_id", "test_documents"), col.int("line_no"), col.int("qty_milli")],
  indexes: [{ columns: ["document_id", "line_no"], unique: true }],
});
export const TEST_STOCK: TableDef = table({
  name: "test_stock",
  class: "P",
  scope: "company",
  columns: [col.ref("location_id", "locations"), col.int("qty_milli")],
  indexes: [{ columns: ["location_id"], unique: true }],
});

/** The migrations plus the trivial document type, as migration 3. */
export const WITH_TEST_DOCUMENTS: readonly Migration[] = [...MIGRATIONS, { id: 3, name: "test_documents", tables: [TEST_DOCUMENTS, TEST_DOCUMENT_LINES, TEST_STOCK] }];

/** Migration 3 for tests: one class 1 table and one projection table, rendered by the real renderer. */
export const WITH_TEST_TABLES: readonly Migration[] = [...MIGRATIONS, { id: 3, name: "test_tables", tables: [TEST_FACTS, TEST_PROJECTION] }];

/** Migration 3 with a changed body, to show that an edited migration is detected. */
export const MIGRATION_2_EDITED: readonly Migration[] = [...MIGRATIONS, { id: 3, name: "test_tables", tables: [TEST_FACTS, TEST_PROJECTION, table({ name: "test_extra", class: 3, scope: "company", columns: [col.text("note")] })] }];

/**
 * Migration 3 that damages the schema in every way the schema test must catch. The catalogue lists
 * `bad_facts` (class 1) and `bad_projection` (class P) correctly, then their triggers are dropped.
 */
const BAD: Migration = {
  id: 3,
  name: "deliberately_bad",
  tables: [
    table({ name: "bad_facts", class: 1, scope: "company", columns: [col.text("note")] }),
    table({ name: "bad_projection", class: "P", scope: "company", columns: [col.int("quantity_milli"), col.ts("as_of_at")] }),
  ],
  after: (kind) => [
    // class 1 table without its immutability triggers, projection table without its guard
    ...(["no_update", "no_delete"] as const).map((t) => (kind === "sqlite" ? `DROP TRIGGER "trg_bad_facts_${t}"` : `DROP TRIGGER "trg_bad_facts_${t}" ON "bad_facts"`)),
    ...(["guard_insert", "guard_update", "guard_delete"] as const).map((t) => (kind === "sqlite" ? `DROP TRIGGER "trg_bad_projection_${t}"` : `DROP TRIGGER "trg_bad_projection_${t}" ON "bad_projection"`)),
    // a floating-point column
    `CREATE TABLE bad_float (id integer PRIMARY KEY, amount real)`,
    // a foreign key between company tables that is not composite
    `CREATE TABLE bad_parent (id integer PRIMARY KEY, company_id integer NOT NULL)`,
    `CREATE TABLE bad_child (id integer PRIMARY KEY, company_id integer NOT NULL, parent_id integer REFERENCES bad_parent (id))`,
    // a business table with no company_id
    `CREATE TABLE bad_no_company (id integer PRIMARY KEY, note text)`,
    // an installation table that refers to a company table
    `CREATE TABLE bad_installation (id integer PRIMARY KEY, parent_id integer REFERENCES bad_parent (id))`,
    // an index on a company table that does not start with company_id
    `CREATE INDEX bad_index_code ON locations (code)`,
  ],
};

export const WITH_BAD_SCHEMA: readonly Migration[] = [...MIGRATIONS, BAD];
