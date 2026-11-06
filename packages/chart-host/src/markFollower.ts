// MARKS THAT MOVE WITHOUT A RENDER.
//
// A pan or zoom, a transition, an animation frame, a legend toggle that hides a series: the marks move or hide, and no
// render runs to tell the host. Anything a host paints over the marks (a selection glyph, a selection outline) is then
// left where the marks were, which is worse than nothing. While a host has something painted, it watches the chart for
// the attribute writes that move or hide a mark, and repaints on the next frame, once however many writes land in it.
//
// Only a write ON a mark, or on an element that holds one (the zoom layer, the svg), counts: a hover focus dot or a
// tooltip moved on every pointer move would otherwise repaint once a frame. Writes inside `blind` (the host's own
// layers) never count. A LAYOUT CHANGE THAT WRITES NOTHING - a hidden tab shown, a responsive chart whose container the
// page resized - moves the marks with no attribute write at all, so the container is watched for its size too, where
// the browser can (ResizeObserver); only a size that differs from the one last painted at repaints.
//
// One mechanism for every host: chart-host's own host and a host that draws its own layer (the Power BI visual) both
// follow marks through this.

import { MARK_CLASS } from "./contract";

export interface MarkFollowerOptions {
    /** Elements whose own writes never count (the host's layers), as a selector. */
    blind?: string;
    /** The window whose observers and frames to use. Default: the container's own. */
    win?: any;
    /** Called on the next frame after the marks moved; `resized` is true when the container's size changed. */
    repaint(resized: boolean): void;
}

export interface MarkFollower {
    /** Start (true) or stop (false) following. Connecting twice is harmless. */
    follow(on: boolean): void;
    /** Note the container's size now, as painted at: a later size equal to it repaints nothing. Call at each paint. */
    painted(): void;
    /** Drop the writes already recorded: call after a paint, whose own writes (the selection's classes) are in it. */
    takeRecords(): void;
    /** Whether it is following now. */
    readonly following: boolean;
}

/** The attributes whose writes can move or hide a mark. */
export const MARK_MOVE_ATTRIBUTES: readonly string[] = Object.freeze(["transform", "d", "x", "y", "cx", "cy", "points",
    "width", "height", "visibility", "opacity", "style", "class"]);

export function followMarks(container: HTMLElement, opts: MarkFollowerOptions): MarkFollower {
    const win: any = opts.win ?? container.ownerDocument?.defaultView ?? null;
    let observer: MutationObserver | null = null;
    let resize: ResizeObserver | null = null;
    let size = "";
    let queued = false;
    let queuedResize = false;
    const sizeOf = () => `${container.offsetWidth ?? 0}x${container.offsetHeight ?? 0}`;
    const movesAMark = (r: MutationRecord) => {
        const t = r.target as Element;
        if (!t || (opts.blind && t.closest?.(opts.blind))) return false;
        return !!(t.classList?.contains(MARK_CLASS) || t.querySelector?.(`.${MARK_CLASS}`));
    };
    const queue = (resized: boolean) => {
        if (resized) queuedResize = true;
        if (queued) return;
        queued = true;
        const run = () => {
            const r = queuedResize;
            queued = false; queuedResize = false;
            if (observer || resize) {
                try { opts.repaint(r); } catch { /* a repaint must never break the chart */ }
            }
        };
        if (win?.requestAnimationFrame) win.requestAnimationFrame(run); else setTimeout(run, 16);
    };
    return {
        follow(on: boolean) {
            if (!on) {
                if (observer) { observer.disconnect(); observer = null; }
                if (resize) { resize.disconnect(); resize = null; }
                return;
            }
            const MO = win?.MutationObserver as typeof MutationObserver | undefined;
            if (!observer && MO) {
                observer = new MO(records => { if (!queued && records.some(movesAMark)) queue(false); });
                observer.observe(container, { subtree: true, attributes: true, attributeFilter: [...MARK_MOVE_ATTRIBUTES] });
            }
            const RO = (win as any)?.ResizeObserver as typeof ResizeObserver | undefined;
            if (!resize && RO) {
                // Its first call reports the size already drawn at; only a size that differs from the last paint's repaints.
                resize = new RO(() => { if (sizeOf() !== size) queue(true); });
                resize.observe(container);
            }
        },
        painted() { size = sizeOf(); },
        takeRecords() { observer?.takeRecords(); },
        get following() { return !!(observer || resize); },
    };
}
