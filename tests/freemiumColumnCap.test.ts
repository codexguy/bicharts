import { describe, it, expect } from "vitest";
import { freemiumColumnsOverCap, freemiumColumnCapRefusal } from "../packages/shape-core/src/freemiumCaps";

// ITEM 634 — a host anticipating the freemium column cap in the server's own words.
//
// The templates below are the server's, verbatim from LLMManager.FreemiumColumnCapTemplate. If
// that method's wording changes, these fixtures go stale and say so loudly — which is the point of
// pinning them rather than paraphrasing: the whole design is that there is ONE author, and a test
// that invented its own sentence would not notice the day a host started drifting from it.
const FEW = "This visual has {n} more data {fields} than the free tier allows. Remove {n} {fields} and generate again, or get a license to lift the limit.";
const MANY = "This visual has {n} more data {fields} than the free tier allows. A license lifts the limit - or, if you would rather stay on the free tier, remove {n} {fields} and generate again.";

const server = {
    freemiumMaxShapeColumns: 12,
    freemiumColumnCapMessageFew: FEW,
    freemiumColumnCapMessageMany: MANY,
    freemiumColumnCapPivot: 4,
};

describe("freemiumColumnsOverCap", () => {
    it("is zero at and under the cap, and counts the excess above it", () => {
        expect(freemiumColumnsOverCap(11, server)).toBe(0);
        expect(freemiumColumnsOverCap(12, server)).toBe(0);
        expect(freemiumColumnsOverCap(13, server)).toBe(1);
        // Prod 2958's own binding.
        expect(freemiumColumnsOverCap(20, server)).toBe(8);
    });

    it("answers null — never zero — when the server sent no cap", () => {
        // Null is 'cannot be anticipated'; zero would read as 'within the cap' and would silently
        // suppress a refusal the server is about to make.
        expect(freemiumColumnsOverCap(50, {})).toBeNull();
        expect(freemiumColumnsOverCap(50, undefined)).toBeNull();
        expect(freemiumColumnsOverCap(50, null)).toBeNull();
    });
});

describe("freemiumColumnCapRefusal", () => {
    it("says nothing at or under the cap", () => {
        expect(freemiumColumnCapRefusal(12, server)).toBeNull();
        expect(freemiumColumnCapRefusal(1, server)).toBeNull();
    });

    it("renders prod 2958's refusal exactly as the server would have", () => {
        expect(freemiumColumnCapRefusal(20, server)).toBe(
            "This visual has 8 more data fields than the free tier allows. A license lifts the limit - or, if you would rather stay on the free tier, remove 8 fields and generate again."
        );
    });

    it("leads with the trim at or below the pivot, and with the licence above it", () => {
        expect(freemiumColumnCapRefusal(16, server)!.startsWith("This visual has 4 more data fields than the free tier allows. Remove 4 fields")).toBe(true);
        expect(freemiumColumnCapRefusal(17, server)).toContain("A license lifts the limit");
    });

    it("says 'field', singular, when one field is one field", () => {
        expect(freemiumColumnCapRefusal(13, server)).toBe(
            "This visual has 1 more data field than the free tier allows. Remove 1 field and generate again, or get a license to lift the limit."
        );
    });

    it("stays silent for a server that sent a cap but no template", () => {
        // Half-upgraded, or an operator who blanked the message. Silence means the round trip
        // happens and the server answers — today's behaviour exactly, which is the safe default.
        expect(freemiumColumnCapRefusal(20, { freemiumMaxShapeColumns: 12 })).toBeNull();
        expect(freemiumColumnCapRefusal(20, { ...server, freemiumColumnCapMessageMany: "   " })).toBeNull();
    });

    it("stays silent for an older server that sent nothing at all", () => {
        expect(freemiumColumnCapRefusal(20, {})).toBeNull();
        expect(freemiumColumnCapRefusal(20, undefined)).toBeNull();
    });

    it("honours an operator override of the server's wording", () => {
        // The override reaches every host for free precisely because the host never authors the
        // sentence — this is the property the design exists for.
        const overridden = { ...server, freemiumColumnCapMessageMany: "Too many fields ({n}). Ask your admin." };
        expect(freemiumColumnCapRefusal(20, overridden)).toBe("Too many fields (8). Ask your admin.");
    });

    it("falls back to a pivot of 4 when the server sent templates but no pivot", () => {
        const noPivot = { ...server, freemiumColumnCapPivot: undefined };
        expect(freemiumColumnCapRefusal(16, noPivot)).toContain("Remove 4 fields and generate again");
        expect(freemiumColumnCapRefusal(17, noPivot)).toContain("A license lifts the limit");
    });
});
