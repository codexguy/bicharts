// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg } from "../../src/legendFit/legendReconcileDom";
import { installSvgLayout, el, makeSvg, viewBoxNumbers } from "./support/svgLayout";

// THE BOTTOM-TEXT PUSH.
//
// A binned bubble matrix drew its x-axis title at a fixed `plotH + 42`, which landed it ON TOP of the tick
// labels rather than below them. The content fit only prevents clipping, not this overlap, so a separate
// phase pushes a SPANNING axis-title / caption <text> down to sit below the deepest tick label it hit. It is
// conservative on purpose: only a bare <text> that is wider than tall and overlaps at least two tick
// labels moves (a per-item legend label would be detached from its swatch), the floor is the deepest tick
// the caption actually HIT (not the deepest on the page, which once pushed a y-axis title 200 px down),
// and a rotated text is never a caption. Reported as bt "movedN dyM"; when the pushed text now hangs
// past the frame the phase grows the viewBox itself, before the content fit runs.

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

/** Eight quarter labels on an x-axis; each text is 12 wide at x = 60 + 40 i, spanning abs y 323..333. */
function chart(h = 345): { svg: SVGSVGElement; ticks: Element[] } {
    const svg = makeSvg(700, h);
    const plot = el(svg, "g", { class: "plot" });
    el(plot, "rect", { class: "d3-mark", x: 60, y: 30, width: 300, height: 280 });
    const axis = el(svg, "g", { class: "x-axis", "text-anchor": "middle" });
    const ticks: Element[] = [];
    for (let i = 0; i < 8; i++) {
        const tick = el(axis, "g", { class: "tick", transform: `translate(${60 + i * 40},322)` });
        el(tick, "text", { y: 9, "font-size": 10 }, "Q" + (i + 1));
        ticks.push(tick);
    }
    return { svg, ticks };
}

function caption(svg: Element, text = "Quarter of the year", x = 200, y = 340, extra: Record<string, string | number> = {}): Element {
    return el(svg, "text", { x, y, "font-size": 10, "text-anchor": "middle", ...extra }, text);
}

describe("reconcileLegendInSvg - a spanning caption drawn over the tick labels is pushed below them", () => {
    it("THE CASE: pushed 7 below the deepest tick it hit, and the viewBox grows to hold it", () => {
        const { svg, ticks } = chart();
        const c = caption(svg);
        const res = reconcileLegendInSvg(svg);
        // The ticks' labels reach y=333; the caption's top is 332: (333 + 6) - 332 = 7. Its bottom, 342 + 7 = 349, is past 345.
        expect(res).toMatchObject({ applied: true, reason: "bottom-text", bt: "moved1 dy7" });
        expect(c.getAttribute("transform")).toBe("translate(0,7)");
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 700, 355]);
        expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
        // The phase grew the frame for the text it moved, so the content fit has nothing left to do.
        expect(res.fit).toBeUndefined();
        for (const t of ticks) expect(t.firstElementChild!.getAttribute("transform")).toBeNull();
    });

    it("no growth when the pushed text still fits: the viewBox is not touched", () => {
        const { svg } = chart(400);
        const c = caption(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "bottom-text", bt: "moved1 dy7" });
        expect(c.getAttribute("transform")).toBe("translate(0,7)");
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("the push composes with the caption's own transform", () => {
        const { svg } = chart(400);
        const c = caption(svg, "Quarter of the year", 100, 340, { transform: "translate(100,0)" });
        reconcileLegendInSvg(svg);
        expect(c.getAttribute("transform")).toBe("translate(0,7) translate(100,0)");
    });

    it("every spanning caption moves, and the report keeps the largest push", () => {
        const { svg } = chart(420);
        const a = caption(svg, "Quarter of the year", 200, 340);
        const b = caption(svg, "Fiscal quarter label", 200, 336);
        const res = reconcileLegendInSvg(svg);
        expect(res.bt).toBe("moved2 dy11");
        expect(a.getAttribute("transform")).toBe("translate(0,7)");
        expect(b.getAttribute("transform")).toBe("translate(0,11)");
    });

    it("a caption already seated below the tick labels is left where it is", () => {
        const { svg } = chart(400);
        const c = caption(svg, "Quarter of the year", 200, 362);
        const res = reconcileLegendInSvg(svg);
        expect(res.bt).toBeUndefined();
        expect(c.getAttribute("transform")).toBeNull();
    });

    it("a NARROW label over a single tick is left alone (a legend label would be torn from its swatch)", () => {
        const { svg } = chart(400);
        const c = caption(svg, "Q", 100, 340);
        const res = reconcileLegendInSvg(svg);
        expect(res.bt).toBeUndefined();
        expect(c.getAttribute("transform")).toBeNull();
    });

    it("a contract-classed mark label or legend label is never a caption", () => {
        const { svg } = chart(400);
        const a = caption(svg, "Quarter of the year", 200, 340, { class: "d3-mark" });
        const b = caption(svg, "Quarter of the year", 200, 340, { class: "d3-legend-mark" });
        expect(reconcileLegendInSvg(svg).bt).toBeUndefined();
        expect(a.getAttribute("transform")).toBeNull();
        expect(b.getAttribute("transform")).toBeNull();
    });

    it("no tick labels, no floor: nothing moves", () => {
        const svg = makeSvg(700, 400);
        const c = caption(svg);
        expect(reconcileLegendInSvg(svg).bt).toBeUndefined();
        expect(c.getAttribute("transform")).toBeNull();
    });
});

describe("reconcileLegendInSvg - what is NOT a bottom caption", () => {
    /** A y-axis of five wide labels ("10,000") 8 apart, left of the plot, and the x-axis ticks far below. */
    function withYAxis(): SVGSVGElement {
        const { svg } = chart(400);
        const y = el(svg, "g", { class: "y-axis", "text-anchor": "end" });
        for (let k = 0; k < 5; k++) {
            const tick = el(y, "g", { class: "tick", transform: `translate(50,${100 + k * 8})` });
            el(tick, "text", { x: -4, y: 3, "font-size": 10 }, "10,000");
        }
        return svg;
    }

    it("a y-axis title rotated -90 inside its own tick labels is taller than wide: left where it is, not sent below the x axis", () => {
        const svg = withYAxis();
        const t = el(svg, "text", { x: 0, y: 0, "font-size": 10, transform: "rotate(-90)", "data-box": "12,60,24,260" }, "Revenue (USD)");
        const res = reconcileLegendInSvg(svg);
        expect(res.bt).toBeUndefined();
        expect(t.getAttribute("transform")).toBe("rotate(-90)");
    });

    it("an ancestor's rotation never reaches the string; the measured box (taller than wide) refuses it", () => {
        const svg = withYAxis();
        const g = el(svg, "g", { transform: "rotate(-90)" });
        const t = el(g, "text", { x: 0, y: 0, "font-size": 10, "data-box": "12,60,24,260" }, "Revenue (USD)");
        expect(reconcileLegendInSvg(svg).bt).toBeUndefined();
        expect(t.getAttribute("transform")).toBeNull();
    });

    it("a wide box whose OWN transform says rotate is refused as well (the cheap second half)", () => {
        const svg = withYAxis();
        const t = el(svg, "text", { x: 14, y: 110, "font-size": 10, transform: "rotate(0)" }, "Revenue");
        expect(reconcileLegendInSvg(svg).bt).toBeUndefined();
        expect(t.getAttribute("transform")).toBe("rotate(0)");
    });

    it("the floor is the deepest tick the caption HIT, not the deepest on the page: a few units, not the x-axis depth", () => {
        const svg = withYAxis();
        const t = el(svg, "text", { x: 14, y: 110, "font-size": 10 }, "Revenue");
        const res = reconcileLegendInSvg(svg);
        // Hits the y labels at 100, 108 and 116 (the deepest ends at 121); the x-axis labels at 341 are not its floor.
        expect(res.bt).toBe("moved1 dy25");
        expect(t.getAttribute("transform")).toBe("translate(0,25)");
    });
});
