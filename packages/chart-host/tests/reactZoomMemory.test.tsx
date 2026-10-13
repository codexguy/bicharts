// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";
import type { ZoomMemoryHook } from "../src/zoomMemory/zoomMemoryDom";

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
});
