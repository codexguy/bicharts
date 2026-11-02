// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// A SEARCH BOX THE READER IS TYPING IN KEEPS FOCUS AND CARET ACROSS A HOST REDRAW (found on an interactive
// table). The host clears the container before every render, so the chart's own attempt to
// put the caret back (llmGrid's) never found the box. Type "Cert", move the caret, resize: the box lost focus and the
// next key went nowhere.

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  const box = doc.createElement("input");
  box.type = "search";
  box.className = "llm-grid-search";
  box.placeholder = "Search";
  box.value = (options.uiState && options.uiState.q) || "";
  box.addEventListener("input", () => options.setUiState({ q: box.value }));
  container.appendChild(box);
  for (let i = 0; i < data.rows.length; i++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(i));
    container.appendChild(m);
  }
}`;
const DATA = { columns: [{ name: "Name" }], rows: [["Certified"], ["Other"]] };

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    const host = createChartHost(el, { code: CHART, d3: {}, data: DATA as any, options: { width: 400 } } as any);
    host.render();
    return { el, host };
}
const box = (el: HTMLElement) => el.querySelector("input.llm-grid-search") as HTMLInputElement;
const type = (b: HTMLInputElement, text: string) => { b.focus(); b.value = text; b.dispatchEvent(new Event("input")); };

describe("focus and caret survive a host redraw", () => {
    it("a resize keeps the search box focused with its caret where the reader left it", () => {
        const { el, host } = mount();
        type(box(el), "Cert");
        box(el).setSelectionRange(2, 2);
        const before = box(el);

        host.setOptions({ width: 376 });
        expect(box(el)).not.toBe(before);              // a new draw, a new element
        expect(document.activeElement).toBe(box(el));
        expect(box(el).value).toBe("Cert");
        expect([box(el).selectionStart, box(el).selectionEnd]).toEqual([2, 2]);
    });

    it("a plain render() keeps it too, and a selection range comes back whole", () => {
        const { el, host } = mount();
        type(box(el), "Certified");
        box(el).setSelectionRange(1, 5);
        host.render();
        expect(document.activeElement).toBe(box(el));
        expect([box(el).selectionStart, box(el).selectionEnd]).toEqual([1, 5]);
    });

    it("focus outside the chart is left where it is", () => {
        const { el, host } = mount();
        const outside = document.createElement("input");
        document.body.appendChild(outside);
        els.push(outside);
        outside.focus();
        host.render();
        expect(document.activeElement).toBe(outside);
        expect(box(el)).toBeTruthy();
    });
});
