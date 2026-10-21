// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";
import type { ZoomMemoryHook } from "../src/zoomMemory/zoomMemoryDom";

// Props that arrive after the first render: data a page's query has not returned yet, and a zoom memory hook a page
// switches on later. Each must reach the host when it arrives.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COUNTED = `window.__lateCompiles = (window.__lateCompiles || 0) + 1;
function render(container, data, options) {
  var d = container.ownerDocument.createElement("div");
  d.className = "drawn";
  d.textContent = String(data.rows.length);
  container.appendChild(d);
}`;
const DATA = { columns: [{ name: "Region" }], rows: [["East"], ["West"]] } as any;
const D3 = { zoom: () => ({}) };
const compiles = () => (window as any).__lateCompiles ?? 0;
const drawn = () => el.querySelector(".drawn")?.textContent ?? null;

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (window as any).__lateCompiles = 0;
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

function spyHook(): ZoomMemoryHook & { capture: ReturnType<typeof vi.fn> } {
    return {
        keyFor: () => "k",
        capture: vi.fn(() => ({ behaviors: [], release: () => undefined })),
        restore: vi.fn(),
        flush: () => undefined,
        forget: () => undefined,
    };
}

describe("<BicChart> props that arrive late", () => {
    it("mounted with no data, it builds when the data arrives", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: undefined as any, d3: D3 })); });
        expect(compiles()).toBe(0);
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3 })); });
        expect(compiles()).toBe(1);
        expect(drawn()).toBe("2");
    });

    it("new data after the late build is a redraw, not a rebuild; data going away again keeps the chart", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: undefined as any, d3: D3 })); });
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3 })); });
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: { ...DATA, rows: [["North"]] }, d3: D3 })); });
        expect(compiles()).toBe(1);
        expect(drawn()).toBe("1");
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: undefined as any, d3: D3 })); });
        expect(compiles()).toBe(1);
        expect(drawn()).toBe("1");
    });

    it("a code change while there is no data, then the data: built once, with the new code", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3 })); });
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED + "\n// v2", data: undefined as any, d3: D3 })); });
        const before = compiles();
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED + "\n// v2", data: DATA, d3: D3 })); });
        expect(compiles()).toBe(before + 1);
        expect(drawn()).toBe("2");
    });

    it("zoomMemory={false} is no hook: the hook that arrives after it rebuilds the host and is used", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: false as any })); });
        expect(compiles()).toBe(1);
        const hook = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: hook })); });
        expect(compiles()).toBe(2);
        expect(hook.capture).toHaveBeenCalled();
    });

    it("zoomMemory={0} is no hook either", async () => {
        const hook = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: 0 as any })); });
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: hook })); });
        expect(hook.capture).toHaveBeenCalled();
    });

    // The README's promise: a page that needs a different hook at once remounts the chart with a `key`.
    it("a remount with a new key applies a different hook at once", async () => {
        const a = spyHook(), b = spyHook();
        await act(async () => { root.render(createElement(BicChart, { key: "a", code: COUNTED, data: DATA, d3: D3, zoomMemory: a })); });
        expect(a.capture).toHaveBeenCalledTimes(1);
        await act(async () => { root.render(createElement(BicChart, { key: "b", code: COUNTED, data: DATA, d3: D3, zoomMemory: b })); });
        expect(b.capture).toHaveBeenCalledTimes(1);
        expect(a.capture).toHaveBeenCalledTimes(1);
    });
});
