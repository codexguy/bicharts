// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { CONTAINER_SLOT_SCROLL, TABLE_SCROLLER_CLASS } from "../src/contract";
import { rememberScroll, takeScroll, restoreInnerScroll } from "../src/fitDom";
import * as pkg from "../src/index";

// A TABLE KEEPS THE READER'S PLACE ACROSS A REDRAW OF THE SAME CHART.
//
// A table keeps its header in view by scrolling its rows inside an element of its own, the table frame's body, while the
// host's container stays at the top. The container memory therefore had nothing to keep: a theme switch, a data update or a
// resize drew the table again and its body opened at row one. The host now also remembers every TABLE_SCROLLER_CLASS
// element's offsets (document order) and puts them back on the SAME chart's next draw; a different chart still opens at the top.
//
// jsdom lays nothing out: each table body below clamps its scroll the way a browser does, to the rows the chart drew
// (30px a row in a 150px body), and every write the HOST makes to a body is recorded in `writes`.

const tableCode = (tag: string, tables = 1) => `function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let t = 0; t < ${tables}; t++) {
    const frame = doc.createElement("div");
    frame.className = "lch-table-frame";
    frame.setAttribute("data-chart", "${tag}");
    const body = doc.createElement("div");
    body.className = "${TABLE_SCROLLER_CLASS}";
    const contentH = data.rows.length * 30, viewH = 150, contentW = 900, viewW = 600;
    let st = 0, sl = 0;
    const clampY = v => Math.max(0, Math.min(v, Math.max(0, contentH - viewH)));
    const clampX = v => Math.max(0, Math.min(v, Math.max(0, contentW - viewW)));
    Object.defineProperty(body, "clientHeight", { value: viewH });
    Object.defineProperty(body, "clientWidth", { value: viewW });
    Object.defineProperty(body, "scrollHeight", { get: () => Math.max(viewH, contentH) });
    Object.defineProperty(body, "scrollWidth", { get: () => contentW });
    Object.defineProperty(body, "scrollTop", { get: () => st, set: v => { window.__writes.push(t + ":top=" + v); st = clampY(v); } });
    Object.defineProperty(body, "scrollLeft", { get: () => sl, set: v => { window.__writes.push(t + ":left=" + v); sl = clampX(v); } });
    body.__reader = (y, x) => { st = clampY(y); if (x !== undefined) sl = clampX(x); };
    frame.appendChild(body);
    container.appendChild(frame);
  }
}`;
const TABLE = tableCode("a");
const OTHER = tableCode("b");
const TWO = tableCode("two", 2);
const rows = (n: number) => ({ columns: [{ name: "c" }], rows: Array.from({ length: n }, (_, i) => ["r" + i, i]) });
const LONG = rows(90);    // 2,700px of rows in a 150px body
const SHORT = rows(10);   // 300px: 150px of scroll
const FEW = rows(3);      // fits: no scroll

const bodies = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>("." + TABLE_SCROLLER_CLASS));
/** The reader's own wheel on the n-th table body: not counted as the host's write. */
const readerScrolls = (c: HTMLElement, y: number, n = 0, x?: number) => (bodies(c)[n] as any).__reader(y, x);
const writes = (): string[] => (window as any).__writes;

describe("the host keeps a table's own scroll across a redraw of the same chart", () => {
    let c: HTMLElement;
    beforeEach(() => {
        (window as any).__writes = [];
        c = document.createElement("div");
        document.body.appendChild(c);
    });
    afterEach(() => { c.remove(); });

    it("a re-render of the same host (a theme switch, a resize, a data update) puts the table's body back where the reader had it", () => {
        const host = createChartHost(c, { data: LONG, code: TABLE, d3: {} });
        host.render();
        readerScrolls(c, 600);
        const first = bodies(c)[0];
        host.setOptions({ width: 600 });
        expect(bodies(c)[0]).not.toBe(first);               // the table was drawn again: a new body
        expect(bodies(c)[0].scrollTop).toBe(600);
        host.setData(LONG);
        expect(bodies(c)[0].scrollTop).toBe(600);
        expect(c.scrollTop).toBe(0);                        // the container itself never moved
        expect(CONTAINER_SLOT_SCROLL in c).toBe(false);     // consumed, never left waiting
    });

    it("destroy and re-create on the SAME element (a host that rebuilds on every draw): the new host's first render restores", () => {
        const first = createChartHost(c, { data: LONG, code: TABLE, d3: {} });
        first.render();
        readerScrolls(c, 900, 0, 120);
        first.destroy();
        const second = createChartHost(c, { data: LONG, code: TABLE, d3: {} });
        second.render();
        expect(bodies(c)[0].scrollTop).toBe(900);
        expect(bodies(c)[0].scrollLeft).toBe(120);
    });

    it("a DIFFERENT chart on the same element opens at the top, and the host writes nothing to it", () => {
        const first = createChartHost(c, { data: LONG, code: TABLE, d3: {} });
        first.render();
        readerScrolls(c, 900);
        first.destroy();
        const second = createChartHost(c, { data: LONG, code: OTHER, d3: {} });
        second.render();
        expect(bodies(c)[0].scrollTop).toBe(0);
        expect(writes()).toEqual([]);
        expect(CONTAINER_SLOT_SCROLL in c).toBe(false);
    });

    it("the same table drawn shorter is clamped to what it can scroll", () => {
        const host = createChartHost(c, { data: LONG, code: TABLE, d3: {} });
        host.render();
        readerScrolls(c, 900);
        host.setData(SHORT);
        expect(bodies(c)[0].scrollTop).toBe(150);
    });

    it("two tables in one chart each get their own offset back, by order", () => {
        const host = createChartHost(c, { data: LONG, code: TWO, d3: {} });
        host.render();
        readerScrolls(c, 300, 0);
        readerScrolls(c, 1200, 1);
        host.setOptions({ width: 600 });
        expect(bodies(c).map(b => b.scrollTop)).toEqual([300, 1200]);
    });

    it("a table the reader never scrolled: no scroll written, no memory left, the same markup render after render", () => {
        const host = createChartHost(c, { data: FEW, code: TABLE, d3: {} });
        host.render();
        const once = c.outerHTML;
        host.render();
        host.destroy();
        const again = createChartHost(c, { data: FEW, code: TABLE, d3: {} });
        again.render();
        expect(c.outerHTML).toBe(once);
        expect(writes()).toEqual([]);
        expect(Object.keys(c).filter(k => k.startsWith("__") && /scroll/i.test(k))).toEqual([]);
    });

    it("restoreScroll: false leaves the table's scroll to the page", () => {
        const host = createChartHost(c, { data: LONG, code: TABLE, d3: {}, restoreScroll: false });
        host.render();
        readerScrolls(c, 600);
        host.render();
        expect(bodies(c)[0].scrollTop).toBe(0);
        expect(writes()).toEqual([]);
    });

    it("fit: false still restores the table's own scroll (it is not the fit's)", () => {
        const host = createChartHost(c, { data: LONG, code: TABLE, d3: {}, fit: false });
        host.render();
        readerScrolls(c, 600);
        host.render();
        expect(bodies(c)[0].scrollTop).toBe(600);
    });
});

describe("the two DOM halves, for a host that clears and redraws its container itself", () => {
    let c: HTMLElement;
    beforeEach(() => { (window as any).__writes = []; c = document.createElement("div"); document.body.appendChild(c); });
    afterEach(() => { c.remove(); });

    const draw = (code: string, data = LONG) => new Function("container", "data", "options", code + "\nrender(container, data, options);")(c, data, {});

    it("rememberScroll keeps the inner offsets even when the container is at the top; restoreInnerScroll puts them back for the same key only", () => {
        draw(TABLE);
        readerScrolls(c, 450);
        rememberScroll(c, "k");
        c.innerHTML = "";
        draw(TABLE);
        const mem = takeScroll(c);
        expect(mem).toEqual({ key: "k", x: 0, y: 0, inner: [{ x: 0, y: 450 }] });
        expect(restoreInnerScroll(c, mem, "other")).toBeNull();
        expect(bodies(c)[0].scrollTop).toBe(0);
        expect(restoreInnerScroll(c, mem, "k")).toEqual([{ x: 0, y: 450 }]);
        expect(bodies(c)[0].scrollTop).toBe(450);
    });

    it("no table body, or none scrolled: nothing remembered, nothing restored", () => {
        draw(TABLE);
        rememberScroll(c, "k");
        expect(takeScroll(c)).toBeNull();
        expect(restoreInnerScroll(c, { key: "k", x: 0, y: 0 }, "k")).toBeNull();
        c.innerHTML = "<div></div>";
        expect(restoreInnerScroll(c, { key: "k", x: 0, y: 0, inner: [{ x: 0, y: 300 }] }, "k")).toBeNull();
        expect(restoreInnerScroll(null, null, "k")).toBeNull();
    });

    it("the package root exports the class and both halves", () => {
        expect(pkg.TABLE_SCROLLER_CLASS).toBe("lch-table-body");
        expect(typeof pkg.restoreInnerScroll).toBe("function");
        expect(typeof pkg.rememberScroll).toBe("function");
    });
});
