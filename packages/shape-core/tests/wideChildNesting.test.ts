import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// WIDE-CHILD NESTING: a containment whose CHILD is wide.
//
// The categorical-pair pass materialises a value grid and so only ever looked at columns with
// PAIR_CAP (50) or fewer distinct values. That is right for the pair statistics and wrong for
// the nesting question, where the child is routinely the widest column in the table. A consumer
// that requires a MEASURED parent-child pair before it will draw a hierarchy then reads a
// containment nobody looked for as a containment that is not there.
//
// The motivating shape is a delivery table: street inside city, thousands of streets and
// hundreds of cities, both far above the pair-statistics ceiling.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

function build(cols: LLMColumnWithValue[], rows: any[][]): LLMColumnWithValue[] {
    const t = new IndexedText();
    t.setColumns(cols);
    for (const r of rows) t.addRow(r);
    return t.getColumnsWithStats("10");
}

function findCol(cols: LLMColumnWithValue[], name: string) {
    return cols.find(c => c.name === name)!;
}

/** (street, city, amount) rows where every street belongs to exactly one city. */
function streetsInCities(streetCount: number, cityCount: number, rowsPerStreet: number) {
    const rows: any[][] = [];
    for (let s = 0; s < streetCount; s++) {
        const city = "City " + (s % cityCount);
        for (let r = 0; r < rowsPerStreet; r++) rows.push(["Street " + s, city, (s + r) % 97]);
    }
    return build([col("Street", "String"), col("City", "String"), col("Amount", "Double", true)], rows);
}

describe("wide-child nesting", () => {
    it("finds a parent for a child far above the pair-statistics ceiling", () => {
        // 300 streets in 12 cities, three rows each: the child is 6x the 50-value ceiling.
        const cols = streetsInCities(300, 12, 3);
        const street = findCol(cols, "Street");
        expect(street.distinctCount).toBe(300);
        expect(street.primaryParentColumn).toBe("City");
        // 12 / 300, rounded to two places, exactly as the low-cardinality pass reports it.
        expect(street.nestingRatio).toBeCloseTo(0.04, 5);
    });

    it("does not invent a parent when the child crosses several", () => {
        // Same widths, but every street appears in TWO cities - a crossing, not a containment.
        const rows: any[][] = [];
        for (let s = 0; s < 300; s++) {
            rows.push(["Street " + s, "City " + (s % 12), s % 97]);
            rows.push(["Street " + s, "City " + ((s + 1) % 12), s % 89]);
        }
        const cols = build([col("Street", "String"), col("City", "String"), col("Amount", "Double", true)], rows);
        expect(findCol(cols, "Street").primaryParentColumn).toBeUndefined();
    });

    it("refuses a per-row-unique child, because that measures row identity", () => {
        // A borrower ID with one row each 1:1-determines EVERY other column in the table. The
        // domain relationship (each borrower is in one block) is real; what the DATA shows is
        // that each row is its own borrower, which is row identity rather than a containment
        // anyone can draw a ring from.
        const rows: any[][] = [];
        for (let b = 0; b < 400; b++) rows.push(["B" + b, "Block " + (b % 20), b * 7]);
        const cols = build([col("BorrowerID", "String"), col("Block", "String"), col("Income", "Double", true)], rows);
        expect(findCol(cols, "BorrowerID").primaryParentColumn).toBeUndefined();
    });

    it("records the COARSEST parent when a child sits inside two nested levels", () => {
        // Street inside City inside Region: both determine, and the coarsest is the one the
        // low-cardinality pass would record, so the two passes agree on the same answer.
        const rows: any[][] = [];
        for (let s = 0; s < 200; s++) {
            const city = s % 20, region = city % 4;
            for (let r = 0; r < 3; r++) rows.push(["Street " + s, "City " + city, "Region " + region, r]);
        }
        const cols = build([col("Street", "String"), col("City", "String"), col("Region", "String"),
                            col("Amount", "Double", true)], rows);
        expect(findCol(cols, "Street").primaryParentColumn).toBe("Region");
    });

    it("leaves a narrow child to the pass that already handles it", () => {
        // Under the ceiling the original pass runs and this one must not touch the result -
        // one parent, one writer, no double-assignment.
        const cols = streetsInCities(30, 5, 4);
        const street = findCol(cols, "Street");
        expect(street.distinctCount).toBe(30);
        expect(street.primaryParentColumn).toBe("City");
        expect(street.categoricalPairStats?.some(p => p.otherColumn === "City")).toBe(true);
    });

    it("never nests a measure", () => {
        const rows: any[][] = [];
        for (let s = 0; s < 300; s++) for (let r = 0; r < 3; r++) rows.push(["Street " + s, "City " + (s % 12), 5]);
        const cols = build([col("Street", "String"), col("City", "String"), col("Amount", "Double", true)], rows);
        expect(findCol(cols, "Amount").primaryParentColumn).toBeUndefined();
    });
});
