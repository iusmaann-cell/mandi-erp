import type { Catalogue, TableDef } from "./catalogue/define";
import { foreignKeysOf, indexesOf } from "./migrations/ddl";
import type { SchemaSnapshot, TableSnapshot } from "./introspection/snapshot";
import { FORBIDDEN_PHYSICAL_TYPES } from "./types";

/**
 * The schema test of document 06, section 12, as checks over a snapshot of a live database. It fails
 * if a class 1 table has no immutability triggers, a business table has no company_id, a foreign
 * key between company tables is not composite, a floating-point column exists, or the live schema
 * differs from the catalogue. `diffSnapshots` compares the two databases with each other.
 */
export type SchemaRule =
  | "missing-table"
  | "unknown-table"
  | "column-mismatch"
  | "floating-point"
  | "company-id"
  | "company-key"
  | "index-company-first"
  | "composite-fk"
  | "installation-fk"
  | "primary-key"
  | "foreign-key-missing"
  | "foreign-key-unexpected"
  | "index-mismatch"
  | "check-mismatch"
  | "class1-triggers"
  | "projection-guard"
  | "trigger-unexpected";

export interface Violation {
  readonly rule: SchemaRule;
  readonly table: string;
  readonly detail: string;
}

const fkText = (cols: readonly string[], table: string, refCols: readonly string[]): string => `(${cols.join(", ")}) -> ${table}(${refCols.join(", ")})`;
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

function expectedTriggers(def: TableDef, kind: SchemaSnapshot["kind"]): { name: string; event: string; rule: SchemaRule }[] {
  if (def.class === 1) {
    return [
      { name: `trg_${def.name}_no_update`, event: "update", rule: "class1-triggers" },
      { name: `trg_${def.name}_no_delete`, event: "delete", rule: "class1-triggers" },
      ...(kind === "postgres" ? [{ name: `trg_${def.name}_no_truncate`, event: "truncate", rule: "class1-triggers" as const }] : []),
    ];
  }
  if (def.class === "P") {
    return (["insert", "update", "delete"] as const).map((event) => ({ name: `trg_${def.name}_guard_${event}`, event, rule: "projection-guard" as const }));
  }
  return [];
}

export function checkSchema(snapshot: SchemaSnapshot, catalogue: Catalogue): Violation[] {
  const out: Violation[] = [];
  const push = (rule: SchemaRule, table: string, detail: string): void => {
    out.push({ rule, table, detail });
  };
  const live = new Map(snapshot.tables.map((t) => [t.name, t]));
  const hasCompanyId = (t: TableSnapshot | undefined): boolean => t?.columns.some((c) => c.name === "company_id") === true;

  for (const def of catalogue.tables) {
    if (!live.has(def.name)) push("missing-table", def.name, "in the catalogue but not in the database");
  }

  for (const t of snapshot.tables) {
    const def = catalogue.get(t.name);
    if (def === undefined) push("unknown-table", t.name, "in the database but not in the catalogue");

    // -- rules that hold whatever the catalogue says ------------------------------------------------
    for (const c of t.columns) {
      if (FORBIDDEN_PHYSICAL_TYPES.test(c.physicalType)) push("floating-point", t.name, `column ${c.name} has type ${c.physicalType} (D-6: whole numbers only)`);
    }
    const company = hasCompanyId(t);
    if (company) {
      const cid = t.columns.find((c) => c.name === "company_id");
      if (cid?.nullable !== false || cid.logicalType !== "id") push("company-id", t.name, "company_id must be a NOT NULL id");
      if (!t.indexes.some((i) => i.unique && same(i.columns, ["company_id", "id"]))) push("company-key", t.name, "no unique index on (company_id, id), the target of composite foreign keys");
      for (const i of t.indexes) {
        if (i.columns[0] !== "company_id") push("index-company-first", t.name, `index ${i.name} does not start with company_id`);
      }
    }
    for (const fk of t.foreignKeys) {
      const refIsCompany = hasCompanyId(live.get(fk.refTable));
      const isOwnCompanyKey = same(fk.columns, ["company_id"]) && fk.refTable === "companies" && same(fk.refColumns, ["id"]);
      if (company && refIsCompany && !isOwnCompanyKey && !(fk.columns[0] === "company_id" && fk.refColumns[0] === "company_id" && fk.columns.length > 1)) {
        push("composite-fk", t.name, `foreign key ${fkText(fk.columns, fk.refTable, fk.refColumns)} is not composite with company_id`);
      }
      if (!company && refIsCompany) push("installation-fk", t.name, `an installation or system table refers to company table ${fk.refTable}`);
    }

    if (def === undefined) continue;

    // -- the live table against the catalogue -------------------------------------------------------
    if ((def.scope === "company") !== company) push("company-id", t.name, def.scope === "company" ? "a company table has no company_id" : `a ${def.scope} table has a company_id`);
    const expectedColumns = def.columns.map((c) => `${c.name}:${c.type}:${c.nullable ? "null" : "not null"}`);
    const liveColumns = t.columns.map((c) => `${c.name}:${c.logicalType}:${c.nullable ? "null" : "not null"}`);
    if (!same(expectedColumns, liveColumns)) push("column-mismatch", t.name, `expected [${expectedColumns.join(", ")}] but found [${liveColumns.join(", ")}]`);
    if (!same(t.primaryKey, ["id"])) push("primary-key", t.name, `primary key is (${t.primaryKey.join(", ")}), expected (id)`);

    const expectedFks = foreignKeysOf(def, catalogue).map((f) => fkText(f.columns, f.refTable, f.refColumns));
    const liveFks = t.foreignKeys.map((f) => fkText(f.columns, f.refTable, f.refColumns));
    for (const f of expectedFks) if (!liveFks.includes(f)) push("foreign-key-missing", t.name, f);
    for (const f of liveFks) if (!expectedFks.includes(f)) push("foreign-key-unexpected", t.name, f);

    const expectedIndexes = indexesOf(def).map((i) => `${i.unique ? "unique " : ""}${i.name} (${i.columns.join(", ")})`);
    const liveIndexes = t.indexes.map((i) => `${i.unique ? "unique " : ""}${i.name} (${i.columns.join(", ")})`);
    if (!same([...expectedIndexes].sort(), [...liveIndexes].sort())) push("index-mismatch", t.name, `expected [${expectedIndexes.join("; ")}] but found [${liveIndexes.join("; ")}]`);

    const expectedChecks = [...def.columns.filter((c) => c.type === "enum").map((c) => `ck_${def.name}_${c.name}__enum`), ...def.checks.map((c) => `ck_${def.name}_${c.name}__rule`)];
    if (!same([...expectedChecks].sort(), [...t.checks].sort())) push("check-mismatch", t.name, `expected [${expectedChecks.join(", ")}] but found [${t.checks.join(", ")}]`);

    const wanted = expectedTriggers(def, snapshot.kind);
    for (const w of wanted) {
      if (!t.triggers.some((tr) => tr.name === w.name && tr.event === w.event)) push(w.rule, t.name, `missing trigger ${w.name} (BEFORE ${w.event.toUpperCase()})`);
    }
    for (const tr of t.triggers) {
      if (!wanted.some((w) => w.name === tr.name)) push("trigger-unexpected", t.name, `unexpected trigger ${tr.name}`);
    }
  }
  return out;
}

/** What differs between two databases' schemas. PostgreSQL's TRUNCATE trigger has no SQLite counterpart and is left out. */
export function diffSnapshots(a: SchemaSnapshot, b: SchemaSnapshot): string[] {
  const out: string[] = [];
  const names = [...new Set([...a.tables, ...b.tables].map((t) => t.name))].sort();
  const view = (t: TableSnapshot) => ({
    columns: t.columns.map((c) => `${c.name}:${c.logicalType}:${c.nullable ? "null" : "not null"}:${c.hasDefault ? "default" : "no default"}`),
    primaryKey: t.primaryKey.join(","),
    foreignKeys: t.foreignKeys.map((f) => fkText(f.columns, f.refTable, f.refColumns)).sort(),
    indexes: t.indexes.map((i) => `${i.unique ? "unique " : ""}${i.name} (${i.columns.join(", ")})`).sort(),
    triggers: t.triggers.filter((tr) => tr.event !== "truncate").map((tr) => `${tr.name}:${tr.event}`).sort(),
    checks: [...t.checks].sort(),
  });
  for (const name of names) {
    const ta = a.tables.find((t) => t.name === name);
    const tb = b.tables.find((t) => t.name === name);
    if (ta === undefined || tb === undefined) {
      out.push(`${name}: only in ${ta === undefined ? b.kind : a.kind}`);
      continue;
    }
    const va = view(ta);
    const vb = view(tb);
    for (const key of Object.keys(va) as (keyof typeof va)[]) {
      if (JSON.stringify(va[key]) !== JSON.stringify(vb[key])) out.push(`${name}.${key}: ${a.kind} ${JSON.stringify(va[key])} differs from ${b.kind} ${JSON.stringify(vb[key])}`);
    }
  }
  return out;
}
