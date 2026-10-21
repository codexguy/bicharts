import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { anchorLocalWallClockDates, localWallClockDateColumns, utcWallClock, datesAreTimeOfDayOnly } from "../src/index";
import { IndexedText } from "../src/indexedText";

// A TIME OF DAY ON THE READER'S CLOCK. A Power BI date-time field reaches the host as Dates at the reader's LOCAL wall
// clock; serialized as instants they print shifted by the reader's offset under the render contract's UTC reads (for a
// time-only value on its 1899-12-30 base, by the zone's local mean time offset: -03:06:28 in Sao Paulo). The reader's
// zone is the fixture here, so it is set explicitly - on a UTC machine nothing shows.

const saved = process.env.TZ;
afterAll(() => { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; });

const cols = [{ name: "Id", dataType: "String" }, { name: "Horas", dataType: "DateTime" }];
const t = (h: number, m: number) => new Date(1899, 11, 30, h, m, 0);

function profiled(values: Date[], wallClock: boolean) {
    const idx = new IndexedText();
    idx.dateCellsAreLocalWallClock = wallClock;
    idx.setColumns([{ name: "Id", dataType: "String", isMeasure: false }, { name: "Horas", dataType: "DateTime", isMeasure: false }] as any);
    values.forEach((v, k) => idx.addRow([`r${k}`, v], k));
    return idx;
}

for (const zone of ["America/Sao_Paulo", "Asia/Kolkata"]) {
    describe(`a time of day on the reader's clock, read in ${zone}`, () => {
        beforeAll(() => { process.env.TZ = zone; });

        it("the zone took (the 1899 base is not on a whole-hour offset)", () => {
            expect(t(8, 30).getUTCMinutes()).not.toBe(30);
        });
        it("utcWallClock keeps the wall-clock fields", () => {
            expect(utcWallClock(t(8, 30)).toISOString()).toBe("1899-12-30T08:30:00.000Z");
        });
        it("a timed column qualifies; a whole-day column, text and non-dates do not", () => {
            expect(localWallClockDateColumns(cols, [{ Horas: t(0, 0) }, { Horas: t(8, 30) }])).toEqual(["Horas"]);
            expect(localWallClockDateColumns(cols, [{ Horas: new Date(2026, 6, 13) }])).toEqual([]);
            expect(localWallClockDateColumns(cols, [{ Horas: "08:30" }])).toEqual([]);
        });
        it("anchors EVERY cell of a timed column, the midnight slot included, without mutating the input", () => {
            const input = [{ Id: "a", Horas: t(0, 0) }, { Id: "b", Horas: t(23, 30) }];
            const before = input[0].Horas.getTime();
            const out = anchorLocalWallClockDates(cols, input);
            expect(out.rows.map(r => (r.Horas as Date).toISOString())).toEqual(["1899-12-30T00:00:00.000Z", "1899-12-30T23:30:00.000Z"]);
            expect(input[0].Horas.getTime()).toBe(before);
            const none = [{ Id: "a", Horas: new Date(2026, 6, 13) }];
            expect(anchorLocalWallClockDates(cols, none).rows).toBe(none);
        });
        it("IndexedText profiles the wall clock when the host says its Dates are local", () => {
            const c = profiled([t(0, 0), t(8, 30), t(21, 2)], true).getColumnsWithStats("20").find(x => x.name === "Horas")!;
            expect((c.lowValue as Date).toISOString()).toBe("1899-12-30T00:00:00.000Z");
            expect((c.highValue as Date).toISOString()).toBe("1899-12-30T21:02:00.000Z");
            expect(c.dateWithTime).toBe(true);
        });
        it("with the switch off the profile is exactly as before (the instant)", () => {
            const c = profiled([t(0, 0), t(8, 30)], false).getColumnsWithStats("20").find(x => x.name === "Horas")!;
            expect((c.lowValue as Date).getTime()).toBe(t(0, 0).getTime());
        });
        it("the CSV carries the wall clock when the switch is on", async () => {
            const idx = profiled([t(0, 0), t(8, 30)], true);
            idx.getColumnsWithStats("20");                       // the host profiles first; the CSV follows the profile
            const csv = await idx.getCSVAsync(false);
            expect(csv).toContain("1899-12-30T08:30:00.000Z");
            expect(csv).toContain("1899-12-30T00:00:00.000Z");
        });

        // THE TIME-OF-DAY-ONLY SIGNAL: one rule for every host. Power BI hands the reader's local Dates (re-anchored above
        // when the switch is on); Excel builds the same clock reading at the UTC wall clock with the switch off.
        it("a Power BI time column is time-of-day-only once its Dates are read at the wall clock", () => {
            const c = profiled([t(0, 0), t(8, 30), t(23, 59)], true).getColumnsWithStats("20").find(x => x.name === "Horas")!;
            expect(c.timeOfDayOnly).toBe(true);
        });
        it("an Excel time column (UTC wall clock, switch off) is time-of-day-only", () => {
            const x = (h: number, m: number) => new Date(Date.UTC(1899, 11, 30, h, m));
            const c = profiled([x(0, 0), x(8, 30), x(23, 59)], false).getColumnsWithStats("20").find(c => c.name === "Horas")!;
            expect(c.timeOfDayOnly).toBe(true);
        });
        it("a dated timestamp, or a time column that spills onto another day, is not", () => {
            const dated = profiled([new Date(2026, 6, 13, 8, 30), new Date(2026, 6, 13, 9, 0)], true).getColumnsWithStats("20").find(c => c.name === "Horas")!;
            expect(dated.timeOfDayOnly).toBeUndefined();
            const spill = profiled([t(8, 30), new Date(1899, 11, 31, 1, 0)], true).getColumnsWithStats("20").find(c => c.name === "Horas")!;
            expect(spill.timeOfDayOnly).toBeUndefined();
            const midnights = profiled([t(0, 0), t(0, 0)], true).getColumnsWithStats("20").find(c => c.name === "Horas")!;
            expect(midnights.timeOfDayOnly).toBeUndefined();
        });
        it("the rule, directly: one frame for the whole column", () => {
            expect(datesAreTimeOfDayOnly([utcWallClock(t(0, 0)), utcWallClock(t(8, 30)), null, ""])).toBe(true);
            // Two days the reader's zone folds into one local day are still two days.
            expect(datesAreTimeOfDayOnly([new Date(Date.UTC(1899, 11, 30, 22)), new Date(Date.UTC(1899, 11, 31, 1))])).toBe(false);
            expect(datesAreTimeOfDayOnly([new Date(Date.UTC(1899, 11, 30, 1)), new Date(Date.UTC(1899, 11, 30, 23))])).toBe(true);
            expect(datesAreTimeOfDayOnly([t(8, 30), "08:30"])).toBe(false);
            expect(datesAreTimeOfDayOnly([])).toBe(false);
        });
    });
}
