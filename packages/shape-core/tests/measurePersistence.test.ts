import { describe, it, expect } from "vitest";
import { IndexedText, measurePersistence } from "../src";
import type { LLMColumnWithValue } from "../src/models";

// MEASURE PERSISTENCE.
//
// What this exists for: a closing price and a day's sales are both "a number per day", and a column's
// summary statistics cannot tell them apart. The price carries each day's value over from the last; the
// sales are independent from one day to the next. Two scale-free ratios of the series in date order tell
// them apart, and a consumer that buckets the series decides what to do with the answer. Every series
// below is built from a fixed sequence, never Math.random, so a run is the same on every machine.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

/** A fixed pseudo-random sequence in [0, 1): the same for a given i on every machine. */
const noise = (i: number): number => {
    const x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
};

const DAY = 86400000;
const START = Date.UTC(2024, 0, 1);              // a Monday
const day = (n: number) => new Date(START + n * DAY);
/** The first `n` weekdays from START: trading days, which skip weekends. */
function tradingDays(n: number): Date[] {
    const out: Date[] = [];
    for (let k = 0; out.length < n; k++) {
        const d = day(k);
        const wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6) out.push(d);
    }
    return out;
}

/** A random walk of +-0.5% steps from 100, the way a closing price moves. */
function priceWalk(n: number, seed = 0): number[] {
    const out: number[] = [];
    let p = 100;
    for (let i = 0; i < n; i++) {
        out.push(Math.round(p * 100) / 100);
        p *= 1 + (noise(i + seed) < 0.5 ? -0.005 : 0.005);
    }
    return out;
}

const WEEKDAY = [1.0, 1.1, 1.05, 1.0, 1.2, 0.7, 0.6];   // a weekday pattern, Monday first

function oneMeasure(level: string, times: Date[], values: (number | null)[], opts: { withKey?: string[] } = {}) {
    const t = new IndexedText();
    const cols = [col("Day", "DateTime")];
    if (opts.withKey) cols.push(col("Store", "String"));
    cols.push(col("Value", "Decimal", true));
    t.setColumns(cols);
    times.forEach((d, i) => t.addRow(opts.withKey ? [d, opts.withKey[i], values[i]] : [d, values[i]]));
    return t.getColumnsWithStats(level, "en-US");
}
const value = (cols: LLMColumnWithValue[]) => cols.find(c => c.name === "Value")!;

describe("measure persistence - the shapes it separates", () => {
    it("a daily closing price over 200 trading days carries each value over: small steps, residuals far from independent", () => {
        const cols = oneMeasure("20", tradingDays(200), priceWalk(200));
        const p = value(cols).persistence!;
        expect(p).toBeTruthy();
        expect(p.timeColumn).toBe("Day");
        expect(p.seriesColumn).toBeUndefined();
        expect(p.series).toBe(1);
        expect(p.points).toBe(200);
        expect(p.relStep).toBeLessThan(0.02);
        expect(p.vnDetrended).toBeLessThan(0.2);
    });

    it("daily sales (a weekday pattern plus independent noise around 1,000) are independent: large steps, residuals near 2", () => {
        const n = 200;
        const values = Array.from({ length: n }, (_, i) => Math.round(1000 * WEEKDAY[i % 7] * (0.85 + 0.3 * noise(i + 1000))));
        const p = value(oneMeasure("20", Array.from({ length: n }, (_, i) => day(i)), values)).persistence!;
        expect(p).toBeTruthy();
        expect(p.vnDetrended).toBeGreaterThan(1);
        expect(p.relStep).toBeGreaterThan(0.05);
    });

    it("a smoothly growing monthly revenue (24 points, +3% a month, 1% noise) IS read as persistent - the known false-positive shape, which a floor on points keeps out", () => {
        const months = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2023, i, 1)));
        const values = months.map((_, i) => Math.round(10000 * Math.pow(1.03, i) * (0.995 + 0.01 * noise(i + 77))));
        const p = value(oneMeasure("20", months, values)).persistence!;
        expect(p).toBeTruthy();
        expect(p.points).toBe(24);
        // Pinned, so a change to the arithmetic is seen. Steps are ~3% of the value; the residuals of a straight
        // line through an exponential are smooth, so the ratio is low.
        expect(p.relStep).toBeGreaterThan(0.02);
        expect(p.relStep).toBeLessThan(0.05);
        expect(p.vnDetrended).toBeLessThan(0.6);
    });

    it("a panel of 5 stores x 200 days is cut by the store column and measured per series", () => {
        const stores = ["Austin", "Boston", "Chicago", "Denver", "El Paso"];
        const times: Date[] = [], keys: string[] = [], values: number[] = [];
        stores.forEach((s, si) => {
            const walk = priceWalk(200, si * 500);
            for (let i = 0; i < 200; i++) { times.push(day(i)); keys.push(s); values.push(walk[i]); }
        });
        const p = value(oneMeasure("20", times, values, { withKey: keys })).persistence!;
        expect(p).toBeTruthy();
        expect(p.seriesColumn).toBe("Store");
        expect(p.series).toBe(5);
        expect(p.points).toBe(200);
        expect(p.relStep).toBeLessThan(0.02);
    });

    it("rows that share a (series, point) are summed before the steps are read", () => {
        // Two half-rows per day of a smooth walk: summed they are the walk, unsummed they would zigzag.
        const walk = priceWalk(60);
        const times: Date[] = [], values: number[] = [];
        walk.forEach((v, i) => { times.push(day(i), day(i)); values.push(v * 0.25, v * 0.75); });
        const p = value(oneMeasure("20", times, values)).persistence!;
        expect(p.points).toBe(60);
        expect(p.relStep).toBeLessThan(0.02);
    });
});

describe("measure persistence - when it is silent", () => {
    it("no temporal column", () => {
        const t = new IndexedText();
        t.setColumns([col("Label", "String"), col("Value", "Decimal", true)]);
        priceWalk(50).forEach((v, i) => t.addRow(["row " + (i % 7), v]));
        expect(value(t.getColumnsWithStats("20", "en-US")).persistence).toBeUndefined();
    });

    it("fewer than six dates", () => {
        const cols = oneMeasure("20", [day(0), day(1), day(2), day(3), day(4)], [5, 7, 6, 9, 8]);
        expect(value(cols).persistence).toBeUndefined();
    });

    it("a column that is not a measure (a text column, even one that holds numbers)", () => {
        const t = new IndexedText();
        t.setColumns([col("Day", "DateTime"), col("Value", "String")]);
        const days = tradingDays(100), walk = priceWalk(100);
        days.forEach((d, i) => t.addRow([d, "ref " + walk[i]]));
        expect(value(t.getColumnsWithStats("20", "en-US")).persistence).toBeUndefined();
    });

    it("a constant measure", () => {
        const cols = oneMeasure("20", tradingDays(100), Array.from({ length: 100 }, () => 42));
        expect(value(cols).persistence).toBeUndefined();
    });

    it("the function itself returns null for a series with no variation or no parseable times", () => {
        expect(measurePersistence({ times: ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06"], values: [1, 1, 1, 1, 1, 1] })).toBeNull();
        expect(measurePersistence({ times: ["a", "b", "c", "d", "e", "f", "g"], values: [1, 2, 3, 4, 5, 6, 7] })).toBeNull();
        expect(measurePersistence({ times: [], values: [] })).toBeNull();
    });

    it("a straight line is no evidence of anything carried over (its residuals are rounding noise)", () => {
        const times = Array.from({ length: 30 }, (_, i) => day(i).toISOString().slice(0, 10));
        const out = measurePersistence({ times, values: times.map((_, i) => 100 + 3 * i) })!;
        expect(out.vnDetrended).toBe(2);
    });
});

describe("measure persistence - tiers", () => {
    it("is present at privacy 0 and 10 as well as 20: counts and ratios only", () => {
        const times = tradingDays(120), values = priceWalk(120);
        const at20 = value(oneMeasure("20", times, values)).persistence!;
        for (const level of ["0", "10"]) {
            const p = value(oneMeasure(level, times, values)).persistence;
            expect(p, `level ${level}`).toBeTruthy();
            expect(p).toEqual(at20);
        }
    });

    it("re-measuring does not keep a stale object", () => {
        const t = new IndexedText();
        t.setColumns([col("Day", "DateTime"), col("Value", "Decimal", true), col("Flat", "Decimal", true)]);
        const days = tradingDays(80), walk = priceWalk(80);
        days.forEach((d, i) => t.addRow([d, walk[i], 7]));
        const first = t.getColumnsWithStats("20", "en-US");
        expect(value(first).persistence).toBeTruthy();
        const flat = first.find(c => c.name === "Flat")!;
        expect(flat.persistence).toBeUndefined();
        // A descriptor left on a column by an earlier call must not survive the next one.
        flat.persistence = { timeColumn: "Day", series: 1, points: 80, vnDetrended: 0.01, relStep: 0.001 };
        const second = t.getColumnsWithStats("0", "en-US");
        expect(second.find(c => c.name === "Flat")!.persistence).toBeUndefined();
        expect(value(second).persistence).toEqual(value(first).persistence);
    });
});
