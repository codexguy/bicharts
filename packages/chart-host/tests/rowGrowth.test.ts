import { describe, it, expect } from "vitest";
import { rowGrowthNotice, ROW_GROWTH_MIN_RATIO, ROW_GROWTH_MIN_EXTRA } from "../src/rowGrowth";

// A chart written for 12 rows and redrawn on 12,311 paints thousands of sub-pixel marks with nothing on screen to say
// why. The rule is ratio AND extra: both thresholds must be met, so ordinary filtering and small refreshes stay silent.

describe("rowGrowthNotice", () => {
    it("says so when 12 rows became 12,311", () => {
        const n = rowGrowthNotice(12, 12311)!;
        expect(n).toMatchObject({ code: "row-growth", severity: "data", builtFor: 12, rendered: 12311, locationToken: "grow:12" });
        expect(n.text).toBe("Built for 12 rows, now showing 12,311 - Generate to rebuild it for this data.");
    });
    it("is silent for modest growth", () => {
        expect(rowGrowthNotice(12, 18)).toBeNull();
        expect(rowGrowthNotice(100, 999)).toBeNull();
    });
    it("needs BOTH the ratio and the extra rows", () => {
        expect(ROW_GROWTH_MIN_RATIO).toBe(10);
        expect(ROW_GROWTH_MIN_EXTRA).toBe(500);
        expect(rowGrowthNotice(60, 600)).not.toBeNull();   // exactly 10x and exactly 540 more
        expect(rowGrowthNotice(49, 500)).toBeNull();       // 10x but only 451 more
    });
    it("says '1 row' for a single row", () => {
        expect(rowGrowthNotice(1, 600)!.text).toBe("Built for 1 row, now showing 600 - Generate to rebuild it for this data.");
    });
    it("is silent when the built-for count is unknown or unusable", () => {
        for (const b of [null, undefined, 0, NaN, -5, Infinity]) expect(rowGrowthNotice(b as any, 12311)).toBeNull();
        for (const r of [null, undefined, 0, NaN, -5]) expect(rowGrowthNotice(12, r as any)).toBeNull();
    });
    it("points to a license when the reader cannot generate", () => {
        expect(rowGrowthNotice(12, 12311, { canGenerate: false })!.text)
            .toBe("Built for 12 rows, now showing 12,311 - enter a license to generate a chart for this data.");
    });
    it("lets a host format the counts", () => {
        expect(rowGrowthNotice(12, 12311, { formatCount: n => `#${n}` })!.text).toContain("Built for #12 rows, now showing #12311");
    });
});
