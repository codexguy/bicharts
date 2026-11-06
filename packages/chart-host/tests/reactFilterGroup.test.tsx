// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, BicChartGroup, BicFilterChips, BicPage, useBicFilter, filterScopeOf, type Filter } from "../src/react";
import { MARK_SELECTED_CLASS } from "../src/contract";

// SEVERAL PANELS PICKING ON ONE KEY ARE ONE PICK (FilterOptions.group). The page this pins: a map, a table and a scatter
// each set a country pick, each with its own filter on the country's name, and every panel's query takes every pick but
// its own. Without the group the three picks were ANDed: a country picked on the map and then in the table was held by
// two filters, so clicking it again on the map cleared only one and the page stayed filtered; and a side list beside
// them read the UNION of the filters' keys while the page showed their intersection.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PROBE = `
function render(container, data) {
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const at = data.columns.findIndex(c => c.name === "Country");
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    m.setAttribute("data-code", String(data.rows[r][at]));
    container.appendChild(m);
  }
}`;
const COLUMNS = [
    { name: "Country", dataType: "String", isMeasure: false },
    { name: "Revenue", dataType: "Double", isMeasure: true },
];
const ALL = ["France", "Germany", "Italy", "Spain"].map((c, i) => ({ Country: c, Revenue: i + 1 }));

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

const chart = (cls: string) => el.querySelector(`.${cls}`) as HTMLElement;
const mark = (cls: string, code: string) => chart(cls).querySelector(`.d3-mark[data-code="${code}"]`) as HTMLElement;
const drawn = (cls: string) => Array.from(chart(cls).querySelectorAll(".d3-mark")).map(m => m.getAttribute("data-code"));
const selected = (cls: string) =>
    Array.from(chart(cls).querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-code"));
const chips = () => Array.from(el.querySelectorAll(".bic-filter-chip")).map(c => c.textContent);
const sideList = () => (el.querySelector(".side-list") as HTMLElement).textContent;
const click = async (t: Element, ctrlKey = false) => {
    await act(async () => { t.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey })); });
};

const D3 = {};

/** A generated chart component: its own one-member group around a BicChart. */
function Panel(p: { cls: string; rows: Record<string, unknown>[]; selects: Filter; scopedBy: Filter[] }) {
    return createElement(BicChartGroup, { columns: COLUMNS, rows: p.rows as any, children:
        createElement(BicChart, { code: PROBE, d3: D3, className: p.cls, labelContrast: false,
                                  selects: p.selects, scopedBy: p.scopedBy }) });
}

let picks: Filter[] = [];

/** A quarterly review page: three panels pick a country; each panel's rows take every pick but its own. */
function Review(p: { group?: string }) {
    const opts = (label: string) => ({ label, display: "Country", ...(p.group ? { group: p.group } : {}) });
    const fromMap = useBicFilter("Country", opts("Country (map)"));
    const fromTable = useBicFilter("Country", opts("Country (table)"));
    const fromScatter = useBicFilter("Country", opts("Countries (scatter)"));
    picks = [fromMap, fromTable, fromScatter];
    // A query that ANDs the other panels' picks (filterQuery + treatAs), here on the page's own rows.
    const narrowed = (by: Filter[]) => by.reduce((rows, f) => f.keep(rows), ALL);
    // A side list as a page would draw it: every key the page's picks hold.
    const listed = [...new Set(picks.flatMap(f => f.keys.map(k => String(k[0]))))];
    return createElement(Fragment, { children: [
        createElement(BicFilterChips, { key: "chips" }),
        createElement("span", { key: "side", className: "side-list" }, listed.join(", ")),
        createElement(Panel, { key: "map", cls: "map", rows: narrowed([fromTable, fromScatter]), selects: fromMap, scopedBy: [fromTable, fromScatter] }),
        createElement(Panel, { key: "table", cls: "table", rows: narrowed([fromMap, fromScatter]), selects: fromTable, scopedBy: [fromMap, fromScatter] }),
        createElement(Panel, { key: "scatter", cls: "scatter", rows: narrowed([fromMap, fromTable]), selects: fromScatter, scopedBy: [fromMap, fromTable] }),
    ] });
}
const draw = async (group?: string) => {
    await act(async () => { root.render(createElement(BicPage, { children: createElement(Review, { group }) })); });
};

describe("useBicFilter(column, { group }): several panels picking one key are one pick", () => {
    it("map pick, table pick, map click again: the page clears (three separate filters left it filtered)", async () => {
        await draw("country");
        // Pick Germany and France on the map: the map keeps every tile, the table follows.
        await click(mark("map", "Germany"));
        await click(mark("map", "France"), true);
        expect(drawn("map")).toEqual(["France", "Germany", "Italy", "Spain"]);
        expect(drawn("table")).toEqual(["France", "Germany"]);
        // Pick Germany in the table: the most recent pick is the page's one pick.
        await click(mark("table", "Germany"));
        expect(chips()).toEqual(["Country (table): Germany×"]);
        expect(drawn("map")).toEqual(["Germany"]);
        expect(drawn("table")).toEqual(["France", "Germany", "Italy", "Spain"]);
        // The map shows the pick, so clicking Germany there again clears it: the whole page.
        expect(selected("map")).toEqual(["Germany"]);
        await click(mark("map", "Germany"));
        expect(chips()).toEqual([]);
        expect(picks.some(f => f.active)).toBe(false);
        for (const panel of ["map", "table", "scatter"]) expect(drawn(panel)).toEqual(["France", "Germany", "Italy", "Spain"]);
    });

    it("Germany on the map, then its one table row - which shows the pick, so that click clears", async () => {
        await draw("country");
        await click(mark("map", "Germany"));
        expect(drawn("table")).toEqual(["Germany"]);
        expect(selected("table")).toEqual(["Germany"]);
        await click(mark("table", "Germany"));
        expect(chips()).toEqual([]);
        expect(drawn("map")).toEqual(["France", "Germany", "Italy", "Spain"]);
        expect(drawn("scatter")).toEqual(["France", "Germany", "Italy", "Spain"]);
    });

    it("a side list follows the page's one pick, never the union of the filters (the union named three countries)", async () => {
        await draw("country");
        await click(mark("scatter", "France"));
        await click(mark("scatter", "Germany"), true);
        await click(mark("scatter", "Italy"), true);
        expect(drawn("map")).toEqual(["France", "Germany", "Italy"]);
        await click(mark("map", "Germany"));
        expect(sideList()).toBe("Germany");
        expect(chips()).toEqual(["Country (map): Germany×"]);
        expect(filterScopeOf(picks)).toEqual({ field: "Country (map)", values: ["Germany"] });
        // The source panel is not narrowed by its own pick; the others are.
        expect(drawn("map")).toEqual(["France", "Germany", "Italy", "Spain"]);
        expect(drawn("scatter")).toEqual(["Germany"]);
        expect(selected("scatter")).toEqual(["Germany"]);
    });

    it("the one chip's x clears the pick and every panel's marks", async () => {
        await draw("country");
        await click(mark("table", "Spain"));
        expect(selected("map")).toEqual(["Spain"]);
        await act(async () => { (el.querySelector(".bic-filter-chip-clear") as HTMLElement).click(); });
        expect(chips()).toEqual([]);
        for (const panel of ["map", "table", "scatter"]) expect(selected(panel)).toEqual([]);
    });

    it("without the group the filters stay independent, as before", async () => {
        await draw();
        await click(mark("map", "Germany"));
        await click(mark("table", "Germany"));
        expect(chips()).toEqual(["Country (map): Germany×", "Country (table): Germany×"]);
    });
});
