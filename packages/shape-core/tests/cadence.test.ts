// measureCadence behaviour: grains, the weekday refinement, and failing closed.
import { describe, it, expect } from "vitest";
import { measureCadence, parseTemporalPoint } from "../src/cadence";

const MS = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daily = (from: number, n: number) => Array.from({ length: n }, (_, i) => iso(from + i * MS));

describe("parseTemporalPoint", () => {
    it("reads the forms IndexedText keys a temporal column by", () => {
        expect(parseTemporalPoint("2026-09-01")!.iso).toBe("2026-09-01");
        expect(parseTemporalPoint("2026-09-01T13:45:00.000Z")!.iso).toBe("2026-09-01");
        expect(parseTemporalPoint("2026-09-01 13:45")!.iso).toBe("2026-09-01");
    });
    it("reads period forms and integer period keys", () => {
        expect(parseTemporalPoint("2024-Q3")!.iso).toBe("2024-07-01");
        expect(parseTemporalPoint("Q3 2024")!.iso).toBe("2024-07-01");
        expect(parseTemporalPoint("2024-03")!.iso).toBe("2024-03-01");
        expect(parseTemporalPoint("202403")!.iso).toBe("2024-03-01");
        expect(parseTemporalPoint("20240315")!.iso).toBe("2024-03-15");
        expect(parseTemporalPoint("2024")!.iso).toBe("2024-01-01");
    });
    it("LONGEST FIRST — an 8-digit key is a date, not a year with a suffix", () => {
        // Ordering bug this guards: YEAR_ONLY matching first would read 202403 as 2024.
        expect(parseTemporalPoint("20240315")!.m).toBe(3);
        expect(parseTemporalPoint("202403")!.m).toBe(3);
    });
    it("refuses what is not a calendar point", () => {
        for (const v of ["", "  ", "Widgets", "12.5", "1750", "3025", "2024-13", "2024-Q5"]) {
            expect(parseTemporalPoint(v), v).toBeNull();
        }
    });
});

describe("measureCadence — grains", () => {
    it("daily", () => {
        const c = measureCadence(daily(Date.UTC(2025, 0, 1), 30))!;
        expect(c.grain).toBe("day");
        expect(c.coveragePct).toBe(100);
        expect(c.runs).toBe(1);
    });
    it("weekly", () => {
        const v = Array.from({ length: 20 }, (_, i) => iso(Date.UTC(2025, 0, 6) + i * 7 * MS));
        const c = measureCadence(v)!;
        expect(c.grain).toBe("week");
        expect(c.coveragePct).toBe(100);
    });
    it("monthly, measured on the CALENDAR and not on 30-day arithmetic", () => {
        const v = Array.from({ length: 24 }, (_, i) => iso(Date.UTC(2023, i, 1)));
        const c = measureCadence(v)!;
        expect(c.grain).toBe("month");
        expect(c.expectedPoints).toBe(24);   // 23 month-steps + 1, never 730/30
        expect(c.coveragePct).toBe(100);
    });
    it("quarterly and yearly", () => {
        const q = measureCadence(Array.from({ length: 12 }, (_, i) => iso(Date.UTC(2020, i * 3, 1))))!;
        expect(q.grain).toBe("quarter");
        expect(q.coveragePct).toBe(100);
        const y = measureCadence(["2015", "2016", "2017", "2018", "2019"])!;
        expect(y.grain).toBe("year");
        expect(y.coveragePct).toBe(100);
    });
    it("a year series WITH a gap reports it in years", () => {
        const c = measureCadence(["2010", "2011", "2012", "2019", "2020", "2021"])!;
        expect(c.grain).toBe("year");
        expect(c.largestGapUnits).toBe(7);
        expect(c.runs).toBe(2);
        expect(c.expectedPoints).toBe(12);
    });
    it("irregular spacing is named, not forced into a grain", () => {
        const c = measureCadence(["2025-01-01", "2025-01-04", "2025-02-11", "2025-06-02", "2025-06-30"])!;
        expect(c.grain).toBe("irregular");
        // An irregular column makes no coverage claim it cannot support.
        expect(c.expectedPoints).toBe(c.points);
        expect(c.coveragePct).toBe(100);
        expect(c.runs).toBe(1);
    });
});

describe("measureCadence — the weekday refinement", () => {
    const weekdays = (n: number) => {
        const out: string[] = []; let i = 0;
        while (out.length < n) {
            const ms = Date.UTC(2025, 0, 6) + i * MS;
            const wd = new Date(ms).getUTCDay();
            if (wd >= 1 && wd <= 5) out.push(iso(ms));
            i++;
        }
        return out;
    };

    it("a Mon-Fri series is COMPLETE, not 71% covered with a hole every weekend", () => {
        // Without this the commonest real shape in the corpus is the loudest false positive.
        const c = measureCadence(weekdays(60))!;
        expect(c.grain).toBe("weekday");
        expect(c.coveragePct).toBe(100);
        expect(c.largestGapUnits).toBe(1);
        expect(c.runs).toBe(1);
    });

    it("and a genuine hole INSIDE a weekday series still shows", () => {
        const v = weekdays(60).filter((_, i) => i < 20 || i >= 28);
        const c = measureCadence(v)!;
        expect(c.grain).toBe("weekday");
        expect(c.runs).toBe(2);
        expect(c.largestGapUnits).toBe(9);
    });

    it("a series that merely HAPPENS to miss a weekend stays daily", () => {
        // Seven consecutive days include a weekend, so the every-point-is-a-weekday test fails
        // and the refinement correctly does not apply.
        const c = measureCadence(daily(Date.UTC(2025, 0, 1), 21))!;
        expect(c.grain).toBe("day");
    });
});

describe("measureCadence — fails closed", () => {
    it("fewer than three points makes no claim", () => {
        expect(measureCadence([])).toBeNull();
        expect(measureCadence(["2025-01-01"])).toBeNull();
        expect(measureCadence(["2025-01-01", "2025-01-02"])).toBeNull();
    });
    it("a zero-width span makes no claim", () => {
        expect(measureCadence(["2025-01-01", "2025-01-01", "2025-01-01"])).toBeNull();
    });
    it("a column where most values are unreadable makes no claim", () => {
        // A cadence measured over a minority of a column describes something else.
        const v = ["2025-01-01", "2025-01-02", "2025-01-03", "n/a", "unknown", "TBD", "-", "??"];
        expect(measureCadence(v)).toBeNull();
    });
    it("unsorted input is sorted before measuring", () => {
        const a = measureCadence(daily(Date.UTC(2025, 0, 1), 20))!;
        const b = measureCadence([...daily(Date.UTC(2025, 0, 1), 20)].reverse())!;
        expect(b).toEqual(a);
    });
    it("duplicate values count once", () => {
        const v = [...daily(Date.UTC(2025, 0, 1), 10), ...daily(Date.UTC(2025, 0, 1), 10)];
        expect(measureCadence(v)!.points).toBe(10);
    });
});

describe("measureCadence — run bounds", () => {
    it("are omitted unless asked for (they name dates; the rest is pure shape)", () => {
        const v = [...daily(Date.UTC(2025, 0, 1), 8), ...daily(Date.UTC(2025, 1, 1), 8)];
        expect(measureCadence(v)!.runBounds).toBeUndefined();
        expect(measureCadence(v, { includeBounds: true })!.runBounds).toHaveLength(2);
    });
    it("are dropped rather than truncated when a series is in many pieces", () => {
        const v: string[] = [];
        for (let k = 0; k < 12; k++) v.push(...daily(Date.UTC(2025, 0, 1) + k * 30 * MS, 3));
        const c = measureCadence(v, { includeBounds: true })!;
        expect(c.runs).toBe(12);
        expect(c.runBounds).toBeUndefined();
    });
});
