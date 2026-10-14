// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";
import { createZoomMemoryHook, type ZoomMemoryHook, type ZoomMemoryHost } from "../src/zoomMemory/zoomMemoryDom";

// <BicChart zoomMemory> is a pass-through to createChartHost's `zoomMemory`: the hook captures while the
// chart's code runs and restores after it draws. Absent, the binding hands the host nothing. The prop is host
// config read when the host is built: it rebuilds the host when it arrives or goes away, and a change from one
// hook to another is ignored, so a hook written inline in the props costs nothing.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = `
function render(container, data, options) {
  container.appendChild(container.ownerDocument.createElement("div"));
}`;
// Counts how many times the chart was compiled, which is once per host built.
const COUNTED = `window.__zoomCompiles = (window.__zoomCompiles || 0) + 1;
function render(container, data, options) { container.appendChild(container.ownerDocument.createElement("div")); }`;
// A chart with something zoomed in it, for the watcher to read back.
const ZOOMED = `
function render(container, data, options) {
  var pad = container.ownerDocument.createElement("div");
  pad.className = "pad";
  container.appendChild(pad);
  pad.__zoom = { k: 1, x: 0, y: 0 };
}`;
const DATA = { columns: [{ name: "Region" }], rows: [["East"]] } as any;
const D3 = { zoom: () => ({}) };
const compiles = () => (window as any).__zoomCompiles ?? 0;

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    (window as any).__zoomCompiles = 0;
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    vi.useRealTimers();
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

const memory = (over: Partial<ZoomMemoryHost> = {}): ZoomMemoryHost => ({
    liveZoomState: null, zoomWatchKey: "", zoomWatchAttached: false, zoomSettleTimer: 0, zoomContainer: null,
    rememberAcrossSessions: () => false, readPersistedZoom: () => null, persistZoom: () => undefined, log: () => undefined,
    ...over,
});

describe("<BicChart zoomMemory>", () => {
    it("reaches the host: captured while the chart runs, restored after it draws", async () => {
        const hook = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: CODE, data: DATA, d3: D3, zoomMemory: hook })); });
        expect(hook.capture).toHaveBeenCalled();
        expect(hook.restore).toHaveBeenCalled();
        expect(hook.restore.mock.calls[0][0]).toBe(el.firstElementChild);
    });

    it("a hook that arrives after mount rebuilds the host once, so it is the one used; a different hook after that is ignored", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3 })); });
        expect(compiles()).toBe(1);
        const late = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: late })); });
        expect(compiles()).toBe(2);
        expect(late.capture).toHaveBeenCalled();
        expect(late.restore).toHaveBeenCalled();
        const other = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: other })); });
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: { ...DATA, rows: [["West"]] }, d3: D3, zoomMemory: other })); });
        expect(compiles()).toBe(2);                                  // no rebuild: the host keeps the hook it was built with
        expect(other.restore).not.toHaveBeenCalled();
        expect(late.restore.mock.calls.length).toBeGreaterThan(1);   // and a new payload is still drawn through it
    });

    it("a hook that goes away rebuilds the host without it", async () => {
        const hook = spyHook();
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: hook })); });
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3 })); });
        expect(compiles()).toBe(2);
        const calls = hook.restore.mock.calls.length;
        await act(async () => { root.render(createElement(BicChart, { code: COUNTED, data: { ...DATA, rows: [["West"]] }, d3: D3 })); });
        expect(hook.restore.mock.calls.length).toBe(calls);          // nothing is remembered any more
    });

    it("a hook and its memory written inline in the props are new on every render and rebuild nothing", async () => {
        const draw = (rows: string[][]) => root.render(createElement(BicChart, {
            code: COUNTED, data: { ...DATA, rows }, d3: D3,
            zoomMemory: createZoomMemoryHook(memory()),              // a fresh ZoomMemoryHost literal, too
        }));
        await act(async () => { draw([["East"]]); });
        await act(async () => { draw([["West"]]); });
        await act(async () => { draw([["North"]]); });
        expect(compiles()).toBe(1);
    });

    it("null and undefined are the same absent hook", async () => {
        const draw = (zoomMemory?: ZoomMemoryHook | null) =>
            root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, ...(zoomMemory === undefined ? {} : { zoomMemory }) }));
        await act(async () => { draw(undefined); });
        await act(async () => { draw(null); });
        await act(async () => { draw(undefined); });
        await act(async () => { draw(null); });
        expect(compiles()).toBe(1);
        await act(async () => { draw(spyHook()); });
        expect(compiles()).toBe(2);                                  // present is a change
        await act(async () => { draw(null); });
        expect(compiles()).toBe(3);
    });

    describe("what the unmounted or replaced hook leaves behind", () => {
        const wheel = (node: Element) => node.dispatchEvent(new Event("wheel"));
        const zoomTo = (node: Element, k: number) => { (node.querySelector(".pad") as any).__zoom = { k, x: -15, y: -5 }; };

        it("an unmount takes the watcher off the chart's element and gives the element back", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const zh = memory();
            const hook = createZoomMemoryHook(zh);
            await act(async () => { root.render(createElement(BicChart, { code: ZOOMED, data: DATA, d3: D3, zoomMemory: hook })); });
            const chart = el.firstElementChild as HTMLElement;
            expect(zh.zoomContainer).toBe(chart);
            expect(zh.zoomWatchAttached).toBe(true);
            await act(async () => root.unmount());
            expect(zh.zoomContainer).toBeNull();
            expect(zh.zoomWatchAttached).toBe(false);
            wheel(chart);
            expect(zh.zoomSettleTimer).toBe(0);
            root = createRoot(el);                                   // for the afterEach
        });

        it("a gesture still settling at unmount is recorded", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const zh = memory();
            await act(async () => { root.render(createElement(BicChart, { code: ZOOMED, data: DATA, d3: D3, zoomMemory: createZoomMemoryHook(zh) })); });
            const chart = el.firstElementChild as HTMLElement;
            zoomTo(chart, 3);
            wheel(chart);
            await act(async () => root.unmount());
            expect(zh.liveZoomState).toMatchObject({ k: 3, x: -15, y: -5 });
            root = createRoot(el);
        });

        it("a hook swapped, through no hook, for one over ANOTHER memory on the same element: only the new one watches it", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const persistA = vi.fn(), persistB = vi.fn();
            const za = memory({ rememberAcrossSessions: () => true, persistZoom: persistA });
            const zb = memory({ rememberAcrossSessions: () => true, persistZoom: persistB });
            const draw = (zoomMemory?: ZoomMemoryHook) =>
                root.render(createElement(BicChart, { code: ZOOMED, data: DATA, d3: D3, ...(zoomMemory ? { zoomMemory } : {}) }));
            await act(async () => { draw(createZoomMemoryHook(za)); });
            await act(async () => { draw(); });
            await act(async () => { draw(createZoomMemoryHook(zb)); });
            const chart = el.firstElementChild as HTMLElement;
            zoomTo(chart, 3);
            wheel(chart);
            expect(za.zoomSettleTimer).toBe(0);
            expect(zb.zoomSettleTimer).not.toBe(0);
            vi.advanceTimersByTime(500);
            expect(persistA).not.toHaveBeenCalled();                 // the first memory's store is not overwritten under its key
            expect(persistB).toHaveBeenCalledTimes(1);
            expect(zb.liveZoomState).toMatchObject({ k: 3 });
            expect(za.liveZoomState).toBeNull();
        });

        it("StrictMode's mount, unmount, mount leaves the watcher on the element", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const zh = memory();
            const hook = createZoomMemoryHook(zh);
            await act(async () => {
                root.render(createElement(StrictMode, null, createElement(BicChart, { code: ZOOMED, data: DATA, d3: D3, zoomMemory: hook })));
            });
            const chart = el.firstElementChild as HTMLElement;
            expect(zh.zoomContainer).toBe(chart);
            expect(zh.zoomWatchAttached).toBe(true);
            zoomTo(chart, 3);
            wheel(chart);
            vi.advanceTimersByTime(400);
            expect(zh.liveZoomState).toMatchObject({ k: 3 });        // gestures are still recorded
        });

        it("a remount onto a new element hands the watcher over, with the session's view", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const zh = memory();
            const hook = createZoomMemoryHook(zh);
            await act(async () => { root.render(createElement(BicChart, { code: ZOOMED, data: DATA, d3: D3, zoomMemory: hook })); });
            const first = el.firstElementChild as HTMLElement;
            zoomTo(first, 3);
            wheel(first);
            vi.advanceTimersByTime(400);
            await act(async () => { root.render(createElement(BicChart, { key: "again", code: ZOOMED, data: DATA, d3: D3, zoomMemory: hook })); });
            const second = el.firstElementChild as HTMLElement;
            expect(second).not.toBe(first);
            expect(zh.zoomContainer).toBe(second);
            expect(zh.liveZoomState).toMatchObject({ k: 3 });
            wheel(first);
            expect(zh.zoomSettleTimer).toBe(0);
            zoomTo(second, 5);
            wheel(second);
            vi.advanceTimersByTime(400);
            expect(zh.liveZoomState).toMatchObject({ k: 5 });
        });
    });
});
