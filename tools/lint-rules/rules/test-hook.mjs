/**
 * TR-9: every control in the screens has a stable identifier and a role, so scripts never depend
 * on text or position. The convention (docs/CONVENTIONS.md):
 *   - `data-testid="<screen code or area>.<part>.<name>"`, for example UI-01-01.signin.submit
 *   - native controls (button, input, select, textarea, a with href, summary) carry their role
 *     by being what they are; any other element with a click or key handler needs `role` too
 * Reported on lower-case JSX elements. A spread attribute may supply either, so it silences the rule.
 */
const CONTROLS = new Set(["button", "input", "select", "textarea", "summary"]);
const HANDLERS = new Set(["onClick", "onDoubleClick", "onKeyDown", "onKeyUp", "onPointerDown", "onTouchStart"]);
export const TEST_ID_FORMAT = /^[A-Za-z][A-Za-z0-9-]*(?:\.[a-z0-9][A-Za-z0-9-]*)+$/;

function attr(node, name) {
  return node.attributes.find((a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === name);
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      missingTestId: "<{{tag}}> is a control and needs data-testid (TR-9), e.g. data-testid=\"UI-01-01.signin.submit\".",
      badTestId: "data-testid \"{{value}}\" does not follow <screen-or-area>.<part>.<name> (TR-9).",
      missingRole: "<{{tag}}> has a click or key handler but no role (TR-9). Use a native control or add role.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name)) return;
        const tag = node.name.name;
        if (node.attributes.some((a) => a.type === "JSXSpreadAttribute")) return;
        const testId = attr(node, "data-testid");
        const type = attr(node, "type");
        const hiddenInput = tag === "input" && type?.value?.type === "Literal" && type.value.value === "hidden";
        const isLink = tag === "a" && attr(node, "href") !== undefined;
        const hasHandler = node.attributes.some((a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && HANDLERS.has(a.name.name));
        const isControl = (CONTROLS.has(tag) && !hiddenInput) || isLink || hasHandler;
        if (!isControl) return;
        if (testId === undefined) {
          context.report({ node, messageId: "missingTestId", data: { tag } });
        } else if (testId.value?.type === "Literal" && typeof testId.value.value === "string" && !TEST_ID_FORMAT.test(testId.value.value)) {
          context.report({ node: testId, messageId: "badTestId", data: { value: testId.value.value } });
        }
        if (hasHandler && !CONTROLS.has(tag) && !isLink && attr(node, "role") === undefined) {
          context.report({ node, messageId: "missingRole", data: { tag } });
        }
      },
    };
  },
};
