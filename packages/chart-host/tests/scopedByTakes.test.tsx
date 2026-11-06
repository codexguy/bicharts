// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";
import { createFilter, filterScopeOf, ANY_VALUE } from "../src/filterScope";
import { treatAs } from "../src/dax";

// A PANEL'S SCOPE LINE NAMES ONLY THE KEY PARTS ITS QUERY TAKES. A Region x Stage pick narrows a cases chart whose query
// maps the region alone (treatAs(cell, REGION)): its rows are the region's, so its scope line says the region and not
// the stage. A stage-label pick (any region) doesn't narrow that query at all, so the panel says nothing. A scopedBy
// entry { filter, takes } names the key columns the query maps; a bare filter still names the whole key.

const REGION = "Accounts[Region]";

const cell = () => createFilter(["Region", "Stage"]);

describe("filterScopeOf with { filter, takes }", () => {
    it("a cell pick names only the region when the query takes only the region", () => {
        const f = cell();
        f.set([["Europe", "3-Propose"]], "click");
        expect(treatAs(f, REGION)).toBe(`TREATAS({"Europe"}, Accounts[Region])`);
        expect(filterScopeOf({ filter: f, takes: ["Region"] })).toEqual({ field: "Region", values: ["Europe"] });
    });

    it("a stage-label pick (any region) doesn't narrow a region-only query, so the panel says nothing", () => {
        const f = cell();
        f.set([[ANY_VALUE, "3-Propose"]], "click");
        expect(treatAs(f, REGION)).toBeNull();
        expect(filterScopeOf({ filter: f, takes: ["Region"] })).toBeUndefined();
        expect(filterScopeOf([{ filter: f, takes: ["Region"] }])).toBeUndefined();
    });

    it("a region-label pick (any stage) names the region", () => {
        const f = cell();
        f.set([["Europe", ANY_VALUE]], "click");
        expect(filterScopeOf({ filter: f, takes: ["Region"] })).toEqual({ field: "Region", values: ["Europe"] });
    });

    it("a pick that adds one any-region key beside a cell narrows nothing, as its query keeps every row", () => {
        const f = cell();
        f.set([["Europe", "3-Propose"], [ANY_VALUE, "4-Negotiate"]], "click");
        expect(treatAs(f, REGION)).toContain("TRUE()");
        expect(filterScopeOf({ filter: f, takes: ["Region"] })).toBeUndefined();
    });

    it("two cells in one region name it once", () => {
        const f = cell();
        f.set([["Europe", "3-Propose"], ["Europe", "4-Negotiate"], ["Asia", "1-Qualify"]], "click");
        expect(filterScopeOf({ filter: f, takes: ["Region"] })).toEqual({ field: "Region", values: ["Europe", "Asia"] });
    });

    it("without takes, or with every key column, it reads exactly as a bare filter", () => {
        const f = cell();
        f.set([["Europe", "3-Propose"]], "click");
        const bare = filterScopeOf(f);
        expect(bare).toEqual({ field: "Region / Stage", values: ["Europe → 3-Propose"] });
        expect(filterScopeOf({ filter: f })).toEqual(bare);
        expect(filterScopeOf({ filter: f, takes: ["Region", "Stage"] })).toEqual(bare);
        expect(filterScopeOf([{ filter: f }])).toEqual(bare);
    });

    it("reads the taken part's display column, keeps an explicit label, and takes a label of its own", () => {
        const f = createFilter(["RegionCode", "StageId"], { label: "Pipeline cell", display: ["RegionName", "StageName"] });
        f.selectRows([{ RegionCode: "EU", StageId: 3, RegionName: "Europe", StageName: "3-Propose" }], "click");
        expect(filterScopeOf({ filter: f, takes: ["RegionCode"] })).toEqual({ field: "Pipeline cell", values: ["Europe"] });
        expect(filterScopeOf({ filter: f, takes: ["RegionCode"], label: "Region" })).toEqual({ field: "Region", values: ["Europe"] });
        expect(filterScopeOf({ filter: f, takes: ["StageId"], label: "Stage" })).toEqual({ field: "Stage", values: ["3-Propose"] });
    });

    it("a key set by value with no row behind it reads as the taken value", () => {
        const f = createFilter(["RegionCode", "StageId"], { display: ["RegionName", "StageName"] });
        f.set([["EU", 3]]);
        expect(filterScopeOf({ filter: f, takes: ["RegionCode"] })).toEqual({ field: "RegionCode", values: ["EU"] });
    });

    it("mixes with bare filters in one list", () => {
        const f = cell();
        const year = createFilter("Year");
        f.set([["Europe", "3-Propose"]]);
        year.set([2024]);
        expect(filterScopeOf([{ filter: f, takes: ["Region"] }, year])).toEqual({ field: "Region, Year", values: ["Europe", "2024"] });
    });

    it("a column the filter isn't keyed by is said once and takes nothing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const f = cell();
            f.set([["Europe", "3-Propose"]]);
            expect(filterScopeOf({ filter: f, takes: ["Accounts[Region]"] })).toBeUndefined();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toMatch(/isn't keyed by Accounts\[Region\]/);
        } finally {
            warn.mockRestore();
        }
    });
});

// ── the React prop ──────────────────────────────────────────────────────────────

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PROBE = `
function render(container, data, options) {
  container.innerHTML = "";
  (container.__scopes = container.__scopes || []).push(options.filterScope);
}`;
const DATA = { columns: [{ name: "Region" }, { name: "Cases" }], rows: [["Europe", 1]] };

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

const lastScope = () => { const s = ((el.querySelector(".probe") as any).__scopes) as unknown[]; return s[s.length - 1]; };

describe("BicChart scopedBy={{ filter, takes }}", () => {
    it("names the region of a cell pick, and nothing for a stage-label pick", async () => {
        const f = cell();
        await act(async () => root.render(createElement(BicChart, {
            code: PROBE, d3: {}, data: DATA as any, className: "probe", scopedBy: { filter: f, takes: ["Region"] } })));
        expect(lastScope()).toBeUndefined();

        await act(async () => f.set([["Europe", "3-Propose"]], "click"));
        expect(lastScope()).toEqual({ field: "Region", values: ["Europe"] });

        await act(async () => f.set([[ANY_VALUE, "3-Propose"]], "click"));
        expect(lastScope()).toBeUndefined();
    });
});
