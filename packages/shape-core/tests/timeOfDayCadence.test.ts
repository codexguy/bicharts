import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";

// A CLOCK TIME WITH NO DATE HAS NO CALENDAR CADENCE. A column of times on Excel's 1899-12-30 base is a time of day,
// not a timeline: the gaps between two readings are not missing periods. Measured as a timeline it reported grain
// "hour" while counting every distinct second as a point (21,149 points, gapFactor 5 on 53,785 rows), the kind of
// input that reads as "the gaps are real". The profile now carries timeOfDayOnly and no temporalCadence for it.

function profiled(values: Date[]) {
    const idx = new IndexedText();
    idx.setColumns([{ name: "Id", dataType: "String", isMeasure: false }, { name: "Horas", dataType: "DateTime", isMeasure: false }] as any);
    values.forEach((v, k) => idx.addRow([`r${k}`, v], k));
    return idx.getColumnsWithStats("20").find(c => c.name === "Horas")!;
}

describe("temporalCadence on a time-of-day-only column", () => {
    it("a column of clock times (UTC wall clock on 1899-12-30) gets no cadence", () => {
        const times: Date[] = [];
        for (let s = 0; s < 6 * 3600; s += 7) times.push(new Date(Date.UTC(1899, 11, 30, 0, 0, s)));
        const c = profiled(times);
        expect(c.timeOfDayOnly).toBe(true);
        expect(c.temporalCadence).toBeUndefined();
    });

    it("a dated hourly series keeps its cadence", () => {
        const stamps: Date[] = [];
        for (let h = 0; h < 48; h++) stamps.push(new Date(Date.UTC(2026, 6, 13, h)));
        const c = profiled(stamps);
        expect(c.timeOfDayOnly).toBeUndefined();
        expect(c.temporalCadence).toBeDefined();
    });
});
