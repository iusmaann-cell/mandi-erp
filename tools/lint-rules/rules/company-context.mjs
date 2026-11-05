import { normalizedPath, propertyName } from "../util.mjs";

/**
 * Document 05, section 12 and SEC-19: the data layer requires a company context on every query.
 * BC-01 provides the lint half: query builders may be called only inside packages/data, where the
 * scoped data layer (BC-03) takes a company context and refuses to run without one. BC-03 adds
 * the runtime refusal and the test that fails when a table has no company_id.
 */
const QUERY_ROOTS = new Set(["selectFrom", "insertInto", "updateTable", "deleteFrom", "replaceInto", "mergeInto"]);

export default {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { dataPackage: { type: "string" } }, additionalProperties: false }],
    messages: {
      outsideData: "{{name}}() is a query builder call outside packages/data. Every query needs a company context (document 05, section 12); go through the data layer.",
    },
  },
  create(context) {
    const dataPackage = context.options[0]?.dataPackage ?? "packages/data/";
    if (normalizedPath(context).includes(dataPackage)) return {};
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
