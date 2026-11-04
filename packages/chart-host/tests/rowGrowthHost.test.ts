// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// The host compares the rows it drew with the rows the chart was built for after every render.

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement('div');
    m.setAttribute('class', 'd3-mark');
    m.setAttribute('data-row-idx', String(r));
    container.appendChild(m);
  }
}`;
const rows = (n: number) => Array.from({ length: n }, (_, i) => [`R${i}`]);
const data = (n: number) => ({ columns: [{ name: "Region" }], rows: rows(n) });

afterEach(() => vi.restoreAllMocks());

describe("createChartHost builtForRows / onRowGrowth", () => {
    it("calls onRowGrowth with the counts after a render on far more rows", () => {
        const onRowGrowth = vi.fn();
        const c = document.createElement("div");
        const h = createChartHost(c, { code: CHART, data: data(600), d3: {}, builtForRows: 12, onRowGrowth });
        h.render();
        expect(onRowGrowth).toHaveBeenCalledTimes(1);
        expect(onRowGrowth.mock.calls[0][0]).toMatchObject({ builtFor: 12, rendered: 600, code: "row-growth" });
        h.render();
        expect(onRowGrowth).toHaveBeenCalledTimes(2);   // once per render
    });
    it("is silent after setData to a few rows", () => {
        const onRowGrowth = vi.fn();
        const c = document.createElement("div");
        const h = createChartHost(c, { code: CHART, data: data(600), d3: {}, builtForRows: 12, onRowGrowth });
        h.render();
        onRowGrowth.mockClear();
        h.setData(data(18) as any);
        h.render();
        expect(onRowGrowth).not.toHaveBeenCalled();
    });
    it("never calls without builtForRows, or with null", () => {
        const onRowGrowth = vi.fn();
        createChartHost(document.createElement("div"), { code: CHART, data: data(600), d3: {}, onRowGrowth }).render();
        createChartHost(document.createElement("div"), { code: CHART, data: data(600), d3: {}, builtForRows: null, onRowGrowth }).render();
        expect(onRowGrowth).not.toHaveBeenCalled();
    });
    it("without a callback, says it once in the console across two renders", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const h = createChartHost(document.createElement("div"), { code: CHART, data: data(600), d3: {}, builtForRows: 12 });
        h.render();
        h.render();
        const said = warn.mock.calls.filter(a => String(a[0]).includes("Built for 12 rows, now showing 600"));
        expect(said).toHaveLength(1);
    });
});
