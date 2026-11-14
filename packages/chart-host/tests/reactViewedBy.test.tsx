// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, createFilter } from "../src/react";

// A CHART THAT MODELS ON EVERY ROW IS TOLD WHICH ROWS THE PAGE KEEPS. `viewedBy` names the page filters the chart applies to its
// own rows (its query takes none of them): while one is active the chart gets options.viewRows (positions in its rows) and
// options.viewScope, and gets them again, emptied, when the pick clears - an options patch merges, so a fact left out would stay.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PROBE = `
function render(container, data, options) {
  container.innerHTML = "";
  (container.__views = container.__views || []).push({ rows: options.viewRows, scope: options.viewScope, n: data.rows.length });
  const m = container.ownerDocument.createElement("div");
  m.className = "d3-mark";
  m.setAttribute("data-row-idx", "0");
  container.appendChild(m);
}`;
const DATA = {
    columns: [{ name: "CustomerKey" }, { name: "Quarter" }],
    rows: [["1", "2023 Q2"], ["2", "2023 Q3"], ["3", "2023 Q2"]],
};
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

const last = () => { const s = (el.querySelector(".probe") as any).__views as any[]; return s[s.length - 1]; };
const draw = async (props: Record<string, unknown>) => {
    await act(async () => root.render(createElement(BicChart, { code: PROBE, d3: D3, data: DATA as any, className: "probe", ...props })));
};

describe("BicChart viewedBy", () => {
    it("hands the chart every row and the rows the pick keeps, then clears them", async () => {
        const quarter = createFilter("Quarter", { label: "Start quarter" });
        await draw({ viewedBy: quarter, options: { width: 300, height: 200 } });
        expect(last()).toEqual({ rows: undefined, scope: undefined, n: 3 });

        await act(async () => quarter.set(["2023 Q2"]));
        expect(last()).toEqual({ rows: [0, 2], scope: { field: "Start quarter", values: ["2023 Q2"] }, n: 3 });

        await act(async () => quarter.clear());
        expect(last()).toEqual({ rows: undefined, scope: undefined, n: 3 });
    });

    it("a chart without viewedBy is never handed a view", async () => {
        await draw({ options: { width: 300, height: 200 } });
        expect(last().rows).toBeUndefined();
    });
});
