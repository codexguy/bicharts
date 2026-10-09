// COMPILE-TIME ONLY - included by this package's tsconfig.json, so `npm run typecheck` (run by
// every release) fails when a host can no longer spread `fetchFields` into a request typed
// `LLMRequestCode` with the recovery poll's arm time on it: the wire model and the builder have to
// name the same field, as the same whole number.
import type { FetchFields, LLMRequestCode } from "@bicharts/shape-core";

/** Resolves to true only when A and B are each assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const fetchArmedAtMsWire: {
    request: Same<NonNullable<LLMRequestCode["fetchArmedAtMs"]>, number>;
    fields: Same<NonNullable<FetchFields["fetchArmedAtMs"]>, number>;
    // The member is optional on both sides, so a request without a poll has no such key to state.
    optionalOnBoth: Same<Pick<FetchFields, "fetchArmedAtMs">, Pick<LLMRequestCode, "fetchArmedAtMs">>;
} = { request: true, fields: true, optionalOnBoth: true };
