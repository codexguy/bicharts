// LET THE BROWSER PAINT BEFORE A LONG SYNCHRONOUS RENDER.
//
// A host that raises a busy indicator (a spinner, a "drawing..." line) and then calls a chart's render() in the same
// task never shows that indicator: render() is synchronous, the style change is still unpainted when the main thread
// blocks, and by the time the browser gets to paint the render has finished and the host has lowered the indicator
// again. The reader sees nothing at all for the whole render, however long it takes.
//
// `await yieldForPaint()` between raising the indicator and calling render() hands the browser one frame. A
// requestAnimationFrame callback runs just BEFORE the frame is painted, so resolving there would still be too early;
// a zero-delay timer queued from inside it runs after that frame is painted. Once the indicator is on screen, an
// indicator animated with CSS `transform` or `opacity` keeps turning on the compositor while the main thread is busy.
//
// Two places a frame never comes, so the wait never hangs on one:
// - no requestAnimationFrame at all (a worker, a test environment), or a hidden document, where the browser pauses
//   animation frames: a plain zero-delay timer;
// - a page hidden after the call was made: a fallback timer resolves the wait anyway.
// The cost is one frame (about 16 ms at 60 Hz) on a visible page, and a host pays it once per render.
//
// Kept small on purpose: it sits in the package's eager closure (scripts/checkEagerSize.mjs).

/** Longest the wait lasts when no animation frame arrives (a page hidden after the call). Well above one frame. */
export const PAINT_YIELD_FALLBACK_MS = 100;

/**
 * Resolves after the browser has painted the page as it stands now: after the next animation frame, from a timer
 * queued inside it. Without animation frames (no requestAnimationFrame, or a hidden page) it resolves on a zero-delay
 * timer. Never rejects, and never waits longer than PAINT_YIELD_FALLBACK_MS for a frame that does not come.
 */
export function yieldForPaint(): Promise<void> {
    const g: any = globalThis;
    return new Promise<void>((done) => {
        const raf = g.requestAnimationFrame;
        if (typeof raf !== "function" || g.document?.visibilityState === "hidden") {
            setTimeout(done, 0);
            return;
        }
        // A second resolve of a settled promise does nothing, so whichever timer runs first ends the wait.
        const fallback = setTimeout(done, PAINT_YIELD_FALLBACK_MS);
        raf.call(g, () => setTimeout(() => { clearTimeout(fallback); done(); }, 0));
    });
}
