import { describe, it, expect } from "vitest";
import { detectOrdinalDomain } from "../src/ordinalDetector";
import { IndexedText } from "../src/indexedText";

// A RANK CODE IN FRONT OF A CATALOGUE LABEL MUST NOT HIDE THE LABEL.
//
// A bug-tracker severity column of "S1 - Critical" / "S2 - Major" / "S3 - Minor" / "S4 - Trivial"
// matched no catalogue scale, although "Critical / Major / Minor / Trivial" written plainly does. No
// order shipped, so the column was treated as an unordered category. The detector now peels a leading
// code off every value and matches the labels - but ONLY when the codes are one scheme, their numbers
// are distinct, and they agree with the scale's order. The domain it reports is the CODED strings,
// because those are what the data holds and what the chart filters on.
describe("leading rank codes are peeled before the catalogue match", () => {
    it("S1-S4 severity resolves on the same scale as the bare labels, shipping the coded strings", () => {
        const bare = detectOrdinalDomain(["Minor", "Critical", "Trivial", "Major"]);
        const r = detectOrdinalDomain(["S3 - Minor", "S1 - Critical", "S4 - Trivial", "S2 - Major"]);
        expect(r).not.toBeNull();
        expect(r!.pattern).toBe("severity_trivial_blocker");
        expect(r!.pattern).toBe(bare!.pattern);
        expect(r!.orderedDomain).toEqual(["S4 - Trivial", "S3 - Minor", "S2 - Major", "S1 - Critical"]);
    });

    it("P0-P3 priority resolves, the falling number running with the rising priority", () => {
        const r = detectOrdinalDomain(["P2 - Medium", "P0 - Urgent", "P3 - Low", "P1 - High"]);
        expect(r).not.toBeNull();
        expect(r!.pattern).toBe("severity_low_urgent");
        expect(r!.orderedDomain).toEqual(["P3 - Low", "P2 - Medium", "P1 - High", "P0 - Urgent"]);

        const colon = detectOrdinalDomain(["P1: Critical", "P3: Minor", "P0: Blocker", "P2: Major"]);
        expect(colon!.pattern).toBe("severity_trivial_blocker");
        expect(colon!.orderedDomain).toEqual(["P3: Minor", "P2: Major", "P1: Critical", "P0: Blocker"]);
    });

    it("a bare numbered list (1. Low / 2. Medium / 3. High) resolves, the number rising with the scale", () => {
        const r = detectOrdinalDomain(["3. High", "1. Low", "2. Medium"]);
        expect(r).not.toBeNull();
        expect(r!.pattern).toBe("severity_low_critical");
        expect(r!.orderedDomain).toEqual(["1. Low", "2. Medium", "3. High"]);
    });

    it("accepts either direction, as long as it is ONE direction", () => {
        const r = detectOrdinalDomain(["S1 - Trivial", "S2 - Minor", "S3 - Major", "S4 - Critical"]);
        expect(r!.pattern).toBe("severity_trivial_blocker");
        expect(r!.orderedDomain).toEqual(["S1 - Trivial", "S2 - Minor", "S3 - Major", "S4 - Critical"]);
    });

    it("reads every separator and prefix form of the code", () => {
        const forms: [string, string[]][] = [
            ["colon",        ["S1: Critical", "S2: Major", "S3: Minor", "S4: Trivial"]],
            ["tight hyphen", ["S1-Critical", "S2-Major", "S3-Minor", "S4-Trivial"]],
            ["word prefix",  ["Sev 1 - Critical", "Sev 2 - Major", "Sev 3 - Minor", "Sev 4 - Trivial"]],
            ["L prefix",     ["L1 - Critical", "L2 - Major", "L3 - Minor", "L4 - Trivial"]],
            ["paren",        ["1) Critical", "2) Major", "3) Minor", "4) Trivial"]],
            ["en dash",      ["S1 – Critical", "S2 – Major", "S3 – Minor", "S4 – Trivial"]],
            ["em dash",      ["S1 — Critical", "S2 — Major", "S3 — Minor", "S4 — Trivial"]],
            ["prefix case",  ["s1 - Critical", "S2 - Major", "s3 - Minor", "S4 - Trivial"]],
        ];
        for (const [name, values] of forms) {
            const r = detectOrdinalDomain(values);
            expect(r, name).not.toBeNull();
            expect(r!.pattern, name).toBe("severity_trivial_blocker");
            expect(r!.orderedDomain, name).toEqual([values[3], values[2], values[1], values[0]]);
        }
    });

    it("peels codes off calendar labels too, since the labels are matched exactly as before", () => {
        const r = detectOrdinalDomain(["03 - Mar", "01 - Jan", "04 - Apr", "02 - Feb"]);
        expect(r!.pattern).toBe("month_jan_dec");
        expect(r!.orderedDomain).toEqual(["01 - Jan", "02 - Feb", "03 - Mar", "04 - Apr"]);
    });

    it("ignores blanks and nulls when deciding every value carries a code", () => {
        const r = detectOrdinalDomain([null, "", "S2 - Major", undefined, "S1 - Critical", "S4 - Trivial", "S3 - Minor"] as any);
        expect(r).not.toBeNull();
        expect(r!.orderedDomain).toEqual(["S4 - Trivial", "S3 - Minor", "S2 - Major", "S1 - Critical"]);
    });
});

describe("a code that is not one scheme, or that contradicts the labels, is not evidence of order", () => {
    it("codes that disagree with the scale's order report NO domain", () => {
        expect(detectOrdinalDomain(["S1 - Trivial", "S2 - Critical", "S3 - Minor", "S4 - Major"])).toBeNull();
        // Mostly in order is still a contradiction.
        expect(detectOrdinalDomain(["S1 - Trivial", "S2 - Minor", "S3 - Critical", "S4 - Major"])).toBeNull();
    });

    it("mixed prefixes (S1 beside P2) are not stripped - the column is judged as written", () => {
        expect(detectOrdinalDomain(["S1 - Critical", "P2 - Major", "S3 - Minor", "S4 - Trivial"])).toBeNull();
    });

    it("one value without a code leaves the column judged as written", () => {
        expect(detectOrdinalDomain(["S1 - Critical", "S2 - Major", "S3 - Minor", "Trivial"])).toBeNull();
    });

    it("a repeated code number is not a ranking", () => {
        expect(detectOrdinalDomain(["S1 - Critical", "S1 - Major", "S2 - Minor", "S3 - Trivial"])).toBeNull();
    });

    it("two coded values on ONE rung is a contradiction, not a scale", () => {
        expect(detectOrdinalDomain(["S1 - High", "S2 - high", "S3 - Medium", "S4 - Low"])).toBeNull();
    });

    it("coded labels outside the catalogue still match nothing", () => {
        expect(detectOrdinalDomain(["S1 - Apple", "S2 - Banana", "S3 - Cherry"])).toBeNull();
    });

    it("codes with no label are left exactly as before", () => {
        expect(detectOrdinalDomain(["S1", "S2", "S3"])).toBeNull();
        const p = detectOrdinalDomain(["P2", "P0", "P3", "P1"]);
        expect(p!.pattern).toBe("priority_p4_p1");
        expect(p!.orderedDomain).toEqual(["P3", "P2", "P1", "P0"]);
    });
});

// The profiler is where the detection becomes a shipped column field, so the coded domain is checked
// there as well: the strings in orderedDomain must be the strings in the data.
describe("the profiler ships the coded domain", () => {
    it("sets ordinalPattern and an orderedDomain of the column's own coded values", () => {
        const it_ = new IndexedText();
        it_.dedupRows = false;
        it_.setColumns([
            { name: "Severity", dataType: "String", isMeasure: false, isGrouping: true } as any,
            { name: "Bugs", dataType: "Integer", isMeasure: true, isGrouping: false } as any,
        ]);
        for (const [sev, n] of [["S2 - Major", 12], ["S1 - Critical", 3], ["S3 - Minor", 30], ["S4 - Trivial", 7], ["S2 - Major", 4]] as const) {
            it_.addRow([sev, n]);
        }
        const cols = it_.getColumnsWithStats("20");
        expect(cols[0].ordinalPattern).toBe("severity_trivial_blocker");
        expect(cols[0].orderedDomain).toEqual(["S4 - Trivial", "S3 - Minor", "S2 - Major", "S1 - Critical"]);
    });
});
