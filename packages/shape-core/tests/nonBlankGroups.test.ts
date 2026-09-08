import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// NON-BLANK GROUP COUNT. `blankCount` says how many rows of a measure are empty; it never says
// WHERE they fall. A measure blank on 81% of rows whose remaining values all sit in ONE group is
// indistinguishable, by every count previously on the wire, from one spread evenly across forty -
// and the two draw completely different pictures. The first is a single mark under a full legend.
//
// From a real generation: a bubble-per-category motion chart whose y measure had values in exactly
// one category. One bubble in every frame, forty-one legend swatches, and nothing downstream could
// have known.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

// IndexedText DE-DUPLICATES identical rows, so a fixture of thirty repeated [group, null] rows
// collapses to three and every count downstream reads the collapsed shape. The Id column keeps
// every row distinct, which is what a real binding looks like anyway.
function build(rows: (string | number | null)[][]): LLMColumnWithValue[] {
    const t = new IndexedText();
    t.setColumns([col("Id", "String"), col("Grp", "String"), col("Val", "Decimal", true)]);
    rows.forEach((r, i) => t.addRow(["r" + i, r[0], r[1]] as any));
    return t.getColumnsWithStats("10");
}

function groupsFor(cols: LLMColumnWithValue[], measure: string, dim: string) {
    const c: any = cols.find(x => x.name === measure);
    return {
        count: (c?.nonBlankGroups ?? []).find((g: any) => g.otherColumn === dim)?.nonBlankGroupCount,
        blankCount: c?.blankCount,
        col: c,
    };
}

describe("nonBlankGroups", () => {
    it("reports ONE group when every value of the measure lives in one category", () => {
        // The defect shape: 4 groups, but Val is non-blank only inside 'A'.
        const rows: (string | number | null)[][] = [];
        for (let i = 0; i < 10; i++) rows.push(["A", 10 + i]);
        for (const g of ["B", "C", "D"]) for (let i = 0; i < 10; i++) rows.push([g, null]);

        const { count, blankCount } = groupsFor(build(rows), "Val", "Grp");
        expect(count).toBe(1);
        expect(blankCount).toBe(30);
    });

    it("reports every group when the same sparsity is spread across them", () => {
        // SAME 40 rows and the SAME 30 blanks as the test above, spread 3/3/3/1 across the four
        // groups instead of piled into one. Identical blankCount, completely different picture:
        // this pair is the whole reason the signal exists.
        const rows: (string | number | null)[][] = [];
        ["A", "B", "C", "D"].forEach((g, gi) => {
            const nonBlank = gi < 3 ? 3 : 1;              // 3 + 3 + 3 + 1 = 10 of 40
            for (let i = 0; i < 10; i++) rows.push([g, i < nonBlank ? 42 + i : null]);
        });

        const { count, blankCount } = groupsFor(build(rows), "Val", "Grp");
        expect(count).toBe(4);
        expect(blankCount).toBe(30);
    });

    it("counts every group for a measure that is blank nowhere", () => {
        const rows: (string | number | null)[][] = [];
        for (const g of ["A", "B", "C"]) for (let i = 0; i < 5; i++) rows.push([g, i + 1]);

        const { count, blankCount } = groupsFor(build(rows), "Val", "Grp");
        expect(count).toBe(3);
        expect(blankCount).toBe(0);
    });

    it("still reports a CONSTANT measure, which the variance pass exits before reaching", () => {
        // eta2 is undefined for a constant column and its loop returns early. A constant measure
        // trapped in one group is exactly the case this signal must not lose, so it is computed
        // ahead of that return.
        const rows: (string | number | null)[][] = [];
        for (let i = 0; i < 10; i++) rows.push(["A", 7]);
        for (const g of ["B", "C"]) for (let i = 0; i < 10; i++) rows.push([g, null]);

        const { count, col: c } = groupsFor(build(rows), "Val", "Grp");
        expect(count).toBe(1);
        expect((c as any).groupDiscrimination).toBeUndefined();
    });

    it("is not emitted for an all-blank measure, which is a different case", () => {
        const rows: (string | number | null)[][] = [];
        for (const g of ["A", "B", "C"]) for (let i = 0; i < 5; i++) rows.push([g, null]);

        const { col: c } = groupsFor(build(rows), "Val", "Grp");
        expect(c.blankCount).toBe(15);
        expect(c.nonBlankGroups).toBeUndefined();
    });
});
