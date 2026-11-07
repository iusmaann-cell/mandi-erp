import type { Catalogue } from "@mandi/data";
import { foreignKeysOf, indexesOf } from "@mandi/data";

/**
 * The schema fixture exporter (document 09, TR-11; section 15.2, item 6): the catalogue after a given
 * migration as a plain, readable description. One file per schema version is kept in `fixtures/`; the old
 * ones are never rewritten, so a test notices if an applied migration is ever edited.
 */
export function schemaFixture(catalogue: Catalogue): unknown {
  return {
    tables: catalogue.tables.map((t) => ({
      name: t.name,
      class: t.class,
      scope: t.scope,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        ...(c.enumValues === undefined ? {} : { enum_values: c.enumValues }),
        ...(c.default === undefined ? {} : { default: c.default.kind === "int" ? { kind: "int", value: c.default.value.toString() } : c.default }),
        ...(c.references === undefined ? {} : { references: c.references }),
      })),
      checks: t.checks,
      indexes: indexesOf(t),
      foreign_keys: foreignKeysOf(t, catalogue),
    })),
  };
}
