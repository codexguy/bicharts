import { describe, it, expect } from "vitest";
import { classifyNumericValueNature, IndexedText, promotesToMeasure } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// Rule (b) of the numeric classifier reads a DENSE RUN OF WHOLE NUMBERS in 0..20 as an ordered axis. Its density
// test (distinct / (max - min + 1)) only means "consecutive" for whole numbers: a column of decimal rates bound as
// a field passes it easily (115 values in 0..13.2 score 8.1), so it was stamped Ordinal, the measure inference
// never promoted it, and the shape went out with no measure at all. On the promotion path only, a column holding
// any fractional value is not an axis by rule (b). Bound measures and every other stamp keep rule (b) as before.

const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue => ({ name, dataType, isMeasure });
// 115 distinct two-decimal values in 0..13.2 spread over 129 rows under 7 labels: a rate bound as a field.
const RATES = Array.from({ length: 115 }, (_, k) => Math.round(k * 13.2 / 114 * 100) / 100);
const RATES_129 = [...RATES, ...RATES.slice(0, 14)];

function build(values: number[], dataType = "Decimal", isMeasure = false, declare = false): IndexedText {
    const t = new IndexedText();
    const cols = [col("Variety", "String"), col("Yield", dataType, isMeasure)];
    t.setColumns(cols);
    if (declare) t.declareDimensions([cols[1]]);
    values.forEach((v, k) => t.addRow([`V${k % 7}`, v], k));
    return t;
}
const profile = (values: number[], dataType = "Decimal", isMeasure = false, declare = false) =>
    build(values, dataType, isMeasure, declare).getColumnsWithStats("20").find(c => c.name === "Yield")!;

describe("a fractional column is not a consecutive-integer axis on the promotion path", () => {
    it("115 decimal values in 0..13.2 bound as a field are promoted to a Continuous measure", () => {
        const c = profile(RATES_129);
        expect(c.isMeasure).toBe(true);
        expect(c.valueNature).toBe("Continuous");
    });

    it("the classifier skips rule (b) for a fractional column only when the promotion path asks", () => {
        const base = { dataType: "Decimal", isMeasure: false, name: "Yield", distinct: 115, nonblank: 129, prec: 2, minval: 0, maxval: 13.2 };
        expect(classifyNumericValueNature(base)).toBe("Ordinal");
        expect(classifyNumericValueNature({ ...base, ordinalNeedsWholeNumbers: true })).toBe("Continuous");
    });

    it("promotesToMeasure, the verdict every host shares, promotes the fractional column", () => {
        expect(promotesToMeasure(col("Yield", "Decimal"), false,
            { distinct: 115, nonblank: 129, prec: 2, minval: 0, maxval: 13.2 })).toBe(true);
    });

    it("the render-time flags equal the shape: inferredMeasureFlags promotes it too", () => {
        expect(build(RATES_129).inferredMeasureFlags()).toEqual([false, true]);
    });

    it("seven decimal values stay a dimension: twelve or fewer distinct values are not promoted", () => {
        const c = profile([0.92, 1.36, 1.43, 1.91, 1.97, 2.19, 1.1]);
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).toBe("Ordinal");
    });

    it("whole numbers keep the ordered-axis reading, even typed Decimal", () => {
        const c = profile(Array.from({ length: 21 }, (_, k) => k));
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).toBe("Ordinal");
    });

    it("a bound measure is untouched: a fractional measure in 0..20 keeps the Ordinal stamp", () => {
        expect(profile(RATES_129, "Decimal", true).valueNature).toBe("Ordinal");
    });

    it("a column the caller declared a dimension is never promoted", () => {
        const c = profile(RATES_129, "Decimal", false, true);
        expect(c.isMeasure).toBe(false);
        expect(c.valueNature).toBe("Ordinal");
    });
});
