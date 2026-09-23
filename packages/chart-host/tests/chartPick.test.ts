import { describe, it, expect } from "vitest";
import { reconcileChartPick } from "../src/chartPick";

const MENU = ["Bar chart", "Sunburst", "Gantt chart"];

describe("reconcileChartPick - the one case a standing pick is dropped for the reader", () => {
    it("keeps a pick the fresh list still offers, case-insensitively, in the reader's spelling", () => {
        expect(reconcileChartPick("Sunburst", MENU, "Auto")).toEqual({ pick: "Sunburst", dropped: false, message: "" });
        expect(reconcileChartPick(" gantt chart ", MENU, "Auto")).toEqual({ pick: "gantt chart", dropped: false, message: "" });
    });

    it("drops a pick the data no longer supports, and says so", () => {
        const r = reconcileChartPick("Sankey", MENU, "Visual chooses");
        expect(r.pick).toBe("");
        expect(r.dropped).toBe(true);
        expect(r.message).toBe('Sankey no longer fits this selection, so the chart type is back to "Visual chooses". Pick another from the list if you want to force one.');
    });

    it("an empty list is not evidence the pick died", () => {
        expect(reconcileChartPick("Sunburst", [], "Auto")).toEqual({ pick: "Sunburst", dropped: false, message: "" });
        expect(reconcileChartPick("Sunburst", ["", null, undefined], "Auto").dropped).toBe(false);
    });

    it("says nothing when there was no pick", () => {
        expect(reconcileChartPick("", MENU, "Auto")).toEqual({ pick: "", dropped: false, message: "" });
        expect(reconcileChartPick(null, MENU, "Auto")).toEqual({ pick: "", dropped: false, message: "" });
    });
});
