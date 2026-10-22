import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";

// THE SAME ROWS GIVE THE SAME PROFILE ON EVERY NODE VERSION. skewness divided by Math.pow(sd, 3), and Math.pow is not
// required to round exactly: V8's result for an integer exponent differs between versions (Node 20/22 and Node 24
// disagree in the last place on tens of thousands of inputs), so the published package profiled the same data
// differently depending on the reader's Node. Exact multiplication is IEEE arithmetic and identical everywhere.

describe("skewness is computed with exact arithmetic", () => {
    it("divides by sd*sd*sd, not Math.pow(sd, 3)", () => {
        // These values have a standard deviation where Math.pow(sd, 3) and sd*sd*sd differ in the last place.
        const values = [1, 2, 4, 8, 16, 3.5, 7.25];
        const idx = new IndexedText();
        idx.setColumns([{ name: "Id", dataType: "String", isMeasure: false }, { name: "V", dataType: "Decimal", isMeasure: true }] as any);
        values.forEach((v, k) => idx.addRow([`r${k}`, v], k));
        const c = idx.getColumnsWithStats("20").find(x => x.name === "V")!;
        const n = values.length, mean = values.reduce((a, b) => a + b, 0) / n;
        let m2 = 0, m3 = 0;
        for (const v of [...values].sort((a, b) => a - b)) { const d = v - (c.avgValue ?? mean); m2 += d * d; m3 += d * d * d; }
        const sd = Math.sqrt(m2 / n);
        expect(Math.pow(sd, 3)).not.toBe(sd * sd * sd);   // the fixture really does tell the two apart on this engine
        expect(c.skewness).toBe((m3 / n) / (sd * sd * sd));
    });
});
