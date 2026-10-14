import { describe, it, expect } from "vitest";
import { IndexedText, promotesToMeasure } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// A host that renders code written against the shape, but has not profiled its columns since the data was
// last indexed, needs the flags the stats pass would have ended with - without running that pass and without
// changing a column. inferredMeasureFlags() is that verdict.

type Spec = { name: string; dataType: string; isMeasure?: boolean };

function build(specs: Spec[], rows: any[][]): IndexedText {
    const t = new IndexedText();
    t.setColumns(specs.map(s => ({ name: s.name, dataType: s.dataType, isMeasure: !!s.isMeasure } as LLMColumnWithValue)));
    for (const r of rows) t.addRow(r);
    return t;
}

// Three unbound decimal coordinates, the shape of a table dropped whole into one well.
const coordSpecs: Spec[] = [
    { name: "Easting", dataType: "Decimal" },
    { name: "Northing", dataType: "Decimal" },
    { name: "Elevation", dataType: "Decimal" },
];
function coordRows(n: number): any[][] {
    const rows: any[][] = [];
    for (let i = 0; i < n; i++) {
        rows.push([
            0.534 + i * 0.7983 + (i % 7) * 0.0137,
            -13.648 + ((i * 37) % 173) * 0.1578,
            1.6898 + ((i * i) % 173) / 173 * (i % 9 === 0 ? 23.8 : 3.1),
        ]);
    }
    return rows;
}

const mixedSpecs: Spec[] = [
    { name: "Region", dataType: "String" },
    { name: "Year", dataType: "Integer" },
    { name: "Month", dataType: "Integer" },
    { name: "StoreID", dataType: "Integer" },
    { name: "Rating", dataType: "Integer" },
    { name: "Sales", dataType: "Decimal" },
    { name: "Units", dataType: "Integer" },
    { name: "OrderDateKey", dataType: "Integer" },
    { name: "Latitude", dataType: "Decimal" },
    { name: "Zip", dataType: "Integer" },
];
function mixedRows(n: number): any[][] {
    const regions = ["North", "South", "East", "West", "Central"];
    const rows: any[][] = [];
    for (let i = 0; i < n; i++) {
        rows.push([
            regions[i % regions.length],
            2015 + (i % 10),
            1 + (i % 12),
            10000 + i,
            1 + (i % 5),
            Math.round((12.5 + ((i * 7919) % 100003) / 37.3) * 100) / 100,
            (i * 131) % 900,
            20240101 + (i % 28),
            Math.round((30 + ((i * 61) % 1499) / 100) * 10000) / 10000,
            10000 + ((i * 7) % 80000),
        ]);
    }
    return rows;
}

const statsFlags = (t: IndexedText): boolean[] => {
    t.getColumnsWithStats("20", "en-US");
    return t.getColumns().map(c => !!c.isMeasure);
};

describe("inferredMeasureFlags", () => {
    for (const n of [173, 10000]) {
        it(`the verdict alone equals the stats pass flags (${n} rows, coordinates)`, () => {
            const a = build(coordSpecs, coordRows(n));
            const b = build(coordSpecs, coordRows(n));
            expect(a.inferredMeasureFlags()).toEqual(statsFlags(b));
            expect(a.inferredMeasureFlags()).toEqual([true, true, true]);
        });
        it(`the verdict alone equals the stats pass flags (${n} rows, mixed table)`, () => {
            const a = build(mixedSpecs, mixedRows(n));
            const b = build(mixedSpecs, mixedRows(n));
            const viaStats = statsFlags(b);
            expect(a.inferredMeasureFlags()).toEqual(viaStats);
            // Sales, Units and Latitude are quantities; the axes, codes and scales are not.
            expect(viaStats.map((f, i) => (f ? mixedSpecs[i].name : null)).filter(Boolean)).toEqual(["Sales", "Units", "Latitude"]);
        });
    }

    it("it changes no column", () => {
        const a = build(coordSpecs, coordRows(173));
        const before = JSON.stringify(a.getColumns());
        const flags = a.inferredMeasureFlags();
        expect(flags).toEqual([true, true, true]);
        expect(a.getColumns().every(c => c.isMeasure === false)).toBe(true);
        expect(a.getColumns().every(c => c.valueNature === undefined)).toBe(true);
        expect(JSON.stringify(a.getColumns())).toBe(before);
    });

    it("a column that is already a measure stays one, and a non-numeric column stays false", () => {
        const a = build(
            [{ name: "Region", dataType: "String" }, { name: "Revenue", dataType: "Decimal", isMeasure: true }],
            coordRows(40).map((r, i) => ["R" + (i % 4), r[0]]),
        );
        expect(a.inferredMeasureFlags()).toEqual([false, true]);
    });

    it("a declared dimension is never inferred", () => {
        const a = build(mixedSpecs, mixedRows(173));
        a.declareDimensions([a.getColumns()[8]]);
        const flags = a.inferredMeasureFlags();
        expect(flags[8]).toBe(false);
        expect(flags[5]).toBe(true);
    });

    it("the same array is returned until rows or columns change", () => {
        const a = build(coordSpecs, coordRows(173));
        expect(a.inferredMeasureFlags()).toBe(a.inferredMeasureFlags());
    });

    it("a caller cannot corrupt the cached flags", () => {
        const a = build(coordSpecs, coordRows(173));
        const flags = a.inferredMeasureFlags() as boolean[];
        expect(() => flags.push(true)).toThrow();
        expect(() => { flags[0] = false; }).toThrow();
        expect(() => { flags.length = 0; }).toThrow();
        expect(a.inferredMeasureFlags()).toEqual([true, true, true]);
        expect(a.inferredMeasureFlags()).toBe(flags);
    });

    it("the cache follows the rows", () => {
        const spec: Spec[] = [{ name: "Amount", dataType: "Decimal" }];
        const a = build(spec, [[1.5], [2.5], [3.5]]);
        expect(a.inferredMeasureFlags()).toEqual([false]);
        for (let i = 0; i < 60; i++) a.addRow([100.25 + i * 3.17]);
        expect(a.inferredMeasureFlags()).toEqual([true]);
    });

    it("setColumns and reset clear the cache", () => {
        const a = build(coordSpecs, coordRows(173));
        expect(a.inferredMeasureFlags()).toEqual([true, true, true]);
        a.reset();
        expect(a.inferredMeasureFlags()).toEqual([]);
        a.setColumns(coordSpecs.map(s => ({ name: s.name, dataType: s.dataType, isMeasure: false } as LLMColumnWithValue)));
        for (const r of coordRows(173)) a.addRow(r);
        expect(a.inferredMeasureFlags()).toEqual([true, true, true]);
        const first = a.inferredMeasureFlags();
        a.setColumns([{ name: "Only", dataType: "String", isMeasure: false } as LLMColumnWithValue]);
        expect(a.inferredMeasureFlags()).not.toBe(first);
    });

    it("declareDimensions clears the cache", () => {
        const a = build(coordSpecs, coordRows(173));
        expect(a.inferredMeasureFlags()).toEqual([true, true, true]);
        a.declareDimensions([a.getColumns()[1]]);
        expect(a.inferredMeasureFlags()).toEqual([true, false, true]);
    });
});

describe("promotesToMeasure", () => {
    const col = (dataType: string, isMeasure = false): LLMColumnWithValue => ({ name: "Amount", dataType, isMeasure } as LLMColumnWithValue);
    const wide = { distinct: 500, nonblank: 600, prec: 2, minval: 0.5, maxval: 9000.5 };
    it("promotes a continuous numeric column", () => {
        expect(promotesToMeasure(col("Decimal"), false, wide)).toBe(true);
    });
    it("never promotes a measure, a declared dimension or a non-numeric column", () => {
        expect(promotesToMeasure(col("Decimal", true), false, wide)).toBe(false);
        expect(promotesToMeasure(col("Decimal"), true, wide)).toBe(false);
        expect(promotesToMeasure(col("String"), false, wide)).toBe(false);
    });
});

describe("the stats pass shape is unchanged by sharing the verdict", () => {
    it("getColumnsWithStats output on the mixed table matches the snapshot taken before the change", () => {
        const t = build(mixedSpecs, mixedRows(173));
        expect(JSON.stringify(t.getColumnsWithStats("20", "en-US"), null, 1)).toMatchSnapshot();
    });
    it("the coordinate table too, including the geo clears", () => {
        const t = build(coordSpecs, coordRows(173));
        expect(JSON.stringify(t.getColumnsWithStats("20", "en-US"), null, 1)).toMatchSnapshot();
    });
});
