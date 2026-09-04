import { describe, it, expect } from "vitest";
import { collapseRepeatedAggPrefix, codeNeedsLegacyAggNames } from "../src/aggregation";
import { IndexedText } from "../src/indexedText";
import { ingest } from "../src/ingest";

// THE BUG THIS FILE EXISTS FOR (2026-09-04). A pre-aggregated table - one whose CSV header
// really does read `Sum of Revenue` - was bound into a measure well, and Power BI prefixed its
// own label onto a name that already carried one. `Sum of Sum of Revenue` then reached the
// shape, the prompt and every axis label in the chart. Being handed a pivot export is ordinary
// user behaviour, so this is a rule and not a fixture repair.
//
// Every case below is a name a host can really produce. The collapse is a RENAME of the key that
// the shape, the prompt, the dataset and the generated code all share, so the second half of the
// file pins the two things that would make a rename unsafe: a collision, and cached code.

describe("a repeated host aggregation prefix collapses to one", () => {
    it("collapses the doubled default prefixes", () => {
        expect(collapseRepeatedAggPrefix("Sum of Sum of Revenue")).toBe("Sum of Revenue");
        expect(collapseRepeatedAggPrefix("Count of Count of Orders")).toBe("Count of Orders");
    });

    it("collapses the CHOSEN aggregations too, not only the host's defaults", () => {
        expect(collapseRepeatedAggPrefix("Max of Max of Latency")).toBe("Max of Latency");
        expect(collapseRepeatedAggPrefix("Avg of Avg of Score")).toBe("Avg of Score");
        expect(collapseRepeatedAggPrefix("Average of Average of Score")).toBe("Average of Score");
        expect(collapseRepeatedAggPrefix("Median of Median of Wait")).toBe("Median of Wait");
    });

    it("collapses a triple, and any depth up to the guard", () => {
        expect(collapseRepeatedAggPrefix("Sum of Sum of Sum of Revenue")).toBe("Sum of Revenue");
    });

    it("keeps the caller's own first prefix, not a canonicalised one", () => {
        expect(collapseRepeatedAggPrefix("Sum of sum of Revenue")).toBe("Sum of Revenue");
        expect(collapseRepeatedAggPrefix("SUM OF SUM OF Revenue")).toBe("SUM OF Revenue");
    });

    it("leaves a genuinely twice-aggregated column alone - it is a true sentence", () => {
        expect(collapseRepeatedAggPrefix("Sum of Average of Latency")).toBe("Sum of Average of Latency");
        expect(collapseRepeatedAggPrefix("Average of Sum of Revenue")).toBe("Average of Sum of Revenue");
    });

    it("never touches a name that only mentions an aggregation", () => {
        for (const n of ["Revenue", "Sum of Revenue", "Total Sum of Sum Bonus",
            "Report of Sum of Sum of Sales", "Summary of Orders", "First Name", ""]) {
            expect(collapseRepeatedAggPrefix(n)).toBe(n);
        }
    });

    it("a longer label is not eaten by a shorter one that prefixes it", () => {
        expect(collapseRepeatedAggPrefix("Count distinct of Count distinct of Users"))
            .toBe("Count distinct of Users");
        // `Count of Count distinct of X` is two DIFFERENT labels: untouched.
        expect(collapseRepeatedAggPrefix("Count of Count distinct of Users"))
            .toBe("Count of Count distinct of Users");
    });

    it("is idempotent and null-safe", () => {
        const once = collapseRepeatedAggPrefix("Sum of Sum of Revenue");
        expect(collapseRepeatedAggPrefix(once)).toBe(once);
        expect(collapseRepeatedAggPrefix(null)).toBe("");
        expect(collapseRepeatedAggPrefix(undefined)).toBe("");
    });

    it("a prefix with nothing after it is the whole name, not a duplication", () => {
        expect(collapseRepeatedAggPrefix("Sum of Sum of ")).toBe("Sum of Sum of ");
    });
});

describe("IndexedText renames the column, and everything downstream moves with it", () => {
    const build = (names: string[], rows: any[][]) => {
        const idx = new IndexedText();
        idx.setColumns(names.map(n => ({
            name: n, dataType: n === "State" ? "String" : "Integer", isMeasure: n !== "State",
        })));
        rows.forEach((r, i) => idx.addRow(r, i));
        return idx;
    };

    it("the shape, the dataset key and the recorded host name all agree", () => {
        const idx = build(["State", "Sum of Sum of Revenue"], [["CA", 10], ["TX", 20]]);
        const cols = idx.getColumnsWithStats("20");
        expect(cols.map(c => c.name)).toEqual(["State", "Sum of Revenue"]);
        expect(cols[1].hostName).toBe("Sum of Sum of Revenue");
        expect(cols[0].hostName).toBeUndefined();      // an untouched name records nothing
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["State", "Sum of Revenue"]);
    });

    it("A COLLISION LEAVES THE HOST'S NAME ALONE - two columns may never become one key", () => {
        // Bind the pre-aggregated column as a dimension AND sum it as a measure: the host hands
        // us both names, and collapsing the second onto the first would drop a column's data.
        const idx = build(["Sum of Revenue", "Sum of Sum of Revenue"], [[10, 10], [20, 20]]);
        expect(idx.getColumnsWithStats("20").map(c => c.name))
            .toEqual(["Sum of Revenue", "Sum of Sum of Revenue"]);
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["Sum of Revenue", "Sum of Sum of Revenue"]);
    });

    it("re-setting the same columns changes nothing (the matrix-recovery path)", () => {
        const idx = new IndexedText();
        const cols = [{ name: "Sum of Sum of Revenue", dataType: "Integer", isMeasure: true }];
        idx.setColumns(cols);
        idx.setColumns(cols);
        expect(cols[0].name).toBe("Sum of Revenue");
        expect(cols[0].hostName).toBe("Sum of Sum of Revenue");
    });

    it("reaches the ingest front door too, so every decoder inherits it", () => {
        const r = ingest({ kind: "csv", text: "State,Sum of Sum of Revenue\nCA,10\nTX,20\n" },
            { measures: ["Sum of Sum of Revenue"] });
        expect(r.columns.map(c => c.name)).toEqual(["State", "Sum of Revenue"]);
        expect(r.rows[0]["Sum of Revenue"]).toBe(10);
    });
});

describe("cached code that still names the host's column keeps working", () => {
    const idx = new IndexedText();
    idx.setColumns([
        { name: "State", dataType: "String", isMeasure: false },
        { name: "Sum of Sum of Revenue", dataType: "Integer", isMeasure: true },
    ]);
    idx.addRow(["CA", 10], 0);
    const cols = idx.getColumnsWithStats("20");
    const oldCode = 'const v = d => d["Sum of Sum of Revenue"];';
    const newCode = 'const v = d => d["Sum of Revenue"];';

    it("the code text is what decides, and only for a column that was renamed", () => {
        expect(codeNeedsLegacyAggNames(oldCode, cols)).toBe(true);
        expect(codeNeedsLegacyAggNames(newCode, cols)).toBe(false);
        expect(codeNeedsLegacyAggNames(oldCode, [])).toBe(false);
        expect(codeNeedsLegacyAggNames(null, cols)).toBe(false);
    });

    it("the alias is OFF by default - a fresh chart must never see a duplicate column", () => {
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["State", "Sum of Revenue"]);
    });

    it("switched on, the row answers to BOTH names with the same value", () => {
        idx.emitLegacyAggAliases = true;
        const row = idx.toObjectArray()[0];
        expect(row["Sum of Revenue"]).toBe(10);
        expect(row["Sum of Sum of Revenue"]).toBe(10);
        idx.emitLegacyAggAliases = false;
    });
});
