// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { XFILTER_REFRESH_EVENT, SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS } from "../src/contract";
import { dispatchRowSet, validRowSet, ROW_SET_MAX } from "../src/selection";
import * as main from "../src/index";

// THE ROW-SET FORM OF THE CROSS-FILTER EVENT (2026-10-09).
//
// A chart used to publish a selection only as `{mark, source}` (a DOM element carrying data-row-idx, in
// practice an axis tick) or `{clear, source}`. A selection the chart COMPUTED - a region the reader drew,
// a range they brushed - has no element to point at, and a hidden stand-in element would be a fake tick the
// hit-target heal makes clickable. The third form carries the row indices themselves: `{rows, source}`.

const SVGNS = "http://www.w3.org/2000/svg";

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS("${SVGNS}", "svg");
  container.appendChild(svg);
  const blank = doc.createElementNS("${SVGNS}", "rect");
  blank.setAttribute("class", "backdrop");
  svg.appendChild(blank);
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElementNS("${SVGNS}", "circle");
    m.setAttribute("class", "d3-mark"); m.setAttribute("data-row-idx", String(r));
    svg.appendChild(m);
  }
  window.__cleared = 0;
  container.__llmXfClear = function () { window.__cleared = (window.__cleared || 0) + 1; };
}`;

describe("validRowSet", () => {
    it("keeps whole non-negative numbers, in order, once each", () => {
        expect(validRowSet([3, 1, 2, 1, 3, 0])).toEqual([3, 1, 2, 0]);
    });

    it("drops everything that is not a row index", () => {
        const junk: unknown[] = [1, -1, 2.5, NaN, Infinity, -Infinity, "3", null, undefined, {}, [], true, 4, 1e300];
        expect(validRowSet(junk)).toEqual([1, 4]);
    });

    it("a value that is not an array names no rows", () => {
        for (const v of [undefined, null, "1,2", 7, { length: 2, 0: 1, 1: 2 }]) expect(validRowSet(v)).toEqual([]);
    });

    it("is capped, and the cap is a named number", () => {
        expect(ROW_SET_MAX).toBeGreaterThanOrEqual(10000);
        const many = Array.from({ length: ROW_SET_MAX + 25 }, (_, i) => i);
        const out = validRowSet(many);
        expect(out.length).toBe(ROW_SET_MAX);
        expect(out[ROW_SET_MAX - 1]).toBe(ROW_SET_MAX - 1);
    });
});

describe("a chart publishes a row set", () => {
    let container: HTMLElement;
    let seen: Array<{ rows: number[]; source: string }>;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        seen = [];
        (window as any).__cleared = 0;
    });
    afterEach(() => container.remove());

    const host = (rows = 6) => {
        const h = createChartHost(container, {
            data: { columns: [{ name: "c", dataType: "Text", isMeasure: false }], rows: Array.from({ length: rows }, (_, i) => ["r" + i, i]) },
            code: CHART, d3: {},
        });
        h.selection.onChange((r, source) => seen.push({ rows: r.slice(), source }));
        h.render();
        return h;
    };
    const q = (sel: string) => container.querySelector(sel) as Element;
    const mark = (i: number) => q(`.d3-mark[data-row-idx="${i}"]`);
    const emit = (detail: unknown) => container.dispatchEvent(new CustomEvent(XFILTER_REFRESH_EVENT, { detail, bubbles: true }));

    it("notifies subscribers with the rows and the chart's own source", () => {
        host();
        emit({ rows: [1, 3], source: "lasso" });
        expect(seen).toEqual([{ rows: [1, 3], source: "lasso" }]);
    });

    it("an unnamed source is 'chart'", () => {
        host();
        emit({ rows: [2] });
        expect(seen.at(-1)).toEqual({ rows: [2], source: "chart" });
    });

    it("lights the marks of those rows and dims the rest, through the one selection paint", () => {
        const h = host();
        emit({ rows: [1, 3], source: "user" });
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        const lit = Array.from(container.querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-row-idx"));
        expect(lit).toEqual(["1", "3"]);
        expect(h.selection.current).toEqual([1, 3]);
    });

    it("counts as the chart's own selection: an empty click calls the chart's clear slot first", () => {
        host();
        emit({ rows: [1, 2], source: "user" });
        // A click on empty canvas is outside the echo window of the event above.
        const realNow = Date.now;
        try {
            Date.now = () => realNow() + 1000;
            q(".backdrop").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        } finally { Date.now = realNow; }
        expect((window as any).__cleared).toBe(1);
        expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
    });

    it("a click on a mark selection is not the chart's to undo (the clear slot stays quiet)", () => {
        host();
        mark(1).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        q(".backdrop").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect((window as any).__cleared).toBe(0);
        expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
    });

    it("garbage rows are dropped, not trusted", () => {
        host();
        emit({ rows: [1, -4, 2.5, NaN, "3", null, 5, 1], source: "chart" });
        expect(seen.at(-1)).toEqual({ rows: [1, 5], source: "chart" });
    });

    it("an empty array is a clear", () => {
        const h = host();
        emit({ rows: [1, 2], source: "user" });
        emit({ rows: [], source: "user" });
        expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        expect(container.querySelectorAll(`.${MARK_SELECTED_CLASS}`).length).toBe(0);
    });

    it("a set with nothing valid in it is a clear too", () => {
        host();
        emit({ rows: [1], source: "user" });
        emit({ rows: [NaN, -1, "x"], source: "user" });
        expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
    });

    it("a rows value that is not an array is ignored", () => {
        host();
        emit({ rows: "1,2", source: "user" });
        emit({ rows: { 0: 1 }, source: "user" });
        expect(seen).toEqual([]);
    });

    it("the click that ends the same gesture is the event's echo and is ignored", () => {
        host();
        emit({ rows: [1, 2], source: "user" });
        mark(4).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(seen.map(s => s.rows)).toEqual([[1, 2]]);
    });

    it("the clear and mark forms are unchanged", () => {
        host();
        emit({ mark: Object.assign(document.createElement("div"), {}), source: "scrub" });
        expect(seen.at(-1)!.source).toBe("scrub");
        emit({ rows: [2], source: "user" });
        emit({ clear: true, source: "scrub" });
        expect(seen.at(-1)).toEqual({ rows: [], source: "scrub" });
    });

    it("the mark form still reads data-row-idx off the element", () => {
        host();
        const tick = document.createElement("div");
        tick.setAttribute("data-row-idx", "2,4");
        emit({ mark: tick, source: "scrub" });
        expect(seen.at(-1)).toEqual({ rows: [2, 4], source: "scrub" });
    });
});

describe("dispatchRowSet", () => {
    it("fires the event on the container, bubbling, carrying exactly the rows and the source", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const got: any[] = [];
        document.body.addEventListener(XFILTER_REFRESH_EVENT, e => got.push((e as CustomEvent).detail));
        dispatchRowSet(container, [4, 5], "brush");
        dispatchRowSet(container, [], "brush");
        expect(got).toEqual([{ rows: [4, 5], source: "brush" }, { rows: [], source: "brush" }]);
        container.remove();
    });

    it("sends only valid rows", () => {
        const container = document.createElement("div");
        const got: any[] = [];
        container.addEventListener(XFILTER_REFRESH_EVENT, e => got.push((e as CustomEvent).detail));
        dispatchRowSet(container, [1, NaN, -2, 3, 3] as number[], "x");
        expect(got).toEqual([{ rows: [1, 3], source: "x" }]);
    });

    it("is on the package entry", () => {
        expect(main.dispatchRowSet).toBeTypeOf("function");
        expect(main.dispatchRowSet).toBe(dispatchRowSet);
        expect(main.validRowSet).toBe(validRowSet);
        expect(main.ROW_SET_MAX).toBeGreaterThan(0);
        expect(main.ROW_SET_MAX).toBe(ROW_SET_MAX);
    });
});
