// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg, smallestRenderedTextPx } from "../../src/legendFit/legendReconcileDom";
import { FIT_CONTENT_SELECTOR, PHANTOM_FRACTION, isPhantomBox } from "../../src/fit";
import { ctmScaleOf } from "../../src/fitDom";
import { installSvgLayout, el, makeSvg, viewBoxNumbers } from "./support/svgLayout";

// THE CONTENT FIT.
//
// The universal "nothing gets cut off" pass (a Sankey drew node labels into negative x and the legend
// pass, which only watches the right edge, applied cleanly). It takes the union box of every
// information-carrying element - every <text> plus the contract-classed marks, never an unclassed
// decoration - and EXTENDS the viewBox on whichever sides content hangs past, plus a 4-unit pad. It never
// shrinks a frame, ignores a hairline (2 units or less), ignores junk parked far off-canvas and a single
// element as large as the frame (phantom furniture), refuses a side that would need more than 35% of the
// frame (the cap buys a shrink and still clips), and refuses a fit that would cost the smallest text more
// than a pixel (the shrink is paid in legibility). The result reports it as fit "L24 R68 T10 B16" and, when
// it declined for a reason of its own, fitDeclined "clamped" | "legibility". It runs after the legend slide
// and whether or not there was a legend. Driven through the module's public export on support/svgLayout.ts.
//
// jsdom resolves a text's computed size from its inline style (it ignores the font-size attribute), which is
// what the legibility test reads, so the cases that depend on it declare their sizes in style="...".

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

function sized(svg: Element, x: number, y: number, text: string, px = 10, extra: Record<string, string | number> = {}): Element {
    return el(svg, "text", { x, y, "font-size": px, style: `font-size:${px}px`, ...extra }, text);
}

/** A 760 x 430 chart with one centred label so there is always some content inside the frame. */
function chart(px = 10): SVGSVGElement {
    const svg = makeSvg(760, 430);
    sized(svg, 300, 200, "Plot", px);
    return svg;
}

describe("reconcileLegendInSvg - the content fit extends the viewBox over content that hangs past an edge", () => {
    it("THE CASE: a label drawn into negative x extends the LEFT of the frame, and nothing else moves", () => {
        const svg = chart();
        const label = sized(svg, -30, 100, "Outbound shipments");
        const res = reconcileLegendInSvg(svg);
        // Hangs 30 units; 30 + the 4-unit pad is 34 added on the left.
        expect(res).toMatchObject({ applied: true, reason: "fit", fit: "L34 R0 T0 B0" });
        expect(res.fitDeclined).toBeUndefined();
        // The smallest type is reported only when the fit did NOT apply, where it is the evidence for the call.
        expect(res.smallestTextPx).toBeUndefined();
        expect(viewBoxNumbers(svg)).toEqual([-34, 0, 794, 430]);
        expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
        expect(label.getAttribute("transform")).toBeNull();
    });

    it("every side is judged on its own: 24 left, 34 right, 10 top, 16 bottom", () => {
        const svg = chart();
        sized(svg, -20, 100, "left hang");
        sized(svg, 700, 120, "right hang here");
        sized(svg, 300, 2, "top hang");
        sized(svg, 300, 440, "bottom hang");
        const res = reconcileLegendInSvg(svg);
        expect(res.fit).toBe("L24 R34 T10 B16");
        expect(viewBoxNumbers(svg)).toEqual([-24, -10, 818, 456]);
    });

    it("EXTEND-only: content smaller than the frame never shrinks it", () => {
        const svg = chart();
        const res = reconcileLegendInSvg(svg);
        expect(res.applied).toBe(false);
        expect(res.fit).toBeUndefined();
        expect(res.fitDeclined).toBeUndefined();
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("a hairline overhang (2 units or less) is ignored", () => {
        const svg = chart();
        sized(svg, -2, 100, "edge");
        expect(reconcileLegendInSvg(svg).applied).toBe(false);
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("an svg with a viewBox keeps its origin and extends from it", () => {
        const svg = makeSvg(760, 430, "10 20 760 430");
        sized(svg, 300, 200, "Plot");
        sized(svg, -5, 100, "left hang");
        const res = reconcileLegendInSvg(svg);
        // The label starts at -5; the frame starts at 10: 15 + 4 = 19 on the left.
        expect(res.fit).toBe("L19 R0 T0 B0");
        expect(viewBoxNumbers(svg)).toEqual([-9, 20, 779, 430]);
    });

    it("keeps a preserveAspectRatio the chart already had", () => {
        const svg = chart();
        svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
        sized(svg, -30, 100, "Outbound shipments");
        reconcileLegendInSvg(svg);
        expect(svg.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
    });

    it("a contract-classed mark counts as content, like a label", () => {
        const svg = chart();
        el(svg, "circle", { class: "d3-mark", cx: 770, cy: 200, r: 12 });
        const res = reconcileLegendInSvg(svg);
        // The circle spans 758..782: 22 past the right edge + 4.
        expect(res.fit).toBe("L0 R26 T0 B0");
    });
});

describe("reconcileLegendInSvg - what the content fit does NOT count", () => {
    it("an unclassed shape is decoration: a backdrop rect hanging 500 units off the edge changes nothing", () => {
        const svg = chart();
        el(svg, "rect", { x: 0, y: 0, width: 1260, height: 100, fill: "white" });
        el(svg, "path", { d: "M0,0 L900,40", stroke: "grey" });
        expect(reconcileLegendInSvg(svg).applied).toBe(false);
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("a single element as large as the frame is phantom furniture, even with a contract class", () => {
        const svg = chart();
        el(svg, "rect", { class: "d3-mark d3-legend-mark", x: 40, y: 0, width: 730, height: 40 });
        expect(reconcileLegendInSvg(svg).applied).toBe(false);
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("a rect well under the phantom size that hangs off the edge is content", () => {
        const svg = chart();
        el(svg, "rect", { class: "d3-mark", x: 200, y: 0, width: 600, height: 40 });
        expect(reconcileLegendInSvg(svg).fit).toBe("L0 R44 T0 B0");
    });

    it("junk parked far off-canvas (a work element at x=-9999) is ignored", () => {
        const svg = chart();
        sized(svg, -9999, 100, "measure me");
        expect(reconcileLegendInSvg(svg).applied).toBe(false);
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("text inside <defs> and text that is display:none measure nothing", () => {
        const svg = chart();
        const defs = el(svg, "defs");
        sized(defs, -80, 100, "template");
        sized(svg, -80, 120, "hidden", 10, { display: "none" });
        sized(svg, -80, 140, "", 10);
        expect(reconcileLegendInSvg(svg).applied).toBe(false);
    });
});

describe("reconcileLegendInSvg - the content fit declines when the fit costs more than it buys", () => {
    it("a side that needs more than 35% of the frame is left clipped: fitDeclined clamped, no shrink paid", () => {
        const svg = chart();
        sized(svg, -270, 100, "Outbound shipments");
        const res = reconcileLegendInSvg(svg);
        expect(res.applied).toBe(false);
        expect(res.reason).toBe("no-legend");
        expect(res.fit).toBeUndefined();
        expect(res.fitDeclined).toBe("clamped");
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("per side: a rescuable left is still extended beside an unrescuable bottom", () => {
        const svg = chart();
        sized(svg, -20, 100, "left hang");
        sized(svg, 300, 585, "row body");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "fit", fit: "L24 R0 T0 B0" });
        expect(res.fitDeclined).toBeUndefined();
        expect(viewBoxNumbers(svg)).toEqual([-24, 0, 784, 430]);
    });

    it("a fit that would shrink 10px type below 9px on screen is refused: fitDeclined legibility", () => {
        const svg = chart(10);
        sized(svg, -90, 100, "Outbound shipments", 10);
        const res = reconcileLegendInSvg(svg);
        // 94 added to 760 is a scale of 0.8899: the smallest type, 10px, would paint at 8.9px.
        expect(res).toMatchObject({ applied: false, fitDeclined: "legibility", smallestTextPx: 10 });
        expect(res.fit).toBeUndefined();
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("the same extension on 20px type is waved through: large type has room to shrink", () => {
        const svg = chart(20);
        sized(svg, -90, 100, "Outbound shipments", 20);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, fit: "L94 R0 T0 B0" });
        expect(res.fitDeclined).toBeUndefined();
    });

    it("a shrink that costs the 10px type under a pixel is waved through", () => {
        const svg = chart(10);
        sized(svg, -60, 100, "Outbound shipments", 10);
        const res = reconcileLegendInSvg(svg);
        // 64 added: scale 0.9223, the type paints at 9.2px, over the 9px allowed.
        expect(res).toMatchObject({ applied: true, fit: "L64 R0 T0 B0" });
    });
});

describe("smallestRenderedTextPx - the smallest type the chart actually paints, in screen px", () => {
    it("is the smallest computed size times the CTM scale", () => {
        const svg = makeSvg(760, 430);
        sized(svg, 10, 20, "big", 12);
        sized(svg, 10, 40, "small", 9);
        expect(smallestRenderedTextPx(svg, 1)).toBe(9);
        expect(smallestRenderedTextPx(svg, 0.5)).toBe(4.5);
    });

    it("a label nobody can see is not a legibility constraint", () => {
        const svg = makeSvg(760, 430);
        sized(svg, 10, 20, "visible", 12);
        sized(svg, 10, 40, "hidden", 6, { display: "none" });
        expect(smallestRenderedTextPx(svg, 1)).toBe(12);
    });

    it("null when nothing could be measured, or when the scale is not a positive finite number", () => {
        const empty = makeSvg(760, 430);
        expect(smallestRenderedTextPx(empty, 1)).toBeNull();
        const svg = makeSvg(760, 430);
        sized(svg, 10, 20, "x", 12);
        for (const bad of [0, -1, NaN, Infinity]) expect(smallestRenderedTextPx(svg, bad), String(bad)).toBeNull();
    });

    it("reads at most the first 400 texts: the smallest type is decided long before the 400th label", () => {
        const svg = makeSvg(760, 430);
        for (let i = 0; i < 400; i++) sized(svg, 10, 20, "t", 12);
        sized(svg, 10, 20, "late", 6);
        expect(smallestRenderedTextPx(svg, 1)).toBe(12);
    });
});

describe("the fit helpers the content fit leans on (re-exported from the module)", () => {
    it("what counts as content is text plus the contract-classed marks, and nothing else", () => {
        expect(FIT_CONTENT_SELECTOR).toBe("text, .d3-mark, .d3-legend-mark");
    });

    it("a box over 95% of the frame on either axis is phantom", () => {
        expect(PHANTOM_FRACTION).toBe(0.95);
        expect(isPhantomBox(730, 40, 760, 430)).toBe(true);
        expect(isPhantomBox(40, 410, 760, 430)).toBe(true);
        expect(isPhantomBox(722, 40, 760, 430)).toBe(false);
        expect(isPhantomBox(100, 100, 760, 430)).toBe(false);
    });

    it("the CTM scale is rotation-safe and 0 for no matrix", () => {
        expect(ctmScaleOf({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 } as DOMMatrix)).toBe(0.5);
        expect(ctmScaleOf({ a: 0, b: 2, c: -2, d: 0, e: 0, f: 0 } as DOMMatrix)).toBe(2);
        expect(ctmScaleOf(null as unknown as DOMMatrix)).toBe(0);
    });
});
