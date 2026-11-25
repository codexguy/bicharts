import { describe, it, expect } from "vitest";
import { detectOrdinalDomain } from "../src/ordinalDetector";

// A FISCAL PERIOD CODE AND A NUMBERED ROUND ARE AN ORDER.
//
// A fiscal calendar's periods ("FY24 P01" .. "FY25 P13") and a league's rounds ("Round 1" .. "Round 22") shipped as plain
// text: no pattern, no order, so a line over them had no axis and their columns sorted "Round 10" before "Round 2". The
// author wrote the order into every value; the detector now reads it - narrowly.
describe("fiscal period codes", () => {
    const fy = ["FY24 P01", "FY24 P02", "FY24 P10", "FY24 P13", "FY25 P01", "FY25 P02", "FY25 P11"];

    it("orders by fiscal year, then period", () => {
        const r = detectOrdinalDomain([...fy].reverse());
        expect(r).not.toBeNull();
        expect(r!.pattern).toBe("fiscal_period");
        expect(r!.orderedDomain).toEqual(fy);
    });

    it("reads the year in four digits and quarters, months, weeks and halves", () => {
        expect(detectOrdinalDomain(["FY2025 Q2", "FY2024 Q4", "FY2025 Q1"])!.orderedDomain).toEqual(["FY2024 Q4", "FY2025 Q1", "FY2025 Q2"]);
        expect(detectOrdinalDomain(["FY24-M03", "FY24-M01", "FY24-M02"])!.orderedDomain).toEqual(["FY24-M01", "FY24-M02", "FY24-M03"]);
        expect(detectOrdinalDomain(["P02 FY24", "P01 FY24", "P01 FY25"])!.orderedDomain).toEqual(["P01 FY24", "P02 FY24", "P01 FY25"]);
    });

    it("needs FY on every value: bare P-codes are products as often as periods", () => {
        expect(detectOrdinalDomain(["P01", "P02", "P03"])).toBeNull();
        expect(detectOrdinalDomain(["FY24 P01", "Widget", "FY24 P02"])).toBeNull();
    });

    it("refuses one code twice and a period past its grain", () => {
        expect(detectOrdinalDomain(["FY24 Q1", "FY24 Q5", "FY24 Q2"])).toBeNull();
    });
});

describe("a numbered sequence word", () => {
    it("Round 1 .. Round 22 orders by the number, not the text", () => {
        const rounds = Array.from({ length: 22 }, (_, i) => `Round ${i + 1}`);
        const r = detectOrdinalDomain([...rounds].sort());
        expect(r).not.toBeNull();
        expect(r!.pattern).toBe("sequence_number");
        expect(r!.orderedDomain).toEqual(rounds);
    });

    it("takes the sequence nouns only: a store, a team or a product number is a name, not a step", () => {
        expect(detectOrdinalDomain(["Week 3", "Week 1", "Week 2"])!.orderedDomain).toEqual(["Week 1", "Week 2", "Week 3"]);
        expect(detectOrdinalDomain(["Sprint 12", "Sprint 9", "Sprint 10"])!.orderedDomain).toEqual(["Sprint 9", "Sprint 10", "Sprint 12"]);
        expect(detectOrdinalDomain(["Store 12", "Store 3", "Store 7"])).toBeNull();
        expect(detectOrdinalDomain(["Team 1", "Team 2", "Team 3"])).toBeNull();
    });

    it("needs one word, distinct numbers and three values", () => {
        expect(detectOrdinalDomain(["Round 1", "Stage 2", "Round 3"])).toBeNull();
        expect(detectOrdinalDomain(["Round 1", "Round 2"])).toBeNull();
        expect(detectOrdinalDomain(["Round 1", "round 1", "Round 2", "Round 3"])!.orderedDomain).toEqual(["Round 1", "Round 2", "Round 3"]);
    });
});
