// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// A BADGE NEVER COVERS TEXT. Centred on its mark's box, a note's badge sat on the very thing the mark is read by:
// a tile-grid cartogram's tile shows its code in the middle (JPN read 'J?N' under the badge), and a table row's
// middle is one of its value cells (a '+5.9%' lost its '+' and read as a decline). So a badge goes on the mark's
// top-right corner, half outside it; on a row it follows the row's label (its first text); and it stays inside
// the chart's frame when the mark runs to the edge.

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

type Box = { l: number; t: number; r: number; b: number };
const boxOf = (s: string): Box => { const [l, t, w, h] = s.split(",").map(Number); return { l, t, r: l + w, b: t + h }; };
const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const badges = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".bic-annotation"));
// The badge's box as drawn: centred on (left, top), 16px tall, max(16, 6 per character + 8) wide.
const badgeBox = (b: HTMLElement): Box => {
    const x = parseFloat(b.style.left), y = parseFloat(b.style.top);
    const hw = Math.max(16, (b.textContent || "").length * 6 + 8) / 2;
    return { l: x - hw, t: y - 8, r: x + hw, b: y + 8 };
};

// A tile grid: an svg the size of the frame, a square tile per row, and the tile's code centred on it as an svg
// text - a sibling of the tile, not inside it, the way a cartogram draws them.
const TILES = `
function render(container, data) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("data-box", "0,0,400,200");
  data.rows.forEach((row, r) => {
    const t = doc.createElementNS(NS, "rect");
    t.setAttribute("class", "tile d3-mark");
    t.setAttribute("data-row-idx", String(r));
    t.setAttribute("data-box", row[1]);
    svg.appendChild(t);
    const code = doc.createElementNS(NS, "text");
    code.setAttribute("data-box", row[2]);
    code.textContent = row[0];
    svg.appendChild(code);
  });
  container.appendChild(svg);
}`;

// A table: an HTML row per data row (the mark), its first cell the label - a code then a name - and value cells
// after it, each value drawn as an svg text the way an embedded-chart table draws them.
const TABLE = `
function render(container, data) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  data.rows.forEach((row, r) => {
    const tr = doc.createElement("div");
    tr.className = "d3-mark lch-table-row";
    tr.setAttribute("data-row-idx", String(r));
    tr.setAttribute("data-box", row[1]);
    const lc = doc.createElement("div");
    for (const [txt, box] of row[2]) {
      const s = doc.createElement("span");
      s.setAttribute("data-box", box);
      s.textContent = txt;
      lc.appendChild(s);
    }
    tr.appendChild(lc);
    for (const [txt, box] of row[3]) {
      const cell = doc.createElement("div");
      const svg = doc.createElementNS(NS, "svg");
      const t = doc.createElementNS(NS, "text");
      t.setAttribute("data-box", box);
      t.textContent = txt;
      svg.appendChild(t);
      cell.appendChild(svg);
      tr.appendChild(cell);
    }
    container.appendChild(tr);
  });
}`;

function mount(code: string, rows: any[][], keys: string[]) {
    stubBoxes();
    const el = document.createElement("div");
    el.setAttribute("data-box", "0,0,400,200");
    document.body.appendChild(el);
    const host = createChartHost(el, {
        code, d3: {},
        data: { columns: [{ name: "CountryCode" }, { name: "Box" }, { name: "A" }, { name: "B" }], rows } as any,
        annotations: keys.map(k => ({ column: "CountryCode", value: k, label: "1" })),
    } as any);
    host.render();
    return { el, host };
}

describe("where a note's badge goes on its mark", () => {
    it("a tile with its code centred: the badge sits on the tile's top-right corner, clear of the code", () => {
        const tile = "100,100,40,40", code = "104,112,32,16";
        const { el } = mount(TILES, [["JPN", tile, code]], ["JPN"]);
        const b = badges(el);
        expect(b).toHaveLength(1);
        const bb = badgeBox(b[0]);
        expect(overlaps(bb, boxOf(code))).toBe(false);
        // On the top-right corner, half outside the tile: its centre on the corner's quadrant, its box touching it.
        const x = parseFloat(b[0].style.left), y = parseFloat(b[0].style.top);
        expect(x).toBeGreaterThan(120);
        expect(y).toBeLessThan(120);
        expect(overlaps(bb, { l: 100, t: 100, r: 140.01, b: 140 }) || (bb.l <= 140 && bb.b >= 100)).toBe(true);
    });

    it("a row: the badge follows the row's label, centred on it, and covers none of the row's values", () => {
        const label: Array<[string, string]> = [["JPN", "6,46,22,12"], ["Japan", "33,46,30,12"]];
        const values: Array<[string, string]> = [["+5.9%", "200,46,30,12"], ["$12M", "300,46,30,12"]];
        const { el } = mount(TABLE, [["JPN", "0,40,400,24", label, values]], ["JPN"]);
        const b = badges(el);
        expect(b).toHaveLength(1);
        const bb = badgeBox(b[0]);
        for (const [, box] of [...label, ...values]) expect(overlaps(bb, boxOf(box))).toBe(false);
        expect(bb.l).toBeGreaterThanOrEqual(63);          // after "Japan" (33..63)
        expect(bb.r).toBeLessThanOrEqual(200);            // before the first value
        expect(parseFloat(b[0].style.top)).toBe(52);     // the label's middle (46..58)
    });

    it("a row with no text at all keeps the corner placement", () => {
        const { el } = mount(TABLE, [["JPN", "0,40,400,24", [], []]], ["JPN"]);
        const b = badges(el);
        expect(b).toHaveLength(1);
        expect([parseFloat(b[0].style.left), parseFloat(b[0].style.top)]).toEqual([392, 40]);  // (400,40), clamped
    });

    it("a tile at the frame's edge: the badge is clamped inside the frame, and still clear of the code", () => {
        const tile = "360,0,40,40", code = "364,12,32,16";
        const { el } = mount(TILES, [["JPN", tile, code]], ["JPN"]);
        const b = badges(el);
        expect(b).toHaveLength(1);
        const bb = badgeBox(b[0]);
        expect(bb.l >= 0 && bb.t >= 0 && bb.r <= 400 && bb.b <= 200).toBe(true);
        expect(overlaps(bb, boxOf(code))).toBe(false);
        expect(bb.l <= 400 && bb.r >= 360 && bb.t <= 40 && bb.b >= 0).toBe(true);    // touching its tile
    });

    it("two notes on neighbouring tiles do not cover each other", () => {
        const { el } = mount(TILES, [["DEU", "100,100,40,40", "104,112,32,16"], ["POL", "142,100,40,40", "146,112,32,16"]], ["DEU", "POL"]);
        const b = badges(el);
        expect(b).toHaveLength(2);
        expect(overlaps(badgeBox(b[0]), badgeBox(b[1]))).toBe(false);
        for (const t of ["104,112,32,16", "146,112,32,16"]) for (const x of b) expect(overlaps(badgeBox(x), boxOf(t))).toBe(false);
    });
});
