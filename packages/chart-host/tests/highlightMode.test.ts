// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createChartHost } from "../src/host";
import { SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS } from "../src/contract";

// W2 (2.2 Task 0). "Highlight, don't filter" is the other half of a coordinated dashboard —
// a map keeps every bubble and dims the ones outside the table's filter, so the geography
// stays legible and there is still something to click to change the selection. It had no
// supported path: a 2026-08-01 dashboard build spent ~5 minutes reading this package's dist
// source and hand-rolled the dim out of the `lch-*` class grammar.
//
// The load-bearing part is the SOURCE tag. An externally-applied selection must NOT be
// republished, or two mutually-linked charts each re-send what the other just sent and the
// dashboard fights itself. These tests pin the painting and the silence equally.

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  container.innerHTML = "";
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    container.appendChild(m);
  }
}`;

const DATA = { columns: [{ name: "v" }], rows: [[1], [2], [3], [4]] } as any;

function mount() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createChartHost(el, { code: CHART, data: DATA, d3: {} });
    host.render();
    return { el, host };
}

const selectedIdxs = (el: HTMLElement) =>
    Array.from(el.querySelectorAll(`.${MARK_SELECTED_CLASS}`))
        .map(m => Number(m.getAttribute("data-row-idx")));

describe("selection.highlight — a sibling's selection, painted not filtered", () => {
    it("keeps EVERY mark and flags only the selected ones", () => {
        // The point of the mode: filtering a bubble map to one city throws the geography
        // away. All four marks survive; one is lit.
        const { el, host } = mount();
        host.selection.highlight([2]);
        expect(el.querySelectorAll("[data-row-idx]").length).toBe(4);
        expect(selectedIdxs(el)).toEqual([2]);
        expect(el.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
    });

    it("does NOT republish — the anti-feedback rule", () => {
        // If this leaked out as a normal selection, a mutual pair would ping-pong forever.
        // Subscribers still HEAR it (tagged "host") so a page can react; what matters is
        // that the tag is there for the group to ignore.
        const { host } = mount();
        const seen: Array<[number[], string]> = [];
        host.selection.onChange((rows, source) => seen.push([rows, source]));
        host.selection.highlight([1, 3]);
        expect(seen).toEqual([[[1, 3], "host"]]);
    });

    it("an empty highlight is a clear, not a no-op", () => {
        const { el, host } = mount();
        host.selection.highlight([1]);
        host.selection.highlight([]);
        expect(selectedIdxs(el)).toEqual([]);
        expect(el.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("survives a re-render — the repaint is not a one-shot DOM poke", () => {
        // The chart rebuilds its DOM on every render, so a hand-rolled classList poke is
        // silently lost on the next data change. The host repaints from its own state.
        const { el, host } = mount();
        host.selection.highlight([0, 3]);
        host.render();
        expect(selectedIdxs(el)).toEqual([0, 3]);
    });

    it("a later real click replaces it and DOES publish", () => {
        // Highlight must not leave the chart in a mode where its own gestures are muted.
        const { el, host } = mount();
        host.selection.highlight([2]);
        const seen: string[] = [];
        host.selection.onChange((_r, source) => seen.push(source));
        (el.querySelector('[data-row-idx="1"]') as HTMLElement).click();
        expect(seen.some(s => s !== "host")).toBe(true);
        expect(selectedIdxs(el)).toEqual([1]);
    });

    it("clear() releases an externally-applied highlight", () => {
        const { el, host } = mount();
        host.selection.highlight([0]);
        host.selection.clear();
        expect(selectedIdxs(el)).toEqual([]);
        expect(host.selection.current).toEqual([]);
    });
});
