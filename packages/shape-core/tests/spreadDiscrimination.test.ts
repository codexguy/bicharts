import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// SPREAD-DISCRIMINATION. eta2 asks whether the group MEANS differ. A ridgeline,
// violin or box-by-group is equally justified when the group WIDTHS differ at an identical mean,
// and eta2 is blind to that - so a picker rule built on eta2 alone would demote precisely the
// case those charts exist for. These tests pin the two halves apart: a shape whose means match
// but whose spreads do not must report LOW eta2 and HIGH spreadRatio.
//
// Motivated by a real generation that drew a three-group ridgeline where the grouping column
// explained 0.47% of the measure's variance: three ridges, one curve.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

function build(rows: (string | number)[][]): LLMColumnWithValue[] {
    const t = new IndexedText();
    t.setColumns([col("Grp", "String"), col("Val", "Decimal", true)]);
    for (const r of rows) t.addRow(r as any);
    return t.getColumnsWithStats("10");
}

function statFor(cols: LLMColumnWithValue[], measure: string, dim: string) {
    const c: any = cols.find(x => x.name === measure);
    return {
        eta2: (c?.groupDiscrimination ?? []).find((g: any) => g.otherColumn === dim)?.eta2,
        spreadRatio: (c?.spreadDiscrimination ?? []).find((g: any) => g.otherColumn === dim)?.spreadRatio,
        col: c,
    };
}

/** Same mean in every group; group C is far wider. Deterministic, no RNG. */
function sameMeanDifferentSpread() {
    const rows: (string | number)[][] = [];
    for (let i = 0; i < 40; i++) rows.push(["A", 100 + ((i % 4) - 1.5)]);
    for (let i = 0; i < 40; i++) rows.push(["B", 100 + ((i % 4) - 1.5)]);
    for (let i = 0; i < 40; i++) rows.push(["C", 100 + ((i % 4) - 1.5) * 30]);
    return build(rows);
}

/** Every group statistically identical - the case R20 is allowed to demote. */
function indistinguishable() {
    const rows: (string | number)[][] = [];
    for (const g of ["A", "B", "C"])
        for (let i = 0; i < 40; i++) rows.push([g, 100 + ((i % 8) - 3.5)]);
    return build(rows);
}

describe("spreadDiscrimination", () => {
    it("separates a spread difference from a mean difference", () => {
        const { eta2, spreadRatio } = statFor(sameMeanDifferentSpread(), "Val", "Grp");
        // Means are equal by construction, so the LOCATION signal is ~nothing...
        expect(eta2).toBeLessThan(0.02);
        // ...while the widths differ enormously, which is what a ridgeline would show.
        expect(spreadRatio).toBeGreaterThan(0.5);
    });

    it("reports ~no spread signal when the groups really are identical", () => {
        const { eta2, spreadRatio } = statFor(indistinguishable(), "Val", "Grp");
        expect(eta2).toBeLessThan(0.02);
        expect(spreadRatio).toBeLessThan(0.25);
    });

    it("is emitted alongside eta2, one entry per dimension", () => {
        const { col } = statFor(sameMeanDifferentSpread(), "Val", "Grp");
        expect(col.groupDiscrimination?.length).toBeGreaterThan(0);
        expect(col.spreadDiscrimination?.length).toBe(col.groupDiscrimination?.length);
        expect(col.spreadDiscrimination[0].otherColumn).toBe("Grp");
    });

    it("stays absent when no group has enough points for a stable IQR", () => {
        // Three rows per group, fewer than the four an IQR needs, so the statistic is withheld
        // rather than invented. The server treats absence as "unknown", never as "they agree".
        const rows: (string | number)[][] = [];
        for (const g of ["A", "B", "C"]) for (let i = 0; i < 3; i++) rows.push([g, 10 + i]);
        const { col } = statFor(build(rows), "Val", "Grp");
        expect(col.spreadDiscrimination).toBeUndefined();
    });
});
