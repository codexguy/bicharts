import { describe, it, expect } from "vitest";
import { classifyNumericValueNature, IndexedText, promotesToMeasure } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// A whole-number column whose values are a contiguous run with each value once (a supplier or store numbered 1..N, bound
// as a field so the host sends one row per code) is a list of codes. Rule (d)'s uniqueness ratio used to read it as a
// measured quantity, and the measure inference turned the only category into a second measure. It now stays a category.
// Ordered names and ranges (rule b), identifier names (rule a), bound measures (rule c), Decimal-typed columns, runs with
// repeats and gapped quantities keep their old reading.

const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue => ({ name, dataType, isMeasure });
const run = (from: number, n: number) => Array.from({ length: n }, (_, k) => from + k);
const CODES = run(1, 68);

function build(values: number[], name = "Supplier", dataType = "Integer", isMeasure = false, declare = false): IndexedText {
    const t = new IndexedText();
    const cols = [col("Region", "String"), col(name, dataType, isMeasure), col("Revenue", "Integer", true)];
    t.setColumns(cols);
    if (declare) t.declareDimensions([cols[1]]);
    values.forEach((v, k) => t.addRow([`R${k % 5}`, v, (k * 7919) % 371168 + 3], k));
    return t;
}
const profile = (values: number[], name = "Supplier", dataType = "Integer", isMeasure = false, declare = false) =>
    build(values, name, dataType, isMeasure, declare).getColumnsWithStats("20").find(c => c.name === name)!;

describe("a whole-number code run, each value once, stays a category", () => {
    it("a code 1..68, each value once, bound as a field is not promoted", () => {
        const c = profile(CODES);
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).toBe("Categorical");
    });

    it("promotesToMeasure does not promote the code run", () => {
        expect(promotesToMeasure(col("Supplier", "Integer"), false,
            { distinct: 68, nonblank: 68, prec: 0, minval: 1, maxval: 68 })).toBe(false);
    });

    it("the render-time flags agree with the shape", () => {
        expect(build(CODES).inferredMeasureFlags()).toEqual([false, false, true]);
    });

    it("the classifier reads the run as Categorical", () => {
        expect(classifyNumericValueNature({ dataType: "Integer", isMeasure: false, name: "Fornecedor",
            distinct: 68, nonblank: 68, prec: 0, minval: 1, maxval: 68 })).toBe("Categorical");
    });

    it("a declared dimension of the same run is stamped Categorical", () => {
        const c = profile(CODES, "Supplier", "Integer", false, true);
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).toBe("Categorical");
    });
});

describe("what the code-run rule must never move", () => {
    it("a run with repeats is still a promoted quantity", () => {
        const c = profile([...CODES, ...CODES.slice(0, 10)]);
        expect(c.isMeasure).toBe(true);
        expect(c.valueNature).toBe("Continuous");
    });

    it("a gapped quantity, each value once, is still promoted", () => {
        const c = profile(CODES.map(k => k * 3 - 2));
        expect(c.isMeasure).toBe(true);
        expect(c.valueNature).toBe("Continuous");
    });

    it("a fractional column is still promoted", () => {
        const c = profile(CODES.map(k => k + 0.5), "Supplier", "Decimal");
        expect(c.isMeasure).toBe(true);
        expect(c.valueNature).toBe("Continuous");
    });

    it("a Decimal-typed run of whole numbers is still promoted", () => {
        const c = profile(CODES, "Supplier", "Decimal");
        expect(c.isMeasure).toBe(true);
        expect(c.valueNature).toBe("Continuous");
    });

    it("twelve or fewer codes keep the small-scale ordered reading", () => {
        const c = profile(run(1, 12));
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).toBe("Ordinal");
    });

    it("an ordered name or a year range keeps the ordered-axis reading", () => {
        expect(profile(CODES, "Rank").valueNature).toBe("Ordinal");
        expect(profile(CODES, "Rank").isMeasure).toBe(false);
        expect(profile(run(1950, 68), "Calendar").valueNature).toBe("Ordinal");
    });

    it("an identifier name stays an identifier", () => {
        const c = profile(CODES, "SupplierID");
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).toBe("Categorical");
    });

    it("a bound measure that is a permutation stays a measured quantity", () => {
        const c = profile(CODES, "Supplier Value", "Integer", true);
        expect(c.isMeasure).toBe(true);
        expect(c.valueNature).toBe("Continuous");
    });
});
