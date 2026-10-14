// REMEMBER ZOOM / PAN - the DOM half, over a state object the host supplies. See ./zoomMemory.ts for the
// pure logic and for WHY this lives in the host rather than in the chart's zoom helper (short version:
// shared helpers are baked into generated code when it is generated, so a helper change would reach new
// generations only).
//
// Three jobs, in the order they happen on a render:
//
//   1. captureZoomBehaviors - wrap d3.zoom for the duration of the generated code's run, so the host holds
//      a reference to whatever zoom behavior it creates.
//   2. restoreZoomForRender - right after render() returns, put the remembered transform back, BEFORE the
//      browser paints, so the chart opens where the reader left it instead of opening at full extent and
//      visibly jumping.
//   3. attachZoomWatcher - after interaction settles, read the transform back off the DOM and remember it
//      (in the session always; in the persisted store only while the host's preference is on).
//
// The d3 handed in is the one the CHART was handed. A module namespace d3 is frozen, so a host that copies
// it before compiling the chart must wrap that copy: wrapping the original would watch an object the chart
// never touches.
import { SIMPLE_STRING_HASH } from "@bicharts/shape-core";
import {
    type ZoomState,
    type ZoomTransform,
    isIdentity,
    isZoomStateUsable,
    parseZoomState,
    readNodeTransform,
    serializeZoomState,
    soleZoomedNode,
    transformsDiffer,
    zoomStateKey,
} from "./zoomMemory";
import { noteZoomMemoryHost } from "../zoomHookIdentity";

/**
 * WHAT A HOST SUPPLIES: where the remembered view lives, and whether it may outlive the session.
 * One per chart container, kept for as long as the container is, so it outlives a host that is destroyed
 * and re-created on the same element (a redraw on every resize, say).
 */
export interface ZoomMemoryHost {
    /** The in-session tier, always on: survives every re-render, never written anywhere. */
    liveZoomState: ZoomState | null;
    /** The key the watcher stamps on what it records (the latest render's). */
    zoomWatchKey: string;
    /** Whether the watcher's listeners are on zoomContainer (they attach once). */
    zoomWatchAttached: boolean;
    /** The pending settle timer, 0 when none. */
    zoomSettleTimer: number;
    /** The element the chart draws into; it outlives each render, so listeners attach to it once. Null until
     *  known: createZoomMemoryHook's restore adopts the render's container then, and moves to a new one when a
     *  render arrives on a different element (a remount). */
    zoomContainer: Element | null;
    /** Is the persisted tier on NOW? Read on every restore and every write, so a change applies to the next. */
    rememberAcrossSessions(): boolean;
    /** The persisted blob, or null. Read only while rememberAcrossSessions() is true; `key` is the current
     *  render's, for a host that wants to say why a saved view did not apply. */
    readPersistedZoom(key: string): string | null;
    /** Write the persisted blob; "" forgets it. Called only while rememberAcrossSessions() is true. */
    persistZoom(json: string): void;
    /** Diagnostics: a tag and a small payload. Never transform data beyond the three numbers and the key. */
    log(tag: string, data?: Record<string, unknown>): void;
}

/** What captureZoomBehaviors hands back: the behaviors the chart created, and the unwrap. */
export interface ZoomCapture {
    behaviors: any[];
    release: () => void;
}

/** Interaction has to STOP before it is recorded - otherwise a drag writes to the store on every
 *  mousemove. Long enough to coalesce a gesture, short enough that a cross-filter click landing right
 *  after a zoom still captures it. */
const SETTLE_MS = 350;

/** Wrap `d3.zoom` so every behavior the generated code creates is recorded.
 *
 *  This works BECAUSE d3's chainable setters mutate and return the same object:
 *  `d3.zoom().scaleExtent([1,8]).translateExtent(...)` hands back the very object captured, so the
 *  reference stays live no matter how the chart configures it. (Wrapping the returned object instead
 *  would NOT work - the first chained call would unwrap it.) */
export function captureZoomBehaviors(d3: any, host: ZoomMemoryHost): ZoomCapture {
    const noop: ZoomCapture = { behaviors: [], release: () => undefined };
    if (!d3 || typeof d3.zoom !== "function") return noop;
    const behaviors: any[] = [];
    const original = d3.zoom;
    try {
        const wrapped: any = function (this: any, ...args: any[]) {
            const b = original.apply(this, args);
            try { if (b) behaviors.push(b); } catch { /* never break a render to take a note */ }
            return b;
        };
        // d3.zoom carries no statics today, but copying own props costs nothing and means a
        // future one does not silently vanish for the duration of a render.
        try { for (const k of Object.keys(original)) wrapped[k] = (original as any)[k]; } catch { /* ignore */ }
        d3.zoom = wrapped;
    } catch (e) {
        host.log("zoom-capture-wrap-failed", { message: e instanceof Error ? e.message : String(e) });
        return noop;
    }
    return {
        behaviors,
        release: () => {
            // ALWAYS restore, even if the render threw. Leaving a wrapper installed would
            // stack one more layer per render for the life of the host.
            try { d3.zoom = original; } catch { /* ignore */ }
        }
    };
}

/** Clamp a candidate transform using the BEHAVIOR'S OWN limits.
 *
 *  `zoom.transform` does not constrain (d3 constrains inside its wheel/drag handlers and assigns the
 *  result), so applying a remembered transform blind could park the view off the edge of the data - an
 *  empty chart. Rather than re-implement d3's constraint maths as a second source of truth, ask the
 *  behavior for its own accessors and its own constrain function. Every one of these is a documented
 *  no-arg getter. */
function constrainToBehavior(d3: any, behavior: any, node: any, t: ZoomTransform): any {
    let out = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
    try {
        const scaleExtent = typeof behavior.scaleExtent === "function" ? behavior.scaleExtent() : null;
        if (scaleExtent && scaleExtent.length === 2) {
            const k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], t.k));
            out = d3.zoomIdentity.translate(t.x, t.y).scale(k);
        }
    } catch { /* keep the unclamped scale */ }
    try {
        const constrain = typeof behavior.constrain === "function" ? behavior.constrain() : null;
        const extentFn = typeof behavior.extent === "function" ? behavior.extent() : null;
        const translateExtent = typeof behavior.translateExtent === "function" ? behavior.translateExtent() : null;
        if (typeof constrain === "function" && translateExtent) {
            // extent() is an ACCESSOR invoked with the node as `this` - that is how d3 lets a
            // chart size the viewport from the element itself.
            const extent = typeof extentFn === "function" ? extentFn.apply(node, [node && (node as any).__data__]) : extentFn;
            if (extent) out = constrain(out, extent, translateExtent);
        }
    } catch { /* an exotic behavior: fall through with the scale-clamped transform */ }
    return out;
}

/** What is worth restoring for this render: the in-session memory first, then the persisted one - and
 *  the persisted one ONLY when the host's preference is on.
 *
 *  Session-before-file matters. A persisted copy can lag the write that made it, so a cross-filter
 *  re-render moments after a zoom would otherwise restore the PREVIOUS transform and undo what the reader
 *  just did. */
function rememberedFor(host: ZoomMemoryHost, key: string): ZoomState | null {
    if (isZoomStateUsable(host.liveZoomState, key)) return host.liveZoomState;
    if (!rememberAcrossSessions(host)) return null;
    let raw: string | null = null;
    try { raw = host.readPersistedZoom(key); } catch { raw = null; }
    const persisted = parseZoomState(raw);
    return isZoomStateUsable(persisted, key) ? persisted : null;
}

function rememberAcrossSessions(host: ZoomMemoryHost): boolean {
    try { return !!host.rememberAcrossSessions(); } catch { return false; }
}

/** Put the remembered view back. Called synchronously after render() returned and before the browser
 *  paints - which is what makes this a restore rather than a visible jump - and before any pass that
 *  measures the chart, so they measure the view the reader will see. */
export function restoreZoomForRender(d3: any, host: ZoomMemoryHost, capture: ZoomCapture, key: string): void {
    try {
        const state = rememberedFor(host, key);
        if (!state) return;
        const node = soleZoomedNode(host.zoomContainer);
        if (!node) return;                                   // no zoom on this chart, or several
        const current = readNodeTransform(node);
        if (current && !transformsDiffer(current, state)) return;   // already there
        const behavior = capture.behaviors.length === 1 ? capture.behaviors[0] : null;
        if (!behavior || typeof behavior.transform !== "function") {
            // The chart zooms but its behavior was never seen (hand-rolled through a path that does not
            // call d3.zoom, or several behaviors). Do nothing: a transform can be read without the
            // behavior but not APPLIED safely, and half a feature that silently mis-positions a map is
            // worse than none.
            host.log("zoom-restore-no-behavior", { behaviors: capture.behaviors.length });
            return;
        }
        if (!d3 || !d3.zoomIdentity || typeof d3.select !== "function") return;
        const t = constrainToBehavior(d3, behavior, node, state);
        d3.select(node).call(behavior.transform, t);
        host.log("zoom-restored", { k: round(t.k), x: round(t.x), y: round(t.y), key });
    } catch (e) {
        // A failed restore must never cost the reader the chart itself.
        host.log("zoom-restore-ex", { message: e instanceof Error ? e.message : String(e) });
    }
}

function round(n: number): number { return Math.round(n * 100) / 100; }

/** Record the transform after interaction settles.
 *
 *  Listeners are attached ONCE to the container (which outlives individual renders) and read the key
 *  from the host object, so a re-render does not stack another set. Capture phase, because the chart's
 *  own handlers may stop propagation. */
export function attachZoomWatcher(host: ZoomMemoryHost, key: string): void {
    host.zoomWatchKey = key;
    const ctr = host.zoomContainer;
    if (host.zoomWatchAttached || !ctr) return;
    const settle = () => {
        if (host.zoomSettleTimer) clearTimeout(host.zoomSettleTimer);
        host.zoomSettleTimer = setTimeout(() => {
            host.zoomSettleTimer = 0;
            captureCurrentZoom(host);
        }, SETTLE_MS) as unknown as number;
    };
    // wheel + pointerup cover zoom and drag-pan; click + keyup cover a zoom pad's buttons and their
    // keyboard equivalents; dblclick is d3-zoom's built-in zoom-in.
    for (const evt of WATCHED_EVENTS) {
        try { ctr.addEventListener(evt, settle, true); } catch { /* ignore */ }
    }
    attachedWatchers.set(host, { ctr, settle });
    host.zoomWatchAttached = true;
    host.log("zoom-watcher-attached", {});
}

const WATCHED_EVENTS = ["wheel", "pointerup", "pointercancel", "click", "dblclick", "keyup"];
// The listeners attachZoomWatcher put on, per host object, so they can be taken off again when the hook moves to a new
// element. Kept here rather than on ZoomMemoryHost so that interface, which hosts implement, is unchanged; weak, so a
// host object dropped by its page takes its entry with it.
const attachedWatchers = new WeakMap<ZoomMemoryHost, { ctr: Element; settle: () => void }>();

/** Take the watcher off the element it is on and drop a settle still pending there, so the next attachZoomWatcher
 *  attaches afresh. The session view is kept. */
function detachZoomWatcher(host: ZoomMemoryHost): void {
    const w = attachedWatchers.get(host);
    if (w) {
        for (const evt of WATCHED_EVENTS) {
            try { w.ctr.removeEventListener(evt, w.settle, true); } catch { /* ignore */ }
        }
        attachedWatchers.delete(host);
    }
    if (host.zoomSettleTimer) clearTimeout(host.zoomSettleTimer);
    host.zoomSettleTimer = 0;
    host.zoomWatchAttached = false;
}

/** Read the live transform off the DOM and remember it. */
export function captureCurrentZoom(host: ZoomMemoryHost): void {
    try {
        const key = host.zoomWatchKey;
        if (!key) return;
        const node = soleZoomedNode(host.zoomContainer);
        if (!node) return;
        const t = readNodeTransform(node);
        if (!t) return;
        // Zoomed back out: FORGET rather than remember the identity. Otherwise "reset the view" would
        // still be a remembered view, and the persisted copy would keep being rewritten every time
        // somebody undid their zoom.
        if (isIdentity(t)) {
            if (host.liveZoomState) {
                host.liveZoomState = null;
                persist(host, "");
                host.log("zoom-forgotten", { key });
            }
            return;
        }
        const previous: ZoomState | null = host.liveZoomState;
        if (previous && previous.key === key && !transformsDiffer(previous, t)) return;   // unchanged
        host.liveZoomState = { k: t.k, x: t.x, y: t.y, key };
        persist(host, serializeZoomState(t, key));
        host.log("zoom-remembered", { k: round(t.k), x: round(t.x), y: round(t.y), key });
    } catch (e) {
        host.log("zoom-capture-ex", { message: e instanceof Error ? e.message : String(e) });
    }
}

/** Write (or clear) the persisted transform - ONLY while the host's preference is on. */
function persist(host: ZoomMemoryHost, json: string): void {
    if (!rememberAcrossSessions(host)) return;
    host.persistZoom(json);
}

/** A gesture that has not settled yet is recorded NOW. Call it before the chart's DOM goes away (a
 *  redraw, a teardown): the pending timer would otherwise fire over an empty container and lose it. */
export function flushPendingZoom(host: ZoomMemoryHost): void {
    if (!host.zoomSettleTimer) return;
    clearTimeout(host.zoomSettleTimer);
    host.zoomSettleTimer = 0;
    captureCurrentZoom(host);
}

/** Drop the session view and any pending gesture, and persist nothing - for a host that swaps in a
 *  different chart, where a timer armed on the old one must not write after the swap. */
export function forgetZoom(host: ZoomMemoryHost): void {
    if (host.zoomSettleTimer) clearTimeout(host.zoomSettleTimer);
    host.zoomSettleTimer = 0;
    host.liveZoomState = null;
}

/** WHAT createChartHost TAKES as `zoomMemory`: the functions above bound to one ZoomMemoryHost. */
export interface ZoomMemoryHook {
    /** The key a render's view is remembered under: the code's hash and the viewport's 32px bucket. */
    keyFor(code: string, width: number, height: number): string;
    /** Wrap d3.zoom on the d3 the chart is handed, for the duration of its run. */
    capture(d3: any): ZoomCapture;
    /** Put the remembered view back, then attach the watcher (once) under this render's key. */
    restore(container: Element, capture: ZoomCapture, key: string, d3: any): void;
    /** flushPendingZoom: record a gesture still settling. */
    flush(): void;
    /** forgetZoom: drop the session view and a pending gesture. */
    forget(): void;
}

/** Bind the zoom memory to one host object. Build it once per chart and hand the same hook to every
 *  host created for it, so the session tier outlives each one - on the same element, or on a new one
 *  after a remount, where the watcher moves with it. */
export function createZoomMemoryHook(host: ZoomMemoryHost): ZoomMemoryHook {
    const hook: ZoomMemoryHook = {
        keyFor: (code, width, height) => zoomStateKey(SIMPLE_STRING_HASH(String(code ?? "")), width, height),
        capture: d3 => captureZoomBehaviors(d3, host),
        restore: (container, capture, key, d3) => {
            // A NEW ELEMENT (a component remounted with the same hook): the watcher moves to it, and the old one is let
            // go, listeners and all, instead of being watched - and kept alive - while the chart draws elsewhere.
            if (host.zoomContainer && host.zoomContainer !== container) {
                detachZoomWatcher(host);
                host.zoomContainer = null;
            }
            if (!host.zoomContainer) host.zoomContainer = container;
            restoreZoomForRender(d3, host, capture, key);
            attachZoomWatcher(host, key);
        },
        flush: () => flushPendingZoom(host),
        forget: () => forgetZoom(host),
    };
    // So a binding can tell a hook rebuilt over the same host (written inline in a component's props) from a new memory.
    noteZoomMemoryHost(hook, host);
    return hook;
}
