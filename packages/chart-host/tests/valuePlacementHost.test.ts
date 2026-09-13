// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createChartHost } from "../src/host";
import { valuePlacementFlag, type ValuePlacementCensus } from "../src/valuePlacement";

// The host runs the placement census after every render and hands it to the callback, with the
// rows the chart was drawn from - the census cannot know a dot's value any other way.
const DOTS = `
function render(container, data, options) {
  container.replaceChildren();
  const doc = container.ownerDocument;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  data.rows.forEach((r, i) => {
    const c = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", "d3-mark");
    c.setAttribute("data-row-idx", String(i));
    c.setAttribute("cx", String(100 + (i % 7) * 9));
    // options.aggregation is abused as a switch: "drift" pushes every third dot off its value.
    c.setAttribute("cy", String(400 - r[1] * 20 + (options.aggregation === "drift" && i % 3 === 0 ? 25 : 0)));
    c.setAttribute("r", "3");
    svg.appendChild(c);
  });
}`;

const DATA = {
    columns: [{ name: "Group" }, { name: "Value" }, { name: "__rowIdx__" }],
    rows: Array.from({ length: 60 }, (_, i) => ["g" + (i % 2), Math.round((1 + ((i * 0.618) % 1) * 15) * 100) / 100, i]),
};

describe("createChartHost - onValuePlacementCensus", () => {
    it("reports after every render, and a re-render with drifted dots reports the drift", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const seen: ValuePlacementCensus[] = [];
        const host = createChartHost(container, { data: DATA, code: DOTS, onValuePlacementCensus: c => seen.push(c) } as any);
        host.render();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1].column).toBe("Value");
        expect(valuePlacementFlag(seen[seen.length - 1])).toBe("place:d3:off0");
        host.setOptions({ aggregation: "drift" } as any);
        expect(valuePlacementFlag(seen[seen.length - 1])).toBe("place:d3:off20");
    });
});
