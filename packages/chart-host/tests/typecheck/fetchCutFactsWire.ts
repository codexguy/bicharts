// COMPILE-TIME ONLY - included by this package's tsconfig.json, so `npm run typecheck` (run by
// every release) fails when a host can no longer spread `fetchFields` into a request typed
// `LLMRequestCode` with a recovery poll's cut time and cause on it: the wire model and the builder
// have to name the same two fields, with the same types, optional on both.
import type { FetchFields, LLMRequestCode } from "@bicharts/shape-core";

/** Resolves to true only when A and B are each assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const fetchCutFactsWire: {
    requestCutAt: Same<NonNullable<LLMRequestCode["fetchCutAtMs"]>, number>;
    requestCause: Same<NonNullable<LLMRequestCode["fetchCause"]>, string>;
    optionalOnBoth: Same<Pick<FetchFields, "fetchCutAtMs" | "fetchCause">, Pick<LLMRequestCode, "fetchCutAtMs" | "fetchCause">>;
} = { requestCutAt: true, requestCause: true, optionalOnBoth: true };
