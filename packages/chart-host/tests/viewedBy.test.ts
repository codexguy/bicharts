// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createFilter } from "../src/filterScope";
import { viewOf } from "../src/react";
import { resolveOptions, cleanViewRows } from "../src/defaults";

// A CHART THAT MODELS ON EVERY ROW SHOWS ONLY THE ONES THE PAGE KEEPS (contract 1.26.0). A churn risk list rated only from
// the rows a joining-quarter pick left had too little follow-up to rate anyone. The page now hands it every customer and the
// pick beside them (BicChart's viewedBy): the chart is told which rows the pick keeps (options.viewRows) and what it keeps
// (options.viewScope), rates from every row and draws the kept ones.

const data = {
    columns: [{ name: "CustomerKey" }, { name: "Channel" }, { name: "Quarter" }],
    rows: [[1, "Web", "2023 Q2"], [2, "Partner", "2023 Q2"], [3, "Web", "2023 Q3"], [4, "Web", "2023 Q2"]],
};

describe("viewedBy: the rows a page's picks keep", () => {
    it("no pick: every row is in view (nothing is sent)", () => {
        const q = createFilter("Quarter");
        expect(viewOf([q], data)).toEqual({ rows: undefined, scope: undefined });
    });

    it("one pick keeps the rows that carry it, and says what it keeps", () => {
        const q = createFilter("Quarter", { label: "Start quarter" });
        q.set("2023 Q2");
        const v = viewOf([q], data);
        expect(v.rows).toEqual([0, 1, 3]);
        expect(v.scope).toEqual({ field: "Start quarter", values: ["2023 Q2"] });
    });

    it("two picks keep the rows passing both", () => {
        const q = createFilter("Quarter"), c = createFilter("Channel");
        q.set("2023 Q2"); c.set("Web");
        expect(viewOf([q, c], data).rows).toEqual([0, 3]);
    });

    it("a pick the rows can't carry is left out, not applied as 'keep nothing'", () => {
        const r = createFilter("Region");
        r.set("Europe");
        expect(viewOf([r], data).rows).toBeUndefined();
    });

    it("object rows work too", () => {
        const q = createFilter("Quarter");
        q.set("2023 Q3");
        const objs = { columns: data.columns, rows: data.rows.map(r => ({ CustomerKey: r[0], Channel: r[1], Quarter: r[2] })) };
        expect(viewOf([q], objs as any).rows).toEqual([2]);
    });

    it("the options carry viewRows and viewScope cleaned, and junk never becomes an empty view", () => {
        const o = resolveOptions({ viewRows: [3, 0, 1], viewScope: { field: "Start quarter", values: ["2023 Q2"] } } as any);
        expect(o.viewRows).toEqual([0, 1, 3]);
        expect(o.viewScope).toEqual({ field: "Start quarter", values: ["2023 Q2"] });
        expect(cleanViewRows([1, -2])).toBeUndefined();
        expect(cleanViewRows("0,1")).toBeUndefined();
        expect(cleanViewRows([])).toEqual([]);
        expect(resolveOptions({} as any).viewRows).toBeUndefined();
    });
});
