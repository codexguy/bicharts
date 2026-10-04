// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// A NOTE ON A MAP YOU CAN ZOOM. Badges already follow their marks through a zoom or a pan (the layer redraws when a
// mark moves). Measured in Chromium on a bivariate world map: when a country leaves the view its badge was placed
// OUTSIDE the map (shown wherever the container doesn't clip), a badge sat on the map's own zoom buttons, and a partly
// visible country's badge sat at the centre of its WHOLE outline - Alaska to Florida - not on the part in view. So: a
// badge goes on the visible part of its mark, a mark with nothing in view gets none, and no badge covers a control.

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

// A map: an svg 400x200 at the container's origin, a mark per row whose box comes from the data, and (optionally) the
// zoom helper's button pad, drawn from a row keyed PAD (never a mark, never annotated).
const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("data-box", "0,0,400,200");
  const g = doc.createElementNS(NS, "g");
  svg.appendChild(g);
  for (let r = 0; r < data.rows.length; r++) {
    if (data.rows[r][0] === "PAD") {
      const pad = doc.createElementNS(NS, "g");
      pad.setAttribute("class", "llm-zoom-pad");
      pad.setAttribute("data-box", data.rows[r][1]);
      svg.appendChild(pad);
      continue;
    }
    const p = doc.createElementNS(NS, "path");
    p.setAttribute("class", "d3-mark");
    p.setAttribute("data-row-idx", String(r));
    p.setAttribute("data-box", data.rows[r][1]);
    // A shape filling only part of its box (a country whose box spans ocean): screen x below data.rows[r][2].
    if (data.rows[r][2] != null) {
      const edge = data.rows[r][2];
      p.getScreenCTM = () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) });
      p.isPointInFill = pt => pt.x < edge;
    }
    g.appendChild(p);
  }
  container.appendChild(svg);
}`;

function mount(rows: Array<[string, string] | [string, string, number]>, pad?: string) {
    stubBoxes();
    const el = document.createElement("div");
    el.setAttribute("data-box", "0,0,400,200");
    document.body.appendChild(el);
    const host = createChartHost(el, {
        code: CHART, d3: {},
        data: { columns: [{ name: "CountryCode" }, { name: "Box" }, { name: "Edge" }], rows: pad ? [...rows, ["PAD", pad]] : rows } as any,
        annotations: rows.map(([k]) => ({ column: "CountryCode", value: k, label: "1" })),
    } as any);
    host.render();
    return { el, host };
}
const badges = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".bic-annotation"));
const at = (b: HTMLElement) => [parseFloat(b.style.left), parseFloat(b.style.top)];

describe("mark annotations on a zoomed or panned map", () => {
    it("draws no badge for a mark that is wholly out of view, and counts it as not shown", () => {
        // AUS panned off to the right of a 400px map; BRA in view.
        const { el, host } = mount([["AUS", "900,80,120,60"], ["BRA", "100,100,60,60"]]);
        const b = badges(el);
        expect(b).toHaveLength(1);
        expect(at(b[0])).toEqual([130, 130]);
        expect(host.annotationReport).toEqual({ shown: 1, notShown: 1 });
    });

    it("puts the badge on the part of a mark that is in view, not the centre of its whole outline", () => {
        // The USA's box runs 300..700 x 20..120 - only 300..400 is inside the map.
        const { el } = mount([["USA", "300,20,400,100"]]);
        const b = badges(el);
        expect(b).toHaveLength(1);
        expect(at(b[0])).toEqual([350, 70]);
    });

    it("never covers the map's own controls: the badge moves clear of the zoom pad, still on its mark", () => {
        // The mark's visible centre (370, 30) sits on the zoom pad (340..400 x 0..60).
        const { el } = mount([["CAN", "340,0,60,120"]], "340,0,60,60");
        const b = badges(el);
        expect(b).toHaveLength(1);
        const [x, y] = at(b[0]);
        const clear = x + 8 <= 340 || x - 8 >= 400 || y + 8 <= 0 || y - 8 >= 60;
        expect(clear).toBe(true);
        expect(x >= 340 && x <= 400 && y >= 0 && y <= 120).toBe(true);   // on the mark's visible part
    });

    it("hides a badge with nowhere clear to go rather than covering a control", () => {
        const { el, host } = mount([["CAN", "350,10,40,40"]], "340,0,60,60");
        expect(badges(el)).toHaveLength(0);
        expect(host.annotationReport).toEqual({ shown: 0, notShown: 1 });
    });

    it("puts the badge on the mark's own shape when the centre of its visible part is empty space", () => {
        // The USA's visible box is 300..400, but the country fills only x < 330 of it (the rest is ocean).
        const { el } = mount([["USA", "300,20,400,100", 330]]);
        const b = badges(el);
        expect(b).toHaveLength(1);
        const [x, y] = at(b[0]);
        expect(x).toBeLessThan(330);
        expect(x).toBeGreaterThanOrEqual(300);
        expect(y >= 20 && y <= 120).toBe(true);
    });
});
