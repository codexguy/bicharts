// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createChartHost } from "../../src/host";
import { createZoomMemoryHook, type ZoomMemoryHook, type ZoomMemoryHost } from "../../src/zoomMemory/zoomMemoryDom";

// createChartHost's `zoomMemory` hook: what a host that remembers a reader's zoom hands the host, and what
// the host does with it. Absent, nothing changes: d3.zoom is never wrapped and no listener is added. Present,
// the hook wraps d3.zoom on the d3 the CHART is handed while its code runs, puts the remembered view back as
// the FIRST post-render step (so every later pass measures the zoomed layout), and is flushed before the
// container is emptied, so a gesture that has not settled yet is recorded from the chart it was made on.
//
// jsdom cannot run a real d3-zoom on an <svg>, and this package has no d3 dependency, so d3 is a stand-in
// carrying exactly what the restore uses: zoom(), zoomIdentity and select().call(). The chart zooms a div.

const CODE = `
function render(container, data, options) {
  var doc = container.ownerDocument;
  var pad = doc.createElement("div");
  pad.className = "pad";
  var label = doc.createElement("span");
  label.textContent = String(data.rows[0][0]);
  pad.appendChild(label);
  container.appendChild(pad);
  window.__zoomSeen = d3.zoom;
  var z = d3.zoom();
  pad.__zoom = { k: 1, x: 0, y: 0 };   // what d3.select(pad).call(z) leaves on the node
}`;

const payload = { columns: [{ name: "City" }], rows: [["Qingdao"]] };
const OPTIONS = { width: 300, height: 200 } as any;

function fakeD3(applied: any[] = []) {
    const behavior: any = { transform: (node: any, t: any) => { node.__zoom = t; applied.push(t); }, scaleExtent: () => [1, 8] };
    const identity = { k: 1, x: 0, y: 0, translate(x: number, y: number) { return { ...this, x, y }; }, scale(k: number) { return { ...this, k }; } };
    const zoom = () => behavior;
    return { zoom, zoomIdentity: identity, select: (n: any) => ({ call: (f: any, t: any) => f(n, t) }) };
}

function zoomHost(log: string[] = [], over: Partial<ZoomMemoryHost> = {}): ZoomMemoryHost {
    return {
        liveZoomState: null, zoomWatchKey: "", zoomWatchAttached: false, zoomSettleTimer: 0, zoomContainer: null,
        rememberAcrossSessions: () => false,
        readPersistedZoom: () => null,
        persistZoom: () => undefined,
        log: tag => log.push(tag),
        ...over,
    };
}

let container: HTMLElement;
beforeEach(() => {
    document.body.innerHTML = "<div id='c'></div>";
    container = document.getElementById("c")!;
    delete (window as any).__zoomSeen;
    vi.useRealTimers();
});

describe("createChartHost - zoomMemory absent", () => {
    it("d3.zoom is untouched while the chart runs, and no zoom listener is added", () => {
        const d3 = fakeD3();
        const original = d3.zoom;
        const added: string[] = [];
        const add = container.addEventListener.bind(container);
        container.addEventListener = ((type: string, ...rest: any[]) => { added.push(type); return (add as any)(type, ...rest); }) as any;
        const host = createChartHost(container, { data: payload, code: CODE, d3, options: OPTIONS });
        host.render();
        expect((window as any).__zoomSeen).toBe(original);
        for (const t of ["wheel", "pointerup", "pointercancel", "dblclick", "keyup"]) expect(added).not.toContain(t);
        host.destroy();
    });
});

describe("createChartHost - zoomMemory present", () => {
    it("wraps d3.zoom for the chart's run only, and puts the remembered view back before label contrast runs", () => {
        const applied: any[] = [];
        const d3 = fakeD3(applied);
        const original = d3.zoom;
        const order: string[] = [];
        const zh = zoomHost(order);
        const hook = createZoomMemoryHook(zh);
        zh.liveZoomState = { k: 4, x: -20, y: -10, key: hook.keyFor(CODE, 300, 200) };
        let kSeenByContrast = 0;
        const host = createChartHost(container, {
            data: payload, code: CODE, d3, options: OPTIONS, zoomMemory: hook,
            onLabelContrast: () => { order.push("label-contrast"); kSeenByContrast = (container.querySelector(".pad") as any).__zoom.k; },
        });
        host.render();
        expect((window as any).__zoomSeen).not.toBe(original);    // wrapped while the chart ran
        expect(d3.zoom).toBe(original);                           // and released after
        expect(applied).toHaveLength(1);
        expect(order).toEqual(["zoom-restored", "zoom-watcher-attached", "label-contrast"]);
        expect(kSeenByContrast).toBe(4);
        host.destroy();
    });

    it("keys the view by the code and the options' size, falling back to the container's", () => {
        const keys: string[] = [];
        const hook = createZoomMemoryHook(zoomHost());
        const spy: ZoomMemoryHook = { ...hook, keyFor: (c, w, h) => { const k = hook.keyFor(c, w, h); keys.push(`${w}x${h}`); return k; } };
        const a = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: spy });
        a.render();
        a.destroy();
        Object.defineProperty(container, "clientWidth", { value: 640, configurable: true });
        Object.defineProperty(container, "clientHeight", { value: 480, configurable: true });
        const b = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), zoomMemory: spy });
        b.render();
        b.destroy();
        expect(keys).toEqual(["300x200", "640x480"]);
    });

    it("destroy() and setOptions() flush the hook BEFORE the container is emptied", () => {
        const sawChart: boolean[] = [];
        const hook = createZoomMemoryHook(zoomHost());
        const spy: ZoomMemoryHook = { ...hook, flush: () => { sawChart.push(!!container.querySelector(".pad")); hook.flush(); } };
        const host = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: spy });
        host.render();
        sawChart.length = 0;                                       // the first render had nothing on screen yet
        host.setOptions({ aggregation: "sum" } as any);
        host.destroy();
        expect(sawChart).toEqual([true, true]);
    });

    it("a gesture still settling when the host is destroyed is recorded, and the next host on the container restores it", () => {
        vi.useFakeTimers();
        const applied: any[] = [];
        const zh = zoomHost();
        const hook = createZoomMemoryHook(zh);
        const a = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(applied), options: OPTIONS, zoomMemory: hook });
        a.render();
        (container.querySelector(".pad") as any).__zoom = { k: 3, x: -15, y: -5 };   // the reader zooms...
        container.dispatchEvent(new Event("wheel"));                                 // ...and the host redraws at once
        a.destroy();
        expect(zh.liveZoomState).toMatchObject({ k: 3, x: -15, y: -5 });
        const b = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(applied), options: OPTIONS, zoomMemory: hook });
        b.render();
        expect(applied.map(t => t.k)).toEqual([3]);
        expect((container.querySelector(".pad") as any).__zoom.k).toBe(3);
        b.destroy();
    });

    it("one hook, a host re-created on a NEW element (a remount): the hook follows the new element and lets go of the old", () => {
        vi.useFakeTimers();
        const applied: any[] = [];
        const zh = zoomHost();
        const hook = createZoomMemoryHook(zh);
        const a = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(applied), options: OPTIONS, zoomMemory: hook });
        a.render();
        (container.querySelector(".pad") as any).__zoom = { k: 3, x: -15, y: -5 };
        container.dispatchEvent(new Event("wheel"));
        a.destroy();
        expect(zh.liveZoomState).toMatchObject({ k: 3 });

        const next = document.createElement("div");
        document.body.appendChild(next);
        const b = createChartHost(next, { data: payload, code: CODE, d3: fakeD3(applied), options: OPTIONS, zoomMemory: hook });
        b.render();
        expect(zh.zoomContainer).toBe(next);
        expect(applied.map(t => t.k)).toEqual([3]);                  // the view the reader left is restored on the new element
        expect((next.querySelector(".pad") as any).__zoom.k).toBe(3);

        container.dispatchEvent(new Event("wheel"));                 // the old element no longer arms anything
        expect(zh.zoomSettleTimer).toBe(0);

        (next.querySelector(".pad") as any).__zoom = { k: 5, x: -30, y: -10 };
        next.dispatchEvent(new Event("wheel"));                      // the new one does
        vi.advanceTimersByTime(400);
        expect(zh.liveZoomState).toMatchObject({ k: 5, x: -30, y: -10 });
        b.destroy();
    });

    it("the hook moving to a new element drops a settle still pending on the old one", () => {
        vi.useFakeTimers();
        const zh = zoomHost();
        const hook = createZoomMemoryHook(zh);
        const cap = { behaviors: [], release: () => undefined };
        hook.restore(container, cap, "k1", fakeD3());
        container.dispatchEvent(new Event("wheel"));                 // armed on the old element
        expect(zh.zoomSettleTimer).not.toBe(0);
        const next = document.createElement("div");
        hook.restore(next, cap, "k1", fakeD3());
        expect(zh.zoomContainer).toBe(next);
        expect(zh.zoomSettleTimer).toBe(0);
        expect(zh.zoomWatchAttached).toBe(true);                     // and the watcher is on the new element
        next.dispatchEvent(new Event("wheel"));
        expect(zh.zoomSettleTimer).not.toBe(0);
    });

    // A DESTROYED HOST LETS ITS HOOK GO. The watcher comes off the element the host drew into and a gesture still settling
    // is recorded first, so a hook handed to the next host (same element or not) starts clean, and a hook that is replaced
    // by one over another memory leaves nothing of itself on the element.
    it("destroy() records a pending gesture, then releases the hook for its own container", () => {
        const calls: Array<[string, unknown?]> = [];
        const hook = createZoomMemoryHook(zoomHost());
        const spy: ZoomMemoryHook = {
            ...hook,
            flush: () => { calls.push(["flush"]); hook.flush(); },
            release: c => { calls.push(["release", c]); hook.release?.(c); },
        };
        const host = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: spy });
        host.render();
        calls.length = 0;                                          // the render flushes too
        host.destroy();
        expect(calls).toEqual([["flush"], ["release", container]]);
    });

    it("destroy() takes the watcher off the container and gives the container back", () => {
        vi.useFakeTimers();
        const zh = zoomHost();
        const host = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: createZoomMemoryHook(zh) });
        host.render();
        expect(zh.zoomContainer).toBe(container);
        expect(zh.zoomWatchAttached).toBe(true);
        host.destroy();
        expect(zh.zoomContainer).toBeNull();
        expect(zh.zoomWatchAttached).toBe(false);
        container.dispatchEvent(new Event("wheel"));
        expect(zh.zoomSettleTimer).toBe(0);
    });

    it("a hook swapped for one over ANOTHER memory on the same element leaves nothing of the old one behind", () => {
        vi.useFakeTimers();
        const persistA = vi.fn(), persistB = vi.fn();
        const za = zoomHost([], { rememberAcrossSessions: () => true, persistZoom: persistA });
        const zb = zoomHost([], { rememberAcrossSessions: () => true, persistZoom: persistB });
        const a = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: createZoomMemoryHook(za) });
        a.render();
        a.destroy();
        const b = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: createZoomMemoryHook(zb) });
        b.render();
        (container.querySelector(".pad") as any).__zoom = { k: 3, x: -15, y: -5 };
        container.dispatchEvent(new Event("wheel"));
        expect(za.zoomSettleTimer).toBe(0);                          // only the live hook's watcher is on the element
        expect(zb.zoomSettleTimer).not.toBe(0);
        vi.advanceTimersByTime(500);
        expect(persistA).not.toHaveBeenCalled();                     // the old store is not overwritten with the new chart's view
        expect(persistB).toHaveBeenCalledTimes(1);
        expect(za.liveZoomState).toBeNull();
        expect(zb.liveZoomState).toMatchObject({ k: 3, x: -15, y: -5 });
        b.destroy();
    });

    it("one hook handed to successive hosts on one container: each attaches on its first render, and the listeners balance", () => {
        vi.useFakeTimers();
        const added: string[] = [], removed: string[] = [];
        const add = container.addEventListener.bind(container), remove = container.removeEventListener.bind(container);
        container.addEventListener = ((t: string, ...r: any[]) => { added.push(t); return (add as any)(t, ...r); }) as any;
        container.removeEventListener = ((t: string, ...r: any[]) => { removed.push(t); return (remove as any)(t, ...r); }) as any;
        const zh = zoomHost();
        const hook = createZoomMemoryHook(zh);
        for (let i = 0; i < 3; i++) {
            const h = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: hook });
            h.render();
            (container.querySelector(".pad") as any).__zoom = { k: 2 + i, x: -10, y: -5 };
            container.dispatchEvent(new Event("wheel"));
            vi.advanceTimersByTime(400);
            expect(zh.liveZoomState).toMatchObject({ k: 2 + i });    // each host's gestures are watched
            h.destroy();
        }
        expect(added.filter(t => t === "wheel")).toHaveLength(3);
        expect(removed.filter(t => t === "wheel")).toHaveLength(3);
    });

    it("a host destroyed after the next one has drawn on ANOTHER element leaves the watcher where it moved to", () => {
        vi.useFakeTimers();
        const zh = zoomHost();
        const hook = createZoomMemoryHook(zh);
        const a = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: hook });
        a.render();
        const next = document.createElement("div");
        document.body.appendChild(next);
        const b = createChartHost(next, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: hook });
        b.render();
        a.destroy();
        expect(zh.zoomContainer).toBe(next);
        expect(zh.zoomWatchAttached).toBe(true);
        (next.querySelector(".pad") as any).__zoom = { k: 4, x: -20, y: -8 };
        next.dispatchEvent(new Event("wheel"));
        vi.advanceTimersByTime(400);
        expect(zh.liveZoomState).toMatchObject({ k: 4 });
        b.destroy();
    });

    it("the hook's release with no container lets go of the watcher wherever it is", () => {
        vi.useFakeTimers();
        const zh = zoomHost();
        const hook = createZoomMemoryHook(zh);
        hook.restore(container, { behaviors: [], release: () => undefined }, "k1", fakeD3());
        container.dispatchEvent(new Event("wheel"));
        expect(zh.zoomSettleTimer).not.toBe(0);
        hook.release?.();
        expect(zh.zoomSettleTimer).toBe(0);
        expect(zh.zoomWatchAttached).toBe(false);
        expect(zh.zoomContainer).toBeNull();
    });

    // A zoomContainer the PAGE named on the memory is the page's choice (the zoomed panel can sit inside the element the
    // chart draws into): the hook watches it and neither replaces nor gives it back. One it adopted itself is its to move.
    it("a container the page set on the memory is kept: not replaced by the render's, not given back", () => {
        vi.useFakeTimers();
        const preset = document.createElement("div");
        document.body.appendChild(preset);
        const zh = zoomHost();
        zh.zoomContainer = preset;
        const hook = createZoomMemoryHook(zh);
        const cap = { behaviors: [], release: () => undefined };
        hook.restore(container, cap, "k1", fakeD3());
        expect(zh.zoomContainer).toBe(preset);
        container.dispatchEvent(new Event("wheel"));
        expect(zh.zoomSettleTimer).toBe(0);
        preset.dispatchEvent(new Event("wheel"));
        expect(zh.zoomSettleTimer).not.toBe(0);
        hook.release?.();
        expect(zh.zoomContainer).toBe(preset);
        expect(zh.zoomWatchAttached).toBe(false);
    });

    it("a host given a precompiled renderFn never captures or restores", () => {
        const capture = vi.fn(), restore = vi.fn();
        const hook: ZoomMemoryHook = { keyFor: () => "k", capture, restore, flush: () => undefined, forget: () => undefined };
        const host = createChartHost(container, {
            data: payload, d3: fakeD3(), options: OPTIONS, zoomMemory: hook,
            renderFn: (c) => { c.appendChild(document.createElement("div")); },
        });
        host.render();
        expect(capture).not.toHaveBeenCalled();
        expect(restore).not.toHaveBeenCalled();
        host.destroy();
    });

    it("a non-extensible d3 namespace: the copy the chart is handed is the one wrapped", () => {
        const applied: any[] = [];
        const d3 = Object.freeze(fakeD3(applied));
        const zh = zoomHost();
        const hook = createZoomMemoryHook(zh);
        zh.liveZoomState = { k: 2, x: -4, y: -4, key: hook.keyFor(CODE, 300, 200) };
        const host = createChartHost(container, { data: payload, code: CODE, d3, options: OPTIONS, zoomMemory: hook });
        host.render();
        expect(applied.map(t => t.k)).toEqual([2]);
        host.destroy();
    });

    it("a hook that throws costs the chart nothing", () => {
        const boom = () => { throw new Error("boom"); };
        const hook: ZoomMemoryHook = { keyFor: () => "k", capture: () => ({ behaviors: [], release: () => undefined }),
            restore: boom, flush: boom, forget: boom, release: boom };
        const host = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: hook });
        expect(() => host.render()).not.toThrow();
        expect(container.querySelector(".pad")).not.toBeNull();
        expect(() => host.setOptions({ aggregation: "sum" } as any)).not.toThrow();
        expect(() => host.destroy()).not.toThrow();
    });
});
