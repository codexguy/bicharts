import { describe, it, expect } from "vitest";
import { IndexedText, classifyTemporal, detectTextDatePattern } from "../src";
import type { LLMColumnWithValue } from "../src/models";

// FULL CALENDAR DATES STORED AS TEXT (2026-08-19).
//
// Genesis: a real user's project schedule - planned start/end, actual start/end - arrived
// with every date typed as a String (a CSV import, Spanish locale, the strictest privacy
// tier so no value reached the server). Nothing recognised a date, every time-based chart
// was ineligible, and the user was handed a network diagram whose NODES were dates. The
// period detector (2024-Q1, Jan 2024) was never written for days; this is the day-level
// half, and it ships the READING ("%d/%m/%Y") alongside the flag, because a flag alone would
// make Gantt eligible and then leave the code calling new Date("15/03/2024").

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

describe("detectTextDatePattern - is it a date, and how is it read", () => {
    it("ISO dates read year-first with no locale needed", () => {
        const d = detectTextDatePattern(["2024-03-15", "2024-03-16", "2024-04-01"]);
        expect(d).toEqual({ pattern: "%Y-%m-%d", orderFrom: "iso" });
    });

    it("ISO with a time of day on EVERY value carries the time; on SOME values reads to the day", () => {
        expect(detectTextDatePattern(["2024-03-15T09:30", "2024-03-16T17:05"])?.pattern).toBe("%Y-%m-%dT%H:%M");
        expect(detectTextDatePattern(["2024-03-15T09:30:00", "2024-03-16T17:05:12"])?.pattern).toBe("%Y-%m-%dT%H:%M:%S");
        expect(detectTextDatePattern(["2024-03-15T09:30:00", "2024-03-16"])?.pattern).toBe("%Y-%m-%d");
    });

    it("a first field over 12 DECIDES day-first, whatever the locale says", () => {
        const d = detectTextDatePattern(["15/03/2024", "02/04/2024", "28/02/2024"], "en-US");
        expect(d).toEqual({ pattern: "%d/%m/%Y", orderFrom: "values" });
    });

    it("a second field over 12 DECIDES month-first, whatever the locale says", () => {
        const d = detectTextDatePattern(["03/15/2024", "04/02/2024"], "es-ES");
        expect(d).toEqual({ pattern: "%m/%d/%Y", orderFrom: "values" });
    });

    it("when no value decides the order, the host locale does: es is day-first, en-US is month-first", () => {
        const ambiguous = ["01/02/2024", "03/04/2024", "05/06/2024"];
        expect(detectTextDatePattern(ambiguous, "es-ES")).toEqual({ pattern: "%d/%m/%Y", orderFrom: "locale" });
        expect(detectTextDatePattern(ambiguous, "en-GB")).toEqual({ pattern: "%d/%m/%Y", orderFrom: "locale" });
        expect(detectTextDatePattern(ambiguous, "en-US")).toEqual({ pattern: "%m/%d/%Y", orderFrom: "locale" });
        // No locale at all reads day-first, because most of the world does.
        expect(detectTextDatePattern(ambiguous)).toEqual({ pattern: "%d/%m/%Y", orderFrom: "locale" });
    });

    it("keeps the column's own separator - dots and dashes are not rewritten to slashes", () => {
        expect(detectTextDatePattern(["15.03.2024", "16.03.2024"])?.pattern).toBe("%d.%m.%Y");
        expect(detectTextDatePattern(["15-03-2024", "16-03-2024"])?.pattern).toBe("%d-%m-%Y");
        expect(detectTextDatePattern(["2024/03/15", "2024/03/16"])?.pattern).toBe("%Y/%m/%d");
    });

    it("refuses two-digit years - '12/05/24' has too many readings to call a date", () => {
        expect(detectTextDatePattern(["12/05/24", "13/05/24", "14/05/24"])).toBeNull();
    });

    it("refuses a column that is dates in TWO shapes - one pattern would silently misparse half of it", () => {
        expect(detectTextDatePattern(["2024-03-15", "16/03/2024", "2024-03-17", "18/03/2024"])).toBeNull();
        expect(detectTextDatePattern(["15/03/2024", "16.03.2024", "17/03/2024", "18.03.2024"])).toBeNull();
    });

    it("refuses a column whose values claim BOTH orders", () => {
        // 15/03 says day-first; 03/15 says month-first. That is not one date column.
        expect(detectTextDatePattern(["15/03/2024", "03/15/2024"])).toBeNull();
    });

    it("refuses free text, codes and numbers that happen to contain digits", () => {
        expect(detectTextDatePattern(["CNSOL-2024-001", "CNSOL-2024-002"])).toBeNull();
        expect(detectTextDatePattern(["1234", "5678"])).toBeNull();
        expect(detectTextDatePattern(["Q1 2024", "Q2 2024"])).toBeNull();   // a PERIOD - the other detector's job
        expect(detectTextDatePattern(["99/99/2024", "00/00/2024"])).toBeNull();
    });

    it("tolerates a straggler below the 80% floor, and needs at least two values", () => {
        expect(detectTextDatePattern(["15/03/2024", "16/03/2024", "17/03/2024", "18/03/2024", "TBD"])?.pattern).toBe("%d/%m/%Y");
        expect(detectTextDatePattern(["15/03/2024", "TBD"])).toBeNull();
        expect(detectTextDatePattern(["15/03/2024"])).toBeNull();
    });
});

describe("classifyTemporal - a full date as text IS a time axis", () => {
    it("flags a String column of slash dates", () => {
        expect(classifyTemporal({
            dataType: "String", name: "CNSOL_FE_INICIO", isMeasure: false, distinctCount: 3,
            sampleValues: ["15/03/2024", "16/03/2024", "17/03/2024"], locale: "es",
        })).toBe(true);
    });

    it("still flags period strings (the older branch is untouched)", () => {
        expect(classifyTemporal({
            dataType: "String", name: "Period", isMeasure: false, distinctCount: 2,
            sampleValues: ["2024-Q1", "2024-Q2"],
        })).toBe(true);
    });

    it("does not flag a String column that is not dates", () => {
        expect(classifyTemporal({
            dataType: "String", name: "CNSOL_DESC_SUBPARTIDA_5", isMeasure: false, distinctCount: 2,
            sampleValues: ["Obra civil", "Equipamiento"],
        })).toBe(false);
    });
});

describe("IndexedText - the pattern ships at EVERY privacy tier, and only where it belongs", () => {
    // The exact shape of the generation that motivated this: planned + actual start/end as
    // text, a sub-item code and description, an executed flag. Spanish locale.
    function schedule(privacy: string): LLMColumnWithValue[] {
        const t = new IndexedText();
        t.setColumns([
            col("CNSOL_ID", "String"),
            col("CNSOL_DESC_SUBPARTIDA_5", "String"),
            col("CNSOL_FP_INICIO", "String"),
            col("CNSOL_FP_FIN", "String"),
            col("CNSOL_FE_INICIO", "String"),
            col("CNSOL_FE_FIN", "String"),
            col("CNSOL_EJECUTADO", "Boolean"),
        ]);
        t.addRow(["C-001", "Obra civil", "01/02/2024", "28/02/2024", "05/02/2024", "03/03/2024", true]);
        t.addRow(["C-002", "Equipamiento", "01/03/2024", "15/04/2024", "04/03/2024", "20/04/2024", true]);
        t.addRow(["C-003", "Puesta en marcha", "16/04/2024", "30/04/2024", "22/04/2024", "22/04/2024", false]);
        t.addRow(["C-004", "Obra civil", "01/05/2024", "31/05/2024", "01/05/2024", "31/05/2024", false]);
        return t.getColumnsWithStats(privacy, "es-ES");
    }

    for (const tier of ["0", "10", "20", "30"]) {
        it(`tier ${tier}: the four date columns are temporal and carry %d/%m/%Y`, () => {
            const cols = schedule(tier);
            for (const name of ["CNSOL_FP_INICIO", "CNSOL_FP_FIN", "CNSOL_FE_INICIO", "CNSOL_FE_FIN"]) {
                const c = cols.find(x => x.name === name)!;
                expect(c.isTemporal, name).toBe(true);
                expect(c.temporalTextPattern, name).toBe("%d/%m/%Y");
            }
        });
    }

    it("tier 0 still withholds every VALUE - the pattern is a shape signal, not a sample", () => {
        const c = schedule("0").find(x => x.name === "CNSOL_FE_INICIO")!;
        expect(c.temporalTextPattern).toBe("%d/%m/%Y");
        expect(c.topCategoryValues).toBeUndefined();
        expect(c.safeDistinctValues).toBeUndefined();
        expect(c.lowValue).toBeUndefined();
        expect(c.highValue).toBeUndefined();
    });

    it("is absent on the id, the description and the flag", () => {
        const cols = schedule("20");
        for (const name of ["CNSOL_ID", "CNSOL_DESC_SUBPARTIDA_5", "CNSOL_EJECUTADO"]) {
            const c = cols.find(x => x.name === name)!;
            expect(c.isTemporal, name).toBeFalsy();
            expect(c.temporalTextPattern, name).toBeUndefined();
        }
    });

    it("is absent on a real DateTime column - it needs no parsing", () => {
        const t = new IndexedText();
        t.setColumns([col("When", "DateTime"), col("Sum of X", "Decimal", true)]);
        t.addRow([new Date(2024, 2, 15), 1]);
        t.addRow([new Date(2024, 2, 16), 2]);
        const c = t.getColumnsWithStats("20").find(x => x.name === "When")!;
        expect(c.isTemporal).toBe(true);
        expect(c.temporalTextPattern).toBeUndefined();
    });

    it("reads an ISO text column year-first regardless of locale", () => {
        const t = new IndexedText();
        t.setColumns([col("Fecha", "String"), col("Sum of X", "Decimal", true)]);
        t.addRow(["2024-03-15", 1]);
        t.addRow(["2024-03-16", 2]);
        const c = t.getColumnsWithStats("0", "es-ES").find(x => x.name === "Fecha")!;
        expect(c.isTemporal).toBe(true);
        expect(c.temporalTextPattern).toBe("%Y-%m-%d");
    });
});
