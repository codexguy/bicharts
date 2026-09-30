// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, BicChartGroup } from "../src/react";

// NOTES ON MARKS, FROM REACT: `annotations` on <BicChart> is the whole wiring - a notes table keyed by the model's
// key, mapped to badges. Changing the list redraws the badges and never the chart; inside a group, a member whose
// payload was filtered still finds its key's mark in its OWN rows.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let draws = 0;
const D3 = {};   // one identity: a new d3 object is a new chart, rightly rebuilt
const CHART = `
function render(container, data, options) {
  window.__draws = (window.__draws || 0) + 1;
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    container.appendChild(m);
  }
}`;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; });

function mount(node: ReturnType<typeof createElement>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(node));
}

const badges = () => Array.from(host!.querySelectorAll(".bic-annotation"));

describe("<BicChart annotations>", () => {
    it("draws the badges, and a new list redraws only them", () => {
        const data = { columns: [{ name: "Code" }], rows: [["USA"], ["CAN"]] } as any;
        const chart = (anns: any[]) => createElement(BicChart, { code: CHART, d3: D3, data, annotations: anns });
        mount(chart([{ column: "Code", value: "CAN", label: "1" }]));
        expect(badges().map(b => b.textContent)).toEqual(["1"]);
        draws = (window as any).__draws;
        act(() => root!.render(chart([{ column: "Code", value: "CAN", label: "1" }, { column: "Code", value: "USA", label: "3" }])));
        expect(badges().map(b => b.textContent)).toEqual(["1", "3"]);
        expect((window as any).__draws).toBe(draws);          // the chart itself was not redrawn
        // The same list rebuilt inline on a re-render is not a change.
        act(() => root!.render(chart([{ column: "Code", value: "CAN", label: "1" }, { column: "Code", value: "USA", label: "3" }])));
        expect((window as any).__draws).toBe(draws);
    });

    it("inside a group, a filtered member finds the key in its own rows", () => {
        const columns = [{ name: "Code", dataType: "String" }];
        const rows = [{ Code: "USA" }, { Code: "CAN" }, { Code: "FRA" }];
        mount(createElement(BicChartGroup, { columns, rows, children: [
            createElement(BicChart, { key: "a", id: "a", code: CHART, d3: D3 }),
            createElement(BicChart, { key: "b", id: "b", code: CHART, d3: D3, annotations: [{ column: "Code", value: "FRA" }] }),
        ] }));
        expect(badges()).toHaveLength(1);
        // Select CAN in chart a: b is filtered to CAN alone, so FRA has no mark there - no badge on the wrong row.
        const aMarks = host!.querySelectorAll("div > div")[0].querySelectorAll(".d3-mark");
        act(() => { (aMarks[1] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(badges()).toHaveLength(0);
    });
});
