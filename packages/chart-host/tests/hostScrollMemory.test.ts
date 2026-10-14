// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { CONTAINER_SLOT_SCROLL } from "../src/contract";

// A REDRAW OF THE SAME CHART KEEPS THE READER'S SCROLL, in the host.
//
// The host empties its container on every render(), and a host that re-creates itself on every
// draw (destroy, then createChartHost on the same element) empties it twice. Both used to put a
// reader halfway down a long chart back at the top. The memory is parked on the CONTAINER, the
// one thing that outlives the host object, beside the session view-state; it is keyed by the
// chart (its code), so a different chart still opens at the top.
//
// jsdom lays nothing out: the frame below clamps its scroll the way a browser does (an emptied or
// shorter container cannot stay scrolled past its content) and the chart stubs the one box the
// fit reads. The chart draws 100px per row, so the same chart can be drawn taller or shorter.
//
// AND ONLY WHEN SOMETHING READS LAYOUT, as Chromium does: emptying the container clamps nothing by
// itself, so a chart drawn straight back into it, with no read in between, finds the old offset
// still there (measured: scrollTop 900, innerHTML = "", a 1,500px chart appended, scrollTop 900).
// A frame that clamped on the clear would hide a host that never puts a different chart at the top.

const chartCode = (tag: string, settle = "") => `function render(container, data, options) {
  const h = data.rows.length * 100;
  const svg = container.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-chart", "${tag}");
  svg.setAttribute("data-h", String(h));
  svg.getBoundingClientRect = () => ({ left: 0, top: -container.scrollTop, right: 600, bottom: h - container.scrollTop,
                                       width: 600, height: h, x: 0, y: -container.scrollTop, toJSON: () => ({}) });
  container.appendChild(svg);
  ${settle}
}`;
const CHART = chartCode("a");
const OTHER = chartCode("b");
const ASYNC = chartCode("async", "return new Promise(resolve => setTimeout(resolve, 0));");
const rows = (n: number) => ({ columns: [{ name: "c" }], rows: Array.from({ length: n }, (_, i) => ["r" + i, i]) });
const TALL = rows(20);   // 2,000px in a 250px frame
const MID = rows(6);     // 600px: 350px of scroll
const FITS = rows(2);    // 200px: no scroll at all

/** A 600 x 250 frame whose content is as tall as what the chart drew (250 when empty), with the
 *  scroll clamped to that the way a browser clamps it: on a layout read, never on the clear itself.
 *  `writes` records every scroll the HOST set. */
function frame() {
    const c = document.createElement("div");
    let st = 0, sl = 0;
    const writes: string[] = [];
    const contentH = () => {
        const svg = c.querySelector("svg[data-h]");
        return svg ? Math.max(250, Number(svg.getAttribute("data-h"))) : 250;
    };
    const clamp = () => { st = Math.max(0, Math.min(st, contentH() - 250)); };
    c.getBoundingClientRect = () => { clamp(); return ({ left: 0, top: 0, right: 600, bottom: 250, width: 600, height: 250, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect; };
    Object.defineProperty(c, "clientWidth", { value: 600, configurable: true });
    Object.defineProperty(c, "clientHeight", { value: 250, configurable: true });
    Object.defineProperty(c, "scrollWidth", { get: () => 600, configurable: true });
    Object.defineProperty(c, "scrollHeight", { get: () => { clamp(); return contentH(); }, configurable: true });
    Object.defineProperty(c, "scrollTop", {
        get: () => { clamp(); return st; },
        set: (v: number) => { writes.push(`top=${v}`); st = v; clamp(); },
        configurable: true,
    });
    Object.defineProperty(c, "scrollLeft", {
        get: () => sl, set: (v: number) => { writes.push(`left=${v}`); sl = Math.max(0, v); }, configurable: true,
    });
    // The reader's own scroll: what the wheel does, not counted as the host's write.
    const readerScrolls = (y: number) => { st = y; clamp(); };
    document.body.appendChild(c);
    return { c, writes, readerScrolls };
}

describe("the host keeps the reader's scroll across a redraw of the same chart", () => {
    let f: ReturnType<typeof frame>;
    beforeEach(() => { f = frame(); });
    afterEach(() => { f.c.remove(); });

    it("a re-render of the same host (a resize, a filter, a theme switch) keeps the offset", () => {
        const host = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        host.render();
        expect(f.c.style.overflowY).toBe("auto");
        f.readerScrolls(700);
        host.setOptions({ width: 600 });
        expect(f.c.scrollTop).toBe(700);
        host.setData(TALL);
        expect(f.c.scrollTop).toBe(700);
        expect(CONTAINER_SLOT_SCROLL in f.c).toBe(false);   // consumed, never left waiting
    });

    it("destroy and re-create on the SAME element (a host that rebuilds on every draw): the new host's first render restores", () => {
        const first = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        first.render();
        f.readerScrolls(700);
        first.destroy();
        expect(f.c.scrollTop).toBe(0);                      // the emptied container is at the top
        const second = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        second.render();
        expect(f.c.scrollTop).toBe(700);
    });

    it("a DIFFERENT chart on the same element opens at the top", () => {
        const first = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        first.render();
        f.readerScrolls(700);
        first.destroy();
        const fits: unknown[] = [];
        const second = createChartHost(f.c, { data: TALL, code: OTHER, d3: {}, onFit: r => fits.push(r.scrolledTo) });
        second.render();
        expect(f.c.scrollTop).toBe(0);
        expect(f.writes).toEqual(["top=0"]);                // put there: the clear alone left the old offset
        expect(fits).toEqual([{ x: 0, y: 0 }]);             // and what onFit reports is where it is
        expect(CONTAINER_SLOT_SCROLL in f.c).toBe(false);
    });

    it("a precompiled renderFn is keyed by its source: the same function and a closure rebuilt per draw restore, other code opens at the top", () => {
        const draw = (container: HTMLElement, tag = "a") => {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("data-h", "2000");
            svg.setAttribute("data-chart", tag);
            (svg as any).getBoundingClientRect = () => ({ left: 0, top: -container.scrollTop, right: 600, bottom: 2000 - container.scrollTop,
                                                          width: 600, height: 2000, x: 0, y: -container.scrollTop, toJSON: () => ({}) });
            container.appendChild(svg);
        };
        const a = createChartHost(f.c, { data: TALL, renderFn: draw, d3: {} });
        a.render();
        f.readerScrolls(700);
        a.destroy();
        const b = createChartHost(f.c, { data: TALL, renderFn: draw, d3: {} });
        b.render();
        expect(f.c.scrollTop).toBe(700);
        // A page (or <BicChart renderFn={(c, d, o) => draw(c, d, o)}>) that builds a new closure for every host: the
        // same drawing code, so a cross-filter that rebuilds the host leaves the reader where they were.
        // (Its source is not `draw`'s, so the first one is another chart.)
        const rebuilt = () => (el: HTMLElement) => draw(el);
        f.readerScrolls(500);
        b.destroy();
        const c2 = createChartHost(f.c, { data: TALL, renderFn: rebuilt(), d3: {} });
        c2.render();
        expect(f.c.scrollTop).toBe(0);
        f.readerScrolls(300);
        c2.destroy();
        const c3 = createChartHost(f.c, { data: TALL, renderFn: rebuilt(), d3: {} });
        c3.render();
        expect(f.c.scrollTop).toBe(300);
        // Different code is a different chart.
        f.readerScrolls(600);
        c3.destroy();
        const d = createChartHost(f.c, { data: TALL, renderFn: (el: HTMLElement) => draw(el, "b"), d3: {} });
        d.render();
        expect(f.c.scrollTop).toBe(0);
    });

    it("the same chart drawn shorter is clamped to what it can scroll; drawn so it fits, it stays at the top", () => {
        const host = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        host.render();
        f.readerScrolls(700);
        host.setData(MID);
        expect(f.c.scrollTop).toBe(350);
        host.setData(TALL);
        expect(f.c.scrollTop).toBe(350);                    // the restored offset is the reader's new place
        host.setData(FITS);
        expect(f.c.style.overflowY).toBe("hidden");
        expect(f.c.scrollTop).toBe(0);
    });

    it("fit: false consumes the memory without restoring, so it cannot surface on a later chart", () => {
        const first = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        first.render();
        f.readerScrolls(700);
        first.destroy();
        const second = createChartHost(f.c, { data: TALL, code: CHART, d3: {}, fit: false });
        second.render();
        expect(CONTAINER_SLOT_SCROLL in f.c).toBe(false);
        expect(f.writes).toEqual([]);
        f.readerScrolls(300);                               // where the reader leaves the SECOND chart
        second.destroy();
        const third = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        third.render();
        expect(f.c.scrollTop).toBe(300);                    // never the first host's 700
    });

    it("the first render of a new host does not capture a scroll it did not make", () => {
        // Content the app put there before the chart, scrolled: not the chart's.
        const pre = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        pre.setAttribute("data-h", "2000");
        f.c.appendChild(pre);
        f.readerScrolls(600);
        const host = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        host.render();
        expect(f.c.scrollTop).toBe(0);
    });

    it("two quick renders of an async chart keep the reader's FIRST offset", async () => {
        const host = createChartHost(f.c, { data: TALL, code: ASYNC, d3: {} });
        host.render();
        await host.rendered;
        f.readerScrolls(700);
        host.render();                                      // still drawing ...
        host.render();                                      // ... when this one clears it again
        await host.rendered;
        expect(f.c.scrollTop).toBe(700);
    });
});

describe("restoreScroll: false - a page that manages the container's scrolling itself", () => {
    let f: ReturnType<typeof frame>;
    beforeEach(() => { f = frame(); });
    afterEach(() => { f.c.remove(); });

    it("nothing is remembered or restored across a re-render or a re-creation", () => {
        const first = createChartHost(f.c, { data: TALL, code: CHART, d3: {}, restoreScroll: false });
        first.render();
        f.readerScrolls(700);
        first.render();
        // The host writes nothing: the offset is where the browser leaves it, which with no layout read
        // between the clear and the redraw is where it was.
        expect(f.c.scrollTop).toBe(700);
        f.readerScrolls(700);
        first.destroy();
        expect(CONTAINER_SLOT_SCROLL in f.c).toBe(false);
        const second = createChartHost(f.c, { data: TALL, code: CHART, d3: {}, restoreScroll: false });
        second.render();
        expect(f.c.scrollTop).toBe(700);
        expect(f.writes).toEqual([]);
    });

    it("a memory an earlier host left on the element is discarded, so it cannot surface later", () => {
        const first = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        first.render();
        f.readerScrolls(700);
        first.destroy();
        const off = createChartHost(f.c, { data: TALL, code: CHART, d3: {}, restoreScroll: false });
        off.render();
        expect(f.writes).toEqual([]);                       // the page's to manage: nothing written
        expect(CONTAINER_SLOT_SCROLL in f.c).toBe(false);
        off.destroy();
        const later = createChartHost(f.c, { data: TALL, code: CHART, d3: {} });
        later.render();
        expect(f.c.scrollTop).toBe(0);
    });

    it("the fit options the page passed reach the fit unchanged", () => {
        const fits: unknown[] = [];
        const host = createChartHost(f.c, { data: TALL, code: CHART, d3: {}, restoreScroll: false,
                                            fit: { pinAxis: false }, onFit: r => fits.push(r.scrolledTo) });
        host.render();
        f.readerScrolls(700);
        host.render();
        expect(fits).toEqual([null, null]);
    });
});

describe("a host whose container never scrolls is untouched", () => {
    it("byte-identical: no scroll written, no slot left, the same markup render after render and across a re-creation", () => {
        const f = frame();
        const first = createChartHost(f.c, { data: FITS, code: CHART, d3: {} });
        first.render();
        expect(f.c.style.overflowY).toBe("hidden");
        const once = f.c.outerHTML;
        first.render();
        expect(f.c.outerHTML).toBe(once);
        first.destroy();
        const second = createChartHost(f.c, { data: FITS, code: CHART, d3: {} });
        second.render();
        expect(f.c.outerHTML).toBe(once);
        expect(f.writes).toEqual([]);
        expect(Object.keys(f.c).filter(k => k.startsWith("__") && /scroll/i.test(k))).toEqual([]);
        f.c.remove();
    });
});
