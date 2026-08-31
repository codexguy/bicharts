import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { createChartHost } from "../src/host";
import {
    MARK_CLASS, AXIS_FILTER_CLASS, ROW_IDX_ATTR,
    SELECTION_ACTIVE_CLASS, ACTIVE_TICK_CLASS,
    CONTAINER_SLOT_XF_CLEAR, CONTAINER_SLOT_ANIM_STOP,
    chartOwnsTimeline, periodTickSuppressesFeedback,
} from "../src/contract";

// `.d3-axis-filter` MEANS TWO THINGS, AND THEY WANT OPPOSITE FEEDBACK.
//
// The class is worn by a scrubber's PERIOD tick and by a plain row / column / group
// header, and host.ts said so in a comment while treating them identically. Both
// halves of that were wrong, in opposite directions:
//
//   - A PERIOD tick dimmed the marks. The chart is already showing that period by being
//     on the frame, so dimming by time paints shades no legend explains — on an animated
//     choropleth a no-data region at 25% over white came out LIGHTER than plain land and
//     read as a bogus bottom-of-scale value.
//   - Neither kind marked the LABEL. A tick that filters looks exactly like inert text,
//     so a landed filter and a dead label are indistinguishable — which is what "the axis
//     labels are not clickable for cross filter purposes" turns out to mean when every
//     click in the trace resolved correctly.
//
// The trait that separates them is whether the chart owns a TIMELINE, and the container
// slots already carry it: the scrubber stamps __llmXfClear / __llmAnimStop, a static
// chart stamps neither. `source` cannot be used instead — a scrubber reports an honest
// 'user' when the reader clicked its tick.

const DATA = {
    columns: [{ name: "Product" }, { name: "Rev" }, { name: "__rowIdx__" }],
    rows: [["Cloud", 1, 0], ["OnPrem", 2, 1], ["Services", 3, 2]],
};

// A chart with three marks and one axis/group header covering rows 0 and 1.
// `timeline` decides whether it installs the scrubber's container slots.
function code(timeline: boolean) {
    return `
function render(container, data, options) {
  container.innerHTML = '';
  data.rows.forEach(function (r) {
    var m = container.ownerDocument.createElement('div');
    m.setAttribute('class', '${MARK_CLASS}');
    m.setAttribute('${ROW_IDX_ATTR}', String(r[2]));
    container.appendChild(m);
  });
  var tick = container.ownerDocument.createElement('div');
  tick.setAttribute('class', '${AXIS_FILTER_CLASS}');
  tick.setAttribute('${ROW_IDX_ATTR}', '0,1');
  tick.id = 'tick';
  container.appendChild(tick);
  ${timeline ? `container['${CONTAINER_SLOT_XF_CLEAR}'] = function () {};
  container['${CONTAINER_SLOT_ANIM_STOP}'] = function () {};` : ""}
}`;
}

let dom: JSDOM;
let container: HTMLElement;

function host(timeline: boolean) {
    return createChartHost(container, { code: code(timeline), data: DATA as any, d3: {} });
}
function tick() { return container.querySelector("#tick") as Element; }
function click(el: Element) {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
    (globalThis as any).MouseEvent = dom.window.MouseEvent;
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

describe("periodTickSuppressesFeedback / chartOwnsTimeline", () => {
    it("a period tick on a timeline chart suppresses; a category header does not", () => {
        expect(periodTickSuppressesFeedback(true, true)).toBe(true);
        expect(periodTickSuppressesFeedback(true, false)).toBe(false);
    });
    it("a data-mark click never suppresses, timeline or not", () => {
        expect(periodTickSuppressesFeedback(false, true)).toBe(false);
        expect(periodTickSuppressesFeedback(false, false)).toBe(false);
    });
    it("reads the timeline off the container's own slots", () => {
        expect(chartOwnsTimeline(null)).toBe(false);
        expect(chartOwnsTimeline({})).toBe(false);
        expect(chartOwnsTimeline({ [CONTAINER_SLOT_XF_CLEAR]: () => {} })).toBe(true);
        expect(chartOwnsTimeline({ [CONTAINER_SLOT_ANIM_STOP]: () => {} })).toBe(true);
    });
});

describe("a CATEGORY header (static chart) repaints", () => {
    it("dims the unselected marks and lights the label", () => {
        const h = host(false);
        h.render();
        click(tick());
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(tick().classList.contains(ACTIVE_TICK_CLASS)).toBe(true);
        expect(h.selection.current).toEqual([0, 1]);
        h.destroy();
    });

    it("clicking it again clears both the dim and the label", () => {
        const h = host(false);
        h.render();
        click(tick());
        click(tick());
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        expect(container.querySelectorAll(`.${ACTIVE_TICK_CLASS}`).length).toBe(0);
        h.destroy();
    });
});

describe("a PERIOD tick (timeline chart) filters without repainting", () => {
    it("never dims the marks, but still marks the tick", () => {
        const h = host(true);
        h.render();
        click(tick());
        // The whole point: the selection is live and published...
        expect(h.selection.current).toEqual([0, 1]);
        // ...and the chart is untouched.
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        // ...but the reader can still see WHICH period is filtering.
        expect(tick().classList.contains(ACTIVE_TICK_CLASS)).toBe(true);
        h.destroy();
    });

    it("a MARK click on the same timeline chart still dims normally", () => {
        const h = host(true);
        h.render();
        click(container.querySelector(`.${MARK_CLASS}`) as Element);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(container.querySelectorAll(`.${ACTIVE_TICK_CLASS}`).length).toBe(0);
        h.destroy();
    });
});

describe("the affordance follows the selection, not the click", () => {
    it("a mark click after a tick click puts the tick out", () => {
        const h = host(false);
        h.render();
        click(tick());
        expect(tick().classList.contains(ACTIVE_TICK_CLASS)).toBe(true);
        click(container.querySelector(`.${MARK_CLASS}`) as Element);
        expect(container.querySelectorAll(`.${ACTIVE_TICK_CLASS}`).length).toBe(0);
        h.destroy();
    });

    it("an externally-driven highlight lights no tick and dims normally", () => {
        const h = host(true);
        h.render();
        h.selection.highlight([0]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(container.querySelectorAll(`.${ACTIVE_TICK_CLASS}`).length).toBe(0);
        h.destroy();
    });

    it("clear() puts everything out", () => {
        const h = host(false);
        h.render();
        click(tick());
        h.selection.clear();
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        expect(container.querySelectorAll(`.${ACTIVE_TICK_CLASS}`).length).toBe(0);
        h.destroy();
    });

    it("a re-render that rebuilds the DOM does not resurrect a stale tick", () => {
        const h = host(false);
        h.render();
        click(tick());
        const stale = tick();
        h.render();   // render() rebuilds every node, then repaints the selection
        expect(stale.classList.contains(ACTIVE_TICK_CLASS)).toBe(true); // the detached node keeps its class
        expect(container.querySelectorAll(`.${ACTIVE_TICK_CLASS}`).length).toBe(0); // nothing IN the chart is lit
        h.destroy();
    });
});

describe("the shared stylesheet carries the affordance", () => {
    it("styles the active tick and gives every axis filter a pointer", () => {
        const h = host(false);
        h.render();
        const css = dom.window.document.getElementById("bic-chart-host-affordances")!.textContent!;
        expect(css).toContain(`.${ACTIVE_TICK_CLASS}`);
        expect(css).toContain("text-decoration: underline");
        expect(css).toContain(`.${AXIS_FILTER_CLASS} { cursor: pointer; }`);
        h.destroy();
    });
});
