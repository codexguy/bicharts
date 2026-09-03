import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import {
    needsScroll, scrollFitFor, contentExtentOf, planFrameGrow, isPhantomBox,
    SCROLL_SLACK_PX, MAX_FRAME_GROW_FACTOR, PHANTOM_FRACTION, type MeasuredBox,
} from "../src/fit";
import {
    fitRenderedChart, fitReadingFor, measureContainerBoxes, svgInkReach, ctmScaleOf,
} from "../src/fitDom";

/*
    THE FRAME STOPS CUTTING, IN EVERY HOST (2026-09-03).

    Ported from the Power BI visual's own fit tests when the geometry moved into this package,
    plus the cases only the shared entry point can have. The defect these exist for is not a
    Power BI defect: the outermost <svg> clips at its own viewport in every browser, so a chart
    that sets `svg height = options.height` and draws a taller body loses the overflow outright,
    and the container's scrollHeight cheerfully agrees that everything fits. A paged chart lost
    9 of its 25 rows that way, with no scrollbar anywhere.

    jsdom reports 0 for every layout box, so the DOM tests below stub getBoundingClientRect and
    the client dimensions directly. That is honest for what is being tested: the arithmetic and
    the discard rules, not the browser's layout engine.
*/

// ---------------------------------------------------------------- pure geometry

describe("needsScroll", () => {
    it("says no when the content fits", () => {
        expect(needsScroll(400, 600)).toBe(false);
        expect(needsScroll(600, 600)).toBe(false);
    });

    it("ignores overflow inside the slack - a scrollbar for two pixels is a defect", () => {
        // Sub-pixel layout, a 1px frame stroke and browser rounding routinely put content a
        // hair past the container. None of that is worth a scrollbar.
        expect(needsScroll(601, 600)).toBe(false);
        expect(needsScroll(600 + SCROLL_SLACK_PX, 600)).toBe(false);
    });

    it("says yes once the overflow is worth reaching for", () => {
        expect(needsScroll(600 + SCROLL_SLACK_PX + 1, 600)).toBe(true);
        // The motivating case: twelve legible rows in a 129px banner.
        expect(needsScroll(12 * 32, 129)).toBe(true);
    });

    it("degrades to clipping when the layout cannot be measured", () => {
        // An unmeasurable layout must behave like today, not put a scrollbar on an empty
        // container.
        expect(needsScroll(NaN, 600)).toBe(false);
        expect(needsScroll(600, NaN)).toBe(false);
        expect(needsScroll(Infinity, 600)).toBe(false);
        expect(needsScroll(0, 600)).toBe(false);
        expect(needsScroll(600, 0)).toBe(false);
        expect(needsScroll(-10, 600)).toBe(false);
    });
});

describe("scrollFitFor", () => {
    it("answers the two axes INDEPENDENTLY", () => {
        // The worst available outcome is a horizontal scrollbar stealing the last rows of a
        // chart that only ever needed vertical room.
        const v = scrollFitFor(500, 900, 600, 400);
        expect(v.overflowX).toBe("hidden");
        expect(v.overflowY).toBe("auto");

        const h = scrollFitFor(900, 300, 600, 400);
        expect(h.overflowX).toBe("auto");
        expect(h.overflowY).toBe("hidden");
    });

    it("leaves a chart that fits exactly as it is today", () => {
        expect(scrollFitFor(600, 400, 600, 400)).toEqual({ overflowX: "hidden", overflowY: "hidden" });
    });

    it("scrolls both ways when both overflow", () => {
        expect(scrollFitFor(900, 900, 600, 400)).toEqual({ overflowX: "auto", overflowY: "auto" });
    });

    it("honours a caller-supplied slack", () => {
        expect(scrollFitFor(620, 400, 600, 400, 8).overflowX).toBe("auto");
        expect(scrollFitFor(620, 400, 600, 400, 50).overflowX).toBe("hidden");
    });
});

describe("contentExtentOf", () => {
    const box = (right: number, bottom: number, floating = false): MeasuredBox => ({ right, bottom, floating });

    it("does not let a parked tooltip invent 14px of content", () => {
        // A lollipop chart drew exactly the 705x520 it was handed, and an invisible
        // absolutely-positioned tooltip parked under the SVG made scrollHeight report 534 -
        // enough for a scrollbar that then took ~20px of width off a chart needing none.
        const extent = contentExtentOf([box(705, 520), box(705, 534, true)]);
        expect(extent.h).toBe(520);
        expect(extent.source).toBe("in-flow");
        expect(needsScroll(extent.h, 520)).toBe(false);
    });

    it("still scrolls a chart that GENUINELY runs past the container", () => {
        const extent = contentExtentOf([box(600, 900)]);
        expect(extent.h).toBe(900);
        expect(needsScroll(extent.h, 400)).toBe(true);
    });

    it("counts EVERY box when the chart is drawn entirely into floating layers", () => {
        // The escape hatch is the load-bearing half: dropping them all would report an extent
        // of zero and silently clip a chart that draws only into absolute layers.
        const extent = contentExtentOf([box(700, 800, true), box(500, 600, true)]);
        expect(extent).toEqual({ w: 700, h: 800, source: "all-floating" });
    });

    it("takes the furthest reach across several in-flow children", () => {
        const extent = contentExtentOf([box(300, 900), box(800, 200)]);
        expect(extent).toEqual({ w: 800, h: 900, source: "in-flow" });
    });

    it("reports 'none' when there is nothing measurable, so the caller can fall back", () => {
        expect(contentExtentOf([]).source).toBe("none");
        expect(contentExtentOf([box(NaN, NaN)]).source).toBe("none");
        expect(contentExtentOf([box(0, 0)]).source).toBe("none");
    });
});

describe("isPhantomBox", () => {
    it("drops full-canvas furniture that would balloon the frame", () => {
        // A marimekko: a `width: options.width` .d3-legend-mark hit-rect carries
        // a contract class, so it slips past the unclassed-shape filter and would otherwise
        // scale the whole chart into a letterboxed sliver.
        expect(isPhantomBox(600, 20, 600, 400)).toBe(true);
        expect(isPhantomBox(20, 400, 600, 400)).toBe(true);
    });

    it("keeps every legitimate label, swatch and node", () => {
        expect(isPhantomBox(80, 14, 600, 400)).toBe(false);
        expect(isPhantomBox(600 * PHANTOM_FRACTION - 1, 14, 600, 400)).toBe(false);
    });
});

describe("planFrameGrow", () => {
    it("THE CASE: a 584px body in a 290px frame grows the frame, not the container", () => {
        // The motivating case: a 25-row page whose body ran to 584 in a 290-tall SVG. Nine rows
        // were never painted, and no scrollbar existed because the element really was 290 tall.
        const plan = planFrameGrow(584, 290, 404.2, 0.717);
        expect(plan.grow).toBe(true);
        expect(plan.heightPx).toBe(584);
        expect(plan.reason).toBe("grow");
    });

    it("leaves a chart that fits exactly as it is today", () => {
        expect(planFrameGrow(290, 290, 290, 1).grow).toBe(false);
        expect(planFrameGrow(290, 290, 290, 1).reason).toBe("fits");
        // Inside the slack is still "fits" - the frame does not twitch for rounding noise.
        expect(planFrameGrow(290 + SCROLL_SLACK_PX, 290, 290, 1).grow).toBe(false);
    });

    it("holds the on-screen scale EXACTLY when there is a viewBox", () => {
        // The element moves by pxDelta and the viewBox by pxDelta/scale, so px-per-user-unit is
        // unchanged: nothing on screen moves or resizes, the frame just stops cutting.
        const elH = 290, vb = 404.2, scale = elH / vb;
        const plan = planFrameGrow(584, elH, vb, scale);
        expect(plan.grow).toBe(true);
        expect(plan.heightPx / plan.viewBoxH).toBeCloseTo(scale, 10);
    });

    it("only ever grows without a viewBox, where user units ARE px", () => {
        const plan = planFrameGrow(584, 290, 0, 1);
        expect(plan.grow).toBe(true);
        expect(plan.reason).toBe("grow-no-viewbox");
        expect(plan.viewBoxH).toBe(0);
    });

    it("refuses a grow into the weeds rather than building a 99999px canvas", () => {
        const plan = planFrameGrow(290 * MAX_FRAME_GROW_FACTOR + 1, 290, 290, 1);
        expect(plan.grow).toBe(false);
        expect(plan.reason).toBe("beyond-ceiling");
        // Exactly at the ceiling is still a tall chart, not junk.
        expect(planFrameGrow(290 * MAX_FRAME_GROW_FACTOR, 290, 290, 1).grow).toBe(true);
    });

    it("degrades to today's clipping on anything it cannot measure", () => {
        expect(planFrameGrow(NaN, 290, 290, 1).reason).toBe("unmeasurable");
        expect(planFrameGrow(584, NaN, 290, 1).reason).toBe("unmeasurable");
        expect(planFrameGrow(584, 0, 290, 1).reason).toBe("unmeasurable");
        expect(planFrameGrow(584, 290, 290, 0).reason).toBe("no-scale");
        expect(planFrameGrow(584, 290, 290, NaN).reason).toBe("no-scale");
    });

    it("never returns a plan that shrinks", () => {
        for (const ink of [0, 100, 289, 290, 300, 584, 5000]) {
            const plan = planFrameGrow(ink, 290, 404.2, 0.717);
            expect(plan.heightPx).toBeGreaterThanOrEqual(290);
        }
    });
});

// ---------------------------------------------------------------- the DOM layer

let dom: JSDOM;
let doc: Document;

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>");
    doc = dom.window.document;
});

type Rect = { left: number; top: number; right: number; bottom: number };
const asRect = (r: Rect) => ({
    left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON: () => ({}),
});

function el(tag: string, rect: Rect, position = "static"): HTMLElement {
    const e = doc.createElement(tag);
    e.style.position = position;
    (e as any).getBoundingClientRect = () => asRect(rect);
    return e;
}

function container(w: number, h: number): HTMLElement {
    const c = doc.createElement("div");
    (c as any).getBoundingClientRect = () => asRect({ left: 0, top: 0, right: w, bottom: h });
    Object.defineProperty(c, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(c, "clientHeight", { value: h, configurable: true });
    Object.defineProperty(c, "scrollWidth", { value: w, configurable: true });
    Object.defineProperty(c, "scrollHeight", { value: h, configurable: true });
    doc.body.appendChild(c);
    return c;
}

describe("ctmScaleOf", () => {
    it("is rotation-safe, which a bare .a is not", () => {
        // Charts rotate axis labels, so a matrix with a shear/rotation component must still
        // report the uniform scale rather than the x-axis projection alone.
        expect(ctmScaleOf({ a: 0.5, b: 0 })).toBeCloseTo(0.5, 10);
        expect(ctmScaleOf({ a: 0, b: 0.5 })).toBeCloseTo(0.5, 10);
        expect(ctmScaleOf({ a: 0.3, b: 0.4 })).toBeCloseTo(0.5, 10);
    });

    it("answers 0 for anything unusable, which disables the grow rather than guessing", () => {
        expect(ctmScaleOf(null)).toBe(0);
        expect(ctmScaleOf(undefined)).toBe(0);
        expect(ctmScaleOf({ a: 0, b: 0 })).toBe(0);
        expect(ctmScaleOf({ a: NaN, b: 0 })).toBe(0);
    });
});

describe("fitReadingFor", () => {
    it("reports a chart that fits, and says where the extent came from", () => {
        const c = container(600, 400);
        c.appendChild(el("svg", { left: 0, top: 0, right: 600, bottom: 400 }));
        const r = fitReadingFor("d3", c)!;
        expect(r.contentH).toBe(400);
        expect(r.overflowsX).toBe(false);
        expect(r.overflowsY).toBe(false);
        expect(r.extentSource).toBe("in-flow");
        expect(r.boxes).toBe(1);
    });

    it("reports an overrun on the axis that actually overruns, not both", () => {
        const c = container(600, 400);
        c.appendChild(el("svg", { left: 0, top: 0, right: 590, bottom: 900 }));
        const r = fitReadingFor("d3", c)!;
        expect(r.overflowsX).toBe(false);
        expect(r.overflowsY).toBe(true);
    });

    it("does not count an absolutely-positioned tooltip as content", () => {
        const c = container(705, 520);
        c.appendChild(el("svg", { left: 0, top: 0, right: 705, bottom: 520 }));
        c.appendChild(el("div", { left: 0, top: 520, right: 705, bottom: 534 }, "absolute"));
        const r = fitReadingFor("d3", c)!;
        expect(r.contentH).toBe(520);
        expect(r.overflowsY).toBe(false);
        expect(r.floating).toBe(1);
    });

    it("says NOTHING for a lane that did not draw", () => {
        // A host that hides all but one lane container would otherwise get a confident
        // "0x0 fits perfectly" from every hidden one, on every render.
        const c = container(0, 0);
        expect(fitReadingFor("vega", c)).toBeNull();
        expect(fitReadingFor("vega", null)).toBeNull();
        expect(fitReadingFor("vega", undefined)).toBeNull();
    });

    it("skips a display:none child rather than measuring it", () => {
        const c = container(600, 400);
        const hidden = el("div", { left: 0, top: 0, right: 600, bottom: 5000 });
        hidden.style.display = "none";
        c.appendChild(hidden);
        c.appendChild(el("svg", { left: 0, top: 0, right: 600, bottom: 400 }));
        const r = fitReadingFor("d3", c)!;
        expect(r.contentH).toBe(400);
        expect(r.overflowsY).toBe(false);
    });
});

describe("measureContainerBoxes - an element's box vs its ink", () => {
    it("THE CASE: an SVG that draws past its own frame reports the ink, and overflows", () => {
        const c = container(590, 290);
        c.appendChild(el("svg", { left: 0, top: 0, right: 590, bottom: 290 }));
        const withoutInk = contentExtentOf(measureContainerBoxes(c));
        expect(withoutInk.h).toBe(290);          // "fits" - the lie that lost nine rows

        const withInk = contentExtentOf(measureContainerBoxes(c, () => ({ right: 590, bottom: 584 })));
        expect(withInk.h).toBe(584);
        expect(needsScroll(withInk.h, 290)).toBe(true);
    });

    it("is anchored to the element's ORIGIN, not to its far edge", () => {
        const c = container(600, 400);
        c.appendChild(el("svg", { left: 0, top: 100, right: 600, bottom: 300 }));
        const boxes = measureContainerBoxes(c, () => ({ right: 600, bottom: 500 }));
        expect(boxes[0].bottom).toBe(600);       // origin 100 + reach 500, not 300 + 500
    });

    it("never SHRINKS a box - ink smaller than the frame leaves the frame standing", () => {
        const c = container(600, 400);
        c.appendChild(el("svg", { left: 0, top: 0, right: 600, bottom: 400 }));
        const boxes = measureContainerBoxes(c, () => ({ right: 100, bottom: 100 }));
        expect(boxes[0].bottom).toBe(400);
    });

    it("is OFF by default, so a pure reading series is untouched", () => {
        const c = container(590, 290);
        c.appendChild(el("svg", { left: 0, top: 0, right: 590, bottom: 290 }));
        expect(measureContainerBoxes(c)[0].bottom).toBe(290);
    });

    it("keeps the element box when the reader throws or declines", () => {
        const c = container(600, 400);
        c.appendChild(el("svg", { left: 0, top: 0, right: 600, bottom: 400 }));
        expect(measureContainerBoxes(c, () => { throw new Error("no"); })[0].bottom).toBe(400);
        expect(measureContainerBoxes(c, () => null)[0].bottom).toBe(400);
    });

    it("still discards floating chrome - the ink reader does not reopen the tooltip hole", () => {
        const c = container(705, 520);
        c.appendChild(el("svg", { left: 0, top: 0, right: 705, bottom: 520 }));
        c.appendChild(el("div", { left: 0, top: 520, right: 705, bottom: 534 }, "absolute"));
        const extent = contentExtentOf(measureContainerBoxes(c, () => null));
        expect(extent.h).toBe(520);
    });
});

describe("svgInkReach", () => {
    /** An <svg> whose frame is `frame` and whose FIT_CONTENT_SELECTOR children reach `marks`. */
    function svgWith(frame: Rect, marks: Rect[]): SVGSVGElement {
        const s = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as any;
        s.getBoundingClientRect = () => asRect(frame);
        for (const m of marks) {
            const t = doc.createElementNS("http://www.w3.org/2000/svg", "text") as any;
            t.getBoundingClientRect = () => asRect(m);
            s.appendChild(t);
        }
        return s as SVGSVGElement;
    }

    it("reports how far the ink reaches BELOW the frame, relative to the element top", () => {
        const s = svgWith({ left: 0, top: 0, right: 590, bottom: 290 },
                          [{ left: 10, top: 10, right: 200, bottom: 30 },
                           { left: 10, top: 560, right: 200, bottom: 584 }]);
        expect(svgInkReach(s)!.bottom).toBe(584);
    });

    it("drops phantom full-canvas furniture rather than fitting to a backdrop", () => {
        const s = svgWith({ left: 0, top: 0, right: 600, bottom: 400 },
                          [{ left: 0, top: 0, right: 600, bottom: 400 },
                           { left: 10, top: 10, right: 100, bottom: 30 }]);
        expect(svgInkReach(s)!.bottom).toBe(30);
    });

    it("answers null when there is nothing to measure, so nothing changes", () => {
        expect(svgInkReach(svgWith({ left: 0, top: 0, right: 0, bottom: 0 }, []))).toBeNull();
        expect(svgInkReach(svgWith({ left: 0, top: 0, right: 600, bottom: 400 }, []))).toBeNull();
    });
});

// ---------------------------------------------------------------- the shared entry point

describe("fitRenderedChart", () => {
    /*
        A container holding one <svg> that declares `declaredH` and really draws `inkH`.

        jsdom implements almost nothing of the SVG DOM - no layout, and no `viewBox.baseVal` -
        so both are stubbed. The baseVal stub matters more than it looks: without it every case
        here would silently take the no-viewBox branch, and the scale-preservation leg (the one
        piece of arithmetic that decides whether the reader's chart visibly jumps) would never
        run at all.
    */
    function gantt(viewW: number, viewH: number, declaredH: number, inkH: number, viewBoxH = 0) {
        const c = container(viewW, viewH);
        const s = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as any;
        s.getBoundingClientRect = () => asRect({ left: 0, top: 0, right: viewW, bottom: declaredH });
        s.setAttribute("width", String(viewW));
        s.setAttribute("height", String(declaredH));
        if (viewBoxH > 0) {
            s.setAttribute("viewBox", `0 0 ${viewW} ${viewBoxH}`);
            s.viewBox = { baseVal: { x: 0, y: 0, width: viewW, height: viewBoxH } };
        }
        // One row label per 22px of body, the last ending EXACTLY at inkH so the expected reach
        // is the number the test names rather than whatever the loop happened to stop on.
        const row = (top: number, bottom: number) => {
            const t = doc.createElementNS("http://www.w3.org/2000/svg", "text") as any;
            t.getBoundingClientRect = () => asRect({ left: 4, top, right: 120, bottom });
            s.appendChild(t);
        };
        for (let y = 0; y + 22 < inkH; y += 22) row(y, y + 20);
        row(Math.max(0, inkH - 20), inkH);
        s.getScreenCTM = () => (viewBoxH > 0 ? { a: declaredH / viewBoxH, b: 0 } : { a: 1, b: 0 });
        c.appendChild(s);
        return { c, s };
    }

    it("THE CLOSE CONDITION: a 90-row Gantt reaches its last row instead of ending at the frame", () => {
        // 90 rows at 22px is a 1,980-unit body in a 290px frame. Before this, rows past 290 were
        // never painted and nothing offered a scrollbar; the reader had no way to reach them.
        const { c, s } = gantt(590, 290, 290, 1980);
        const r = fitRenderedChart(c, { lane: "gantt" });
        expect(r.grew).toBe(true);
        expect(r.growFrom).toBe(290);
        expect(r.growTo).toBe(1980);
        expect(s.getAttribute("height")).toBe("1980");
        // And only NOW does a scrollbar mean anything, which is why the grow runs first.
        expect(r.overflowY).toBe("auto");
        expect(c.style.overflowY).toBe("auto");
    });

    it("holds the on-screen scale exactly when the chart has a viewBox", () => {
        const { c, s } = gantt(590, 290, 290, 1980, 404.2);
        const before = 290 / 404.2;
        const r = fitRenderedChart(c);
        expect(r.grew).toBe(true);
        const vb = s.getAttribute("viewBox")!.split(/\s+/).map(Number);
        expect(Number(s.getAttribute("height")) / vb[3]).toBeCloseTo(before, 10);
    });

    it("leaves a chart that fits completely alone - no grow, no scrollbar", () => {
        const { c, s } = gantt(600, 400, 400, 380);
        const r = fitRenderedChart(c);
        expect(r.grew).toBe(false);
        expect(r.growReason).toBe("fits");
        expect(s.getAttribute("height")).toBe("400");
        expect(r.overflowX).toBe("hidden");
        expect(r.overflowY).toBe("hidden");
    });

    it("refuses a grow into the weeds, and says so", () => {
        const { c, s } = gantt(590, 290, 290, 290 * MAX_FRAME_GROW_FACTOR + 100);
        const r = fitRenderedChart(c);
        expect(r.grew).toBe(false);
        expect(r.growReason).toBe("beyond-ceiling");
        expect(s.getAttribute("height")).toBe("290");
    });

    it("can take the READING without touching the chart", () => {
        // The half a host wants when it owns its own layout but still needs to know.
        const { c, s } = gantt(590, 290, 290, 1980);
        const r = fitRenderedChart(c, { grow: false, applyOverflow: false });
        expect(r.grew).toBe(false);
        expect(r.growReason).toBe("grow-disabled");
        expect(s.getAttribute("height")).toBe("290");
        expect(c.style.overflowY).toBe("");
        // It still REPORTS the overrun, which is the whole point of taking the reading.
        expect(r.reading!.overflowsY).toBe(true);
    });

    it("never throws, whatever it is handed", () => {
        expect(() => fitRenderedChart(null)).not.toThrow();
        expect(() => fitRenderedChart(undefined)).not.toThrow();
        expect(fitRenderedChart(null).growReason).toBe("no-container");
        const empty = container(600, 400);
        expect(() => fitRenderedChart(empty)).not.toThrow();
        expect(fitRenderedChart(empty).growReason).toBe("no-svg");
    });

    it("grows VERTICALLY ONLY - a horizontal overrun stays a defect, not a scrollbar", () => {
        const c = container(300, 400);
        const s = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as any;
        s.getBoundingClientRect = () => asRect({ left: 0, top: 0, right: 300, bottom: 400 });
        s.setAttribute("height", "400");
        // A long axis label pushed off the right edge. Kept narrower than PHANTOM_FRACTION of
        // the frame on purpose: a SINGLE element wider than that is read as full-canvas
        // furniture and dropped, which is the backdrop rule doing its job - so a test that
        // wanted one giant mark would be testing the phantom filter, not the grow axis.
        const t = doc.createElementNS("http://www.w3.org/2000/svg", "text") as any;
        t.getBoundingClientRect = () => asRect({ left: 250, top: 4, right: 520, bottom: 24 });
        s.appendChild(t);
        s.getScreenCTM = () => ({ a: 1, b: 0 });
        c.appendChild(s);

        const r = fitRenderedChart(c);
        expect(r.grew).toBe(false);          // the height was never the problem
        expect(s.getAttribute("height")).toBe("400");
        // Reported on the axis that overruns, so the overrun is knowable even though the frame
        // does not grow to meet it.
        expect(r.overflowX).toBe("auto");
    });
});
