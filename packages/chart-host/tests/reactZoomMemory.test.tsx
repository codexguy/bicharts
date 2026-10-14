// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, Fragment, StrictMode, Suspense, startTransition, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";
import { createZoomMemoryHook, type ZoomMemoryHook, type ZoomMemoryHost } from "../src/zoomMemory/zoomMemoryDom";

// <BicChart zoomMemory> is a pass-through to createChartHost's `zoomMemory`: the hook captures while the
// chart's code runs and restores after it draws. Absent, the binding hands the host nothing. The prop is host
// config read when the host is built: it rebuilds the host when it arrives or goes away, and a change from one
// hook to another rebuilds nothing but is the hook the next rebuild uses, so a hook written inline in the props
// costs nothing.

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

    it("a hook that arrives after mount rebuilds the host once, so it is the one used; a different hook after that waits for the next rebuild", async () => {
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
        const lateCalls = late.restore.mock.calls.length;
        await act(async () => { root.render(createElement(BicChart, { code: `${COUNTED}\n// again`, data: DATA, d3: D3, zoomMemory: other })); });
        expect(compiles()).toBe(3);                                  // a rebuild for another reason builds with the hook passed now
        expect(other.restore).toHaveBeenCalled();
        expect(late.restore.mock.calls.length).toBe(lateCalls);
    });

    it("presence is the only trigger: a run of hooks coming and going rebuilds once per flip", async () => {
        const h1 = spyHook(), h2 = spyHook();
        const draw = (zoomMemory?: ZoomMemoryHook | null) =>
            root.render(createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, ...(zoomMemory ? { zoomMemory } : {}) }));
        await act(async () => { draw(h1); });
        await act(async () => { draw(h2); });                        // swap: no rebuild
        await act(async () => { draw(h1); });                        // swap back: none
        await act(async () => { draw(); });                          // gone: 1
        await act(async () => { draw(h2); });                        // back: 2
        await act(async () => { draw(h1); });                        // swap: none
        await act(async () => { draw(); });                          // gone: 3
        expect(compiles()).toBe(1 + 3);
    });

    it("a render that was started and abandoned leaves nothing behind: a swap that follows it rebuilds nothing", async () => {
        // A transition that suspends renders the tree, BicChart included, and is not committed. The hook it passed
        // (none, here) must not be taken for a change by the render that does commit.
        const h1 = spyHook(), h2 = spyHook();
        const pending = new Promise<void>(() => undefined);          // never settles: the transition stays abandoned
        const Gate = ({ block }: { block: boolean }) => { if (block) throw pending; return null; };
        let api!: { zoom: (z: ZoomMemoryHook | null) => void; block: (b: boolean) => void };
        const App = () => {
            const [zoom, setZoom] = useState<ZoomMemoryHook | null>(h1);
            const [block, setBlock] = useState(false);
            api = { zoom: setZoom, block: setBlock };
            return createElement(Fragment, null,
                createElement(BicChart, { code: COUNTED, data: DATA, d3: D3, zoomMemory: zoom }),
                createElement(Suspense, { fallback: null }, createElement(Gate, { block })));
        };
        await act(async () => { root.render(createElement(App)); });
        expect(compiles()).toBe(1);
        await act(async () => { startTransition(() => { api.zoom(null); api.block(true); }); });
        expect(compiles()).toBe(1);                                  // nothing was committed
        await act(async () => { api.zoom(h2); });                    // h1 -> h2, present both times
        expect(compiles()).toBe(1);
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

        it("a new code and a new hook in one update: the rebuilt host writes to the new hook's store, not the old one's", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const persist1 = vi.fn(), persist2 = vi.fn();
            const z1 = memory({ rememberAcrossSessions: () => true, persistZoom: persist1 });
            const z2 = memory({ rememberAcrossSessions: () => true, persistZoom: persist2 });
            const h1 = createZoomMemoryHook(z1), h2 = createZoomMemoryHook(z2);
            const second = `${ZOOMED}\n// the second chart`;
            await act(async () => { root.render(createElement(BicChart, { code: ZOOMED, data: DATA, d3: D3, zoomMemory: h1 })); });
            const chart = el.firstElementChild as HTMLElement;
            zoomTo(chart, 2);
            wheel(chart);
            vi.advanceTimersByTime(400);
            expect(persist1).toHaveBeenCalledTimes(1);               // the first chart's view, in the first store
            await act(async () => { root.render(createElement(BicChart, { code: second, data: DATA, d3: D3, zoomMemory: h2 })); });
            zoomTo(chart, 3);
            wheel(chart);
            vi.advanceTimersByTime(400);
            expect(persist2).toHaveBeenCalledTimes(1);               // the second chart's view, in the second
            expect(persist1).toHaveBeenCalledTimes(1);               // and the first store is not overwritten by it
            expect(z2.liveZoomState).toMatchObject({ k: 3 });
            expect(z1.liveZoomState).toMatchObject({ k: 2 });
            expect(z1.zoomContainer).toBeNull();                     // the first hook let go of the element
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
