/**
 * Document 05, section 10 and N-7: "No other code is allowed to multiply or divide money or
 * quantity." Only @mandi/numeric may. A value of one of its scaled types (Paisa, Milli, Micro, R4, P4;
 * they carry the brand property `__scale`) must not be an operand of * / % ** or their compound
 * assignments anywhere else. Use lineAmount, costOf, percentOf and the rest instead.
 * Needs type information; without it the rule cannot know a type and reports nothing.
 */
const OPERATORS = new Set(["*", "/", "%", "**", "*=", "/=", "%=", "**="]);

function isScaled(context, node) {
  const services = context.sourceCode.parserServices;
  if (!services?.program || !services.esTreeNodeToTSNodeMap) return false;
  const checker = services.program.getTypeChecker();
  const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((t) => checker.getPropertyOfType(t, "__scale") !== undefined);
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      moneyMath: "'{{op}}' on a money, quantity, cost, rate or percentage value. Only @mandi/numeric may multiply or divide these (document 05, section 10); use lineAmount, costOf, percentOf, unitCostMicro or toBase.",
    },
  },
  create(context) {
    function check(node) {
      if (!OPERATORS.has(node.operator)) return;
      if (isScaled(context, node.left) || isScaled(context, node.right)) {
        context.report({ node, messageId: "moneyMath", data: { op: node.operator } });
      }
    }
    return { BinaryExpression: check, AssignmentExpression: check };
  },
};
