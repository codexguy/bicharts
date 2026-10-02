// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, BicChartGroup, BicPage, BicFilterChips, useBicFilter, type Filter } from "../src/react";
import { MARK_SELECTED_CLASS } from "../src/contract";

// THE PAGE'S FILTERS THROUGH REACT, on the shape every generated chart component has: a
// one-member <BicChartGroup> around a <BicChart> with no id, over the page's own row objects.
// Reproduces what an agent-built Fabric App did wrong on a live page, and pins what the library
// now does instead.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PROBE = `
function render(container, data) {
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const at = data.columns.findIndex(c => c.name === "CountryCode");
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    m.setAttribute("data-code", String(data.rows[r][at]));
    container.appendChild(m);
  }
}`;
const COLUMNS = [
    { name: "CountryCode", dataType: "String", isMeasure: false },
    { name: "Country", dataType: "String", isMeasure: false },
    { name: "Revenue", dataType: "Double", isMeasure: true },
];
const NAMES: Record<string, string> = { AUS: "Australia", CHL: "Chile", IND: "India", USA: "United States" };
const rowsOf = (codes: string[]) => codes.map((c, i) => ({ CountryCode: c, Country: NAMES[c] ?? c, Revenue: i }));

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
const selected = (cls: string) =>
    Array.from(chart(cls).querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-code"));
const click = async (t: Element) => {
    await act(async () => { t.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};

const D3 = {};   // stable, as the generated component's assembled d3 is

/** The generated component's shape: its own one-member group, no id. */
function GeneratedChart(p: { cls: string; rows: Record<string, unknown>[]; selects?: Filter;
                             onSelectRows?: (rows: Record<string, unknown>[]) => void }) {
    return createElement(BicChartGroup, { columns: COLUMNS, rows: p.rows as any, children:
        createElement(BicChart, { code: PROBE, d3: D3, className: p.cls, labelContrast: false, selects: p.selects,
                                  onSelect: (idxs: number[]) => p.onSelectRows?.(idxs.map(k => p.rows[k])) }) });
}

describe("onSelect: new data that drops a selection is reported (no longer silent)", () => {
    it("a re-query that no longer draws the pick calls onSelect([]) so the page's state follows", async () => {
        const calls: string[][] = [];
        let setRows: (r: Record<string, unknown>[]) => void = () => {};
        function Page() {
            const [rows, set] = useState(rowsOf(["AUS", "CHL", "IND"]));
            setRows = set;
            return createElement(GeneratedChart, { cls: "map", rows,
                onSelectRows: r => calls.push(r.map(x => String(x.CountryCode))) });
        }
        await act(async () => { root.render(createElement(Page)); });
        await click(mark("map", "CHL"));
        expect(calls).toEqual([["CHL"]]);
        await act(async () => { setRows(rowsOf(["AUS", "USA"])); });
        expect(calls).toEqual([["CHL"], []]);
    });
});

describe("selects: the page filter owns the chart's selection", () => {
    let country: Filter | null = null;
    let setRows: (r: Record<string, unknown>[]) => void = () => {};
    function Page(p: { initial: string[]; showChart?: boolean }) {
        country = useBicFilter("CountryCode", { label: "Country", display: "Country" });
        const [rows, set] = useState(rowsOf(p.initial));
        setRows = set;
        const [show, setShow] = useState(true);
        (Page as any).setShow = setShow;
        return createElement(Fragment, { children: [
            createElement(BicFilterChips, { key: "chips" }),
            createElement("span", { key: "readout", className: "readout" }, country.active ? `Filtered to ${country.row?.Country ?? country.value}` : "All"),
            show ? createElement(GeneratedChart, { key: "map", cls: "map", rows, selects: country }) : null,
        ] });
    }
    const readout = () => (el.querySelector(".readout") as HTMLElement).textContent;

    it("click filters; the same click again un-filters (the live defect: it stayed filtered)", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await click(mark("map", "AUS"));
        expect(readout()).toBe("Filtered to Australia");
        await click(mark("map", "AUS"));
        expect(readout()).toBe("All");
        expect(selected("map")).toEqual([]);
    });

    it("a chip's × clears the filter and the chart's marks (the live defect: the marks stayed lit)", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await click(mark("map", "CHL"));
        expect(selected("map")).toEqual(["CHL"]);
        expect(el.querySelector(".bic-filter-chip")?.textContent).toContain("Country: Chile");
        await act(async () => { (el.querySelector(".bic-filter-chip-clear") as HTMLElement).click(); });
        expect(readout()).toBe("All");
        expect(selected("map")).toEqual([]);
        expect(el.querySelector(".bic-filter-chip")).toBeNull();
    });

    it("new rows that still carry the key keep the selection, repainted where it moved", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await click(mark("map", "IND"));
        await act(async () => { setRows(rowsOf(["IND", "USA"])); });
        expect(readout()).toBe("Filtered to India");
        expect(selected("map")).toEqual(["IND"]);
    });

    it("new rows without the key clear the filter, reason 'data' (the live defect: a stale pick on the page)", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await click(mark("map", "CHL"));
        await act(async () => { setRows(rowsOf(["AUS", "USA"])); });
        expect(readout()).toBe("All");
        expect(country!.reason).toBe("data");
    });

    it("a chart that remounts (a panel showing Loading...) shows the page's selection again", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await click(mark("map", "CHL"));
        await act(async () => { (Page as any).setShow(false); });
        expect(country!.value).toBe("CHL");
        await act(async () => { (Page as any).setShow(true); });
        expect(selected("map")).toEqual(["CHL"]);
    });

    it("a chart that remounts on new rows without its key drops the selection it made (a re-query behind Loading...)", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await click(mark("map", "CHL"));
        await act(async () => { (Page as any).setShow(false); });
        await act(async () => { setRows(rowsOf(["AUS", "USA"])); });
        await act(async () => { (Page as any).setShow(true); });
        expect(readout()).toBe("All");
        expect(country!.reason).toBe("data");
    });

    it("a selection the page set is kept when the chart doesn't draw it", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await act(async () => { country!.set("NZL"); });
        await act(async () => { setRows(rowsOf(["AUS", "USA"])); });
        expect(country!.value).toBe("NZL");
    });

    it("the page can set the filter and the chart paints it", async () => {
        await act(async () => { root.render(createElement(Page, { initial: ["AUS", "CHL", "IND"] })); });
        await act(async () => { country!.set("AUS"); });
        expect(selected("map")).toEqual(["AUS"]);
        expect(readout()).toBe("Filtered to AUS");     // set by value: no row seen yet for the name
    });
});

describe("two charts from different queries, one filter (the lanes follow the country map)", () => {
    it("filters the second chart's rows by key, without churning them, and clears both from one chip", async () => {
        const LANES = [
            { CountryCode: "IND", Country: "India", Dest: "AUS", Revenue: 1 },
            { CountryCode: "AUS", Country: "Australia", Dest: "CHL", Revenue: 2 },
            { CountryCode: "CHN", Country: "China", Dest: "USA", Revenue: 3 },
        ];
        let country: Filter | null = null;
        function Page() {
            country = useBicFilter("CountryCode", { label: "Country", display: "Country" });
            const lanes = country.keep(LANES, ["CountryCode", "Dest"]);
            return createElement(Fragment, { children: [
                createElement(BicFilterChips, { key: "chips" }),
                createElement(GeneratedChart, { key: "map", cls: "map", rows: rowsOf(["AUS", "CHL", "IND"]), selects: country }),
                createElement(GeneratedChart, { key: "lanes", cls: "lanes", rows: lanes }),
            ] });
        }
        await act(async () => { root.render(createElement(Page)); });
        expect(chart("lanes").querySelectorAll(".d3-mark")).toHaveLength(3);
        await click(mark("map", "AUS"));
        expect(Array.from(chart("lanes").querySelectorAll(".d3-mark")).map(m => m.getAttribute("data-code"))).toEqual(["IND", "AUS"]);
        await act(async () => { (el.querySelector(".bic-filter-chip-clear") as HTMLElement).click(); });
        expect(chart("lanes").querySelectorAll(".d3-mark")).toHaveLength(3);
        expect(selected("map")).toEqual([]);
    });
});

describe("<BicPage>: a separate scope, for a hook called inside it", () => {
    it("lists only its own filters", async () => {
        function Panel(p: { code: string }) {
            const f = useBicFilter("CountryCode", { label: "Country" });
            return createElement("button", { className: `set-${p.code}`, onClick: () => f.set(p.code) });
        }
        await act(async () => { root.render(createElement(Fragment, { children: [
            createElement(BicPage, { key: "a", children: [createElement(Panel, { key: "p", code: "AUS" }),
                                                          createElement("div", { key: "c", className: "chips-a" }, createElement(BicFilterChips))] }),
            createElement(BicPage, { key: "b", children: [createElement(Panel, { key: "p", code: "CHL" }),
                                                          createElement("div", { key: "c", className: "chips-b" }, createElement(BicFilterChips))] }),
        ] })); });
        await act(async () => { (el.querySelector(".set-AUS") as HTMLElement).click(); });
        expect(el.querySelector(".chips-a")?.textContent).toContain("Country: AUS");
        expect(el.querySelector(".chips-b")?.textContent).toBe("");
    });
});

describe("a chart can be named for a screen reader", () => {
    it("ariaLabel makes the chart a labelled figure", async () => {
        await act(async () => { root.render(createElement(BicChart, { code: PROBE, data: { columns: COLUMNS, rows: [["AUS", "Australia", 1]] } as any,
            d3: D3, className: "fig", labelContrast: false, ariaLabel: "Revenue by country" })); });
        const fig = chart("fig");
        expect(fig.getAttribute("role")).toBe("figure");
        expect(fig.getAttribute("aria-label")).toBe("Revenue by country");
    });
});
