import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { censusHitBands, hitBandFlag, MIN_HIT_BAND_PX } from "../src/hitBands";
import { MARK_CLASS, ROW_IDX_ATTR } from "../src/contract";

// A HAIRLINE IS A MARK YOU CANNOT HIT.
//
// A `fill:none` path receives pointer events only on its painted stroke, so a 2px data line is
// a 2px click target: aim a few pixels off and the click reaches the bare <svg>, closest()
// returns null, and the chart cross-filters nothing while looking perfectly correct.
//
// Every case below is a shape generated code really produces. The three that must NOT count
// are the ones a looser first attempt got wrong, and they are why this census asks about WIDTH
// and INTENT rather than about `fill:'none'` alone:
//   - a Sankey link is fill:none and 10-40px wide, so it is already its own hit band;
//   - a decorative overlay declares itself inert with pointer-events:none;
//   - an untagged gridline was never a mark.

let dom: JSDOM;
let doc: Document;
let container: any;

function svg(tag: string, attrs: Record<string, string> = {}) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", tag) as any;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    container.appendChild(el);
    return el;
}

/** An ECDF step line as generated code writes it: tagged, fill:none, 2px, nothing widens it. */
function hairlineMark(d = "M0,0L10,10") {
    return svg("path", {
        d, fill: "none", stroke: "#2e86ab", "stroke-width": "2",
        class: `ecdf-line ${MARK_CLASS}`, [ROW_IDX_ATTR]: "0,1,2",
    });
}

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><svg id='c'></svg></body></html>");
    doc = dom.window.document as any;
    container = doc.getElementById("c");
});

describe("censusHitBands", () => {
    it("counts a thin tagged open stroke with no companion as uncovered", () => {
        hairlineMark();
        const c = censusHitBands(container, doc);
        expect(c.openStrokes).toBe(1);
        expect(c.interactive).toBe(1);
        expect(c.hairline).toBe(1);
        expect(c.uncovered).toBe(1);
        expect(hitBandFlag(c)).toBe("hitband:d3:thin");
    });

    it("clears the mark once a wide companion shares its geometry", () => {
        const d = "M0,0L10,10";
        // The recipe: same `d`, transparent, wide, appended first so a precise click still wins.
        svg("path", {
            d, fill: "none", stroke: "transparent", "stroke-width": "12",
            class: MARK_CLASS, [ROW_IDX_ATTR]: "0,1,2",
        });
        hairlineMark(d);
        const c = censusHitBands(container, doc);
        expect(c.hairline).toBe(1);          // the visible line is still thin
        expect(c.uncovered).toBe(0);         // ...but something wide covers its geometry
        expect(hitBandFlag(c)).toBe("hitband:d3:ok");
    });

    it("does not count a Sankey link, whose visible stroke IS the hit band", () => {
        // fill:none and tagged, but a link's thickness IS its value, so it is already wide.
        svg("path", {
            d: "M0,0C5,0 5,20 10,20", fill: "none", stroke: "#888", "stroke-width": "24",
            class: `${MARK_CLASS} sk-link`, [ROW_IDX_ATTR]: "7",
        });
        const c = censusHitBands(container, doc);
        expect(c.openStrokes).toBe(1);
        expect(c.interactive).toBe(1);
        expect(c.hairline).toBe(0);
        expect(c.uncovered).toBe(0);
        expect(c.widestPx).toBe(24);
        expect(hitBandFlag(c)).toBe("hitband:d3:ok");
    });

    it("does not count a line the chart declared inert", () => {
        // A cumulative-percentage overlay drawn pointer-events:none beside a
        // separate circle selection that carries the real marks.
        const el = hairlineMark();
        el.style.pointerEvents = "none";
        const c = censusHitBands(container, doc);
        expect(c.openStrokes).toBe(1);
        expect(c.interactive).toBe(0);
        expect(c.uncovered).toBe(0);
        expect(hitBandFlag(c)).toBe("");     // nothing to say, and NOT a false "ok"
    });

    it("ignores an untagged gridline and a filled area mark", () => {
        svg("path", { d: "M0,5L100,5", fill: "none", stroke: "#ccc", "stroke-width": "1" });
        svg("path", {
            d: "M0,0L10,10Z", fill: "#2e86ab", "stroke-width": "1",
            class: MARK_CLASS, [ROW_IDX_ATTR]: "3",
        });
        const c = censusHitBands(container, doc);
        expect(c.openStrokes).toBe(0);       // one untagged, one filled
        expect(hitBandFlag(c)).toBe("");
    });

    it("treats an unreadable width as WIDE, so it reports the chart and not the environment", () => {
        svg("path", {
            d: "M0,0L10,10", fill: "none", stroke: "#333", "stroke-width": "0.5em",
            class: MARK_CLASS, [ROW_IDX_ATTR]: "1",
        });
        const c = censusHitBands(container, doc);
        expect(c.interactive).toBe(1);
        expect(c.hairline).toBe(0);
    });

    it("uses the row index as the geometry key when there is no d", () => {
        svg("line", {
            x1: "0", y1: "0", x2: "10", y2: "10", fill: "none", stroke: "#333",
            "stroke-width": "1", class: MARK_CLASS, [ROW_IDX_ATTR]: "4",
        });
        svg("line", {
            x1: "0", y1: "0", x2: "10", y2: "10", fill: "none", stroke: "transparent",
            "stroke-width": String(MIN_HIT_BAND_PX + 4), class: MARK_CLASS, [ROW_IDX_ATTR]: "4",
        });
        const c = censusHitBands(container, doc);
        expect(c.hairline).toBe(1);
        expect(c.uncovered).toBe(0);
    });

    it("never throws, and returns zeroes for a container it cannot read", () => {
        expect(censusHitBands(null)).toEqual(
            { openStrokes: 0, interactive: 0, hairline: 0, uncovered: 0, widestPx: 0 });
        expect(censusHitBands({} as any)).toEqual(
            { openStrokes: 0, interactive: 0, hairline: 0, uncovered: 0, widestPx: 0 });
        expect(hitBandFlag(censusHitBands(null))).toBe("");
    });
});
