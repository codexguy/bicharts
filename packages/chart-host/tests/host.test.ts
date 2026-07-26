// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createChartHost } from "../src/host";
import { loadGeo } from "../src/geoLazy";

// The createChartHost runtime vs a SYNTHETIC contract-conformant archetype. The real
// shipping archetypes are locked to the same grammar by the d3gate conformance gate
// (server-side), so runtime↔contract here plus
// archetype↔contract there closes the chain without cross-repo test reads.
//
// The synthetic chart: one div.d3-mark per row (data-row-idx = its index), three
// div.d3-axis-filter period ticks that on click dispatch llm-xfilter-refresh and
// RE-BIND the marks' data-row-idx frame-scoped, the three __llm* container slots,
// and a stamp of the resolved options so re-render effects are observable.
const SYNTH = `
function render(container, data, options) {
  if (container.__llmAnimStop) { try { container.__llmAnimStop(); } catch (e) {} }
  container.setAttribute("data-speed", String(options.animPlaySpeedMs));
  container.setAttribute("data-frames", String(options.animMaxIdealFrames));
  container.setAttribute("data-agg", String(options.aggregation));
  container.setAttribute("data-geo", options.geo ? String(options.geo.features.length) : "none");
  const doc = container.ownerDocument;
  const marks = [];
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    container.appendChild(m); marks.push(m);
  }
  let sel = null;
  const ticks = [];
  for (let i = 0; i < 3; i++) {
    const t = doc.createElement("div");
    t.className = "tk d3-axis-filter";
    t.setAttribute("data-row-idx", data.rows.map((_, r) => r).filter(r => r % 3 === i).join(","));
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      const detail = (sel === i)
        ? { clear: true, source: "user" }
        : { mark: t, source: "user" };
      sel = (sel === i) ? null : i;
      for (let r = 0; r < marks.length; r++)
        marks[r].setAttribute("data-row-idx", sel == null ? String(r) : (r % 3 === sel ? String(r) : ""));
      container.dispatchEvent(new container.ownerDocument.defaultView.CustomEvent("llm-xfilter-refresh", { bubbles: true, detail }));
    });
    container.appendChild(t); ticks.push(t);
  }
  let stopped = 0;
  container.__llmAnimStop = () => { stopped++; container.setAttribute("data-stopped", String(stopped)); };
  container.__llmXfClear = () => { sel = null;
    container.dispatchEvent(new container.ownerDocument.defaultView.CustomEvent("llm-xfilter-refresh", { bubbles: true, detail: { clear: true, source: "user" } })); };
  container.__llmInitialXfMark = ticks[0];
}`;

const DATA = { columns: [{ name: "C" }, { name: "__rowIdx__" }], rows: [[
    "a", 0], ["b", 1], ["c", 2], ["d", 3], ["e", 4], ["f", 5]] };

let container: HTMLElement;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });

const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("createChartHost runtime", () => {
    it("compiles + renders, resolves options through the shared defaults", () => {
        const host = createChartHost(container, { data: DATA, code: SYNTH });
        host.render();
        expect(container.querySelectorAll(".d3-mark").length).toBe(6);
        expect(container.getAttribute("data-speed")).toBe("1000");   // default via resolveOptions
        expect(container.getAttribute("data-frames")).toBe("60");
        host.destroy();
    });

    it("mark click notifies selection with parsed row idxs", () => {
        const host = createChartHost(container, { data: DATA, code: SYNTH });
        host.render();
        const got: number[][] = [];
        host.selection.onChange(idx => got.push(idx));
        click(container.querySelectorAll(".d3-mark")[2]);
        expect(got).toEqual([[2]]);
        expect(host.selection.current).toEqual([2]);
        host.destroy();
    });

    it("scrubber tick click flows through the chart event exactly once (no double-fire)", () => {
        const host = createChartHost(container, { data: DATA, code: SYNTH });
        host.render();
        const calls: Array<{ idx: number[]; src: string }> = [];
        host.selection.onChange((idx, src) => calls.push({ idx, src }));
        click(container.querySelectorAll(".d3-axis-filter")[1]);     // periods 1,4
        expect(calls.length).toBe(1);
        expect(calls[0].idx).toEqual([1, 4]);
        click(container.querySelectorAll(".d3-axis-filter")[1]);     // same tick -> clear
        expect(calls.length).toBe(2);
        expect(calls[1].idx).toEqual([]);
        host.destroy();
    });

    it("selection.clear() uses the chart's __llmXfClear slot", () => {
        const host = createChartHost(container, { data: DATA, code: SYNTH });
        host.render();
        const got: number[][] = [];
        host.selection.onChange(idx => got.push(idx));
        click(container.querySelectorAll(".d3-axis-filter")[0]);
        host.selection.clear();
        expect(got[got.length - 1]).toEqual([]);
        host.destroy();
    });

    it("setOptions re-renders live (the restyle path) and stops the old timer first", () => {
        const host = createChartHost(container, { data: DATA, code: SYNTH });
        host.render();
        host.setOptions({ animPlaySpeedMs: 2500, animMaxIdealFrames: 180, aggregation: "average" });
        expect(container.getAttribute("data-speed")).toBe("2500");
        expect(container.getAttribute("data-frames")).toBe("180");
        expect(container.getAttribute("data-agg")).toBe("average");
        // Contract discipline, belt AND suspenders: the runtime calls the OLD render's
        // __llmAnimStop before repainting (1), and the archetype's own first line also
        // calls the still-attached old slot defensively (2) — exactly like the real
        // archetypes. The stamp lives on the container so it survives the innerHTML clear.
        expect(container.getAttribute("data-stopped")).toBe("2");
        let threw = null; try { host.animation.stop(); } catch (e) { threw = e; }
        expect(threw).toBeNull();                                    // the NEW slot is callable
        host.destroy();
    });

    it("clamps flow through: out-of-range raw values land clamped", () => {
        const host = createChartHost(container, { data: DATA, code: SYNTH, options: { animPlaySpeedMs: 99999, animMaxIdealFrames: 1 } });
        host.render();
        expect(container.getAttribute("data-speed")).toBe("5000");
        expect(container.getAttribute("data-frames")).toBe("3");
        host.destroy();
    });

    // GAP-11 (approved 2026-07-26): geoKind no longer auto-attaches geometry, because
    // the static import that made that possible put ~1.3 MB of FeatureCollections in the
    // entry bundle for every consumer — 1,423 KB → 138 KB once it went lazy. Geometry now
    // arrives one of three ways: await loadGeo(kind), a geoProvider, or options.geo.
    it("geoKind attaches the world geometry once loadGeo has resolved it", async () => {
        await loadGeo("country-iso3");
        const host = createChartHost(container, { data: DATA, code: SYNTH, geoKind: "country-iso3" });
        host.render();
        const n = Number(container.getAttribute("data-geo"));
        expect(n).toBeGreaterThan(150);   // world-110m has ~239 features (polys + hubs)
        host.destroy();
    });

    it("geoProvider supplies geometry synchronously for a host that already holds it", () => {
        const fake = { type: "FeatureCollection", features: new Array(200).fill({ id: "X" }) };
        const host = createChartHost(container, {
            data: DATA, code: SYNTH, geoKind: "us-state-code", geoProvider: () => fake,
        });
        host.render();
        expect(Number(container.getAttribute("data-geo"))).toBe(200);
        host.destroy();
    });

    it("warns but still renders when geoKind is set and no geometry is available", () => {
        // The failure this replaces was silent: a map that drew with no basemap and no
        // explanation. It must say what to do, and it must NOT refuse to draw.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const host = createChartHost(container, { data: DATA, code: SYNTH, geoKind: "us-zip5" });
        host.render();
        expect(container.getAttribute("data-geo")).toBe("none");
        expect(container.querySelectorAll(".d3-mark").length).toBeGreaterThan(0);   // still drew
        const msg = String(warn.mock.calls[0]?.[0] ?? "");
        expect(msg).toContain("loadGeo");
        expect(msg).toContain("geoProvider");
        warn.mockRestore();
        host.destroy();
    });

    it("initialMark exposes __llmInitialXfMark; destroy tears down", () => {
        const host = createChartHost(container, { data: DATA, code: SYNTH });
        host.render();
        expect(host.initialMark()).not.toBeNull();
        const got: number[][] = [];
        host.selection.onChange(idx => got.push(idx));
        host.destroy();
        expect(container.innerHTML).toBe("");
        click(container);                                            // no listeners left
        expect(got.length).toBe(0);
    });
});
