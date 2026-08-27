import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// The CONSTANT-SUM COMPOSITION pass (indexedText.ts, 2026-08-27).
//
// It answers one arithmetic question: do three or more numeric columns sum to the SAME total on
// every row? If they do they are parts of a whole; if they do not, normalising them produces a
// figure for every segment and means nothing.
//
// The two thresholds it applies were MEASURED rather than chosen, by sweeping 141 real datasets
// and reading what each setting flagged. The cases below are the ones that sweep turned up, kept
// as tests because a threshold with no counter-example is a threshold nobody checked:
//
//   • a loose tolerance finds only false positives, and
//   • the false positives all share a mechanism a tolerance CANNOT see — one large column
//     swamping the small ones, so the sum barely moves however unrelated the parts are.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

function profile(cols: LLMColumnWithValue[], rows: any[][]) {
    const it = new IndexedText();
    it.setColumns(cols);
    for (const r of rows) it.addRow(r);
    return it.getColumnsWithStats("100");
}

/** A composition: three parts summing to 100, spread across mix-space, with real rounding. */
function mixRows(n: number): any[][] {
    const out: any[][] = [];
    for (let i = 0; i < n; i++) {
        // Deterministic spread, no randomness. Parts vary widely and still sum to 100.
        const a = 10 + ((i * 7) % 60);
        const b = 5 + ((i * 11) % 30);
        const c = 100 - a - b;
        // Every third row rounds off by a tenth, the way a real percentage export does.
        out.push([`Acct${i}`, a, b, i % 3 === 0 ? c + 0.1 : c]);
    }
    return out;
}

describe("IndexedText constantSumGroup", () => {
    it("finds a genuine three-part composition and names every participant", () => {
        const cols = [col("Account", "String"), col("DirectPct", "Double", true),
                      col("PartnerPct", "Double", true), col("SelfServePct", "Double", true)];
        const out = profile(cols, mixRows(20));

        const direct = out.find(c => c.name === "DirectPct")!;
        expect(direct.constantSumGroup, "a 3-part split summing to 100 must be detected").toBeDefined();
        expect(direct.constantSumGroup!.total).toBeCloseTo(100, 1);
        expect(direct.constantSumGroup!.columns.sort())
            .toEqual(["DirectPct", "PartnerPct", "SelfServePct"]);

        // EVERY participant carries the descriptor, so a consumer can read it off whichever
        // column it happens to hold rather than having to find the one that "owns" it.
        for (const n of ["DirectPct", "PartnerPct", "SelfServePct"]) {
            expect(out.find(c => c.name === n)!.constantSumGroup,
                `${n} is a participant and must carry the group`).toBeDefined();
        }
        // ...and a non-participant does not.
        expect(out.find(c => c.name === "Account")!.constantSumGroup).toBeUndefined();
    });

    it("tolerates the rounding a real percentage export carries", () => {
        // mixRows puts a stray tenth on every third row. An implementation demanding exact
        // equality would reject the whole set, which is the failure a perfectly-clean fixture
        // would have hidden.
        const cols = [col("Account", "String"), col("A", "Double", true),
                      col("B", "Double", true), col("C", "Double", true)];
        const out = profile(cols, mixRows(21));
        const g = out.find(c => c.name === "A")!.constantSumGroup;
        expect(g, "rows landing on 100.1 must not disqualify a genuine split").toBeDefined();
        expect(g!.matchedPct).toBeGreaterThanOrEqual(0.95);
    });

    // ---- THE FALSE POSITIVES THE SWEEP FOUND, KEPT AS COUNTER-EXAMPLES ----

    it("does not call a YEAR column plus small counts a composition", () => {
        // This is the real shape that fired at a 5% tolerance: an Olympic year (~2000) plus
        // three medal counts (~20). The sum barely moves because the year swamps everything,
        // so it LOOKS constant while the parts are entirely unrelated. Only the minimum-share
        // guard rejects this; no tolerance alone can.
        const cols = [col("Country", "String"), col("Year", "Integer"),
                      col("Gold", "Integer", true), col("Silver", "Integer", true),
                      col("Bronze", "Integer", true)];
        const rows: any[][] = [];
        for (let i = 0; i < 20; i++)
            rows.push([`C${i}`, 1990 + (i % 8) * 4, i % 12, (i * 3) % 15, (i * 5) % 11]);
        const out = profile(cols, rows);

        for (const n of ["Year", "Gold", "Silver", "Bronze"]) {
            expect(out.find(c => c.name === n)!.constantSumGroup,
                `${n}: a large column swamping small ones is not a composition`).toBeUndefined();
        }
    });

    it("does not call three unrelated measures a composition", () => {
        const cols = [col("Team", "String"), col("Stability", "Double", true),
                      col("Risk", "Double", true), col("Leadership", "Double", true)];
        const rows: any[][] = [];
        for (let i = 0; i < 20; i++)
            rows.push([`T${i}`, 40 + (i * 13) % 55, 20 + (i * 7) % 40, 30 + (i * 17) % 50]);
        const out = profile(cols, rows);
        expect(out.find(c => c.name === "Stability")!.constantSumGroup,
            "three independent indexes do not sum to a constant").toBeUndefined();
    });

    it("needs three parts - a two-column split is not reported", () => {
        // Two columns summing to 100 is a pair, and a pair is a stacked bar or a dumbbell, not
        // the mix-space a composition chart draws. The floor is three by design.
        const cols = [col("Match", "String"), col("HomePct", "Double", true),
                      col("AwayPct", "Double", true)];
        const rows: any[][] = [];
        for (let i = 0; i < 20; i++) rows.push([`M${i}`, 30 + (i % 40), 70 - (i % 40)]);
        const out = profile(cols, rows);
        expect(out.find(c => c.name === "HomePct")!.constantSumGroup).toBeUndefined();
    });

    it("needs enough rows - constancy is cheap on a handful", () => {
        const cols = [col("K", "String"), col("A", "Double", true),
                      col("B", "Double", true), col("C", "Double", true)];
        const few = mixRows(20).slice(0, 5);
        expect(profile(cols, few).find(c => c.name === "A")!.constantSumGroup,
            "five rows is not evidence of a composition").toBeUndefined();
    });

    it("ignores a constant column, which would make any set look more constant than it is", () => {
        const cols = [col("K", "String"), col("A", "Double", true), col("B", "Double", true),
                      col("Fixed", "Double", true)];
        const rows: any[][] = [];
        // A and B vary freely and do NOT sum to a constant; Fixed never changes. If a constant
        // column were admitted as a part it would contribute stability it has no right to.
        for (let i = 0; i < 20; i++) rows.push([`K${i}`, 10 + (i * 9) % 70, 5 + (i * 13) % 50, 25]);
        const out = profile(cols, rows);
        expect(out.find(c => c.name === "Fixed")!.constantSumGroup).toBeUndefined();
        expect(out.find(c => c.name === "A")!.constantSumGroup).toBeUndefined();
    });

    it("prefers the LARGEST qualifying set", () => {
        // Four parts summing to 100. A three-of-the-four subset must not be reported in place
        // of the whole split.
        const cols = [col("K", "String"), col("A", "Double", true), col("B", "Double", true),
                      col("C", "Double", true), col("D", "Double", true)];
        const rows: any[][] = [];
        for (let i = 0; i < 20; i++) {
            const a = 10 + (i * 3) % 30, b = 15 + (i * 5) % 25, c = 20 + (i * 7) % 20;
            rows.push([`K${i}`, a, b, c, 100 - a - b - c]);
        }
        const g = profile(cols, rows).find(x => x.name === "A")!.constantSumGroup;
        expect(g).toBeDefined();
        expect(g!.columns.length, "a four-part split must report all four").toBe(4);
    });

    it("is computed at every privacy tier - shape is not a value", () => {
        // The group names columns the consumer already has, a ratio, and one aggregate over
        // three or more columns. Nothing about it is recoverable as a single value, so the
        // tier that gates VALUES must not gate this.
        const cols = [col("Account", "String"), col("A", "Double", true),
                      col("B", "Double", true), col("C", "Double", true)];
        for (const tier of ["0", "10", "100"]) {
            const it = new IndexedText();
            it.setColumns(cols.map(c => ({ ...c })));
            for (const r of mixRows(20)) it.addRow(r);
            expect(it.getColumnsWithStats(tier).find(c => c.name === "A")!.constantSumGroup,
                `tier ${tier} must still carry the composition signal`).toBeDefined();
        }
    });
});
