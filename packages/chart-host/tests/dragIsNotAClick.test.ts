// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { createD3Adapter } from "../src/adapters";
import * as main from "../src/index";
import { gestureWasDrag, DRAG_NOT_CLICK_PX, pressOf } from "../src/selection";

// A DRAG IS NOT A CLICK (2026-10-09).
//
// A browser fires `click` after every press-move-release, on the nearest common ancestor of the two
// targets. The host's mark-click delegation read that click as a click on whatever lay under the release
// point: a drag released over a mark selected the mark, and a drag released on empty canvas CLEARED the
// reader's selection. Any chart with a gesture of its own - a brush, an orbit, a lasso - ran into it.
// The host now records where the pointer went down and ignores a click whose press was 5px or more away.

const SVGNS = "http://www.w3.org/2000/svg";

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS("${SVGNS}", "svg");
  container.appendChild(svg);
  const blank = doc.createElementNS("${SVGNS}", "rect");
  blank.setAttribute("class", "backdrop");
  svg.appendChild(blank);
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElementNS("${SVGNS}", "circle");
    m.setAttribute("class", "d3-mark"); m.setAttribute("data-row-idx", String(r));
    svg.appendChild(m);
  }
}`;

describe("gestureWasDrag", () => {
    it("a still pointer, and a pixel or two of jitter, are clicks", () => {
        expect(gestureWasDrag({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
        expect(gestureWasDrag({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false);
    });

    it("a drag on either axis is a drag", () => {
        expect(gestureWasDrag({ x: 100, y: 100 }, { x: 160, y: 103 })).toBe(true);
        expect(gestureWasDrag({ x: 100, y: 100 }, { x: 101, y: 160 })).toBe(true);
        expect(gestureWasDrag({ x: 100, y: 100 }, { x: 40, y: 100 })).toBe(true);
    });

    it("no recorded press falls back to a click, never to suppression", () => {
        expect(gestureWasDrag(null, { x: 999, y: 999 })).toBe(false);
    });

    it("the threshold is the named 5px, and is part of the public entry", () => {
        expect(DRAG_NOT_CLICK_PX).toBe(5);
        expect(gestureWasDrag({ x: 0, y: 0 }, { x: DRAG_NOT_CLICK_PX, y: 0 })).toBe(true);
        expect(gestureWasDrag({ x: 0, y: 0 }, { x: DRAG_NOT_CLICK_PX - 1, y: 0 })).toBe(false);
        expect(main.DRAG_NOT_CLICK_PX).toBe(5);
        expect(main.gestureWasDrag).toBe(gestureWasDrag);
    });
});

describe("a click that ends a drag is not a mark click", () => {
    let container: HTMLElement;
    let seen: number[][];

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        seen = [];
    });
    afterEach(() => container.remove());

    const host = () => {
        const h = createChartHost(container, {
            data: { columns: [{ name: "c", dataType: "Text", isMeasure: false }], rows: [["a", 0], ["b", 1], ["c", 2]] },
            code: CHART, d3: {},
        });
        h.selection.onChange(rows => seen.push(rows.slice()));
        h.render();
        return h;
    };
    const q = (sel: string) => container.querySelector(sel) as Element;
    const mark = (i: number) => q(`.d3-mark[data-row-idx="${i}"]`);
    const press = (el: Element, x: number, y: number) =>
        el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, button: 0 }));
    // detail 1: a click a pointer made. A keyboard or scripted click carries detail 0.
    const click = (el: Element, x: number, y: number, detail = 1) =>
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y, detail }));

    it("a drag released over a mark does not select that mark", () => {
        host();
        press(q(".backdrop"), 100, 100);
        click(mark(1), 110, 100);
        expect(seen).toEqual([]);
    });

    it("a drag released on empty canvas does not clear the selection", () => {
        host();
        click(mark(1), 50, 50);
        expect(seen.at(-1)).toEqual([1]);
        const before = seen.length;
        press(q(".backdrop"), 100, 100);
        click(q(".backdrop"), 112, 100);
        expect(seen.length).toBe(before);
        expect(seen.at(-1)).toEqual([1]);
    });

    it("a drag on the vertical axis alone counts too", () => {
        host();
        press(q(".backdrop"), 100, 100);
        click(mark(2), 101, 190);
        expect(seen).toEqual([]);
    });

    it("a 3px wobble still selects", () => {
        host();
        press(mark(1), 100, 100);
        click(mark(1), 103, 102);
        expect(seen.at(-1)).toEqual([1]);
    });

    it("a 3px wobble on empty canvas still clears", () => {
        host();
        click(mark(1), 50, 50);
        press(q(".backdrop"), 100, 100);
        click(q(".backdrop"), 102, 103);
        expect(seen.at(-1)).toEqual([]);
    });

    it("a click with no recorded press (keyboard-synthesised) behaves as before", () => {
        host();
        click(mark(2), 0, 0, 0);
        expect(seen.at(-1)).toEqual([2]);
    });

    it("a keyboard click after a press that never produced a click is not read as a drag", () => {
        host();
        press(q(".backdrop"), 400, 400);          // released outside the chart: no click ever arrived
        click(mark(0), 0, 0, 0);
        expect(seen.at(-1)).toEqual([0]);
    });

    it("the click that reads a press spends it", () => {
        host();
        press(q(".backdrop"), 100, 100);
        click(mark(1), 140, 100);                  // the drag's own click: ignored
        expect(seen).toEqual([]);
        click(mark(1), 140, 100);                  // a fresh click with no new press: a click
        expect(seen.at(-1)).toEqual([1]);
    });

    it("a press is recorded on the container, in the capture phase, so a renderer that stops the event still counts", () => {
        host();
        const m = mark(0);
        m.addEventListener("pointerdown", e => e.stopPropagation());
        press(m, 30, 40);
        expect(pressOf(container)).toEqual({ x: 30, y: 40 });
    });

    it("destroy removes the press listener", () => {
        const h = host();
        h.destroy();
        container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 }));
        expect(pressOf(container)).toBeNull();
    });
});

describe("the D3 adapter reads the same press", () => {
    let container: HTMLElement;
    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        container.innerHTML = `<svg><rect class="backdrop"></rect><circle class="d3-mark" data-row-idx="4"></circle></svg>`;
    });
    afterEach(() => container.remove());

    const scene = () => ({ container, doc: document, log: () => {} });
    const hit = (target: Element, x: number, y: number, detail = 1) =>
        createD3Adapter().hit!({ native: { target, clientX: x, clientY: y, detail }, clientX: x, clientY: y, modifiers: {} }, scene());
    const press = (x: number, y: number) =>
        container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }));

    it("a click that ends a drag resolves nothing and clears nothing", () => {
        const h = createChartHost(container, { data: { columns: [], rows: [] }, renderFn: () => {}, d3: {} });
        // The host owns the recorder; the adapter only reads what it recorded.
        press(100, 100);
        const mark = container.querySelector(".d3-mark")!;
        const bare = container.querySelector(".backdrop")!;
        expect(hit(mark, 120, 100).kind).toBe("ignored");
        expect(hit(bare, 120, 100).kind).toBe("ignored");
        h.destroy();
    });

    it("a wobble resolves the mark, and so does a click with no press", () => {
        const h = createChartHost(container, { data: { columns: [], rows: [] }, renderFn: () => {}, d3: {} });
        const mark = container.querySelector(".d3-mark")!;
        press(100, 100);
        expect(hit(mark, 103, 101).kind).toBe("mark");
        press(100, 100);
        expect(hit(mark, 0, 0, 0).kind).toBe("mark");      // a keyboard click: no pointer position to compare
        h.destroy();
    });
});
