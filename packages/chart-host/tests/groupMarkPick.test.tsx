// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createChartHost } from "../src/host";
import { bindFilter, createFilter, filterScopeOf, isAnyValue } from "../src/filterScope";
import { treatAs } from "../src/dax";
import { BicChart, BicChartGroup, BicFilterChips, useBicFilter, type Filter } from "../src/react";
import { MARK_SELECTED_CLASS } from "../src/contract";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// A GROUP MARK PICKS WHAT ITS ROWS SHARE. A table of region by stage draws each region as ONE row mark carrying all of that
// region's stage rows, while the page's filter is keyed by (Region, Stage). A click on the APAC row became the (APAC, stage)
// pairs drawn at that moment, and was never widened: pick an owner whose APAC deals sit in two stages, click APAC, clear the
// owner, and "APAC" stayed narrowed to those two stages, a second click on APAC re-set it instead of clearing it, and the chip
// listed the pairs. One mark clicked on its own now picks the key columns its rows agree on, the others left free - the key
// a label pick on the same field makes. A lasso or a Ctrl-click over several marks still names every pair.

// A pipeline table's shape: stage headers are axis filters, each region row is one mark over its stage rows.
const CHART = `// bic:keyboard-marks
function render(container, data, options) {
  container.replaceChildren();
  const doc = container.ownerDocument;
  const byRegion = {}, byStage = {};
  data.rows.forEach((r, i) => {
    (byRegion[r[0]] = byRegion[r[0]] || []).push(i);
    (byStage[r[1]] = byStage[r[1]] || []).push(i);
  });
  for (const stage of Object.keys(byStage).sort()) {
    const h = doc.createElement("div");
    h.className = "d3-axis-filter";
    h.setAttribute("data-row-idx", byStage[stage].join(","));
    h.setAttribute("data-stage", stage);
    h.textContent = stage;
    container.appendChild(h);
  }
  for (const region of Object.keys(byRegion)) {
    const row = doc.createElement("div");
    row.className = "d3-mark";
    row.setAttribute("data-row-idx", byRegion[region].join(","));
    row.setAttribute("data-region", region);
    row.textContent = region;
    container.appendChild(row);
  }
}`;
const COLS = [{ name: "Region" }, { name: "Stage" }, { name: "Open" }];
const STAGES = ["1-Qualify", "2-Develop", "3-Propose", "4-Close"];
const ALL = ["APAC", "EMEA"].flatMap((g, a) => STAGES.map((s, k) => [g, s, 10 * a + k + 1]));
// Owner X's deals: APAC in 1-Qualify and 4-Close only, EMEA in every stage.
const OWNER_X = ALL.filter(r => r[0] !== "APAC" || r[1] === "1-Qualify" || r[1] === "4-Close");

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount(rows = ALL, columns = ["Region", "Stage"]) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    let data = { columns: COLS, rows };
    const host = createChartHost(el, { code: CHART, d3: {}, data: data as any } as any);
    host.render();
    const filter = createFilter(columns, { label: "Region and stage" });
    const binding = bindFilter(host, filter, {
        rowCount: () => data.rows.length,
        rowAt: i => data.rows[i] ? Object.fromEntries(COLS.map((c, k) => [c.name, data.rows[i][k]])) : null,
    });
    // The owner filter narrows this chart's QUERY, so a pick or clear of it arrives here as new rows.
    const setData = (next: unknown[][]) => { data = { columns: COLS, rows: next }; host.setData(data as any); binding.reconcile(); };
    return { el, host, filter, binding, setData };
}
const click = (t: Element, mods: MouseEventInit = {}) => t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }));
const row = (el: HTMLElement, region: string) => el.querySelector(`.d3-mark[data-region="${region}"]`)!;
const lit = (el: HTMLElement) => Array.from(el.querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-region"));

describe("one group mark picks the key columns its rows share", () => {
    it("the APAC row sets (APAC, any stage), named APAC, and its query filters the region alone", () => {
        const { el, filter } = mount();
        click(row(el, "APAC"));
        expect(filter.keys).toHaveLength(1);
        expect(filter.keys[0][0]).toBe("APAC");
        expect(isAnyValue(filter.keys[0][1])).toBe(true);
        expect(filter.text).toBe("APAC");
        expect(treatAs(filter, "Accounts[Region]", "Opportunities[PipelineStep]")).toBe(`TREATAS({"APAC"}, Accounts[Region])`);
        expect(lit(el)).toEqual(["APAC"]);
    });

    it("pick an owner, click APAC, clear the owner: APAC is every stage, lit, and APAC again clears it", () => {
        const { el, filter, setData } = mount(OWNER_X);
        click(row(el, "APAC"));
        setData(ALL);                                                                 // the owner is cleared
        for (const s of STAGES) expect(filter.has({ Region: "APAC", Stage: s })).toBe(true);
        expect(filter.has({ Region: "EMEA", Stage: "2-Develop" })).toBe(false);
        expect(treatAs(filter, "Accounts[Region]", "Opportunities[PipelineStep]")).toBe(`TREATAS({"APAC"}, Accounts[Region])`);
        expect(filter.text).toBe("APAC");
        expect(lit(el)).toEqual(["APAC"]);
        click(row(el, "APAC"));
        expect(filter.active).toBe(false);
        expect(lit(el)).toEqual([]);
    });

    it("the same row again clears it", () => {
        const { el, filter } = mount();
        click(row(el, "APAC"));
        click(row(el, "APAC"));
        expect(filter.active).toBe(false);
    });

    it("Enter on the row picks the same as a click", () => {
        const { el, filter } = mount();
        row(el, "EMEA").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        expect(filter.keys).toHaveLength(1);
        expect(filter.keys[0][0]).toBe("EMEA");
        expect(isAnyValue(filter.keys[0][1])).toBe(true);
    });

    it("the scope fact says the region, and a query that takes only the stage is not narrowed by it", () => {
        const { el, filter } = mount();
        click(row(el, "APAC"));
        expect(filterScopeOf(filter)).toEqual({ field: "Region and stage", values: ["APAC"] });
        expect(filterScopeOf({ filter, takes: ["Region"] })).toEqual({ field: "Region and stage", values: ["APAC"] });
        expect(filterScopeOf({ filter, takes: ["Stage"] })).toBeUndefined();
    });

    it("a mark whose rows agree on every key column picks that key, as before", () => {
        const { el, filter } = mount(ALL, ["Region"]);
        click(row(el, "APAC"));
        expect(filter.keys).toEqual([["APAC"]]);
    });

    it("Ctrl-click over several rows still names every pair", () => {
        const { el, filter } = mount();
        click(row(el, "APAC"), { ctrlKey: true });
        click(row(el, "EMEA"), { ctrlKey: true });
        expect(filter.keys).toHaveLength(8);
        expect(filter.keys.some(k => k.some(isAnyValue))).toBe(false);
        expect(filter.has({ Region: "APAC", Stage: "5-Won" })).toBe(false);
    });

    it("a stage header still picks the stage across regions", () => {
        const { el, filter } = mount();
        click(el.querySelector(`.d3-axis-filter[data-stage="2-Develop"]`)!);
        expect(filter.keys).toHaveLength(1);
        expect(isAnyValue(filter.keys[0][0])).toBe(true);
        expect(filter.keys[0][1]).toBe("2-Develop");
    });
});

describe("a lasso over several group marks still names every pair", () => {
    // jsdom lays nothing out, so the marks carry their client boxes in data-box (as lassoHost.test.ts does).
    const LASSO_CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("data-box", "10,20,400,300"); svg.setAttribute("viewBox", "0 0 400 300");
  const plot = doc.createElementNS(NS, "g");
  plot.setAttribute("class", "lch-plot"); plot.setAttribute("transform", "translate(40,30)"); plot.setAttribute("data-bbox", "0,0,300,200");
  svg.appendChild(plot);
  const byRegion = {};
  data.rows.forEach((r, i) => { (byRegion[r[0]] = byRegion[r[0]] || []).push(i); });
  Object.keys(byRegion).forEach((g, k) => {
    const c = doc.createElementNS(NS, "circle");
    c.setAttribute("class", "d3-mark"); c.setAttribute("data-row-idx", byRegion[g].join(","));
    c.setAttribute("data-box", (50 + 50 + 50 * k - 3) + "," + (50 + 50 - 3) + ",6,6");
    plot.appendChild(c);
  });
  container.appendChild(svg);
}`;
    const ptr = (type: string, x: number, y: number) => {
        const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: type === "click" ? 1 : 0 });
        Object.defineProperty(e, "pointerId", { value: 1 });
        Object.defineProperty(e, "isPrimary", { value: true });
        return e;
    };
    let container: HTMLElement;
    beforeEach(() => {
        const orig = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const mk = (l: number, t: number, w: number, h: number) =>
                ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;
            if (this.classList?.contains("lch-lasso-surface")) {
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
        container = document.createElement("div");
        document.body.appendChild(container);
    });
    afterEach(() => { container.remove(); vi.restoreAllMocks(); });

    it("circling the APAC and EMEA marks selects their eight pairs", () => {
        const data = { columns: COLS, rows: ALL };
        const host = createChartHost(container, { data, code: LASSO_CHART, d3: {}, options: { lasso: { capable: true } } } as any);
        host.render();
        const filter = createFilter(["Region", "Stage"]);
        bindFilter(host, filter, {
            rowCount: () => data.rows.length,
            rowAt: i => data.rows[i] ? Object.fromEntries(COLS.map((c, k) => [c.name, data.rows[i][k]])) : null,
        });
        const surface = container.querySelector(".lch-lasso-surface") as Element;
        const path: Array<[number, number]> = [[80, 80], [230, 80], [230, 130], [80, 130], [80, 80]];
        surface.dispatchEvent(ptr("pointerdown", path[0][0], path[0][1]));
        for (const [x, y] of path.slice(1)) surface.dispatchEvent(ptr("pointermove", x, y));
        surface.dispatchEvent(ptr("pointerup", 80, 80));
        surface.dispatchEvent(ptr("click", 80, 80));
        expect(filter.keys).toHaveLength(8);
        expect(filter.keys.some(k => k.some(isAnyValue))).toBe(false);
        host.destroy();
    });
});

describe("through React: the chip names the region", () => {
    let el: HTMLDivElement;
    let root: Root;
    beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
    afterEach(async () => { await act(async () => root.unmount()); el.remove(); });

    it("a click on the APAC row shows one chip value, APAC", async () => {
        let pick: Filter | null = null;
        const COLUMNS = [{ name: "Region", dataType: "String", isMeasure: false }, { name: "Stage", dataType: "String", isMeasure: false },
                         { name: "Open", dataType: "Double", isMeasure: true }];
        const ROWS = ALL.map(r => ({ Region: r[0], Stage: r[1], Open: r[2] }));
        function Page() {
            pick = useBicFilter(["Region", "Stage"], { label: "Region" });
            return createElement(Fragment, { children: [
                createElement(BicFilterChips, { key: "chips" }),
                createElement(BicChartGroup, { key: "chart", columns: COLUMNS, rows: ROWS as any, children:
                    createElement(BicChart, { code: CHART, d3: {}, labelContrast: false, selects: pick }) }),
            ] });
        }
        await act(async () => { root.render(createElement(Page)); });
        await act(async () => { click(el.querySelector(`.d3-mark[data-region="APAC"]`)!); });
        const chips = Array.from(el.querySelectorAll(".bic-filter-chip-value")).map(c => c.textContent);
        expect(chips).toEqual(["APAC"]);
        expect(pick!.keys).toHaveLength(1);
    });
});
