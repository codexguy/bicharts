// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";

// <BicChart layoutPass> is a pass-through to createChartHost's `layoutPass`: it runs after every paint, a
// re-render with new data reuses the host it was built with, and a new pass function is a rebuild (host
// config is read once, at creation), which is why the prop's docs say to build it once.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The code's top level runs once per compile, i.e. once per host built.
const CODE = `
window.__compiles = (window.__compiles || 0) + 1;
function render(container, data, options) {
  var p = container.ownerDocument.createElement("p");
  p.textContent = String(data.rows[0][0]);
  container.appendChild(p);
}`;

const DATA = { columns: [{ name: "Region" }], rows: [["East"]] } as any;
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

describe("<BicChart layoutPass>", () => {
    it("runs on the painted chart, and again on a data change, on the same host", async () => {
        const seen: string[] = [];
        const pass = (c: HTMLElement) => { seen.push(c.textContent ?? ""); };
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, layoutPass: pass })); });
        expect(seen.length).toBeGreaterThanOrEqual(1);
        expect(seen.at(-1)).toBe("East");
        await act(async () => {
            root.render(createElement(BicChart, { code: CODE, data: { ...DATA, rows: [["West"]] }, d3: D3, layoutPass: pass }));
        });
        expect(seen.at(-1)).toBe("West");
        expect((window as any).__compiles).toBe(1);
    });

    it("a new pass function rebuilds the host, so the new pass is the one that runs", async () => {
        const first: number[] = [];
        const second: number[] = [];
        await act(async () => {
            root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, layoutPass: () => { first.push(1); } }));
        });
        const firstCalls = first.length;
        await act(async () => {
            root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, layoutPass: () => { second.push(1); } }));
        });
        expect(second.length).toBeGreaterThanOrEqual(1);
        expect(first.length).toBe(firstCalls);
        expect((window as any).__compiles).toBe(2);
    });
});
