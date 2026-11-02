// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, useBicFilter } from "../src/react";
import { MARKS_INERT_CLASS } from "../src/contract";

// ONLY A MARK THAT SELECTS SOMETHING LOOKS CLICKABLE, through React. The binding knows what a click
// reaches: the page filter (`selects`), a group sibling (an id in a group) or the page's own onSelect. With none of
// them the marks are drawn inert.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PROBE = `
function render(container, data) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    container.appendChild(m);
  }
}`;
const DATA = { columns: [{ name: "Region" }], rows: [["Americas"], ["EMEA"]] };
const D3 = {};

let el: HTMLDivElement;
let root: Root;
beforeEach(() => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });
const host = () => el.querySelector(".bic-chart-host") as HTMLElement;

describe("BicChart says whether its marks select anything", () => {
    it("no selects, no group id and no onSelect: inert", async () => {
        await act(async () => root.render(createElement(BicChart, { code: PROBE, d3: D3, data: DATA as any, labelContrast: false })));
        expect(host().classList.contains(MARKS_INERT_CLASS)).toBe(true);
    });

    it("an onSelect the page passed: selecting", async () => {
        await act(async () => root.render(createElement(BicChart, { code: PROBE, d3: D3, data: DATA as any, labelContrast: false,
                                                                     onSelect: () => {} })));
        expect(host().classList.contains(MARKS_INERT_CLASS)).toBe(false);
    });

    it("a page filter in selects: selecting", async () => {
        function Page() {
            const f = useBicFilter("Region");
            return createElement(BicChart, { code: PROBE, d3: D3, data: DATA as any, labelContrast: false, selects: f });
        }
        await act(async () => root.render(createElement(Page)));
        expect(host().classList.contains(MARKS_INERT_CLASS)).toBe(false);
    });
});
