import { describe, it, expect } from "vitest";
import { resolveOptions } from "../src/defaults";
import { HOST_CONTRACT_VERSION } from "../src/contract";
import * as pkg from "../src/index";
import * as page from "../src/page";
import { createFilter } from "../src/filterScope";

// THE PAGE FILTER THAT NARROWED A CHART'S ROWS BEFORE THEY ARRIVED (contract 1.23.0). A KPI deck whose query takes the
// picked country kept its region title over one country's totals, and its "rank" and "vs avg of n" compared what the
// filter left, with nothing on screen to say so. The chart can't see a filter applied to its query; the host can, and
// tells it as options.filterScope { field, values, label? }, which a chart turns into "North America · United States
// only" and "rank 2 of 3 (United States only)".

describe("the contract", () => {
    it("is announced from 1.23.0 on", () => {
        const [major, minor] = HOST_CONTRACT_VERSION.split(".").map(Number);
        expect(major).toBe(1);
        expect(minor).toBeGreaterThanOrEqual(23);
        expect(typeof (pkg as any).cleanFilterScope).toBe("function");
        expect(typeof (page as any).filterScopeOf).toBe("function");
    });
});

describe("resolveOptions passes the fact through cleaned", () => {
    it("keeps a fact as the host gave it", () => {
        expect(resolveOptions({ filterScope: { field: "Country", values: ["United States"] } }).filterScope)
            .toEqual({ field: "Country", values: ["United States"] });
        expect(resolveOptions({ filterScope: { field: "Country", values: ["Canada", "Mexico"], label: "the two neighbours" } }).filterScope)
            .toEqual({ field: "Country", values: ["Canada", "Mexico"], label: "the two neighbours" });
    });

    it("is absent when nothing narrows: no fact, junk, or no value left", () => {
        expect(resolveOptions({}).filterScope).toBeUndefined();
        for (const junk of [null, 3, "Country", [], true, { field: "Country" }, { field: "Country", values: [] },
                            { field: "Country", values: "United States" }, { field: "Country", values: [null, "", "  ", {}] }])
            expect(resolveOptions({ filterScope: junk }).filterScope, JSON.stringify(junk)).toBeUndefined();
    });

    it("trims, drops blanks and repeats, reads a number as text, and drops a blank label or a field that is not text", () => {
        expect(resolveOptions({ filterScope: { field: " Country ", values: [" Japan ", "Japan", "", null, 2024], label: "  " } }).filterScope)
            .toEqual({ field: "Country", values: ["Japan", "2024"] });
        expect(resolveOptions({ filterScope: { field: 7, values: ["Japan"] } }).filterScope).toEqual({ field: "", values: ["Japan"] });
    });
});

describe("filterScopeOf: the fact from the page's own filters", () => {
    it("says nothing while no filter is active", () => {
        const f = createFilter("RegionCode", { label: "Country", display: "Country" });
        expect(page.filterScopeOf(f)).toBeUndefined();
        expect(page.filterScopeOf([f])).toBeUndefined();
        expect(page.filterScopeOf(undefined)).toBeUndefined();
        expect(page.filterScopeOf([])).toBeUndefined();
    });

    it("names the filter by its label and its values by what a chip shows", () => {
        const f = createFilter("RegionCode", { label: "Country", display: "Country" });
        f.selectRows([{ RegionCode: "USA", Country: "United States" }], "click");
        expect(page.filterScopeOf(f)).toEqual({ field: "Country", values: ["United States"] });
        f.set(["USA", "CAN"]);   // a key set by value, with no row behind it, reads as its value
        expect(page.filterScopeOf(f)).toEqual({ field: "Country", values: ["United States", "CAN"] });
    });

    it("an unlabeled filter is named by its columns, and every active filter of a list counts", () => {
        const country = createFilter("Country");
        const year = createFilter("Year");
        const idle = createFilter("Segment");
        country.set(["Japan"]);
        year.set([2024]);
        expect(page.filterScopeOf([country, year, idle])).toEqual({ field: "Country, Year", values: ["Japan", "2024"] });
    });
});
