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

function zoomHost(log: string[] = []): ZoomMemoryHost {
    return {
        liveZoomState: null, zoomWatchKey: "", zoomWatchAttached: false, zoomSettleTimer: 0, zoomContainer: null,
        rememberAcrossSessions: () => false,
        readPersistedZoom: () => null,
        persistZoom: () => undefined,
        log: tag => log.push(tag),
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
            restore: boom, flush: boom, forget: boom };
        const host = createChartHost(container, { data: payload, code: CODE, d3: fakeD3(), options: OPTIONS, zoomMemory: hook });
        expect(() => host.render()).not.toThrow();
        expect(container.querySelector(".pad")).not.toBeNull();
        expect(() => host.setOptions({ aggregation: "sum" } as any)).not.toThrow();
        expect(() => host.destroy()).not.toThrow();
    });
});
