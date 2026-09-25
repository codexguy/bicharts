// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
    collectD3GlyphCenters, clearSelectionGlyphs, paintSelectionGlyphs, rowIdxsFromMark, createMarkResolver,
    SELECTION_GLYPH_CLASS,
} from "../src/index";

// WHERE A SELECTED MARK'S GLYPH GOES, AND WHAT IS PAINTED (2026-09-25).
//
// Moved verbatim from the Power BI visual, which runs the same table against its own copy and this
// one before it switches over. jsdom has no SVG layout, so each mark reports the geometry a browser
// would: its client rect, and for a path its length, points along it and its screen matrix. The
// cases cover a plain mark, a mark inside a <g>, a mark under a painted overlay, a mark whose children
// are all pointer-events:none, a mark reachable only by geometry, and every placement branch.

const NS = "http://www.w3.org/2000/svg";
const BASE = { left: 10, top: 5 } as DOMRect;

type Box = { x: number; y: number; w: number; h: number };
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

class Point {
    constructor(public x = 0, public y = 0) {}
    matrixTransform(m: Matrix) { return new Point(m.a * this.x + m.c * this.y + m.e, m.b * this.x + m.d * this.y + m.f); }
}
(globalThis as any).DOMPoint = Point;
afterEach(() => { document.body.innerHTML = ""; });

function clientRect(b: Box) {
    return { left: b.x, top: b.y, width: b.w, height: b.h, right: b.x + b.w, bottom: b.y + b.h, x: b.x, y: b.y } as DOMRect;
}

function mark(parent: Element, tag: string, box: Box, attrs: Record<string, string> = {}, selected = true): SVGElement {
    const el = document.createElementNS(NS, tag) as SVGElement;
    el.setAttribute("class", selected ? "d3-mark lch-mark-selected" : "d3-mark");
    el.setAttribute("data-row-idx", "0");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    (el as any).getBoundingClientRect = () => clientRect(box);
    parent.appendChild(el);
    return el;
}

function pathGeometry(el: Element, pts: [number, number][], ctm: Matrix, inFill: ((p: Point) => boolean) | null = null) {
    const segs = pts.slice(1).map((p, i) => ({ a: pts[i], b: p, len: Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]) }));
    const total = segs.reduce((s, g) => s + g.len, 0);
    (el as any).getTotalLength = () => total;
    (el as any).getPointAtLength = (d: number) => {
        let left = d;
        for (const g of segs) {
            if (left <= g.len) { const t = g.len ? left / g.len : 0; return new Point(g.a[0] + t * (g.b[0] - g.a[0]), g.a[1] + t * (g.b[1] - g.a[1])); }
            left -= g.len;
        }
        const last = pts[pts.length - 1];
        return new Point(last[0], last[1]);
    };
    (el as any).getScreenCTM = () => ctm;
    if (inFill) (el as any).isPointInFill = inFill;
}

function scene(): { container: HTMLDivElement; svg: SVGSVGElement } {
    const container = document.createElement("div");
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    container.appendChild(svg);
    document.body.appendChild(container);
    return { container, svg };
}

const SHIFT: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 50, f: 20 };

const CASES: { name: string; build: (svg: SVGSVGElement) => void; want: { x: number; y: number }[] }[] = [
    {
        name: "a plain rect: the upper-right inset, clear of a centred label",
        build: svg => { mark(svg, "rect", { x: 100, y: 50, w: 40, h: 20 }); },
        want: [{ x: 100 + 32 - 10, y: 50 + 4 - 5 }],
    },
    {
        name: "a plain circle: its box centre",
        build: svg => { mark(svg, "circle", { x: 100, y: 50, w: 10, h: 10 }); },
        want: [{ x: 95, y: 50 }],
    },
    {
        name: "a mark inside a <g>: the group is the mark, and its box centre is the glyph",
        build: svg => {
            const g = mark(svg, "g", { x: 20, y: 30, w: 60, h: 40 });
            const r = document.createElementNS(NS, "rect");
            g.appendChild(r);
        },
        want: [{ x: 40, y: 45 }],
    },
    {
        name: "a mark whose children are all pointer-events:none: placed by its box all the same",
        build: svg => {
            const g = mark(svg, "g", { x: 0, y: 0, w: 30, h: 10 });
            for (const t of ["rect", "text"]) {
                const c = document.createElementNS(NS, t) as SVGElement;
                c.style.pointerEvents = "none";
                g.appendChild(c);
            }
        },
        want: [{ x: 5, y: 0 }],
    },
    {
        name: "a mark under a painted overlay: the overlay is not a mark and moves nothing",
        build: svg => {
            mark(svg, "rect", { x: 100, y: 50, w: 40, h: 20 });
            const overlay = document.createElementNS(NS, "rect");
            overlay.setAttribute("fill", "transparent");
            (overlay as any).getBoundingClientRect = () => clientRect({ x: 0, y: 0, w: 500, h: 300 });
            svg.appendChild(overlay);
        },
        want: [{ x: 122, y: 49 }],
    },
    {
        name: "a mark reachable only by geometry (pointer-events:none itself): placed by its box",
        build: svg => {
            const r = mark(svg, "rect", { x: 10, y: 10, w: 100, h: 50 });
            r.style.pointerEvents = "none";
        },
        want: [{ x: 10 + 80 - 10, y: 10 + 10 - 5 }],
    },
    {
        name: "an unselected mark gets no glyph",
        build: svg => { mark(svg, "rect", { x: 100, y: 50, w: 40, h: 20 }, {}, false); },
        want: [],
    },
    {
        name: "a zero-size mark gets no glyph",
        build: svg => { mark(svg, "rect", { x: 100, y: 50, w: 0, h: 0 }); },
        want: [],
    },
    {
        name: "a curve: its midpoint along the path, through its screen matrix",
        build: svg => {
            const p = mark(svg, "path", { x: 0, y: 0, w: 100, h: 100 }, { d: "M0,0 C10,10 20,10 40,0" });
            pathGeometry(p, [[0, 0], [40, 0]], SHIFT);
        },
        want: [{ x: 20 + 50 - 10, y: 0 + 20 - 5 }],
    },
    {
        name: "an arc sector: the centroid of its outline when it lands in the fill",
        build: svg => {
            const p = mark(svg, "path", { x: 0, y: 0, w: 100, h: 100 }, { d: "M0,0 A10,10 0 0 1 10,0 L0,0 Z" });
            pathGeometry(p, [[0, 0], [24, 0], [24, 24], [0, 24], [0, 0]], SHIFT, () => true);
        },
        // 24 samples of a 96-long square outline, one every 4 from a corner: the mean is (12, 12).
        want: [{ x: 12 + 50 - 10, y: 12 + 20 - 5 }],
    },
    {
        name: "an arc sector whose centroid falls in the hole: the midpoint instead",
        build: svg => {
            const p = mark(svg, "path", { x: 0, y: 0, w: 100, h: 100 }, { d: "M0,0 A10,10 0 1 1 0,1 Z" });
            pathGeometry(p, [[0, 0], [24, 0], [24, 24], [0, 24], [0, 0]], SHIFT, () => false);
        },
        want: [{ x: 24 + 50 - 10, y: 24 + 20 - 5 }],
    },
    {
        name: "an explicit data-cx/data-cy anchor wins over the shape's own centre",
        build: svg => {
            const p = mark(svg, "path", { x: 0, y: 0, w: 100, h: 100 }, { "data-cx": "7", "data-cy": "3", d: "M0,0 C1,1 2,2 3,3" });
            pathGeometry(p, [[0, 0], [40, 0]], { a: 2, b: 0, c: 0, d: 2, e: 100, f: 10 });
        },
        want: [{ x: 14 + 100 - 10, y: 6 + 10 - 5 }],
    },
    {
        name: "a hierarchy's backdrop enclosing a selected leaf: only the leaf gets the glyph",
        build: svg => {
            mark(svg, "rect", { x: 0, y: 0, w: 200, h: 100 });
            mark(svg, "rect", { x: 10, y: 10, w: 50, h: 20 });
        },
        want: [{ x: 10 + 40 - 10, y: 10 + 4 - 5 }],
    },
    {
        name: "above 300 selected marks the backdrop test is skipped, so the backdrop keeps its glyph",
        build: svg => {
            mark(svg, "rect", { x: 0, y: 0, w: 1000, h: 1000 });
            for (let i = 0; i < 300; i++) mark(svg, "rect", { x: 1 + i * 3, y: 1, w: 2, h: 2 });
        },
        want: [{ x: 800 - 10, y: 200 - 5 }, ...Array.from({ length: 300 }, (_, i) => ({ x: 1 + i * 3 + 1.6 - 10, y: 1 + 0.4 - 5 }))],
    },
];

describe("collectD3GlyphCenters", () => {
    for (const c of CASES) {
        it(c.name, () => {
            const { container, svg } = scene();
            c.build(svg);
            const got: { x: number; y: number }[] = [];
            collectD3GlyphCenters(container, BASE, got);
            expect(got.length).toBe(c.want.length);
            got.forEach((p, i) => {
                expect(p.x).toBeCloseTo(c.want[i].x, 6);
                expect(p.y).toBeCloseTo(c.want[i].y, 6);
            });
        });
    }
});

describe("paintSelectionGlyphs and clearSelectionGlyphs", () => {
    it("paints one span per centre, positioned from the overlay's corner and never hit-tested", () => {
        const overlay = document.createElement("div");
        document.body.appendChild(overlay);
        const n = paintSelectionGlyphs(overlay, [{ x: 122, y: 49 }, { x: 3, y: 4 }], { symbol: "S", color: "#111", halo: "#fff" });
        expect(n).toBe(2);
        const spans = Array.from(overlay.querySelectorAll("span"));
        expect(spans.map(s => s.className)).toEqual([SELECTION_GLYPH_CLASS, SELECTION_GLYPH_CLASS]);
        expect(spans.map(s => s.textContent)).toEqual(["S", "S"]);
        expect(spans[0].style.left).toBe("122px");
        expect(spans[0].style.top).toBe("49px");
        expect(spans[0].style.position).toBe("absolute");
        expect(spans[0].style.pointerEvents).toBe("none");
        expect(spans[0].style.color).toBe("rgb(17, 17, 17)");
    });

    it("draws at most 600 by default, or the max it is given", () => {
        const overlay = document.createElement("div");
        const centers = Array.from({ length: 650 }, (_, i) => ({ x: i, y: 0 }));
        expect(paintSelectionGlyphs(overlay, centers, { symbol: "S", color: "#111", halo: "#fff" })).toBe(600);
        clearSelectionGlyphs(overlay);
        expect(paintSelectionGlyphs(overlay, centers, { symbol: "S", color: "#111", halo: "#fff", max: 5 })).toBe(5);
        expect(overlay.childNodes.length).toBe(5);
    });

    it("does not clear first; clearing removes every child, and a missing overlay is a no-op", () => {
        const overlay = document.createElement("div");
        paintSelectionGlyphs(overlay, [{ x: 1, y: 1 }], { symbol: "S", color: "#111", halo: "#fff" });
        paintSelectionGlyphs(overlay, [{ x: 2, y: 2 }], { symbol: "S", color: "#111", halo: "#fff" });
        expect(overlay.childNodes.length).toBe(2);
        clearSelectionGlyphs(overlay);
        expect(overlay.childNodes.length).toBe(0);
        expect(() => clearSelectionGlyphs(null)).not.toThrow();
    });
});

describe("rowIdxsFromMark", () => {
    const el = (v: string | null) => {
        const e = document.createElementNS(NS, "rect");
        if (v !== null) e.setAttribute("data-row-idx", v);
        return e;
    };
    it("reads a comma list of non-negative whole numbers, skipping anything else", () => {
        expect(rowIdxsFromMark(el("3"))).toEqual([3]);
        expect(rowIdxsFromMark(el("3, 7 ,12"))).toEqual([3, 7, 12]);
        expect(rowIdxsFromMark(el("1,x,-1,2.9"))).toEqual([1, 2]);
        expect(rowIdxsFromMark(el(""))).toEqual([]);
        expect(rowIdxsFromMark(el(null))).toEqual([]);
        expect(rowIdxsFromMark(null)).toEqual([]);
    });
    it("is the resolver's own reader", () => {
        const root = document.createElement("div");
        const r = createMarkResolver({ root, doc: document, log: () => {} });
        expect(r.rowIdxsFromMark).toBe(rowIdxsFromMark);
    });
});
