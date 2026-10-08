import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// THE PRIVACY TIER GATES VALUES, NEVER SHAPE. Four signals are opaque to every
// source value - ValueNature (an enum), DistinctCount (a count), FormatSignature (an enum) and IsFreeText
// (a boolean) - and they were computed inside the pl >= 10 / pl >= 20 gates, so a report at a lower tier
// sent a shape the server could not read: Funnel / Waterfall / Radar stayed unreachable
// because a stage count cannot be invented from a count nobody sent. They now ship at EVERY tier; what
// a source value survives into (low / high / median, top values, ordered domains, safe short codes)
// stays exactly where it was.
const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue => ({ name, dataType, isMeasure });

function stats(pl: string) {
    const t = new IndexedText();
    t.setColumns([col("Stage", "String"), col("Customer Email", "String"), col("OrderDate", "DateTime"),
                  col("Revenue", "Decimal", true)]);
    const stages = ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won"];
    for (let i = 0; i < 20; i++) {
        t.addRow([stages[i % 5], `buyer${i}@example.com`, new Date(2026, 0, 1 + i), 1000 + i * 37.5]);
    }
    const out = t.getColumnsWithStats(pl);
    return (name: string) => out.find(c => c.name === name)!;
}

describe("the four opaque shape signals ship at every privacy tier", () => {
    const top = stats("20");
    for (const pl of ["0", "10"]) {
        it(`ValueNature and DistinctCount at privacy level ${pl}, as at 20`, () => {
            const s = stats(pl);
            for (const name of ["Stage", "Customer Email", "OrderDate", "Revenue"]) {
                expect(s(name).valueNature, `${name}.valueNature`).toBe(top(name).valueNature);
                expect(s(name).distinctCount, `${name}.distinctCount`).toBe(top(name).distinctCount);
            }
            expect(s("Stage").distinctCount).toBe(5);
            expect(s("OrderDate").valueNature).toBe("Ordinal");
            expect(s("Revenue").valueNature).toBe("Continuous");
        });

        it(`FormatSignature and IsFreeText at privacy level ${pl}, as at 20`, () => {
            const s = stats(pl);
            for (const name of ["Stage", "Customer Email"]) {
                expect(s(name).formatSignature, `${name}.formatSignature`).toBe(top(name).formatSignature);
                expect(s(name).isFreeText, `${name}.isFreeText`).toBe(top(name).isFreeText);
            }
            expect(s("Stage").formatSignature).toBeTruthy();
            expect(s("Stage").isFreeText).toBe(true);
            expect(s("Customer Email").formatSignature).toBe("EMAIL_LIKE");
            expect(s("Customer Email").isFreeText).toBeUndefined();
        });

        it(`the tier still withholds what a value survives into, at privacy level ${pl}`, () => {
            const s = stats(pl);
            const r = s("Revenue");
            expect(r.lowValue).toBeUndefined();
            expect(r.highValue).toBeUndefined();
            expect(r.medianValue).toBeUndefined();
            expect(r.avgValue).toBeUndefined();
            const st = s("Stage") as any;
            expect(st.avgLength).toBeUndefined();
            expect(st.topCategoryValues).toBeUndefined();
            expect(st.orderedDomain).toBeUndefined();
            expect(st.safeDistinctValues).toBeUndefined();
            expect((s("OrderDate") as any).topCategoryValues).toBeUndefined();
        });
    }

    it("blankCount stays a level-10 statistic (it was never one of the four)", () => {
        expect(stats("0")("Stage").blankCount).toBeUndefined();
        expect(stats("10")("Stage").blankCount).toBe(0);
    });
});
