// What the quarter, half-year and week readers decide for ENGLISH labels, pinned before the other
// languages' codes were added beside them. English is read first and wins, so every verdict below must
// hold unchanged after the other languages arrive - including the English labels the readers have never
// taken ("Qtr 1 2024", "W01 2024"), which the new table can read but must not newly admit.
import { describe, it, expect } from "vitest";
import { detectOrdinalDomain } from "../src/ordinalDetector";
import { classifyTemporal } from "../src/indexedText";
import { parseTemporalPoint } from "../src/cadence";

const temporal = (values: string[]) =>
    classifyTemporal({ dataType: "String", name: "Period", isMeasure: false, distinctCount: values.length, sampleValues: values });

describe("English period labels read exactly as before", () => {
    it("the quarter family: bare Q-codes, Qtr and Quarter; three members at least; no year", () => {
        expect(detectOrdinalDomain(["Q1", "Q2", "Q3", "Q4"])).toEqual({ pattern: "quarter_q1_q4", orderedDomain: ["Q1", "Q2", "Q3", "Q4"] });
        expect(detectOrdinalDomain(["Qtr 3", "Qtr 1", "Qtr 2"])).toEqual({ pattern: "quarter_q1_q4", orderedDomain: ["Qtr 1", "Qtr 2", "Qtr 3"] });
        expect(detectOrdinalDomain(["Quarter 4", "Quarter 2", "Quarter 1"])).toEqual({ pattern: "quarter_q1_q4", orderedDomain: ["Quarter 1", "Quarter 2", "Quarter 4"] });
        expect(detectOrdinalDomain(["q-1", "q_2", "Q 3"])).toEqual({ pattern: "quarter_q1_q4", orderedDomain: ["q-1", "q_2", "Q 3"] });
        expect(detectOrdinalDomain(["Q1", "Q2"])).toBeNull();
        expect(detectOrdinalDomain(["Q1 2024", "Q2 2024", "Q3 2024"])).toBeNull();
        expect(detectOrdinalDomain(["Qtr.1", "Qtr.2", "Qtr.3"])).toBeNull();
        expect(detectOrdinalDomain(["Quarter1", "Quarter2", "Quarter3"])).toBeNull();
        expect(detectOrdinalDomain(["1Q", "2Q", "3Q", "4Q"])).toBeNull();
        expect(detectOrdinalDomain(["H1", "H2"])).toBeNull();
        expect(detectOrdinalDomain(["W1", "W2", "W3"])).toBeNull();
    });

    it("the letter codes other languages use, bare, are no quarter in English data", () => {
        expect(detectOrdinalDomain(["T1", "T2", "T3", "T4"])).toBeNull();
        expect(detectOrdinalDomain(["2T", "3T", "4T"])).toBeNull();
        expect(detectOrdinalDomain(["K1", "K2", "K3"])).toBeNull();
        expect(detectOrdinalDomain(["S1", "S2"])).toBeNull();
    });

    it("a period column: the year-first and Q-first forms, and nothing wider", () => {
        expect(temporal(["2024-Q1", "2024-Q2", "2024-Q3"])).toBe(true);
        expect(temporal(["Q1 2024", "Q2 2024", "Q3 2024"])).toBe(true);
        expect(temporal(["2024Q1", "2024Q2"])).toBe(true);
        expect(temporal(["2024-W01", "2024-W02", "2024-W52"])).toBe(true);
        expect(temporal(["Qtr 1 2024", "Qtr 2 2024", "Qtr 3 2024"])).toBe(false);
        expect(temporal(["W01 2024", "W02 2024", "W03 2024"])).toBe(false);
        expect(temporal(["Q1 24", "Q2 24", "Q3 24"])).toBe(false);
        expect(temporal(["H1 2024", "H2 2024"])).toBe(false);
        expect(temporal(["Week 1 2024", "Week 2 2024"])).toBe(false);
    });

    it("the cadence reader's quarter points", () => {
        expect(parseTemporalPoint("2024-Q1")?.iso).toBe("2024-01-01");
        expect(parseTemporalPoint("2024Q2")?.iso).toBe("2024-04-01");
        expect(parseTemporalPoint("Q3 2024")?.iso).toBe("2024-07-01");
        expect(parseTemporalPoint("Q4-2024")?.iso).toBe("2024-10-01");
        expect(parseTemporalPoint("Qtr 1 2024")).toBeNull();
        expect(parseTemporalPoint("Quarter 2 2024")).toBeNull();
        expect(parseTemporalPoint("1Q24")).toBeNull();
        expect(parseTemporalPoint("H1 2024")).toBeNull();
    });
});
