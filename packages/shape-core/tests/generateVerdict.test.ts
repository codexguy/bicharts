import { describe, it, expect } from "vitest";
import { isDeterministicRefusal } from "../src/util";
import type { LLMRequestCodeResult } from "../src/models";

// A generate answer the server reached BEFORE any model ran is a verdict: the same request
// asked again gets the same answer at the same price of nothing. A host with a retry loop must
// stop on it. This predicate is the one place that rule lives, so both hosts that retry read
// the same bit the same way.

const answer = (over: Partial<LLMRequestCodeResult>): LLMRequestCodeResult =>
    ({ errorMessage: "x", isServiceError: false, ...over });

describe("isDeterministicRefusal", () => {
    it("is true only for an explicit isRefusal: true", () => {
        expect(isDeterministicRefusal(answer({ isRefusal: true }))).toBe(true);
    });

    it("reads an older server (no field) as NOT a verdict", () => {
        // The field is additive. A server that predates it never says so, and a host must keep
        // retrying exactly as it did - never widen the no-retry class by inference.
        expect(isDeterministicRefusal(answer({}))).toBe(false);
        expect(isDeterministicRefusal(answer({ isRefusal: undefined }))).toBe(false);
    });

    it("reads a transient failure as NOT a verdict, whatever else it says", () => {
        expect(isDeterministicRefusal(answer({ isServiceError: true }))).toBe(false);
        expect(isDeterministicRefusal(answer({ isRateLimited: true }))).toBe(false);
        expect(isDeterministicRefusal(answer({ isRefusal: false, isServiceError: true }))).toBe(false);
    });

    it("never throws on nothing at all", () => {
        expect(isDeterministicRefusal(null)).toBe(false);
        expect(isDeterministicRefusal(undefined)).toBe(false);
        expect(isDeterministicRefusal({} as any)).toBe(false);
        // A truthy non-boolean is not a verdict either: the wire field is a boolean or absent.
        expect(isDeterministicRefusal({ isRefusal: 1 as any })).toBe(false);
    });
});
