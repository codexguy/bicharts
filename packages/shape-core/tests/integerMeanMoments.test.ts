import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";

// AN INTEGER COLUMN'S SPREAD AND SKEW ARE MEASURED ABOUT ITS TRUE MEAN. avgValue is rounded for an Integer column (it is a
// display value), and taking the second and third moments about that rounded number inflates both the spread and the skew
// of a small-mean integer. 229 weights of 0, 1 and 4 have a true mean of 242/229 (about 1.057): about 1 the skewness came
// out 1.351, about the true mean it is 1.242. A Decimal column's avgValue is already the true mean, so it must not move.

const multiset = (): number[] => {
    const v: number[] = [];
    for (let k = 0; k < 125; k++) v.push(0);
    for (let k = 0; k < 58; k++) v.push(1);
    for (let k = 0; k < 46; k++) v.push(4);
    return v;
};

const profile = (values: number[], dataType: "Integer" | "Decimal") => {
    const idx = new IndexedText();
    idx.setColumns([{ name: "Id", dataType: "String", isMeasure: false }, { name: "W", dataType, isMeasure: true }] as any);
    values.forEach((v, k) => idx.addRow([`r${k}`, v], k));
    return idx.getColumnsWithStats("20").find(x => x.name === "W")!;
};

const momentsAbout = (values: number[], mean: number) => {
    const n = values.length;
    let m2 = 0, m3 = 0;
    for (const v of [...values].sort((a, b) => a - b)) { const d = v - mean; m2 += d * d; m3 += d * d * d; }
    const sd = Math.sqrt(m2 / n);
    return { sd, skew: (m3 / n) / (sd * sd * sd) };
};

describe("an Integer column's spread and skew are measured about its true mean", () => {
    it("takes the moments about the unrounded mean and still shows the rounded one", () => {
        const values = multiset();
        expect(values.length).toBe(229);
        const c = profile(values, "Integer");
        expect(c.avgValue).toBe(1);                                   // still rounded for display
        const exact = momentsAbout(values, 242 / 229);
        expect(Math.abs((c.stdDev as number) - exact.sd)).toBeLessThan(1e-12);
        expect(Math.abs((c.skewness as number) - exact.skew)).toBeLessThan(1e-12);
        expect(exact.skew).toBeCloseTo(1.24243, 4);
        // the value measured about the rounded mean is not what comes out
        expect(Math.abs((c.skewness as number) - 1.35079)).toBeGreaterThan(0.05);
    });

    it("leaves a Decimal column of the same values bit-identical", () => {
        const values = multiset();
        const c = profile(values, "Decimal");
        const same = momentsAbout(values, c.avgValue as number);
        expect(c.stdDev).toBe(same.sd);
        expect(c.skewness).toBe(same.skew);
    });
});
