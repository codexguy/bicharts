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

    it("never reports a lone value that moves as flat", () => {
        // nine zeros and one 10: the median is 0, so there is no denominator for a RELATIVE spread. The old
        // fallback divided by |max| and reported 0.1 - "nearly flat" - for a measure that moves. It is now
        // withheld: absent is "not measured", and no consumer may read it as flat.
        expect(rd([0, 0, 0, 0, 0, 0, 0, 0, 0, 10])).toBeUndefined();
    });

    it("withholds the statistic for a zero-inflated measure with a long tail", () => {
        // A stock measure: zero on most rows, a spread of real quantities on the rest. Median 0.
        // The max fallback read this as ~0 - "effectively constant" - which it plainly is not.
        const values = [
            ...Array.from({ length: 84 }, () => 0),
            12, 40, 75, 120, 300, 640, 1200, 2500, 4800, 7200, 9000, 12000, 15500, 21000, 30000, 48000,
        ];
        expect(rd(values)).toBeUndefined();
    });

    it("still reports an exact 0 for an all-zero run", () => {
        expect(rd(Array.from({ length: 30 }, () => 0))).toBe(0);
    });

    it("is unchanged where the median is not zero", () => {
        // median 0.5 of a mostly-zero-and-one column: the ratio still stands
        expect(rd([0, 0, 0, 0, 0, 1, 1, 1, 1, 1])).toBe(2);
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
