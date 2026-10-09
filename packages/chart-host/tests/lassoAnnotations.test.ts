// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { installLasso, type LassoHandle } from "../src/lasso";

// A LASSO BEING DRAWN DOES NOT REDRAW THE NOTES. The badges follow a mark that moves without a render (a zoom,
// a pan) by watching the chart for geometry changes, and the lasso's outline is a path whose `d` changes on
// every pointer move. Counted as a moving mark, each move repainted every badge: a measurement of every
// annotated mark per frame, for a path that moves nothing.

const SVGNS = "http://www.w3.org/2000/svg";
const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS("${SVGNS}", "svg");
  svg.setAttribute("viewBox", "0 0 400 200");
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElementNS("${SVGNS}", "circle");
    m.setAttribute("class", "d3-mark");
    m.setAttribute("data-row-idx", String(r));
    m.setAttribute("data-code", String(data.rows[r][0]));
    svg.appendChild(m);
  }
  container.appendChild(svg);
}`;
const ALL = { columns: [{ name: "CountryCode" }, { name: "Revenue" }], rows: [["USA", 10], ["CAN", 11], ["FRA", 9]] } as any;

afterEach(() => vi.restoreAllMocks());
function stubBoxes() {
    const orig = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const code = this.getAttribute?.("data-code");
        const i = code ? ["USA", "CAN", "FRA"].indexOf(code) : -1;
        if (i >= 0) return { left: 100 * i, top: 20, width: 80, height: 40, right: 100 * i + 80, bottom: 60, x: 100 * i, y: 20, toJSON() {} } as DOMRect;
        return orig.call(this);
    });
}

describe("a lasso outline is not a moving mark", () => {
    it("changing the outline leaves the badges alone, while a mark that really moves repaints them", async () => {
        stubBoxes();
        const el = document.createElement("div");
        document.body.appendChild(el);
        const host = createChartHost(el, {
            code: CHART, data: ALL, d3: {},
            annotations: [{ column: "CountryCode", value: "CAN", label: "2" }],
        } as any);
        host.render();
        const badge = () => el.querySelector(".bic-annotation");
        const first = badge();
        expect(first).toBeTruthy();

        let handle: LassoHandle | null = null;
        try {
            handle = installLasso({ container: el, options: () => ({ ...host.options, lasso: { capable: true } } as any), rows: 3, select: () => {}, clearSelection: () => {} });
            const outline = el.querySelector(".lch-lasso-outline")!;
            expect(outline).toBeTruthy();
            for (let i = 0; i < 6; i++) outline.setAttribute("d", `M0 0L${10 + i} 5L5 ${10 + i}Z`);
            await new Promise(r => setTimeout(r, 80));                 // several frames
            expect(badge()).toBe(first);                                // not repainted

            // The same wait does see a real move, so the check above can fail.
            el.querySelector('.d3-mark[data-code="CAN"]')!.setAttribute("transform", "translate(30,0)");
            await vi.waitFor(() => expect(badge()).not.toBe(first));
        } finally { handle?.destroy(); el.remove(); }
    });
});
