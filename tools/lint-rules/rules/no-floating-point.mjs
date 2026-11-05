import ts from "typescript";
import { isGlobalRef, propertyName } from "../util.mjs";

/**
 * Document 05, section 10: money, quantity, cost, rate and percentage are whole numbers with fixed
 * scales, and only the numeric module multiplies or divides them. This rule is the code check the
 * document asks for. It forbids what produces or reads fractions:
 *   - number literals with a decimal point (1.5, 0.1, 1.0)
 *   - parseFloat, Number.parseFloat, toFixed, toPrecision, toExponential
 *   - Math functions other than the integer-safe ones (floor, round, sqrt, pow, random, PI ...)
 *   - division whose operands are not both bigint (type-aware; without type information any
 *     division is reported unless an operand is a bigint literal)
 * Multiplication is not reported here: BC-02 introduces branded money types and tightens this.
 */
const SAFE_MATH = new Set(["min", "max", "abs", "sign", "trunc", "imul", "clz32"]);

function isBigIntLike(context, node) {
  const services = context.sourceCode.parserServices;
  if (node.type === "Literal" && typeof node.bigint === "string") return true;
  if (!services?.program || !services.esTreeNodeToTSNodeMap) return false;
  const checker = services.program.getTypeChecker();
  const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
  const parts = type.isUnion() ? type.types : [type];
  return parts.every((t) => (t.flags & ts.TypeFlags.BigIntLike) !== 0);
}

export default {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { literals: { type: "boolean" }, division: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      floatLiteral: "Floating-point literal {{raw}}. Money, quantity, cost, rate and percentage are whole numbers with fixed scales (document 05, section 10); use the numeric module.",
      floatCall: "{{name}} reads or writes fractions. Use the numeric module (document 05, section 10).",
      mathFn: "Math.{{name}} is floating-point arithmetic. Use the numeric module; only min, max, abs, sign, trunc, imul and clz32 are allowed here.",
      division: "Division of values that are not both bigint can produce a fraction. Divide through the numeric module (document 05, section 10).",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const checkLiterals = options.literals !== false;
    const checkDivision = options.division !== false;
    return {
      Literal(node) {
        if (!checkLiterals || typeof node.value !== "number") return;
        const raw = node.raw ?? "";
        if (/^0[xXbBoO]/.test(raw)) return;
        if (raw.includes(".") || !Number.isSafeInteger(node.value)) {
          context.report({ node, messageId: "floatLiteral", data: { raw } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (isGlobalRef(callee, "parseFloat")) {
          context.report({ node, messageId: "floatCall", data: { name: "parseFloat" } });
          return;
        }
        if (callee.type === "MemberExpression") {
          const name = propertyName(callee);
          if (name === "parseFloat" && callee.object.type === "Identifier" && callee.object.name === "Number") {
            context.report({ node, messageId: "floatCall", data: { name: "Number.parseFloat" } });
          } else if (name === "toFixed" || name === "toPrecision" || name === "toExponential") {
            context.report({ node, messageId: "floatCall", data: { name: `.${name}()` } });
          }
        }
      },
      MemberExpression(node) {
        if (node.computed || node.object.type !== "Identifier" || node.object.name !== "Math") return;
        const name = propertyName(node);
        if (name !== undefined && !SAFE_MATH.has(name)) {
          context.report({ node, messageId: "mathFn", data: { name } });
        }
      },
      BinaryExpression(node) {
        if (!checkDivision || node.operator !== "/") return;
        if (!(isBigIntLike(context, node.left) && isBigIntLike(context, node.right))) {
          context.report({ node, messageId: "division" });
        }
      },
      AssignmentExpression(node) {
        if (!checkDivision || node.operator !== "/=") return;
        if (!(isBigIntLike(context, node.left) && isBigIntLike(context, node.right))) {
          context.report({ node, messageId: "division" });
        }
      },
    };
  },
};
