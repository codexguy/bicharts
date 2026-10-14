import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { planScrollRestore, AXIS_PIN_BAND_PAD_PX, type ScrollMetrics } from "../src/fit";
import { rememberScroll, takeScroll, fitRenderedChart } from "../src/fitDom";
import { CONTAINER_SLOT_SCROLL } from "../src/contract";

/*
    A REDRAW OF THE SAME CHART KEEPS THE READER'S SCROLL.

    Every host clears its container between renders, and a cleared container is scrolled to the
    top. That is right for a NEW chart - it must never open at the previous chart's offset - and
    wrong for the same chart drawn again after a resize, a filter or a theme switch: a reader
    halfway down a long schedule lost their place every time. The memory carries the identity of
    the chart it was made on, is applied only when that chart is back, only on an axis that still
    scrolls, clamped to what the new layout can scroll, and BEFORE the axis pin, which places its
    copy from the scroll position it finds.

    jsdom lays nothing out, so every box is stubbed: this proves the plan and the plumbing, never
    a pixel.
*/

const auto = (scrollHeight: number, clientHeight = 250, scrollWidth = 600, clientWidth = 600): ScrollMetrics => ({
    scrollWidth, scrollHeight, clientWidth, clientHeight,
    overflowX: scrollWidth > clientWidth ? "auto" : "hidden",
    overflowY: scrollHeight > clientHeight ? "auto" : "hidden",
});

describe("planScrollRestore", () => {
    it("the same chart back: the saved offset", () => {
        expect(planScrollRestore({ key: "code-a", x: 0, y: 300 }, "code-a", auto(2000))).toEqual({ x: 0, y: 300 });
    });

    it("a different chart, or no identity at all, opens at the origin", () => {
        expect(planScrollRestore({ key: "code-a", x: 0, y: 300 }, "code-b", auto(2000))).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore({ key: "code-a", x: 0, y: 300 }, null, auto(2000))).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore({ key: "code-a", x: 0, y: 300 }, undefined, auto(2000))).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore({ key: null, x: 0, y: 300 }, null, auto(2000))).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore(null, "code-a", auto(2000))).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore(undefined, "code-a", auto(2000))).toEqual({ x: 0, y: 0 });
    });

    it("identity is the key itself, so two functions with the same text are two charts", () => {
        const f = () => 0, g = () => 0;
        expect(planScrollRestore({ key: f, x: 0, y: 300 }, f, auto(2000))).toEqual({ x: 0, y: 300 });
        expect(planScrollRestore({ key: f, x: 0, y: 300 }, g, auto(2000))).toEqual({ x: 0, y: 0 });
    });

    it("clamps to what the new layout can scroll", () => {
        // A narrower filter left 600px of content in the same 250px frame: 350px of room.
        expect(planScrollRestore({ key: 1, x: 0, y: 1200 }, 1, auto(600))).toEqual({ x: 0, y: 350 });
        expect(planScrollRestore({ key: 1, x: 900, y: 0 }, 1, auto(250, 250, 1000, 600))).toEqual({ x: 400, y: 0 });
    });

    it("an axis that no longer scrolls gives 0 on that axis only", () => {
        expect(planScrollRestore({ key: 1, x: 120, y: 300 }, 1, auto(2000))).toEqual({ x: 0, y: 300 });
        expect(planScrollRestore({ key: 1, x: 120, y: 300 }, 1, auto(250, 250, 1000, 600))).toEqual({ x: 120, y: 0 });
        expect(planScrollRestore({ key: 1, x: 120, y: 300 }, 1, { ...auto(2000), overflowY: "hidden" })).toEqual({ x: 0, y: 0 });
    });

    it("NaN, negative and non-finite offsets or metrics give 0", () => {
        expect(planScrollRestore({ key: 1, x: NaN, y: -40 }, 1, auto(2000, 250, 1000))).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore({ key: 1, x: Infinity, y: Infinity }, 1, auto(2000, 250, 1000))).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore({ key: 1, x: "9" as unknown as number, y: 300 }, 1, auto(2000, 250, 1000))).toEqual({ x: 0, y: 300 });
        expect(planScrollRestore({ key: 1, x: 0, y: 300 }, 1, { ...auto(2000), scrollHeight: NaN })).toEqual({ x: 0, y: 0 });
        expect(planScrollRestore({ key: 1, x: 0, y: 300 }, 1, { ...auto(2000), clientHeight: -5 })).toEqual({ x: 0, y: 300 });
    });
});

// ---------------------------------------------------------------- the DOM half

let dom: JSDOM;
let doc: Document;
beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>");
    doc = dom.window.document;
});

const SVG_NS = "http://www.w3.org/2000/svg";
type Rect = { left: number; top: number; right: number; bottom: number };

/** A frame of w x h whose content is contentH tall. Its scroll is clamped the way a browser clamps it,
 *  and every stubbed box below moves with it, so a box read after a scroll is where a browser would put it. */
function frame(w: number, h: number, contentH: number) {
    const c = doc.createElement("div");
    let st = 0, sl = 0;
    const box = (r: Rect) => ({
        left: r.left - sl, top: r.top - st, right: r.right - sl, bottom: r.bottom - st,
        width: r.right - r.left, height: r.bottom - r.top, x: r.left - sl, y: r.top - st, toJSON: () => ({}),
    });
    (c as any).getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}) });
    Object.defineProperty(c, "clientWidth", { value: w, configurable: true });
    Object.defineProperty(c, "clientHeight", { value: h, configurable: true });
    Object.defineProperty(c, "scrollWidth", { value: w, configurable: true });
    Object.defineProperty(c, "scrollHeight", { value: contentH, configurable: true });
    Object.defineProperty(c, "scrollTop", { get: () => st, set: (v: number) => { st = Math.max(0, Math.min(v, contentH - h)); }, configurable: true });
    Object.defineProperty(c, "scrollLeft", { get: () => sl, set: (v: number) => { sl = Math.max(0, v); }, configurable: true });
    doc.body.appendChild(c);
    const el = (tag: string, r: Rect, attrs: Record<string, string> = {}) => {
        const e = doc.createElementNS(SVG_NS, tag);
        for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
        (e as any).getBoundingClientRect = () => box(r);
        return e;
    };
    return { c, el };
}

/** A 2,046px schedule in a 250px frame with its time axis at the bottom (y 2,004): the shape the axis pin serves. */
function schedule() {
    const { c, el } = frame(590, 250, 2046);
    const svg = el("svg", { left: 0, top: 0, right: 590, bottom: 2046 }) as SVGSVGElement;
    (svg as any).getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    svg.appendChild(el("rect", { left: 0, top: 0, right: 590, bottom: 2046 }, { fill: "#123456" }));
    const xAxis = el("g", { left: 158, top: 2004, right: 578, bottom: 2016 }, { class: "x-axis", transform: "translate(158,2004)" });
    xAxis.appendChild(el("path", { left: 158, top: 2004, right: 578, bottom: 2005 }, { class: "domain" }));
    for (let i = 0; i < 11; i++) {
        const tick = el("g", { left: 158 + i * 28, top: 2004, right: 198 + i * 28, bottom: 2016 }, { class: "tick" });
        const t = el("text", { left: 158 + i * 28, top: 2004, right: 198 + i * 28, bottom: 2016 });
        t.textContent = "M" + i;
        tick.appendChild(t);
        xAxis.appendChild(tick);
    }
    svg.appendChild(xAxis);
    c.appendChild(svg);
    return c;
}

const overlayOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-bic-axis-pin]");
const BAND = 12 + 2 * AXIS_PIN_BAND_PAD_PX;

describe("rememberScroll / takeScroll", () => {
    it("remembers a scrolled container with the chart's identity, and takeScroll removes it", () => {
        const c = schedule();
        c.scrollTop = 700;
        rememberScroll(c, "code-a");
        expect((c as any)[CONTAINER_SLOT_SCROLL]).toEqual({ key: "code-a", x: 0, y: 700 });
        expect(takeScroll(c)).toEqual({ key: "code-a", x: 0, y: 700 });
        expect(CONTAINER_SLOT_SCROLL in c).toBe(false);
        expect(takeScroll(c)).toBeNull();
    });

    it("keeps a memory already waiting: a second render that starts before the first restored sees an emptied container", () => {
        const c = schedule();
        c.scrollTop = 700;
        rememberScroll(c, "code-a");
        c.innerHTML = "";
        c.scrollTop = 0;
        c.appendChild(doc.createElement("div"));
        c.scrollTop = 40;
        rememberScroll(c, "code-a");
        expect(takeScroll(c)).toEqual({ key: "code-a", x: 0, y: 700 });
    });

    it("ignores a container the reader never scrolled", () => {
        const c = schedule();
        rememberScroll(c, "code-a");
        expect(CONTAINER_SLOT_SCROLL in c).toBe(false);
        expect(takeScroll(c)).toBeNull();
    });

    it("leaves a diagram that scrolls inside itself alone: it restores its own position", () => {
        const c = schedule();
        const pad = doc.createElement("div");
        pad.className = "llm-mm-scroll";
        c.appendChild(pad);
        c.scrollTop = 700;
        rememberScroll(c, "code-a");
        expect(takeScroll(c)).toBeNull();
    });

    it("no container is not an error", () => {
        expect(() => rememberScroll(null, "k")).not.toThrow();
        expect(takeScroll(undefined)).toBeNull();
    });
});

describe("fitRenderedChart restoreScroll", () => {
    it("restores the same chart's offset, reports it, and the axis pin is placed from the RESTORED position", () => {
        const c = schedule();
        const r = fitRenderedChart(c, { restoreScroll: { memory: { key: "code-a", x: 0, y: 1000 }, key: "code-a" } });
        expect(r.overflowY).toBe("auto");
        expect(r.scrolledTo).toEqual({ x: 0, y: 1000 });
        expect(c.scrollTop).toBe(1000);
        expect(r.axisPin.pinned).toBe(true);
        const o = overlayOf(c)!;
        expect(o.style.display).toBe("block");
        expect(o.style.top).toBe(`${1000 + 250 - BAND}px`);
    });

    it("clamps to the scroll the new layout has", () => {
        const c = schedule();
        const r = fitRenderedChart(c, { restoreScroll: { memory: { key: "k", x: 0, y: 5000 }, key: "k" } });
        expect(r.scrolledTo).toEqual({ x: 0, y: 2046 - 250 });
        expect(c.scrollTop).toBe(2046 - 250);
    });

    it("a different chart stays at the top", () => {
        const c = schedule();
        const r = fitRenderedChart(c, { restoreScroll: { memory: { key: "code-a", x: 0, y: 1000 }, key: "code-b" } });
        expect(r.scrolledTo).toEqual({ x: 0, y: 0 });
        expect(c.scrollTop).toBe(0);
        expect(overlayOf(c)!.style.top).toBe(`${250 - BAND}px`);
    });

    it("without the option nothing is restored and nothing is reported", () => {
        const c = schedule();
        const r = fitRenderedChart(c);
        expect(r.scrolledTo).toBeNull();
        expect(c.scrollTop).toBe(0);
    });

    it("a container whose scrolling the host owns is never scrolled", () => {
        const c = schedule();
        const r = fitRenderedChart(c, { applyOverflow: false, restoreScroll: { memory: { key: "k", x: 0, y: 1000 }, key: "k" } });
        expect(r.scrolledTo).toBeNull();
        expect(c.scrollTop).toBe(0);
    });
});
