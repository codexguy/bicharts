// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { CONTROL_CLASS } from "../src/contract";
import { isInsideControl } from "../src/selection";

// A CLICK IN A CHART'S OWN CONTROL IS NOT A CLICK ON THE CANVAS (2026-09-24).
//
// A chart can carry an input of its own - a number box in the knob strip, a slider's hit area -
// marked with the control class and carrying no mark class and no row index. A click there
// resolves no mark, and the delegation read "no mark" as "empty canvas" and cleared the reader's
// selection: focusing the box to type a value dropped the filter the reader was looking at. The
// first two cases pin what a click has always meant; the rest pin that a control is neither.

const XHTML = "http://www.w3.org/1999/xhtml";
const SVGNS = "http://www.w3.org/2000/svg";

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS("${SVGNS}", "svg");
  container.appendChild(svg);
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElementNS("${SVGNS}", "rect");
    m.setAttribute("class", "d3-mark"); m.setAttribute("data-row-idx", String(r));
    svg.appendChild(m);
  }
  const knob = doc.createElementNS("${SVGNS}", "g");
  knob.setAttribute("class", "llm-slider lch-control");
  const hit = doc.createElementNS("${SVGNS}", "rect");
  hit.setAttribute("class", "llm-slider-hit");
  knob.appendChild(hit);
  svg.appendChild(knob);
  const fo = doc.createElementNS("${SVGNS}", "foreignObject");
  fo.setAttribute("class", "lch-control");
  const div = doc.createElementNS("${XHTML}", "div");
  const input = doc.createElementNS("${XHTML}", "input");
  input.setAttribute("class", "lch-control lch-entry");
  div.appendChild(input);
  fo.appendChild(div);
  svg.appendChild(fo);
  const blank = doc.createElementNS("${SVGNS}", "rect");
  blank.setAttribute("class", "backdrop");
  svg.appendChild(blank);
}`;

describe("a click inside a chart's control leaves the selection alone", () => {
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
    const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    it("a click on a mark selects its row", () => {
        host();
        click(q('.d3-mark[data-row-idx="1"]'));
        expect(seen.at(-1)).toEqual([1]);
    });

    it("a click on empty canvas clears a selection", () => {
        host();
        click(q('.d3-mark[data-row-idx="1"]'));
        click(q(".backdrop"));
        expect(seen.at(-1)).toEqual([]);
    });

    it("a click in a number box inside a foreignObject does not clear it", () => {
        host();
        click(q('.d3-mark[data-row-idx="1"]'));
        const before = seen.length;
        click(q("input.lch-entry"));
        click(q("foreignObject div"));
        expect(seen.length).toBe(before);
        expect(seen.at(-1)).toEqual([1]);
    });

    it("a click on an svg control group's hit area does not clear it", () => {
        host();
        click(q('.d3-mark[data-row-idx="0"]'));
        const before = seen.length;
        click(q(".llm-slider-hit"));
        expect(seen.length).toBe(before);
    });

    it("with nothing selected, a control click publishes nothing either", () => {
        host();
        click(q("input.lch-entry"));
        expect(seen).toEqual([]);
    });
});

describe("isInsideControl", () => {
    it("finds the control class on the target or an ancestor, and stops at the container", () => {
        const outer = document.createElement("div");
        outer.className = CONTROL_CLASS;          // a page that happens to wrap the chart in one
        const ctr = document.createElement("div");
        outer.appendChild(ctr);
        const inControl = document.createElement("span");
        const ctl = document.createElement("div");
        ctl.className = `x ${CONTROL_CLASS}`;
        ctl.appendChild(inControl);
        const plain = document.createElement("span");
        ctr.append(ctl, plain);
        expect(isInsideControl(inControl, ctr)).toBe(true);
        expect(isInsideControl(ctl, ctr)).toBe(true);
        expect(isInsideControl(plain, ctr)).toBe(false);
        expect(isInsideControl(ctr, ctr)).toBe(false);
        expect(isInsideControl(inControl.appendChild(document.createTextNode("t")), ctr)).toBe(true);
        expect(isInsideControl(null, ctr)).toBe(false);
    });

    it("the class is the one the grammar names", () => {
        expect(CONTROL_CLASS).toBe("lch-control");
    });
});
