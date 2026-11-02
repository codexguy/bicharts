// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, createFilter, type Filter } from "../src/react";

// A CHART SAYS ITS ROWS WERE FILTERED. `scopedBy` names the page filters this chart's QUERY already applies (a KPI deck
// whose query takes the picked country): while one is active, the chart is told so as options.filterScope, and it is
// told again, with nothing, when the filter clears - an options patch merges, so a fact left out would stay.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PROBE = `
function render(container, data, options) {
  container.innerHTML = "";
  (container.__scopes = container.__scopes || []).push(options.filterScope);
  const m = container.ownerDocument.createElement("div");
  m.className = "d3-mark";
  m.setAttribute("data-row-idx", "0");
  container.appendChild(m);
}`;
const DATA = { columns: [{ name: "Region" }, { name: "Revenue" }], rows: [["North America", 1]] };
const D3 = {};

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

const chartEl = () => el.querySelector(".probe") as HTMLElement;
const lastScope = () => { const s = (chartEl() as any).__scopes as unknown[]; return s[s.length - 1]; };
const draw = async (props: Record<string, unknown>) => {
    await act(async () => root.render(createElement(BicChart, { code: PROBE, d3: D3, data: DATA as any, className: "probe", ...props })));
};

describe("BicChart scopedBy", () => {
    it("tells the chart while the filter is active, and clears it when the filter clears", async () => {
        const country: Filter = createFilter("CountryCode", { label: "Country", display: "Country" });
        await draw({ scopedBy: country, options: { width: 300, height: 200 } });
        expect(lastScope()).toBeUndefined();

        await act(async () => country.selectRows([{ CountryCode: "USA", Country: "United States" }], "click"));
        expect(lastScope()).toEqual({ field: "Country", values: ["United States"] });

        await act(async () => country.clear());
        expect(lastScope()).toBeUndefined();
    });

    it("takes several filters, and counts only the active ones", async () => {
        const country = createFilter("Country");
        const year = createFilter("Year");
        await draw({ scopedBy: [country, year] });
        await act(async () => year.set([2024]));
        expect(lastScope()).toEqual({ field: "Year", values: ["2024"] });
        await act(async () => country.set(["Japan"]));
        expect(lastScope()).toEqual({ field: "Country, Year", values: ["Japan", "2024"] });
    });

    it("a page that stops passing scopedBy clears what it said", async () => {
        const country = createFilter("Country");
        country.set(["Japan"]);
        await draw({ scopedBy: country, options: { width: 300 } });
        expect(lastScope()).toEqual({ field: "Country", values: ["Japan"] });
        await draw({ scopedBy: undefined, options: { width: 301 } });
        expect(lastScope()).toBeUndefined();
    });

    it("a page that says nothing keeps its own options.filterScope", async () => {
        await draw({ options: { filterScope: { field: "Country", values: ["Japan"], label: "Japan only" } } });
        expect(lastScope()).toEqual({ field: "Country", values: ["Japan"], label: "Japan only" });
    });
});
