import { describe, it, expect, vi, afterEach } from "vitest";
import {
    attachZoomWatcher, captureCurrentZoom, captureZoomBehaviors, restoreZoomForRender, flushPendingZoom, forgetZoom,
    createZoomMemoryHook, type ZoomMemoryHost,
} from "../../src/zoomMemory/zoomMemoryDom";
import { zoomStateKey } from "../../src/zoomMemory/zoomMemory";
import { SIMPLE_STRING_HASH } from "@bicharts/shape-core";

// REMEMBER ZOOM/PAN, the DOM half, over a host-supplied state object.
//
// The decision this file pins: SURVIVING A RE-RENDER is unconditional, because losing a zoom because a mark
// was clicked to cross-filter is a bug rather than a preference; SURVIVING A CLOSE AND REOPEN is what the
// host's preference buys, because that transform rides the saved file and everyone who opens it lands on
// the view it was saved with. The two collapse into one flag easily, and the collapse is invisible until
// someone opens a colleague's file and finds it zoomed somewhere arbitrary.

const KEY = zoomStateKey("code-v1", 800, 600);

afterEach(() => { vi.useRealTimers(); });

function fakeNode(transform?: { k: number; x: number; y: number }): any {
    const node: any = { tagName: "RECT", children: [], querySelectorAll() { return []; } };
    if (transform) node.__zoom = transform;
    return node;
}

function fakeContainer(child: any): any {
    return { tagName: "DIV", children: [child], querySelectorAll() { return [child]; }, addEventListener: vi.fn() };
}

/** A ZoomMemoryHost over plain fields, with the persisted tier as a string and every log line recorded. */
function fakeHost(opts: { remember: boolean; node?: any; persisted?: string }) {
    const child = opts.node === undefined ? fakeNode({ k: 3, x: -120, y: -60 }) : opts.node;
    const persistZoom = vi.fn();
    const log = vi.fn();
    const reads: string[] = [];
    const host: ZoomMemoryHost = {
        liveZoomState: null,
        zoomWatchKey: "",
        zoomWatchAttached: false,
        zoomSettleTimer: 0,
        zoomContainer: fakeContainer(child ?? fakeNode()),
        rememberAcrossSessions: () => opts.remember,
        readPersistedZoom: (key: string) => { reads.push(key); return opts.persisted ?? null; },
        persistZoom,
        log,
    };
    return { host, persistZoom, log, reads, node: child };
}

const tags = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map(c => c[0]);

describe("what gets remembered, and where", () => {
    it("remembers a zoom IN SESSION even with the preference off", () => {
        // The half that is not a preference. Without it one cross-filter click discards the view the
        // reader just set up.
        const { host, persistZoom, log } = fakeHost({ remember: false });
        host.zoomWatchKey = KEY;
        captureCurrentZoom(host);
        expect(host.liveZoomState).toEqual({ k: 3, x: -120, y: -60, key: KEY });
        // ...but nothing reaches the persisted store.
        expect(persistZoom).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith("zoom-remembered", { k: 3, x: -120, y: -60, key: KEY });
    });

    it("ALSO persists when the preference is on", () => {
        const { host, persistZoom } = fakeHost({ remember: true });
        host.zoomWatchKey = KEY;
        captureCurrentZoom(host);
        expect(persistZoom).toHaveBeenCalledTimes(1);
        expect(JSON.parse(persistZoom.mock.calls[0][0])).toEqual({ k: 3, x: -120, y: -60, key: KEY });
    });

    it("does not write the same transform twice", () => {
        const { host, persistZoom } = fakeHost({ remember: true });
        host.zoomWatchKey = KEY;
        captureCurrentZoom(host);
        captureCurrentZoom(host);
        expect(persistZoom).toHaveBeenCalledTimes(1);
    });

    it("FORGETS rather than remembering the identity when the reader zooms back out", () => {
        // Storing identity would make "reset the view" itself a remembered view, and would rewrite the
        // store every time somebody undid their zoom.
        const { host, persistZoom, node, log } = fakeHost({ remember: true });
        host.zoomWatchKey = KEY;
        captureCurrentZoom(host);
        expect(host.liveZoomState).not.toBeNull();
        node.__zoom = { k: 1, x: 0, y: 0 };
        captureCurrentZoom(host);
        expect(host.liveZoomState).toBeNull();
        expect(persistZoom).toHaveBeenLastCalledWith("");
        expect(tags(log)).toEqual(["zoom-remembered", "zoom-forgotten"]);
    });

    it("records nothing when the chart has no zoom at all, or before a render stamped a key", () => {
        const none = fakeHost({ remember: true, node: fakeNode() });
        none.host.zoomWatchKey = KEY;
        captureCurrentZoom(none.host);
        expect(none.host.liveZoomState).toBeNull();
        expect(none.persistZoom).not.toHaveBeenCalled();
        const unkeyed = fakeHost({ remember: true });
        captureCurrentZoom(unkeyed.host);
        expect(unkeyed.host.liveZoomState).toBeNull();
    });

    it("a capture that throws is logged, never thrown", () => {
        const { host, log } = fakeHost({ remember: true });
        host.zoomWatchKey = KEY;
        host.persistZoom = () => { throw new Error("store full"); };
        expect(() => captureCurrentZoom(host)).not.toThrow();
        expect(log).toHaveBeenCalledWith("zoom-capture-ex", { message: "store full" });
    });
});

describe("restoring", () => {
    /** A stand-in for a d3 zoom behavior, including the accessors the restore clamps against. */
    function fakeBehavior(applied: any[]) {
        const b: any = vi.fn();
        b.transform = vi.fn((_sel: any, t: any) => applied.push(t));
        b.scaleExtent = () => [1, 8];
        b.translateExtent = () => [[0, 0], [800, 600]];
        b.extent = () => () => [[0, 0], [800, 600]];
        b.constrain = () => (t: any) => t;
        return b;
    }

    function fakeD3(): any {
        const identity = { k: 1, x: 0, y: 0, translate(x: number, y: number) { return { ...this, x, y }; }, scale(k: number) { return { ...this, k }; } };
        return { zoomIdentity: identity, select: (n: any) => ({ call: (f: any, t: any) => f(n, t) }), zoom: () => ({}) };
    }

    it("restores the in-session transform with the preference OFF", () => {
        const applied: any[] = [];
        const { host, log } = fakeHost({ remember: false, node: fakeNode({ k: 1, x: 0, y: 0 }) });
        host.liveZoomState = { k: 4, x: -200, y: -100, key: KEY };
        restoreZoomForRender(fakeD3(), host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied.length).toBe(1);
        expect(applied[0].k).toBe(4);
        expect(log).toHaveBeenCalledWith("zoom-restored", { k: 4, x: -200, y: -100, key: KEY });
    });

    it("does NOT restore a persisted transform when the preference is off, and does not even read it", () => {
        // The persisted blob may exist from a session when the preference WAS on, or from a copied file.
        // With the preference off the chart opens at full extent.
        const applied: any[] = [];
        const { host, reads } = fakeHost({
            remember: false, node: fakeNode({ k: 1, x: 0, y: 0 }),
            persisted: JSON.stringify({ k: 4, x: -200, y: -100, key: KEY }),
        });
        restoreZoomForRender(fakeD3(), host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied.length).toBe(0);
        expect(reads).toEqual([]);
    });

    it("restores a persisted transform when the preference is on, reading it under the current key", () => {
        const applied: any[] = [];
        const { host, reads } = fakeHost({
            remember: true, node: fakeNode({ k: 1, x: 0, y: 0 }),
            persisted: JSON.stringify({ k: 4, x: -200, y: -100, key: KEY }),
        });
        restoreZoomForRender(fakeD3(), host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied.length).toBe(1);
        expect(reads).toEqual([KEY]);
    });

    it("the session tier wins over the persisted one (the persisted copy can lag a fresh gesture)", () => {
        const applied: any[] = [];
        const { host, reads } = fakeHost({
            remember: true, node: fakeNode({ k: 1, x: 0, y: 0 }),
            persisted: JSON.stringify({ k: 2, x: -10, y: -10, key: KEY }),
        });
        host.liveZoomState = { k: 4, x: -200, y: -100, key: KEY };
        restoreZoomForRender(fakeD3(), host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied[0].k).toBe(4);
        expect(reads).toEqual([]);
    });

    it("ignores a transform captured against a different generation", () => {
        const applied: any[] = [];
        const { host } = fakeHost({
            remember: true, node: fakeNode({ k: 1, x: 0, y: 0 }),
            persisted: JSON.stringify({ k: 4, x: -200, y: -100, key: zoomStateKey("code-v2", 800, 600) }),
        });
        restoreZoomForRender(fakeD3(), host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied.length).toBe(0);
    });

    it("clamps the scale to the behavior's OWN extent rather than trusting the blob", () => {
        // zoom.transform does not constrain - d3 constrains in its wheel/drag handlers and assigns the
        // result. So a k of 400 from a hand-edited file would be applied as-is unless it is clamped first,
        // against the chart's own limits.
        const applied: any[] = [];
        const { host } = fakeHost({ remember: false, node: fakeNode({ k: 1, x: 0, y: 0 }) });
        host.liveZoomState = { k: 400, x: -200, y: -100, key: KEY };
        restoreZoomForRender(fakeD3(), host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied[0].k).toBe(8);
    });

    it("declines when it never saw the zoom behavior", () => {
        // A transform can be READ off the DOM without the behavior, but not APPLIED safely. Half a feature
        // that mis-positions a map is worse than none.
        const applied: any[] = [];
        const { host, log } = fakeHost({ remember: false, node: fakeNode({ k: 1, x: 0, y: 0 }) });
        host.liveZoomState = { k: 4, x: -200, y: -100, key: KEY };
        restoreZoomForRender(fakeD3(), host, { behaviors: [], release: () => undefined }, KEY);
        expect(applied.length).toBe(0);
        expect(log).toHaveBeenCalledWith("zoom-restore-no-behavior", { behaviors: 0 });
    });

    it("does not re-apply a transform the chart is already showing", () => {
        const applied: any[] = [];
        const { host } = fakeHost({ remember: false, node: fakeNode({ k: 4, x: -200, y: -100 }) });
        host.liveZoomState = { k: 4, x: -200, y: -100, key: KEY };
        restoreZoomForRender(fakeD3(), host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied.length).toBe(0);
    });

    it("never lets a restore failure cost the reader the chart", () => {
        const { host, log } = fakeHost({ remember: false, node: fakeNode({ k: 1, x: 0, y: 0 }) });
        host.liveZoomState = { k: 4, x: -200, y: -100, key: KEY };
        const exploding: any = { transform: () => { throw new Error("boom"); } };
        expect(() => restoreZoomForRender(fakeD3(), host, { behaviors: [exploding], release: () => undefined }, KEY)).not.toThrow();
        expect(log).toHaveBeenCalledWith("zoom-restore-ex", { message: "boom" });
    });

    it("uses the d3 it is handed, and does nothing with one that cannot apply a transform", () => {
        const applied: any[] = [];
        const { host } = fakeHost({ remember: false, node: fakeNode({ k: 1, x: 0, y: 0 }) });
        host.liveZoomState = { k: 4, x: -200, y: -100, key: KEY };
        restoreZoomForRender({}, host, { behaviors: [fakeBehavior(applied)], release: () => undefined }, KEY);
        expect(applied.length).toBe(0);
    });
});

describe("capturing the zoom behavior", () => {
    it("records the behavior and survives d3's chained setters", () => {
        // The wrap works BECAUSE d3's setters mutate and return the same object. Wrapping the returned
        // object instead would be unwrapped by the first chained call.
        const behavior: any = {};
        behavior.scaleExtent = () => behavior;
        const d3: any = { zoom: () => behavior };
        const { host } = fakeHost({ remember: false });
        const cap = captureZoomBehaviors(d3, host);
        const made = d3.zoom().scaleExtent([1, 8]);
        expect(made).toBe(behavior);
        expect(cap.behaviors).toEqual([behavior]);
        cap.release();
    });

    it("always unwraps d3.zoom on release", () => {
        const original = () => ({});
        const d3: any = { zoom: original };
        const { host } = fakeHost({ remember: false });
        const cap = captureZoomBehaviors(d3, host);
        expect(d3.zoom).not.toBe(original);
        cap.release();
        expect(d3.zoom).toBe(original);
    });

    it("is a no-op when d3 has no zoom at all", () => {
        const { host } = fakeHost({ remember: false });
        for (const d3 of [{}, null, undefined]) {
            const cap = captureZoomBehaviors(d3, host);
            expect(cap.behaviors).toEqual([]);
            expect(() => cap.release()).not.toThrow();
        }
    });

    it("a d3 that refuses the wrap is logged and left alone", () => {
        const original = () => ({});
        const d3: any = Object.freeze({ zoom: original });
        const { host, log } = fakeHost({ remember: false });
        // A frozen object throws on assignment only in strict mode; this module is a module, so it does.
        const cap = captureZoomBehaviors(d3, host);
        expect(cap.behaviors).toEqual([]);
        expect(d3.zoom).toBe(original);
        expect(tags(log)).toEqual(["zoom-capture-wrap-failed"]);
    });
});

describe("the watcher", () => {
    it("attaches listeners once, however many times the chart re-renders", () => {
        const { host, log } = fakeHost({ remember: false });
        attachZoomWatcher(host, KEY);
        const add = (host.zoomContainer as any).addEventListener;
        const first = add.mock.calls.length;
        expect(first).toBeGreaterThan(0);
        attachZoomWatcher(host, KEY);
        expect(add.mock.calls.length).toBe(first);
        expect(tags(log)).toEqual(["zoom-watcher-attached"]);
    });

    it("listens for the gestures that end a zoom or pan, in the capture phase", () => {
        const { host } = fakeHost({ remember: false });
        attachZoomWatcher(host, KEY);
        const calls = (host.zoomContainer as any).addEventListener.mock.calls;
        expect(calls.map((c: any[]) => c[0])).toEqual(["wheel", "pointerup", "pointercancel", "click", "dblclick", "keyup"]);
        for (const call of calls) expect(call[2]).toBe(true);
    });

    it("re-stamps the key on every render so a regeneration is not recorded under the old one", () => {
        const { host } = fakeHost({ remember: false });
        attachZoomWatcher(host, KEY);
        const next = zoomStateKey("code-v2", 800, 600);
        attachZoomWatcher(host, next);
        expect(host.zoomWatchKey).toBe(next);
    });

    it("waits for the gesture to settle (350 ms after the last event) before it records", () => {
        vi.useFakeTimers();
        const { host } = fakeHost({ remember: false });
        attachZoomWatcher(host, KEY);
        const settle = (host.zoomContainer as any).addEventListener.mock.calls[0][1];
        settle();
        vi.advanceTimersByTime(300);
        settle();                                     // a second wheel tick restarts the wait
        vi.advanceTimersByTime(300);
        expect(host.liveZoomState).toBeNull();
        vi.advanceTimersByTime(60);
        expect(host.liveZoomState).toEqual({ k: 3, x: -120, y: -60, key: KEY });
        expect(host.zoomSettleTimer).toBe(0);
    });

    it("no container yet: nothing is attached, and the key is still stamped", () => {
        const { host } = fakeHost({ remember: false });
        host.zoomContainer = null;
        attachZoomWatcher(host, KEY);
        expect(host.zoomWatchAttached).toBe(false);
        expect(host.zoomWatchKey).toBe(KEY);
    });
});

describe("flush and forget", () => {
    it("flushPendingZoom records a gesture that has not settled yet, now, and only once", () => {
        vi.useFakeTimers();
        const { host, log } = fakeHost({ remember: true });
        attachZoomWatcher(host, KEY);
        (host.zoomContainer as any).addEventListener.mock.calls[0][1]();
        expect(host.zoomSettleTimer).not.toBe(0);
        flushPendingZoom(host);
        expect(host.zoomSettleTimer).toBe(0);
        expect(host.liveZoomState).toEqual({ k: 3, x: -120, y: -60, key: KEY });
        vi.advanceTimersByTime(1000);
        expect(tags(log).filter(t => t === "zoom-remembered")).toHaveLength(1);
    });

    it("flushPendingZoom with nothing pending records nothing", () => {
        const { host, persistZoom } = fakeHost({ remember: true });
        host.zoomWatchKey = KEY;
        flushPendingZoom(host);
        expect(host.liveZoomState).toBeNull();
        expect(persistZoom).not.toHaveBeenCalled();
    });

    it("forgetZoom drops the session view and a pending gesture, and persists nothing", () => {
        vi.useFakeTimers();
        const { host, persistZoom } = fakeHost({ remember: true });
        attachZoomWatcher(host, KEY);
        host.liveZoomState = { k: 2, x: -1, y: -1, key: KEY };
        (host.zoomContainer as any).addEventListener.mock.calls[0][1]();
        forgetZoom(host);
        expect(host.liveZoomState).toBeNull();
        expect(host.zoomSettleTimer).toBe(0);
        vi.advanceTimersByTime(1000);
        expect(host.liveZoomState).toBeNull();
        expect(persistZoom).not.toHaveBeenCalled();
    });
});

describe("createZoomMemoryHook", () => {
    it("keys a chart by its code's hash and the viewport bucket", () => {
        const { host } = fakeHost({ remember: false });
        const hook = createZoomMemoryHook(host);
        expect(hook.keyFor("function render(){}", 800, 600)).toBe(zoomStateKey(SIMPLE_STRING_HASH("function render(){}"), 800, 600));
        expect(hook.keyFor("function render(){}", 801, 601)).toBe(hook.keyFor("function render(){}", 800, 600));
        expect(hook.keyFor("function render(){ }", 800, 600)).not.toBe(hook.keyFor("function render(){}", 800, 600));
    });

    it("restore puts the view back and then attaches the watcher under the render's key", () => {
        const applied: any[] = [];
        const { host, log } = fakeHost({ remember: false, node: fakeNode({ k: 1, x: 0, y: 0 }) });
        host.liveZoomState = { k: 4, x: -200, y: -100, key: KEY };
        const behavior: any = { transform: (_s: any, t: any) => applied.push(t), scaleExtent: () => [1, 8] };
        const identity = { k: 1, x: 0, y: 0, translate(x: number, y: number) { return { ...this, x, y }; }, scale(k: number) { return { ...this, k }; } };
        const d3: any = { zoom: () => behavior, zoomIdentity: identity, select: (n: any) => ({ call: (f: any, t: any) => f(n, t) }) };
        const hook = createZoomMemoryHook(host);
        const cap = hook.capture(d3);
        d3.zoom();
        cap.release();
        hook.restore(host.zoomContainer!, cap, KEY, d3);
        expect(applied).toHaveLength(1);
        expect(host.zoomWatchKey).toBe(KEY);
        expect(host.zoomWatchAttached).toBe(true);
        expect(tags(log)).toEqual(["zoom-restored", "zoom-watcher-attached"]);
    });

    it("restore adopts the render's container when the host named none", () => {
        const { host } = fakeHost({ remember: false });
        const container = host.zoomContainer;
        host.zoomContainer = null;
        createZoomMemoryHook(host).restore(container!, { behaviors: [], release: () => undefined }, KEY, {});
        expect(host.zoomContainer).toBe(container);
        expect(host.zoomWatchAttached).toBe(true);
    });

    it("flush and forget are the module's flushPendingZoom and forgetZoom", () => {
        vi.useFakeTimers();
        const { host } = fakeHost({ remember: false });
        const hook = createZoomMemoryHook(host);
        attachZoomWatcher(host, KEY);
        (host.zoomContainer as any).addEventListener.mock.calls[0][1]();
        hook.flush();
        expect(host.liveZoomState).not.toBeNull();
        hook.forget();
        expect(host.liveZoomState).toBeNull();
    });
});
