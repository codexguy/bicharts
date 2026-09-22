// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createChartHost } from "../src/host";
import { loadGeo } from "../src/geoLazy";
import { MARK_SELECTED_CLASS } from "../src/contract";

// The createChartHost runtime vs a SYNTHETIC contract-conformant archetype. The real
// shipping archetypes are locked to the same grammar by the server-side conformance gate
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

    it("an unsent allowTooltips reaches the chart as true; an explicit false stays false", () => {
        // This runtime draws no host tooltip, so a host that never mentions the flag must leave
        // hover to the chart. Only an explicit false (a host with its own tooltip) turns it off.
        const TIPS = `function render(container, data, options) {
          container.setAttribute("data-tips", String(options.allowTooltips));
        }`;
        const unsent = createChartHost(container, { data: DATA, code: TIPS });
        unsent.render();
        expect(container.getAttribute("data-tips")).toBe("true");
        expect(unsent.options.allowTooltips).toBe(true);
        unsent.destroy();

        const off = createChartHost(container, { data: DATA, code: TIPS, options: { allowTooltips: false } });
        off.render();
        expect(container.getAttribute("data-tips")).toBe("false");
        // A restyle that CLEARS the key falls back to the default, and one that sends false
        // switches it off again - the default is applied on every resolve, not only at creation.
        off.setOptions({ allowTooltips: undefined });
        expect(container.getAttribute("data-tips")).toBe("true");
        off.setOptions({ allowTooltips: false });
        expect(container.getAttribute("data-tips")).toBe("false");
        off.destroy();
    });
});

// A chart that throws the INVALID sentinel has stopped on purpose: a column it is built on is
// gone. With onInvalidSentinel a host hears the reason instead of a crash; without it nothing
// about render() changes, so an existing host keeps exactly the behaviour it had.
describe("createChartHost onInvalidSentinel", () => {
    const THROWS_SENTINEL = `function render(container, data, options) {
      const m = container.ownerDocument.createElement("div");
      m.className = "d3-mark"; m.setAttribute("data-row-idx", "0");
      container.appendChild(m);   // a half-built frame, as a real chart leaves one
      throw new Error('INVALID:column "X" not found');
    }`;

    it("supplied: called once with the reason, render() returns normally, the container is empty", () => {
        const calls: Array<{ reason: string; message: string }> = [];
        const blank = vi.fn();
        const fit = vi.fn();
        const host = createChartHost(container, {
            data: DATA, code: THROWS_SENTINEL,
            onInvalidSentinel: info => calls.push(info),
            onBlankRender: blank, onFit: fit,
        });
        let threw: unknown = null;
        try { host.render(); } catch (e) { threw = e; }
        expect(threw).toBeNull();
        expect(calls.length).toBe(1);
        expect(calls[0].reason).toBe('column "X" not found');
        expect(calls[0].message).toContain('INVALID:column "X" not found');
        expect(container.innerHTML).toBe("");
        // Nothing was drawn, so no post-render pass speaks about it.
        expect(blank).not.toHaveBeenCalled();
        expect(fit).not.toHaveBeenCalled();
        host.destroy();
    });

    it("absent: render() throws, and the message still carries the sentinel", () => {
        const host = createChartHost(container, { data: DATA, code: THROWS_SENTINEL });
        let threw: any = null;
        try { host.render(); } catch (e) { threw = e; }
        expect(threw).toBeInstanceOf(Error);
        expect(String(threw.message)).toContain("INVALID:");
        host.destroy();
    });

    it("supplied: an ordinary throw is NOT a sentinel and still rethrows", () => {
        const calls: unknown[] = [];
        const host = createChartHost(container, {
            data: DATA, d3: {},
            code: `function render(container, data, options) { throw new TypeError("Cannot read properties of undefined (reading 'x')"); }`,
            onInvalidSentinel: info => calls.push(info),
        });
        let threw: any = null;
        try { host.render(); } catch (e) { threw = e; }
        expect(threw).toBeInstanceOf(TypeError);
        expect(calls.length).toBe(0);
        host.destroy();
    });

    it("the chart draws again on the next data change once the column is back", () => {
        const calls: unknown[] = [];
        const NEEDS_X = `function render(container, data, options) {
          if (data.columns.findIndex(c => c.name === "X") === -1) throw new Error('INVALID:column "X" not found');
          const m = container.ownerDocument.createElement("div");
          m.className = "d3-mark"; m.setAttribute("data-row-idx", "0");
          container.appendChild(m);
        }`;
        const host = createChartHost(container, {
            data: { columns: [{ name: "Y" }], rows: [[1]] }, code: NEEDS_X,
            onInvalidSentinel: info => calls.push(info),
        });
        host.render();
        expect(calls.length).toBe(1);
        expect(container.querySelectorAll(".d3-mark").length).toBe(0);
        host.setData({ columns: [{ name: "X" }], rows: [[1]] });
        expect(calls.length).toBe(1);
        expect(container.querySelectorAll(".d3-mark").length).toBe(1);
        host.destroy();
    });
});

// A GENERATED CHART MAY DRAW ASYNCHRONOUSLY. A drawing library with no synchronous API leaves
// the chart's own render() returning a PROMISE, and every post-render pass — label contrast,
// hit-target heal, census, fit — measures the frame BEFORE the chart unless it waits for that
// promise. render() itself still returns void, so no existing call site changes; `host.rendered`
// is how a caller waits for the same moment the passes wait for.
describe("createChartHost — a render() that returns a promise", () => {
    const drawMarks = (c: HTMLElement, n: number) => {
        const d = c.ownerDocument;
        for (let r = 0; r < n; r++) {
            const m = d.createElement("div");
            m.className = "d3-mark";
            m.setAttribute("data-row-idx", String(r));
            c.appendChild(m);
        }
    };

    it("waits: the post-render passes run only once the promise settles, then `rendered` resolves", async () => {
        let letItDraw: () => void = () => {};
        const gate = new Promise<void>(r => { letItDraw = r; });
        const host = createChartHost(container, {
            data: DATA,
            renderFn: c => gate.then(() => drawMarks(c, DATA.rows.length)),
        });
        // A selection from elsewhere. Repainting it onto the marks the chart just built is one
        // of the passes, so it doubles as proof they ran against the DOM the chart drew rather
        // than against the empty container that was there when render() returned.
        host.selection.highlight([1]);
        host.render();
        expect(container.querySelectorAll(".d3-mark").length).toBe(0);      // nothing drawn yet
        letItDraw();
        await host.rendered;
        expect(container.querySelectorAll(".d3-mark").length).toBe(DATA.rows.length);
        expect(container.querySelector('.d3-mark[data-row-idx="1"]')!.classList
            .contains(MARK_SELECTED_CLASS)).toBe(true);
        host.destroy();
    });

    it("a REJECTED promise rejects `rendered`, carrying the error explainRenderFailure produced", async () => {
        const host = createChartHost(container, {
            data: DATA, d3: {},                       // a d3 with no sankey attached
            renderFn: () => Promise.reject(new TypeError("d3.sankey is not a function")),
        });
        expect(() => host.render()).not.toThrow();    // the failure is async; render() cannot throw it
        await expect(host.rendered).rejects.toThrow(/d3-sankey/);
        host.destroy();
    });

    it("a SYNCHRONOUS chart is untouched: the passes ran before render() returned, and `rendered` is already resolved", async () => {
        const blank = vi.fn();
        const host = createChartHost(container, {
            data: DATA, onBlankRender: blank,
            renderFn: c => { drawMarks(c, DATA.rows.length); },              // returns undefined
        });
        host.selection.highlight([2]);
        host.render();
        // No await anywhere: everything the async lane has to wait for has already happened.
        expect(container.querySelectorAll(".d3-mark").length).toBe(DATA.rows.length);
        expect(container.querySelector('.d3-mark[data-row-idx="2"]')!.classList
            .contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(blank).not.toHaveBeenCalled();
        // ALREADY resolved, not merely quick — a microtask beats a zero-delay macrotask every time.
        const first = await Promise.race([
            host.rendered.then(() => "resolved"),
            new Promise(r => setTimeout(() => r("pending"), 0)),
        ]);
        expect(first).toBe("resolved");
        host.destroy();
    });

    it("the LATER render wins: a superseded async render never runs its post-render passes", async () => {
        let letFirstFinish: () => void = () => {};
        const gate = new Promise<void>(r => { letFirstFinish = r; });
        const blank = vi.fn();
        let call = 0;
        const host = createChartHost(container, {
            data: DATA, onBlankRender: blank,
            renderFn: c => {
                if (++call === 1) return gate;                  // the slow one: draws nothing, ever
                drawMarks(c, DATA.rows.length);                 // the one that supersedes it
            },
        });
        host.render();                                          // in flight
        host.setOptions({ aggregation: "average" });            // arrives mid-draw and wins
        expect(container.querySelectorAll(".d3-mark").length).toBe(DATA.rows.length);
        const afterSecond = host.rendered;
        letFirstFinish();
        await gate;                                             // the stale continuation has now run
        await afterSecond;
        // The stale render painted no marks against six rows; had its census run, it would have
        // said so — and its fit/contrast passes would have measured the winner's DOM.
        expect(blank).not.toHaveBeenCalled();
        expect(container.querySelectorAll(".d3-mark").length).toBe(DATA.rows.length);
        host.destroy();
    });

    it("an async rejection carrying the INVALID sentinel still reaches onInvalidSentinel", async () => {
        const calls: Array<{ reason: string; message: string }> = [];
        const host = createChartHost(container, {
            data: DATA,
            renderFn: c => {
                drawMarks(c, 1);                                // a half-built frame, as a real chart leaves one
                return Promise.reject(new Error('INVALID:column "X" not found'));
            },
            onInvalidSentinel: info => calls.push(info),
        });
        host.render();
        await host.rendered;                                    // a data state is not a render FAILURE
        expect(calls.length).toBe(1);
        expect(calls[0].reason).toBe('column "X" not found');
        expect(container.innerHTML).toBe("");
        host.destroy();
    });

    it("without a sentinel handler an async sentinel rejects, exactly as the synchronous one throws", async () => {
        const host = createChartHost(container, {
            data: DATA, d3: {},
            renderFn: () => Promise.reject(new Error('INVALID:column "X" not found')),
        });
        host.render();
        await expect(host.rendered).rejects.toThrow(/INVALID:/);
        host.destroy();
    });

    it("a SYNCHRONOUS sentinel still reaches onInvalidSentinel, and `rendered` resolves", async () => {
        const calls: Array<{ reason: string; message: string }> = [];
        const host = createChartHost(container, {
            data: DATA,
            renderFn: () => { throw new Error('INVALID:column "X" not found'); },
            onInvalidSentinel: info => calls.push(info),
        });
        expect(() => host.render()).not.toThrow();
        expect(calls.length).toBe(1);
        await expect(host.rendered).resolves.toBeUndefined();
        host.destroy();
    });

    it("gives up on a promise that never settles rather than waiting forever", async () => {
        vi.useFakeTimers();
        try {
            const host = createChartHost(container, {
                data: DATA,
                renderFn: () => new Promise<void>(() => { /* settles never */ }),
            });
            host.render();
            const rendered = host.rendered;
            await vi.advanceTimersByTimeAsync(15000);
            await expect(rendered).rejects.toThrow(/did not finish drawing/);
            host.destroy();
        } finally {
            vi.useRealTimers();
        }
    });
});
