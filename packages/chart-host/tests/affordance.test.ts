import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createChartHost } from "../src/host";
import {
    MARK_CLASS, LEGEND_MARK_CLASS, ROW_IDX_ATTR, HOST_CONTAINER_CLASS,
    SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS, DIM_OPACITY_VAR, DIM_OPACITY_DEFAULT,
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
    });
});
