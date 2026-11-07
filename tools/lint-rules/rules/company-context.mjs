import { normalizedPath, propertyName } from "../util.mjs";

/**
 * Document 05, section 12 and SEC-19: the data layer requires a company context on every query.
 * Query builders may be called only inside packages/data, where the scoped data layer takes a company
 * context and refuses to run without one (BC-03), and in the few packages listed in `allowPaths`
 * (BC-04: packages/sync, which applies bundles through the scoped handles of store.transaction).
 * That is safe because the store hands out only company-scoped or installation handles and no raw Kysely
 * is exported: a handle held outside packages/data is already behind the wall at run time. Every other
 * package (the engine, the numeric module, the screens) may not touch a database at all.
 */
const QUERY_ROOTS = new Set(["selectFrom", "insertInto", "updateTable", "deleteFrom", "replaceInto", "mergeInto"]);

export default {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { dataPackage: { type: "string" }, allowPaths: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      outsideData: "{{name}}() is a query builder call outside packages/data. Every query needs a company context (document 05, section 12); go through the data layer.",
    },
  },
  create(context) {
    const dataPackage = context.options[0]?.dataPackage ?? "packages/data/";
    const file = normalizedPath(context);
    if (file.includes(dataPackage) || (context.options[0]?.allowPaths ?? []).some((fragment) => file.includes(fragment))) return {};
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        const name = propertyName(node.callee);
        if (name !== undefined && QUERY_ROOTS.has(name)) {
          context.report({ node, messageId: "outsideData", data: { name } });
        }
      },
    };
  },
};
