import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createChartHost } from "../src/host";
import {
    MARK_CLASS, LEGEND_MARK_CLASS, ROW_IDX_ATTR, HOST_CONTAINER_CLASS,
    SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS, DIM_OPACITY_VAR, DIM_OPACITY_DEFAULT,
    LIFT_SELECTED_CLASS,
} from "../src/contract";

// The SELECTION AFFORDANCE — what a selection LOOKS like, and how a user gets OUT of one.
// All four behaviours here came from driving the React demo by hand (2026-07-26):
// "how can I go back to nothing selected?", "clicking a table row should filter the map
// too", and "when I click a legend swatch I expected some kind of feedback... such as
// dimming that PBI might do".

const DATA = {
    columns: [{ name: "City" }, { name: "Rev" }, { name: "__rowIdx__" }],
    rows: [["A", 1, 0], ["B", 2, 1], ["C", 3, 2]],
};

// A conformant chart: three marks + one legend swatch covering rows 0 and 1.
const CODE = `
function render(container, data, options) {
  container.innerHTML = '';
  data.rows.forEach(function (r) {
    var m = container.ownerDocument.createElement('div');
    m.setAttribute('class', '${MARK_CLASS}');
    m.setAttribute('${ROW_IDX_ATTR}', String(r[2]));
    m.textContent = r[0];
    container.appendChild(m);
  });
  var lg = container.ownerDocument.createElement('div');
  lg.setAttribute('class', '${LEGEND_MARK_CLASS}');
  lg.setAttribute('${ROW_IDX_ATTR}', '0,1');
  container.appendChild(lg);
}`;

let dom: JSDOM;
let container: HTMLElement;

function host() {
    return createChartHost(container, { code: CODE, data: DATA as any, d3: {} });
}
function marks() {
    return Array.from(container.querySelectorAll(`.${MARK_CLASS}`));
}
function click(el: Element) {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}
// A selection the CHART publishes - a scrubber tick, a sunburst arc - rather than one the host reads off a
// clicked mark. The host ignores clicks for a moment after a chart dispatch (its echo guard), so the clock
// is stepped past that before the next gesture.
function chartSelects(el: Element) {
    container.dispatchEvent(new dom.window.CustomEvent("llm-xfilter-refresh", {
        bubbles: true, detail: { mark: el, source: "user" },
    }));
    vi.setSystemTime(Date.now() + 1000);
}
afterEach(() => { vi.useRealTimers(); });

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
    (globalThis as any).MouseEvent = dom.window.MouseEvent;
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

describe("selection affordance", () => {
    it("stamps the container and injects the shared stylesheet once", () => {
        host();
        expect(container.classList.contains(HOST_CONTAINER_CLASS)).toBe(true);
        const styles = dom.window.document.querySelectorAll("#bic-chart-host-affordances");
        expect(styles.length).toBe(1);
        // A second host on the same document must NOT duplicate the rules.
        const c2 = dom.window.document.createElement("div");
        dom.window.document.body.appendChild(c2);
        createChartHost(c2 as unknown as HTMLElement, { code: CODE, data: DATA as any, d3: {} });
        expect(dom.window.document.querySelectorAll("#bic-chart-host-affordances").length).toBe(1);
    });

    it("flags the clicked mark and the container so the rest dim", () => {
        const h = host();
        h.render();
        click(marks()[1]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(marks()[0].classList.contains(MARK_SELECTED_CLASS)).toBe(false);
    });

    it("a LEGEND swatch lights up every mark it covers — the reported gap", () => {
        const h = host();
        h.render();
        click(container.querySelector(`.${LEGEND_MARK_CLASS}`)!);
        // Swatch covers rows 0,1 → those marks selected, row 2 dimmed.
        expect(marks()[0].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(marks()[2].classList.contains(MARK_SELECTED_CLASS)).toBe(false);
    });

    it("a DECLARED group lifts its selected marks to full paint; an undeclared chart is untouched", () => {
        // A chart that rests its marks below full opacity by design (a parallel-coordinates
        // plot at 0.38) used to show its SELECTED marks at 38% - the eye reads that as dimmed,
        // because the affordance only ever dims the others. The lift is opt-in by class so a
        // chart using alpha as an ENCODING is never flattened by a fix meant for another.
        const h = host();
        h.render();
        const css = dom.window.document.getElementById("bic-chart-host-affordances")?.textContent ?? "";
        expect(css).toContain(`.${LIFT_SELECTED_CLASS} .${MARK_CLASS}.${MARK_SELECTED_CLASS}`);
        expect(css).toContain("stroke-opacity: 1 !important");
        // The dim rule itself is untouched: an undeclared selected mark is still merely exempt.
        expect(css).toContain(`.${MARK_CLASS}:not(.${MARK_SELECTED_CLASS})`);
    });

    it("re-clicking the same mark toggles the selection OFF", () => {
        const h = host();
        h.render();
        click(marks()[0]);
        expect(h.selection.current).toEqual([0]);
        click(marks()[0]);
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("clicking empty canvas clears — the way out of a selection", () => {
        const h = host();
        h.render();
        click(marks()[0]);
        expect(h.selection.current).toEqual([0]);
        click(container);                       // no mark under the pointer
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("an empty click asks the CHART to clear when the chart owns the selection", () => {
        // Found 2026-09-15. selection.clear() has always called the container's __llmXfClear slot first;
        // the CLICK path never did, so it published an empty selection while the chart went on
        // drawing the filter it had set. Measured through 0.5.101 in Chromium: zoomed on Sales, a
        // real click on an empty corner fired onChange([], 'user') with the breadcrumb still
        // reading All > Sales. The Power BI visual does not clear on an empty click and was never
        // wrong; this is the Excel add-in and React/MCP path.
        vi.useFakeTimers({ toFake: ["Date"] });
        const h = host();
        h.render();
        chartSelects(marks()[0]);               // the CHART published this selection
        expect(h.selection.current).toEqual([0]);

        let slotCalls = 0;
        (container as any).__llmXfClear = () => {
            slotCalls++;
            // A chart that owns its selection zooms out and publishes its own clear, which
            // onXf turns into notify([]) — the same route a scrubber tick takes.
            container.dispatchEvent(new dom.window.CustomEvent("llm-xfilter-refresh", {
                bubbles: true, detail: { clear: true, source: "chart" },
            }));
        };
        click(container);
        expect(slotCalls).toBe(1);              // the chart was ASKED, not bypassed
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("an empty click still settles the host when the chart clears without dispatching", () => {
        // The other branch, and the reason the notify is not simply deleted: a chart whose slot
        // repaints but dispatches nothing would otherwise leave the host — and every subscriber —
        // believing the old selection is live. Same contract as selection.clear().
        vi.useFakeTimers({ toFake: ["Date"] });
        const h = host();
        h.render();
        chartSelects(marks()[0]);
        let slotCalls = 0;
        (container as any).__llmXfClear = () => { slotCalls++; /* repaints, dispatches nothing */ };
        click(container);
        expect(slotCalls).toBe(1);
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("an empty click never asks the chart to clear a selection it did not publish", () => {
        // The slot is more than a clear: an animated chart's returns its scrubber to "All periods".
        // A reader paused on one period who clicks a BAR and then empty canvas is dropping the bar,
        // not the period - the unconditional call jumped that chart to All (reproduced in Chromium).
        const h = host();
        h.render();
        let slotCalls = 0;
        (container as any).__llmXfClear = () => { slotCalls++; };
        click(marks()[0]);                      // a selection read off a clicked mark
        const seen: Array<[number[], string]> = [];
        h.selection.onChange((rows, source) => seen.push([rows, source]));
        click(container);
        expect(slotCalls).toBe(0);
        expect(seen).toEqual([[[], "user"]]);   // cleared exactly as a chart with no slot clears
        // ...and a selection the HOST handed in is not the chart's either.
        h.selection.highlight([1]);
        click(container);
        expect(slotCalls).toBe(0);
        expect(h.selection.current).toEqual([]);
    });

    it("a chart-published selection replaced by a mark click is no longer the chart's to clear", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const h = host();
        h.render();
        chartSelects(marks()[0]);
        let slotCalls = 0;
        (container as any).__llmXfClear = () => { slotCalls++; };
        click(marks()[2]);                      // the reader moved on to a plain mark
        click(container);
        expect(slotCalls).toBe(0);
        expect(h.selection.current).toEqual([]);
    });

    it("an empty click on a chart that owns NOTHING clears exactly as before", () => {
        // The no-slot branch is the one every static chart takes, and it must be untouched:
        // 505 adds a call, it does not change what an ordinary chart does.
        const h = host();
        h.render();
        click(marks()[0]);
        const seen: Array<[number[], string]> = [];
        h.selection.onChange((rows, source) => seen.push([rows, source]));
        click(container);
        expect(seen).toEqual([[[], "user"]]);   // one notify, source 'user', not 'host'
        expect(h.selection.current).toEqual([]);
    });

    it("survives a repaint — a restyle must not silently drop the highlight", () => {
        const h = host();
        h.render();
        click(marks()[1]);
        h.setOptions({ width: 400 });           // full re-render: the chart rebuilds its DOM
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
    });

    it("clear() settles host state even when the chart owns the clear", () => {
        const h = host();
        h.render();
        click(marks()[0]);
        // A chart that clears WITHOUT dispatching the refresh event: the host must not be
        // left believing the old selection is still live.
        (container as any).__llmXfClear = () => { /* repaints, dispatches nothing */ };
        h.selection.clear();
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("reports the clear as source 'host' so a coordinator can ignore its own echo", () => {
        const h = host();
        h.render();
        const seen: string[] = [];
        h.selection.onChange((_rows, source) => seen.push(source));
        click(marks()[0]);
        h.selection.clear();
        expect(seen).toEqual(["user", "host"]);
    });
});

describe("typography firewall", () => {
    it("neutralizes inherited line-height/letter-spacing inside the container", () => {
        host();
        const css = dom.window.document.getElementById("bic-chart-host-affordances")!.textContent!;
        // A host page with `:root { font: 18px/145% }` (the stock Vite template) otherwise
        // hands an 11px chart label a 26px line box and slices it. Found in the React demo
        // on a chart that renders perfectly inside Power BI.
        expect(css).toContain(`.${HOST_CONTAINER_CLASS} { line-height: normal; letter-spacing: normal; }`);
    });
});

describe("affordance grammar is a STABLE contract", () => {
    it("pins the literals every other host must match", () => {
        // This used to read the Power BI visual's own CSS and assert the
        // two copies agreed. The package split inverts that: a public package cannot reach
        // into a private consumer, and should not want to — the CONSUMER asserts it conforms
        // to the package. That half now lives in the visual's own repo, comparing the visual's CSS
        // against these exported constants.
        //
        // What stays here is the half this package genuinely owns: the values themselves,
        // pinned so a rename is deliberate, visible, and semver-relevant rather than a silent
        // change that makes a chart look different depending on where it runs.
        expect(HOST_CONTAINER_CLASS).toBe("bic-chart-host");
        expect(SELECTION_ACTIVE_CLASS).toBe("lch-has-selection");
        expect(MARK_SELECTED_CLASS).toBe("lch-mark-selected");
        expect(DIM_OPACITY_VAR).toBe("--lch-dim-opacity");
        expect(DIM_OPACITY_DEFAULT).toBe(0.25);
        expect(LIFT_SELECTED_CLASS).toBe("d3-lift-selected");
    });
});
