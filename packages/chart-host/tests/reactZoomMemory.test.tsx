// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";
import { createZoomMemoryHook, type ZoomMemoryHook, type ZoomMemoryHost } from "../src/zoomMemory/zoomMemoryDom";

// <BicChart zoomMemory> is a pass-through to createChartHost's `zoomMemory`: the hook captures while the
// chart's code runs and restores after it draws. Absent, the binding hands the host nothing.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = `
function render(container, data, options) {
  container.appendChild(container.ownerDocument.createElement("div"));
}`;
const DATA = { columns: [{ name: "Region" }], rows: [["East"]] } as any;
const D3 = { zoom: () => ({}) };

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
});

function spyHook(): ZoomMemoryHook & { capture: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> } {
    return {
        keyFor: () => "k",
        capture: vi.fn(() => ({ behaviors: [], release: () => undefined })),
        restore: vi.fn(),
        flush: () => undefined,
        forget: () => undefined,
    };
}

describe("<BicChart zoomMemory>", () => {
    it("reaches the host: captured while the chart runs, restored after it draws", async () => {
        const hook = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, zoomMemory: hook })); });
        expect(hook.capture).toHaveBeenCalled();
        expect(hook.restore).toHaveBeenCalled();
        expect(hook.restore.mock.calls[0][0]).toBe(el.firstElementChild);
    });

    it("a hook that arrives after mount, or is replaced, rebuilds the host so the new hook is the one used", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3 })); });
        const late = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, zoomMemory: late })); });
        expect(late.capture).toHaveBeenCalled();
        expect(late.restore).toHaveBeenCalled();
        const swapped = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, zoomMemory: swapped })); });
        expect(swapped.restore).toHaveBeenCalled();
        const lateCalls = late.restore.mock.calls.length;
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: { ...DATA, rows: [["West"]] }, d3: D3, zoomMemory: swapped })); });
        expect(late.restore.mock.calls.length).toBe(lateCalls);     // the replaced hook is no longer called
    });

    it("a hook built inline over the SAME memory (createZoomMemoryHook(h) in the props) is the same hook: no rebuild per render", async () => {
        const compiles = () => (window as any).__zoomCompiles ?? 0;
        (window as any).__zoomCompiles = 0;
        const code = `window.__zoomCompiles = (window.__zoomCompiles || 0) + 1;
function render(container, data, options) { container.appendChild(container.ownerDocument.createElement("div")); }`;
        const memory = (): ZoomMemoryHost => ({
            liveZoomState: null, zoomWatchKey: "", zoomWatchAttached: false, zoomSettleTimer: 0, zoomContainer: null,
            rememberAcrossSessions: () => false, readPersistedZoom: () => null, persistZoom: () => undefined, log: () => undefined,
        });
        const h = memory();
        const draw = (rows: string[][]) => root.render(createElement(BicChart, { code, data: { ...DATA, rows }, d3: D3,
                                                                                 zoomMemory: createZoomMemoryHook(h) }));
        await act(async () => { draw([["East"]]); });
        await act(async () => { draw([["West"]]); });
        await act(async () => { draw([["North"]]); });
        expect(compiles()).toBe(1);
        // A hook over a DIFFERENT memory is a different hook: the host is rebuilt with it.
        await act(async () => { root.render(createElement(BicChart, { code, data: DATA, d3: D3, zoomMemory: createZoomMemoryHook(memory()) })); });
        expect(compiles()).toBe(2);
    });
});
