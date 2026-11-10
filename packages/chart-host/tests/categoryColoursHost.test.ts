// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createChartHost } from "../src/host";
import type { CategoryColourCensus } from "../src/categoryColours";

// The host runs the category-colour census after every render and hands it to the callback, measured at the dim level
// the host applies to a selection, a tick after the render (the census loads on first use). It reports and never repaints.
const FOUR = `
function render(container, data, options) {
  container.replaceChildren();
  const doc = container.ownerDocument;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  const colours = ["#8cbc6c", "#516992", "#7ba061", "#71809d"];
  data.rows.forEach((r, i) => {
    const c = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", "d3-mark");
    c.setAttribute("data-row-idx", String(i));
    c.setAttribute("fill", colours[i % 4]);
    c.setAttribute("r", "3");
    svg.appendChild(c);
  });
}`;

const DATA = {
    columns: [{ name: "Group" }, { name: "Value" }, { name: "__rowIdx__" }],
    rows: Array.from({ length: 16 }, (_, i) => ["g" + (i % 4), i, i]),
};

describe("createChartHost - onCategoryColourCensus", () => {
    it("reports after a render, at the host's dim level, and leaves the fills as painted", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const seen: CategoryColourCensus[] = [];
        const host = createChartHost(container, { data: DATA, code: FOUR, onCategoryColourCensus: c => seen.push(c) } as any);
        host.render();
        await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
        const last = seen[seen.length - 1];
        expect(last.slots).toBe(4);
        expect(last.closestDeltaE!).toBeCloseTo(8.2, 1);
        host.setOptions({ dimOpacity: 0.4 } as any);
        await vi.waitFor(() => expect(seen[seen.length - 1].dimOpacity).toBe(0.4));
        const fills = [...container.querySelectorAll(".d3-mark")].slice(0, 4).map(e => e.getAttribute("fill"));
        expect(fills).toEqual(["#8cbc6c", "#516992", "#7ba061", "#71809d"]);
    });
});
