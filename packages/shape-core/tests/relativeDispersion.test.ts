import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import { quantileSorted } from "../src/util";
import type { LLMColumnWithValue } from "../src/models";

// RELATIVE DISPERSION. (p90 - p10) / |median| over a measure's non-blank values. Taken by floor index, p10 over ten
// or fewer values is always the minimum and p90 is never the maximum, so two rows of ANY two numbers used to read 0
// and a consumer called a measure that plainly moves "constant". These tests pin interpolated quantiles, the exact 0
// for an identical run, and the statistic's absence where no 10th/90th percentile exists.
//
// Every row carries a distinct Grp value: IndexedText dedups identical rows by default.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

function rd(values: (number | string)[]): number | undefined {
    const t = new IndexedText();
    t.setColumns([col("Grp", "String"), col("Val", "Decimal", true)]);
    values.forEach((v, i) => t.addRow(["g" + i, v] as any));
    const c: any = t.getColumnsWithStats("10").find(x => x.name === "Val");
    return c?.relativeDispersion;
}

describe("relativeDispersion", () => {
    it("withholds the statistic for two values that differ", () => {
        expect(rd([1100, 1185])).toBeUndefined();
    });

    it("withholds it for three values - no percentile to speak of", () => {
        expect(rd([100, 100.5, 500])).toBeUndefined();
    });

    it("reports an exact 0 for an identical run, short or long", () => {
        expect(rd([5, 5])).toBe(0);
        expect(rd(Array.from({ length: 40 }, () => 7))).toBe(0);
    });

    it("interpolates from four values up", () => {
        // p10 = 13, p90 = 37, median = 25 -> 24 / 25
        expect(rd([10, 20, 30, 40])).toBe(0.96);
    });

    it("is unchanged where the percentile position is a whole index", () => {
        // 101 values 0..100: p10 = 10, p90 = 90, median = 50 -> 1.6, the same as the floor-index reading
        expect(rd(Array.from({ length: 101 }, (_, i) => i))).toBe(1.6);
    });

    it("counts a lone value that moves", () => {
        // nine zeros and one 10: p90 interpolates to 1, median 0 -> denominator falls back to |max| = 10
        expect(rd([0, 0, 0, 0, 0, 0, 0, 0, 0, 10])).toBe(0.1);
    });

    it("does not count blanks as values", () => {
        expect(rd([3, 9, 27, "", "", "", "", ""])).toBeUndefined();
    });

    it("shares one interpolated quantile helper", () => {
        expect(quantileSorted([], 0.5)).toBeNaN();
        expect(quantileSorted([4], 0.9)).toBe(4);
        expect(quantileSorted([10, 20, 30, 40], 0.1)).toBeCloseTo(13, 10);
    });
});
