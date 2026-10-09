// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg } from "../../src/legendFit/legendReconcileDom";
import { installSvgLayout, el, makeSvg, userBox, viewBoxNumbers, placeSvg, withholdCtm } from "./support/svgLayout";

// THE LEGEND SLIDE.
//
// A generated D3 chart can draw its legend on top of the plot, or with its text past the right edge, because
// the legend's width is only known after render. reconcileLegendInSvg measures the real boxes in the SVG's
// user space, slides the legend (and everything stacked in its column) right just far enough to clear the
// plot, and widens the viewBox just far enough to hold it. This file pins what that does to a rendered
// <svg>: the result object, the viewBox, the transforms it writes, and which elements it leaves alone. It
// drives the pass through the module's public export and a jsdom layout (support/svgLayout.ts) that moves a
// box when its transform moves and rescales every client box when the viewBox widens, so the pass's
// measure -> plan -> apply -> re-measure loop runs for real.
//
// The geometry used throughout: a 760 x 430 frame; two bars whose right edge is 740; a 3-entry legend whose
// swatch + label column is 56 wide and 43 tall. Slid from x=700 it must clear 740 + the 8-unit pad, so it
// moves 48; its right edge then sits at 804 + the 4-unit edge pad, 48 past the 760 frame.

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

function plot(svg: Element, right = 740): Element {
    const g = el(svg, "g", { class: "plot" });
    el(g, "rect", { class: "d3-mark", x: 60, y: 60, width: right - 60, height: 24 });
    el(g, "rect", { class: "d3-mark", x: 60, y: 100, width: 480, height: 24 });
    el(svg, "text", { x: 20, y: 30, "font-size": 14 }, "Quarterly revenue");
    return g;
}

function legend(parent: Element, x: number, y: number, names = ["Pending", "Shipped", "Delayed"], cls = "legend"): Element {
    const g = el(parent, "g", { class: cls, transform: `translate(${x},${y})` });
    names.forEach((n, i) => {
        el(g, "rect", { class: "d3-mark d3-legend-mark", x: 0, y: i * 16, width: 10, height: 10 });
        el(g, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, n);
    });
    return g;
}

function chart(legendAt: [number, number] = [700, 60], right = 740): { svg: SVGSVGElement; lg: Element } {
    const svg = makeSvg(760, 430);
    plot(svg, right);
    const lg = legend(svg, legendAt[0], legendAt[1]);
    return { svg, lg };
}

describe("reconcileLegendInSvg - a classed legend overlapping the plot slides right and the viewBox widens", () => {
    it("THE CASE: slides 48 to clear the bars + pad, widens the viewBox by 48, and reports it", () => {
        const { svg, lg } = chart();
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "reserve", dx: 48, ext: 48, newW: 808, furniture: 1, source: "class" });
        expect(res.dy).toBeUndefined();
        expect(svg.getAttribute("viewBox")).toBe("0 0 808 430");
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
    });

    it("the legend ends 8 units clear of the plot, and the plot did not move", () => {
        const { svg, lg } = chart();
        const bar = svg.querySelector(".plot rect")!;
        const before = userBox(bar);
        reconcileLegendInSvg(svg);
        expect(userBox(lg)!.left).toBe(748);
        expect(userBox(bar)).toEqual(before);
        expect(bar.getAttribute("transform")).toBeNull();
    });

    it("stamps the svg, writes the missing preserveAspectRatio, and keeps one that was already there", () => {
        const a = chart().svg;
        reconcileLegendInSvg(a);
        expect(a.getAttribute("data-lch-legend-fixed")).toBe("1");
        expect(a.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");

        const b = chart().svg;
        b.setAttribute("preserveAspectRatio", "xMinYMin meet");
        reconcileLegendInSvg(b);
        expect(b.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
    });

    it("a legend that still fits after its slide moves without widening anything", () => {
        const { svg, lg } = chart([600, 60], 620);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "reserve", dx: 28, ext: 0, newW: 760 });
        expect(svg.getAttribute("viewBox")).toBe("0 0 760 430");
        expect(lg.getAttribute("transform")).toBe("translate(28,0) translate(600,60)");
    });

    it("works in USER units whatever the rendered scale: the same chart at half size plans the same slide", () => {
        const svg = makeSvg(380, 215, "0 0 760 430");
        plot(svg);
        const lg = legend(svg, 700, 60);
        placeSvg(svg, 25, 40);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, dx: 48, ext: 48, newW: 808 });
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 808, 430]);
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
    });

    it("an svg with no viewBox gets one written from its width and height", () => {
        const { svg } = chart();
        expect(svg.getAttribute("viewBox")).toBeNull();
        reconcileLegendInSvg(svg);
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 808, 430]);
    });

    it("a viewBox with a non-zero origin keeps its origin", () => {
        const svg = makeSvg(760, 430, "-20 -10 760 430");
        plot(svg, 700);
        const lg = legend(svg, 660, 60);
        const res = reconcileLegendInSvg(svg);
        // plot right 700, legend left 660: slide 48; right 716 + 48 + 4 - (740) = 28.
        expect(res).toMatchObject({ applied: true, dx: 48, ext: 28, newW: 788 });
        expect(viewBoxNumbers(svg)).toEqual([-20, -10, 788, 430]);
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(660,60)");
    });
});

describe("reconcileLegendInSvg - what slides with the legend (the right-margin furniture)", () => {
    it("carries a second legend and a note in the same column, and leaves the title and plot callouts", () => {
        const { svg, lg } = chart();
        const second = legend(svg, 700, 160, ["EMEA", "APAC", "AMER"], "legend2");
        const note = el(svg, "text", { x: 706, y: 140, "font-size": 10 }, "Source");
        const callout = el(svg, "g", { class: "callout" });
        el(callout, "circle", { class: "d3-mark", cx: 720, cy: 300, r: 6 });
        const title = svg.querySelector("text")!;

        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, dx: 48, ext: 48, furniture: 3, source: "class" });
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
        expect(second.getAttribute("transform")).toBe("translate(48,0) translate(700,160)");
        expect(note.getAttribute("transform")).toBe("translate(48,0)");
        expect(callout.getAttribute("transform")).toBeNull();
        expect(title.getAttribute("transform")).toBeNull();
    });

    it("two legend groups that BOTH carry marks (the LCA is the svg) slide together by one delta", () => {
        const svg = makeSvg(760, 430);
        plot(svg);
        const a = legend(svg, 700, 60);
        const b = legend(svg, 700, 160, ["EMEA", "APAC", "AMER"], "legend2");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, dx: 48, ext: 48, furniture: 2, source: "class" });
        expect(a.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
        expect(b.getAttribute("transform")).toBe("translate(48,0) translate(700,160)");
    });

    it("a legend nested inside the plot group's SIBLING wrapper slides as one group", () => {
        const svg = makeSvg(760, 430);
        plot(svg);
        const wrap = el(svg, "g", { class: "chrome" });
        const lg = legend(wrap, 700, 60);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, dx: 48, source: "class" });
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
        expect(wrap.getAttribute("transform")).toBeNull();
    });

    it("a legend whose swatches live in the SAME group as the bars slides swatch by swatch, with its own labels only", () => {
        const svg = makeSvg(760, 430);
        const g = el(svg, "g", { class: "plot" });
        el(g, "rect", { class: "d3-mark", x: 60, y: 60, width: 665, height: 24 });
        // A plot annotation left of the swatch column, near the legend's rows: stays where it is.
        const avg = el(g, "text", { x: 640, y: 75, "font-size": 10 }, "Avg: 4.2");
        const swatches: Element[] = [], labels: Element[] = [];
        ["Pending", "Shipped", "Delayed"].forEach((n, i) => {
            swatches.push(el(g, "rect", { class: "d3-mark d3-legend-mark", x: 700, y: 60 + i * 16, width: 10, height: 10 }));
            labels.push(el(g, "text", { x: 714, y: 69 + i * 16, "font-size": 10 }, n));
        });
        const res = reconcileLegendInSvg(svg);
        // plot right: the bar at 725 and the annotation both sit left of the swatches; slide = 725 + 8 - 700.
        expect(res).toMatchObject({ applied: true, dx: 33, ext: 33, furniture: 6, source: "class" });
        for (const s of [...swatches, ...labels]) expect(s.getAttribute("transform"), s.outerHTML).toBe("translate(33,0)");
        expect(avg.getAttribute("transform")).toBeNull();
        expect(g.getAttribute("transform")).toBeNull();
        expect(g.querySelector("rect")!.getAttribute("transform")).toBeNull();
    });

    it("a container that holds legend marks AND a plot mark is not slid: reason impure-group", () => {
        const svg = makeSvg(760, 430);
        plot(svg);
        const a = legend(svg, 700, 60);
        el(a, "rect", { class: "d3-mark", x: -20, y: 0, width: 8, height: 40 });
        const b = legend(svg, 700, 160, ["EMEA", "APAC", "AMER"], "legend2");
        const res = reconcileLegendInSvg(svg);
        expect(res.applied).toBe(false);
        expect(res.reason).toBe("impure-group");
        expect(res.source).toBeUndefined();
        expect(a.getAttribute("transform")).toBe("translate(700,60)");
        expect(b.getAttribute("transform")).toBe("translate(700,160)");
        // The early return does not stamp, so a later render of the same svg can still try.
        expect(svg.getAttribute("data-lch-legend-fixed")).toBeNull();
    });
});

describe("reconcileLegendInSvg - when the plan declines, nothing moves and the reason says why", () => {
    it("nothing beside the legend: no-overlap", () => {
        const { svg, lg } = chart([700, 60], 640);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-overlap", furniture: 1, source: "class" });
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
        expect(viewBoxNumbers(svg)).toBeNull();
    });

    it("a hairline overlap (at or under 2 units) is ignored", () => {
        const { svg, lg } = chart([700, 60], 702);
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: false, reason: "no-overlap" });
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
    });

    it("a full-width backdrop that SPANS the legend is not a collision a gutter fixes", () => {
        const svg = makeSvg(760, 430);
        plot(svg, 760);
        const lg = legend(svg, 700, 60);
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: false, reason: "no-overlap" });
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
    });

    it("a legend in the LEFT of the canvas is not slid across the chart: not-right-legend", () => {
        const svg = makeSvg(760, 430);
        plot(svg, 400);
        const lg = legend(svg, 380, 60);
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: false, reason: "not-right-legend", source: "class" });
        expect(lg.getAttribute("transform")).toBe("translate(380,60)");
    });

    it("a wide, short strip is not a right-margin legend: not-vertical-legend", () => {
        const svg = makeSvg(760, 430);
        plot(svg);
        el(svg, "rect", { class: "d3-mark", x: 600, y: 65, width: 60, height: 10 });
        const lg = el(svg, "g", { class: "legend", transform: "translate(450,70)" });
        ["Pending", "Shipped", "Delayed", "Blocked"].forEach((n, i) => {
            el(lg, "rect", { class: "d3-mark d3-legend-mark", x: i * 75, y: 0, width: 10, height: 10 });
            el(lg, "text", { x: i * 75 + 14, y: 9, "font-size": 10 }, n);
        });
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: false, reason: "not-vertical-legend" });
        expect(lg.getAttribute("transform")).toBe("translate(450,70)");
    });

    it("the strictness options reach the plan: minOverlap, maxGutterFraction, pad and edgePad", () => {
        const strict = chart().svg;
        expect(reconcileLegendInSvg(strict, { minOverlap: 60 })).toMatchObject({ applied: false, reason: "no-overlap" });

        const small = chart();
        expect(reconcileLegendInSvg(small.svg, { maxGutterFraction: 0.05 })).toMatchObject({ applied: false, reason: "none-too-big" });
        expect(small.lg.getAttribute("transform")).toBe("translate(700,60)");

        const padded = chart();
        const res = reconcileLegendInSvg(padded.svg, { pad: 20, edgePad: 0 });
        // slide = 740 + 20 - 700 = 60; extension = 756 + 60 + 0 - 760 = 56.
        expect(res).toMatchObject({ applied: true, dx: 60, ext: 56, newW: 816 });
        expect(padded.lg.getAttribute("transform")).toBe("translate(60,0) translate(700,60)");
    });

    it("a declined slide leaves the legend, and a later phase that applies takes the reason (none-too-big is not reported then)", () => {
        // 200 wide: the extension the slide needs is far over 60% of the frame. The legend text also hangs
        // 6 units off the right edge, which the content fit rescues - and 'fit' is what the result says.
        const svg = makeSvg(200, 430);
        const g = el(svg, "g", { class: "plot" });
        el(g, "rect", { class: "d3-mark", x: 10, y: 60, width: 330, height: 24 });
        const lg = el(svg, "g", { class: "legend", transform: "translate(150,60)" });
        el(lg, "rect", { class: "d3-mark d3-legend-mark", x: 0, y: 0, width: 10, height: 10 });
        el(lg, "text", { x: 14, y: 9, "font-size": 10 }, "Pending");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "fit", fit: "L0 R10 T0 B0", source: "class" });
        expect(res.dx).toBeUndefined();
        expect(lg.getAttribute("transform")).toBe("translate(150,60)");
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 210, 430]);
    });
});

describe("reconcileLegendInSvg - the converge loop re-measures after every slide (at most three passes)", () => {
    // A label whose width is only known once the viewBox has moved: it answers a user-space box that depends
    // on the viewBox the svg has NOW, mapped through the CTM the svg has NOW - the layout feedback a real
    // browser gives and a first measurement cannot see.
    function lateLabel(svg: SVGSVGElement, userRight: (vbW: number) => number): Element {
        const t = el(svg, "text", { x: 0, y: 80, "font-size": 10 }, "late");
        (t as any).getBoundingClientRect = () => {
            const vbW = viewBoxNumbers(svg)?.[2] ?? 760;
            const right = userRight(vbW);
            const m = svg.getScreenCTM() as any;
            const a = new (globalThis as any).DOMPoint(right - 30, 72).matrixTransform(m);
            const b = new (globalThis as any).DOMPoint(right, 82).matrixTransform(m);
            return { left: a.x, top: a.y, right: b.x, bottom: b.y, width: b.x - a.x, height: b.y - a.y };
        };
        return t;
    }

    // (The late label hangs 17.5 inside the right edge, so the second slide is 50.5 and rounds up to 51 on
    // every machine: a whole-number edge would let the CTM round trip's noise decide the ceil.)
    it("a second pass corrects what the first could not see: reserve-x2, the deltas add and compose", () => {
        const { svg, lg } = chart();
        // Far left until the first slide widens the viewBox; then it hangs inside the new right edge.
        lateLabel(svg, vbW => (vbW > 760 && vbW < 850 ? vbW - 17.5 : 100));
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "reserve-x2", dx: 99, ext: 99, newW: 859, source: "class" });
        expect(lg.getAttribute("transform")).toBe("translate(51,0) translate(48,0) translate(700,60)");
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 859, 430]);
    });

    it("stops after three passes even if the layout keeps pushing back", () => {
        const { svg, lg } = chart();
        lateLabel(svg, vbW => (vbW > 760 ? vbW - 17.5 : 100));
        const res = reconcileLegendInSvg(svg);
        expect(res.reason).toBe("reserve-x3");
        expect(res.dx).toBe(150);
        expect(lg.getAttribute("transform")).toBe("translate(51,0) translate(51,0) translate(48,0) translate(700,60)");
        expect(svg.getAttribute("data-lch-legend-fixed")).toBe("1");
    });
});

describe("reconcileLegendInSvg - the early outs", () => {
    it("an svg already stamped is not touched at all, even when content hangs off it", () => {
        const { svg, lg } = chart();
        el(svg, "text", { x: -50, y: 200, "font-size": 10 }, "hanging label");
        svg.setAttribute("data-lch-legend-fixed", "1");
        expect(reconcileLegendInSvg(svg)).toEqual({ applied: false, reason: "already-fixed" });
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("a second call on the same svg is the already-fixed answer", () => {
        const { svg } = chart();
        reconcileLegendInSvg(svg);
        expect(reconcileLegendInSvg(svg)).toEqual({ applied: false, reason: "already-fixed" });
    });

    it("no legend at all: no-legend, stamped (the later phases still run)", () => {
        const svg = makeSvg(760, 430);
        plot(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-legend" });
        expect(res.source).toBeUndefined();
        expect(svg.getAttribute("data-lch-legend-fixed")).toBe("1");
    });

    it("legend marks but no plot marks: no-marks, stamped, and the source is named", () => {
        const svg = makeSvg(760, 430);
        const g = el(svg, "g", { class: "legend", transform: "translate(700,60)" });
        el(g, "rect", { class: "d3-legend-mark", x: 0, y: 0, width: 10, height: 10 });
        el(g, "text", { x: 14, y: 9, "font-size": 10 }, "Pending");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-marks", source: "class" });
        expect(svg.getAttribute("data-lch-legend-fixed")).toBe("1");
        expect(g.getAttribute("transform")).toBe("translate(700,60)");
    });

    it("no screen matrix: no-ctm, and no phase can apply without one", () => {
        const { svg, lg } = chart();
        withholdCtm(svg);
        expect(reconcileLegendInSvg(svg)).toEqual({ applied: false, reason: "no-ctm" });
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("no viewBox and no rendered size: no-viewbox", () => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
        document.body.appendChild(svg);
        plot(svg);
        const lg = legend(svg, 700, 60);
        expect(reconcileLegendInSvg(svg)).toEqual({ applied: false, reason: "no-viewbox" });
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
    });
});
