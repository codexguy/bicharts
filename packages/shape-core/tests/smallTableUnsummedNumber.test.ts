import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { classifyNumericValueNature, IndexedText, promotesToMeasure } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// A SMALL TABLE'S UNSUMMARISED NUMBER IS A QUANTITY (2026-11-23). The Power BI visual sends a number bound without an aggregation
// as a non-measure, and the measure inference decides. Rule (d) made a non-measure numeric Continuous only above twelve distinct
// values, so a six-row table of regions and their Attainment (92.4 .. 112.3) stamped Attainment Categorical, the measure inference
// left it a dimension, and the server gate - which reads the stamped nature for both the What-fits offer and the refusal - refused
// Variance grid and Bar with "Attainment and Target are category fields". On a table this small, distinct values cannot exceed the
// row count, so the cardinality test could never pass; what still tells a quantity from a code is that each row has its OWN value
// and the values are not a run of consecutive whole numbers. Bins with repeated rows, code runs, identifier names and every large
// table keep their old reading.

const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue => ({ name, dataType, isMeasure });
const REGIONS = ["North", "South", "East", "West", "Central", "Pacific", "Atlantic", "Mountain"];

function build(values: number[], name: string, dataType: string, declare = false): IndexedText {
    const t = new IndexedText();
    const cols = [col("Region", "String"), col(name, dataType)];
    t.setColumns(cols);
    if (declare) t.declareDimensions([cols[1]]);
    values.forEach((v, k) => t.addRow([REGIONS[k % REGIONS.length] + (k >= REGIONS.length ? `-${k}` : ""), v], k));
    return t;
}
const profile = (values: number[], name: string, dataType = "Decimal", declare = false) =>
    build(values, name, dataType, declare).getColumnsWithStats("20").find(c => c.name === name)!;

// Six regions, Attainment and its target, bound unsummarised.
const ATTAINMENT = [92.4, 107.1, 81.5, 112.3, 66.2, 98.7];

describe("a small table's unsummarised number is a measured quantity", () => {
    it("six rows of fractional Attainment: a Continuous measure (the repro)", () => {
        const c = profile(ATTAINMENT, "Attainment");
        expect(c.valueNature).toBe("Continuous");
        expect(c.isMeasure).toBe(true);
    });

    it("both numbers of the repro are measures, so the shape has two numeric fields", () => {
        const t = new IndexedText();
        t.setColumns([col("Region", "String"), col("Attainment", "Decimal"), col("AttainmentTarget", "Decimal")]);
        const targets = [100.5, 101.6, 97.2, 113.3, 94.4, 110.5];
        ATTAINMENT.forEach((a, k) => t.addRow([REGIONS[k], a, targets[k]], k));
        const out = t.getColumnsWithStats("20");
        expect(out.map(c => c.isMeasure)).toEqual([false, true, true]);
        expect(out.slice(1).map(c => c.valueNature)).toEqual(["Continuous", "Continuous"]);
    });

    it("eight rows of whole-number Revenue, each its own value: a Continuous measure", () => {
        const c = profile([48210, 13377, 90512, 27104, 61993, 35420, 8871, 72066], "Revenue", "Integer");
        expect(c.valueNature).toBe("Continuous");
        expect(c.isMeasure).toBe(true);
    });

    it("twelve unique decimals are not 'numbers used as categories'", () => {
        const c = profile([43.2, 54.8, 31.9, 77.4, 65.5, 22.1, 66.6, 89.3, 40.7, 58.2, 44.1, 75.9], "Score");
        expect(c.valueNature).toBe("Continuous");
        expect(c.isMeasure).toBe(true);
    });

    it("one repeated value among six fractional rows is still a quantity", () => {
        const c = profile([92.4, 107.1, 92.4, 112.3, 66.2, 98.7], "Attainment");
        expect(c.valueNature).toBe("Continuous");
        expect(c.isMeasure).toBe(true);
    });

    it("the scale does not flip the verdict: the same values / 100 are promoted too", () => {
        expect(promotesToMeasure(col("Attainment", "Decimal"), false,
            { distinct: 6, nonblank: 6, prec: 3, minval: 0.662, maxval: 1.123 })).toBe(true);
    });

    it("promotesToMeasure and the stamped nature agree on the repro", () => {
        expect(promotesToMeasure(col("Attainment", "Decimal"), false,
            { distinct: 6, nonblank: 6, prec: 1, minval: 66.2, maxval: 112.3 })).toBe(true);
        expect(build(ATTAINMENT, "Attainment", "Decimal").inferredMeasureFlags()).toEqual([false, true]);
    });
});

describe("what the small-table rule must never move", () => {
    it("repeated fractional bins stay a category", () => {
        const c = profile([25.5, 25.5, 30.5, 30.5, 35.5, 35.5, 25.5, 30.5], "PriceBand");
        expect(c.valueNature).toBe("Categorical");
        expect(c.isMeasure).toBe(false);
    });

    it("repeated fractional bins inside 0..20 keep their ordered reading and are not promoted", () => {
        const c = profile([0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.1, 0.2], "Discount");
        expect(c.valueNature).toBe("Ordinal");
        expect(c.isMeasure).toBe(false);
    });

    it("repeated whole-number levels stay a category", () => {
        const c = profile([40, 40, 60, 60, 80, 80], "Band", "Integer");
        expect(c.valueNature).toBe("Categorical");
        expect(c.isMeasure).toBe(false);
    });

    it("a small run of consecutive whole-number codes, each once, stays a category", () => {
        const c = profile([101, 102, 103, 104, 105, 106], "Store", "Integer");
        expect(c.valueNature).toBe("Categorical");
        expect(c.isMeasure).toBe(false);
    });

    it("a small 0..20 level scale keeps its ordered-axis reading", () => {
        const c = profile([1, 2, 3, 4, 5, 6], "Level", "Integer");
        expect(c.valueNature).toBe("Ordinal");
        expect(c.isMeasure).toBe(false);
    });

    it("sparse whole-number years, each once, are not promoted and summed", () => {
        const c = profile([2015, 2018, 2020, 2024, 2011, 2007], "Vintage", "Integer");
        expect(c.valueNature).toBe("Categorical");
        expect(c.isMeasure).toBe(false);
    });

    it("an ordered-axis name over sparse whole numbers is not promoted", () => {
        const c = profile([1, 3, 6, 9, 12, 4], "Month", "Integer");
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).not.toBe("Continuous");
    });

    it("an identifier name stays an identifier", () => {
        const c = profile([48210, 13377, 90512, 27104, 61993, 35420], "CustomerID", "Integer");
        expect(c.valueNature).toBe("Categorical");
        expect(c.isMeasure).toBe(false);
    });

    it("a declared dimension is never promoted", () => {
        const c = profile(ATTAINMENT, "Attainment", "Decimal", true);
        expect(c.isMeasure).toBe(false);
    });

    it("two rows are too few to tell a quantity from a pair of codes", () => {
        expect(classifyNumericValueNature({ dataType: "Decimal", isMeasure: false, name: "Attainment",
            distinct: 2, nonblank: 2, prec: 1, minval: 92.4, maxval: 107.1 })).toBe("Categorical");
    });

    it("a large table with a handful of repeated values stays a category", () => {
        expect(classifyNumericValueNature({ dataType: "Decimal", isMeasure: false, name: "Discount",
            distinct: 9, nonblank: 4000, prec: 2, minval: 25.5, maxval: 65.5 })).toBe("Categorical");
    });
});

// The wire fixture the server reads. The server's gate offers and refuses on the nature this engine stamps, so the file is what
// both sides agree on: the engine's own output for small tables, narrowed to the fields the gate reads. A server test reads it and
// asks the real gate whether the charts that need a number are offered. Set SMALL_TABLE_FIXTURE_WRITE=1 to rewrite it after a
// deliberate change.
describe("small tables - the wire fixture the server reads", () => {
    const fixturePath = new URL("./fixtures/small-table-stamps.json", import.meta.url);

    const stamp = (cols: LLMColumnWithValue[], rows: any[][]) => {
        const t = new IndexedText();
        t.setColumns(cols.map(c => ({ ...c })));
        rows.forEach((r, k) => t.addRow(r, k));
        return t.getColumnsWithStats("20").map((c: any) => ({
            name: c.name, dataType: c.dataType, isMeasure: c.isMeasure, distinctCount: c.distinctCount, valueNature: c.valueNature,
        }));
    };

    const produce = () => ({
        _why: "Engine output for small tables whose numbers arrive unsummarised: a six-row attainment table (two decimals, each row "
            + "its own value), an eight-row orders table (whole numbers, each row its own value), and a six-row table of repeated "
            + "price bands that must stay a category.",
        attainment: stamp([col("Region", "String"), col("Attainment", "Decimal"), col("Target", "Decimal")],
            ATTAINMENT.map((a, k) => [REGIONS[k], a, [100.5, 101.6, 97.2, 113.3, 94.4, 110.5][k]])),
        orders: stamp([col("Region", "String"), col("Orders", "Integer"), col("Revenue", "Integer"), col("Profit", "Integer")],
            [[12, 90000, 15000], [45, 300000, 70000], [23, 150000, 31000], [31, 210000, 44000],
             [10, 95000, 16500], [38, 260000, 58000], [17, 120000, 22000], [27, 180000, 39000]]
                .map((r, k) => [REGIONS[k], ...r])),
        bands: stamp([col("Region", "String"), col("PriceBand", "Decimal")],
            [25.5, 25.5, 30.5, 30.5, 35.5, 35.5].map((v, k) => [REGIONS[k], v])),
    });

    it("is what the engine produces today", () => {
        const now = produce();
        if (process.env.SMALL_TABLE_FIXTURE_WRITE) fs.writeFileSync(fixturePath, JSON.stringify(now, null, 2) + "\n");
        expect(JSON.parse(fs.readFileSync(fixturePath, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
    });

    it("stamps the small tables' numbers as measures and the repeated bands as a category", () => {
        const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
        const at = (t: string, n: string) => fx[t].find((c: any) => c.name === n);
        for (const [t, n] of [["attainment", "Attainment"], ["attainment", "Target"], ["orders", "Orders"], ["orders", "Revenue"], ["orders", "Profit"]]) {
            expect(at(t, n).isMeasure, `${t}.${n}`).toBe(true);
            expect(at(t, n).valueNature, `${t}.${n}`).toBe("Continuous");
        }
        expect(at("bands", "PriceBand").isMeasure).toBe(false);
        expect(at("bands", "PriceBand").valueNature).toBe("Categorical");
    });
});
