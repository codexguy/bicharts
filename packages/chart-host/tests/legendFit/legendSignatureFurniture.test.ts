// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { findSignatureLegendGroups } from "../../src/legendFit/legendReconcileDom";

// THE ZOOM PAD IS NOT A LEGEND.
//
// The legend signature (a mark-free <g> holding >= 2 same-size swatch + adjacent text pairs) also fits
// the geo-zoom helper's d-pad: seven 17 px buttons of one size, each with a glyph beside it. The exec gate's
// copy of the detector unioned the pad with a flow map's key and reported the pad's own down arrow as a
// label the legend covered, which forced a healing regeneration. This copy takes signatureGroups[0] as THE
// legend to slide, and the pad is drawn before the key, so the pass would have slid the zoom pad. Helper furniture is excluded by its class, as the tick
// reader in this file already excludes the pad's glyphs.
//
// jsdom has no layout, so getBoundingClientRect is stubbed from each element's own attributes: a rect's
// x/y/width/height, a line's endpoints, a text's x/y at 0.6 em per character by its text-anchor.

const SVG = "http://www.w3.org/2000/svg";

function boxOf(el: Element): { left: number; right: number; top: number; bottom: number } {
    const n = (a: string) => parseFloat(el.getAttribute(a) || "0");
    const tag = el.tagName.toLowerCase();
    if (tag === "rect") return { left: n("x"), top: n("y"), right: n("x") + n("width"), bottom: n("y") + n("height") };
    if (tag === "line") return { left: Math.min(n("x1"), n("x2")), right: Math.max(n("x1"), n("x2")), top: n("y1") - 0.5, bottom: n("y2") + 0.5 };
    if (tag === "text") {
        const fs = n("font-size") || 10, w = (el.textContent || "").length * fs * 0.6;
        const a = el.getAttribute("text-anchor") || "start";
        const left = a === "middle" ? n("x") - w / 2 : a === "end" ? n("x") - w : n("x");
        return { left, right: left + w, top: n("y") - fs * 0.8, bottom: n("y") + fs * 0.2 };
    }
    return { left: 0, right: 0, top: 0, bottom: 0 };
}

beforeEach(() => {
    (Element.prototype as any).getBoundingClientRect = function (this: Element) {
        const b = boxOf(this);
        return { ...b, width: b.right - b.left, height: b.bottom - b.top, x: b.left, y: b.top, toJSON: () => ({}) };
    };
    document.body.innerHTML = "";
});

function el(parent: Element, tag: string, attrs: Record<string, string | number>, text?: string): Element {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    parent.appendChild(e);
    return e;
}

// d3.llmGeoZoom's d-pad as the helper lays it out: 3 x 3 cells of 17 px with a 2 px gap, each button a
// <g class="llm-zoom-btn"> holding its rect and its centred glyph.
function pad(svg: Element): Element {
    const p = el(svg, "g", { class: "llm-zoom-pad" });
    const cells: [number, number, string][] = [[0, 0, "+"], [1, 0, "↑"], [2, 0, "−"], [0, 1, "←"],
                                               [1, 1, "⟲"], [2, 1, "→"], [1, 2, "↓"]];
    for (const [c, r, g] of cells) {
        const b = el(p, "g", { class: "llm-zoom-btn" });
        const x = 547 + c * 19, y = 6 + r * 19;
        el(b, "rect", { x, y, width: 17, height: 17 });
        el(b, "text", { x: x + 8.5, y: y + 12, "font-size": 12, "text-anchor": "middle" }, g);
    }
    return p;
}

// d3.llmFlowKey's band with reference strokes only: nothing in it is classed d3-legend-mark.
function key(svg: Element): Element {
    const k = el(svg, "g", { class: "llm-key" });
    for (const [v, y] of [["1,224,752", 68], ["618,882", 89], ["13,012", 107]] as [string, number][]) {
        el(k, "line", { x1: 616, x2: 640, y1: y, y2: y });
        el(k, "text", { x: 646, y: y + 4, "font-size": 10 }, v);
    }
    return k;
}

function chart(): SVGSVGElement {
    const svg = document.createElementNS(SVG, "svg") as SVGSVGElement;
    svg.setAttribute("width", "760");
    svg.setAttribute("height", "430");
    el(svg, "path", { class: "d3-mark", d: "M20,300 Q200,250 400,320" });
    document.body.appendChild(svg);
    return svg;
}

describe("findSignatureLegendGroups - helper furniture is not a legend", () => {
    it("finds the flow key and never the zoom pad drawn before it", () => {
        const svg = chart();
        pad(svg);
        const k = key(svg);
        expect(findSignatureLegendGroups(svg)).toEqual([k]);
    });

    it("finds nothing on a chart whose only signature-shaped group is the pad", () => {
        const svg = chart();
        pad(svg);
        expect(findSignatureLegendGroups(svg)).toEqual([]);
    });

    it("still finds an unclassed swatch legend beside the pad", () => {
        const svg = chart();
        pad(svg);
        const lg = el(svg, "g", { class: "legend-box" });
        ["North", "South", "East"].forEach((name, i) => {
            el(lg, "rect", { x: 90, y: 185 + i * 14, width: 10, height: 10 });
            el(lg, "text", { x: 104, y: 194 + i * 14, "font-size": 10 }, name);
        });
        expect(findSignatureLegendGroups(svg)).toEqual([lg]);
    });
});
