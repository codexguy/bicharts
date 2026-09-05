import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import {
    isHorizontalLabelRow, labelBand, planAxisPin, axisPinPlacement,
    AXIS_PIN_BAND_PAD_PX, AXIS_PIN_MAX_BAND_FRACTION, type LabelRowBox,
} from "../src/fit";
import { pinScrolledAxis, unpinScrolledAxis, fitRenderedChart } from "../src/fitDom";

/*
    THE AXIS STAYS WHILE THE ROWS SCROLL (2026-09-04).

    The row-scrollable family sizes one <svg> to its content and lets the host scroll it. That is
    right for the rows and it takes the time axis with them: on three real 90-task schedule charts
    the axis was readable for about 2% of the scroll range - one wheel notch at one end. The pin
    copies the horizontal axis into an overlay that sits at the viewport edge nearest the original
    while the original is scrolled out, and gets out of the way when the original is back.

    THE CASE below is one of those charts, to its own numbers: 90 rows at 22px under a 24px
    header band, the axis drawn at the bottom (y = 2,004 of a 2,046px svg), the whole thing in a
    250px frame. jsdom lays nothing out, so every box is stubbed - which is honest for what is
    tested here: the arithmetic, the DOM the pass builds, and the placement rule.
*/

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------- pure geometry

const box = (left: number, top: number, right: number, bottom: number): LabelRowBox => ({ left, top, right, bottom });

// Eleven monthly labels 28px apart, 40 wide, 12 tall, on one baseline.
const bottomAxisLabels = (y = 2004) => Array.from({ length: 11 }, (_, i) => box(158 + i * 28, y, 198 + i * 28, y + 12));
// Ninety task labels down the left, 22px apart.
const taskLabels = () => Array.from({ length: 90 }, (_, i) => box(4, 24 + i * 22, 150, 36 + i * 22));

describe("isHorizontalLabelRow", () => {
    it("reads a row across the chart as horizontal and a column down it as not", () => {
        expect(isHorizontalLabelRow(bottomAxisLabels())).toBe(true);
        expect(isHorizontalLabelRow(taskLabels())).toBe(false);
    });

    it("is never an axis with one label - a caption has no direction", () => {
        expect(isHorizontalLabelRow([box(0, 0, 40, 12)])).toBe(false);
        expect(isHorizontalLabelRow([])).toBe(false);
    });

    it("calls a square spread vertical, which is the safe side: a y-axis is never pinned", () => {
        expect(isHorizontalLabelRow([box(0, 0, 10, 10), box(20, 20, 30, 30)])).toBe(false);
    });
});

describe("labelBand", () => {
    it("is the label row plus the pad", () => {
        const b = labelBand(bottomAxisLabels())!;
        expect(b.top).toBe(2004 - AXIS_PIN_BAND_PAD_PX);
        expect(b.bottom).toBe(2016 + AXIS_PIN_BAND_PAD_PX);
    });

    it("takes in a domain line sitting just above the labels", () => {
        // d3 puts the domain path 6-9px from the labels; it belongs to the header.
        const b = labelBand(bottomAxisLabels(), [box(158, 1996, 578, 1997)])!;
        expect(b.top).toBe(1996 - AXIS_PIN_BAND_PAD_PX);
    });

    it("ignores a track too far away to be the axis's own", () => {
        // A gridline 300px up is part of the plot; pulling it in would make the band the chart.
        const b = labelBand(bottomAxisLabels(), [box(158, 1700, 578, 1701)])!;
        expect(b.top).toBe(2004 - AXIS_PIN_BAND_PAD_PX);
    });

    it("answers null for nothing", () => {
        expect(labelBand([])).toBeNull();
    });
});

describe("planAxisPin", () => {
    it("THE CASE: pins the bottom time axis and leaves the ninety task labels alone", () => {
        const plan = planAxisPin([
            { index: 0, labels: taskLabels() },
            { index: 1, labels: bottomAxisLabels(), tracks: [box(158, 2004, 578, 2005)] },
        ], 250);
        expect(plan.pin).toBe(true);
        expect(plan.index).toBe(1);
        expect(plan.band).toEqual({ top: 2004 - AXIS_PIN_BAND_PAD_PX, bottom: 2016 + AXIS_PIN_BAND_PAD_PX });
    });

    it("refuses when the only axis runs down the chart - pinning it would pin the ROWS", () => {
        const plan = planAxisPin([{ index: 0, labels: taskLabels() }], 250);
        expect(plan.pin).toBe(false);
        expect(plan.reason).toBe("vertical-only");
    });

    it("refuses a chart with no axis at all", () => {
        expect(planAxisPin([], 250).reason).toBe("no-axis");
        expect(planAxisPin([{ index: 0, labels: [box(0, 0, 40, 12)] }], 250).reason).toBe("no-axis");
    });

    it("refuses a band that would eat the viewport", () => {
        const tall = Array.from({ length: 6 }, (_, i) => box(i * 60, 0, i * 60 + 40, 250 * AXIS_PIN_MAX_BAND_FRACTION + 20));
        expect(planAxisPin([{ index: 0, labels: tall }], 250).reason).toBe("band-too-tall");
    });

    it("prefers the horizontal axis with more labels - the one carrying the scale", () => {
        const plan = planAxisPin([
            { index: 0, labels: [box(0, 10, 40, 22), box(100, 10, 140, 22)] },
            { index: 1, labels: bottomAxisLabels() },
        ], 250);
        expect(plan.index).toBe(1);
    });

    it("degrades on an unmeasurable viewport", () => {
        expect(planAxisPin([{ index: 0, labels: bottomAxisLabels() }], 0).reason).toBe("unmeasurable");
        expect(planAxisPin([{ index: 0, labels: bottomAxisLabels() }], NaN).reason).toBe("unmeasurable");
    });
});

describe("axisPinPlacement", () => {
    const bottom = { top: 2002, bottom: 2018 };   // THE CASE, in content coordinates
    const top = { top: 14, bottom: 30 };          // the same chart drawn with its axis on top

    it("THE CASE: at the top of the scroll the bottom axis is below the fold, so the copy sits at the bottom edge", () => {
        expect(axisPinPlacement(bottom, 0, 250)).toBe("bottom");
        expect(axisPinPlacement(bottom, 1000, 250)).toBe("bottom");
    });

    it("gets out of the way once the original is in view", () => {
        expect(axisPinPlacement(bottom, 1796, 250)).toBeNull();   // the end of the scroll
        expect(axisPinPlacement(bottom, 1770, 250)).toBeNull();   // fully in view a little earlier
    });

    it("a top axis needs no copy at scrollTop 0 and a copy at the top edge once it is cut", () => {
        expect(axisPinPlacement(top, 0, 250)).toBeNull();
        expect(axisPinPlacement(top, 14, 250)).toBeNull();        // exactly at the edge: whole
        expect(axisPinPlacement(top, 15, 250)).toBe("top");       // one px cut: the copy takes over
        expect(axisPinPlacement(top, 900, 250)).toBe("top");
    });

    it("answers null on anything it cannot compare", () => {
        expect(axisPinPlacement(bottom, NaN, 250)).toBeNull();
        expect(axisPinPlacement(bottom, 0, 0)).toBeNull();
        expect(axisPinPlacement({ top: NaN, bottom: 10 }, 0, 250)).toBeNull();
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

function stub(el: Element, rect: Rect): Element {
    (el as any).getBoundingClientRect = () => asRect(rect);
    return el;
}

function svgEl(tag: string, rect: Rect, attrs: Record<string, string> = {}): Element {
    const e = doc.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    return stub(e, rect);
}

function container(w: number, h: number, contentH: number): HTMLElement {
    const c = doc.createElement("div");
    stub(c, { left: 0, top: 0, right: w, bottom: h });
    Object.defineProperty(c, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(c, "clientHeight", { value: h, configurable: true });
    Object.defineProperty(c, "scrollWidth", { value: w, configurable: true });
    Object.defineProperty(c, "scrollHeight", { value: contentH, configurable: true });
    let st = 0;
    Object.defineProperty(c, "scrollTop", { get: () => st, set: (v: number) => { st = v; }, configurable: true });
    doc.body.appendChild(c);
    return c;
}

const scrollTo = (c: HTMLElement, y: number) => { c.scrollTop = y; c.dispatchEvent(new dom.window.Event("scroll")); };

/** THE CASE as a DOM: the 2,046px chart svg with its axis at the bottom, in a 250px frame.
 *  Returns the pieces a test wants to poke. */
function schedule(opts: { axisY?: number; withCtm?: boolean; yAxisOnly?: boolean; noAxes?: boolean } = {}) {
    const axisY = opts.axisY ?? 2004;
    const c = container(590, 250, 2046);
    const svg = svgEl("svg", { left: 0, top: 0, right: 590, bottom: 2046 }, { "font-family": "Segoe UI" }) as SVGSVGElement;
    if (opts.withCtm !== false) (svg as any).getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    // The chart's own backdrop, the colour the copy must sit on.
    svg.appendChild(svgEl("rect", { left: 0, top: 0, right: 590, bottom: 2046 }, { fill: "#123456" }));
    // The plot group: bars (marks) and the today rule with its caption, which sits in the axis band.
    const plot = svgEl("g", { left: 158, top: 24, right: 578, bottom: 2004 }, { transform: "translate(158,24)" });
    for (let i = 0; i < 90; i++) {
        plot.appendChild(svgEl("rect", { left: 200, top: 26 + i * 22, right: 320, bottom: 42 + i * 22 }, { class: "d3-mark", "data-row-idx": String(i) }));
    }
    plot.appendChild(svgEl("line", { left: 400, top: 24, right: 401, bottom: 2004 }));
    const today = svgEl("text", { left: 402, top: axisY + 2, right: 432, bottom: axisY + 12 });
    today.textContent = "Today";
    plot.appendChild(today);
    // A data label INSIDE a mark group, at the band's height: never furniture.
    const markGroup = svgEl("g", { left: 200, top: axisY, right: 240, bottom: axisY + 12 }, { class: "d3-mark" });
    const dataLabel = svgEl("text", { left: 200, top: axisY + 2, right: 240, bottom: axisY + 12 });
    dataLabel.textContent = "42";
    markGroup.appendChild(dataLabel);
    plot.appendChild(markGroup);
    svg.appendChild(plot);
    if (!opts.noAxes) {
        // The y-axis: ninety task labels down the left.
        const yAxis = svgEl("g", { left: 4, top: 24, right: 150, bottom: 2004 }, { class: "y-axis" });
        for (let i = 0; i < 90; i++) {
            const tick = svgEl("g", { left: 4, top: 24 + i * 22, right: 150, bottom: 36 + i * 22 }, { class: "tick" });
            const t = svgEl("text", { left: 4, top: 24 + i * 22, right: 150, bottom: 36 + i * 22 });
            t.textContent = "Task " + i;
            tick.appendChild(t);
            yAxis.appendChild(tick);
        }
        svg.appendChild(yAxis);
        if (!opts.yAxisOnly) {
            // The x-axis, the way d3 emits it: a parent holding path.domain and .tick groups.
            const xAxis = svgEl("g", { left: 158, top: axisY, right: 578, bottom: axisY + 12 }, { class: "x-axis", transform: `translate(158,${axisY})` });
            xAxis.appendChild(svgEl("path", { left: 158, top: axisY, right: 578, bottom: axisY + 1 }, { class: "domain" }));
            for (let i = 0; i < 11; i++) {
                const tick = svgEl("g", { left: 158 + i * 28, top: axisY, right: 198 + i * 28, bottom: axisY + 12 }, { class: "tick" });
                tick.appendChild(svgEl("line", { left: 158 + i * 28, top: axisY, right: 159 + i * 28, bottom: axisY + 6 }));
                const t = svgEl("text", { left: 158 + i * 28, top: axisY, right: 198 + i * 28, bottom: axisY + 12 });
                t.textContent = "M" + i;
                tick.appendChild(t);
                xAxis.appendChild(tick);
            }
            svg.appendChild(xAxis);
        }
    }
    c.appendChild(svg);
    return { c, svg };
}

const overlayOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-bic-axis-pin]");

describe("pinScrolledAxis", () => {
    it("THE CASE: a bottom axis in a 250px frame is pinned at the bottom edge, with its caption, on the chart's own backdrop", () => {
        const { c, svg } = schedule();
        const r = pinScrolledAxis(c, svg);
        expect(r.pinned).toBe(true);
        expect(r.reason).toBe("pinned");
        expect(r.labels).toBe(11);
        expect(r.carried).toBe(1);            // "Today", and not the "42" inside a mark
        expect(r.bandPx).toBe(12 + 2 * AXIS_PIN_BAND_PAD_PX);
        expect(r.axisAt).toBe("bottom");
        expect(r.edge).toBe("bottom");        // scrollTop 0: the original is below the fold

        const o = overlayOf(c)!;
        expect(o).not.toBeNull();
        expect(c.lastElementChild).toBe(o);   // AFTER the chart svg: the first <svg> stays the chart
        expect(o.style.position).toBe("absolute");
        expect(o.style.display).toBe("block");
        expect(o.style.top).toBe(`${250 - r.bandPx}px`);
        expect(o.style.height).toBe(`${r.bandPx}px`);
        expect(o.style.pointerEvents).toBe("none");
        expect(c.style.position).toBe("relative");   // the overlay needs a containing block

        const pin = o.querySelector("svg")!;
        expect(pin.getAttribute("viewBox")).toBe(`0 ${2004 - AXIS_PIN_BAND_PAD_PX} 590 ${r.bandPx}`);
        expect(pin.getAttribute("preserveAspectRatio")).toBe("none");
        expect(pin.getAttribute("font-family")).toBe("Segoe UI");
        expect(pin.querySelector("rect")!.getAttribute("fill")).toBe("#123456");
        expect(pin.querySelectorAll(".tick text").length).toBe(11);
        expect(pin.querySelector(".x-axis")!.getAttribute("transform")).toBe("translate(158,2004)");
        const texts = Array.from(pin.querySelectorAll("text")).map(t => t.textContent);
        expect(texts).toContain("Today");
        expect(texts).not.toContain("42");
        expect(texts).not.toContain("Task 0");
        // The caption keeps its ancestor chain, so it lands where the original did.
        expect(pin.querySelector("g[transform='translate(158,24)'] text")!.textContent).toBe("Today");
    });

    it("gets out of the way when the original scrolls into view, and comes back when it leaves", () => {
        const { c, svg } = schedule();
        pinScrolledAxis(c, svg);
        const o = overlayOf(c)!;
        scrollTo(c, 1796);                    // the end of the scroll: the axis is on screen
        expect(o.style.display).toBe("none");
        scrollTo(c, 1000);
        expect(o.style.display).toBe("block");
        expect(o.style.top).toBe(`${1000 + 250 - (12 + 2 * AXIS_PIN_BAND_PAD_PX)}px`);
    });

    it("a top axis needs no copy at scrollTop 0, then pins at the top edge once it is cut", () => {
        const { c, svg } = schedule({ axisY: 16 });
        const r = pinScrolledAxis(c, svg);
        expect(r.pinned).toBe(true);
        expect(r.axisAt).toBe("top");
        expect(r.edge).toBeNull();
        const o = overlayOf(c)!;
        expect(o.style.display).toBe("none");
        scrollTo(c, 100);
        expect(o.style.display).toBe("block");
        expect(o.style.top).toBe("100px");
    });

    it("a second pass replaces the first: one overlay, one listener", () => {
        const { c, svg } = schedule();
        pinScrolledAxis(c, svg);
        pinScrolledAxis(c, svg);
        expect(c.querySelectorAll("[data-bic-axis-pin]").length).toBe(1);
        unpinScrolledAxis(c);
        expect(overlayOf(c)).toBeNull();
        expect(() => scrollTo(c, 500)).not.toThrow();
        expect(overlayOf(c)).toBeNull();
    });

    it("tears itself down when the host cleared the DOM under it", () => {
        const { c, svg } = schedule();
        pinScrolledAxis(c, svg);
        c.innerHTML = "";                     // the host's own clear between renders
        expect(() => scrollTo(c, 500)).not.toThrow();
        expect((c as any).__bicAxisPin).toBeUndefined();
    });

    it("never pins a y-axis: a chart with only task labels is left alone", () => {
        const { c, svg } = schedule({ yAxisOnly: true });
        const r = pinScrolledAxis(c, svg);
        expect(r.pinned).toBe(false);
        expect(r.reason).toBe("vertical-only");
        expect(overlayOf(c)).toBeNull();
    });

    it("degrades on a chart with no axis, and on one it cannot map to the screen", () => {
        const a = schedule({ noAxes: true });
        expect(pinScrolledAxis(a.c, a.svg).reason).toBe("no-axis");
        expect(overlayOf(a.c)).toBeNull();
        const b = schedule({ withCtm: false });
        expect(pinScrolledAxis(b.c, b.svg).reason).toBe("no-ctm");
        expect(overlayOf(b.c)).toBeNull();
        expect(pinScrolledAxis(b.c, null).reason).toBe("no-svg");
        expect(pinScrolledAxis(null, b.svg).reason).toBe("no-container");
    });

    it("labels the chart itself clips at its frame do not keep the copy up at the end of the scroll", () => {
        // Seen on two real charts: rotated month labels descend a few px past the svg's declared
        // height. The svg clips them, so the reader never sees that part - but an unclamped band
        // reached past the frame, never fit the viewport, and the copy stayed over an original
        // that was already fully on screen.
        const { c, svg } = schedule({ axisY: 2040 });          // labels 2040..2052 in a 2046 frame
        const r = pinScrolledAxis(c, svg);
        expect(r.pinned).toBe(true);
        expect(r.bandPx).toBe(2046 - (2040 - AXIS_PIN_BAND_PAD_PX));
        const o = overlayOf(c)!;
        expect(o.style.display).toBe("block");                  // scrollTop 0: below the fold
        scrollTo(c, 1796);                                      // the end: the original shows
        expect(o.style.display).toBe("none");
    });

    it("skips labels the axis-thinning pass hid, so the copy inherits the stride", () => {
        const { c, svg } = schedule();
        const texts = svg.querySelectorAll(".x-axis .tick text");
        for (let i = 1; i < texts.length; i += 2) texts[i].setAttribute("display", "none");
        const r = pinScrolledAxis(c, svg);
        expect(r.labels).toBe(6);
        const pin = overlayOf(c)!.querySelector("svg")!;
        expect(pin.querySelectorAll(".tick text[display='none']").length).toBe(5);
    });
});

describe("fitRenderedChart pins only when the container actually scrolls", () => {
    it("THE CASE through the one host call: overflow auto, and the axis pinned", () => {
        const { c } = schedule();
        const r = fitRenderedChart(c);
        expect(r.overflowY).toBe("auto");
        expect(r.axisPin.pinned).toBe(true);
        expect(r.axisPin.edge).toBe("bottom");
        expect(overlayOf(c)).not.toBeNull();
    });

    it("a chart that fits gets no overlay and says why", () => {
        const c = container(600, 400, 400);
        const svg = svgEl("svg", { left: 0, top: 0, right: 600, bottom: 400 }) as SVGSVGElement;
        (svg as any).getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        c.appendChild(svg);
        const r = fitRenderedChart(c);
        expect(r.overflowY).toBe("hidden");
        expect(r.axisPin.pinned).toBe(false);
        expect(r.axisPin.reason).toBe("not-scrolling");
        expect(overlayOf(c)).toBeNull();
    });

    it("can be switched off by a host that draws its own header", () => {
        const { c } = schedule();
        const r = fitRenderedChart(c, { pinAxis: false });
        expect(r.overflowY).toBe("auto");
        expect(r.axisPin.reason).toBe("disabled");
        expect(overlayOf(c)).toBeNull();
    });

    it("does not pin on a container whose scrolling the host owns", () => {
        const { c } = schedule();
        const r = fitRenderedChart(c, { applyOverflow: false });
        expect(r.axisPin.reason).toBe("overflow-not-applied");
        expect(overlayOf(c)).toBeNull();
    });
});
