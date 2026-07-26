// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createMarkResolver, MarkResolver } from "../src/selection";

// The generic mark-resolution core moved VERBATIM from the visual's own bridge
// (Phase C). These tests lock the DOM-computable behaviors under jsdom; the SVG-
// geometry paths (getTotalLength/getScreenCTM for corridor refinement) and
// elementsFromPoint (overlay penetration) are browser-only — the code try/catch-
// wraps both, and the tests here pin that they DEGRADE to the pre-refactor
// fallbacks (return the plain mark / null) instead of throwing. Full-fidelity
// corridor/overlay behavior rides the real-browser interactive harness.

let root: HTMLElement;
let logs: Array<{ tag: string; data: any }>;
let R: MarkResolver;

beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    logs = [];
    R = createMarkResolver({ root, doc: document, log: (tag, data) => logs.push({ tag, data }) });
});

const el = (html: string): Element => {
    const host = document.createElement("div");
    host.innerHTML = html.trim();
    const node = host.firstElementChild!;
    root.appendChild(node);
    return node;
};

describe("rowIdxsFromMark — exact bridge semantics", () => {
    it("parses comma-joined idxs, trims, drops NaN and negatives", () => {
        const m = el(`<div class="d3-mark" data-row-idx=" 3, 7 ,x,-1,0"></div>`);
        expect(R.rowIdxsFromMark(m)).toEqual([3, 7, 0]);
        expect(R.rowIdxsFromMark(null)).toEqual([]);
        expect(R.rowIdxsFromMark(el(`<div class="d3-mark"></div>`))).toEqual([]);
    });
});

describe("isInvisibleStrokePath — invisible-corridor predicate", () => {
    const svgPath = (attrs: string): Element => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.innerHTML = `<path ${attrs} />`;
        root.appendChild(svg);
        return svg.firstElementChild!;
    };
    it("matches transparent/none-stroke unfilled paths only", () => {
        expect(R.isInvisibleStrokePath(svgPath(`stroke="transparent"`))).toBe(true);
        expect(R.isInvisibleStrokePath(svgPath(`fill="none" stroke="none"`))).toBe(true);
        expect(R.isInvisibleStrokePath(svgPath(`stroke="red" stroke-opacity="0.005"`))).toBe(true);
        expect(R.isInvisibleStrokePath(svgPath(`fill="#123" stroke="transparent"`))).toBe(false); // painted fill
        expect(R.isInvisibleStrokePath(svgPath(`stroke="red"`))).toBe(false);                      // visible stroke
        expect(R.isInvisibleStrokePath(el(`<div></div>`))).toBe(false);                            // not a path
    });
});

describe("findMark — closest() resolution across wrappers", () => {
    it("resolves an inner shape up to its .d3-mark group", () => {
        const g = el(`<div class="d3-mark" data-row-idx="4"><span id="inner">x</span></div>`);
        const inner = g.querySelector("#inner")!;
        expect(R.findMark(inner)).toBe(g);
        expect(R.findMark(inner, ".d3-mark, .d3-legend-mark, .d3-axis-filter")).toBe(g);
        expect(R.findMark(null)).toBeNull();
        expect(R.findMark(document.body)).toBeNull(); // body matches nothing
    });
    it("with event coords, corridor refinement degrades to the plain mark under jsdom", () => {
        const g = el(`<div class="d3-mark" data-row-idx="1"><span id="i2">x</span></div>`);
        const ev = new MouseEvent("click", { clientX: 10, clientY: 10 });
        // Non-path mark -> refineHitCorridor returns it untouched; no throw, no log.
        expect(R.findMark(g.querySelector("#i2")!, ".d3-mark", ev)).toBe(g);
        expect(logs.length).toBe(0);
    });
});

describe("penetrateOverlayAt — jsdom degradation", () => {
    it("returns null (never throws) where elementsFromPoint is unavailable", () => {
        el(`<div class="d3-mark" data-row-idx="0"></div>`);
        expect(R.penetrateOverlayAt(5, 5, ".d3-mark")).toBeNull();
    });
});

describe("resolveByGeometry — smallest containing box + unclickability guard", () => {
    const boxed = (cls: string, idx: string, rect: { left: number; top: number; width: number; height: number }) => {
        const m = el(`<div class="${cls}" data-row-idx="${idx}"></div>`) as HTMLElement;
        (m as any).getBoundingClientRect = () => ({
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}),
        });
        return m;
    };
    it("picks the SMALLEST box containing the point and logs geom-resolved", () => {
        boxed("d3-mark", "0", { left: 0, top: 0, width: 500, height: 500 });      // big row
        const small = boxed("d3-mark", "7", { left: 40, top: 40, width: 60, height: 20 }); // specific cell
        const got = R.resolveByGeometry(50, 50, ".d3-mark");
        expect(got).toBe(small);
        expect(logs.some(l => l.tag === "d3_click-geom-resolved")).toBe(true);
    });
    it("misses when the point is outside every box", () => {
        boxed("d3-mark", "0", { left: 0, top: 0, width: 10, height: 10 });
        expect(R.resolveByGeometry(500, 500, ".d3-mark")).toBeNull();
    });
    it("ignores marks without data-row-idx", () => {
        const m = el(`<div class="d3-mark"></div>`) as HTMLElement;
        (m as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
        expect(R.resolveByGeometry(5, 5, ".d3-mark")).toBeNull();
    });
});
