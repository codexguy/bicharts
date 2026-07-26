// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// GAP-10/GAP-16. The visual has carried overlay-penetration and geometric hit resolution
// since two production charts exposed it; the code was ported VERBATIM into selection.ts but createChartHost
// never wired it up, so a chart that cross-filters fine in Power BI silently could not
// cross-filter in any SDK host. Found 2026-07-26 by a cold agent building against the MCP:
// a generated time-series chart paints a full-plot-area `rect` with fill:'transparent' OVER
// its marks, every mark click resolved to "empty canvas", and the consumer worked around it
// with their own elementsFromPoint hack (whose selector then silently dropped .d3-axis-filter).
//
// jsdom has no layout, so the two geometry-dependent DOM APIs are stubbed per test — the
// logic under test is the RESOLUTION ORDER and the scoping guards, not the browser's
// hit-testing, which is exercised for real by the headless demo verification.

const mk = (doc: Document, cls: string, rows: string) => {
    const el = doc.createElement("div");
    el.className = cls;
    el.setAttribute("data-row-idx", rows);
    return el;
};

describe("createChartHost hit resolution", () => {
    let container: HTMLElement;
    let seen: Array<{ rows: number[]; source: string }>;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        seen = [];
    });
    afterEach(() => {
        delete (document as any).elementsFromPoint;
        container.remove();
    });

    const hostFor = (code: string) => {
        const h = createChartHost(container, {
            data: { columns: [{ name: "c", dataType: "Text", isMeasure: false }], rows: [["a", 0], ["b", 1]] },
            code, d3: {},
        });
        h.selection.onChange((rows, source) => seen.push({ rows, source }));
        h.render();
        return h;
    };

    // A chart whose tooltip overlay is painted AFTER (on top of) its marks — the real
    // shape of the bug: fill:'transparent' is a PAINTED fill, so it hit-tests.
    const OVERLAY_CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark"; m.setAttribute("data-row-idx", String(r));
    container.appendChild(m);
  }
  const ov = doc.createElement("div");     // the swallowing overlay
  ov.className = "tooltip-overlay";
  container.appendChild(ov);
}`;

    it("penetrates a tooltip overlay painted over the marks", () => {
        hostFor(OVERLAY_CHART);
        const overlay = container.querySelector(".tooltip-overlay") as HTMLElement;
        const mark1 = container.querySelectorAll(".d3-mark")[1] as HTMLElement;
        // The browser would report the overlay FIRST and the mark beneath it.
        (document as any).elementsFromPoint = () => [overlay, mark1, container];

        overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 40, clientY: 40 }));

        expect(seen.at(-1)).toEqual({ rows: [1], source: "user" });
    });

    it("still treats a genuinely empty click as a CLEAR, not a phantom selection", () => {
        const h = hostFor(OVERLAY_CHART);
        const overlay = container.querySelector(".tooltip-overlay") as HTMLElement;
        const mark0 = container.querySelector(".d3-mark") as HTMLElement;
        (document as any).elementsFromPoint = () => [overlay, mark0, container];
        mark0.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 }));
        expect(h.selection.current).toEqual([0]);

        // Now nothing but the overlay under the cursor: no mark to recover.
        (document as any).elementsFromPoint = () => [overlay, container];
        overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 400, clientY: 400 }));
        expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
    });

    it("resolves a fully pointer-events:none row by geometry", () => {
        // The pathology: the row and ALL its children are unhittable, so
        // elementsFromPoint omits it entirely and only rect geometry can recover it.
        hostFor(`
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark"; m.setAttribute("data-row-idx", String(r));
    m.style.pointerEvents = "none";
    container.appendChild(m);
  }
}`);
        const marks = Array.from(container.querySelectorAll(".d3-mark")) as HTMLElement[];
        marks.forEach((m, i) => {
            m.getBoundingClientRect = () =>
                ({ left: 0, right: 100, top: i * 20, bottom: i * 20 + 20, width: 100, height: 20 }) as DOMRect;
        });
        (document as any).elementsFromPoint = () => [container];

        container.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 30 }));

        expect(seen.at(-1)).toEqual({ rows: [1], source: "user" });   // y=30 → second row
    });

    it("cross-filters a STATIC chart's .d3-axis-filter label (it dispatches nothing)", () => {
        // A cold-generated grouped bar marks its category labels .d3-axis-filter with the
        // union data-row-idx of the column, and dispatches no event anywhere in the file.
        // Excluding the class here made those clicks dead in SDK hosts while Power BI —
        // whose clickSel includes it — filtered correctly.
        hostFor(`
function render(container, data, options) {
  const doc = container.ownerDocument;
  const t = doc.createElement("div");
  t.className = "d3-axis-filter"; t.setAttribute("data-row-idx", "0,1");
  container.appendChild(t);
}`);
        const tick = container.querySelector(".d3-axis-filter") as HTMLElement;
        tick.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));

        expect(seen.at(-1)).toEqual({ rows: [0, 1], source: "user" });
    });

    it("does NOT double-fire when an animated chart dispatched for the same gesture", () => {
        hostFor(`
function render(container, data, options) {
  const doc = container.ownerDocument;
  const t = doc.createElement("div");
  t.className = "d3-axis-filter"; t.setAttribute("data-row-idx", "1");
  t.addEventListener("click", () => {
    container.dispatchEvent(new CustomEvent("llm-xfilter-refresh",
      { bubbles: true, detail: { mark: t, source: "user" } }));
  });
  container.appendChild(t);
}`);
        const tick = container.querySelector(".d3-axis-filter") as HTMLElement;
        // The chart's own handler dispatches, THEN the click keeps bubbling to the host.
        tick.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));

        expect(seen).toHaveLength(1);
        expect(seen[0].rows).toEqual([1]);
    });

    it("leaves a normally-resolving mark click completely alone", () => {
        // The hardenings must be inert on the happy path: no elementsFromPoint stub at all,
        // so if resolution leaned on them this would throw or mis-resolve.
        hostFor(`
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark"; m.setAttribute("data-row-idx", String(r));
    container.appendChild(m);
  }
}`);
        const mark0 = container.querySelector(".d3-mark") as HTMLElement;
        mark0.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
        expect(seen.at(-1)).toEqual({ rows: [0], source: "user" });

        // …and re-clicking it still toggles OFF.
        mark0.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }));
        expect(seen.at(-1)).toEqual({ rows: [], source: "user" });
    });
});
