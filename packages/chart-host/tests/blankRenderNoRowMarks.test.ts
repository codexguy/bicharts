// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { censusMarks, isBlankRender } from "../src/blankRender";
import { createChartHost } from "../src/host";
import { NO_ROW_MARKS_ATTR } from "../src/contract";

// A CHART THAT DRAWS NO ROW MARKS BY DESIGN IS NOT BLANK. A what-if predictor draws one model - pins,
// bands, a caption - and no mark per row, so a census of `.d3-mark` finds zero against a full table
// and the blank-render guard told the reader the chart had drawn nothing. The chart now DECLARES it,
// on an element it draws in its working path, and the verdict honours the declaration.

const PREDICTOR = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  if (!data.rows.length) { const d = doc.createElement('div'); d.textContent = 'No data'; container.appendChild(d); return; }
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('${NO_ROW_MARKS_ATTR}', '');
  const t = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.textContent = 'Predicted range';
  svg.appendChild(t);
  container.appendChild(svg);
}`;
// The same chart's no-data branch reached WITH rows (a column it needs is gone): no declaration.
const PREDICTOR_BAILED = `
function render(container, data, options) {
  const idx = data.columns.findIndex(c => c.name === 'GoneAway');
  if (idx === -1) { const d = container.ownerDocument.createElement('div'); d.textContent = 'No data'; container.appendChild(d); return; }
}`;
const data = { columns: [{ name: "Spend" }, { name: "Revenue" }], rows: [[1, 2], [3, 4], [5, 6]] };

describe("the no-row-marks declaration", () => {
    it("censusMarks reports it from an element the chart drew", () => {
        const c = document.createElement("div");
        c.innerHTML = `<svg ${NO_ROW_MARKS_ATTR}=""><text>model</text></svg>`;
        const census = censusMarks(c);
        expect(census.markCount).toBe(0);
        expect(census.declaresNoRowMarks).toBe(true);
        expect(isBlankRender({ markCount: 0, rows: 3, declaresNoRowMarks: census.declaresNoRowMarks })).toBe(false);
    });

    it("a stamp on the HOST's container is not the chart's declaration", () => {
        // The container outlives every render; a declaration there could outlive the chart that made it.
        const c = document.createElement("div");
        c.setAttribute(NO_ROW_MARKS_ATTR, "");
        c.innerHTML = `<div>No data</div>`;
        expect(censusMarks(c).declaresNoRowMarks).toBe(false);
    });

    it("without it, zero marks against rows is still blank", () => {
        expect(isBlankRender({ markCount: 0, rows: 3 })).toBe(true);
        expect(isBlankRender({ markCount: 0, rows: 3, declaresNoRowMarks: false })).toBe(true);
    });

    it("createChartHost stays quiet for the declared chart and still speaks when it bails", () => {
        const quiet = vi.fn();
        createChartHost(document.createElement("div"), { data, code: PREDICTOR, onBlankRender: quiet, d3: {} }).render();
        expect(quiet).not.toHaveBeenCalled();

        const loud = vi.fn();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { /* silence */ });
        try {
            createChartHost(document.createElement("div"), { data, code: PREDICTOR_BAILED, onBlankRender: loud, d3: {} }).render();
        } finally { warn.mockRestore(); }
        expect(loud).toHaveBeenCalledTimes(1);
    });
});
