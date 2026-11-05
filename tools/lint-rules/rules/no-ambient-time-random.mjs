import { isGlobalRef, pathMatches, propertyName } from "../util.mjs";

/**
 * TR-1 and TR-2: time and randomness come from the injected clock and random source, so a test can
 * set the day, make the clock wrong, and replay a seed. The real clock and the real random source
 * are read in exactly two files (options.allowFiles). Reported everywhere else:
 *   Date.now(), new Date() with no argument, performance.now(), Math.random(),
 *   crypto.randomUUID / getRandomValues, randomBytes / randomUUID / randomInt imports,
 *   setTimeout, setInterval, setImmediate (unless options.timers is false).
 */
const NODE_RANDOM = new Set(["randomBytes", "randomUUID", "randomInt", "randomFillSync", "randomFill", "getRandomValues", "webcrypto"]);
const TIMERS = new Set(["setTimeout", "setInterval", "setImmediate"]);

export default {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          allowFiles: { type: "array", items: { type: "string" } },
          timers: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      time: "{{what}} reads the real clock. Take time from the injected Clock (TR-1).",
      random: "{{what}} reads real randomness. Take it from the injected RandomSource (TR-2).",
      timer: "{{what}} uses a real timer. Use clock.sleep from the injected Clock so tests and the simulator control time (TR-1).",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    if (pathMatches(context, options.allowFiles)) return {};
    const checkTimers = options.timers !== false;
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "MemberExpression") {
          const name = propertyName(callee);
          const obj = callee.object;
          if (name === "now" && isGlobalRef(obj, "Date")) {
            context.report({ node, messageId: "time", data: { what: "Date.now()" } });
          } else if (name === "now" && isGlobalRef(obj, "performance")) {
            context.report({ node, messageId: "time", data: { what: "performance.now()" } });
          } else if (name === "random" && isGlobalRef(obj, "Math")) {
            context.report({ node, messageId: "random", data: { what: "Math.random()" } });
          } else if ((name === "randomUUID" || name === "getRandomValues") && isGlobalRef(obj, "crypto")) {
            context.report({ node, messageId: "random", data: { what: `crypto.${name}()` } });
          } else if (name !== undefined && NODE_RANDOM.has(name) && obj.type === "Identifier" && /crypto/i.test(obj.name)) {
            context.report({ node, messageId: "random", data: { what: `${obj.name}.${name}()` } });
          } else if (checkTimers && name !== undefined && TIMERS.has(name) && ["globalThis", "window", "self", "global"].includes(obj.type === "Identifier" ? obj.name : "")) {
            context.report({ node, messageId: "timer", data: { what: `${name}()` } });
          }
        } else if (callee.type === "Identifier") {
          if (checkTimers && TIMERS.has(callee.name)) {
            context.report({ node, messageId: "timer", data: { what: `${callee.name}()` } });
          } else if (NODE_RANDOM.has(callee.name)) {
            context.report({ node, messageId: "random", data: { what: `${callee.name}()` } });
          }
        }
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Date" && node.arguments.length === 0) {
          context.report({ node, messageId: "time", data: { what: "new Date()" } });
        }
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source !== "node:crypto" && source !== "crypto") return;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportSpecifier" && NODE_RANDOM.has(spec.imported.name ?? spec.imported.value)) {
            context.report({ node: spec, messageId: "random", data: { what: `import { ${spec.imported.name ?? spec.imported.value} }` } });
          }
        }
      },
    };
  },
};
