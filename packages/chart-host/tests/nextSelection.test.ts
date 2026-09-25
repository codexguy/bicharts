// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { nextSelection, createChartHost } from "../src/index";

// THE SELECTION A CLICK LEAVES (2026-09-25): one pure rule, and the host's click handler on it.
//
// With a modifier each clicked row toggles; without one a click replaces the selection, and a click
// on exactly the current selection clears it. The Power BI visual runs this same table against its
// own click dispatch.

type Step = { rows: number[]; ctrl?: boolean; shift?: boolean };
const TABLE: { name: string; steps: Step[]; want: number[] }[] = [
    { name: "a plain click selects its rows", steps: [{ rows: [2] }], want: [2] },
    { name: "a plain click replaces", steps: [{ rows: [0] }, { rows: [2] }], want: [2] },
    { name: "re-clicking the same mark clears", steps: [{ rows: [2] }, { rows: [2] }], want: [] },
    { name: "a third click selects again", steps: [{ rows: [2] }, { rows: [2] }, { rows: [2] }], want: [2] },
    { name: "a several-row mark re-clicked clears", steps: [{ rows: [1, 2] }, { rows: [2, 1] }], want: [] },
    { name: "Ctrl grows", steps: [{ rows: [0] }, { rows: [2], ctrl: true }], want: [0, 2] },
    { name: "Shift grows", steps: [{ rows: [0] }, { rows: [2], shift: true }], want: [0, 2] },
    { name: "Ctrl on a selected mark removes just it", steps: [{ rows: [0] }, { rows: [2], ctrl: true }, { rows: [0], ctrl: true }], want: [2] },
    { name: "Ctrl on the last selected mark empties", steps: [{ rows: [0] }, { rows: [0], ctrl: true }], want: [] },
    { name: "Ctrl on a swatch toggles each of its rows", steps: [{ rows: [1] }, { rows: [1, 2], ctrl: true }], want: [2] },
    { name: "a plain click on a mark whose rows ARE the Ctrl-built selection clears it", steps: [{ rows: [1] }, { rows: [2], ctrl: true }, { rows: [1, 2] }], want: [] },
    { name: "a plain click on part of a Ctrl-built selection narrows to it", steps: [{ rows: [1] }, { rows: [2], ctrl: true }, { rows: [2] }], want: [2] },
];

const sorted = (a: number[]) => a.slice().sort((x, y) => x - y);

describe("nextSelection", () => {
    for (const c of TABLE) {
        it(c.name, () => {
            let sel: number[] = [];
            for (const s of c.steps) sel = nextSelection(sel, s.rows, { ctrl: s.ctrl, shift: s.shift });
            expect(sorted(sel)).toEqual(c.want);
        });
    }

    it("reads a Set or an array, and no selection as empty", () => {
        expect(nextSelection(new Set([3]), [3])).toEqual([]);
        expect(nextSelection(null, [3])).toEqual([3]);
        expect(nextSelection(undefined, [3], { ctrl: true })).toEqual([3]);
    });

    it("never hands back the caller's array", () => {
        const rows = [4];
        const out = nextSelection([], rows);
        expect(out).toEqual([4]);
        expect(out).not.toBe(rows);
    });

    it("compares with the selection held NOW, so a selection cleared elsewhere does not swallow the next click", () => {
        let sel = nextSelection([], [5]);
        sel = [];                        // cleared by something other than a click on this mark
        expect(nextSelection(sel, [5])).toEqual([5]);
    });
});

describe("the host's click handler applies it", () => {
    const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark"; m.setAttribute("data-row-idx", String(r));
    container.appendChild(m);
  }
  const swatch = doc.createElement("div");
  swatch.className = "d3-legend-mark"; swatch.setAttribute("data-row-idx", "1,2");
  container.appendChild(swatch);
}`;
    let container: HTMLElement;
    afterEach(() => container?.remove());

    const run = (steps: Step[]): number[] => {
        container = document.createElement("div");
        document.body.appendChild(container);
        const h = createChartHost(container, {
            data: { columns: [{ name: "c", dataType: "Text", isMeasure: false }], rows: [["a", 0], ["b", 1], ["c", 2], ["d", 3], ["e", 4], ["f", 5]] },
            code: CHART, d3: {},
        } as any);
        h.render();
        const marks = Array.from(container.querySelectorAll(".d3-mark")) as HTMLElement[];
        const swatch = container.querySelector(".d3-legend-mark") as HTMLElement;
        for (const s of steps) {
            const target = s.rows.length === 2 ? swatch : marks[s.rows[0]];
            target.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: !!s.ctrl, shiftKey: !!s.shift }));
        }
        const out = sorted(h.selection.current ?? []);
        h.destroy();
        return out;
    };

    for (const c of TABLE) {
        // The host's swatch names rows 1 and 2; a step naming two rows clicks it.
        if (c.steps.some(s => s.rows.length === 2 && !(s.rows.includes(1) && s.rows.includes(2)))) continue;
        it(c.name, () => { expect(run(c.steps)).toEqual(c.want); });
    }
});
