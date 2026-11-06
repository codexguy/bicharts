// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// A NOTE GOES ON THE MOST SPECIFIC MARK FOR ITS KEY. Measured on a variance grid: a region's subtotal row carries
// every member country's rows in its data-row-idx (so a click on it filters to the region), so a note keyed by a
// country matched BOTH the subtotal row and the country's own row. The two rows are the same size, the placement kept
// the first of equal areas, and the subtotal row came first: every country's note sat on its region's row. A note
// belongs on the leaf - the mark whose rows are the key's - and a group mark carries it only when no leaf is drawn
// (the group collapsed).

// jsdom lays nothing out: every element with data-box="left,top,width,height" reports that box.
afterEach(() => vi.restoreAllMocks());
function stubBoxes() {
    const orig = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const box = this.getAttribute?.("data-box");
        if (box) {
            const [l, t, w, h] = box.split(",").map(Number);
            return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} } as DOMRect;
        }
        return orig.call(this);
    });
}

// A grid: per region, a subtotal row listing its members' rows (aria-level 1), then a row per member (aria-level 2)
// unless the region is collapsed (column 2). Every row is 300x20, one under the next from y=100 (clear of the frame's
// edge), so a badge's y is the top of the row it is on.
const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("data-box", "0,0,400,400");
  let y = 100;
  const row = (idxs, level) => {
    const r = doc.createElementNS(NS, "rect");
    r.setAttribute("class", "d3-mark");
    r.setAttribute("data-row-idx", idxs.join(","));
    r.setAttribute("aria-level", String(level));
    r.setAttribute("data-box", "0," + y + ",300,20");
    svg.appendChild(r);
    y += 20;
  };
  const regions = [];
  data.rows.forEach((d, i) => {
    let g = regions.find(x => x.name === d[0]);
    if (!g) regions.push(g = { name: d[0], rows: [], collapsed: !!d[2] });
    g.rows.push(i);
  });
  for (const g of regions) {
    row(g.rows, 1);
    if (!g.collapsed) for (const i of g.rows) row([i], 2);
  }
  container.appendChild(svg);
}`;

function mount(rows: Array<[string, string, boolean?]>, annotations: any[]) {
    stubBoxes();
    const el = document.createElement("div");
    el.setAttribute("data-box", "0,0,400,400");
    document.body.appendChild(el);
    const host = createChartHost(el, {
        code: CHART, d3: {},
        data: { columns: [{ name: "Region" }, { name: "Country" }, { name: "Collapsed" }], rows } as any,
        annotations,
    } as any);
    host.render();
    return { el, host };
}
const badges = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".bic-annotation"));
const top = (b: HTMLElement) => parseFloat(b.style.top);

describe("a note on a key several marks carry", () => {
    // EMEA's subtotal at y=100, FRA at 120, DEU at 140; AMER's subtotal at 160, USA at 180, CAN at 200.
    const GRID: Array<[string, string, boolean?]> = [["EMEA", "FRA"], ["EMEA", "DEU"], ["AMER", "USA"], ["AMER", "CAN"]];

    it("lands on the country's own row, not its region's subtotal row of the same size", () => {
        const { el, host } = mount(GRID, [
            { column: "Country", value: "DEU", label: "1" },
            { column: "Country", value: "USA", label: "2" },
        ]);
        expect(badges(el).map(x => [x.textContent, top(x)])).toEqual([["1", 140], ["2", 180]]);
        expect(host.annotationReport).toEqual({ shown: 2, notShown: 0 });
    });

    it("lands on the first member's row too, though its region's subtotal row is drawn just before it", () => {
        const { el } = mount(GRID, [{ column: "Country", value: "FRA", label: "1" }]);
        expect(badges(el).map(top)).toEqual([120]);
    });

    it("lands on the subtotal row when the group is collapsed and no row for the key is drawn", () => {
        // EMEA collapsed: its subtotal at y=100 is the only mark carrying DEU; AMER's subtotal at 120, USA at 140.
        const { el, host } = mount([["EMEA", "FRA", true], ["EMEA", "DEU", true], ["AMER", "USA"], ["AMER", "CAN"]], [
            { column: "Country", value: "DEU", label: "1" },
            { column: "Country", value: "USA", label: "2" },
        ]);
        expect(badges(el).map(x => [x.textContent, top(x)])).toEqual([["1", 100], ["2", 140]]);
        expect(host.annotationReport).toEqual({ shown: 2, notShown: 0 });
    });

    it("lands on the member's row in a group of one, whose subtotal row carries the same rows: the deeper level wins", () => {
        // APAC's subtotal at y=100 and JPN's row at 120 both list row 0; only aria-level tells them apart.
        const { el } = mount([["APAC", "JPN"], ["EMEA", "FRA"], ["EMEA", "DEU"]], [{ column: "Country", value: "JPN", label: "1" }]);
        expect(badges(el).map(top)).toEqual([120]);
    });

    it("lands on the subtotal row for a key that names the group itself", () => {
        const { el } = mount(GRID, [{ column: "Region", value: "AMER", label: "1" }, { column: "Region", value: "EMEA", label: "2" }]);
        expect(badges(el).map(x => [x.textContent, top(x)])).toEqual([["1", 160], ["2", 100]]);
    });
});
