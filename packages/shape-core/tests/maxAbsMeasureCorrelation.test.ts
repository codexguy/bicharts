import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// DO THESE MEASURES MOVE TOGETHER AT ALL? collinearWithMeasures and correlatedWithMeasures both start at
// |r| 0.8, so a shape whose strongest pair sits at 0.6 and one whose strongest pair sits at 0.1 read the
// same to a consumer. maxAbsMeasureCorrelation is each measure's strongest |r| against any other measure,
// at any strength - one number from the same pass, so the server can apply its own floor. These pin the
// value, the rounding, the sign-blindness, and the ABSENCE cases a consumer must read as "unmeasured".

function build(names: string[], rows: (number | null)[][], measures?: boolean[]): LLMColumnWithValue[] {
    const t = new IndexedText();
    t.setColumns(names.map((name, i) => {
        const isMeasure = measures ? measures[i] : true;
        return { name, dataType: isMeasure ? "Decimal" : "String", isMeasure };
    }));
    for (const r of rows) t.addRow(r as any);
    return t.getColumnsWithStats("10");
}

const pearson = (xs: number[], ys: number[]) => {
    const n = xs.length; let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const x = xs[i], y = ys[i]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    return (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
};

const of = (cols: LLMColumnWithValue[], name: string) => cols.find(c => c.name === name)!;

describe("maxAbsMeasureCorrelation", () => {
    it("reports each measure's strongest pair, below the 0.8 band too, rounded to three places", () => {
        // A drives B at a moderate strength and C barely at all; nothing reaches the 0.8 lists.
        const rows: number[][] = [];
        for (let i = 0; i < 120; i++) {
            const a = i;
            rows.push([a, a + 60 * Math.sin(i * 1.7), 40 * Math.cos(i * 2.9) + 0.02 * a]);
        }
        const cols = build(["A", "B", "C"], rows);
        const col = (k: number) => rows.map(r => r[k]);
        const rAB = Math.abs(pearson(col(0), col(1))), rAC = Math.abs(pearson(col(0), col(2))), rBC = Math.abs(pearson(col(1), col(2)));
        expect(rAB).toBeGreaterThan(0.4);
        expect(rAB).toBeLessThan(0.8);
        const r3 = (x: number) => Math.round(x * 1000) / 1000;
        expect(of(cols, "A").maxAbsMeasureCorrelation).toBe(r3(Math.max(rAB, rAC)));
        expect(of(cols, "B").maxAbsMeasureCorrelation).toBe(r3(Math.max(rAB, rBC)));
        expect(of(cols, "C").maxAbsMeasureCorrelation).toBe(r3(Math.max(rAC, rBC)));
        expect(of(cols, "A").correlatedWithMeasures).toBeUndefined();
    });

    it("is sign-blind: a negative relationship is as strong as a positive one", () => {
        const rows: number[][] = [];
        for (let i = 0; i < 80; i++) rows.push([i, -2 * i + 30 * Math.sin(i * 1.3)]);
        const cols = build(["Position", "Points"], rows);
        const r = pearson(rows.map(q => q[0]), rows.map(q => q[1]));
        expect(r).toBeLessThan(0);
        expect(of(cols, "Points").maxAbsMeasureCorrelation).toBe(Math.round(Math.abs(r) * 1000) / 1000);
    });

    it("a collinear pair still counts: the value is the pair's own |r|, capped at 1", () => {
        const rows: number[][] = [];
        for (let i = 0; i < 50; i++) rows.push([i, 2 * i]);
        const cols = build(["Views", "Views x2"], rows);
        expect(of(cols, "Views").collinearWithMeasures).toEqual(["Views x2"]);
        expect(of(cols, "Views").maxAbsMeasureCorrelation).toBe(1);
    });

    it("is ABSENT, never zero, where nothing was measured", () => {
        // one measure: no pair
        expect(of(build(["Only"], [[1], [2], [3], [4], [5], [6]]), "Only").maxAbsMeasureCorrelation).toBeUndefined();
        // a constant measure has no correlation with anything, and its partner has no other pair
        const constant = build(["Flat", "Moving"], Array.from({ length: 20 }, (_, i) => [7, i]));
        expect(of(constant, "Flat").maxAbsMeasureCorrelation).toBeUndefined();
        expect(of(constant, "Moving").maxAbsMeasureCorrelation).toBeUndefined();
        // fewer than five rows where both are present
        const sparse = build(["X", "Y"], [[1, 2], [2, 4], [3, null], [4, 9], [5, null], [6, 13]]);
        expect(of(sparse, "X").maxAbsMeasureCorrelation).toBeUndefined();
        // a dimension never takes part
        const dims = build(["Dim", "M1", "M2"], Array.from({ length: 30 }, (_, i) => ["s" + i, i, (i * 7) % 11]) as any, [false, true, true]);
        expect(of(dims, "Dim").maxAbsMeasureCorrelation).toBeUndefined();
        expect(of(dims, "M1").maxAbsMeasureCorrelation).toBeDefined();
    });

    it("weak measures read weak: four unrelated series stay far under a relatedness floor of 0.5", () => {
        const rows: number[][] = [];
        for (let i = 0; i < 90; i++) rows.push([Math.sin(i * 1.1), Math.cos(i * 2.3), Math.sin(i * 3.7 + 1), Math.cos(i * 5.9 + 2)]);
        const cols = build(["P", "Q", "R", "S"], rows);
        const peak = Math.max(...cols.map(c => c.maxAbsMeasureCorrelation ?? 0));
        expect(peak).toBeGreaterThan(0);
        expect(peak).toBeLessThan(0.5);
    });
});
