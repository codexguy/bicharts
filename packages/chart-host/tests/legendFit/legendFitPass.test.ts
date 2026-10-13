// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createLegendFitPass, type LegendFitReport } from "../../src/legendFit/index";
import { reconcileLegendInSvg } from "../../src/legendFit/legendReconcileDom";
import { fitTextToFrame } from "../../src/legendFit/frameFitDom";
import { installSvgLayout, el } from "./support/svgLayout";

// THE LEGEND-FIT PASS A HOST HANDS TO createChartHost.
//
// createLegendFitPass() is the two DOM passes in the order a host must run them - the legend reconcile on
// the chart's own svg, then the frame fit on the container, which measures what the legend pass left - with
// no policy and no logging of its own. These cases pin that it leaves exactly the DOM the two direct calls
// leave, that its options switch each half, that a table lane's frame is left alone, and that its report
// is one per run and can never break the pass. Driven on support/svgLayout.ts, so both passes really move.

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

const NARROW = { minOverlap: 16, maxGutterFraction: 0.2 };

/** A host div holding a 760 x 430 chart: two bars, a title, and a classed legend at x = legendX. */
function legendChart(legendX = 700): { host: HTMLElement; svg: SVGSVGElement; lg: Element } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("width", "760");
    svg.setAttribute("height", "430");
    host.appendChild(svg);
    const plot = el(svg, "g", { class: "plot" });
    el(plot, "rect", { class: "d3-mark", x: 60, y: 60, width: 680, height: 24 });
    el(plot, "rect", { class: "d3-mark", x: 60, y: 100, width: 480, height: 24 });
    el(svg, "text", { x: 20, y: 30, "font-size": 14 }, "Quarterly revenue");
    const lg = el(svg, "g", { class: "legend", transform: `translate(${legendX},60)` });
    ["Pending", "Shipped", "Delayed"].forEach((n, i) => {
        el(lg, "rect", { class: "d3-mark d3-legend-mark", x: 0, y: i * 16, width: 10, height: 10 });
        el(lg, "text", { x: 14, y: i * 16 + 9, "font-size": 10 }, n);
    });
    return { host, svg, lg };
}

/** A host div holding a chart svg with the given labels (no viewBox: generated code sets width / height only). */
function textChart(w: number, h: number, labels: Array<[string, number, number, string, number]>): { host: HTMLElement; svg: SVGSVGElement } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    host.appendChild(svg);
    for (const [text, x, y, anchor, fs] of labels) el(svg, "text", { x, y, "text-anchor": anchor, "font-size": fs }, text);
    return { host, svg };
}

/** A 7.5px caption flush with the frame's bottom edge: the frame fit grows the frame 1.5 units. */
const captionChart = () => textChart(690, 340, [
    ["Source: ERP extract, Q3", 10, 300, "start", 10],
    ["Source: ERP extract, Q3 (rounded)", 10, 339, "start", 7.5],
]);

/** An end-anchored KPI name running far off the left, beside a short one that only just hangs off. */
const kpiChart = () => textChart(1230, 626, [
    ["Customer Service Effort - Reduce effort to resolve a case", 228, 40, "end", 12],
    ["Customer effort", 40, 80, "end", 12],
]);

/** The same fixture twice: one through the pass, one through the direct calls, compared as markup. */
function sameDomAs(build: () => { host: HTMLElement; svg: SVGSVGElement }, pass: (c: HTMLElement) => void,
                   direct: (host: HTMLElement, svg: SVGSVGElement) => void): { viaPass: string; viaCalls: string } {
    const a = build();
    pass(a.host);
    const viaPass = a.host.innerHTML;
    a.host.remove();
    const b = build();
    direct(b.host, b.svg);
    const viaCalls = b.host.innerHTML;
    b.host.remove();
    return { viaPass, viaCalls };
}

describe("createLegendFitPass - the same DOM as the two passes called in order", () => {
    it("a legend that overlaps the plot: slid and the viewBox widened, exactly as the direct calls do", () => {
        const before = legendChart();
        const untouched = before.host.innerHTML;
        before.host.remove();
        const { viaPass, viaCalls } = sameDomAs(legendChart, createLegendFitPass(),
            (host, svg) => { reconcileLegendInSvg(svg, {}); fitTextToFrame(host); });
        expect(viaPass).toBe(viaCalls);
        expect(viaPass).not.toBe(untouched);   // the fixture really moves
        expect(viaPass).toContain("translate(48,0) translate(700,60)");
    });

    it("a caption past the frame's edge: the frame grown, exactly as the direct calls do", () => {
        const before = captionChart();
        const untouched = before.host.innerHTML;
        before.host.remove();
        const { viaPass, viaCalls } = sameDomAs(captionChart, createLegendFitPass(),
            (host, svg) => { reconcileLegendInSvg(svg, {}); fitTextToFrame(host); });
        expect(viaPass).toBe(viaCalls);
        expect(viaPass).not.toBe(untouched);
        expect(viaPass).toContain('viewBox="0 0 690 341.5"');
    });

    it("labels far off the left: whatever the legend pass's content fit leaves, the frame fit then measures, as the direct calls do", () => {
        const before = kpiChart();
        const untouched = before.host.innerHTML;
        before.host.remove();
        const { viaPass, viaCalls } = sameDomAs(kpiChart, createLegendFitPass(),
            (host, svg) => { reconcileLegendInSvg(svg, {}); fitTextToFrame(host); });
        expect(viaPass).toBe(viaCalls);
        expect(viaPass).not.toBe(untouched);
    });

    it('legend: "narrow" is the call with the narrow gates, and a small overlap it leaves alone the default slides', () => {
        // The bars end at 740; a legend at 730 overlaps them by 10, under the narrow 16-unit gate.
        const small = () => legendChart(730);
        const narrow = sameDomAs(small, createLegendFitPass({ legend: "narrow" }),
            (host, svg) => { reconcileLegendInSvg(svg, NARROW); fitTextToFrame(host); });
        expect(narrow.viaPass).toBe(narrow.viaCalls);
        const smart = sameDomAs(small, createLegendFitPass({ legend: "smart" }),
            (host, svg) => { reconcileLegendInSvg(svg, {}); fitTextToFrame(host); });
        expect(smart.viaPass).toBe(smart.viaCalls);
        expect(narrow.viaPass).not.toBe(smart.viaPass);
        expect(narrow.viaPass).toContain('transform="translate(730,60)"');
    });

    it("legend: false leaves the legend alone and still runs the frame fit", () => {
        const reports: LegendFitReport[] = [];
        const { host, svg, lg } = legendChart();
        createLegendFitPass({ legend: false, onReport: r => reports.push(r) })(host);
        expect(lg.getAttribute("transform")).toBe("translate(700,60)");
        expect(svg.getAttribute("data-lch-legend-fixed")).toBeNull();
        expect(reports[0].legend).toEqual({ skipped: "off" });
        expect(reports[0].frame).toHaveProperty("plan");
    });

    it("frameFit: false runs the legend pass only", () => {
        const reports: LegendFitReport[] = [];
        const { host, svg } = captionChart();
        createLegendFitPass({ frameFit: false, onReport: r => reports.push(r) })(host);
        expect(reports[0].frame).toEqual({ skipped: "off" });
        expect(svg.getAttribute("viewBox")).toBeNull();
        expect(reports[0].legend).toHaveProperty("reason");
    });
});

describe("createLegendFitPass - what it declines, and its report", () => {
    it("a table lane: the frame fit reports table-lane and changes nothing", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const table = document.createElement("table");
        const td = table.appendChild(document.createElement("tr")).appendChild(document.createElement("td"));
        const cell = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
        cell.setAttribute("width", "60");
        cell.setAttribute("height", "12");
        el(cell, "text", { x: 0, y: 14, "font-size": 10 }, "A cell label far past its little frame");
        td.appendChild(cell);
        host.appendChild(table);
        const before = host.innerHTML;
        const reports: LegendFitReport[] = [];
        createLegendFitPass({ legend: false, onReport: r => reports.push(r) })(host);
        expect(reports[0].frame).toEqual({ skipped: "table-lane" });
        expect(host.innerHTML).toBe(before);
    });

    it("no svg at all: both halves say so", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const reports: LegendFitReport[] = [];
        createLegendFitPass({ onReport: r => reports.push(r) })(host);
        expect(reports).toEqual([{ legend: { skipped: "no-svg" }, frame: { skipped: "nothing-to-measure" } }]);
    });

    it("one report per run, carrying each pass's own result", () => {
        const reports: LegendFitReport[] = [];
        const pass = createLegendFitPass({ onReport: r => reports.push(r) });
        const { host } = legendChart();
        pass(host);
        expect(reports).toHaveLength(1);
        expect(reports[0].legend).toMatchObject({ applied: true, reason: "reserve", dx: 48 });
        pass(host);                                      // a second run on the same svg: already fixed
        expect(reports).toHaveLength(2);
        expect(reports[1].legend).toMatchObject({ applied: false, reason: "already-fixed" });
    });

    it("a pass that throws inside is reported, never thrown, and the other half still runs", () => {
        const { host, svg } = legendChart();
        (svg as any).getAttribute = () => { throw new Error("detached"); };
        const reports: LegendFitReport[] = [];
        expect(() => createLegendFitPass({ onReport: r => reports.push(r) })(host)).not.toThrow();
        expect(reports[0].legend).toEqual({ error: "detached" });
        expect(reports[0].frame).toBeDefined();
    });

    it("a throwing onReport stays inside the pass", () => {
        const { host, lg } = legendChart();
        expect(() => createLegendFitPass({ onReport: () => { throw new Error("logger down"); } })(host)).not.toThrow();
        expect(lg.getAttribute("transform")).toBe("translate(48,0) translate(700,60)");
    });
});
