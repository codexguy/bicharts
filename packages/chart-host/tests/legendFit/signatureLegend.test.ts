// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg, findSignatureLegendGroups } from "../../src/legendFit/legendReconcileDom";
import { installSvgLayout, el, makeSvg, viewBoxNumbers, userBox } from "./support/svgLayout";

// THE SIGNATURE LEGEND, AND THE ZOOM-PAD FURNITURE.
//
// 878 of the 1,522 legends in the D3 corpus carry no .d3-legend-mark, so the class finder never sees them.
// When NOTHING in the svg is classed, the pass falls back to the measured shape of a legend: a mark-free <g>
// holding two or more same-size swatches, each with a label beside it. A signature legend picks its margin
// from its own geometry (a column on the right slides right; a strip along the bottom is pushed down; one
// inset in the plot is left alone), and helper furniture (the geo-zoom helper's d-pad, which fits the signature)
// is never a legend. The same slide machinery then runs. These cases drive it through the public exports on
// the layout in support/svgLayout.ts; legendSignatureFurniture.test.ts keeps the finder's own
// zoom-pad cases, and this file pins what the PASS does with what the finder returns.

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

function bars(svg: Element, right = 740): void {
    const g = el(svg, "g", { class: "plot" });
    el(g, "rect", { class: "d3-mark", x: 60, y: 60, width: right - 60, height: 24 });
    el(g, "rect", { class: "d3-mark", x: 60, y: 100, width: 480, height: 24 });
}

/** A swatch legend with no class on anything: 3 rows of a 10 x 10 rect and a label, 56 x 43 in all. */
function key(parent: Element, x: number, y: number, cls = "key", names = ["Pending", "Shipped", "Delayed"]): Element {
    const g = el(parent, "g", { class: cls, transform: `translate(${x},${y})` });
    names.forEach((n, i) => {
        el(g, "rect", { x: 0, y: i * 16, width: 10, height: 10 });
        el(g, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, n);
    });
    return g;
}

// d3.llmGeoZoom's d-pad as the helper lays it out: 3 x 3 cells of 17 px with a 2 px gap, each button a
// <g class="llm-zoom-btn"> holding its rect and its centred glyph.
function pad(svg: Element): Element {
    const p = el(svg, "g", { class: "llm-zoom-pad" });
    const cells: [number, number, string][] = [[0, 0, "+"], [1, 0, "u"], [2, 0, "-"], [0, 1, "l"], [1, 1, "o"], [2, 1, "r"], [1, 2, "d"]];
    for (const [c, r, g] of cells) {
        const b = el(p, "g", { class: "llm-zoom-btn" });
        const x = 547 + c * 19, y = 6 + r * 19;
        el(b, "rect", { x, y, width: 17, height: 17 });
        el(b, "text", { x: x + 8.5, y: y + 12, "font-size": 12, "text-anchor": "middle" }, g);
    }
    return p;
}

// d3.llmFlowKey's band with reference strokes only: nothing in it carries a contract class.
function flowKey(svg: Element): Element {
    const k = el(svg, "g", { class: "llm-key" });
    for (const [v, y] of [["1,224,752", 68], ["618,882", 89], ["13,012", 107]] as [string, number][]) {
        el(k, "line", { x1: 616, x2: 640, y1: y, y2: y });
        el(k, "text", { x: 646, y: y + 4, "font-size": 10 }, v);
    }
    return k;
}

describe("reconcileLegendInSvg - a legend with no contract class is found by its shape and slid", () => {
    it("THE CASE: an unclassed swatch legend on the right slides exactly as a classed one would", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const lg = key(svg, 700, 60);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "reserve", dx: 48, ext: 48, newW: 808, furniture: 1, source: "signature" });
        expect(res.dy).toBeUndefined();
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 808, 430]);
        expect(userBox(lg)!.left).toBe(748);
    });

    it("two signature groups in the right column are both furniture and slide together", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const a = key(svg, 700, 60);
        const b = key(svg, 700, 160, "key2", ["EMEA", "APAC", "AMER"]);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, dx: 48, furniture: 2, source: "signature" });
        expect(a.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
        expect(b.getAttribute("transform")).toBe("translate(48,0) translate(700,160)");
    });

    it("a note drawn in the same column rides along, as it does for a classed legend", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const lg = key(svg, 700, 60);
        const note = el(svg, "text", { x: 706, y: 140, "font-size": 10 }, "Source");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, furniture: 2, source: "signature" });
        expect(note.getAttribute("transform")).toBe("translate(48,0)");
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
    });

    it("a classed legend wins: the signature finder is not consulted when anything is classed", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const classed = el(svg, "g", { class: "legend", transform: "translate(700,60)" });
        ["Pending", "Shipped", "Delayed"].forEach((n, i) => {
            el(classed, "rect", { class: "d3-mark d3-legend-mark", x: 0, y: i * 16, width: 10, height: 10 });
            el(classed, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, n);
        });
        const other = key(svg, 100, 250);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, source: "class", furniture: 1 });
        expect(other.getAttribute("transform")).toBe("translate(100,250)");
    });

    it("no plot marks anywhere: no-marks, and the source is still named", () => {
        const svg = makeSvg(760, 430);
        const lg = key(svg, 700, 60);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-marks", source: "signature" });
        expect(svg.getAttribute("data-lch-legend-fixed")).toBe("1");
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
    });
});

describe("reconcileLegendInSvg - a signature legend picks its margin from its own geometry", () => {
    // A horizontal key along the bottom, drawn over the x-axis tick row: 4 entries 90 apart, 10 high.
    function bottomChart(h = 410): { svg: SVGSVGElement; lg: Element } {
        const svg = makeSvg(760, h);
        bars(svg);
        const axis = el(svg, "g", { class: "x-axis" });
        ["A", "B", "C", "D", "E", "F"].forEach((t, i) => {
            const tick = el(axis, "g", { class: "tick", transform: `translate(${250 + i * 70},402)` });
            el(tick, "text", { x: 0, y: 0, "font-size": 10, "text-anchor": "middle" }, t);
        });
        const lg = el(svg, "g", { class: "key", transform: "translate(300,0)" });
        ["North", "South", "East", "West"].forEach((n, i) => {
            el(lg, "rect", { x: i * 90, y: 398, width: 10, height: 10 });
            el(lg, "text", { x: i * 90 + 14, y: 407, "font-size": 10 }, n);
        });
        return { svg, lg };
    }

    it("a key along the BOTTOM, over the tick row, is pushed DOWN and the viewBox grows in height", () => {
        const { svg, lg } = bottomChart();
        const res = reconcileLegendInSvg(svg);
        // The tick labels reach y=404; the key's top is 398: push (404 + 8) - 398 = 14, and 409 + 14 + 4 - 410 = 17.
        expect(res).toMatchObject({ applied: true, reason: "reserve", dx: 0, dy: 14, ext: 17, furniture: 1, source: "signature" });
        expect(lg.getAttribute("transform")).toBe("translate(0,14) translate(300,0)");
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 760, 427]);
        expect(userBox(lg)!.top).toBe(412);
    });

    it("the same key with the axis out of its way is left where it is: no-overlap", () => {
        const { svg, lg } = bottomChart();
        svg.querySelectorAll(".tick").forEach((t, i) => t.setAttribute("transform", `translate(${250 + i * 70},300)`));
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-overlap", source: "signature" });
        expect(lg.getAttribute("transform")).toBe("translate(300,0)");
    });

    it("a tick row that only brushes the key (1.5 units, under the 2-unit hairline) leaves it where it is", () => {
        const { svg, lg } = bottomChart();
        svg.querySelectorAll(".tick").forEach((t, i) => t.setAttribute("transform", `translate(${250 + i * 70},397.5)`));
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-overlap", source: "signature" });
        expect(lg.getAttribute("transform")).toBe("translate(300,0)");
    });

    it("a legend inset in the plot (not in a margin) is left alone: not-a-margin-legend", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const lg = key(svg, 200, 60);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "not-a-margin-legend", furniture: 1, source: "signature" });
        expect(lg.getAttribute("transform")).toBe("translate(200,60)");
        expect(viewBoxNumbers(svg)).toBeNull();
    });
});

describe("reconcileLegendInSvg - the zoom pad is helper furniture, never the legend", () => {
    it("THE CASE: the pad drawn BEFORE a flow map's key stays put, and the key is what slides", () => {
        const svg = makeSvg(760, 430);
        el(svg, "rect", { class: "d3-mark", x: 500, y: 60, width: 190, height: 60 });
        const p = pad(svg);
        const k = flowKey(svg);
        const res = reconcileLegendInSvg(svg);
        // The mark reaches 690, the key's left is 616: slide 690 + 8 - 616 = 82; its right edge, 700, + 82 + 4 is 26 past 760.
        expect(res).toMatchObject({ applied: true, reason: "reserve", dx: 82, ext: 26, newW: 786, furniture: 1, source: "signature" });
        expect(k.getAttribute("transform")).toBe("translate(82,0)");
        expect(p.getAttribute("transform")).toBeNull();
        for (const b of Array.from(p.children)) expect(b.getAttribute("transform")).toBeNull();
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 786, 430]);
    });

    it("a chart whose only signature-shaped group is the pad has no legend: no-legend", () => {
        const svg = makeSvg(760, 430);
        el(svg, "rect", { class: "d3-mark", x: 500, y: 60, width: 190, height: 60 });
        const p = pad(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-legend" });
        expect(res.source).toBeUndefined();
        expect(p.getAttribute("transform")).toBeNull();
    });

    it("a lone button group is excluded by its class as well", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const g = el(svg, "g", { class: "llm-zoom-btn", transform: "translate(700,60)" });
        el(g, "rect", { x: 0, y: 0, width: 10, height: 10 });
        el(g, "text", { x: 14, y: 9, "font-size": 10 }, "plus");
        el(g, "rect", { x: 0, y: 16, width: 10, height: 10 });
        el(g, "text", { x: 14, y: 25, "font-size": 10 }, "minus");
        expect(findSignatureLegendGroups(svg)).toEqual([]);
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: false, reason: "no-legend" });
    });

    it("an unclassed swatch legend beside the pad is still the legend, and the pad is not dragged along", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const p = pad(svg);
        const lg = key(svg, 700, 70);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, dx: 48, furniture: 1, source: "signature" });
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,70)");
        expect(p.getAttribute("transform")).toBeNull();
    });
});

describe("findSignatureLegendGroups - the finder's own rules", () => {
    it("finds a legend nested inside a wrapper that also holds the plot", () => {
        const svg = makeSvg(760, 430);
        const wrap = el(svg, "g", { class: "chart" });
        bars(wrap);
        const lg = key(wrap, 700, 60);
        expect(findSignatureLegendGroups(svg)).toEqual([lg]);
    });

    it("skips an axis block structurally (g.tick), even when its ticks look like swatch + label pairs", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const axis = el(svg, "g", { class: "y-axis-right", transform: "translate(700,60)" });
        for (let i = 0; i < 3; i++) {
            const tick = el(axis, "g", { class: "tick", transform: `translate(0,${i * 20})` });
            el(tick, "rect", { x: 0, y: 0, width: 6, height: 6 });
            el(tick, "text", { x: 9, y: 5, "font-size": 10 }, "t" + i);
        }
        expect(findSignatureLegendGroups(svg)).toEqual([]);
    });

    it("skips a group whose class names an axis, tick groups or not", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        key(svg, 700, 60, "color-axis-key");
        expect(findSignatureLegendGroups(svg)).toEqual([]);
    });

    it("a row of shapes of DIFFERENT sizes is a table row, not a legend", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const g = el(svg, "g", { class: "rows", transform: "translate(700,60)" });
        [[10, 10], [14, 14], [20, 20]].forEach(([w, h], i) => {
            el(g, "rect", { x: 0, y: i * 30, width: w, height: h });
            el(g, "text", { x: 26, y: i * 30 + 9, "font-size": 10 }, "row " + i);
        });
        expect(findSignatureLegendGroups(svg)).toEqual([]);
    });

    it("a single entry is below the floor of two pairs", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        key(svg, 700, 60, "key", ["Only"]);
        expect(findSignatureLegendGroups(svg)).toEqual([]);
    });

    it("a group of classed legend swatches alone is mark-free to the finder (legend marks are not plot marks)", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const g = el(svg, "g", { class: "legend", transform: "translate(700,60)" });
        ["a", "b"].forEach((n, i) => {
            el(g, "rect", { class: "d3-mark d3-legend-mark", x: 0, y: i * 16, width: 10, height: 10 });
            el(g, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, n);
        });
        expect(findSignatureLegendGroups(svg)).toEqual([g]);
    });

    it("a label that paints nothing is not a label (empty text has no box)", () => {
        const svg = makeSvg(760, 430);
        bars(svg);
        const g = el(svg, "g", { class: "key", transform: "translate(700,60)" });
        for (let i = 0; i < 3; i++) {
            el(g, "rect", { x: 0, y: i * 16, width: 10, height: 10 });
            el(g, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, "");
        }
        expect(findSignatureLegendGroups(svg)).toEqual([]);
    });
});
