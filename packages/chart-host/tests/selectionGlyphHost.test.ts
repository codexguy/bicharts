import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { createChartHost, type ChartHostConfig } from "../src/host";
import {
    MARK_CLASS, ROW_IDX_ATTR, AXIS_FILTER_CLASS, MARK_SELECTED_CLASS,
    CONTAINER_SLOT_XF_CLEAR, CONTAINER_SLOT_ANIM_STOP, SELECTION_RULE_ATTR,
} from "../src/contract";
import { SELECTION_GLYPH_CLASS } from "../src/selection";

// THE SELECTED-MARK GLYPH ON A PLAIN HOST. options.selectionGlyph ("dot" or "check") draws a small glyph on each
// selected mark, in a layer the host owns inside the container, painted after every settled render and after every
// selection change. A chart whose family never takes a glyph (a flow or relationship chart, where a selected series
// would get one on every point) carries the generate answer's suppressSelectionGlyph, as an option or in data.meta.
//
// jsdom has no layout, so each mark reports the box a browser would.

const DATA = {
    columns: [{ name: "City" }, { name: "Rev" }, { name: "__rowIdx__" }],
    rows: [["A", 1, 0], ["B", 2, 1], ["C", 3, 2]],
};

// Three marks with boxes, plus an axis header over rows 0 and 1. `timeline` installs the scrubber's slots (the
// header is then a PERIOD tick); `rule` declares the clicked-marks selection rule.
function code(opts: { timeline?: boolean; rule?: boolean } = {}) {
    return `
function render(container, data, options) {
  container.innerHTML = '';
  var doc = container.ownerDocument;
  var root = doc.createElement('div');
  ${opts.rule ? `root.setAttribute('${SELECTION_RULE_ATTR}', 'clicked-marks');` : ""}
  container.appendChild(root);
  data.rows.forEach(function (r, i) {
    var m = doc.createElement('div');
    m.setAttribute('class', '${MARK_CLASS}');
    m.setAttribute('${ROW_IDX_ATTR}', String(r[2]));
    m.getBoundingClientRect = function () { return { left: 20 * i, top: 10, width: 10, height: 10, right: 20 * i + 10, bottom: 20, x: 20 * i, y: 10 }; };
    root.appendChild(m);
  });
  var tick = doc.createElement('div');
  tick.setAttribute('class', '${AXIS_FILTER_CLASS}');
  tick.setAttribute('${ROW_IDX_ATTR}', '0,1');
  tick.id = 'tick';
  root.appendChild(tick);
  ${opts.timeline ? `container['${CONTAINER_SLOT_XF_CLEAR}'] = function () {};
  container['${CONTAINER_SLOT_ANIM_STOP}'] = function () {};` : ""}
}`;
}

let dom: JSDOM;
let container: HTMLElement;

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
    (globalThis as any).MouseEvent = dom.window.MouseEvent;
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

type Report = Parameters<NonNullable<ChartHostConfig["onSelectionGlyphs"]>>[0];

function host(extra: Partial<ChartHostConfig> = {}, codeOpts: { timeline?: boolean; rule?: boolean } = {}) {
    const reports: Report[] = [];
    const h = createChartHost(container, {
        code: code(codeOpts), data: DATA as any, d3: {},
        onSelectionGlyphs: r => reports.push(r),
        ...extra,
    });
    return { h, reports };
}
const last = <T,>(a: T[]): T | undefined => a[a.length - 1];
const marks = () => Array.from(container.querySelectorAll(`.${MARK_CLASS}`));
const click = (el: Element) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const layer = () => container.querySelector(":scope > .bic-selection-glyphs");
const glyphs = () => Array.from(container.querySelectorAll(`.${SELECTION_GLYPH_CLASS}`));

describe("the selected-mark glyph on a chart host", () => {
    it("no option: no layer, no glyph and no report, after a click", () => {
        const { h, reports } = host();
        h.render();
        click(marks()[1]);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(layer()).toBeNull();
        expect(glyphs()).toHaveLength(0);
        expect(reports).toEqual([]);
        expect(container.style.position).toBe("");
    });

    it("dot: one glyph per selected mark, reported; a clear removes them", () => {
        const { h, reports } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        expect(reports).toEqual([]);                      // nothing selected yet: nothing painted, nothing said
        click(marks()[1]);
        expect(glyphs()).toHaveLength(1);
        expect(glyphs()[0].textContent).toBe("●");
        expect(layer()!.getAttribute("aria-hidden")).toBe("true");
        expect(last(reports)).toEqual({ mode: "dot", drawn: 1, total: 1, suppressed: false });
        h.selection.clear();
        expect(glyphs()).toHaveLength(0);
    });

    it("check draws a check mark, and a selection set from outside gets glyphs too", () => {
        const { h, reports } = host({ options: { selectionGlyph: "check" } });
        h.render();
        h.selection.highlight([0, 2]);
        expect(glyphs().map(g => g.textContent)).toEqual(["✓", "✓"]);
        expect(last(reports)).toEqual({ mode: "check", drawn: 2, total: 2, suppressed: false });
    });

    it("a glyph survives a re-render: it is repainted after the chart rebuilds its DOM", () => {
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        click(marks()[0]);
        h.setOptions({ selectionGlyph: "check" });
        expect(glyphs().map(g => g.textContent)).toEqual(["✓"]);
    });

    it("the layer positions against the container, set only when the page left it static", () => {
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        click(marks()[1]);
        expect(container.style.position).toBe("relative");

        dom = new JSDOM("<!doctype html><html><body><div id='c' style='position:absolute'></div></body></html>");
        container = dom.window.document.getElementById("c") as unknown as HTMLElement;
        const again = host({ options: { selectionGlyph: "dot" } });
        again.h.render();
        click(marks()[1]);
        expect(container.style.position).toBe("absolute");
    });

    it("suppressSelectionGlyph as an option: no glyph, reported as suppressed", () => {
        const { h, reports } = host({ options: { selectionGlyph: "dot", suppressSelectionGlyph: true } });
        h.render();
        click(marks()[1]);
        expect(glyphs()).toHaveLength(0);
        expect(last(reports)).toEqual({ mode: "dot", drawn: 0, total: 0, suppressed: true });
    });

    it("suppressSelectionGlyph in data.meta is promoted, so a host that hands over the whole payload gets it", () => {
        const { h, reports } = host({
            options: { selectionGlyph: "dot" },
            data: { ...DATA, meta: { suppressSelectionGlyph: true } } as any,
        });
        h.render();
        click(marks()[1]);
        expect(h.options.suppressSelectionGlyph).toBe(true);
        expect(glyphs()).toHaveLength(0);
        expect(last(reports)?.suppressed).toBe(true);
    });

    it("a PERIOD tick's selection paints no glyph, as it dims nothing", () => {
        const { h, reports } = host({ options: { selectionGlyph: "dot" } }, { timeline: true });
        h.render();
        click(container.querySelector("#tick")!);
        expect(marks()[0].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(glyphs()).toHaveLength(0);
        expect(reports).toEqual([]);
    });

    it("a chart that declares a selection rule still gets its glyphs", () => {
        const { h } = host({ options: { selectionGlyph: "dot" } }, { rule: true });
        h.render();
        click(marks()[2]);
        expect(marks()[2].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(glyphs()).toHaveLength(1);
    });

    it("glyphs are painted after the layout pass and the fit, so neither measures them as ink", () => {
        const seen: string[] = [];
        const { h } = host({
            options: { selectionGlyph: "dot" },
            layoutPass: () => { seen.push(`layout:${glyphs().length}`); },
            onFit: () => { seen.push(`fit:${glyphs().length}`); },
        });
        h.render();
        h.selection.highlight([1]);
        expect(glyphs()).toHaveLength(1);
        seen.length = 0;
        h.setOptions({ selectionGlyph: "dot" });        // a re-render with the selection still active
        expect(seen).toEqual(["layout:0", "fit:0"]);
        expect(glyphs()).toHaveLength(1);
    });

    it("a glyph that throws never breaks the paint", () => {
        const { h } = host({ options: { selectionGlyph: "dot" }, onSelectionGlyphs: () => { throw new Error("logger down"); } });
        h.render();
        expect(() => click(marks()[1])).not.toThrow();
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
    });
});

// MARKS THAT MOVE WITHOUT A RENDER - a pan or zoom, a d3 transition, an animation frame. The glyphs follow on the next
// frame while a selection is lit, and nothing is watched once it clears or the host is gone.
describe("the selected-mark glyph follows a mark that moves", () => {
    // Moves a mark the way a transform or a transition does: a new box, announced by an attribute write.
    const move = (el: Element, dy: number) => {
        const r = el.getBoundingClientRect();
        (el as any).getBoundingClientRect = () => ({ left: r.left, top: r.top + dy, width: r.width, height: r.height,
            right: r.right, bottom: r.bottom + dy, x: r.left, y: r.top + dy });
        el.setAttribute("transform", `translate(0,${dy})`);
    };
    const nextFrame = () => new Promise(r => setTimeout(r, 40));
    const glyphTop = () => parseFloat((glyphs()[0] as HTMLElement).style.top);

    it("a selected mark moved by a transform takes its glyph with it on the next frame", async () => {
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        h.selection.highlight([1]);
        const before = glyphTop();
        move(marks()[1], 40);
        await nextFrame();
        expect(glyphs()).toHaveLength(1);
        expect(glyphTop()).toBe(before + 40);
        h.destroy();
    });

    it("the repaint a moving mark causes is not reported again, so a pan does not flood a host's log", async () => {
        const { h, reports } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        h.selection.highlight([1]);
        const said = reports.length;
        move(marks()[1], 40);
        await nextFrame();
        expect(reports.length).toBe(said);
        h.destroy();
    });

    it("nothing is watched once the selection clears or the host is destroyed", async () => {
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        h.selection.highlight([1]);
        h.selection.clear();
        move(marks()[1], 40);
        await nextFrame();
        expect(glyphs()).toHaveLength(0);
        h.selection.highlight([1]);
        const m = marks()[1];
        h.destroy();
        container.appendChild(m);                       // a page that reuses a node the chart drew
        move(m, 20);
        await nextFrame();
        expect(layer()).toBeNull();
    });
});

describe("the selected-mark glyph layer and the page's container", () => {
    it("sits under the pinned axis copy (z-index 3), which covers the rows scrolled beneath it", () => {
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        click(marks()[1]);
        expect(Number((layer() as HTMLElement).style.zIndex)).toBeLessThan(3);
    });

    it("destroy() gives the container back the position the page left on it", () => {
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        click(marks()[1]);
        expect(container.style.position).toBe("relative");
        h.destroy();
        expect(container.style.position).toBe("");

        container.style.position = "static";
        const again = host({ options: { selectionGlyph: "dot" } });
        again.h.render();
        click(marks()[1]);
        expect(container.style.position).toBe("relative");
        again.h.destroy();
        expect(container.style.position).toBe("static");
    });

    it("a selection handed to a destroyed host builds no layer", () => {
        const { h, reports } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        h.destroy();
        h.selection.highlight([0]);
        expect(layer()).toBeNull();
        expect(reports).toEqual([]);
    });
});

// A chart drawn in an <svg>: the svg's frame and every clip-path window on a mark's way up are where a reader can see
// it. jsdom has no layout, so every box is the one a browser would report (marks, the svg, the clip window's bbox).
const SVG_NS = "http://www.w3.org/2000/svg";
const svgChart = `
function render(container, data, options) {
  var doc = container.ownerDocument, NS = '${SVG_NS}';
  var box = function (el, l, t, w, h) { el.getBoundingClientRect = function () { return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t }; }; };
  var svg = doc.createElementNS(NS, 'svg');
  box(svg, 0, 0, 400, 300);
  var defs = doc.createElementNS(NS, 'defs');
  var cp = doc.createElementNS(NS, 'clipPath');
  cp.setAttribute('id', 'plot');
  var cr = doc.createElementNS(NS, 'rect');
  cr.getBBox = function () { return { x: 30, y: 10, width: 340, height: 240 }; };
  cp.appendChild(cr); defs.appendChild(cp); svg.appendChild(defs);
  var plot = doc.createElementNS(NS, 'g');
  plot.setAttribute('clip-path', 'url(#plot)');
  plot.getScreenCTM = function () { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; };
  var zoom = doc.createElementNS(NS, 'g');
  zoom.setAttribute('class', 'zoom');
  plot.appendChild(zoom); svg.appendChild(plot);
  // row 0 in the plot; row 1 panned into the y-axis margin (inside the svg, outside the clip); row 2 outside the svg.
  [[100, 50], [10, 50], [600, 50]].forEach(function (at, i) {
    var m = doc.createElementNS(NS, 'circle');
    m.setAttribute('class', '${MARK_CLASS}');
    m.setAttribute('${ROW_IDX_ATTR}', String(i));
    box(m, at[0], at[1], 10, 10);
    zoom.appendChild(m);
  });
  var focus = doc.createElementNS(NS, 'circle');
  focus.setAttribute('class', 'focus');
  svg.appendChild(focus);
  container.appendChild(svg);
}`;
function svgHost(extra: Partial<ChartHostConfig> = {}) {
    const reports: Report[] = [];
    const h = createChartHost(container, { code: svgChart, data: DATA as any, d3: {}, onSelectionGlyphs: r => reports.push(r), ...extra });
    return { h, reports };
}
const frame = () => new Promise(r => setTimeout(r, 40));
const glyphLeft = () => glyphs().map(g => parseFloat((g as HTMLElement).style.left));

describe("a glyph only where the reader can see its mark", () => {
    it("a selected mark outside its plot's clip-path or its svg's frame gets no glyph", () => {
        const { h, reports } = svgHost({ options: { selectionGlyph: "dot" } });
        h.render();
        h.selection.highlight([0, 1, 2]);
        expect(glyphLeft()).toEqual([105]);
        expect(last(reports)).toEqual({ mode: "dot", drawn: 1, total: 1, suppressed: false });
        h.destroy();
    });

    it("the layer clips at the container's scroll area, so a glyph can never grow what the container scrolls", () => {
        Object.defineProperty(container, "scrollWidth", { get: () => 400, configurable: true });
        Object.defineProperty(container, "scrollHeight", { get: () => 300, configurable: true });
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        h.selection.highlight([1]);
        const s = (layer() as HTMLElement).style;
        expect([s.overflow, s.width, s.height]).toEqual(["hidden", "400px", "300px"]);
        h.destroy();
    });

    it("a mark hidden by visibility or opacity (a legend toggle) gets no glyph, and loses it when hidden later", async () => {
        const { h } = svgHost({ options: { selectionGlyph: "dot" } });
        h.render();
        const zoom = container.querySelector("g.zoom") as SVGGElement;
        const m0 = marks()[0] as SVGElement;
        m0.style.visibility = "hidden";
        h.selection.highlight([0]);
        expect(glyphs()).toHaveLength(0);
        m0.style.visibility = "";
        h.selection.highlight([0]);
        expect(glyphs()).toHaveLength(1);
        zoom.style.visibility = "hidden";                 // the series' group, after the glyph is drawn
        await frame();
        expect(glyphs()).toHaveLength(0);
        zoom.style.visibility = "";
        await frame();
        expect(glyphs()).toHaveLength(1);
        zoom.setAttribute("style", "opacity: 0");
        await frame();
        expect(glyphs()).toHaveLength(0);
        h.destroy();
    });
});

describe("the glyph layer repaints only for a write that can move a mark", () => {
    it("a hover focus dot's transform repaints nothing; a pan of the marks' group repaints", async () => {
        const { h } = svgHost({ options: { selectionGlyph: "dot" } });
        h.render();
        h.selection.highlight([0]);
        const g0 = glyphs()[0];
        container.querySelector("circle.focus")!.setAttribute("transform", "translate(5,5)");
        await frame();
        expect(glyphs()[0] === g0).toBe(true);
        const m0 = marks()[0];
        (m0 as any).getBoundingClientRect = () => ({ left: 120, top: 50, width: 10, height: 10, right: 130, bottom: 60, x: 120, y: 50 });
        container.querySelector("g.zoom")!.setAttribute("transform", "translate(20,0)");
        await frame();
        expect(glyphs()[0] === g0).toBe(false);
        expect(glyphLeft()).toEqual([125]);
        h.destroy();
    });
});

describe("the glyph layer follows a layout change that writes nothing", () => {
    // A ResizeObserver jsdom lacks: each instance records its callback, and a test resizes the container by calling it.
    let observers: Array<{ cb: () => void; on: boolean }>;
    let w = 300, hgt = 200;
    beforeEach(() => {
        observers = [];
        w = 300; hgt = 200;
        (dom.window as any).ResizeObserver = class {
            rec: { cb: () => void; on: boolean };
            constructor(cb: () => void) { this.rec = { cb, on: false }; observers.push(this.rec); }
            observe() { this.rec.on = true; }
            disconnect() { this.rec.on = false; }
        };
        Object.defineProperty(container, "offsetWidth", { get: () => w, configurable: true });
        Object.defineProperty(container, "offsetHeight", { get: () => hgt, configurable: true });
    });
    const resize = (nw: number, nh: number) => { w = nw; hgt = nh; for (const o of observers) if (o.on) o.cb(); };
    const live = () => observers.filter(o => o.on).length;

    it("a highlight made while the chart was hidden (a closed tab) is drawn, and reported, once the chart is shown", async () => {
        const { h, reports } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        const boxes = marks().map(m => (m as any).getBoundingClientRect);
        for (const m of marks()) (m as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 });
        resize(0, 0);
        h.selection.highlight([0, 2]);
        expect(glyphs()).toHaveLength(0);
        expect(last(reports)).toMatchObject({ drawn: 0, total: 0 });
        marks().forEach((m, i) => { (m as any).getBoundingClientRect = boxes[i]; });
        resize(300, 200);
        await frame();
        expect(glyphs()).toHaveLength(2);
        expect(last(reports)).toMatchObject({ drawn: 2, total: 2 });
        h.destroy();
    });

    it("a responsive chart resized by the page moves its glyph; a callback with no size change repaints nothing", async () => {
        const { h, reports } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        h.selection.highlight([1]);
        const said = reports.length;
        const g0 = glyphs()[0];
        resize(300, 200);                                // the observer's first call, at the size already drawn
        await frame();
        expect(glyphs()[0] === g0).toBe(true);
        (marks()[1] as any).getBoundingClientRect = () => ({ left: 40, top: 20, width: 20, height: 20, right: 60, bottom: 40, x: 40, y: 20 });
        resize(600, 400);
        await frame();
        expect(glyphLeft()).toEqual([50]);
        expect(reports.length).toBe(said);               // the same one glyph: nothing new to report
        h.destroy();
    });

    it("the container is watched only while glyphs are lit", () => {
        const { h } = host({ options: { selectionGlyph: "dot" } });
        h.render();
        expect(live()).toBe(0);
        h.selection.highlight([1]);
        expect(live()).toBe(1);
        h.selection.clear();
        expect(live()).toBe(0);
        h.selection.highlight([1]);
        h.destroy();
        expect(live()).toBe(0);
    });
});

describe("the glyph layer stacks under the chart's own overlays", () => {
    it("below the note badges' layer, so a badge or a tooltip above it is never covered by a glyph", () => {
        const { h } = host({ options: { selectionGlyph: "dot" }, annotations: [{ column: "City", value: "B", label: "2" }] });
        h.render();
        h.selection.highlight([1]);
        const notes = container.querySelector(":scope > .bic-annotations") as HTMLElement;
        expect(notes).not.toBeNull();
        expect(Number((layer() as HTMLElement).style.zIndex)).toBeLessThan(Number(notes.style.zIndex));
        expect(Number((layer() as HTMLElement).style.zIndex)).toBeGreaterThanOrEqual(1);
        h.destroy();
    });
});
