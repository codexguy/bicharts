import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { ensureCrossfilterHitTargets } from "../src/hitTargets";
import { createChartHost } from "../src/host";
import {
    MARK_CLASS, LEGEND_MARK_CLASS, AXIS_FILTER_CLASS, ROW_IDX_ATTR,
    SELECTION_ACTIVE_CLASS, ACTIVE_TICK_CLASS,
} from "../src/contract";

// A TAGGED MARK THAT CANNOT RECEIVE A CLICK IS NOT A MARK.
//
// Two codegen habits produce one symptom: the chart looks right, the element carries the
// class and the row index, and clicking it does nothing.
//
//   (a) the class on a bare <g> whose only painted children are pointer-events:none —
//       the canonical legend swatch, <g class=d3-legend-mark><rect pe:none/><text pe:none/></g>.
//       A click falls THROUGH the group and closest() never sees the class.
//   (b) the class on a painted element that is itself pointer-events:none.
//
// This bites hardest on FURNITURE — legend swatches and axis / group headers — because a
// chart tends to draw those as inert labels, and they are what a reader tries to click.
// Which is also why it is load-bearing for the axis-tick work: a tick that cannot be
// clicked cannot be marked as the active filter either.

let dom: JSDOM;
let doc: Document;
let container: any;

function svg(tag: string, attrs: Record<string, string> = {}) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", tag) as any;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

// jsdom implements neither getBBox nor layout, so both are supplied the way the browser
// would answer for the shapes below. Nothing else in the pass depends on layout.
function withBBox(el: any, box = { x: 0, y: 0, width: 40, height: 12 }) {
    el.getBBox = () => box;
    return el;
}

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><svg id='c'></svg></body></html>");
    doc = dom.window.document as any;
    container = doc.getElementById("c");
});

describe("inert <g> furniture gets a transparent hit rect", () => {
    it("fills a legend swatch whose children are all pointer-events:none", () => {
        const g = withBBox(svg("g", { class: LEGEND_MARK_CLASS, [ROW_IDX_ATTR]: "0,1" }));
        const r = svg("rect"); r.style.pointerEvents = "none";
        const t = svg("text"); t.style.pointerEvents = "none";
        g.appendChild(r); g.appendChild(t); container.appendChild(g);

        const rep = ensureCrossfilterHitTargets(container, doc);
        expect(rep.hitRects).toBe(1);
        const hit = g.querySelector('rect[data-lch-hit="1"]');
        expect(hit).not.toBeNull();
        // FIRST child, so it sits behind the real swatch and only fills the gaps + label.
        expect(g.firstChild).toBe(hit);
        expect(hit.getAttribute("fill")).toBe("transparent");
        expect(hit.getAttribute("width")).toBe("40");
    });

    it("fills an axis / group header the same way", () => {
        const g = withBBox(svg("g", { class: AXIS_FILTER_CLASS, [ROW_IDX_ATTR]: "2,3" }));
        const t = svg("text"); t.style.pointerEvents = "none";
        g.appendChild(t); container.appendChild(g);

        expect(ensureCrossfilterHitTargets(container, doc).hitRects).toBe(1);
    });

    it("is idempotent - a second pass adds nothing", () => {
        const g = withBBox(svg("g", { class: AXIS_FILTER_CLASS, [ROW_IDX_ATTR]: "2" }));
        g.appendChild(svg("text")); container.appendChild(g);
        ensureCrossfilterHitTargets(container, doc);
        expect(ensureCrossfilterHitTargets(container, doc).hitRects).toBe(0);
        expect(g.querySelectorAll('rect[data-lch-hit="1"]').length).toBe(1);
    });

    it("leaves a <g> with no row index of its own alone - it is a container, not a mark", () => {
        const g = withBBox(svg("g", { class: MARK_CLASS }));
        g.appendChild(svg("rect")); container.appendChild(g);
        expect(ensureCrossfilterHitTargets(container, doc).hitRects).toBe(0);
    });

    it("leaves a DATA mark group that already has a hittable child alone", () => {
        // Packed data marks: an oversized transparent rect would steal a neighbour's clicks,
        // so the pass stays strictly additive and only fills a group that is wholly inert.
        const g = withBBox(svg("g", { class: MARK_CLASS, [ROW_IDX_ATTR]: "0" }));
        g.appendChild(svg("rect"));           // no pointer-events:none -> already hittable
        container.appendChild(g);
        expect(ensureCrossfilterHitTargets(container, doc).hitRects).toBe(0);
    });

    it("skips a group with no measurable box", () => {
        const g = svg("g", { class: LEGEND_MARK_CLASS, [ROW_IDX_ATTR]: "0" });
        g.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
        container.appendChild(g);
        expect(ensureCrossfilterHitTargets(container, doc).hitRects).toBe(0);
    });
});

describe("a painted mark that is pointer-events:none is flipped", () => {
    it("a FILLED shape becomes 'all'", () => {
        const p = svg("path", { class: MARK_CLASS, [ROW_IDX_ATTR]: "0", fill: "#118dff" });
        p.style.pointerEvents = "none";
        container.appendChild(p);

        const rep = ensureCrossfilterHitTargets(container, doc);
        expect(rep.peFlips).toBe(1);
        expect(rep.peStrokeOnly).toBe(0);
        expect(p.style.pointerEvents).toBe("all");
    });

    it("an UNFILLED outline becomes 'stroke', never 'all'", () => {
        // 'all' hit-tests the fill REGION even when fill is none, so flipping an outline
        // to 'all' turns its whole interior into a hit surface that sits on top of the
        // marks it merely outlines and swallows their clicks. 'stroke' gives the outline
        // the clickability the flip exists for and invents no area the chart never painted.
        const p = svg("path", { class: MARK_CLASS, [ROW_IDX_ATTR]: "0", fill: "none" });
        p.style.pointerEvents = "none";
        container.appendChild(p);

        const rep = ensureCrossfilterHitTargets(container, doc);
        expect(rep.peStrokeOnly).toBe(1);
        expect(p.style.pointerEvents).toBe("stroke");
    });

    it("leaves an already-clickable painted mark untouched", () => {
        const p = svg("path", { class: MARK_CLASS, [ROW_IDX_ATTR]: "0", fill: "#118dff" });
        container.appendChild(p);
        expect(ensureCrossfilterHitTargets(container, doc).peFlips).toBe(0);
    });
});

describe("it cannot invent a target", () => {
    it("an UNtagged element is never made clickable", () => {
        const p = svg("path", { [ROW_IDX_ATTR]: "0", fill: "none" });
        p.style.pointerEvents = "none";
        container.appendChild(p);
        const rep = ensureCrossfilterHitTargets(container, doc);
        expect(rep.tagged).toBe(0);
        expect(p.style.pointerEvents).toBe("none");
    });

    it("survives a container that is not an element", () => {
        expect(ensureCrossfilterHitTargets(null).hitRects).toBe(0);
        expect(ensureCrossfilterHitTargets({} as any).hitRects).toBe(0);
    });
});

// WHAT DECIDES AN OUTLINE: WHAT THE ENGINE PAINTS (2026-09-25).
//
// Every browser engine maps the fill presentation attribute into computed style, so there the
// computed fill is what is painted - also when CSS overrides the attribute (either way), and with
// every spelling of transparent normalised. Reading the attribute first there contradicted the paint
// in five shapes, measured in headless Chromium: fill="rgba(0,0,0,0)" and fill="#0000" outlines were
// called filled (so they swallowed the clicks under them), a fill="red" outline whose CSS says
// fill:none likewise, and a fill="none" shape that CSS fills was called an outline (so its painted
// interior stopped taking clicks). jsdom maps no presentation attribute (an attribute-only fill
// computes as black), so there the attribute is still read first - the cases above.
describe("in an engine that maps presentation attributes, the computed fill decides", () => {
    // A computed style the way a browser answers it: an inline style beats a class rule beats the
    // attribute, and every colour is normalised.
    const CLASS_FILL: Record<string, string> = { cssfill: "steelblue", cssnone: "none" };
    const NORMAL: Record<string, string> = {
        none: "none", transparent: "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)": "rgba(0, 0, 0, 0)", "#0000": "rgba(0, 0, 0, 0)",
        red: "rgb(255, 0, 0)", steelblue: "rgb(70, 130, 180)", "#118dff": "rgb(17, 141, 255)",
    };
    let probes: number;
    const browserLike = (): { doc: Document; ctr: any } => {
        const d = new JSDOM("<!doctype html><html><body><svg id='c'></svg></body></html>");
        const w: any = d.window;
        probes = 0;
        w.getComputedStyle = (e: any) => {
            if (e.tagName === "rect" && e.parentNode?.tagName === "svg" && e.parentNode.parentNode === w.document.documentElement) probes++;
            const cls = String(e.getAttribute("class") || "").split(/\s+/).map((c: string) => CLASS_FILL[c]).find(Boolean);
            const raw = String(e.style.fill || cls || e.getAttribute("fill") || "black").trim().toLowerCase();
            return { pointerEvents: e.style.pointerEvents || "auto", fill: NORMAL[raw] ?? (raw === "black" ? "rgb(0, 0, 0)" : raw) };
        };
        return { doc: w.document, ctr: w.document.getElementById("c") };
    };
    const outline = (d: Document, attrs: Record<string, string>, style: Record<string, string> = {}) => {
        const p = d.createElementNS("http://www.w3.org/2000/svg", "path") as any;
        p.setAttribute("class", `${MARK_CLASS} ${attrs.class ?? ""}`.trim());
        p.setAttribute(ROW_IDX_ATTR, "0");
        for (const [k, v] of Object.entries(attrs)) if (k !== "class") p.setAttribute(k, v);
        for (const [k, v] of Object.entries(style)) p.style[k] = v;
        p.style.pointerEvents = "none";
        return p;
    };

    // Each shape, and the answer the paint gives - the same as the Power BI visual's computed read.
    const SHAPES: [string, Record<string, string>, Record<string, string>, "stroke" | "all"][] = [
        ['fill="none"', { fill: "none" }, {}, "stroke"],
        ['fill="transparent"', { fill: "transparent" }, {}, "stroke"],
        ['fill="rgba(0,0,0,0)"', { fill: "rgba(0,0,0,0)" }, {}, "stroke"],
        ['fill="#0000"', { fill: "#0000" }, {}, "stroke"],
        ['fill="none" that a CSS class fills', { fill: "none", class: "cssfill" }, {}, "all"],
        ['fill="red" with an inline fill:none', { fill: "red" }, { fill: "none" }, "stroke"],
        ['fill="red" with a CSS class fill:none', { fill: "red", class: "cssnone" }, {}, "stroke"],
        ["no attribute, a CSS class fill:none", { class: "cssnone" }, {}, "stroke"],
        ["no fill anywhere (painted black)", {}, {}, "all"],
        ['fill="#118dff"', { fill: "#118dff" }, {}, "all"],
    ];
    for (const [name, attrs, style, want] of SHAPES) {
        it(`${name} -> '${want}'`, () => {
            const { doc: d, ctr } = browserLike();
            const p = outline(d, attrs, style);
            ctr.appendChild(p);
            const rep = ensureCrossfilterHitTargets(ctr, d);
            expect(p.style.pointerEvents).toBe(want);
            expect(rep.peStrokeOnly).toBe(want === "stroke" ? 1 : 0);
        });
    }

    it("asks the engine once per document, leaves nothing behind, and only when something needs deciding", () => {
        const { doc: d, ctr } = browserLike();
        const drawn = outline(d, { fill: "#118dff" });
        drawn.style.pointerEvents = "";
        ctr.appendChild(drawn);
        ensureCrossfilterHitTargets(ctr, d);
        expect(probes, "nothing was pointer-events:none, so nothing was asked").toBe(0);
        ctr.appendChild(outline(d, { fill: "none" }));
        ctr.appendChild(outline(d, { fill: "red" }));
        ensureCrossfilterHitTargets(ctr, d);
        ensureCrossfilterHitTargets(ctr, d);
        expect(probes).toBe(1);
        expect(d.documentElement.children.length).toBe(2); // head and body, as before
    });

    it("jsdom maps nothing, so there the attribute is read first (an attribute-only outline is 'stroke')", () => {
        const p = svg("path", { class: MARK_CLASS, [ROW_IDX_ATTR]: "0", fill: "none" });
        p.style.pointerEvents = "none";
        container.appendChild(p);
        ensureCrossfilterHitTargets(container, doc);
        expect(p.style.pointerEvents).toBe("stroke");
        expect(doc.documentElement.children.length).toBe(2);
    });
});

describe("createChartHost runs it, so a tagged-but-inert tick still filters", () => {
    it("an inert axis header becomes clickable AND marks itself as the active filter", () => {
        const dom2 = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
        (globalThis as any).MouseEvent = dom2.window.MouseEvent;
        const ctr = dom2.window.document.getElementById("c") as any;
        const code = `
function render(container, data, options) {
  container.innerHTML = '';
  var NS = 'http://www.w3.org/2000/svg';
  var g = container.ownerDocument.createElementNS(NS, 'g');
  g.setAttribute('class', '${AXIS_FILTER_CLASS}');
  g.setAttribute('${ROW_IDX_ATTR}', '0,1');
  g.id = 'tick';
  var t = container.ownerDocument.createElementNS(NS, 'text');
  t.style.pointerEvents = 'none';
  g.appendChild(t);
  g.getBBox = function () { return { x: 0, y: 0, width: 60, height: 14 }; };
  container.appendChild(g);
}`;
        const h = createChartHost(ctr, {
            code,
            data: { columns: [{ name: "P" }, { name: "__rowIdx__" }], rows: [["a", 0], ["b", 1]] } as any,
            d3: {},
        });
        h.render();

        const tick = ctr.querySelector("#tick");
        // The host healed it on the way out of render()...
        expect(tick.querySelector('rect[data-lch-hit="1"]')).not.toBeNull();
        // ...so the click the reader makes on the injected rect resolves to the tick.
        tick.querySelector('rect[data-lch-hit="1"]')
            .dispatchEvent(new dom2.window.MouseEvent("click", { bubbles: true }));
        expect(h.selection.current).toEqual([0, 1]);
        expect(ctr.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(tick.classList.contains(ACTIVE_TICK_CLASS)).toBe(true);
        h.destroy();
    });
});

