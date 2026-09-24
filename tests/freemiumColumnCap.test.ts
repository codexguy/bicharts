import { describe, it, expect } from "vitest";
import { freemiumColumnsOverCap, freemiumColumnCapRefusal, freemiumDateHierarchyClauses } from "../packages/shape-core/src/freemiumCaps";

// A host anticipating the freemium column cap in the server's own words (2026-09-17).
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
        // The production binding that motivated this.
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

    it("renders the production refusal exactly as the server would have", () => {
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

// A DATE HIERARCHY COUNTS AS SEVERAL FIELDS, AND THE REFUSAL NAMES IT.
//
// A reader bound six fields - two of them date HIERARCHIES - and was told to remove two. The host keeps a
// reassembled hierarchy's four levels and adds the date it rebuilt from them, so each hierarchy is five
// entries in the shape the cap counts. The count stands; the sentence now says which fields cost what and
// the one move that frees the slots without losing a field. The clause below is pinned verbatim on the
// server as well - one literal, two authors, so it is checked on both sides.
const hierarchy = (gid: string, dateName: string, sourceField?: string) => [
    { name: "Year", isDatePart: true, dateGroupId: gid },
    { name: "Quarter", isDatePart: true, dateGroupId: gid },
    { name: "Month", isDatePart: true, dateGroupId: gid },
    { name: "Day", isDatePart: true, dateGroupId: gid },
    { name: dateName, isReassembledDate: true, dateGroupId: gid, ...(sourceField ? { sourceField } : {}) },
];
const twoHierarchies = [
    { name: "Region" }, { name: "Product" },
    ...hierarchy("dg0", "Date", "Order date"),
    ...hierarchy("dg1", "Date 2", "Ship date"),
    { name: "Units" }, { name: "Revenue" },
];

describe("freemiumColumnCapRefusal - date hierarchies", () => {
    it("appends one clause per date group, naming its source field and its real cost", () => {
        expect(twoHierarchies.length).toBe(14);
        expect(freemiumColumnCapRefusal(14, server, twoHierarchies)).toBe(
            "This visual has 2 more data fields than the free tier allows. Remove 2 fields and generate again, or get a license to lift the limit."
            + " 'Order date' is a date hierarchy and counts as 5 fields - bind the date itself instead of its hierarchy."
            + " 'Ship date' is a date hierarchy and counts as 5 fields - bind the date itself instead of its hierarchy."
        );
    });

    it("falls back to the reassembled column's own name when the host sent no source field", () => {
        expect(freemiumDateHierarchyClauses(hierarchy("dg0", "Date"))).toEqual([
            "'Date' is a date hierarchy and counts as 5 fields - bind the date itself instead of its hierarchy.",
        ]);
    });

    it("counts the levels the group actually kept, plus the date", () => {
        const threeLevels = hierarchy("dg0", "Date", "Order date").filter(c => c.name !== "Quarter");
        expect(freemiumDateHierarchyClauses(threeLevels)).toEqual([
            "'Order date' is a date hierarchy and counts as 4 fields - bind the date itself instead of its hierarchy.",
        ]);
    });

    it("adds nothing when the shape has no date group, and nothing within the cap", () => {
        const flat = Array.from({ length: 14 }, (_, i) => ({ name: "F" + i }));
        expect(freemiumColumnCapRefusal(14, server, flat)).toBe(freemiumColumnCapRefusal(14, server));
        expect(freemiumColumnCapRefusal(12, server, twoHierarchies)).toBeNull();
        expect(freemiumDateHierarchyClauses(undefined)).toEqual([]);
    });

    it("keeps the pinned sentences byte-identical when no shape is passed", () => {
        expect(freemiumColumnCapRefusal(20, server)).toBe(
            "This visual has 8 more data fields than the free tier allows. A license lifts the limit - or, if you would rather stay on the free tier, remove 8 fields and generate again."
        );
    });

    it("stays silent where the server sent no template, whatever the shape", () => {
        expect(freemiumColumnCapRefusal(14, { freemiumMaxShapeColumns: 12 }, twoHierarchies)).toBeNull();
    });
});
