// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";

// <BicChart restoreScroll> is a pass-through to createChartHost's `restoreScroll`. Default on: a data
// change repaints the same chart and the reader stays where they were. `false` leaves the scroll to the
// page. It is host config, read once at creation, so changing it rebuilds the host (as labelContrast does).
//
// jsdom lays nothing out: the chart's frame is stubbed to clamp its scroll the way a browser does, and
// the chart stubs the one box the fit reads (100px per row in a 250px frame).

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = `
window.__compiles = (window.__compiles || 0) + 1;
function render(container, data, options) {
  var h = data.rows.length * 100;
  var svg = container.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("data-h", String(h));
  svg.getBoundingClientRect = function () { return { left: 0, top: -container.scrollTop, right: 600, bottom: h - container.scrollTop,
                                                     width: 600, height: h, x: 0, y: -container.scrollTop, toJSON: function () { return {}; } }; };
  container.appendChild(svg);
}`;
const rows = (n: number, tag: string) => ({ columns: [{ name: "c" }], rows: Array.from({ length: n }, (_, i) => [tag + i, i]) }) as any;
const D3 = {};

/** Stub the chart's own div as a 600 x 250 frame whose scroll clamps to what is drawn in it. */
function asFrame(c: HTMLElement) {
    let st = 0;
    const contentH = () => {
        const svg = c.querySelector("svg[data-h]");
        return svg ? Math.max(250, Number(svg.getAttribute("data-h"))) : 250;
    };
    const clamp = () => { st = Math.max(0, Math.min(st, contentH() - 250)); };
    const inner = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
    Object.defineProperty(c, "innerHTML", { get: () => inner.get!.call(c), set: (v: string) => { inner.set!.call(c, v); clamp(); }, configurable: true });
    c.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 250, width: 600, height: 250, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(c, "clientWidth", { value: 600, configurable: true });
    Object.defineProperty(c, "clientHeight", { value: 250, configurable: true });
    Object.defineProperty(c, "scrollWidth", { get: () => 600, configurable: true });
    Object.defineProperty(c, "scrollHeight", { get: () => contentH(), configurable: true });
    Object.defineProperty(c, "scrollTop", { get: () => { clamp(); return st; }, set: (v: number) => { st = v; clamp(); }, configurable: true });
    return (y: number) => { st = y; clamp(); };
}

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    (window as any).__compiles = 0;
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

const chartDiv = () => el.firstElementChild as HTMLElement;

describe("<BicChart restoreScroll>", () => {
    it("default on: a data change repaints the same chart and the reader keeps their place", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "a"), d3: D3 })); });
        const readerScrolls = asFrame(chartDiv());
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "b"), d3: D3 })); });
        readerScrolls(700);
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "c"), d3: D3 })); });
        expect(chartDiv().scrollTop).toBe(700);
        expect((window as any).__compiles).toBe(1);
    });

    it("false: the scroll is the page's, so a repaint leaves it at the top", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "a"), d3: D3, restoreScroll: false })); });
        const readerScrolls = asFrame(chartDiv());
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "b"), d3: D3, restoreScroll: false })); });
        readerScrolls(700);
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "c"), d3: D3, restoreScroll: false })); });
        expect(chartDiv().scrollTop).toBe(0);
    });

    it("an inline renderFn (a new closure every parent render) rebuilds the host, and the reader still keeps their place", async () => {
        const draw = (container: HTMLElement, data: any) => {
            const h = data.rows.length * 100;
            const svg = container.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("data-h", String(h));
            (svg as any).getBoundingClientRect = () => ({ left: 0, top: -container.scrollTop, right: 600, bottom: h - container.scrollTop,
                                                          width: 600, height: h, x: 0, y: -container.scrollTop, toJSON: () => ({}) });
            container.appendChild(svg);
        };
        const props = (tag: string) => ({ renderFn: (c: HTMLElement, d: any) => draw(c, d), data: rows(20, tag), d3: D3 });
        await act(async () => { root.render(createElement(BicChart, props("a"))); });
        const readerScrolls = asFrame(chartDiv());
        readerScrolls(700);
        await act(async () => { root.render(createElement(BicChart, props("b"))); });
        expect(chartDiv().scrollTop).toBe(700);
    });

    it("changing it rebuilds the host, so the new setting is the one in force", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "a"), d3: D3 })); });
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: rows(20, "a"), d3: D3, restoreScroll: false })); });
        expect((window as any).__compiles).toBe(2);
    });
});
