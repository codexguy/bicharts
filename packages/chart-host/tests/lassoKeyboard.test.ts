// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChartHost, type ChartHost } from "../src/host";
import { MARK_SELECTED_CLASS } from "../src/contract";
import { LASSO_EVENT, type LassoEventDetail } from "../src/lasso";
import { KEYBOARD_STAMP } from "../src/keyboardMarks";

// THE LASSO FROM THE KEYBOARD. A chart that reacts to a circled group (a "what else they have in common" panel) listened
// for the lasso event, and only a pointer drag sent it: the lasso's own keys took Escape and nothing else, so a reader
// without a mouse could pick one mark at a time but never ask about a group they chose. On a chart with a lasso, Shift
// with an arrow marks a run of marks from where it started, and Enter sends that run as a lasso does: the same actions
// (the host's selection) and the same event, with `via: "keyboard"` and no shape.

const CHART = `${KEYBOARD_STAMP}
function render(container, data, options) {
  const doc = container.ownerDocument, NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("data-box", "10,20,400,300"); svg.setAttribute("viewBox", "0 0 400 300");
  const plot = doc.createElementNS(NS, "g");
  plot.setAttribute("class", "lch-plot"); plot.setAttribute("data-bbox", "0,0,300,200");
  svg.appendChild(plot);
  for (let r = 0; r < data.rows.length; r++) {
    const c = doc.createElementNS(NS, "circle");
    c.setAttribute("class", "d3-mark"); c.setAttribute("data-row-idx", String(r));
    c.setAttribute("data-box", (60 + r * 40) + ",80,6,6");
    plot.appendChild(c);
  }
  container.appendChild(svg);
}`;
const DATA = { columns: [{ name: "c", dataType: "Text", isMeasure: false }], rows: [0, 1, 2, 3, 4, 5].map(i => ["r" + i, i]) } as any;

describe("a lasso chart answers the keyboard", () => {
    let container: HTMLElement;
    let host: ChartHost;
    let events: LassoEventDetail[];

    beforeEach(() => {
        const orig = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const mk = (l: number, t: number, w: number, h: number) =>
                ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect;
            const box = this.getAttribute?.("data-box");
            if (box) { const [l, t, w, h] = box.split(",").map(Number); return mk(l, t, w, h); }
            return orig.call(this);
        });
        (window as any).SVGElement.prototype.getBBox = function (this: Element) {
            const b = (this.getAttribute("data-bbox") || "0,0,0,0").split(",").map(Number);
            return { x: b[0], y: b[1], width: b[2], height: b[3] };
        };
        container = document.createElement("div");
        document.body.appendChild(container);
        events = [];
        container.addEventListener(LASSO_EVENT, e => events.push((e as CustomEvent).detail));
    });
    afterEach(() => { host?.destroy(); container.remove(); vi.restoreAllMocks(); });

    const make = (options: Record<string, unknown> = { lasso: { capable: true } }) => {
        host = createChartHost(container, { data: DATA, code: CHART, d3: {}, options } as any);
        host.render();
        return host;
    };
    const mark = (i: number) => container.querySelector(`.d3-mark[data-row-idx="${i}"]`) as HTMLElement;
    const key = (el: Element, k: string, mods: KeyboardEventInit = {}) =>
        el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
    const focused = () => document.activeElement as HTMLElement;
    const selectedRows = () => Array.from(container.querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-row-idx"));

    it("Shift with arrows marks a run, and Enter sends it as a lasso: the event and the selection", () => {
        make();
        mark(1).focus();
        key(focused(), "ArrowRight", { shiftKey: true });
        key(focused(), "ArrowRight", { shiftKey: true });
        expect(container.querySelectorAll("[data-lch-kb-range]").length).toBe(3);
        key(focused(), "Enter");
        expect(events.length).toBe(1);
        expect(events[0].rows).toEqual([1, 2, 3]);
        expect(events[0].source).toBe("user");
        expect((events[0] as any).via).toBe("keyboard");
        expect(events[0].polygons).toEqual([]);
        expect(selectedRows()).toEqual(["1", "2", "3"]);
        expect(container.querySelectorAll("[data-lch-kb-range]").length).toBe(0);
    });

    it("the run can grow backwards from where it started", () => {
        make();
        mark(4).focus();
        key(focused(), "ArrowLeft", { shiftKey: true });
        key(focused(), "ArrowLeft", { shiftKey: true });
        key(focused(), "Enter");
        expect(events.map(e => e.rows)).toEqual([[2, 3, 4]]);
    });

    it("an arrow without Shift, or Escape, drops the run; Enter on one mark is still a click", () => {
        make();
        mark(0).focus();
        key(focused(), "ArrowRight", { shiftKey: true });
        key(focused(), "ArrowRight");
        expect(container.querySelectorAll("[data-lch-kb-range]").length).toBe(0);
        key(focused(), "Enter");
        expect(events.length).toBe(0);
        expect(selectedRows()).toEqual(["2"]);
    });

    it("on a scatter the run is a group that sits together, not the next rows in data order", () => {
        // rows 0, 2, 4 sit together in the top-left; 1, 3, 5 far away bottom-right. Data order interleaves them.
        make();
        const POS = [[100, 100], [400, 400], [115, 108], [420, 410], [130, 104], [440, 395]];
        POS.forEach(([x, y], r) => mark(r).setAttribute("data-box", `${x},${y},6,6`));
        mark(0).focus();
        key(focused(), "ArrowRight", { shiftKey: true });
        key(focused(), "ArrowRight", { shiftKey: true });
        key(focused(), "Enter");
        expect(events.map(e => e.rows)).toEqual([[0, 2, 4]]);
    });

    it("a chart with no lasso keeps Shift with an arrow as a plain move", () => {
        make({});
        mark(1).focus();
        key(focused(), "ArrowRight", { shiftKey: true });
        expect(container.querySelectorAll("[data-lch-kb-range]").length).toBe(0);
        expect(focused().getAttribute("data-row-idx")).toBe("2");
        key(focused(), "Enter");
        expect(events.length).toBe(0);
    });
});
