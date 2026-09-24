// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useMeasuredSize, assembleD3 } from "../src/react";

// useMeasuredSize: the size a chart should draw at is its element's box, not a number written into
// the page. jsdom lays nothing out, so the box is stubbed and the resize is driven by hand.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let observers: Array<{ cb: () => void; disconnected: boolean }> = [];
class FakeResizeObserver {
    private rec: { cb: () => void; disconnected: boolean };
    constructor(cb: () => void) { this.rec = { cb, disconnected: false }; observers.push(this.rec); }
    observe() { /* the test calls the callback itself */ }
    disconnect() { this.rec.disconnected = true; }
}

let box = { width: 640.4, height: 399.6 };
let el: HTMLDivElement;
let root: Root;
let seen: Array<{ width: number; height: number }>;
beforeEach(() => {
    observers = [];
    seen = [];
    box = { width: 640.4, height: 399.6 };
    (globalThis as any).ResizeObserver = FakeResizeObserver;
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
    delete (globalThis as any).ResizeObserver;
});

function Probe() {
    const ref = useRef<HTMLDivElement | null>(null);
    const size = useMeasuredSize(ref);
    seen.push(size);
    return createElement("div", {
        ref: (node: HTMLDivElement | null) => {
            ref.current = node;
            if (node) node.getBoundingClientRect = () => ({ width: box.width, height: box.height } as DOMRect);
        },
    });
}

describe("useMeasuredSize", () => {
    it("measures the element before paint, rounded to whole pixels", async () => {
        await act(async () => { root.render(createElement(Probe)); });
        expect(seen[0]).toEqual({ width: 0, height: 0 });
        expect(seen.at(-1)).toEqual({ width: 640, height: 400 });
    });

    it("follows a resize, and a resize that changes nothing keeps the same size object", async () => {
        await act(async () => { root.render(createElement(Probe)); });
        const before = seen.at(-1);
        await act(async () => { observers[0].cb(); });
        // The same object, so options memoised on it do not change and the chart does not redraw.
        expect(seen.at(-1)).toBe(before);
        box = { width: 320, height: 200 };
        await act(async () => { observers[0].cb(); });
        expect(seen.at(-1)).toEqual({ width: 320, height: 200 });
    });

    it("stops observing on unmount", async () => {
        await act(async () => { root.render(createElement(Probe)); });
        await act(async () => root.unmount());
        expect(observers[0].disconnected).toBe(true);
        root = createRoot(el);
    });

    it("the react entry re-exports assembleD3", () => {
        expect(assembleD3({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    });
});
