import { describe, it, expect } from "vitest";
import {
    filterQualifyRows, readQualifyChartRow, computeQualifyFilterView, normalizeFilterTerm,
    DEFAULT_FILTER_MATCH_STYLE, filterMatchStyleOf, type QualifyFilterGroup,
} from "../src/qualifyFilter";
import { reconcileChartPick } from "../src/chartPick";

// A CHART NAME IS A KNOWN NAME, and a known name matches loosely: accents, case, spaces and
// punctuation folded away. The filter box does that by default and keeps the older exact style
// for a reader who chooses it; a standing pick is reconciled the same way.

const CHARTS = [
    { name: "Bar chart", description: "One bar per category, length encoding the measure." },
    { name: "Time series plot", description: "A line over an ordered date axis." },
    { name: "Stacked bar chart", description: "Bars split into parts." },
    { name: "Heatmap", description: "A grid shaded to show the pattern across two categories." },
    { name: "Box plot", description: "Quartiles per category." },
];
const names = <T extends { name?: string | null }>(rows: T[]) => rows.map(r => r.name);

describe("the filter box matches loosely by default", () => {
    it("the default style is loose, and only 'exact' selects the exact style", () => {
        expect(DEFAULT_FILTER_MATCH_STYLE).toBe("loose");
        expect(filterMatchStyleOf("exact")).toBe("exact");
        expect(filterMatchStyleOf(" EXACT ")).toBe("exact");
        for (const v of [undefined, null, "", "loose", "strict", 1]) expect(filterMatchStyleOf(v)).toBe("loose");
    });

    it.each(["barchart", "bar-chart", "Bar_Chart", "BARCHART", "bär chart"])(
        "%j finds Bar chart and Stacked bar chart at a word start", (term) => {
            const r = filterQualifyRows(CHARTS, term, readQualifyChartRow);
            expect(names(r.rows)).toEqual(["Bar chart", "Stacked bar chart"]);
            expect(r.tier).toBe("name");
        });

    it("the term handed back is the exact form, for the host to show", () => {
        expect(filterQualifyRows(CHARTS, "Bar-Chart", readQualifyChartRow).term).toBe("bar-chart");
    });

    it("a loose hit counts only where it starts a word", () => {
        // "terna" sits inside "patTERN Across" once the description's spaces are squeezed out;
        // that is a match the reader never typed.
        expect(filterQualifyRows(CHARTS, "terna", readQualifyChartRow).tier).toBe("none");
        // and "archart" is inside "bARCHART" mid-word: not a loose hit either.
        expect(filterQualifyRows(CHARTS, "archart", readQualifyChartRow).tier).toBe("none");
    });

    it("everything the exact form found at a word start is still found", () => {
        for (const term of ["bar", "bar ch", "box", "time", "heat"]) {
            const exact = filterQualifyRows(CHARTS, term, readQualifyChartRow, "exact");
            const loose = filterQualifyRows(CHARTS, term, readQualifyChartRow);
            expect([term, loose.tier, names(loose.rows)]).toEqual([term, exact.tier, names(exact.rows)]);
        }
    });
});

describe("the exact style is today's behaviour", () => {
    it.each(["barchart", "bar-chart"])("%j does NOT find Bar chart under the exact style", (term) => {
        const r = filterQualifyRows(CHARTS, term, readQualifyChartRow, "exact");
        expect(r.rows).toEqual([]);
        expect(r.tier).toBe("none");
    });

    it("the exact form still keeps the space", () => {
        expect(normalizeFilterTerm("barchart")).not.toBe(normalizeFilterTerm("bar chart"));
    });

    it("computeQualifyFilterView passes the style through", () => {
        const groups: QualifyFilterGroup<string>[] = [{
            heading: null, section: "fits",
            rows: CHARTS.map(c => ({ el: c.name, name: c.name, description: c.description })),
        }];
        expect(computeQualifyFilterView(groups, "barchart").matched).toBe(2);
        expect(computeQualifyFilterView(groups, "barchart", "exact").matched).toBe(0);
        expect(computeQualifyFilterView(groups, "barchart", "exact").note).toBe("noMatch");
    });
});

describe("reconcileChartPick compares exact, then loose", () => {
    const MENU = ["Bar chart", "Sunburst", "Gantt chart"];

    it("a pick saved in another spelling is still offered, in the offered spelling", () => {
        expect(reconcileChartPick("Bar-Chart", MENU, "Auto")).toEqual({ pick: "Bar chart", dropped: false, message: "" });
        expect(reconcileChartPick("barchart", MENU, "Auto")).toEqual({ pick: "Bar chart", dropped: false, message: "" });
    });

    it("an exact (case-insensitive) hit keeps the reader's own spelling, as before", () => {
        expect(reconcileChartPick("bar chart", MENU, "Auto")).toEqual({ pick: "bar chart", dropped: false, message: "" });
    });

    it("a loose key two offered names share names neither", () => {
        const r = reconcileChartPick("barchart", ["Bar chart", "Barchart"], "Auto");
        // "barchart" is an EXACT hit on the second, so that answers first...
        expect(r).toEqual({ pick: "barchart", dropped: false, message: "" });
        // ...and a spelling that only the loose key reaches, with two candidates, is dropped.
        const r2 = reconcileChartPick("bar-chart", ["Bar chart", "Bar–chart"], "Auto");
        expect(r2.dropped).toBe(true);
    });
});
