// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { MARK_SELECTED_CLASS, SELECTION_ACTIVE_CLASS } from "../src/contract";

// Ctrl/Cmd/Shift multi-select, matching the Power BI visual.
//
// Found 2026-07-26 driving the React demo: holding Ctrl and clicking a second
// bubble replaced the selection instead of growing it. The visual has handled modifiers in
// six places for a long time; this package had NO modifier handling at all — so a chart
// that grows a selection fine inside Power BI silently could not outside it, which is a
// parity gap in the one thing the package exists to guarantee.
//
// The semantics under test are TOGGLE-PER-ROW, not union. The visual's own comment says
// why: "a naive union would leave previously-selected marks lit up after the user
// Ctrl-clicked them off." Every test below that involves removal exists to pin that.

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark"; m.setAttribute("data-row-idx", String(r));
    container.appendChild(m);
  }
  const swatch = doc.createElement("div");           // one mark, MANY rows
  swatch.className = "d3-legend-mark"; swatch.setAttribute("data-row-idx", "1,2");
  container.appendChild(swatch);
}`;

describe("createChartHost multi-select", () => {
    let container: HTMLElement;
    let seen: Array<{ rows: number[]; source: string }>;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        seen = [];
    });
    afterEach(() => container.remove());

    const host = () => {
        const h = createChartHost(container, {
            data: {
                columns: [{ name: "c", dataType: "Text", isMeasure: false }],
                rows: [["a", 0], ["b", 1], ["c", 2], ["d", 3]],
            },
            code: CHART, d3: {},
        });
        h.selection.onChange((rows, source) => seen.push({ rows, source }));
        h.render();
        return h;
    };

    const marks = () => Array.from(container.querySelectorAll(".d3-mark")) as HTMLElement[];
    const click = (el: HTMLElement, mod?: "ctrlKey" | "metaKey" | "shiftKey") =>
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...(mod ? { [mod]: true } : {}) } as any));
    const last = () => seen.at(-1)!.rows.slice().sort((a, b) => a - b);

    it("a plain click REPLACES the selection", () => {
        host();
        click(marks()[0]);
        click(marks()[2]);
        expect(last()).toEqual([2]);
    });

    for (const mod of ["ctrlKey", "metaKey", "shiftKey"] as const) {
        it(`${mod} grows the selection instead of replacing it`, () => {
            host();
            click(marks()[0]);
            click(marks()[2], mod);
            expect(last()).toEqual([0, 2]);
        });
    }

    it("modifier-clicking an ALREADY-SELECTED mark removes just that one", () => {
        // The case a union implementation gets wrong: it would return [0,1,2] and leave the
        // mark lit while the user believes they deselected it.
        host();
        click(marks()[0]);
        click(marks()[1], "ctrlKey");
        click(marks()[2], "ctrlKey");
        expect(last()).toEqual([0, 1, 2]);
        click(marks()[1], "ctrlKey");
        expect(last()).toEqual([0, 2]);
    });

    it("modifier-clicking the last remaining row CLEARS", () => {
        // Reaching empty by toggling must be a real clear, or the affordance stays lit with
        // an empty selection and the other charts never unfilter.
        host();
        click(marks()[1]);
        click(marks()[1], "ctrlKey");
        expect(seen.at(-1)!.rows).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("starting with NO selection, a modifier click behaves like a first click", () => {
        host();
        click(marks()[2], "ctrlKey");
        expect(last()).toEqual([2]);
    });

    it("a MULTI-ROW mark toggles each of its rows independently", () => {
        // A legend swatch covers rows 1,2. Ctrl-clicking it when row 1 is already selected
        // must remove 1 and add 2 — not add both, and not replace.
        host();
        click(marks()[1]);                                     // [1]
        const swatch = container.querySelector(".d3-legend-mark") as HTMLElement;
        click(swatch, "ctrlKey");
        expect(last()).toEqual([2]);
    });

    it("paints every selected mark, not only the last clicked", () => {
        // The affordance is the visible half of the feature: growing a selection that does
        // not light up reads as "Ctrl-click is broken" even when the data is right.
        host();
        click(marks()[0]);
        click(marks()[2], "ctrlKey");
        const on = marks().filter(m => m.classList.contains(MARK_SELECTED_CLASS));
        expect(on.length).toBe(2);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
    });

    it("a plain click after a multi-select collapses back to one row", () => {
        // Escape hatch: the user must be able to get back to a single selection without
        // un-toggling each row.
        host();
        click(marks()[0]);
        click(marks()[1], "ctrlKey");
        click(marks()[3]);
        expect(last()).toEqual([3]);
    });

    it("the same-mark toggle-off gesture still works WITHOUT a modifier", () => {
        host();
        click(marks()[1]);
        click(marks()[1]);
        expect(seen.at(-1)!.rows).toEqual([]);
    });

    it("modifier-clicking empty canvas still CLEARS", () => {
        // Ctrl on empty space is not a gesture users mean as "add nothing"; every BI tool
        // treats a canvas click as a clear, and the demo needs a way back to no-selection.
        host();
        click(marks()[0]);
        click(marks()[1], "ctrlKey");
        click(container);
        expect(seen.at(-1)!.rows).toEqual([]);
    });
});
