import companyContext from "./rules/company-context.mjs";
import noAmbientTimeRandom from "./rules/no-ambient-time-random.mjs";
import noFloatingPoint from "./rules/no-floating-point.mjs";
import noMoneyArithmetic from "./rules/no-money-arithmetic.mjs";
import noRawSql from "./rules/no-raw-sql.mjs";
import testHook from "./rules/test-hook.mjs";

/** The product's own lint rules (document 05, section 10 and 12; document 08, SEC-1, SEC-5; document 09, TR-1, TR-2, TR-9). */
export default {
  meta: { name: "mandi", version: "0.1.0" },
  rules: {
    "company-context": companyContext,
    "no-ambient-time-random": noAmbientTimeRandom,
    "no-floating-point": noFloatingPoint,
    "no-money-arithmetic": noMoneyArithmetic,
    "no-raw-sql": noRawSql,
    "test-hook": testHook,
  },
};
