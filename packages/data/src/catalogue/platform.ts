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

/**
 * Document 06, section 3.10 and 4: the unit of sync. The key is `id` (the standard column; the envelope
 * calls it bundle_id). Class S: its `state` moves (pending, acked, accepted, quarantined). Every class 1
 * row's bundle_id points here, so a bundle's row is written before the rows it owns.
 */
export const BUNDLES = table({
  name: "bundles",
  class: "S",
  scope: "company",
  columns: [
    col.ref("location_id", "locations", { null: true }),
    col.ref("node_id", "nodes"),
    col.int("epoch"),
    col.int("node_seq"),
    col.text("prev_hash"),
    col.text("hash"),
    col.int("schema_version"),
    col.enum("kind", ["document", "system", "import"] as const),
    col.json("payload_json"),
    col.ts("created_at"),
    col.enum("state", ["pending", "acked", "accepted", "quarantined"] as const),
    col.int("central_seq", { null: true }),
    col.ts("acked_at", { null: true }),
    col.text("signature", { null: true }),
  ],
  checks: [
    { name: "epoch_positive", rule: "epoch >= 1" },
    { name: "node_seq_positive", rule: "node_seq >= 1" },
    { name: "schema_version_positive", rule: "schema_version >= 1" },
    { name: "hash_length", rule: "length(hash) = 64" },
    { name: "prev_hash_length", rule: "length(prev_hash) = 64" },
  ],
  indexes: [
    { columns: ["node_id", "node_seq"], unique: true },
    { columns: ["hash"], unique: true },
    { columns: ["state"], unique: false },
  ],
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
export const PLATFORM_TABLES: readonly TableDef[] = [OWNER_GROUPS, NODES, DEVICES, COMPANIES, LOCATIONS, BUNDLES, LOCATION_AUTHORITIES, FISCAL_YEARS, AUDIT_EVENTS];

/**
 * Document 06, section 5.1: the counter of one document series (company, location, device, type, fiscal
 * year). A projection: written only while the apply guard is open, equal to the highest number issued plus one.
 */
export const NUMBER_SERIES = table({
  name: "number_series",
  class: "P",
  scope: "company",
  columns: [
    col.ref("location_id", "locations"),
    col.ref("device_id", "devices"),
    col.text("doc_type"),
    col.text("fiscal_year_code"),
    col.text("prefix"),
    col.int("padding", { default: dflt.int(6n) }),
    col.int("next_number", { default: dflt.int(1n) }),
    col.ts("last_issued_at", { null: true }),
  ],
  checks: [
    { name: "padding_range", rule: "padding BETWEEN 1 AND 12" },
    { name: "next_number_positive", rule: "next_number >= 1" },
  ],
  indexes: [{ columns: ["location_id", "device_id", "doc_type", "fiscal_year_code"], unique: true, name: "ux_number_series__series_key" }],
});

/** Document 06, section 5.2: numbers known to be lost when a node or device was replaced with unsynced documents. */
export const LOST_NUMBERS = table({
  name: "lost_numbers",
  class: "S",
  scope: "company",
  columns: [col.json("series_key_json"), col.int("number_from"), col.int("number_to"), col.enum("reason", ["lost_device", "restore"] as const), col.ts("recorded_at")],
  checks: [
    { name: "range_ordered", rule: "number_to >= number_from" },
    { name: "from_positive", rule: "number_from >= 1" },
  ],
});

export const EXCEPTION_REASONS = ["unknown_item", "period_locked", "stale_epoch", "schema_unsupported", "unbalanced_journal", "sequence_gap", "duplicate_number", "other"] as const;

/** Document 06, section 3.10 and document 05, section 7.3: the exceptions queue. A rejected bundle is never dropped silently. */
export const EXCEPTIONS = table({
  name: "exceptions",
  class: "S",
  scope: "company",
  columns: [
    col.ref("bundle_id", "bundles", { null: true }),
    col.enum("reason_code", EXCEPTION_REASONS),
    col.text("detail"),
    col.enum("state", ["open", "resolved"] as const, { default: dflt.text("open") }),
    col.ts("created_at"),
    col.ref("resolved_by_user_id", "users", { null: true, pending: true }),
    col.ts("resolved_at", { null: true }),
    col.text("resolution_note", { null: true }),
  ],
  indexes: [{ columns: ["state"], unique: false }],
});

/**
 * The head of each node's bundle chain: the last node_seq and hash applied. A node's chain runs across all
 * the companies it serves, so the head cannot sit in a company table (X-16): it is an installation-scope
 * projection, written only by applyBundle while the guard is open.
 */
export const NODE_CHAIN_HEADS = table({
  name: "node_chain_heads",
  class: "P",
  scope: "installation",
  columns: [col.ref("node_id", "nodes"), col.int("last_seq"), col.text("last_hash"), col.ts("updated_at")],
  checks: [
    { name: "last_seq_positive", rule: "last_seq >= 1" },
    { name: "last_hash_length", rule: "length(last_hash) = 64" },
  ],
  indexes: [{ columns: ["node_id"], unique: true }],
});

/** The tables created by migration 2. */
export const NUMBERING_TABLES: readonly TableDef[] = [NUMBER_SERIES, LOST_NUMBERS, EXCEPTIONS, NODE_CHAIN_HEADS];
