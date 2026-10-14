// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";

// <BicChart onSelectionGlyphs> is a pass-through to createChartHost's callback, held in a ref like onLabelContrast so
// the newest function is the one called without rebuilding the host. The glyph mode itself rides the options prop.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = `
window.__compiles = (window.__compiles || 0) + 1;
function render(container, data, options) {
  data.rows.forEach(function (r, i) {
    var m = container.ownerDocument.createElement("div");
    m.setAttribute("class", "d3-mark");
    m.setAttribute("data-row-idx", String(i));
    m.getBoundingClientRect = function () { return { left: 20 * i, top: 0, width: 10, height: 10, right: 20 * i + 10, bottom: 10, x: 20 * i, y: 0 }; };
    container.appendChild(m);
  });
}`;

const DATA = { columns: [{ name: "Region" }], rows: [["East"], ["West"]] } as any;
const D3 = {};

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

const clickMark = (i: number) =>
    el.querySelectorAll(".d3-mark")[i].dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("<BicChart onSelectionGlyphs>", () => {
    it("reports each glyph paint, and the newest callback is the one called, on the same host", async () => {
        const first: unknown[] = [];
        const second: unknown[] = [];
        const options = { selectionGlyph: "dot" };
        await act(async () => {
            root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, options, onSelectionGlyphs: r => { first.push(r); } }));
        });
        await act(async () => { clickMark(1); });
        expect(first).toEqual([{ mode: "dot", drawn: 1, total: 1, suppressed: false }]);
        await act(async () => {
            root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, options, onSelectionGlyphs: r => { second.push(r); } }));
        });
        await act(async () => { clickMark(0); });
        expect(second.length).toBeGreaterThanOrEqual(1);
        expect(first).toHaveLength(1);
        expect((window as any).__compiles).toBe(1);
    });
});
