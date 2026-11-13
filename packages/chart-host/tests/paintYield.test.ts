import { describe, it, expect, vi, afterEach } from "vitest";
import { yieldForPaint, PAINT_YIELD_FALLBACK_MS } from "../src/paintYield";

// A busy indicator raised right before a synchronous render is only seen if the browser paints a frame in between.
// A requestAnimationFrame callback runs before that paint; the wait must end only on a timer queued from inside it.

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function fakeFrames(visibility = "visible") {
    const frames: Array<(t: number) => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("document", { visibilityState: visibility });
    const runFrame = () => { const f = frames.splice(0); f.forEach(cb => cb(0)); };
    return { frames, runFrame };
}

describe("yieldForPaint", () => {
    it("does not resolve before an animation frame has run, however many timers pass short of the fallback", async () => {
        vi.useFakeTimers();
        const { frames } = fakeFrames();
        let resolved = false;
        void yieldForPaint().then(() => { resolved = true; });
        // Everything a plain `await setTimeout(0)` would have let through, but no frame: still waiting.
        await vi.advanceTimersByTimeAsync(PAINT_YIELD_FALLBACK_MS - 1);
        expect(frames.length).toBe(1);
        expect(resolved).toBe(false);
    });

    it("resolves on a timer queued INSIDE the frame callback, not in the callback itself", async () => {
        vi.useFakeTimers();
        const { runFrame } = fakeFrames();
        let resolved = false;
        void yieldForPaint().then(() => { resolved = true; });
        runFrame();
        // The frame callback ran (that is before the paint); the paint has not happened yet.
        await Promise.resolve();
        await Promise.resolve();
        expect(resolved).toBe(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toBe(true);
    });

    it("never hangs when no frame comes (a page hidden after the call)", async () => {
        vi.useFakeTimers();
        fakeFrames();
        let resolved = false;
        void yieldForPaint().then(() => { resolved = true; });
        await vi.advanceTimersByTimeAsync(PAINT_YIELD_FALLBACK_MS);
        expect(resolved).toBe(true);
    });

    it("skips the frame wait on a hidden page", async () => {
        vi.useFakeTimers();
        const { frames } = fakeFrames("hidden");
        let resolved = false;
        void yieldForPaint().then(() => { resolved = true; });
        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toBe(true);
        expect(frames.length).toBe(0);
    });

    it("resolves on a zero-delay timer where requestAnimationFrame is missing", async () => {
        // vitest's node environment has no requestAnimationFrame.
        expect(typeof (globalThis as any).requestAnimationFrame).toBe("undefined");
        vi.useFakeTimers();
        let resolved = false;
        void yieldForPaint().then(() => { resolved = true; });
        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toBe(true);
    });

    it("is exported from the package entry", async () => {
        const entry = await import("../src/index");
        expect(typeof entry.yieldForPaint).toBe("function");
        expect(entry.PAINT_YIELD_FALLBACK_MS).toBe(PAINT_YIELD_FALLBACK_MS);
    });
});
