// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// A NOTE SHOWS ON ITS MARK. An app that lets readers leave a note on a country or a route has to show it on that
// mark the next time anyone opens the page - and an agent building one read each mark's data-row-idx after paint
// and positioned badges over bounding boxes itself, which breaks on the next redraw, filter or zoom. The host
// already knows every mark and every render's settled moment, so it draws them: annotations keyed by a value in a
// column (a model key, never a row position), redrawn after every render.

const CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    m.setAttribute("data-code", String(data.rows[r][0]));
    container.appendChild(m);
  }
}`;

const COLS = [{ name: "CountryCode" }, { name: "Revenue" }];
const ALL = { columns: COLS, rows: [["USA", 10], ["CAN", 11], ["FRA", 9]] } as any;

// jsdom lays nothing out: give each mark a box from its row, and the container one at the origin. MOVED overrides
// one mark's box (a zoom), without touching the shared spy.
const MOVED: Record<string, DOMRect> = {};
afterEach(() => { vi.restoreAllMocks(); for (const k of Object.keys(MOVED)) delete MOVED[k]; });
function stubBoxes() {
    const orig = Element.prototype.getBoundingClientRect;
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const code = this.getAttribute?.("data-code");
        if (code && MOVED[code]) return MOVED[code];
        const i = code ? ["USA", "CAN", "FRA"].indexOf(code) : -1;
        if (i >= 0) return { left: 100 * i, top: 20, width: 80, height: 40, right: 100 * i + 80, bottom: 60, x: 100 * i, y: 20, toJSON() {} } as DOMRect;
        if ((this as HTMLElement).dataset?.host === "1") return { left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} } as DOMRect;
        return orig.call(this);
    });
    return () => spy.mockRestore();
}

function mount(config: Record<string, unknown> = {}) {
    const el = document.createElement("div");
    el.dataset.host = "1";
    document.body.appendChild(el);
    const host = createChartHost(el, { code: CHART, data: ALL, d3: {}, ...config } as any);
    host.render();
    return { el, host };
}

const badges = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".bic-annotation"));

describe("mark annotations", () => {
    it("draws a badge on the mark whose row carries the key, centred on its box", () => {
        const restore = stubBoxes();
        const { el } = mount({ annotations: [{ column: "CountryCode", value: "CAN", label: "2", title: "Two notes" }] });
        const b = badges(el);
        expect(b).toHaveLength(1);
        expect(b[0].textContent).toBe("2");
        expect(b[0].getAttribute("title")).toBe("Two notes");
        expect(b[0].style.left).toBe("140px");     // CAN's box: x 100..180, centre 140
        expect(b[0].style.top).toBe("40px");       // y 20..60, centre 40
        restore();
    });

    it("follows the key through a redraw with different rows, and counts what it could not show", () => {
        const restore = stubBoxes();
        const { el, host } = mount({ annotations: [{ column: "CountryCode", value: "FRA" }, { column: "CountryCode", value: "DEU" }] });
        expect(badges(el)).toHaveLength(1);
        expect(host.annotationReport).toEqual({ shown: 1, notShown: 1 });
        // A filter leaves FRA out: its row positions shift and FRA has no mark - no badge, counted.
        host.setData({ columns: COLS, rows: [["USA", 10], ["CAN", 11]] } as any);
        expect(badges(el)).toHaveLength(0);
        expect(host.annotationReport).toEqual({ shown: 0, notShown: 2 });
        // Back: FRA is row 0 now, a different position - the badge still lands on FRA's mark.
        host.setData({ columns: COLS, rows: [["FRA", 9], ["USA", 10]] } as any);
        expect(badges(el)).toHaveLength(1);
        expect(badges(el)[0].style.left).toBe("240px");
        restore();
    });

    it("survives a restyle, and is replaced (not piled up) when the host sets new annotations", () => {
        const restore = stubBoxes();
        const { el, host } = mount({ annotations: [{ column: "CountryCode", value: "USA" }] });
        host.setOptions({ width: 500 } as any);
        expect(badges(el)).toHaveLength(1);
        host.setAnnotations([{ column: "CountryCode", value: "USA" }, { column: "CountryCode", value: "CAN" }]);
        expect(badges(el)).toHaveLength(2);
        host.setAnnotations([]);
        expect(badges(el)).toHaveLength(0);
        expect(el.querySelector(".bic-annotations")).toBeNull();
        restore();
    });

    it("a badge click reaches the host's handler and never selects the mark beneath it", () => {
        const restore = stubBoxes();
        const clicked: unknown[] = [];
        const { el, host } = mount({ annotations: [{ column: "CountryCode", value: "USA", id: "n1" }],
                                     onAnnotationClick: (a: unknown) => clicked.push(a) });
        const sel: number[][] = [];
        host.selection.onChange(r => sel.push(r));
        badges(el)[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(clicked).toEqual([{ column: "CountryCode", value: "USA", id: "n1" }]);
        expect(sel).toEqual([]);
        restore();
    });

    it("matches the key as text, trimmed, so a number column and a string key agree", () => {
        const restore = stubBoxes();
        const el = document.createElement("div"); el.dataset.host = "1"; document.body.appendChild(el);
        const host = createChartHost(el, { code: CHART, d3: {},
            data: { columns: [{ name: "Year" }, { name: "V" }], rows: [["USA", 1]] } as any,
            annotations: [{ column: "Year", value: " USA " }] } as any);
        host.render();
        expect(badges(el)).toHaveLength(1);
        restore();
    });

    it("follows a mark that moves without a render - a zoom or a pan - on the next frame", async () => {
        const restore = stubBoxes();
        const { el } = mount({ annotations: [{ column: "CountryCode", value: "USA" }] });
        expect(badges(el)[0].style.left).toBe("40px");
        // The zoom: the mark's box moves and its transform attribute changes; nothing re-renders.
        const usa = el.querySelector<HTMLElement>('[data-code="USA"]')!;
        MOVED.USA = { left: 300, top: 100, width: 40, height: 20, right: 340, bottom: 120, x: 300, y: 100, toJSON() {} } as DOMRect;
        usa.setAttribute("transform", "translate(260,80) scale(0.5)");
        await vi.waitFor(() => expect(badges(el)[0].style.left).toBe("320px"));
        expect(badges(el)[0].style.top).toBe("110px");
        restore();
    });

    it("draws nothing and touches nothing when a host passes no annotations", () => {
        const { el, host } = mount();
        expect(el.querySelector(".bic-annotations")).toBeNull();
        expect(host.annotationReport).toEqual({ shown: 0, notShown: 0 });
    });

    it("hides a badge whose mark has no box (not laid out) with visibility, never pointer-events", () => {
        const { el } = mount({ annotations: [{ column: "CountryCode", value: "USA" }] });   // no stub: all boxes 0
        const b = badges(el);
        expect(b).toHaveLength(1);
        expect(b[0].style.visibility).toBe("hidden");
        expect(b[0].style.pointerEvents).not.toBe("none");
    });
});
