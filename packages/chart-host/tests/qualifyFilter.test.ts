import { describe, it, expect } from "vitest";
import {
    normalizeFilterTerm, filterQualifyRows, readQualifyChartRow, readQualifyRefusalRow,
    filterFitsChooser, listNeedsFilter, qualifyFilterGate, inlineFilterGate,
    computeQualifyFilterView, qualifyFilterCountText, type QualifyFilterGroup,
    FILTER_MIN_TERM_CHARS, FILTER_ROW_PX, FILTER_MIN_WIDTH_PX, FILTER_MIN_HEIGHT_PX,
    INLINE_FILTER_MIN_ROWS,
} from "../src/qualifyFilter";

// A slice of the real catalogue, in the order the server would send it (picker score, best
// first). The ranks are deliberately non-contiguous in places: a filtered view showing 1., 4., 9.
// is the correct output, and the tests below pin exactly that.
const CHARTS = [
    { name: "Bar chart", description: "One bar per category, length encoding the measure." },
    { name: "Time series plot", description: "A line over an ordered date axis." },
    { name: "Gantt chart", description: "One horizontal bar per task spanning its start and end dates on a time axis." },
    { name: "Stacked area chart", description: "Cumulative bands over time." },
    { name: "Sankey diagram", description: "Flows between stages, width proportional to volume." },
    { name: "Organization chart", description: "A hierarchy drawn as a tree of boxes." },
    { name: "Choropleth map", description: "Regions shaded by value." },
    { name: "Pair plot (scatter matrix)", description: "Every numeric pair as its own panel." },
];

const names = <T extends { name?: string | null }>(rows: T[]) => rows.map(r => r.name);

describe("normalizeFilterTerm", () => {
    it("lower-cases, trims and collapses internal whitespace", () => {
        expect(normalizeFilterTerm("  Bar   CHART ")).toBe("bar chart");
    });

    it("folds accents so a dead-key spelling matches the plain one", () => {
        // The two spellings below DIFFER on the wire and are indistinguishable in an editor:
        // composed U+00E1, versus a plain a followed by the combining acute U+0301, which is
        // what a dead key actually produces. Both have to reduce to the same ASCII.
        expect(normalizeFilterTerm("Sánkey")).toBe("sankey");
        expect(normalizeFilterTerm("Sánkey")).toBe("sankey");
        expect(normalizeFilterTerm("Sánkey")).toBe(normalizeFilterTerm("Sankey"));
    });

    it("does NOT strip the space, so 'barchart' is not 'bar chart'", () => {
        // Deliberate: a reader who omits the space is asking for a name we do not carry, and
        // silently succeeding there makes the failures inexplicable.
        expect(normalizeFilterTerm("barchart")).not.toBe(normalizeFilterTerm("bar chart"));
    });

    it("treats null, undefined and empty alike", () => {
        expect(normalizeFilterTerm(null)).toBe("");
        expect(normalizeFilterTerm(undefined)).toBe("");
        expect(normalizeFilterTerm("   ")).toBe("");
    });
});

describe("filterQualifyRows - the tier rule", () => {
    it("'gan' finds the Gantt chart and NOTHING else - the item's own acceptance case", () => {
        // AND THIS IS THE TEST THAT EARNED THE WORD-START TIER. Plain substring also returns
        // `Organization chart`, because "gan" sits inside "or-GAN-ization". Technically obedient,
        // practically a failure: a reader who gets an org chart back from "gan" stops trusting
        // the box. Tier 1 asks for a WORD start, and the mid-word hit is suppressed while any
        // word-start hit exists.
        const r = filterQualifyRows(CHARTS, "gan", readQualifyChartRow);
        expect(names(r.rows)).toEqual(["Gantt chart"]);
        expect(r.tier).toBe("name");
    });

    it("falls to the mid-word tier only when no name STARTS with the term", () => {
        // "eth" is unreachable from a word start - it is buried in "Chorop-ETH". With no tier-1
        // hit anywhere, tier 2 answers rather than dropping the reader straight to descriptions.
        const r = filterQualifyRows(CHARTS, "eth", readQualifyChartRow);
        expect(names(r.rows)).toEqual(["Choropleth map"]);
        expect(r.tier).toBe("namePart");
    });

    it("matches a word start after punctuation, not just after a space", () => {
        // The catalogue punctuates with parentheses and hyphens as well as spaces.
        const r = filterQualifyRows(CHARTS, "scatter", readQualifyChartRow);
        expect(names(r.rows)).toEqual(["Pair plot (scatter matrix)"]);
        expect(r.tier).toBe("name");
    });

    it("handles a MULTI-WORD term with no extra case", () => {
        const r = filterQualifyRows(CHARTS, "bar ch", readQualifyChartRow);
        expect(names(r.rows)).toEqual(["Bar chart"]);
        expect(r.tier).toBe("name");
    });

    it("a NAME match suppresses every description match", () => {
        // "time" is in one NAME and in two descriptions. A flat name-or-description match would
        // return three rows and read as broken; tier 1 winning outright is the whole design.
        const r = filterQualifyRows(CHARTS, "time", readQualifyChartRow);
        expect(names(r.rows)).toEqual(["Time series plot"]);
        expect(r.tier).toBe("name");
    });

    it("falls back to descriptions ONLY when no name matches, and says which tier answered", () => {
        const r = filterQualifyRows(CHARTS, "hierarchy", readQualifyChartRow);
        expect(names(r.rows)).toEqual(["Organization chart"]);
        expect(r.tier).toBe("desc");
    });

    it("reports 'none' rather than an empty 'name' tier", () => {
        const r = filterQualifyRows(CHARTS, "zzz", readQualifyChartRow);
        expect(r.rows).toEqual([]);
        expect(r.tier).toBe("none");
    });
});

describe("filterQualifyRows - order is never touched", () => {
    it("preserves input order exactly in the name tier", () => {
        const r = filterQualifyRows(CHARTS, "chart", readQualifyChartRow);
        // Every one of these is a word-start hit ("... chart"), so they are one tier and the
        // server's order is the only thing deciding their sequence.
        expect(names(r.rows)).toEqual(["Bar chart", "Gantt chart", "Stacked area chart", "Organization chart"]);
    });

    it("preserves input order exactly in the description tier", () => {
        const r = filterQualifyRows(CHARTS, "per ", readQualifyChartRow);
        // Both are description hits; the input order (Bar before Gantt) survives.
        expect(names(r.rows)).toEqual(["Bar chart", "Gantt chart"]);
        expect(r.tier).toBe("desc");
    });

    it("never re-sorts, even when a later row is a 'better' match", () => {
        // "chart" is a whole word in row 6's name and a suffix in row 1's. A search would float
        // the exact-ish hit; a FILTER must not, because the order is the server's ranking.
        const r = filterQualifyRows(CHARTS, "chart", readQualifyChartRow);
        expect(r.rows[0].name).toBe("Bar chart");
    });
});

describe("filterQualifyRows - degenerate inputs", () => {
    it("returns the input untouched below the minimum term length", () => {
        const r = filterQualifyRows(CHARTS, "g", readQualifyChartRow);
        expect(r.rows).toHaveLength(CHARTS.length);
        expect(r.tier).toBe("all");
        expect(r.term).toBe("");
        expect(FILTER_MIN_TERM_CHARS).toBe(2);
    });

    it("an empty or whitespace term is the identity", () => {
        for (const t of ["", "   ", null, undefined]) {
            const r = filterQualifyRows(CHARTS, t, readQualifyChartRow);
            expect(names(r.rows)).toEqual(names(CHARTS));
            expect(r.tier).toBe("all");
        }
    });

    it("drops rows with no name from BOTH tiers - an unlabelled row cannot be chosen", () => {
        const rows = [{ name: "", description: "gantt-like thing" }, { name: null, description: "gan" }];
        const r = filterQualifyRows(rows, "gan", readQualifyChartRow);
        expect(r.rows).toEqual([]);
        expect(r.tier).toBe("none");
    });

    it("survives a null/undefined row array", () => {
        expect(filterQualifyRows(null, "gan", readQualifyChartRow).rows).toEqual([]);
        expect(filterQualifyRows(undefined, "gan", readQualifyChartRow).rows).toEqual([]);
    });

    it("does not mutate the caller's array", () => {
        const src = CHARTS.slice();
        filterQualifyRows(src, "chart", readQualifyChartRow);
        expect(src).toHaveLength(CHARTS.length);
    });
});

describe("filterQualifyRows - the SAME function over refusal rows", () => {
    const REFUSED = [
        { name: "Arc diagram", reason: "an Arc diagram needs at least 2 category fields, and this data has 1 (Region)." },
        { name: "Gantt chart", reason: "a Gantt chart needs a start and an end date, and this data has 1 date (OrderDate)." },
        { name: "Choropleth", reason: "" },
    ];

    it("matches a refused name", () => {
        const r = filterQualifyRows(REFUSED, "gan", readQualifyRefusalRow);
        expect(names(r.rows)).toEqual(["Gantt chart"]);
        expect(r.tier).toBe("name");
    });

    it("searches the gate's SENTENCE as the second field, so a column name finds its refusals", () => {
        const r = filterQualifyRows(REFUSED, "region", readQualifyRefusalRow);
        expect(names(r.rows)).toEqual(["Arc diagram"]);
        expect(r.tier).toBe("desc");
    });

    it("a row with no reason is still matchable by name", () => {
        const r = filterQualifyRows(REFUSED, "chorop", readQualifyRefusalRow);
        expect(names(r.rows)).toEqual(["Choropleth"]);
    });
});

describe("the size gate", () => {
    it("holds at the measured floor and fails one step under it, in both dimensions", () => {
        expect(filterFitsChooser(FILTER_MIN_WIDTH_PX, FILTER_MIN_HEIGHT_PX)).toBe(true);
        expect(filterFitsChooser(FILTER_MIN_WIDTH_PX - 1, FILTER_MIN_HEIGHT_PX)).toBe(false);
        expect(filterFitsChooser(FILTER_MIN_WIDTH_PX, FILTER_MIN_HEIGHT_PX - 1)).toBe(false);
    });

    it("is STRICTLY above the chooser's own floor - the box is a fourth pinned element", () => {
        // Pinned so that a future edit cannot quietly set the filter floor to the chooser's and
        // reintroduce the clipped control the sweep was run to prevent.
        expect(FILTER_MIN_WIDTH_PX).toBeGreaterThan(400);
        expect(FILTER_MIN_HEIGHT_PX).toBeGreaterThan(240);
    });

    it("refuses NaN and Infinity rather than passing them through", () => {
        // FALSE is the safe direction: a non-finite measurement is a broken read, and declining
        // lands the reader on the chooser they have today rather than on a control drawn against
        // a size nobody measured.
        expect(filterFitsChooser(Number.NaN, 999)).toBe(false);
        expect(filterFitsChooser(999, Number.POSITIVE_INFINITY)).toBe(false);
        expect(filterFitsChooser(Number.POSITIVE_INFINITY, 999)).toBe(false);
    });
});

describe("the overflow gate", () => {
    it("says no when the content comfortably fits", () => {
        expect(listNeedsFilter(100, 400)).toBe(false);
    });

    it("RESERVES the filter row's height - a list that overflows only once the box is inserted still counts", () => {
        // 380 of content in a 400 list does not scroll today, but inserting the 32px row leaves
        // 368 and it would. Without the reservation this is the flicker loop: show, overflow
        // disappears, hide, overflow returns.
        expect(380 > 400).toBe(false);
        expect(listNeedsFilter(380, 400)).toBe(true);
        expect(listNeedsFilter(400 - FILTER_ROW_PX, 400)).toBe(false);
        expect(listNeedsFilter(400 - FILTER_ROW_PX + 1, 400)).toBe(true);
    });

    it("refuses non-finite measurements", () => {
        expect(listNeedsFilter(Number.NaN, 400)).toBe(false);
        expect(listNeedsFilter(400, Number.NaN)).toBe(false);
    });
});

describe("qualifyFilterGate - both conditions, and the reason either way", () => {
    const big = { cardWidth: 800, cardHeight: 600 };

    it("shows when the card affords it AND the list overflows", () => {
        expect(qualifyFilterGate({ ...big, scrollHeight: 2000, clientHeight: 400 }))
            .toEqual({ show: true, why: "shown" });
    });

    it("names the SIZE as the reason, and checks it first", () => {
        // Small card AND a short list: the size is the reported reason, so the field telemetry
        // measures the floor rather than the list length.
        expect(qualifyFilterGate({ cardWidth: 300, cardHeight: 200, scrollHeight: 10, clientHeight: 400 }))
            .toEqual({ show: false, why: "too-small" });
    });

    it("names the OVERFLOW as the reason on a roomy card with a short list", () => {
        expect(qualifyFilterGate({ ...big, scrollHeight: 100, clientHeight: 400 }))
            .toEqual({ show: false, why: "no-overflow" });
    });
});

describe("inlineFilterGate - the add-in has no size clause, and that is the decision", () => {
    it("shows on a long list at ANY pane size, because a scrolling panel cannot clip", () => {
        expect(inlineFilterGate(40)).toEqual({ show: true, why: "shown" });
        expect(inlineFilterGate(INLINE_FILTER_MIN_ROWS)).toEqual({ show: true, why: "shown" });
    });

    it("still declines a short list - a filter over five rows is clutter in every host", () => {
        expect(inlineFilterGate(INLINE_FILTER_MIN_ROWS - 1)).toEqual({ show: false, why: "no-overflow" });
        expect(inlineFilterGate(0)).toEqual({ show: false, why: "no-overflow" });
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  THE FILTERED VIEW - the rules that MISLEAD silently when they drift, driven directly.
//
//  Element handles are plain strings here. The function never touches an element, only carries
//  it, which is exactly what makes the two hosts' `style.display` and `hidden` writes the only
//  difference between them.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const row = (el: string, name: string, description = "") => ({ el, name, description });

/** A dialog shaped like a real one: a preview block, the ranked main block, and a refusal block
 *  behind "Show all chart types". */
function dialog(): QualifyFilterGroup<string>[] {
    return [
        { heading: "h-preview", section: "fits", rows: [row("r-flow", "Flow map", "Origin to destination.")] },
        { heading: "h-main", section: "fits", rows: [
            row("r-bar", "Bar chart", "One bar per category."),
            row("r-line", "Line chart", "A value over an ordered axis."),
        ] },
        { heading: "h-refused-poor", section: "refused", rows: [row("r-gantt", "Gantt chart", "needs a start and an end date, and this data has 1 date (OrderDate).")] },
    ];
}

describe("computeQualifyFilterView", () => {
    it("shows everything and hides nothing when there is no term", () => {
        const v = computeQualifyFilterView(dialog(), "");
        expect(v.tier).toBe("all");
        expect(v.hide).toEqual([]);
        expect(v.hideHeadings).toEqual([]);
        expect(v.show).toEqual(["r-flow", "r-bar", "r-line", "r-gantt"]);
    });

    it("HIDES A HEADING THAT NOW INTRODUCES NOTHING, and keeps the one that still does", () => {
        // The rule that misleads when it drifts: a "New - in preview" heading over an empty gap
        // reads as a claim about the rows below it, which belong to a different block.
        const v = computeQualifyFilterView(dialog(), "bar");
        expect(v.show).toEqual(["r-bar"]);
        expect(v.showHeadings).toEqual(["h-main"]);
        expect(v.hideHeadings).toEqual(["h-preview", "h-refused-poor"]);
    });

    it("preserves render order in `show`, so a host writing it in sequence cannot reorder", () => {
        const v = computeQualifyFilterView(dialog(), "chart");
        expect(v.show).toEqual(["r-bar", "r-line", "r-gantt"]);
    });

    it("OPENS THE REFUSAL BLOCK when the term matches only down there, and says where it went", () => {
        const v = computeQualifyFilterView(dialog(), "gan");
        expect(v.matched).toBe(0);
        expect(v.refusalMatched).toBe(1);
        expect(v.openRefusals).toBe(true);
        expect(v.note).toBe("onlyRefusals");
        expect(v.show).toEqual(["r-gantt"]);
    });

    it("does NOT ask for the refusal block when something that FITS already matched", () => {
        // The block is the answer to "why isn't my chart here". With a fitting match on screen
        // that question has not been asked, and opening it would bury the answer that was.
        const v = computeQualifyFilterView(dialog(), "chart");
        expect(v.openRefusals).toBe(false);
    });

    it("goes back to false the moment the term stops needing it - the host restores from there", () => {
        // AUTO-EXPANSION IS AN OVERRIDE, NOT A SETTING. This is the transition each host has to
        // watch: true, then false, and the reader's own checkbox goes back to what they set.
        expect(computeQualifyFilterView(dialog(), "gan").openRefusals).toBe(true);
        expect(computeQualifyFilterView(dialog(), "ga").openRefusals).toBe(true);
        expect(computeQualifyFilterView(dialog(), "").openRefusals).toBe(false);
        expect(computeQualifyFilterView(dialog(), "bar").openRefusals).toBe(false);
    });

    it("announces the DESCRIPTION tier and nothing else", () => {
        expect(computeQualifyFilterView(dialog(), "origin").note).toBe("descFallback");
        expect(computeQualifyFilterView(dialog(), "bar").note).toBe("none");
        expect(computeQualifyFilterView(dialog(), "").note).toBe("none");
    });

    it("distinguishes 'nothing matched your term' from every other empty state", () => {
        const v = computeQualifyFilterView(dialog(), "zzzz");
        expect(v.note).toBe("noMatch");
        expect(v.show).toEqual([]);
        expect(v.hide).toHaveLength(4);
        // Every heading goes, including the refusal block's - there is nothing under any of them.
        expect(v.hideHeadings).toHaveLength(3);
    });

    it("counts the FITTING list only - the refusal block has its own answer", () => {
        const v = computeQualifyFilterView(dialog(), "chart");
        expect(v.total).toBe(3);
        expect(v.matched).toBe(2);
        expect(v.refusalMatched).toBe(1);
        expect(qualifyFilterCountText(v)).toBe("2 of 3");
        expect(qualifyFilterCountText(computeQualifyFilterView(dialog(), ""))).toBe("3");
    });

    it("survives a dialog with no groups at all", () => {
        const v = computeQualifyFilterView([], "gan");
        expect(v.show).toEqual([]);
        expect(v.openRefusals).toBe(false);
        expect(v.note).toBe("noMatch");
    });

    it("a group with a null heading contributes rows and no heading decision", () => {
        const v = computeQualifyFilterView(
            [{ heading: null, section: "fits", rows: [row("a", "Bar chart"), row("b", "Gantt chart")] }], "gan");
        expect(v.show).toEqual(["b"]);
        expect(v.showHeadings).toEqual([]);
        expect(v.hideHeadings).toEqual([]);
    });
});
