// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { MARKS_INERT_CLASS, MARK_SELECTED_CLASS, SELECTION_ACTIVE_CLASS } from "../src/contract";

// ONLY A MARK THAT SELECTS SOMETHING LOOKS OR ACTS CLICKABLE. A KPI deck and a monthly chart
// drew their panels and columns as marks, with a pointer cursor and sibling dimming on click, but the page gave them
// nothing to select: a click dimmed the others and filtered nothing. A host told that nothing listens to this chart's
// selection (ChartHostConfig.marksSelect) draws its marks inert: no pointer, no hover dimming, and the reader's click
// lights and dims nothing. What the page hands in still paints.

const CHART = `
function render(container, data) {
  const doc = container.ownerDocument;
  for (let i = 0; i < data.rows.length; i++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(i));
    m.style.cursor = "pointer";
    container.appendChild(m);
  }
}`;
const DATA = { columns: [{ name: "Region" }], rows: [["Americas"], ["EMEA"], ["APAC"]] };

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount(marksSelect?: () => boolean) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    const host = createChartHost(el, { code: CHART, d3: {}, data: DATA as any, ...(marksSelect ? { marksSelect } : {}) } as any);
    const heard: number[][] = [];
    host.selection.onChange(rows => heard.push(rows));
    host.render();
    return { el, host, heard };
}
const mark = (el: HTMLElement, i: number) => el.querySelector(`.d3-mark[data-row-idx="${i}"]`) as HTMLElement;
const click = (t: Element) => t.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("marks that select nothing are drawn inert", () => {
    it("a reader's click on an inert chart lights nothing, dims nothing and tells nobody", () => {
        const { el, heard } = mount(() => false);
        expect(el.classList.contains(MARKS_INERT_CLASS)).toBe(true);
        click(mark(el, 1));
        expect(el.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        expect(el.querySelectorAll(`.${MARK_SELECTED_CLASS}`)).toHaveLength(0);
        expect(heard).toEqual([]);
    });

    it("a selection the chart dispatches itself is not painted either", () => {
        const { el } = mount(() => false);
        mark(el, 2).dispatchEvent(new CustomEvent("llm-xfilter-refresh", { bubbles: true, detail: { mark: mark(el, 2), source: "user" } }));
        expect(el.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("what the page hands in still paints on an inert chart", () => {
        const { el, host } = mount(() => false);
        host.selection.highlight([0]);
        expect(el.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(mark(el, 0).classList.contains(MARK_SELECTED_CLASS)).toBe(true);
    });

    it("a chart whose selection reaches something, or a host that doesn't say, selects as before", () => {
        for (const m of [mount(() => true), mount()]) {
            expect(m.el.classList.contains(MARKS_INERT_CLASS)).toBe(false);
            click(mark(m.el, 1));
            expect(mark(m.el, 1).classList.contains(MARK_SELECTED_CLASS)).toBe(true);
            expect(m.heard).toEqual([[1]]);
        }
    });

    it("the answer is read at each click, so a page that wires the chart later gets a selecting chart at once", () => {
        let wired = false;
        const { el, heard } = mount(() => wired);
        wired = true;
        click(mark(el, 1));
        expect(heard).toEqual([[1]]);
        expect(el.classList.contains(MARKS_INERT_CLASS)).toBe(false);
    });

    it("the stylesheet takes the pointer off an inert chart's marks (over the chart's own inline cursor) and its hover dimming", () => {
        mount(() => false);
        const css = Array.from(document.querySelectorAll("style")).map(s => s.textContent || "").join("\n");
        expect(css).toMatch(new RegExp(`\\.${MARKS_INERT_CLASS} \\.d3-mark[^{]*\\{[^}]*cursor:\\s*default\\s*!important`));
        expect(css).toMatch(new RegExp(`:not\\(\\.${MARKS_INERT_CLASS}\\):has\\(\\.d3-mark`));
    });
});
