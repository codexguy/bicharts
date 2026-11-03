// COMPILE-TIME ONLY - included by this package's tsconfig.json, so `npm run typecheck` (run by every release) fails when
// the request's reader setting for which way is good stops being the shape every host sends: clientHints.directionOfGood,
// a list of { measure, better }, beside levelOfDetail.
import type { LLMClientHints, LLMDirectionOfGood } from "../../src/index";

export const hints: LLMClientHints = {
    levelOfDetail: "Medium",
    directionOfGood: [{ measure: "Bookings", better: "higher" }, { measure: "Cost", better: "lower" }],
};
export const one: LLMDirectionOfGood = { measure: "Return rate", better: "lower" };
// @ts-expect-error - only "higher" or "lower"
export const wrong: LLMDirectionOfGood = { measure: "Cost", better: "down" };
