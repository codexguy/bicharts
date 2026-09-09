import { describe, it, expect, afterEach } from "vitest";
import { ingest } from "../packages/shape-core/src/ingest";

// DATES ARE STABLE ON THE WIRE. The same dataset must profile to the same bytes on every
// machine, and a whole-day date must print as the day the author meant.
//
// It did not. The profiler asked a Date for its LOCAL hours to decide whether it carried a
// time of day, and used Date.toString() - locale and timezone text - as the distinct-value key.
// A date built in UTC (which is how the Excel add-in converts a serial, how an ISO text date
// parses, and how the visual's date-unshredder works) therefore read as "17:00 the previous
// day" anywhere west of Greenwich: dateWithTime came out true for every date column, which
// flipped valueNature from Ordinal to Continuous (a chart-selection input), and the top
// values printed as "Thu Mar 14 2024 17:00:00 GMT-0700 (...)" for a cell that showed the 15th.

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});

/** Four whole-day dates as the Excel add-in builds them: UTC midnight. */
const utcDays = () => [
    new Date(Date.UTC(2024, 2, 15)), new Date(Date.UTC(2024, 5, 1)),
    new Date(Date.UTC(2023, 10, 2)), new Date(Date.UTC(2025, 0, 20)),
];
/** The same four as a Power BI host hands them over: LOCAL midnight. */
const localDays = () => [
    new Date(2024, 2, 15), new Date(2024, 5, 1), new Date(2023, 10, 2), new Date(2025, 0, 20),
];
const EXPECTED_DAYS = ["2023-11-02", "2024-03-15", "2024-06-01", "2025-01-20"];

function profile(dates: Date[]) {
    const rows = dates.map((d, i) => [d, "Eng", 100 + i]);
    const m = ingest({ kind: "grid", header: ["When", "Dept", "Amount"], rows }, { dedup: false });
    return m.columns[0] as any;
}

/** The parts of the column that go on the wire and depend on how a Date was read. */
function wire(col: any) {
    return JSON.stringify({
        dataType: col.dataType, dateWithTime: col.dateWithTime, valueNature: col.valueNature,
        lowValue: col.lowValue, highValue: col.highValue, avgLength: col.avgLength,
        distinctCount: col.distinctCount, top: [...(col.topCategoryValues ?? [])].sort(),
    });
}

describe("a whole-day date is a whole day, wherever the machine is", () => {
    it("UTC-midnight dates (the Excel add-in's form) carry no time and read as Ordinal", () => {
        process.env.TZ = "America/Los_Angeles";
        const col = profile(utcDays());
        expect(col.dataType).toBe("DateTime");
        expect(col.dateWithTime).toBe(false);
        expect(col.valueNature).toBe("Ordinal");
        // The DAY THE CELL SHOWED, not the day before it.
        expect([...col.topCategoryValues].sort()).toEqual(EXPECTED_DAYS);
        expect(col.lowValue).toBe("2023-11-02T00:00:00.000Z");
        expect(col.highValue).toBe("2025-01-20T00:00:00.000Z");
    });

    it("LOCAL-midnight dates (a Power BI host's form) are whole days too - fixing UTC alone would have broken the visual", () => {
        process.env.TZ = "America/Los_Angeles";
        const col = profile(localDays());
        expect(col.dateWithTime).toBe(false);
        expect(col.valueNature).toBe("Ordinal");
        expect([...col.topCategoryValues].sort()).toEqual(EXPECTED_DAYS);
        expect(col.lowValue).toBe("2023-11-02T00:00:00.000Z");
    });

    it("a genuine time of day is still detected, in both frames", () => {
        process.env.TZ = "America/Los_Angeles";
        const stamps = [new Date(Date.UTC(2024, 2, 15, 14, 30)), new Date(Date.UTC(2024, 2, 16, 9, 5)),
                        new Date(2024, 2, 17, 8, 45), new Date(2024, 2, 18, 23, 59)];
        const col = profile(stamps);
        expect(col.dateWithTime).toBe(true);
        expect(col.valueNature).toBe("Continuous");
    });

    it("ONE timed value flips the whole column - the flag is an OR, not a vote", () => {
        process.env.TZ = "America/Los_Angeles";
        const col = profile([...utcDays(), new Date(Date.UTC(2024, 2, 20, 10, 0))]);
        expect(col.dateWithTime).toBe(true);
    });

    it("no locale or timezone text survives in any value", () => {
        process.env.TZ = "America/Los_Angeles";
        const col = profile(utcDays());
        const all = JSON.stringify(col);
        expect(all).not.toMatch(/GMT|Pacific|Daylight|Standard Time|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
    });
});

describe("the SAME dataset produces the SAME bytes on every machine", () => {
    it("UTC-built dates: identical under UTC, Los Angeles and Tokyo", () => {
        const outputs: Record<string, string> = {};
        const offsets: Record<string, number> = {};
        for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
            process.env.TZ = tz;
            offsets[tz] = new Date(Date.UTC(2024, 6, 1)).getTimezoneOffset();
            outputs[tz] = wire(profile(utcDays()));
        }
        // HONESTY CHECK on the test itself: if runtime TZ switching ever stops working, this
        // must FAIL rather than pass three identical runs of one timezone.
        expect(new Set(Object.values(offsets)).size).toBe(3);

        expect(outputs["America/Los_Angeles"]).toBe(outputs["UTC"]);
        expect(outputs["Asia/Tokyo"]).toBe(outputs["UTC"]);
        // ...and it is the RIGHT answer, not merely a consistent one.
        expect(JSON.parse(outputs["UTC"]).top).toEqual(EXPECTED_DAYS);
        expect(JSON.parse(outputs["UTC"]).avgLength).toBe(10);   // "YYYY-MM-DD", every time
    });
});
