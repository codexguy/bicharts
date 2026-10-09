// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg } from "../../src/legendFit/legendReconcileDom";
import { installSvgLayout, el, makeSvg, viewBoxNumbers } from "./support/svgLayout";

// THE PIPELINE AROUND THE PHASES.
//
// reconcileLegendInSvg runs six phases in a fixed order - legend slide, colorbar, axis-thin, label-thin,
// bottom-text, content fit - and each writes its own fields on the result (dx / cb / at + axisThin / lt +
// labelThin / bt / fit). `applied` is the OR of the six, and `reason` names the FIRST phase that applied, in
// that order. A chart that lays out its own scrolling HTML body skips every phase. A phase that throws
// leaves the others standing (all but the legend slide, which the caller wraps). The order matters: the
// axis pass hides labels BEFORE the bottom-text pass reads them, so a title is judged against the labels
// that survive. Driven through the module's public export on support/svgLayout.ts.

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A 760 x 430 chart with a classed legend at the right that overlaps the bars (slide 48, widen 48). */
function legendChart(): { svg: SVGSVGElement; lg: Element } {
    const svg = makeSvg(760, 430);
    const plot = el(svg, "g", { class: "plot" });
    el(plot, "rect", { class: "d3-mark", x: 60, y: 60, width: 680, height: 24 });
    const lg = el(svg, "g", { class: "legend", transform: "translate(700,60)" });
    ["Pending", "Shipped", "Delayed"].forEach((n, i) => {
        el(lg, "rect", { class: "d3-mark d3-legend-mark", x: 0, y: i * 16, width: 10, height: 10 });
        el(lg, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, n);
    });
    return { svg, lg };
}

function datesAxis(svg: Element, n = 11, y = 300): Element[] {
    const g = el(svg, "g", { class: "x-axis", "text-anchor": "middle" });
    const texts: Element[] = [];
    for (let i = 0; i < n; i++) {
        const tick = el(g, "g", { class: "tick", transform: `translate(${40 + i * 30},${y})` });
        el(tick, "line", { x1: 0, x2: 0, y1: 0, y2: 6 });
        texts.push(el(tick, "text", { y: 9, "font-size": 10 }, `${MONTHS[i]} 2026`));
    }
    return texts;
}

function hang(svg: Element): Element {
    return el(svg, "text", { x: -30, y: 100, "font-size": 10 }, "Outbound shipments");
}

/** A vertical gradient colorbar on a tile, the treemap-tile shape: slides 52, widens 42. */
function rightColorbar(svg: Element): Element {
    const defs = el(svg, "defs");
    el(defs, "linearGradient", { id: "g1" });
    const plot = el(svg, "g", { class: "plot" });
    el(plot, "rect", { class: "d3-mark", x: 20, y: 20, width: 540, height: 300 });
    const cbar = el(svg, "g", { class: "cbar", transform: "translate(520,60)" });
    el(cbar, "rect", { x: -4, y: -14, width: 70, height: 150, fill: "rgba(255,255,255,0.88)" });
    el(cbar, "rect", { x: 0, y: 0, width: 14, height: 120, fill: "url(#g1)" });
    el(cbar, "text", { x: 18, y: 8, "font-size": 10 }, "0");
    el(cbar, "text", { x: 18, y: 120, "font-size": 10 }, "100");
    return cbar;
}

function labelRow(svg: Element): Element {
    const g = el(svg, "g", { class: "cb", transform: "translate(40,380)" });
    el(g, "rect", { x: 0, y: -14, width: 120, height: 10, fill: "#cccccc" });
    [["210,000", 0, "start"], ["294,000", 60, "middle"], ["378,000", 120, "end"]].forEach(([t, x, a]) =>
        el(g, "text", { x: x as number, y: 10, "font-size": 10, "text-anchor": a as string }, t as string));
    return g;
}

describe("reconcileLegendInSvg - the result names the FIRST phase that applied, and every phase's own fields stay", () => {
    it("legend slide over the content fit", () => {
        const { svg, lg } = legendChart();
        hang(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "reserve", dx: 48, ext: 48, fit: "L34 R0 T0 B0" });
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
        // The fit re-measures on the widened frame: 808 + the 34 for the label.
        expect(viewBoxNumbers(svg)).toEqual([-34, 0, 842, 430]);
    });

    it("legend slide over the colorbar push", () => {
        const { svg, lg } = legendChart();
        el(svg, "rect", { class: "d3-mark", x: 600, y: 60, width: 140, height: 24 });
        const defs = el(svg, "defs");
        el(defs, "linearGradient", { id: "g1" });
        const axis = el(svg, "g", { class: "x-axis", "text-anchor": "middle" });
        for (let i = 0; i < 6; i++) {
            const tick = el(axis, "g", { class: "tick", transform: `translate(${120 + i * 100},340)` });
            el(tick, "text", { y: 10, "font-size": 10 }, "Q" + (i + 1));
        }
        const cbar = el(svg, "g", { class: "cbar", transform: "translate(200,348)" });
        el(cbar, "rect", { x: 0, y: 0, width: 200, height: 10, fill: "url(#g1)" });
        el(cbar, "text", { x: 0, y: 24, "font-size": 10 }, "Low");
        el(cbar, "text", { x: 200, y: 24, "font-size": 10, "text-anchor": "end" }, "High");
        const res = reconcileLegendInSvg(svg);
        expect(res.reason).toBe("reserve");
        expect(res.dx).toBe(48);
        expect(res.cb).toBe("dy12 h+0");
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
        expect(cbar.getAttribute("transform")).toBe("translate(0,12) translate(200,348)");
    });

    it("colorbar over the content fit", () => {
        const svg = makeSvg(600, 400);
        const cbar = rightColorbar(svg);
        hang(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "colorbar", cb: "dx52 w+42", fit: "L34 R0 T0 B0" });
        expect(cbar.getAttribute("transform")).toBe("translate(52,0) translate(520,60)");
    });

    it("colorbar over the axis-thin", () => {
        const svg = makeSvg(600, 400);
        rightColorbar(svg);
        const ticks = datesAxis(svg, 11, 360);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "colorbar", cb: "dx52 w+42", at: "axes1 hid5 k2" });
        expect(ticks.filter(t => t.getAttribute("display") === "none").length).toBe(5);
    });

    it("axis-thin over the label-thin", () => {
        const svg = makeSvg(700, 430);
        const ticks = datesAxis(svg, 11, 300);
        const row = labelRow(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "axis-thin", at: "axes1 hid5 k2", lt: "rows1 hid1 k0" });
        expect(ticks.filter(t => t.getAttribute("display") === "none").length).toBe(5);
        expect(row.querySelectorAll("[display=none]").length).toBe(1);
    });

    it("axis-thin over the bottom-text push", () => {
        const svg = makeSvg(700, 430);
        const ticks = datesAxis(svg, 11, 300);
        // 'Caption' spans x 109..151: it overlaps the labels that SURVIVE at ticks 2 and 4 (76..124, 136..184).
        const cap = el(svg, "text", { x: 130, y: 310, "font-size": 10, "text-anchor": "middle" }, "Caption");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "axis-thin", at: "axes1 hid5 k2", bt: "moved1 dy15" });
        expect(cap.getAttribute("transform")).toBe("translate(0,15)");
        expect(ticks[3].getAttribute("display")).toBe("none");
    });

    it("axis-thin over the content fit", () => {
        const svg = makeSvg(700, 430);
        datesAxis(svg, 11, 300);
        hang(svg);
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: true, reason: "axis-thin", at: "axes1 hid5 k2", fit: "L34 R0 T0 B0" });
    });

    it("label-thin over the content fit", () => {
        const svg = makeSvg(700, 430);
        labelRow(svg);
        hang(svg);
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: true, reason: "label-thin", lt: "rows1 hid1 k0", fit: "L34 R0 T0 B0" });
    });

    it("bottom-text over the content fit", () => {
        const svg = makeSvg(700, 400);
        const axis = el(svg, "g", { class: "x-axis", "text-anchor": "middle" });
        for (let i = 0; i < 8; i++) {
            const tick = el(axis, "g", { class: "tick", transform: `translate(${60 + i * 40},322)` });
            el(tick, "text", { y: 9, "font-size": 10 }, "Q" + (i + 1));
        }
        const cap = el(svg, "text", { x: 200, y: 340, "font-size": 10, "text-anchor": "middle" }, "Quarter of the year");
        hang(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "bottom-text", bt: "moved1 dy7", fit: "L34 R0 T0 B0" });
        expect(cap.getAttribute("transform")).toBe("translate(0,7)");
    });

    it("the unapplied fields are absent, not false: a pass that did nothing reports nothing", () => {
        const svg = makeSvg(760, 430);
        // The size is also declared inline: this repo's jsdom resolves a computed font size from the style, not the attribute.
        el(svg, "text", { x: 300, y: 200, "font-size": 10, style: "font-size:10px" }, "Plot");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: false, reason: "no-legend" });
        for (const k of ["dx", "dy", "ext", "newW", "cb", "bt", "at", "axisThin", "lt", "labelThin", "fit", "fitDeclined", "source"] as const) {
            expect(res[k], k).toBeUndefined();
        }
        // The one thing a pass that fitted nothing still reports is the smallest type it measured.
        expect(typeof res.smallestTextPx).toBe("number");
    });
});

describe("reconcileLegendInSvg - the axis pass runs BEFORE the bottom-text pass", () => {
    it("a caption over two colliding tick labels is judged against the one that survives: one hit, no push", () => {
        const svg = makeSvg(700, 430);
        const ticks = datesAxis(svg, 11, 300);
        // 'Sample' spans x 157..193: it overlaps the labels of ticks 4 and 5 (136..184, 166..214) and no other.
        const cap = el(svg, "text", { x: 175, y: 310, "font-size": 10, "text-anchor": "middle" }, "Sample");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "axis-thin", at: "axes1 hid5 k2" });
        expect(ticks[5].getAttribute("display")).toBe("none");
        expect(res.bt).toBeUndefined();
        expect(cap.getAttribute("transform")).toBeNull();
    });
});

describe("reconcileLegendInSvg - a chart that lays out its own scrolling HTML body is skipped whole", () => {
    function scrollChart(style: string): { svg: SVGSVGElement; lg: Element; fo: Element } {
        const { svg, lg } = legendChart();
        hang(svg);
        const fo = el(svg, "foreignObject", { x: 20, y: 20, width: 300, height: 200 });
        const div = document.createElement("div");
        div.setAttribute("style", style);
        fo.appendChild(div);
        return { svg, lg, fo };
    }

    it("THE CASE: a foreignObject holding an element with overflow-y:auto - nothing is slid, fitted or thinned", () => {
        const { svg, lg } = scrollChart("overflow-y:auto");
        expect(reconcileLegendInSvg(svg)).toEqual({ applied: false, reason: "self-managed-layout" });
        expect(svg.getAttribute("data-lch-legend-fixed")).toBe("1");
        expect(svg.getAttribute("viewBox")).toBeNull();
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
    });

    it("overflow:scroll and overflow-x:scroll count too, at any depth under the foreignObject", () => {
        for (const style of ["overflow:scroll", "overflow-x: scroll", "color:red; overflow-y: auto"]) {
            const { svg, fo } = scrollChart("");
            fo.firstElementChild!.removeAttribute("style");
            const inner = document.createElement("section");
            const deep = document.createElement("div");
            deep.setAttribute("style", style);
            inner.appendChild(deep);
            fo.firstElementChild!.appendChild(inner);
            expect(reconcileLegendInSvg(svg), style).toEqual({ applied: false, reason: "self-managed-layout" });
        }
    });

    it("a scroll rule that arrives from a stylesheet is read from the computed style", () => {
        const style = document.createElement("style");
        style.textContent = ".sb { overflow-y: auto; }";
        document.head.appendChild(style);
        const { svg, fo } = scrollChart("");
        fo.firstElementChild!.setAttribute("class", "sb");
        fo.firstElementChild!.removeAttribute("style");
        expect(reconcileLegendInSvg(svg)).toEqual({ applied: false, reason: "self-managed-layout" });
    });

    it("overflow:hidden is not a scrolling body: the passes run as usual", () => {
        const { svg, lg } = scrollChart("overflow:hidden");
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "reserve", dx: 48, fit: expect.stringMatching(/^L34/) });
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
    });

    it("a foreignObject with no scrolling child does not skip the passes, and a scrolling div OUTSIDE one does not either", () => {
        const { svg } = legendChart();
        const fo = el(svg, "foreignObject", { x: 20, y: 20, width: 300, height: 200 });
        fo.appendChild(document.createElement("div"));
        expect(reconcileLegendInSvg(svg)).toMatchObject({ applied: true, reason: "reserve" });

        const other = legendChart().svg;
        const holder = el(other, "g");
        const div = document.createElement("div");
        div.setAttribute("style", "overflow:auto");
        holder.appendChild(div);
        expect(reconcileLegendInSvg(other)).toMatchObject({ applied: true, reason: "reserve" });
    });
});

describe("reconcileLegendInSvg - a phase that throws leaves the rest of the pass standing", () => {
    function boom(t: Element): void { (t as any).getBoundingClientRect = () => { throw new Error("no layout for this one"); }; }

    it("a measurement that fails in the later phases is swallowed: the axis-thin result stands", () => {
        const svg = makeSvg(700, 430);
        const ticks = datesAxis(svg, 11, 300);
        boom(el(svg, "text", { x: 600, y: 100, "font-size": 10 }, "4,200"));
        let res: ReturnType<typeof reconcileLegendInSvg> | undefined;
        expect(() => { res = reconcileLegendInSvg(svg); }).not.toThrow();
        expect(res).toMatchObject({ applied: true, reason: "axis-thin", at: "axes1 hid5 k2" });
        expect(res!.lt).toBeUndefined();
        expect(res!.bt).toBeUndefined();
        expect(res!.fit).toBeUndefined();
        expect(ticks.filter(t => t.getAttribute("display") === "none").length).toBe(5);
    });

    it("with no phase left standing, a failing measurement still returns the no-legend answer", () => {
        const svg = makeSvg(700, 430);
        boom(el(svg, "text", { x: 100, y: 100, "font-size": 10 }, "4,200"));
        expect(reconcileLegendInSvg(svg)).toEqual({ applied: false, reason: "no-legend" });
    });

    it("the legend slide itself is NOT wrapped: its caller owns the try/catch", () => {
        const { svg } = legendChart();
        boom(el(svg, "text", { x: 100, y: 100, "font-size": 10 }, "stray"));
        expect(() => reconcileLegendInSvg(svg)).toThrow("no layout for this one");
    });
});
