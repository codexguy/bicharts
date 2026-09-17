// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart } from "../src/react";

// <BicChart onInvalidSentinel> is a pass-through to createChartHost, with one property that
// matters more than the wiring: the prop's ABSENCE must still mean "throw". The host decides
// whether to swallow the sentinel by whether the callback is set, so a binding that always hands
// it a wrapper would silently hide the throw from every page that never asked.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const THROWS_SENTINEL = `
function render(container, data, options) {
  container.appendChild(container.ownerDocument.createElement("div"));
  throw new Error('INVALID:column "Revenue" not found');
}`;

const DATA = { columns: [{ name: "Region" }], rows: [["East"]] } as any;
// ONE d3 object for every render: a new literal per render is a new identity, which rebuilds the host.
const D3 = {};

let el: HTMLDivElement;
let root: Root;
let uncaught: unknown[];
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    uncaught = [];
    root = createRoot(el, { onUncaughtError: (e: unknown) => { uncaught.push(e); } });
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

const chartEl = () => el.firstElementChild as HTMLElement | null;

describe("<BicChart onInvalidSentinel>", () => {
    it("supplied: the page hears the reason, nothing reaches React, the chart element is empty", async () => {
        const got: Array<{ reason: string; message: string }> = [];
        await act(async () => {
            root.render(createElement(BicChart, {
                code: THROWS_SENTINEL, data: DATA, d3: D3,
                onInvalidSentinel: (info: { reason: string; message: string }) => got.push(info),
            }));
        });
        // The binding paints on mount and again when its data effect first runs, so the callback
        // hears every paint; what matters is that it heard one and nothing escaped.
        expect(got.length).toBeGreaterThanOrEqual(1);
        for (const g of got) expect(g.reason).toBe('column "Revenue" not found');
        expect(uncaught).toEqual([]);
        expect(chartEl()?.innerHTML).toBe("");
    });

    it("the NEWEST callback is the one called, without rebuilding the chart", async () => {
        const first: unknown[] = [];
        const second: unknown[] = [];
        await act(async () => {
            root.render(createElement(BicChart, {
                code: THROWS_SENTINEL, data: DATA, d3: D3, onInvalidSentinel: (i: unknown) => first.push(i),
            }));
        });
        const heardOnMount = first.length;
        expect(heardOnMount).toBeGreaterThanOrEqual(1);
        // A new data object re-renders through setData on the SAME host.
        await act(async () => {
            root.render(createElement(BicChart, {
                code: THROWS_SENTINEL, data: { ...DATA, rows: [["West"]] }, d3: D3, onInvalidSentinel: (i: unknown) => second.push(i),
            }));
        });
        expect(first.length).toBe(heardOnMount);
        expect(second.length).toBe(1);
        expect(uncaught).toEqual([]);
    });

    it("absent: the throw still reaches React, carrying the sentinel", async () => {
        // act() rethrows what escaped the tree (an AggregateError when several paints threw); a
        // root outside act reports it to onUncaughtError. Either way the sentinel must arrive -
        // which route it takes depends on React, not on this binding.
        let rethrown: unknown = null;
        try {
            await act(async () => {
                root.render(createElement(BicChart, { code: THROWS_SENTINEL, data: DATA, d3: D3 }));
            });
        } catch (e) { rethrown = e; }
        const flatten = (e: any): any[] => Array.isArray(e?.errors) ? e.errors.flatMap(flatten) : [e];
        const escaped = [rethrown, ...uncaught].filter(Boolean).flatMap(flatten);
        expect(escaped.length).toBeGreaterThanOrEqual(1);
        expect(escaped.some(e => String(e?.message ?? e).includes('INVALID:column "Revenue" not found'))).toBe(true);
    });
});
