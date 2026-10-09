// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installLasso, clearLasso, lassoVerdict, lassoRowCap, lassoActions, registerLassoAction, pointInShape,
    LASSO_ROW_CAP, LASSO_DRAG_PX, LASSO_SAMPLE_PX, LASSO_EVENT, LASSO_AXES_SLOT, LASSO_MODE_ATTR,
    type LassoEnv, type LassoEventDetail, type LassoHandle,
} from "../src/lasso";
import { DRAG_NOT_CLICK_PX } from "../src/selection";
import * as main from "../src/index";

// THE HOST LASSO (2026-10-09). jsdom lays nothing out, so every mark names its own client box in data-box, and
// the box of the surface the lasso adds is derived from the plot it sits in (clientOrigin below).
//
// The plot: an svg at client (10,20) holding a group translated (40,30), so the plot's origin is client
// (50,50) and the surface covers 300x200 from there. A mark's centre is its local position + (50,50).

const SVGNS = "http://www.w3.org/2000/svg";
type M = { row: number; cx: number; cy: number; box?: string };

const MARKS: M[] = [
    { row: 0, cx: 50, cy: 50 }, { row: 1, cx: 100, cy: 50 }, { row: 2, cx: 150, cy: 50 },
    { row: 3, cx: 50, cy: 150 }, { row: 4, cx: 100, cy: 150 }, { row: 5, cx: 250, cy: 100 },
];
// Client points. A lasso around rows 0, 1 and 2 (their centres are (100,100), (150,100), (200,100)).
const AROUND_012: Array<[number, number]> = [[80, 80], [230, 80], [230, 130], [80, 130]];
// ... around rows 3 and 4 (centres (100,200), (150,200)).
const AROUND_34: Array<[number, number]> = [[80, 180], [180, 180], [180, 230], [80, 230]];

function clientOrigin(node: Element | null): { x: number; y: number } {
    let x = 0, y = 0;
    for (let p = node; p; p = p.parentElement) {
        const t = p.getAttribute("transform");
        const m = t && /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(t);
        if (m) { x += +m[1]; y += +m[2]; }
        if (p.tagName.toLowerCase() === "svg") {
            const b = (p.getAttribute("data-box") || "0,0,0,0").split(",").map(Number);
            x += b[0]; y += b[1];
            break;
        }
    }
    return { x, y };
}

function stubLayout() {
    const orig = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const mk = (l: number, t: number, w: number, h: number) =>
            ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;
        if (this.classList?.contains("lch-lasso-surface")) {
            const o = clientOrigin(this.parentElement);
            const n = (a: string) => parseFloat(this.getAttribute(a) || "0");
            return mk(o.x + n("x"), o.y + n("y"), n("width"), n("height"));
        }
        const box = this.getAttribute?.("data-box");
        if (box) { const [l, t, w, h] = box.split(",").map(Number); return mk(l, t, w, h); }
        return orig.call(this);
    });
    (window as any).SVGElement.prototype.getBBox = function (this: Element) {
        const b = (this.getAttribute("data-bbox") || "0,0,0,0").split(",").map(Number);
        return { x: b[0], y: b[1], width: b[2], height: b[3] };
    };
}

function el(name: string, attrs: Record<string, string> = {}): SVGElement {
    const e = document.createElementNS(SVGNS, name) as SVGElement;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
}

function draw(container: HTMLElement, marks: M[] = MARKS, opts: { plot?: boolean } = {}) {
    const svg = el("svg", { "data-box": "10,20,400,300", viewBox: "0 0 400 300" });
    let host: Element = svg;
    if (opts.plot !== false) {
        host = el("g", { class: "lch-plot", transform: "translate(40,30)", "data-bbox": "0,0,300,200" });
        svg.appendChild(host);
    }
    const o = clientOrigin(host);
    for (const m of marks) {
        host.appendChild(el("circle", {
            class: "d3-mark", "data-row-idx": String(m.row), cx: String(m.cx), cy: String(m.cy), r: "3",
            "data-box": m.box ?? `${o.x + m.cx - 3},${o.y + m.cy - 3},6,6`,
        }));
    }
    container.appendChild(svg);
    return { svg, host };
}

const ptr = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: type === "click" ? 1 : 0, ...extra });
    Object.defineProperty(e, "pointerId", { value: 1 });
    Object.defineProperty(e, "isPrimary", { value: extra.isPrimary ?? true });
    return e;
};

describe("pointInShape", () => {
    const sq = { mode: "free" as const, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    const ell = { mode: "free" as const, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }] };

    it("inside, outside, and the bounding box rejects first", () => {
        expect(pointInShape(sq, 5, 5)).toBe(true);
        expect(pointInShape(sq, 11, 5)).toBe(false);
        expect(pointInShape(sq, -1, 5)).toBe(false);
    });

    it("a concave polygon's notch is outside", () => {
        expect(pointInShape(ell, 2, 8)).toBe(true);
        expect(pointInShape(ell, 8, 2)).toBe(true);
        expect(pointInShape(ell, 8, 8)).toBe(false);     // in the bounding box, in the notch
    });

    it("a rectangle is the rectangle test, whatever order its corners come in", () => {
        const r = { mode: "rect" as const, pts: [{ x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }] };
        expect(pointInShape(r, 9.9, 0.1)).toBe(true);
        expect(pointInShape(r, 10.1, 5)).toBe(false);
    });

    it("fewer than three vertices is nothing", () => {
        expect(pointInShape({ mode: "free", pts: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, 2, 2)).toBe(false);
    });
});

describe("the constants and the setting", () => {
    it("the cap is 5,000 and the thresholds are the shared ones", () => {
        expect(LASSO_ROW_CAP).toBe(5000);
        expect(LASSO_DRAG_PX).toBe(5);
        expect(LASSO_DRAG_PX).toBe(DRAG_NOT_CLICK_PX);
        expect(LASSO_SAMPLE_PX).toBe(3);
    });

    it("a chart gets a lasso only when it is capable AND the reader's setting is not off AND the rows fit", () => {
        expect(lassoVerdict(undefined, 10)).toBe("not-capable");
        expect(lassoVerdict({}, 10)).toBe("not-capable");
        expect(lassoVerdict({ enabled: true }, 10)).toBe("not-capable");          // absent capable means NOT capable
        expect(lassoVerdict({ capable: false }, 10)).toBe("not-capable");
        expect(lassoVerdict({ capable: true }, 10)).toBe("on");                    // enabled defaults on
        expect(lassoVerdict({ capable: true, enabled: true }, 10)).toBe("on");
        expect(lassoVerdict({ capable: true, enabled: false }, 10)).toBe("disabled");
        expect(lassoVerdict({ capable: true }, LASSO_ROW_CAP)).toBe("on");
        expect(lassoVerdict({ capable: true }, LASSO_ROW_CAP + 1)).toBe("over-cap");
        expect(lassoVerdict({ capable: true, enabled: false }, LASSO_ROW_CAP + 1)).toBe("disabled");
    });

    it("a host's own cap replaces the default; junk falls back", () => {
        expect(lassoRowCap({ rowCap: 800 })).toBe(800);
        expect(lassoVerdict({ capable: true, rowCap: 800 }, 801)).toBe("over-cap");
        for (const v of [0, -5, NaN, "x", null, undefined, Infinity]) expect(lassoRowCap({ rowCap: v as any })).toBe(v === Infinity ? LASSO_ROW_CAP : LASSO_ROW_CAP);
    });

    it("the action list defaults to select, and anything that is not a list of names is the default", () => {
        expect(lassoActions(undefined)).toEqual(["select"]);
        expect(lassoActions({ actions: "select" as any })).toEqual(["select"]);
        expect(lassoActions({ actions: ["select", " explain ", "select", "", 7 as any] })).toEqual(["select", "explain"]);
        expect(lassoActions({ actions: [] })).toEqual([]);
    });

    it("is on the package entry", () => {
        expect(main.installLasso).toBe(installLasso);
        expect(main.LASSO_ROW_CAP).toBe(5000);
        expect(main.clearLasso).toBe(clearLasso);
    });
});

describe("the host lasso", () => {
    let container: HTMLElement;
    let handle: LassoHandle | null;
    let selected: number[][];
    let cleared: number;
    let events: LassoEventDetail[];
    let order: string[];
    let uiWrites: any[];
    let options: any;
    let rows: number;

    beforeEach(() => {
        stubLayout();
        container = document.createElement("div");
        document.body.appendChild(container);
        selected = []; cleared = 0; events = []; order = []; uiWrites = []; handle = null; rows = MARKS.length;
        options = {
            lasso: { capable: true }, themeFg: "#222", themeAccent: "#06c", cultureCode: "en-US",
            uiState: { frame: 3, knobs: { rate: 0.05 } },
            setUiState: (s: any) => { uiWrites.push(JSON.parse(JSON.stringify(s))); },
        };
        container.addEventListener(LASSO_EVENT, e => { events.push((e as CustomEvent).detail); order.push("event"); });
    });
    afterEach(() => { handle?.destroy(); container.remove(); vi.restoreAllMocks(); });

    const env = (): LassoEnv => ({
        container, options: () => options, rows,
        select: r => { selected.push(r.slice()); order.push("select"); },
        clearSelection: () => { cleared++; order.push("clear"); },
    });
    const install = () => (handle = installLasso(env()));
    const surface = () => container.querySelector(".lch-lasso-surface") as Element;
    const outline = () => container.querySelector(".lch-lasso-outline") as Element;
    const mark = (row: number) => container.querySelector(`.d3-mark[data-row-idx="${row}"]`) as Element;

    // A drag: press, move through the points, release at the last one; the click that follows lands on the
    // surface because the surface holds the pointer capture.
    function drag(path: Array<[number, number]>, extra: Record<string, unknown> = {}, target: Element = surface(), click = true) {
        target.dispatchEvent(ptr("pointerdown", path[0][0], path[0][1], extra));
        for (const [x, y] of path.slice(1)) surface().dispatchEvent(ptr("pointermove", x, y, extra));
        const last = path[path.length - 1];
        surface().dispatchEvent(ptr("pointerup", last[0], last[1], extra));
        if (click) surface().dispatchEvent(ptr("click", last[0], last[1], extra));
    }
    // A click: the press, the release and the click it makes, on the surface.
    function tap(x: number, y: number, extra: Record<string, unknown> = {}) {
        surface().dispatchEvent(ptr("pointerdown", x, y, extra));
        surface().dispatchEvent(ptr("pointerup", x, y, extra));
        surface().dispatchEvent(ptr("click", x, y, extra));
    }
    // The shape path: the start, the corners, back to the start.
    const loop = (pts: Array<[number, number]>): Array<[number, number]> => [...pts, pts[0]];

    describe("what gets a surface", () => {
        it("a capable chart gets one: a transparent control rect, never a mark, below the marks in the plot group", () => {
            const { host } = draw(container); install();
            const s = surface();
            expect(s).toBeTruthy();
            expect(s.classList.contains("lch-control")).toBe(true);
            expect(s.classList.contains("d3-mark")).toBe(false);
            expect(s.hasAttribute("data-row-idx")).toBe(false);
            expect(s.getAttribute("fill")).toBe("transparent");
            expect(s.getAttribute("tabindex")).toBe("0");
            expect((s as SVGElement).style.cursor).toBe("crosshair");
            expect((s as SVGElement).style.touchAction).toBe("none");
            expect(host.firstElementChild).toBe(s);                                  // below every mark
            expect(s.compareDocumentPosition(mark(0)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect([s.getAttribute("x"), s.getAttribute("y"), s.getAttribute("width"), s.getAttribute("height")]).toEqual(["0", "0", "300", "200"]);
        });

        it("the outline is a path that takes no pointer events", () => {
            draw(container); install();
            expect(outline().tagName.toLowerCase()).toBe("path");
            expect(outline().getAttribute("pointer-events")).toBe("none");
            expect(container.querySelector(".lch-lasso-count")!.getAttribute("pointer-events")).toBe("none");
        });

        it("with no plot group the surface covers the chart's own svg", () => {
            const { svg } = draw(container, MARKS, { plot: false }); install();
            expect(surface().parentElement).toBe(svg);
            expect(surface().getAttribute("width")).toBe("400");
            expect(surface().getAttribute("height")).toBe("300");
        });

        it("a chart that is not capable gets nothing, and no caption", () => {
            draw(container);
            for (const lasso of [undefined, {}, { capable: false }, { enabled: true }]) {
                options.lasso = lasso;
                expect(install()).toBeNull();
                expect(surface()).toBeNull();
                expect(container.querySelector(".lch-lasso-note")).toBeNull();
            }
        });

        it("the reader's setting off removes it from every chart, with no caption", () => {
            draw(container); options.lasso = { capable: true, enabled: false };
            expect(install()).toBeNull();
            expect(surface()).toBeNull();
            expect(container.querySelector(".lch-lasso-note")).toBeNull();
        });

        it("over the cap the whole lasso is off: no surface, and one caption saying why", () => {
            draw(container); rows = LASSO_ROW_CAP + 1; install();
            expect(surface()).toBeNull();
            const note = container.querySelector(".lch-lasso-note")!;
            expect(note).toBeTruthy();
            expect(note.textContent).toMatch(/off/i);
            expect(note.textContent).toContain("5,001");
            expect(note.textContent).toContain("5,000");
            expect(note.textContent).not.toContain("\n");
            expect((note as HTMLElement).style.pointerEvents).toBe("none");
            handle!.destroy();
            expect(container.querySelector(".lch-lasso-note")).toBeNull();
        });

        it("at exactly the cap it is on", () => {
            draw(container); rows = LASSO_ROW_CAP; install();
            expect(surface()).toBeTruthy();
            expect(container.querySelector(".lch-lasso-note")).toBeNull();
        });

        it("a host's own cap is the cap", () => {
            draw(container); options.lasso = { capable: true, rowCap: 4 }; rows = 5; install();
            expect(surface()).toBeNull();
            expect(container.querySelector(".lch-lasso-note")!.textContent).toContain("limit 4");
        });

        it("installing again replaces the first: one surface, and the old listeners are gone", () => {
            draw(container); install(); const first = handle!; install();
            expect(container.querySelectorAll(".lch-lasso-surface").length).toBe(1);
            expect(handle).not.toBe(first);
            drag(loop(AROUND_012));
            expect(selected.length).toBe(1);                                         // not twice
        });

        it("destroy takes away what it drew and stops listening", () => {
            draw(container); install();
            handle!.destroy();
            expect(container.querySelector(".lch-lasso-surface, .lch-lasso-outline, .lch-lasso-count")).toBeNull();
            container.dispatchEvent(ptr("pointerdown", 80, 80));
            document.dispatchEvent(ptr("pointermove", 230, 80));
            expect(selected).toEqual([]);
        });

        it("a chart with nothing to draw on gets nothing", () => {
            container.innerHTML = "<div>no svg here</div>";
            expect(install()).toBeNull();
        });
    });

    describe("the gesture", () => {
        beforeEach(() => { draw(container); install(); });

        it("a drag around three marks selects exactly those rows, through the host's own selection", () => {
            drag(loop(AROUND_012));
            expect(selected).toEqual([[0, 1, 2]]);
        });

        it("a mark is in when the CENTRE of its box is inside, not when the box touches", () => {
            container.innerHTML = ""; handle!.destroy();
            // Row 6's box (225..265) overlaps the lasso (right edge 230) but its centre (245) is outside it.
            // Row 7's box is mostly outside (206..240) but its centre (223) is inside.
            draw(container, [...MARKS, { row: 6, cx: 195, cy: 55, box: "225,90,40,20" }, { row: 7, cx: 173, cy: 55, box: "206,90,34,20" }]);
            install();
            drag(loop(AROUND_012));
            expect(selected).toEqual([[0, 1, 2, 7]]);
        });

        it("a mark with more than one row brings them all", () => {
            container.innerHTML = ""; handle!.destroy();
            draw(container, [{ row: 0, cx: 50, cy: 50 }, { row: 9, cx: 100, cy: 50 }]);
            mark(9).setAttribute("data-row-idx", "9,10,11");
            install();
            drag(loop(AROUND_012));
            expect(selected).toEqual([[0, 9, 10, 11]]);
        });

        it("a mark the chart has hidden is not part of what was drawn around", () => {
            (mark(1) as SVGElement).style.visibility = "hidden";
            drag(loop(AROUND_012));
            expect(selected).toEqual([[0, 2]]);
        });

        it("a freeform shape follows the path: a concave notch leaves a mark out", () => {
            // An L around row 0 (100,100) and row 2 (200,100), with the notch where row 1 (150,100) sits.
            drag(loop([[80, 80], [230, 80], [230, 130], [170, 130], [170, 95], [130, 95], [130, 130], [80, 130]]));
            expect(selected).toEqual([[0, 2]]);
        });

        it("a press-and-release under 5px is a click, not a lasso", () => {
            surface().dispatchEvent(ptr("pointerdown", 100, 100));
            surface().dispatchEvent(ptr("pointermove", 103, 102));
            surface().dispatchEvent(ptr("pointermove", 100, 104));
            surface().dispatchEvent(ptr("pointerup", 100, 104));
            expect(selected).toEqual([]);
            expect(events).toEqual([]);
            expect(outline().getAttribute("d")).toBe("");
        });

        it("5px on either axis starts the drag", () => {
            surface().dispatchEvent(ptr("pointerdown", 100, 100));
            surface().dispatchEvent(ptr("pointermove", 100, 104));
            expect(outline().getAttribute("d")).toBe("");
            surface().dispatchEvent(ptr("pointermove", 100, 105));
            expect(outline().getAttribute("d")).not.toBe("");
        });

        it("nothing is selected or announced while the pointer is still down", () => {
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 130));
            expect(selected).toEqual([]);
            expect(events).toEqual([]);
            expect(uiWrites).toEqual([]);
            expect(outline().getAttribute("d")).toMatch(/^M/);
        });

        it("a live count shows while dragging and is gone at rest", () => {
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 130));
            surface().dispatchEvent(ptr("pointermove", 80, 130));
            expect(container.querySelector(".lch-lasso-count")!.textContent).toBe("3 selected");
            surface().dispatchEvent(ptr("pointerup", 80, 130));
            expect(container.querySelector(".lch-lasso-count")!.textContent).toBe("");
        });

        it("the live count does not read the style of every mark on every move; the release does, once, to leave out hidden marks", () => {
            const spy = vi.spyOn(window, "getComputedStyle");
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            for (const [x, y] of [[120, 80], [160, 80], [230, 80], [230, 130], [80, 130]] as Array<[number, number]>) {
                surface().dispatchEvent(ptr("pointermove", x, y));
            }
            expect(container.querySelector(".lch-lasso-count")!.textContent).toBe("3 selected");
            expect(spy).not.toHaveBeenCalled();
            surface().dispatchEvent(ptr("pointerup", 80, 130));
            expect(spy).toHaveBeenCalled();
            expect(spy.mock.calls.length).toBeLessThanOrEqual(MARKS.length);
        });

        it("points closer than 3px to the last one kept are dropped", () => {
            // A square walked in 1px steps: about 350 moves.
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            let moves = 0;
            const go = (x: number, y: number) => { surface().dispatchEvent(ptr("pointermove", x, y)); moves++; };
            for (let x = 81; x <= 230; x++) go(x, 80);
            for (let y = 81; y <= 130; y++) go(230, y);
            for (let x = 229; x >= 80; x--) go(x, 130);
            surface().dispatchEvent(ptr("pointerup", 80, 130));
            expect(events.length).toBe(1);
            expect(events[0].rows).toEqual([0, 1, 2]);
            const poly = events[0].polygon;                       // unit space: fractions of the 300x200 plot
            expect(poly.length).toBeGreaterThanOrEqual(4);
            expect(poly.length).toBeLessThan(moves / 2);          // roughly a third are kept
            expect(poly[0][0]).toBeCloseTo(30 / 300, 6);          // the shape starts where the press began
            for (let i = 1; i < poly.length - 1; i++) {           // (the last vertex is the release point, kept whatever its gap)
                const dx = (poly[i][0] - poly[i - 1][0]) * 300, dy = (poly[i][1] - poly[i - 1][1]) * 200;
                expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(LASSO_SAMPLE_PX - 1e-6);
            }
        });

        it("a press that begins ON a mark is a mark click, not a lasso", () => {
            drag(loop(AROUND_012), {}, mark(0), false);
            expect(selected).toEqual([]);
            expect(events).toEqual([]);
        });

        it("nor does a press on a legend swatch, an axis label that filters, or another control", () => {
            const svg = container.querySelector("svg")!;
            const legend = el("rect", { class: "d3-legend-mark", "data-row-idx": "1" });
            const tick = el("text", { class: "d3-axis-filter", "data-row-idx": "1" });
            const knob = el("g", { class: "llm-slider lch-control" });
            svg.append(legend, tick, knob);
            for (const t of [legend, tick, knob]) drag(loop(AROUND_012), {}, t, false);
            expect(selected).toEqual([]);
        });

        it("a press outside the plot box does not start one", () => {
            drag(loop([[20, 20], [230, 20], [230, 130], [20, 130]]), {}, container.querySelector("svg")!, false);
            expect(selected).toEqual([]);
        });

        it("a press with a secondary button or a second pointer does not start one", () => {
            surface().dispatchEvent(ptr("pointerdown", 80, 80, { button: 2 }));
            surface().dispatchEvent(ptr("pointermove", 230, 130));
            surface().dispatchEvent(ptr("pointerup", 230, 130));
            surface().dispatchEvent(ptr("pointerdown", 80, 80, { isPrimary: false }));
            surface().dispatchEvent(ptr("pointermove", 230, 130));
            surface().dispatchEvent(ptr("pointerup", 230, 130));
            expect(selected).toEqual([]);
        });

        it("a drag over empty space takes in nothing, and changes nothing", () => {
            drag(loop([[300, 200], [340, 200], [340, 240], [300, 240]]));
            expect(selected).toEqual([]);
            expect(events).toEqual([]);
            expect(uiWrites).toEqual([]);
            expect(outline().getAttribute("d")).toBe("");
        });

        it("a straight line is not a shape", () => {
            drag([[80, 80], [230, 80]]);
            expect(selected).toEqual([]);
        });

        it("a pointer cancel, or Escape mid-drag, abandons it without publishing", () => {
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 130));
            surface().dispatchEvent(ptr("pointercancel", 230, 130));
            surface().dispatchEvent(ptr("pointerup", 80, 130));
            expect(selected).toEqual([]);
            expect(outline().getAttribute("d")).toBe("");

            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 80));
            surface().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            surface().dispatchEvent(ptr("pointerup", 230, 130));
            expect(selected).toEqual([]);
            expect(events).toEqual([]);
        });

        it("asks for pointer capture when the platform has it", () => {
            const cap = vi.fn();
            (surface() as any).setPointerCapture = cap;
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            expect(cap).toHaveBeenCalledWith(1);
        });

        it("and works where it does not (a platform with no pointer capture)", () => {
            expect((surface() as any).setPointerCapture).toBeUndefined();
            expect(() => drag(loop(AROUND_012))).not.toThrow();
            expect(selected).toEqual([[0, 1, 2]]);
        });

        it("keeps following the pointer when the release lands off the surface", () => {
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 80));
            document.body.dispatchEvent(ptr("pointermove", 230, 130));
            document.body.dispatchEvent(ptr("pointerup", 80, 130));
            expect(selected).toEqual([[0, 1, 2]]);
        });

        it("the document listeners are gone once the gesture ends", () => {
            drag(loop(AROUND_012));
            const before = selected.length;
            document.body.dispatchEvent(ptr("pointermove", 230, 130));
            document.body.dispatchEvent(ptr("pointerup", 230, 130));
            expect(selected.length).toBe(before);
        });
    });

    describe("a rectangle", () => {
        beforeEach(() => { draw(container); container.setAttribute(LASSO_MODE_ATTR, "rect"); install(); });

        it("is dragged corner to corner, with four vertices, and is the rectangle test", () => {
            // A path that wanders is still just its two ends.
            drag([[80, 80], [300, 300], [60, 400], [230, 130]]);
            expect(selected).toEqual([[0, 1, 2]]);
            expect(events[0].mode).toBe("rect");
            expect(events[0].polygon.length).toBe(4);
        });

        it("any other value of the attribute is freeform", () => {
            container.setAttribute(LASSO_MODE_ATTR, "circle");
            drag(loop(AROUND_012));
            expect(events[0].mode).toBe("free");
        });

        it("a drag that is thin in one dimension takes in nothing", () => {
            drag([[80, 80], [230, 80]]);
            expect(selected).toEqual([]);
        });
    });

    describe("adding to the lasso", () => {
        beforeEach(() => { draw(container); install(); });

        it("a second drag without a modifier replaces the first", () => {
            drag(loop(AROUND_012));
            drag(loop(AROUND_34));
            expect(selected).toEqual([[0, 1, 2], [3, 4]]);
            expect(events[1].polygons.length).toBe(1);
        });

        it("Ctrl adds: the union of both, and both shapes are kept", () => {
            drag(loop(AROUND_012));
            drag(loop(AROUND_34), { ctrlKey: true });
            expect(selected).toEqual([[0, 1, 2], [0, 1, 2, 3, 4]]);
            expect(events[1].rows).toEqual([0, 1, 2, 3, 4]);
            expect(events[1].polygons.length).toBe(2);
            expect(handle!.rows()).toEqual([0, 1, 2, 3, 4]);
        });

        it("Shift and Cmd add too", () => {
            drag(loop(AROUND_012));
            drag(loop(AROUND_34), { shiftKey: true });
            expect(selected.at(-1)).toEqual([0, 1, 2, 3, 4]);
            drag(loop([[270, 130], [330, 130], [330, 170], [270, 170]]), { metaKey: true });
            expect(selected.at(-1)).toEqual([0, 1, 2, 3, 4, 5]);
        });

        it("adding a region that brings nothing new changes nothing", () => {
            drag(loop(AROUND_012));
            drag(loop([[85, 85], [225, 85], [225, 125], [85, 125]]), { ctrlKey: true });
            expect(selected.length).toBe(1);
            expect(events.length).toBe(1);
        });

        it("Ctrl with nothing drawn yet is a plain lasso", () => {
            drag(loop(AROUND_012), { ctrlKey: true });
            expect(selected).toEqual([[0, 1, 2]]);
        });
    });

    describe("on release: the action list, then the event", () => {
        beforeEach(() => { draw(container); });

        it("v1 runs select, and only then dispatches llm-lasso with the rows, the shape, the mode and the source", () => {
            install();
            drag(loop(AROUND_012));
            expect(order).toEqual(["select", "event"]);
            const d = events[0];
            expect(d.rows).toEqual([0, 1, 2]);
            expect(d.source).toBe("user");
            expect(d.mode).toBe("free");
            expect(d.space).toBe("unit");
            expect(d.polygon.length).toBeGreaterThanOrEqual(4);
            expect(d.polygons).toEqual([d.polygon]);
        });

        it("the event bubbles from the container", () => {
            install();
            let heard = 0;
            document.body.addEventListener(LASSO_EVENT, () => heard++);
            drag(loop(AROUND_012));
            expect(heard).toBe(1);
        });

        it("an empty list publishes nothing and still tells the chart", () => {
            options.lasso = { capable: true, actions: [] };
            install();
            drag(loop(AROUND_012));
            expect(selected).toEqual([]);
            expect(events.length).toBe(1);
        });

        it("a name nothing registered is skipped; the next one still runs", () => {
            options.lasso = { capable: true, actions: ["nonesuch", "select"] };
            install();
            drag(loop(AROUND_012));
            expect(selected).toEqual([[0, 1, 2]]);
        });

        it("another action is added by registering a name and listing it, with no change to the gesture", () => {
            const seen: Array<{ rows: number[]; mode: string; source: string }> = [];
            registerLassoAction("test-note", ctx => { seen.push({ rows: ctx.rows, mode: ctx.mode, source: ctx.source }); order.push("note"); });
            options.lasso = { capable: true, actions: ["select", "test-note"] };
            install();
            drag(loop(AROUND_012));
            expect(order).toEqual(["select", "note", "event"]);
            expect(seen).toEqual([{ rows: [0, 1, 2], mode: "free", source: "user" }]);
        });

        it("an action that throws does not stop the next action or the event", () => {
            registerLassoAction("test-throws", () => { throw new Error("boom"); });
            options.lasso = { capable: true, actions: ["test-throws", "select"] };
            install();
            drag(loop(AROUND_012));
            expect(selected).toEqual([[0, 1, 2]]);
            expect(events.length).toBe(1);
        });

        it("a click that follows the drag, on the surface, does not clear what it just made", () => {
            install();
            drag(loop(AROUND_012));                                   // includes the trailing click
            expect(cleared).toBe(0);
            expect(handle!.rows()).toEqual([0, 1, 2]);
            expect(outline().getAttribute("d")).not.toBe("");
        });
    });

    describe("clearing", () => {
        beforeEach(() => { draw(container); install(); drag(loop(AROUND_012)); events.length = 0; order.length = 0; uiWrites.length = 0; });

        it("Escape with the chart focused erases the outline, clears the selection, and tells the chart", () => {
            surface().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            expect(outline().getAttribute("d")).toBe("");
            expect(handle!.rows()).toEqual([]);
            expect(cleared).toBe(1);
            expect(order).toEqual(["clear", "event"]);                  // the selection is cleared before the chart hears of it
            expect(events[0]).toMatchObject({ rows: [], polygon: [], polygons: [], source: "user" });
        });

        it("other keys do nothing", () => {
            surface().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            expect(handle!.rows()).toEqual([0, 1, 2]);
        });

        it("an empty click on the plot clears, the same way", () => {
            tap(260, 220);
            expect(outline().getAttribute("d")).toBe("");
            expect(cleared).toBe(1);
            expect(events[0].rows).toEqual([]);
        });

        it("but not a click that is the tail of a drag, nor one with a modifier", () => {
            surface().dispatchEvent(ptr("pointerdown", 100, 100));
            surface().dispatchEvent(ptr("pointermove", 140, 100));
            surface().dispatchEvent(ptr("pointerup", 140, 100));
            surface().dispatchEvent(ptr("click", 140, 100));            // the tail of a drag that took in nothing
            surface().dispatchEvent(ptr("click", 140, 100, { ctrlKey: true }));
            expect(cleared).toBe(0);
            expect(handle!.rows()).toEqual([0, 1, 2]);
        });

        it("a click whose press moved 5px or more is a drag's tail even when no drag was recorded", () => {
            document.dispatchEvent(ptr("pointerup", 0, 0));
            container.dispatchEvent(ptr("pointerdown", 100, 100));      // a press the lasso saw begin but was not allowed to run
            surface().dispatchEvent(ptr("click", 112, 100));
            expect(cleared).toBe(0);
        });

        it("a click on a mark, or anywhere that is not the surface, does not clear", () => {
            mark(3).dispatchEvent(ptr("click", 100, 200));
            expect(cleared).toBe(0);
            expect(handle!.rows()).toEqual([0, 1, 2]);
        });

        it("clear() does it from code, and clearLasso finds the lasso from the container", () => {
            clearLasso(container);
            expect(handle!.rows()).toEqual([]);
            expect(cleared).toBe(1);
            expect(events.length).toBe(1);
        });

        it("a host-made clear does not publish, and says so", () => {
            handle!.clear({ publish: false, source: "host" });
            expect(cleared).toBe(0);
            expect(events[0]).toMatchObject({ rows: [], source: "host" });
        });

        it("with no lasso drawn, an empty click still lets the host clear its own selection, and tells the chart nothing", () => {
            handle!.clear({ publish: false });
            events.length = 0; cleared = 0;
            tap(260, 220);
            expect(cleared).toBe(1);
            expect(events).toEqual([]);
        });
    });

    describe("persistence, at rest only", () => {
        beforeEach(() => { draw(container); });

        it("release writes the whole bag once; nothing is written mid-drag", () => {
            install();
            surface().dispatchEvent(ptr("pointerdown", 80, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 80));
            surface().dispatchEvent(ptr("pointermove", 230, 130));
            expect(uiWrites).toEqual([]);
            surface().dispatchEvent(ptr("pointermove", 80, 130));
            surface().dispatchEvent(ptr("pointerup", 80, 130));
            expect(uiWrites.length).toBe(1);
            const w = uiWrites[0];
            expect(w.frame).toBe(3);                                     // a sibling key travels with it
            expect(w.knobs.rate).toBe(0.05);                             // and so does another control's knob
            expect(w.knobs.lasso.v).toBe(1);
            expect(w.knobs.lasso.space).toBe("unit");
            expect(w.knobs.lasso.shapes.length).toBe(1);
            expect(w.knobs.lasso.shapes[0].mode).toBe("free");
            expect((container as any).__lchKnobs.lasso).toBeTruthy();    // the one bag on the container
        });

        it("clear writes again, without the lasso and with everything else", () => {
            install(); drag(loop(AROUND_012));
            handle!.clear();
            expect(uiWrites.length).toBe(2);
            expect(uiWrites[1].knobs.lasso).toBeUndefined();
            expect(uiWrites[1].knobs.rate).toBe(0.05);
            expect(uiWrites[1].frame).toBe(3);
            expect((container as any).__lchKnobs.lasso).toBeUndefined();
        });

        it("a clear with nothing stored writes nothing", () => {
            install();
            handle!.clear();
            expect(uiWrites).toEqual([]);
        });

        it("builds on what another control wrote during this render (the shared live record)", () => {
            install();
            const live = { frame: 9, knobs: { rate: 0.5, other: 1 } };
            (container as any).__lchUiLive = live;
            (container as any).__lchUiLiveOpts = options;
            (container as any).__lchUiLiveSeed = options.uiState;
            drag(loop(AROUND_012));
            expect(uiWrites[0].frame).toBe(9);
            expect(uiWrites[0].knobs).toMatchObject({ rate: 0.5, other: 1 });
        });

        it("a host with no setUiState still keeps the lasso in the bag", () => {
            options.setUiState = undefined; install(); drag(loop(AROUND_012));
            expect((container as any).__lchKnobs.lasso.shapes.length).toBe(1);
        });

        it("a setUiState that throws never breaks the gesture", () => {
            options.setUiState = () => { throw new Error("refused"); }; install();
            expect(() => drag(loop(AROUND_012))).not.toThrow();
            expect(selected).toEqual([[0, 1, 2]]);
        });

        it("is stored as fractions of the plot box when the chart registered no axes", () => {
            install(); drag(loop(AROUND_012));
            const pts = uiWrites[0].knobs.lasso.shapes[0].pts as number[][];
            // Client (80,80) is local (30,30) of a 300x200 plot.
            expect(pts[0][0]).toBeCloseTo(30 / 300, 6);
            expect(pts[0][1]).toBeCloseTo(30 / 200, 6);
            for (const p of pts) { expect(p[0]).toBeGreaterThanOrEqual(0); expect(p[0]).toBeLessThanOrEqual(1); }
        });

        it("is stored in DATA coordinates when the chart registered its axes", () => {
            (container as any)[LASSO_AXES_SLOT] = {
                toData: ([x, y]: number[]) => [x * 10, 1000 - y],
                toScreen: ([dx, dy]: number[]) => [dx / 10, 1000 - dy],
            };
            install(); drag(loop(AROUND_012));
            const stored = uiWrites[0].knobs.lasso;
            expect(stored.space).toBe("data");
            expect(stored.shapes[0].pts[0]).toEqual([300, 970]);        // local (30,30) -> (300, 970)
            expect(events[0].space).toBe("data");
            expect(events[0].polygon[0]).toEqual([300, 970]);
        });

        it("axes that cannot answer fall back to fractions rather than storing junk", () => {
            (container as any)[LASSO_AXES_SLOT] = { toData: () => [NaN, 1], toScreen: () => [0, 0] };
            install(); drag(loop(AROUND_012));
            expect(uiWrites[0].knobs.lasso.space).toBe("unit");
        });

        it("a long path is thinned to a bounded number of vertices", () => {
            install();
            surface().dispatchEvent(ptr("pointerdown", 60, 60));
            for (let i = 0; i < 1500; i++) {
                const a = (i / 1500) * Math.PI * 2;
                surface().dispatchEvent(ptr("pointermove", 180 + Math.cos(a) * (60 + (i % 7)) * 1.4, 130 + Math.sin(a) * (60 + (i % 5)) * 0.9));
            }
            surface().dispatchEvent(ptr("pointerup", 240, 130));
            expect(uiWrites.length).toBe(1);
            expect(uiWrites[0].knobs.lasso.shapes[0].pts.length).toBeLessThanOrEqual(402);
        });
    });

    describe("restore", () => {
        const stored = (extra: any = {}) => ({
            v: 1, space: "unit", shapes: [{ mode: "free", pts: [[30 / 300, 30 / 200], [180 / 300, 30 / 200], [180 / 300, 80 / 200], [30 / 300, 80 / 200]] }], ...extra,
        });
        beforeEach(() => { draw(container); });

        it("re-applies the shape, announces it with source 'restore', and NEVER publishes or writes", () => {
            options.uiState = { knobs: { lasso: stored() } };
            install();
            expect(events.length).toBe(1);
            expect(events[0]).toMatchObject({ rows: [0, 1, 2], source: "restore", space: "unit", mode: "free" });
            expect(outline().getAttribute("d")).toMatch(/^M/);
            expect(handle!.rows()).toEqual([0, 1, 2]);
            expect(selected).toEqual([]);
            expect(cleared).toBe(0);
            expect(uiWrites).toEqual([]);
            expect(order).toEqual(["event"]);
        });

        it("reads the bag on the container when the view-state has none", () => {
            (container as any).__lchKnobs = { lasso: stored() };
            install();
            expect(events[0]).toMatchObject({ rows: [0, 1, 2], source: "restore" });
        });

        it("the view-state wins over the bag", () => {
            (container as any).__lchKnobs = { lasso: stored({ shapes: [] }) };
            options.uiState = { knobs: { lasso: stored() } };
            install();
            expect(events[0].rows).toEqual([0, 1, 2]);
        });

        it("restores data coordinates through the chart's axes", () => {
            (container as any)[LASSO_AXES_SLOT] = {
                toData: ([x, y]: number[]) => [x * 10, 1000 - y],
                toScreen: ([dx, dy]: number[]) => [dx / 10, 1000 - dy],
            };
            options.uiState = { knobs: { lasso: { v: 1, space: "data", shapes: [{ mode: "free", pts: [[300, 970], [1800, 970], [1800, 920], [300, 920]] }] } } };
            install();
            expect(events[0]).toMatchObject({ rows: [0, 1, 2], source: "restore", space: "data" });
        });

        it("a rectangle restores as a rectangle", () => {
            options.uiState = { knobs: { lasso: { v: 1, space: "unit", shapes: [{ mode: "rect", pts: [[0.1, 0.15], [0.6, 0.15], [0.6, 0.4], [0.1, 0.4]] }] } } };
            install();
            expect(events[0]).toMatchObject({ rows: [0, 1, 2], mode: "rect" });
        });

        it("a union restores as a union", () => {
            const s = stored();
            s.shapes.push({ mode: "free", pts: [[30 / 300, 130 / 200], [130 / 300, 130 / 200], [130 / 300, 180 / 200], [30 / 300, 180 / 200]] });
            options.uiState = { knobs: { lasso: s } };
            install();
            expect(events[0].rows).toEqual([0, 1, 2, 3, 4]);
            expect(events[0].polygons.length).toBe(2);
        });

        it("a fraction of the box follows the box: the same shape over a wider plot reaches other marks", () => {
            options.uiState = { knobs: { lasso: stored() } };
            container.innerHTML = "";
            const { host } = draw(container);
            host.setAttribute("data-bbox", "0,0,600,200");       // the plot is twice as wide now: x from 110 to 410
            install();
            expect(events[0].rows).toEqual([1, 2]);              // row 0 (x 100) is now left of it; the rest are where they were
        });

        const poison: Array<[string, unknown]> = [
            ["a number", 7], ["a string", "lasso"], ["null", null], ["an array", [1, 2, 3]], ["a boolean", true],
            ["no space", { shapes: stored().shapes }],
            ["an unknown space", stored({ space: "px" })],
            ["shapes that are not an array", stored({ shapes: "abc" })],
            ["no shapes", stored({ shapes: [] })],
            ["a shape that is not an object", stored({ shapes: [5] })],
            ["fewer than three vertices", stored({ shapes: [{ mode: "free", pts: [[0.1, 0.1], [0.5, 0.5]] }] })],
            ["a rectangle without four corners", stored({ shapes: [{ mode: "rect", pts: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] }] })],
            ["pts that are not an array", stored({ shapes: [{ mode: "free", pts: "x" }] })],
            ["a NaN coordinate", stored({ shapes: [{ mode: "free", pts: [[0.1, 0.1], [NaN, 0.1], [0.5, 0.5]] }] })],
            ["an Infinity coordinate", stored({ shapes: [{ mode: "free", pts: [[0.1, 0.1], [Infinity, 0.1], [0.5, 0.5]] }] })],
            ["a string coordinate", stored({ shapes: [{ mode: "free", pts: [["0.1", 0.1], [0.5, 0.1], [0.5, 0.5]] }] })],
            ["a vertex that is not a pair", stored({ shapes: [{ mode: "free", pts: [0.1, [0.5, 0.1], [0.5, 0.5]] }] })],
            ["a null vertex", stored({ shapes: [{ mode: "free", pts: [null, [0.5, 0.1], [0.5, 0.5]] }] })],
            ["data coordinates with no axes registered", { v: 1, space: "data", shapes: stored().shapes }],
            ["a shape wholly outside the box", stored({ shapes: [{ mode: "free", pts: [[1.5, 1.5], [1.9, 1.5], [1.9, 1.9]] }] })],
            ["a hostile number of vertices", stored({ shapes: [{ mode: "free", pts: Array.from({ length: 5000 }, (_, i) => [0.1 + (i % 7) / 100, 0.1 + (i % 5) / 100]) }] })],
            ["a hostile number of shapes", stored({ shapes: Array.from({ length: 200 }, () => stored().shapes[0]) })],
        ];
        for (const [name, bad] of poison) {
            it(`a poisoned bag (${name}) falls to empty and never throws`, () => {
                options.uiState = { knobs: { lasso: bad } };
                expect(() => install()).not.toThrow();
                expect(handle!.rows()).toEqual([]);
                expect(outline().getAttribute("d")).toBe("");
                expect(events).toEqual([]);
                expect(selected).toEqual([]);
                expect(uiWrites).toEqual([]);
            });
        }

        it("axes that throw, or answer with junk, fall to empty", () => {
            for (const toScreen of [() => { throw new Error("no"); }, () => [NaN, 1], () => "x", () => null]) {
                (container as any)[LASSO_AXES_SLOT] = { toData: () => [0, 0], toScreen };
                options.uiState = { knobs: { lasso: { v: 1, space: "data", shapes: [{ mode: "free", pts: [[1, 1], [2, 1], [2, 2]] }] } } };
                expect(() => install()).not.toThrow();
                expect(events).toEqual([]);
            }
        });

        it("a shape wholly outside is dropped but one that is inside the same bag is kept", () => {
            const s = stored();
            s.shapes.push({ mode: "free", pts: [[1.5, 1.5], [1.9, 1.5], [1.9, 1.9]] });
            options.uiState = { knobs: { lasso: s } };
            install();
            expect(events[0].polygons.length).toBe(1);
        });

        it("a valid shape that now takes in no marks restores as nothing (the marks moved on)", () => {
            options.uiState = { knobs: { lasso: { v: 1, space: "unit", shapes: [{ mode: "free", pts: [[0.9, 0.9], [0.95, 0.9], [0.95, 0.95]] }] } } };
            install();
            expect(events).toEqual([]);
            expect(outline().getAttribute("d")).toBe("");
        });

        it("a restored lasso can be cleared and Escape finds it", () => {
            options.uiState = { knobs: { lasso: stored() } };
            install(); events.length = 0;
            surface().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            expect(events[0]).toMatchObject({ rows: [], source: "user" });
            expect(uiWrites.length).toBe(1);
            expect(uiWrites[0].knobs.lasso).toBeUndefined();
        });

        it("over the cap, or switched off, the stored lasso is left alone for when it comes back", () => {
            const bag = { knobs: { lasso: stored() } };
            options.uiState = bag; rows = LASSO_ROW_CAP + 1;
            install();
            expect(events).toEqual([]);
            expect(uiWrites).toEqual([]);
            expect(options.uiState).toBe(bag);
            expect(bag.knobs.lasso).toBeTruthy();
        });
    });
});
