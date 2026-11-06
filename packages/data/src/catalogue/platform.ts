import { col, dflt, table, type TableDef } from "./define";

/** Document 06, section 3.1: the first platform tables, plus the database's own two system tables. */

const NODE_KINDS = ["cloud", "site_node", "standalone_windows", "standalone_android", "office_node"] as const;
const DEVICE_STATUS = ["pending", "active", "disabled", "wipe_requested", "wiped"] as const;

export const SCHEMA_MIGRATIONS = table({
  name: "schema_migrations",
  class: "S",
  scope: "system",
  columns: [col.int("id"), col.text("name"), col.text("checksum"), col.ts("applied_at")],
});

export const APPLY_GUARD = table({
  name: "apply_guard",
  class: "S",
  scope: "system",
  columns: [col.int("id"), col.bool("is_open", { default: dflt.bool(false) })],
  checks: [{ name: "single_row", rule: "id = 1" }],
});

export const OWNER_GROUPS = table({
  name: "owner_groups",
  class: 3,
  scope: "installation",
  columns: [col.text("name_en"), col.text("name_ur")],
});

export const NODES = table({
  name: "nodes",
  class: 3,
  scope: "installation",
  columns: [
    col.enum("kind", NODE_KINDS),
    col.text("name"),
    col.text("public_key", { null: true }),
    col.enum("status", DEVICE_STATUS, { default: dflt.text("pending") }),
    col.ts("enrolled_at", { null: true }),
    col.text("app_version", { null: true }),
    col.ts("last_seen_at", { null: true }),
  ],
});

export const DEVICES = table({
  name: "devices",
  class: 3,
  scope: "installation",
  columns: [
    col.ref("node_id", "nodes"),
    col.enum("kind", ["windows_pc", "android"] as const),
    col.text("code"),
    col.text("name"),
    col.text("public_key", { null: true }),
    col.enum("status", DEVICE_STATUS, { default: dflt.text("pending") }),
    col.ts("enrolled_at", { null: true }),
    col.text("app_version", { null: true }),
    col.ts("last_seen_at", { null: true }),
  ],
  checks: [{ name: "code_length", rule: "length(code) = 2" }],
  indexes: [{ columns: ["node_id", "code"], unique: true }],
});

export const COMPANIES = table({
  name: "companies",
  class: 3,
  scope: "company",
  columns: [
    col.ref("owner_group_id", "owner_groups"),
    col.text("code"),
    col.text("name_en"),
    col.text("name_ur"),
    col.enum("legal_form", ["individual", "aop", "company"] as const, { null: true }),
    col.text("ntn", { null: true }),
    col.text("strn", { null: true }),
    col.date("registration_date", { null: true }),
    col.int("fiscal_year_start_month", { default: dflt.int(7n) }),
    col.int("settings_version", { default: dflt.int(0n) }),
    col.bool("is_active", { default: dflt.bool(true) }),
  ],
  checks: [
    { name: "own_company", rule: "company_id = id" },
    { name: "code_length", rule: "length(code) BETWEEN 2 AND 4" },
    { name: "fiscal_year_start_month_range", rule: "fiscal_year_start_month BETWEEN 1 AND 12" },
    { name: "settings_version_positive", rule: "settings_version >= 0" },
  ],
  indexes: [{ columns: ["code"], unique: true }],
});

export const LOCATIONS = table({
  name: "locations",
  class: 3,
  scope: "company",
  columns: [
    col.text("code"),
    col.text("name_en"),
    col.text("name_ur"),
    col.enum("kind", ["godown", "shop", "office"] as const),
    col.enum("authority_kind", ["site_node", "standalone", "cloud"] as const),
    col.ref("current_node_id", "nodes", { null: true }),
    col.int("current_epoch", { default: dflt.int(1n) }),
    col.bool("is_active", { default: dflt.bool(true) }),
  ],
  checks: [
    { name: "code_length", rule: "length(code) BETWEEN 2 AND 4" },
    { name: "current_epoch_positive", rule: "current_epoch >= 1" },
  ],
  indexes: [{ columns: ["code"], unique: true }],
});

export const LOCATION_AUTHORITIES = table({
  name: "location_authorities",
  class: 3,
  scope: "company",
  columns: [
    col.ref("location_id", "locations"),
    col.ref("node_id", "nodes"),
    col.int("epoch"),
    col.ts("started_at"),
    col.ts("ended_at", { null: true }),
    col.text("reason", { null: true }),
  ],
  checks: [{ name: "epoch_positive", rule: "epoch >= 1" }],
  indexes: [{ columns: ["location_id", "epoch"], unique: true }],
});

export const FISCAL_YEARS = table({
  name: "fiscal_years",
  class: 3,
  scope: "company",
  columns: [col.text("code"), col.date("start_date"), col.date("end_date"), col.enum("status", ["open", "closed"] as const, { default: dflt.text("open") })],
  checks: [{ name: "dates_ordered", rule: "end_date > start_date" }],
  indexes: [{ columns: ["code"], unique: true }],
});

export const AUDIT_EVENTS = table({
  name: "audit_events",
  class: 1,
  scope: "company",
  columns: [
    col.ref("user_id", "users", { null: true, pending: true }),
    col.ref("node_id", "nodes", { null: true }),
    col.ref("device_id", "devices", { null: true }),
    col.text("entity"),
    col.id("entity_id"),
    col.text("action"),
    col.json("detail_json", { default: dflt.text("{}") }),
  ],
  indexes: [{ columns: ["entity", "entity_id"], unique: false }],
});

/** The platform tables created by migration 1, in dependency order. */
export const PLATFORM_TABLES: readonly TableDef[] = [OWNER_GROUPS, NODES, DEVICES, COMPANIES, LOCATIONS, LOCATION_AUTHORITIES, FISCAL_YEARS, AUDIT_EVENTS];
