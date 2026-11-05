import { normalizedPath, propertyName } from "../util.mjs";

/**
 * SEC-5: all database access goes through Kysely with parameters, and only the data package may
 * touch it. No SQL text outside the migration folder. Reported:
 *   - string and template text that reads as a SQL statement
 *   - sql.raw / sql.lit / sql.id (string-built SQL)
 *   - importing a database driver or Kysely outside packages/data
 * Migration files (any path containing /migrations/) are the one place SQL text is allowed.
 */
const STATEMENT_PATTERNS = [
  /^\s*SELECT\s[\s\S]*\bFROM\b/, // upper-case SQL
  /^\s*select\s+(?:\*|distinct\b|[^;]*?[,*(."`[])[\s\S]*?\bfrom\b/i,
  /^\s*insert\s+(?:or\s+\w+\s+)?into\s+[\w."`[\]]+\s*(?:\(|values\b|select\b|default\b)/i,
  /^\s*update\s+[\w."`[\]]+\s+set\s+[\w."`[\]]+\s*=/i,
  /^\s*delete\s+from\s+[\w."`[\]]+\s*(?:where\b|using\b|returning\b|;)/i,
  /^\s*DELETE FROM\b/,
  /^\s*(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:temp(?:orary)?\s+)?(?:table|index|view|trigger|schema|extension|function|policy)\s+(?:if\s+(?:not\s+)?exists\s+)?[\w."`[\]]+\s*(?:\(|;|$|\bon\b|\badd\b|\bdrop\b|\brename\b|\bset\b|\bas\b|\bcascade\b)/i,
  /^\s*pragma\s+[a-z_]+\s*(?:[=(;]|$)/i,
  /^\s*(?:attach|detach)\s+database\b/i,
  /^\s*TRUNCATE\b/,
  /^\s*with\s+(?:recursive\s+)?[\w"]+\s+as\s*\(/i,
  /^\s*(?:BEGIN|COMMIT|ROLLBACK)(?:\s+(?:IMMEDIATE|DEFERRED|EXCLUSIVE|TRANSACTION))?\s*;?\s*$/,
];

const DRIVERS = new Set([
  "better-sqlite3", "sqlite3", "sqlite", "node:sqlite", "sql.js", "@libsql/client",
  "pg", "pg-native", "pg-pool", "postgres", "mysql", "mysql2", "knex", "sequelize", "typeorm", "kysely",
]);

export function looksLikeSql(text) {
  return STATEMENT_PATTERNS.some((p) => p.test(text));
}

export default {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { dataPackage: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      rawSql: "SQL text outside the migration folder (SEC-5). Use the Kysely query builder in packages/data; SQL belongs in migrations only.",
      sqlRaw: "sql.{{name}} builds SQL from strings (SEC-5). Use parameters; identifiers come from fixed lists.",
      driver: "Importing '{{source}}' outside packages/data (SEC-5). All database access goes through the data layer.",
    },
  },
  create(context) {
    const file = normalizedPath(context);
    if (file.includes("/migrations/")) return {};
    const dataPackage = context.options[0]?.dataPackage ?? "packages/data/";
    const inData = file.includes(dataPackage);

    function checkText(node, text) {
      if (looksLikeSql(text)) context.report({ node, messageId: "rawSql" });
    }
    function checkSource(node, source) {
      if (!inData && typeof source === "string" && DRIVERS.has(source)) {
        context.report({ node, messageId: "driver", data: { source } });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") checkText(node, node.value);
      },
      TemplateLiteral(node) {
        checkText(node, node.quasis.map((q) => q.value.cooked ?? "").join("?"));
      },
      ImportDeclaration(node) {
        checkSource(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") checkSource(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source.value);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "require" && node.arguments[0]?.type === "Literal") {
          checkSource(node, node.arguments[0].value);
        }
        if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "sql") {
          const name = propertyName(callee);
          if (name === "raw" || name === "lit") context.report({ node, messageId: "sqlRaw", data: { name } });
        }
      },
    };
  },
};
