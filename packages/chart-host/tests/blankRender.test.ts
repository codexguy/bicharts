// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { censusMarks, isBlankRender, blankRenderFlag } from "../src/blankRender";
import { createChartHost } from "../src/host";

// A chart that ran clean and painted nothing (2026-09-01). Generated code binds columns BY NAME
// and guards the lookup, which is good practice and produces a silent failure:
// `if (idx === -1) { container.append(...).text(noDataText); return; }` is a correct, defensive,
// entirely successful render that draws nothing. Seen in production on a chart whose column was
// renamed between generating it and rendering it.
//
// These tests are mostly about what must NOT be called blank. The verdict is only worth having if
// a human believes it, and one wrong accusation on a chart that is fine costs more than the case
// it catches.

const el = (html: string): HTMLElement => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
};

describe("censusMarks — count by contract, never by tag", () => {
    it("counts SVG marks", () => {
        const c = censusMarks(el(`<svg><rect class="d3-mark" data-row-idx="0"></rect>
                                       <rect class="d3-mark" data-row-idx="1"></rect></svg>`));
        expect(c.markCount).toBe(2);
        expect(c.containerKind).toBe("svg");
    });

    it("counts HTML/div marks with NO svg at all — the pure-HTML case", () => {
        // A table-with-embedded-bars or a KPI card never creates an SVG, so any census that
        // starts from querySelector("svg") is blind to exactly the charts it most needs to
        // measure. They still tag their rows: class + data-row-idx.
        const c = censusMarks(el(`<div class="grid">
            <div class="d3-mark" data-row-idx="0">Beginner</div>
            <div class="d3-mark" data-row-idx="1">Expert</div></div>`));
        expect(c.markCount).toBe(2);
        expect(c.containerKind).toBe("html");
    });

    it("counts an element tagged BOTH ways only once", () => {
        expect(censusMarks(el(`<svg><path class="d3-mark" data-row-idx="3"/></svg>`)).markCount).toBe(1);
    });

    it("counts a mark declared by data-row-idx alone", () => {
        expect(censusMarks(el(`<svg><circle data-row-idx="0"/></svg>`)).markCount).toBe(1);
    });

    it("does NOT count legend swatches as data marks", () => {
        // A chart that draws its legend and then bails leaves these behind. Counting them would
        // hide precisely the case this exists to catch.
        const c = censusMarks(el(`<svg><rect class="d3-legend-mark" data-row-idx="0"></rect></svg>`));
        expect(c.markCount).toBe(0);
        expect(c.legendMarkCount).toBe(1);
    });

    it("reports a no-data branch's DOM as empty of marks", () => {
        const c = censusMarks(el(`<div style="position:absolute">No data to display</div>`));
        expect(c.markCount).toBe(0);
        expect(c.containerKind).toBe("html");   // it drew SOMETHING, just nothing that is data
    });

    it("never throws on rubbish input", () => {
        expect(censusMarks(null).markCount).toBe(0);
        expect(censusMarks(undefined).markCount).toBe(0);
        expect(censusMarks({} as any).markCount).toBe(0);
        expect(censusMarks(el("")).containerKind).toBe("empty");
    });
});

describe("isBlankRender — every clause is a false positive we would otherwise ship", () => {
    it("IS blank: no marks, rows to draw", () => {
        expect(isBlankRender({ markCount: 0, rows: 97 })).toBe(true);
    });

    it("is NOT blank when it painted something", () => {
        expect(isBlankRender({ markCount: 1, rows: 97 })).toBe(false);
    });

    it("is NOT blank at zero rows — that is the never-silent banner's job", () => {
        // A cross-filter that matched nothing must render, and it already has its own message
        // that can name the CAUSE. Two messages for one rectangle is worse than one.
        expect(isBlankRender({ markCount: 0, rows: 0 })).toBe(false);
    });

    it("is NOT blank for an animated chart's first frame", () => {
        // An animated map before any country enters the series is legitimately empty.
        expect(isBlankRender({ markCount: 0, rows: 97, animated: true })).toBe(false);
    });

    it("is NOT blank when the author configured their own No Data Text", () => {
        expect(isBlankRender({ markCount: 0, rows: 97, authoredNoDataText: true })).toBe(false);
    });

    it("is NOT blank for a lane whose marks are not tagged with our contract", () => {
        // A Vega spec names its own marks. Absence of .d3-mark there is evidence of nothing, and
        // a verdict without evidence is the cry-wolf this whole guard is trying to avoid.
        expect(isBlankRender({ markCount: 0, rows: 97, contractUntagged: true })).toBe(false);
    });

    it("treats a negative or absent row count as no verdict", () => {
        expect(isBlankRender({ markCount: 0, rows: -1 })).toBe(false);
        expect(isBlankRender({ markCount: 0, rows: NaN })).toBe(false);
    });
});

describe("blankRenderFlag — the always-on channel's token", () => {
    it("is lower-case and safe for a CSV behaviour-flag column", () => {
        expect(blankRenderFlag("D3", "column-missing")).toBe("blankrender:d3:column-missing");
        expect(blankRenderFlag("PYMATPLOT", "unknown")).toBe("blankrender:pymatplot:unknown");
    });

    it("never emits a comma, which would split one flag into two", () => {
        expect(blankRenderFlag("d3", "a,b c")).not.toContain(",");
    });
});

// The host wiring: every consumer that renders through createChartHost inherits this without
// knowing it exists.
describe("createChartHost — notifies on a clean render that drew nothing", () => {
    const BLANK_CHART = `
function render(container, data, options) {
  const idx = data.columns.findIndex(c => c.name === 'GoneAway');
  if (idx === -1) { const d = container.ownerDocument.createElement('div');
                    d.textContent = 'No data to display'; container.appendChild(d); return; }
}`;
    const GOOD_CHART = `
function render(container, data, options) {
  const doc = container.ownerDocument;
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement('div');
    m.setAttribute('class', 'd3-mark');
    m.setAttribute('data-row-idx', String(r));
    container.appendChild(m);
  }
}`;
    const data = { columns: [{ name: "Region" }], rows: [["North"], ["South"]] };

    it("fires onBlankRender when the chart bails on a missing column", () => {
        const onBlankRender = vi.fn();
        const c = document.createElement("div");
        createChartHost(c, { data, code: BLANK_CHART, onBlankRender, d3: {} }).render();
        expect(onBlankRender).toHaveBeenCalledTimes(1);
        expect(onBlankRender.mock.calls[0][0].rows).toBe(2);
        expect(onBlankRender.mock.calls[0][0].census.markCount).toBe(0);
    });

    it("stays quiet when the chart drew its marks", () => {
        const onBlankRender = vi.fn();
        const c = document.createElement("div");
        createChartHost(c, { data, code: GOOD_CHART, onBlankRender, d3: {} }).render();
        expect(onBlankRender).not.toHaveBeenCalled();
    });

    it("stays quiet on a blank ANIMATED chart's frame one", () => {
        const onBlankRender = vi.fn();
        const c = document.createElement("div");
        createChartHost(c, { data, code: BLANK_CHART, onBlankRender, animated: true, d3: {} }).render();
        expect(onBlankRender).not.toHaveBeenCalled();
    });

    it("stays quiet when there were no rows to draw", () => {
        const onBlankRender = vi.fn();
        const c = document.createElement("div");
        createChartHost(c, { data: { columns: [{ name: "Region" }], rows: [] },
                             code: BLANK_CHART, onBlankRender, d3: {} }).render();
        expect(onBlankRender).not.toHaveBeenCalled();
    });

    it("warns the console once, not once per repaint", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { /* silence */ });
        try {
            const c = document.createElement("div");
            const h = createChartHost(c, { data, code: BLANK_CHART, d3: {} });
            h.render(); h.render(); h.render();
            expect(warn).toHaveBeenCalledTimes(1);
        } finally { warn.mockRestore(); }
    });

    it("a census failure never breaks the render", () => {
        // The verdict is telemetry. If it throws, the reader must still get their chart.
        const c = document.createElement("div");
        const onBlankRender = () => { throw new Error("consumer blew up"); };
        expect(() => createChartHost(c, { data, code: BLANK_CHART, onBlankRender, d3: {} }).render()).not.toThrow();
    });
});
