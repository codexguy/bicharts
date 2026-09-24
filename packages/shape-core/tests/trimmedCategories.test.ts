import { describe, it, expect } from "vitest";
import { IndexedText, trimmedCells } from "../src/indexedText";
import { ingest } from "../src/ingest";

// A TRAILING SPACE SPLIT ONE CATEGORY IN TWO (the trailing-space category split, 2026-09-24). A generated chart pooled `'Student Rush '` - with a
// trailing space - into an 'Other' bucket of exactly one member, because `'Student Rush '` and `'Student Rush'` are two
// grouping keys. Excel, MCP and React already trimmed at ingest; the Power BI visual did not. The trim now sits in
// IndexedText.addRow, the seam every host's rows pass, so the shape the server gates on and the rows the chart reads
// agree. This file is the split-then-merge fixture.

const COLUMNS = [
    { name: "Ticket Type", dataType: "String", isMeasure: false },
    { name: "Tickets Sold", dataType: "Integer", isMeasure: true },
];

// The theatre dataset's own split, reduced: one category spelled two ways.
const ROWS: any[][] = [
    ["Adult", 120],
    ["Student Rush ", 14],
    ["Student Rush", 31],
    ["Senior", 44],
    ["  Matinee", 9],
];

function build(rows: any[][], dedup = true) {
    const idx = new IndexedText();
    idx.dedupRows = dedup;
    idx.setColumns(COLUMNS.map(c => ({ ...c })));
    rows.forEach((r, i) => idx.addRow(r, i));
    return idx;
}

describe("a category spelled with surrounding whitespace is one category", () => {
    it("the shape counts it once and the rows the chart reads carry the trimmed key", () => {
        const idx = build(ROWS);
        const col = idx.getColumnsWithStats("20").find(c => c.name === "Ticket Type")!;
        expect(col.distinctCount).toBe(4);   // Adult, Student Rush, Senior, Matinee - not 5
        const keys = idx.toObjectArray().map((r: any) => r["Ticket Type"]);
        expect(keys).toEqual(["Adult", "Student Rush", "Student Rush", "Senior", "Matinee"]);
    });

    it("merging keeps every source row: the two spellings stay two rows with their own measures", () => {
        const idx = build(ROWS);
        expect(idx.getRowCount()).toBe(5);
        const sold = idx.toObjectArray().filter((r: any) => r["Ticket Type"] === "Student Rush").map((r: any) => r["Tickets Sold"]);
        expect(sold).toEqual([14, 31]);        // 45 in all, which is what a grouped chart now draws
        for (let i = 0; i < ROWS.length; i++) expect(idx.getOriginalRowIndex(i)).toBe(i);
    });

    it("rows that differ ONLY by whitespace are not collapsed by the dedup hash", () => {
        // The hash reads the values as the host sent them, so a whitespace twin is a distinct source row, not a duplicate.
        const idx = build([["Student Rush ", 14], ["Student Rush", 14]]);
        expect(idx.getRowCount()).toBe(2);
        expect(idx.toObjectArray().map((r: any) => r["Ticket Type"])).toEqual(["Student Rush", "Student Rush"]);
    });

    it("the CSV the Python lane reads is trimmed the same way", async () => {
        const csv = await build(ROWS).getCSVAsync(false);
        expect(csv).toContain("Student Rush");
        expect(csv).not.toContain("Student Rush ,");
        expect(csv).not.toContain("  Matinee");
    });

    it("the visual path and the ingest path now measure the same table identically", () => {
        const viaIngest = ingest({ kind: "grid", header: COLUMNS.map(c => c.name), rows: ROWS.map(r => r.map(String)) }, { dedup: false });
        const viaAddRow = build(ROWS, false);
        const a = viaIngest.index.getColumnsWithStats("20").find(c => c.name === "Ticket Type")!;
        const b = viaAddRow.getColumnsWithStats("20").find(c => c.name === "Ticket Type")!;
        expect(b.distinctCount).toBe(a.distinctCount);
    });
});

describe("trimmedCells", () => {
    it("trims strings only, keeps a blank a blank, and copies the row only when a cell changes", () => {
        const clean = ["a", 1, null, "", new Date(0)];
        expect(trimmedCells(clean)).toBe(clean);
        const dirty = [" a ", 1, "  ", "b"];
        const out = trimmedCells(dirty);
        expect(out).toEqual(["a", 1, "", "b"]);
        expect(out).not.toBe(dirty);
        expect(dirty[0]).toBe(" a ");          // the host's array is never written to
    });
});
