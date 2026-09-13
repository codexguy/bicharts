import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// MEASURES THAT MOVE TOGETHER, BELOW THE COLLINEAR CUT. collinearWithMeasures answers "is this the
// same axis" at |r| >= 0.97. A taxi fare that rises with trip distance at r 0.966 is not the same
// axis - a scatter of the two is a real chart - but a beeswarm plotting distance and colouring its
// dots by fare repeats the y axis in a legend, and nothing in the shape could say so. These pin the
// band's edges, its sign, its order and its cap, so the server can choose where "moves together"
// begins without a client release.

function build(names: string[], rows: number[][]): LLMColumnWithValue[] {
    const t = new IndexedText();
    t.setColumns(names.map(name => ({ name, dataType: "Decimal", isMeasure: true })));
    for (const r of rows) t.addRow(r as any);
    return t.getColumnsWithStats("10");
}

/** y = base + noise with a chosen correlation, deterministic (no RNG): sin/cos give orthogonal-ish noise. */
function series(n: number, noise: number, sign = 1) {
    const rows: number[][] = [];
    for (let i = 0; i < n; i++) {
        const x = i;
        rows.push([x, sign * x + noise * n * Math.sin(i * 1.7) + 0.001 * i]);
    }
    return rows;
}

const pearson = (rows: number[][]) => {
    const n = rows.length; let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of rows) { sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    return (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
};

const of = (cols: LLMColumnWithValue[], name: string) => cols.find(c => c.name === name)!;

describe("correlatedWithMeasures", () => {
    it("a pair inside the band is reported on BOTH measures, with its signed r to three places", () => {
        const rows = series(200, 0.12);
        const r = pearson(rows);
        expect(Math.abs(r)).toBeGreaterThanOrEqual(0.8);
        expect(Math.abs(r)).toBeLessThan(0.97);
        const cols = build(["Distance", "Fare"], rows);
        expect(of(cols, "Distance").correlatedWithMeasures).toEqual([{ otherColumn: "Fare", r: Math.round(r * 1000) / 1000 }]);
        expect(of(cols, "Fare").correlatedWithMeasures).toEqual([{ otherColumn: "Distance", r: Math.round(r * 1000) / 1000 }]);
        expect(of(cols, "Fare").collinearWithMeasures).toBeUndefined();
    });

    it("a NEGATIVE relationship moves together just as much, and keeps its sign", () => {
        const rows = series(200, 0.12, -1);
        const cols = build(["Position", "Points"], rows);
        const got = of(cols, "Points").correlatedWithMeasures!;
        expect(got).toHaveLength(1);
        expect(got[0].r).toBeLessThan(-0.8);
    });

    it("at or above the collinear cut the pair is collinear INSTEAD, never both", () => {
        const rows = series(200, 0.0);
        const cols = build(["Views", "Views x2"], rows);
        expect(of(cols, "Views").collinearWithMeasures).toEqual(["Views x2"]);
        expect(of(cols, "Views").correlatedWithMeasures).toBeUndefined();
    });

    it("below 0.8 nothing is reported", () => {
        const rows = series(200, 0.5);
        expect(Math.abs(pearson(rows))).toBeLessThan(0.8);
        const cols = build(["A", "B"], rows);
        expect(of(cols, "A").correlatedWithMeasures).toBeUndefined();
    });

    it("strongest first, and at most eight per measure", () => {
        const n = 240;
        const names = ["Base", ...Array.from({ length: 10 }, (_, k) => `M${k}`)];
        const rows: number[][] = [];
        for (let i = 0; i < n; i++) {
            const row = [i];
            // Each Mk moves with Base, with noise growing in k so every r differs and all sit in the band.
            for (let k = 0; k < 10; k++) row.push(i + (0.11 + k * 0.012) * n * Math.sin(i * (1.3 + k * 0.41)));
            rows.push(row);
        }
        const base = of(build(names, rows), "Base").correlatedWithMeasures!;
        expect(base.length).toBe(8);
        for (let k = 1; k < base.length; k++) expect(Math.abs(base[k - 1].r)).toBeGreaterThanOrEqual(Math.abs(base[k].r));
    });

    it("the taxi sheet that raised this: fare and duration both move with distance, under the collinear cut", () => {
        // A deterministic stand-in with the same structure: fare and duration are distance plus
        // their own variation. The real sheet measures 0.966 and 0.955.
        const rows: number[][] = [];
        for (let i = 0; i < 600; i++) {
            const km = 0.5 + (i % 60) * 0.3 + ((i * 7) % 11) * 0.05;
            rows.push([km, 3 + 2.1 * km + 4.5 * Math.sin(i * 2.3), 4 + 2.6 * km + 6.5 * Math.cos(i * 1.9)]);
        }
        const cols = build(["TripDistanceKm", "FareAmount", "DurationMinutes"], rows);
        const names = (of(cols, "TripDistanceKm").correlatedWithMeasures ?? []).map(p => p.otherColumn).sort();
        expect(names).toEqual(["DurationMinutes", "FareAmount"]);
        for (const p of of(cols, "TripDistanceKm").correlatedWithMeasures!) {
            expect(Math.abs(p.r)).toBeGreaterThanOrEqual(0.9);
            expect(Math.abs(p.r)).toBeLessThan(0.97);
        }
    });
});
