import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

/**
 * A MISSING-VALUE WORD IN A NUMBER COLUMN IS A BLANK.
 *
 * Databases and analysis tools write a missing number as a word when they save text: `NULL` from a SQL export,
 * `NA` from R, `NaN` from pandas, `N/A` by hand. One of them in an otherwise numeric column used to make the whole
 * column text, so its numbers were measured as labels and no chart could total them. In a column whose every other
 * value is a number the word is read as the blank it stands for. Anywhere else it is left as it was: in a text
 * column it is a label like any other, and a dated column is left to the date rules.
 */
describe("NULL, NA, N/A and NaN in a number column", () => {
    it("are blanks, and the column is numeric", () => {
        const r = ingest({ kind: "csv", text: "Cat,V,W\nA,1,1.5\nB,,NaN\nC,NULL,2.5\nD,N/A,nan\nE,5,NA\n" }, { dedup: false });
        const v = r.columns.find(c => c.name === "V")!;
        const w = r.columns.find(c => c.name === "W")!;
        expect(v.dataType).toBe("Integer");
        expect(v.isMeasure).toBe(true);
        expect(w.dataType).toBe("Decimal");
        expect(r.rows.map(x => x.V)).toEqual([1, null, null, null, 5]);
        expect(r.rows.map(x => x.W)).toEqual([1.5, null, 2.5, null, null]);
    });

    it("stay labels in a text column", () => {
        const r = ingest({ kind: "csv", text: "Region,Owner\nNorth,Ann\nSouth,N/A\nEast,NULL\n" }, { dedup: false });
        expect(r.columns.find(c => c.name === "Owner")!.dataType).toBe("String");
        expect(r.rows.map(x => x.Owner)).toEqual(["Ann", "N/A", "NULL"]);
    });

    it("leave a dated column to the date rules", () => {
        const r = ingest({ kind: "csv", text: "Shipped,V\n2024-01-05,1\nNULL,2\n2024-01-07,3\n" }, { dedup: false });
        expect(r.rows.map(x => x.Shipped)).toContain("NULL");
    });

    it("a column of nothing but the words stays text", () => {
        const r = ingest({ kind: "csv", text: "Cat,V\nA,NULL\nB,N/A\n" }, { dedup: false });
        expect(r.columns.find(c => c.name === "V")!.dataType).toBe("String");
    });
});
