// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";

// <BicChart builtForRows onRowGrowth> is a pass-through to createChartHost; the newest props win without a rebuild.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement('div');
    m.setAttribute('class', 'd3-mark');
    m.setAttribute('data-row-idx', String(r));
    container.appendChild(m);
  }
}`;
const data = (n: number) => ({ columns: [{ name: "Region" }], rows: Array.from({ length: n }, (_, i) => [`R${i}`]) }) as any;
const D3 = {};   // ONE d3 object: a new literal per render rebuilds the host

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
    vi.restoreAllMocks();
});

describe("<BicChart builtForRows onRowGrowth>", () => {
    it("calls onRowGrowth when the rows drawn far outnumber builtForRows", async () => {
        const fn = vi.fn();
        await act(async () => { root.render(createElement(BicChart, { code: CHART, data: data(600), d3: D3, builtForRows: 12, onRowGrowth: fn })); });
        expect(fn).toHaveBeenCalled();
        expect(fn.mock.calls[0][0]).toMatchObject({ builtFor: 12, rendered: 600 });
    });
    it("uses the newest builtForRows without a rebuild", async () => {
        const fn = vi.fn();
        await act(async () => { root.render(createElement(BicChart, { code: CHART, data: data(600), d3: D3, builtForRows: 12, onRowGrowth: fn })); });
        fn.mockClear();
        await act(async () => { root.render(createElement(BicChart, { code: CHART, data: data(601), d3: D3, builtForRows: 12000, onRowGrowth: fn })); });
        expect(fn).not.toHaveBeenCalled();
    });
    it("an absent callback stays absent: the console hears it once", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await act(async () => { root.render(createElement(BicChart, { code: CHART, data: data(600), d3: D3, builtForRows: 12 })); });
        expect(warn.mock.calls.filter(a => String(a[0]).includes("now showing 600")).length).toBe(1);
    });
});
