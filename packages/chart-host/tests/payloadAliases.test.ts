import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";

// A COLUMN THAT ANSWERS TO A SECOND NAME ANSWERS TO IT IN `data.columns` TOO.
//
// A host arms a compatibility alias for cached chart code that reads a column by a name the live
// data no longer uses - the host's pre-collapse `Sum of Sum of Revenue`, or an English
// `Sum of Volume` that Power BI composed as `Suma de Volume` for a Spanish viewer. Row OBJECTS
// carry the alias as a second key. Generated render() code does not read row objects: it resolves
// `columns.findIndex(c => c.name === '...')` and reads `rows[i][idx]` - so an alias that stops at
// the row objects leaves exactly that code looking up -1.
//
// The alias travels as an extra column APPENDED AFTER EVERY OTHER COLUMN, host metadata included,
// so no existing column - bound, __rowIdx__ or __geo*__ - changes position for code that found
// one by index.

const COLS = [
    { name: "Category", dataType: "String", isMeasure: false },
    { name: "Sum of Revenue", dataType: "Integer", isMeasure: true },
];
const ROWS = [
    { Category: "Hardware", "Sum of Revenue": 1200 },
    { Category: "Software", "Sum of Revenue": 900 },
];
const TREEMAP_LOOKUP = (columns: any[]) => columns.findIndex(c => c.name === "Sum of Sum of Revenue");

describe("buildRenderPayload - aliases", () => {
    it("the aliased name resolves by findIndex and reads the same cell as the live name", () => {
        const p = buildRenderPayload(COLS, ROWS, null, null, null,
            { aliases: [{ name: "Sum of Revenue", alias: "Sum of Sum of Revenue" }] });
        const idx = TREEMAP_LOOKUP(p.columns);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(p.rows.map(r => r[idx])).toEqual([1200, 900]);
        // The alias column copies the column it stands for, so code that reads its role still reads it.
        expect(p.columns[idx]).toMatchObject({ name: "Sum of Sum of Revenue", isMeasure: true, dataType: "Integer", aliasOf: "Sum of Revenue" });
    });

    it("appends after every other column - nothing that was already there moves", () => {
        const plain = buildRenderPayload(COLS, ROWS);
        const aliased = buildRenderPayload(COLS, ROWS, null, null, null,
            { aliases: [{ name: "Sum of Revenue", alias: "Sum of Sum of Revenue" }] });
        expect(aliased.columns.slice(0, plain.columns.length)).toEqual(plain.columns);
        expect(aliased.rows.map(r => r.slice(0, plain.columns.length))).toEqual(plain.rows);
        expect(aliased.columns.length).toBe(plain.columns.length + 1);
        expect(aliased.columns[aliased.columns.length - 1].name).toBe("Sum of Sum of Revenue");
        expect(aliased.columns.findIndex((c: any) => c.name === "__rowIdx__")).toBe(2);
    });

    it("a date column's alias carries the same serialised cell", () => {
        const cols = [{ name: "Earliest Due", dataType: "DateTime", isMeasure: true }];
        const rows = [{ "Earliest Due": new Date(Date.UTC(2026, 2, 14, 12)) }];
        const p = buildRenderPayload(cols, rows, null, null, null, { aliases: [{ name: "Earliest Due", alias: "First Due" }] });
        const a = p.columns.findIndex((c: any) => c.name === "First Due");
        expect(p.rows[0][a]).toBe(p.rows[0][0]);
        expect(typeof p.rows[0][a]).toBe("string");
    });

    it("never shadows a column that exists, never duplicates an alias, never aliases a column it does not have", () => {
        const p = buildRenderPayload(COLS, ROWS, null, null, null, {
            aliases: [
                { name: "Sum of Revenue", alias: "Category" },          // a live column name
                { name: "Sum of Revenue", alias: "__rowIdx__" },        // a host column name
                { name: "Missing", alias: "Sum of Missing" },           // no such column
                { name: "Sum of Revenue", alias: "Sum of Sum of Revenue" },
                { name: "Sum of Revenue", alias: "Sum of Sum of Revenue" },
            ],
        });
        expect(p.columns.map((c: any) => c.name)).toEqual(["Category", "Sum of Revenue", "__rowIdx__", "Sum of Sum of Revenue"]);
        expect(p.rows[0]).toEqual(["Hardware", 1200, 0, 1200]);
    });

    it("no aliases is the payload it always was", () => {
        expect(buildRenderPayload(COLS, ROWS, null, null, null, { aliases: [] })).toEqual(buildRenderPayload(COLS, ROWS));
        expect(buildRenderPayload(COLS, ROWS, null, null, null, { aliases: null })).toEqual(buildRenderPayload(COLS, ROWS));
    });
});
