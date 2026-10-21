// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChartHost, type ChartHost } from "../src/host";
import { resolveOptions } from "../src/defaults";
import { SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS } from "../src/contract";
import { LASSO_EVENT, LASSO_ROW_CAP, lassoEffect, type LassoEventDetail } from "../src/lasso";
import { createFilter } from "../src/filterScope";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, BicChartGroup } from "../src/react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// THE LASSO, AS THE HOST WIRES IT (2026-10-09). The gesture itself is in lasso.test.ts; this is the host's half:
// when a render gets a lasso, that a re-render keeps it without republishing it, and that it shares the host's
// one selection - the dim, the subscribers, the clear slot - instead of keeping a selection of its own.
//
// jsdom lays nothing out, so the marks carry their client boxes in data-box (see lasso.test.ts for the plot).

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("data-box", "10,20,400,300"); svg.setAttribute("viewBox", "0 0 400 300");
  const plot = doc.createElementNS(NS, "g");
  plot.setAttribute("class", "lch-plot"); plot.setAttribute("transform", "translate(40,30)"); plot.setAttribute("data-bbox", "0,0,300,200");
  svg.appendChild(plot);
  const POS = [[50, 50], [100, 50], [150, 50], [50, 150], [100, 150], [250, 100]];
  for (let r = 0; r < data.rows.length && r < POS.length; r++) {
    const c = doc.createElementNS(NS, "circle");
    c.setAttribute("class", "d3-mark"); c.setAttribute("data-row-idx", String(r));
    c.setAttribute("data-box", (50 + POS[r][0] - 3) + "," + (50 + POS[r][1] - 3) + ",6,6");
    plot.appendChild(c);
  }
  container.appendChild(svg);
  container.__llmXfClear = function () { window.__cleared = (window.__cleared || 0) + 1; };
}`;
const DATA = { columns: [{ name: "c", dataType: "Text", isMeasure: false }], rows: [0, 1, 2, 3, 4, 5].map(i => ["r" + i, i]) } as any;
const AROUND_012: Array<[number, number]> = [[80, 80], [230, 80], [230, 130], [80, 130], [80, 80]];

const ptr = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: type === "click" ? 1 : 0, ...extra });
    Object.defineProperty(e, "pointerId", { value: 1 });
    Object.defineProperty(e, "isPrimary", { value: true });
    return e;
};

describe("resolveOptions carries the lasso setting", () => {
    it("passes it through untouched, and leaves it absent when the host sent none", () => {
        const lasso = { capable: true, enabled: false, rowCap: 100, actions: ["select"] };
        expect(resolveOptions({ lasso }).lasso).toBe(lasso);
        expect(resolveOptions({}).lasso).toBeUndefined();
        expect("lasso" in resolveOptions({})).toBe(true);
    });
});

describe("the host runs the lasso", () => {
    let container: HTMLElement;
    let host: ChartHost;
    let seen: Array<{ rows: number[]; source: string }>;
    let events: LassoEventDetail[];

    beforeEach(() => {
        const orig = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const mk = (l: number, t: number, w: number, h: number) =>
                ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;
            if (this.classList?.contains("lch-lasso-surface")) {      // the plot group sits at client (50,50)
                const n = (a: string) => parseFloat(this.getAttribute(a) || "0");
                return mk(50 + n("x"), 50 + n("y"), n("width"), n("height"));
            }
            const box = this.getAttribute?.("data-box");
            if (box) { const [l, t, w, h] = box.split(",").map(Number); return mk(l, t, w, h); }
            return orig.call(this);
        });
        (window as any).SVGElement.prototype.getBBox = function (this: Element) {
            const b = (this.getAttribute("data-bbox") || "0,0,0,0").split(",").map(Number);
            return { x: b[0], y: b[1], width: b[2], height: b[3] };
        };
        (window as any).__cleared = 0;
        container = document.createElement("div");
        document.body.appendChild(container);
        seen = []; events = [];
        container.addEventListener(LASSO_EVENT, e => events.push((e as CustomEvent).detail));
    });
    afterEach(() => { host?.destroy(); container.remove(); vi.restoreAllMocks(); });

    // `null` is a host that sent no options at all.
    const make = (options: Record<string, unknown> | null = { lasso: { capable: true } }, data = DATA) => {
        host = createChartHost(container, { data, code: CHART, d3: {}, options: options ?? undefined } as any);
        host.selection.onChange((rows, source) => seen.push({ rows: rows.slice(), source }));
        host.render();
        return host;
    };
    const surface = () => container.querySelector(".lch-lasso-surface") as Element;
    const outline = () => container.querySelector(".lch-lasso-outline") as Element;
    const mark = (i: number) => container.querySelector(`.d3-mark[data-row-idx="${i}"]`) as Element;
    const drag = (path: Array<[number, number]>, tail: Element = surface()) => {
        surface().dispatchEvent(ptr("pointerdown", path[0][0], path[0][1]));
        for (const [x, y] of path.slice(1)) surface().dispatchEvent(ptr("pointermove", x, y));
        const end = path[path.length - 1];
        surface().dispatchEvent(ptr("pointerup", end[0], end[1]));
        tail.dispatchEvent(ptr("click", end[0], end[1]));
    };
    const esc = () => surface().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    const selectedMarks = () => Array.from(container.querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-row-idx"));

    describe("which charts get one", () => {
        it("a chart whose host sent no lasso option is untouched: no surface, nothing added to the page", () => {
            make(null);
            expect(surface()).toBeNull();
            expect(container.querySelector(".lch-lasso-outline, .lch-lasso-count, .lch-lasso-note")).toBeNull();
        });

        it("not capable, or switched off by the reader: none", () => {
            make({ lasso: { capable: false } });
            expect(surface()).toBeNull();
            host.setOptions({ lasso: { capable: true, enabled: false } });
            expect(surface()).toBeNull();
        });

        it("capable and on: one surface, after the render", () => {
            make();
            expect(container.querySelectorAll(".lch-lasso-surface").length).toBe(1);
        });

        it("the setting is live: off removes it, on brings it back, and it is never doubled", () => {
            make();
            host.setOptions({ lasso: { capable: true, enabled: false } });
            expect(surface()).toBeNull();
            host.setOptions({ lasso: { capable: true, enabled: true } });
            expect(container.querySelectorAll(".lch-lasso-surface").length).toBe(1);
            host.render();
            expect(container.querySelectorAll(".lch-lasso-surface").length).toBe(1);
        });

        it("over the cap the whole lasso is off and the caption says so", () => {
            make({ lasso: { capable: true, rowCap: 5 } });                  // six rows in view
            expect(surface()).toBeNull();
            expect(container.querySelector(".lch-lasso-note")!.textContent).toMatch(/off/i);
            host.setOptions({ lasso: { capable: true, rowCap: 6 } });
            expect(surface()).toBeTruthy();
            expect(container.querySelector(".lch-lasso-note")).toBeNull();
        });

        it("the default cap is the provisional 5,000", () => {
            expect(LASSO_ROW_CAP).toBe(5000);
            const rows = Array.from({ length: 5001 }, (_, i) => ["r", i]);
            make({ lasso: { capable: true } }, { columns: DATA.columns, rows });
            expect(surface()).toBeNull();
            expect(container.querySelector(".lch-lasso-note")!.textContent).toContain("5,001");
        });

        it("destroy removes it and its listeners", () => {
            make();
            host.destroy();
            expect(container.querySelector(".lch-lasso-surface")).toBeNull();
            container.dispatchEvent(ptr("pointerdown", 80, 80));
            document.dispatchEvent(ptr("pointermove", 230, 130));
            document.dispatchEvent(ptr("pointerup", 230, 130));
            expect(seen).toEqual([]);
        });
    });

    describe("the host's one selection", () => {
        it("a lasso selects through the host: subscribers hear it as the reader's, and the marks dim", () => {
            make();
            drag(AROUND_012);
            expect(seen).toEqual([{ rows: [0, 1, 2], source: "user" }]);
            expect(host.selection.current).toEqual([0, 1, 2]);
            expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
            expect(selectedMarks()).toEqual(["0", "1", "2"]);
            expect(events.map(e => e.source)).toEqual(["user"]);
        });

        it("a drag released over a mark selects the lasso's marks, not that mark", () => {
            make();
            drag(AROUND_012, mark(4));                                        // the click lands on row 4's mark
            expect(seen).toEqual([{ rows: [0, 1, 2], source: "user" }]);
        });

        it("a drag released on a mark, with no lasso able to run, is still not a click on it", () => {
            make({ lasso: { capable: false } });
            container.dispatchEvent(ptr("pointerdown", 80, 80));
            mark(4).dispatchEvent(ptr("click", 140, 80));
            expect(seen).toEqual([]);
        });

        it("a plain click on a mark still selects that mark, and the lasso stays drawn", () => {
            make();
            drag(AROUND_012);
            mark(4).dispatchEvent(ptr("pointerdown", 150, 200));
            mark(4).dispatchEvent(ptr("click", 150, 200));
            expect(seen.at(-1)).toEqual({ rows: [4], source: "user" });
            expect(outline().getAttribute("d")).toMatch(/^M/);
        });

        it("an empty click on the plot clears the lasso and the selection, calling the chart's clear slot first", () => {
            make();
            drag(AROUND_012);
            surface().dispatchEvent(ptr("pointerdown", 260, 220));
            surface().dispatchEvent(ptr("pointerup", 260, 220));
            surface().dispatchEvent(ptr("click", 260, 220));
            expect((window as any).__cleared).toBe(1);
            expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
            expect(outline().getAttribute("d")).toBe("");
            expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
            expect(events.at(-1)).toMatchObject({ rows: [], source: "user" });
        });

        it("Escape does the same", () => {
            make();
            drag(AROUND_012);
            esc();
            expect((window as any).__cleared).toBe(1);
            expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
            expect(outline().getAttribute("d")).toBe("");
        });

        it("an empty click on the plot still clears a selection a mark click made", () => {
            make();
            mark(1).dispatchEvent(ptr("click", 150, 100));
            expect(seen.at(-1)).toEqual({ rows: [1], source: "user" });
            surface().dispatchEvent(ptr("pointerdown", 260, 220));
            surface().dispatchEvent(ptr("pointerup", 260, 220));
            surface().dispatchEvent(ptr("click", 260, 220));
            expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
            expect((window as any).__cleared).toBe(0);                        // not the chart's selection, not its slot to call
        });

        it("selection.clear() erases the outline too, and tells the chart it was the host", () => {
            make();
            drag(AROUND_012);
            host.selection.clear();
            expect(outline().getAttribute("d")).toBe("");
            expect(events.at(-1)).toMatchObject({ rows: [], source: "host" });
            expect(seen.at(-1)).toEqual({ rows: [], source: "host" });
        });

        it("a selection handed in from elsewhere replaces the lasso; the same rows repainted keep it", () => {
            make();
            drag(AROUND_012);
            host.selection.highlight([2, 0, 1]);                              // the same rows, repainted
            expect(outline().getAttribute("d")).toMatch(/^M/);
            host.selection.highlight([3, 4]);
            expect(outline().getAttribute("d")).toBe("");
            expect(events.at(-1)).toMatchObject({ rows: [], source: "host" });
        });
    });

    // WHAT A LASSO DOES TO THE PAGE (contract 1.17.0). By default circling a group FILTERS: the marks inside are published
    // as the selection a click makes, so a page filter bound through `selects` takes every circled key and the other
    // charts follow. lasso.effect "highlight" lights them inside the chart and publishes nothing. And a filtering lasso on
    // a chart the page gave no filter still highlights, and the host says so once: the silent case is the one a first
    // build of a page got wrong.
    describe("what a lasso does to the page", () => {
        let root: Root | null = null;
        let warn: ReturnType<typeof vi.spyOn>;
        beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
        afterEach(async () => { if (root) { const r = root; root = null; await act(async () => r.unmount()); } });

        const COLS = [{ name: "Code", dataType: "String", isMeasure: false }, { name: "N", dataType: "Double", isMeasure: true }];
        const ROWS = [0, 1, 2, 3, 4, 5].map(i => ({ Code: "r" + i, N: i }));
        const noFilterWarnings = () => warn.mock.calls.map(c => String(c[0])).filter(s => /no filter to set/.test(s));
        /** The generated component's shape: a one-member group around a BicChart with no id, onSelect always passed. */
        const mount = async (lasso: Record<string, unknown>, selects?: ReturnType<typeof createFilter>, onSelect?: (rows: number[]) => void) => {
            root = createRoot(container);
            await act(async () => {
                root!.render(createElement(BicChartGroup, { columns: COLS, rows: ROWS as any, children:
                    createElement(BicChart, { code: CHART, d3: {}, labelContrast: false, options: { lasso }, selects,
                                              onSelect: (idxs: number[]) => onSelect?.(idxs) }) }));
            });
        };
        const dragAct = async (path: Array<[number, number]>) => { await act(async () => { drag(path); }); };

        it("the effect is filter unless it is exactly highlight", () => {
            expect(lassoEffect(undefined)).toBe("filter");
            expect(lassoEffect({ capable: true })).toBe("filter");
            expect(lassoEffect({ capable: true, effect: "filter" })).toBe("filter");
            expect(lassoEffect({ capable: true, effect: "highlight" })).toBe("highlight");
            expect(lassoEffect({ capable: true, effect: "Highlight" as any })).toBe("filter");
            expect(lassoEffect({ capable: true, effect: 1 as any })).toBe("filter");
        });

        it("by default a lasso on a chart with selects sets the page filter with every circled key", async () => {
            const f = createFilter("Code");
            await mount({ capable: true, enabled: true }, f);
            await dragAct(AROUND_012);
            expect(f.values).toEqual(["r0", "r1", "r2"]);
            expect(selectedMarks()).toEqual(["0", "1", "2"]);
            expect(noFilterWarnings()).toEqual([]);
            // And an empty click on the plot clears the filter it set.
            await act(async () => {
                surface().dispatchEvent(ptr("pointerdown", 260, 220));
                surface().dispatchEvent(ptr("pointerup", 260, 220));
                surface().dispatchEvent(ptr("click", 260, 220));
            });
            expect(f.active).toBe(false);
        });

        it("effect filter, stated, does the same", async () => {
            const f = createFilter("Code");
            await mount({ capable: true, enabled: true, effect: "filter" }, f);
            await dragAct(AROUND_012);
            expect(f.values).toEqual(["r0", "r1", "r2"]);
        });

        it("effect highlight lights the circled marks inside the chart and sets no filter", async () => {
            const f = createFilter("Code");
            const heard: number[][] = [];
            await mount({ capable: true, enabled: true, effect: "highlight" }, f, rows => heard.push(rows));
            await dragAct(AROUND_012);
            expect(f.active).toBe(false);
            expect(heard).toEqual([]);
            expect(selectedMarks()).toEqual(["0", "1", "2"]);
            expect(container.querySelector("." + SELECTION_ACTIVE_CLASS)).toBeTruthy();   // the chart's own element dims the rest
            expect(noFilterWarnings()).toEqual([]);
            // Clearing it publishes nothing either: the page never heard the highlight.
            await act(async () => { esc(); });
            expect(selectedMarks()).toEqual([]);
            expect(heard).toEqual([]);
        });

        it("a chart given no selects still highlights, and says once that the page gave it no filter to set", async () => {
            const heard: number[][] = [];
            await mount({ capable: true, enabled: true }, undefined, rows => heard.push(rows));
            await dragAct(AROUND_012);
            expect(selectedMarks()).toEqual(["0", "1", "2"]);
            expect(noFilterWarnings().length).toBe(1);
            expect(noFilterWarnings()[0]).toMatch(/^\[@bicharts\/chart-host\] a lasso circled 3 rows?/);
            expect(noFilterWarnings()[0]).toMatch(/selects/);
            await act(async () => { esc(); });
            await dragAct(AROUND_012);
            expect(noFilterWarnings().length).toBe(1);                          // once per chart, not once per lasso
        });

        it("a highlight-only lasso on a chart with no selects says nothing: it is the page's choice", async () => {
            await mount({ capable: true, enabled: true, effect: "highlight" });
            await dragAct(AROUND_012);
            expect(selectedMarks()).toEqual(["0", "1", "2"]);
            expect(noFilterWarnings()).toEqual([]);
        });

        it("a plain host: subscribers hear nothing from a highlight-only lasso, and the marks still light", () => {
            make({ lasso: { capable: true, effect: "highlight" } });
            drag(AROUND_012);
            expect(seen).toEqual([]);
            expect(host.selection.current).toEqual([0, 1, 2]);
            expect(selectedMarks()).toEqual(["0", "1", "2"]);
            esc();
            expect(seen).toEqual([]);
            expect(host.selection.current).toEqual([]);
            expect(selectedMarks()).toEqual([]);
        });

        it("a plain host whose selection nobody hears says so once; one with a subscriber does not", () => {
            host = createChartHost(container, { data: DATA, code: CHART, d3: {}, options: { lasso: { capable: true } } } as any);
            host.render();
            drag(AROUND_012);
            expect(selectedMarks()).toEqual(["0", "1", "2"]);
            expect(noFilterWarnings().length).toBe(1);
            host.destroy();
            warn.mockClear();
            make({ lasso: { capable: true } });
            drag(AROUND_012);
            expect(noFilterWarnings()).toEqual([]);
        });
    });

    describe("a re-render", () => {
        it("re-applies the lasso, tells the chart it was restored, and does NOT publish it", () => {
            make();
            drag(AROUND_012);
            seen.length = 0; events.length = 0;
            host.render();
            expect(events.length).toBe(1);
            expect(events[0]).toMatchObject({ rows: [0, 1, 2], source: "restore" });
            expect(outline().getAttribute("d")).toMatch(/^M/);
            expect(seen).toEqual([]);                                         // restore never publishes
        });

        it("survives a host destroyed and made again on the same element", () => {
            make();
            drag(AROUND_012);
            host.destroy();
            events.length = 0; seen.length = 0;
            make();
            expect(events[0]).toMatchObject({ rows: [0, 1, 2], source: "restore" });
            expect(seen).toEqual([]);
        });

        // The bag on the element outlives every host on it: a DIFFERENT chart built there must not draw the old outline
        // over its own marks, nor carry it into the state its next slider persists.
        it("a different chart made on the same element starts without the previous chart's lasso", () => {
            make();
            drag(AROUND_012);
            host.destroy();
            events.length = 0; seen.length = 0;
            host = createChartHost(container, { data: DATA, code: CHART + "\n// another chart", d3: {}, options: { lasso: { capable: true } } } as any);
            host.render();
            expect(events).toEqual([]);
            expect(outline().getAttribute("d")).toBe("");
            expect((container as any).__lchKnobs.lasso).toBeUndefined();
        });

        it("a slider value in the bag outlives a different chart; only the lasso goes", () => {
            make();
            drag(AROUND_012);
            (container as any).__lchKnobs.rate = 0.05;
            host.destroy();
            host = createChartHost(container, { data: DATA, code: CHART + "\n// another chart", d3: {}, options: { lasso: { capable: true } } } as any);
            host.render();
            expect((container as any).__lchKnobs).toEqual({ rate: 0.05 });
        });

        // A page's own view-state provider keys its own state (the visual keys it by chart version): the host leaves it be.
        it("a lasso in the page's own view-state provider is the page's to keep, whichever chart is built", () => {
            make();
            drag(AROUND_012);
            const parked = (container as any).__lchKnobs.lasso;
            host.destroy();
            const saved: Record<string, unknown> = { knobs: { lasso: parked } };
            host = createChartHost(container, { data: DATA, code: CHART + "\n// another chart", d3: {}, options: { lasso: { capable: true } },
                                                viewState: { load: () => saved, save: () => undefined } } as any);
            host.render();
            expect((saved.knobs as any).lasso).toBe(parked);
        });

        it("a parked lasso with no record of whose it is counts as another chart's", () => {
            make();
            drag(AROUND_012);
            const parked = (container as any).__lchKnobs.lasso;
            host.destroy();
            const fresh = document.createElement("div");
            document.body.appendChild(fresh);
            (fresh as any).__lchKnobs = { lasso: parked };
            const other = createChartHost(fresh, { data: DATA, code: CHART, d3: {}, options: { lasso: { capable: true } } } as any);
            other.render();
            expect((fresh as any).__lchKnobs.lasso).toBeUndefined();
            other.destroy();
            fresh.remove();
        });

        it("a <BicChart> given new code on the same element does not inherit the old chart's outline", async () => {
            make();
            drag(AROUND_012);
            const parked = (container as any).__lchKnobs.lasso;
            host.destroy();
            const el = document.createElement("div");
            document.body.appendChild(el);
            const root: Root = createRoot(el);
            const opts = { lasso: { capable: true } };
            await act(async () => { root.render(createElement(BicChart, { code: CHART, data: DATA, d3: {}, options: opts })); });
            const chartEl = el.firstElementChild as HTMLElement;
            (chartEl as any).__lchKnobs = { ...(chartEl as any).__lchKnobs, lasso: parked };       // parked by the chart on screen
            const restores: unknown[] = [];
            chartEl.addEventListener(LASSO_EVENT, e => restores.push((e as CustomEvent).detail));
            await act(async () => { root.render(createElement(BicChart, { code: CHART + "\n// v2", data: DATA, d3: {}, options: opts })); });
            expect(restores).toEqual([]);
            expect((chartEl as any).__lchKnobs?.lasso).toBeUndefined();
            await act(async () => root.unmount());
            el.remove();
        });

        it("a lasso cleared is gone after a re-render", () => {
            make();
            drag(AROUND_012);
            esc();
            events.length = 0;
            host.render();
            expect(events).toEqual([]);
            expect(outline().getAttribute("d")).toBe("");
        });

        it("a persisted lasso that the setting hides comes back when the setting does", () => {
            make();
            drag(AROUND_012);
            host.setOptions({ lasso: { capable: true, enabled: false } });
            expect(surface()).toBeNull();
            events.length = 0;
            host.setOptions({ lasso: { capable: true, enabled: true } });
            expect(events[0]).toMatchObject({ rows: [0, 1, 2], source: "restore" });
        });

        it("goes through the caller's own persistence when it has one", () => {
            const writes: any[] = [];
            make({ lasso: { capable: true }, uiState: {}, setUiState: (s: any) => writes.push(JSON.parse(JSON.stringify(s))) });
            drag(AROUND_012);
            expect(writes.length).toBe(1);
            expect(writes[0].knobs.lasso.shapes.length).toBe(1);
        });

        it("a chart that throws while drawing leaves no lasso listening", () => {
            const live = new Set<unknown>();
            const add = container.addEventListener.bind(container), rem = container.removeEventListener.bind(container);
            container.addEventListener = ((t: string, f: any, o?: any) => { if (t === "keydown") live.add(f); add(t, f, o); }) as any;
            container.removeEventListener = ((t: string, f: any, o?: any) => { if (t === "keydown") live.delete(f); rem(t, f, o); }) as any;
            host = createChartHost(container, {
                data: DATA, d3: {}, options: { lasso: { capable: true } },
                renderFn: (c: HTMLElement) => { if ((c as any).__boom) throw new Error("boom"); c.innerHTML = CHART_FALLBACK; },
            } as any);
            host.render();
            expect(live.size).toBe(1);
            (container as any).__boom = true;
            expect(() => host.render()).toThrow("boom");
            expect(live.size).toBe(0);
        });
    });
});

const CHART_FALLBACK = `<svg viewBox="0 0 400 300"><g class="lch-plot" data-bbox="0,0,300,200"></g></svg>`;
