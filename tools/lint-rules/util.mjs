/** Shared helpers for the local lint rules. */

/** The path of the linted file with forward slashes, so rules behave the same on Windows. */
export function normalizedPath(context) {
  return context.filename.replaceAll("\\", "/");
}

/** True when the file path contains any of the given fragments (forward-slash form). */
export function pathMatches(context, fragments) {
  const file = normalizedPath(context);
  return (fragments ?? []).some((f) => file.includes(f));
}

/** The name of a plain, non-computed property access (`a.b` gives "b"), else undefined. */
export function propertyName(memberNode) {
  if (memberNode.type !== "MemberExpression" || memberNode.computed) return undefined;
  return memberNode.property.type === "Identifier" ? memberNode.property.name : undefined;
}

/** True when the node is `globalThis.name`, `window.name`, `self.name` or the bare identifier. */
export function isGlobalRef(node, name) {
  if (node.type === "Identifier") return node.name === name;
  if (node.type === "MemberExpression" && !node.computed) {
    const root = node.object.type === "Identifier" ? node.object.name : "";
    return ["globalThis", "window", "self", "global"].includes(root) && node.property.type === "Identifier" && node.property.name === name;
  }
  return false;
}
