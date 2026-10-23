// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { NOTE_STYLE_ATTR } from "../src/contract";

// A CHART CAN ASK FOR A DOT, AND EVERY NOTE SCROLLS WITH ITS MARK. Measured in Chromium on a tile-grid world map: a
// note's badge, moved clear of the tile's code and of the next tile's badge, left its tile's top-right corner (where
// the next tile touches it) for the border with a third tile and read as that tile's note. So a chart whose marks sit
// edge to edge declares data-bic-note-style="dot": its notes are one small dot at one fixed spot inside the mark, the
// label read in the tooltip. Every other chart keeps its badge. And in a table that scrolls inside its own box, the
// badges stayed where they were drawn while the rows moved, and a row scrolled into view never got one: a scroll now
// redraws the notes, and a row out of the box's view has none.

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
const inside = (a: Box, b: Box) => a.l >= b.l && a.r <= b.r && a.t >= b.t && a.b <= b.b;
const notes = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".bic-annotation"));
const at = (g: HTMLElement) => [parseFloat(g.style.left), parseFloat(g.style.top)];
// The dot as drawn: 8px and its 1.5px ring, centred on (left, top).
const dotBox = (g: HTMLElement): Box => { const [x, y] = at(g); return { l: x - 5.5, t: y - 5.5, r: x + 5.5, b: y + 5.5 }; };

// A tile grid: a square tile per row (box in column 1) and its code centred on it (box in column 2), as svg siblings.
// `style` is what the chart declares on the svg holding its tiles (none: undeclared).
const tiles = (style?: string) => `
function render(container, data) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("data-box", "0,0,400,200");
  ${style ? `svg.setAttribute("${NOTE_STYLE_ATTR}", "${style}");` : ""}
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

// A table that scrolls inside its own box: a 400x200 scroller (overflow auto) and an HTML row per data row, its label
// a span. A scroll is the test moving the rows' boxes and firing the scroller's scroll event - nothing re-renders.
const SCROLLING = `
function render(container, data) {
  const doc = container.ownerDocument;
  const sc = doc.createElement("div");
  sc.className = "scroller";
  sc.style.overflow = "auto";
  sc.setAttribute("data-box", "0,0,400,200");
  data.rows.forEach((row, r) => {
    const tr = doc.createElement("div");
    tr.className = "d3-mark";
    tr.setAttribute("data-row-idx", String(r));
    tr.setAttribute("data-box", row[1]);
    const s = doc.createElement("span");
    s.setAttribute("data-box", row[2]);
    s.textContent = row[0];
    tr.appendChild(s);
    sc.appendChild(tr);
  });
  container.appendChild(sc);
}`;

const COLS = [{ name: "Country" }, { name: "Box" }, { name: "Text" }];
function mount(code: string, rows: any[][], annotations: any[], before?: (el: HTMLElement) => void) {
    stubBoxes();
    const el = document.createElement("div");
    el.setAttribute("data-box", "0,0,400,200");
    document.body.appendChild(el);
    before?.(el);
    const host = createChartHost(el, { code, d3: {}, data: { columns: COLS, rows } as any, annotations } as any);
    host.render();
    return { el, host };
}

// DEU with SWE touching its top-right corner, NLD on its left and POL on its right, each code centred on its tile.
const DEU = "100,100,40,40", SWE = "140,60,40,40", NLD = "60,100,40,40", POL = "140,100,40,40";
const GRID = [["DEU", DEU, "106,114,28,12"], ["SWE", SWE, "146,74,28,12"], ["NLD", NLD, "66,114,28,12"], ["POL", POL, "146,114,28,12"]];
const ON_DEU = [{ column: "Country", value: "DEU", label: "2", title: "Two notes" }];

describe("a chart that declares data-bic-note-style=\"dot\"", () => {
    it("draws each note as a dot at one fixed spot inside its own tile's top-right corner, its label read, not drawn", () => {
        const { el } = mount(tiles("dot"), GRID, ON_DEU);
        const g = notes(el);
        expect(g).toHaveLength(1);
        expect(g[0].textContent).toBe("");
        expect([g[0].style.width, g[0].style.height, g[0].style.borderRadius]).toEqual(["8px", "8px", "50%"]);
        expect(at(g[0])).toEqual([132, 108]);                     // 8 in from DEU's corner (140, 100)
        expect(inside(dotBox(g[0]), boxOf(DEU))).toBe(true);
        for (const other of [SWE, NLD, POL]) expect(overlaps(dotBox(g[0]), boxOf(other))).toBe(false);
        expect(g[0].getAttribute("title")).toBe("(2) Two notes");
        expect(g[0].getAttribute("aria-label")).toBe("Note on DEU: 2. Two notes");
    });

    it("the same spot on every tile, whatever text or other notes are around it - no search", () => {
        const { el } = mount(tiles("dot"), [["DEU", DEU, DEU], ["POL", POL, POL]],
            [{ column: "Country", value: "DEU" }, { column: "Country", value: "POL", label: "3" }]);
        expect(notes(el).map(at)).toEqual([[132, 108], [172, 108]]);
        expect(notes(el)[1].getAttribute("title")).toBe("Note on POL: 3");
    });

    it("a mark too small to hold the dot has it on its top-right corner; one mostly out of view, or under a control, has none", () => {
        const { el } = mount(tiles("dot"), [["PT", "100,100,6,6", "0,0,0,0"]], [{ column: "Country", value: "PT" }]);
        expect(notes(el).map(at)).toEqual([[106, 100]]);
        const { host } = mount(tiles("dot"), [["USA", "390,20,200,100", "0,0,0,0"]], [{ column: "Country", value: "USA" }]);
        expect(host.annotationReport).toEqual({ shown: 0, notShown: 1 });   // 10 px of it inside the 400 px svg
        const PAD = `${tiles("dot").replace("container.appendChild(svg);", `const p = doc.createElementNS(NS, "g"); p.setAttribute("class", "llm-zoom-pad"); p.setAttribute("data-box", "120,90,40,30"); svg.appendChild(p); container.appendChild(svg);`)}`;
        const { el: el3, host: h3 } = mount(PAD, GRID, ON_DEU);
        expect(notes(el3)).toHaveLength(0);
        expect(h3.annotationReport).toEqual({ shown: 0, notShown: 1 });
    });

    it("the nearest declaration decides: a mark that says otherwise inside a dot chart keeps the badge", () => {
        const code = tiles("dot").replace(`t.setAttribute("class", "tile d3-mark");`,
            `t.setAttribute("class", "tile d3-mark"); if (row[0] === "POL") t.setAttribute("${NOTE_STYLE_ATTR}", "badge");`);
        const { el } = mount(code, GRID, [{ column: "Country", value: "DEU", label: "2" }, { column: "Country", value: "POL", label: "1" }]);
        expect(notes(el).map(n => n.textContent)).toEqual(["", "1"]);
    });
});

describe("a chart that declares nothing keeps the badge", () => {
    it("an undeclared tile keeps the numbered badge and its search (the pre-dot placement)", () => {
        const { el } = mount(tiles(), GRID, ON_DEU);
        const g = notes(el);
        expect(g).toHaveLength(1);
        expect(g[0].textContent).toBe("2");
        expect(g[0].getAttribute("title")).toBe("Two notes");
        expect(g[0].getAttribute("aria-label")).toBe("Note: Two notes");
        expect([g[0].style.minWidth, g[0].style.height, g[0].style.borderRadius]).toEqual(["16px", "16px", "8px"]);
        expect(at(g[0])).toEqual([140, 100]);                     // the corner search's pick (SWE's code is in the way), as before
    });
});

describe("every note scrolls with its mark", () => {
    const rows = () => [["Japan", "0,20,400,24", "6,26,30,12"], ["Brazil", "0,260,400,24", "6,266,30,12"]];
    const two = [{ column: "Country", value: "Japan", label: "1" }, { column: "Country", value: "Brazil", label: "1" }];
    const scrollBy = (el: HTMLElement, dy: number) => {
        // Move every row (and its label) up by dy, then fire the scroller's own scroll event, which does not bubble.
        for (const n of Array.from(el.querySelectorAll<HTMLElement>(".scroller [data-box]"))) {
            const [l, t, w, h] = n.getAttribute("data-box")!.split(",").map(Number);
            n.setAttribute("data-box", `${l},${t - dy},${w},${h}`);
        }
        el.querySelector(".scroller")!.dispatchEvent(new Event("scroll", { bubbles: false }));
    };
    const ys = (el: HTMLElement) => Object.fromEntries(notes(el).map(g => [g.getAttribute("aria-label"), parseFloat(g.style.top)]));

    it("a row scrolled into the box's view gets its badge after its label, and the badge moves with the row", async () => {
        const { el, host } = mount(SCROLLING, rows(), two);
        expect(ys(el)).toEqual({ "Note on Japan": 32 });            // Brazil is below the box
        scrollBy(el, 100);                                          // Brazil now 160..184, Japan above the box
        await vi.waitFor(() => expect(ys(el)).toEqual({ "Note on Brazil": 172 }));
        expect(host.annotationReport).toEqual({ shown: 1, notShown: 1 });
        expect(notes(el)[0].textContent).toBe("1");
        expect(parseFloat(notes(el)[0].style.left)).toBeGreaterThan(36);   // after the label (6..36)
        scrollBy(el, 60);                                           // Brazil 100..124
        await vi.waitFor(() => expect(ys(el)).toEqual({ "Note on Brazil": 112 }));
    });

    it("a row scrolled out of the box's view loses its badge", async () => {
        const { el, host } = mount(SCROLLING, [["Japan", "0,100,400,24", "6,106,30,12"]], [two[0]]);
        expect(notes(el)).toHaveLength(1);
        scrollBy(el, 160);                                          // Japan -60..-36
        await vi.waitFor(() => expect(host.annotationReport).toEqual({ shown: 0, notShown: 1 }));
        expect(notes(el)).toHaveLength(0);
    });

    it("a container that itself scrolls carries its notes with its content", () => {
        const { el } = mount(tiles("dot"), [["DEU", DEU, "0,0,0,0"]], [{ column: "Country", value: "DEU" }],
            e => Object.defineProperty(e, "scrollTop", { configurable: true, get: () => 300 }));
        expect(notes(el).map(at)).toEqual([[132, 408]]);           // on screen at (132, 108): 300 px down the content
    });

    it("listens for scrolls only while there are notes, and stops on destroy", () => {
        stubBoxes();
        const el = document.createElement("div");
        el.setAttribute("data-box", "0,0,400,200");
        document.body.appendChild(el);
        const onEl = { add: vi.spyOn(el, "addEventListener"), remove: vi.spyOn(el, "removeEventListener") };
        const onDoc = { add: vi.spyOn(document, "addEventListener"), remove: vi.spyOn(document, "removeEventListener") };
        const scrolls = (s: { mock: { calls: any[][] } }) => s.mock.calls.filter(c => c[0] === "scroll").length;
        const host = createChartHost(el, { code: SCROLLING, d3: {}, data: { columns: COLS, rows: rows() } as any } as any);
        host.render();
        expect(scrolls(onEl.add) + scrolls(onDoc.add)).toBe(0);
        host.setAnnotations(two);
        expect([scrolls(onEl.add), scrolls(onDoc.add)]).toEqual([1, 1]);
        host.setAnnotations([]);
        expect([scrolls(onEl.remove), scrolls(onDoc.remove)]).toEqual([1, 1]);
        host.setAnnotations(two);
        host.destroy();
        expect([scrolls(onEl.remove), scrolls(onDoc.remove)]).toEqual([2, 2]);
    });
});
