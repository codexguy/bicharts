import { describe, it, expect } from "vitest";
import { localMidnightDateColumns, localMidnightToUtcDay, normalizeLocalMidnightDates } from "../src/index";

// A plain date field can reach a host as a Date at the READER'S local midnight. East of Greenwich that
// serialises to the previous UTC day, so a chart reading in UTC prints the day before the cell. These
// tests run in whatever zone the machine is in (a release runner is on UTC), so every expectation is
// written as "the calendar day the cell named, at UTC midnight" - true in every zone - and the one
// zone-dependent fact (whether anything needed moving) is asserted against the machine's own offset.

const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00.000Z`;
const offZero = new Date(2026, 6, 13).getTimezoneOffset() === 0;

describe("localMidnightToUtcDay", () => {
    it("names the same calendar day at UTC midnight", () => {
        expect(localMidnightToUtcDay(new Date(2026, 6, 13)).toISOString()).toBe(iso(2026, 6, 13));
        expect(localMidnightToUtcDay(new Date(2026, 0, 1)).toISOString()).toBe(iso(2026, 0, 1));
    });
});

describe("localMidnightDateColumns", () => {
    const cols = [{ name: "Period", dataType: "String" }, { name: "Date", dataType: "DateTime" }, { name: "n", dataType: "Integer" }];

    it("lists a date column whose every value is local midnight - unless the machine is on UTC, where nothing is wrong", () => {
        const rows = [{ Period: "P1", Date: new Date(2026, 6, 13), n: 57 }, { Period: "P1", Date: new Date(2026, 6, 14), n: 63 }];
        expect(localMidnightDateColumns(cols, rows)).toEqual(offZero ? [] : ["Date"]);
    });

    it("leaves a column already at UTC midnight, a real time of day, text, and non-date columns", () => {
        expect(localMidnightDateColumns(cols, [{ Date: new Date(Date.UTC(2026, 6, 13)) }])).toEqual([]);
        expect(localMidnightDateColumns(cols, [{ Date: new Date(2026, 6, 13) }, { Date: new Date(2026, 6, 13, 9, 12) }])).toEqual([]);
        expect(localMidnightDateColumns(cols, [{ Date: "2026-07-13" }])).toEqual([]);
        expect(localMidnightDateColumns([{ name: "When", dataType: "String" }], [{ When: new Date(2026, 6, 13) }])).toEqual([]);
    });

    it("ignores empty cells", () => {
        const rows = [{ Date: null }, { Date: undefined }, { Date: "" }, { Date: new Date(2026, 6, 13) }];
        expect(localMidnightDateColumns(cols, rows as any)).toEqual(offZero ? [] : ["Date"]);
    });
});

describe("normalizeLocalMidnightDates", () => {
    const cols = [{ name: "Date", dataType: "DateTime" }, { name: "n", dataType: "Integer" }];

    it("rewrites each local-midnight cell to the UTC midnight of its day without mutating the input", () => {
        const input = [{ Date: new Date(2026, 6, 13), n: 1 }, { Date: new Date(2026, 7, 1), n: 2 }];
        const before = input[0].Date.getTime();
        const out = normalizeLocalMidnightDates(cols, input);
        expect(out.rows.map(r => (r.Date as Date).toISOString())).toEqual([iso(2026, 6, 13), iso(2026, 7, 1)]);
        expect(input[0].Date.getTime()).toBe(before);
        expect(out.columns).toEqual(offZero ? [] : ["Date"]);
    });

    it("returns the SAME array when nothing needs moving", () => {
        const input = [{ Date: new Date(Date.UTC(2026, 6, 13)), n: 1 }];
        expect(normalizeLocalMidnightDates(cols, input).rows).toBe(input);
    });
});
