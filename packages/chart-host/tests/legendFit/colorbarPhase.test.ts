// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg, findColorbarFurniture } from "../../src/legendFit/legendReconcileDom";
import { installSvgLayout, el, makeSvg, viewBoxNumbers } from "./support/svgLayout";

// THE COLORBAR PHASE.
//
// The generator leaves a colorbar UNCLASSED, so the class-based finder cannot see it. This phase finds it
// structurally - a <rect> filled url(#gradient) that is not a plot mark; its parent <g> is the colorbar
// group, carrying the ticks, the title and often a backing plate - and moves the group clear of what it is
// drawn over: DOWN when a horizontal bar in the bottom margin sits under the x-axis, RIGHT when a vertical
// bar is inset into the plot over marks. The right slide asks more of the evidence than the bottom push
// does (a mark must actually sit under the bar, and the browser's own isPointInFill must agree), because the
// corpus showed a bounding box alone moving charts that had no defect. Driven through the module's public
// exports on support/svgLayout.ts; reconcileLegendInSvg reports the move as cb ("dy12 h+10" / "dx52 w+42")
// and, when nothing earlier applied, as reason "colorbar".

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

function gradient(svg: Element, id = "g1", tag = "linearGradient"): void {
    const defs = el(svg, "defs");
    el(defs, tag, { id });
}

// A horizontal bar in the bottom margin under the x-axis tick row: the bar 200 wide at y 348, its
// "Low" / "High" labels under it; the tick labels reach y 352, so they overprint its top by 4.
function bottomChart(): { svg: SVGSVGElement; cbar: Element; bar: Element } {
    const svg = makeSvg(700, 380);
    gradient(svg);
    const plot = el(svg, "g", { class: "plot" });
    el(plot, "rect", { class: "d3-mark", x: 60, y: 40, width: 580, height: 290 });
    const axis = el(svg, "g", { class: "x-axis" });
    for (let i = 0; i < 6; i++) {
        const tick = el(axis, "g", { class: "tick", transform: `translate(${120 + i * 100},340)` });
        el(tick, "text", { x: 0, y: 10, "font-size": 10, "text-anchor": "middle" }, "Q" + (i + 1));
    }
    const cbar = el(svg, "g", { class: "cbar", transform: "translate(200,348)" });
    const bar = el(cbar, "rect", { x: 0, y: 0, width: 200, height: 10, fill: "url(#g1)" });
    el(cbar, "text", { x: 0, y: 24, "font-size": 10 }, "Low");
    el(cbar, "text", { x: 200, y: 24, "font-size": 10, "text-anchor": "end" }, "High");
    return { svg, cbar, bar };
}

// A vertical bar inset at the right of a treemap, on a white backing plate, over the tiles.
function rightChart(tileRight = 560): { svg: SVGSVGElement; cbar: Element; bar: Element; tile: Element } {
    const svg = makeSvg(600, 400);
    gradient(svg);
    const plot = el(svg, "g", { class: "plot" });
    const tile = el(plot, "rect", { class: "d3-mark", x: 20, y: 20, width: tileRight - 20, height: 300 });
    el(plot, "rect", { class: "d3-mark", x: 20, y: 330, width: 200, height: 50 });
    const cbar = el(svg, "g", { class: "cbar", transform: "translate(520,60)" });
    el(cbar, "rect", { x: -4, y: -14, width: 70, height: 150, fill: "rgba(255,255,255,0.88)" });
    const bar = el(cbar, "rect", { x: 0, y: 0, width: 14, height: 120, fill: "url(#g1)" });
    el(cbar, "text", { x: 18, y: 8, "font-size": 10 }, "0");
    el(cbar, "text", { x: 18, y: 120, "font-size": 10 }, "100");
    return { svg, cbar, bar, tile };
}

describe("reconcileLegendInSvg - a horizontal colorbar under the x-axis is pushed down", () => {
    it("THE CASE: pushed 12 clear of the tick row, the viewBox grows 10 in height, reason colorbar", () => {
        const { svg, cbar } = bottomChart();
        const res = reconcileLegendInSvg(svg);
        // Ticks reach 352, the group's top is 348: 352 + 8 - 348 = 12; the group's bottom, 374 + 12 + 4 - 380 = 10.
        expect(res).toMatchObject({ applied: true, reason: "colorbar", cb: "dy12 h+10" });
        expect(res.dx).toBeUndefined();
        expect(cbar.getAttribute("transform")).toBe("translate(0,12) translate(200,348)");
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 700, 390]);
        expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    });

    it("the whole group moves as one: bar, labels and every other child, with no per-child transform", () => {
        const { svg, cbar } = bottomChart();
        reconcileLegendInSvg(svg);
        for (const child of Array.from(cbar.children)) expect(child.getAttribute("transform")).toBeNull();
    });

    it("the axis and the plot do not move", () => {
        const { svg } = bottomChart();
        reconcileLegendInSvg(svg);
        expect(svg.querySelector(".plot rect")!.getAttribute("transform")).toBeNull();
        svg.querySelectorAll(".tick").forEach((t, i) => expect(t.getAttribute("transform")).toBe(`translate(${120 + i * 100},340)`));
    });

    it("a colorbar already seated below the tick row is left where it is", () => {
        const { svg, cbar } = bottomChart();
        cbar.setAttribute("transform", "translate(200,362)");
        const res = reconcileLegendInSvg(svg);
        expect(res.cb).toBeUndefined();
        expect(cbar.getAttribute("transform")).toBe("translate(200,362)");
    });

    it("a gradient strip in the middle of the canvas is nobody's margin furniture: not moved", () => {
        const { svg, cbar } = bottomChart();
        cbar.setAttribute("transform", "translate(200,150)");
        const res = reconcileLegendInSvg(svg);
        expect(res.cb).toBeUndefined();
        expect(cbar.getAttribute("transform")).toBe("translate(200,150)");
    });

    it("a push over the allowed fraction of the frame's height (maxGutterFraction) is declined", () => {
        const { svg, cbar } = bottomChart();
        const res = reconcileLegendInSvg(svg, { maxGutterFraction: 0.01 });
        expect(res.cb).toBeUndefined();
        expect(cbar.getAttribute("transform")).toBe("translate(200,348)");
    });
});

describe("reconcileLegendInSvg - a vertical colorbar drawn over the marks slides right", () => {
    it("THE CASE: the bar sits on a tile, so the group - plate included - slides 52 and the frame widens 42", () => {
        const { svg, cbar } = rightChart();
        const res = reconcileLegendInSvg(svg);
        // The tile reaches 560, the group's left is 516: 560 + 8 - 516 = 52; the plate's right, 586 + 52 + 4 - 600 = 42.
        expect(res).toMatchObject({ applied: true, reason: "colorbar", cb: "dx52 w+42" });
        expect(res.dy).toBeUndefined();
        expect(cbar.getAttribute("transform")).toBe("translate(52,0) translate(520,60)");
        expect(viewBoxNumbers(svg)).toEqual([0, 0, 642, 400]);
    });

    it("a colorbar parked in the gutter beside the marks is not covering anything: left alone", () => {
        const { svg, cbar } = rightChart(480);
        const res = reconcileLegendInSvg(svg);
        expect(res.cb).toBeUndefined();
        expect(res.applied).toBe(false);
        expect(cbar.getAttribute("transform")).toBe("translate(520,60)");
        expect(viewBoxNumbers(svg)).toBeNull();
    });

    it("a tile that only GRAZES the bar's edge is not occlusion", () => {
        const { svg, cbar } = rightChart(524);
        const res = reconcileLegendInSvg(svg);
        expect(res.cb).toBeUndefined();
        expect(cbar.getAttribute("transform")).toBe("translate(520,60)");
    });

    it("a box is not ink: the browser's isPointInFill saying 'nothing painted here' keeps the colorbar where it is", () => {
        const { svg, cbar, tile } = rightChart();
        (tile as any).isPointInFill = () => false;
        expect(reconcileLegendInSvg(svg).cb).toBeUndefined();
        expect(cbar.getAttribute("transform")).toBe("translate(520,60)");
    });

    it("isPointInFill saying 'painted' everywhere is the same answer as having no probe", () => {
        const { svg, cbar, tile } = rightChart();
        (tile as any).isPointInFill = () => true;
        expect(reconcileLegendInSvg(svg).cb).toBe("dx52 w+42");
        expect(cbar.getAttribute("transform")).toBe("translate(52,0) translate(520,60)");
    });

    it("a majority of the probes must hit ink: two of three probe columns do (10/15), one does not (5/15)", () => {
        // The bar spans x 520..534; its probe columns sit at 522.3, 527 and 531.7.
        const two = rightChart();
        (two.tile as any).isPointInFill = (p: { x: number }) => p.x < 528;
        expect(reconcileLegendInSvg(two.svg).cb).toBe("dx52 w+42");

        const one = rightChart();
        (one.tile as any).isPointInFill = (p: { x: number }) => p.x < 524;
        expect(reconcileLegendInSvg(one.svg).cb).toBeUndefined();
        expect(one.cbar.getAttribute("transform")).toBe("translate(520,60)");
    });

    it("a probe that throws counts as ink: the box stands (fail open on the evidence)", () => {
        const { svg, tile } = rightChart();
        (tile as any).isPointInFill = () => { throw new Error("unaskable"); };
        expect(reconcileLegendInSvg(svg).cb).toBe("dx52 w+42");
    });

    it("a stroke hit counts as ink too", () => {
        const { svg, tile } = rightChart();
        (tile as any).isPointInFill = () => false;
        (tile as any).isPointInStroke = () => true;
        expect(reconcileLegendInSvg(svg).cb).toBe("dx52 w+42");
    });
});

describe("findColorbarFurniture - the colorbar found by its gradient fill, not by a class", () => {
    it("no gradient defined anywhere: nothing", () => {
        const svg = makeSvg(600, 400);
        el(svg, "rect", { x: 0, y: 0, width: 10, height: 100, fill: "url(#g1)" });
        expect(findColorbarFurniture(svg)).toEqual({ groups: [], bars: [] });
    });

    it("a fill that names a gradient nobody defined is not a bar", () => {
        const svg = makeSvg(600, 400);
        gradient(svg, "g1");
        el(svg, "rect", { x: 0, y: 0, width: 10, height: 100, fill: "url(#other)" });
        el(svg, "rect", { x: 0, y: 0, width: 10, height: 100, fill: "#336699" });
        expect(findColorbarFurniture(svg).bars).toEqual([]);
    });

    it("the bar's PARENT <g> is the furniture; the bar itself is what gets measured", () => {
        const svg = makeSvg(600, 400);
        gradient(svg);
        const g = el(svg, "g", { class: "cb" });
        const bar = el(g, "rect", { width: 10, height: 100, fill: "url(#g1)" });
        const found = findColorbarFurniture(svg);
        expect(found.groups).toEqual([g]);
        expect(found.bars).toEqual([bar]);
    });

    it("a bar drawn directly under the svg is its own furniture", () => {
        const svg = makeSvg(600, 400);
        gradient(svg);
        const bar = el(svg, "rect", { width: 10, height: 100, fill: "url(#g1)" });
        expect(findColorbarFurniture(svg)).toEqual({ groups: [bar], bars: [bar] });
    });

    it("two bars in one group are one furniture group; a radial gradient counts as a gradient", () => {
        const svg = makeSvg(600, 400);
        gradient(svg, "g1");
        gradient(svg, "r1", "radialGradient");
        const g = el(svg, "g");
        const a = el(g, "rect", { width: 10, height: 100, fill: "url(#g1)" });
        const b = el(g, "rect", { width: 10, height: 100, fill: "url(#r1)" });
        const found = findColorbarFurniture(svg);
        expect(found.groups).toEqual([g]);
        expect(found.bars).toEqual([a, b]);
    });

    it("a gradient-filled PLOT MARK is a mark, not a bar - but one that is also a legend mark is a bar", () => {
        const svg = makeSvg(600, 400);
        gradient(svg);
        el(svg, "rect", { class: "d3-mark", width: 10, height: 100, fill: "url(#g1)" });
        expect(findColorbarFurniture(svg).bars).toEqual([]);
        const labelled = el(svg, "rect", { class: "d3-mark d3-legend-mark", width: 10, height: 100, fill: "url(#g1)" });
        expect(findColorbarFurniture(svg).bars).toEqual([labelled]);
    });
});
