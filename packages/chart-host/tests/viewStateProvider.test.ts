// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost, sessionViewStateProvider, noopViewStateProvider } from "../src/host";
import { CONTAINER_SLOT_UI_STATE, type ViewStateProvider } from "../src/contract";

// VIEW-STATE PROVIDERS (contract 1.6.0).
//
// Generated code has always spoken one pair - options.uiState to read, options.setUiState to
// write - and never knew where the bag went. What changed is that WHERE is now a named seam
// instead of a session store hard-coded in the runtime with one host (the Power BI visual)
// bypassing it by passing raw functions. The 3D scatter's camera is the second feature to want
// per-host persistence after a Tabular chart's sort, which is what made the seam worth naming.
//
// The precedence is the thing most likely to be broken by a later edit, and it is the first
// block below: a raw pair wins outright, then an explicit provider, then the session store.
// Getting that wrong silently un-persists the visual, whose bag rides the report file.

const CODE = `function render(container, data, options) {
  const m = container.ownerDocument.createElement("div");
  m.className = "d3-mark"; m.setAttribute("data-row-idx", "0");
  m.textContent = JSON.stringify(options.uiState || {});
  container.appendChild(m);
  container.__setUi = options.setUiState;      // so a test can write the way a chart does
}`;

describe("ViewStateProvider", () => {
    let container: any;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });
    afterEach(() => { container.remove(); });

    const mount = (cfg: any = {}) => createChartHost(container, {
        data: { columns: [{ name: "c" }], rows: [["a"]] }, code: CODE, d3: {}, ...cfg,
    }).render();

    const seen = () => JSON.parse(container.querySelector(".d3-mark").textContent);
    const write = (bag: any) => container.__setUi(bag);

    // ---- precedence -------------------------------------------------------------------

    it("a raw setUiState pair from the caller wins over any provider", () => {
        // This rung is what keeps the Power BI visual byte-identical without porting it: it has
        // persisted into the report file since long before providers existed, by passing the
        // pair directly. If a provider ever displaced it, the visual would quietly stop saving.
        const written: any[] = [];
        const provider: ViewStateProvider = {
            load: () => ({ from: "provider" }),
            save: (n) => { written.push(n); },
        };
        mount({ options: { uiState: { from: "caller" }, setUiState: (s: any) => written.push(s) },
                viewState: provider });
        expect(seen()).toEqual({ from: "caller" });
        write({ x: 1 });
        expect(written).toEqual([{ x: 1 }]);        // the provider never saw it
    });

    it("an explicit provider is used when the caller supplies no pair", () => {
        const store: Record<string, unknown> = { seededBy: "provider" };
        const provider: ViewStateProvider = {
            load: () => store,
            save: (n) => { for (const k of Object.keys(store)) delete store[k]; Object.assign(store, n); },
        };
        mount({ viewState: provider });
        expect(seen()).toEqual({ seededBy: "provider" });
        write({ camera: { yaw: 12 } });
        expect(store).toEqual({ camera: { yaw: 12 } });
    });

    it("falls back to the session store when neither is supplied - the 1.5.0 behaviour", () => {
        mount();
        write({ sort: { key: "Region" } });
        expect(container[CONTAINER_SLOT_UI_STATE]).toEqual({ sort: { key: "Region" } });
    });

    // ---- the session provider, whose semantics 1.5.0 pinned ---------------------------

    it("session state survives a host that destroys and re-creates on the same element", () => {
        // The whole reason 1.5.0 exists: the Excel add-in re-creates the host on every resize
        // and every cell edit, so a chart's resting knob used to reset whenever the pane moved.
        mount();
        write({ page: 3 });
        mount();                                   // a second host on the SAME element
        expect(seen()).toEqual({ page: 3 });
    });

    it("save REPLACES the bag rather than merging, matching setUiState", () => {
        mount();
        write({ a: 1, b: 2 });
        write({ a: 9 });
        expect(container[CONTAINER_SLOT_UI_STATE]).toEqual({ a: 9 });
    });

    it("load() hands back the LIVE store, so a bag read before a save stays current", () => {
        const p = sessionViewStateProvider(container);
        const bag = p.load();
        p.save({ z: 1 });
        expect(bag).toEqual({ z: 1 });
    });

    it("a caller-supplied uiState seeds an EMPTY bag once and never overwrites a real one", () => {
        mount({ options: { uiState: { seed: true } } });
        expect(seen()).toEqual({ seed: true });
        write({ real: 1 });
        // A second mount passes the same stale seed; the reader's own state must win.
        mount({ options: { uiState: { seed: true } } });
        expect(seen()).toEqual({ real: 1 });
    });

    // ---- the no-op provider ------------------------------------------------------------

    it("noop forgets on purpose, which is not the same as having no provider", () => {
        // For a thumbnail capture or a static preview, remembering is WRONG rather than merely
        // absent: a thumbnail has to be the same picture every time it is taken.
        mount({ viewState: noopViewStateProvider() });
        write({ camera: { yaw: 99 } });
        mount({ viewState: noopViewStateProvider() });
        expect(seen()).toEqual({});
        expect(container[CONTAINER_SLOT_UI_STATE]).toBeUndefined();  // and nothing was parked
    });

    // ---- a provider must never be able to stop a chart drawing -------------------------

    it("a provider that throws on load still renders, with an empty bag", () => {
        const angry: ViewStateProvider = {
            load: () => { throw new Error("storage is gone"); },
            save: () => { /* unused */ },
        };
        expect(() => mount({ viewState: angry })).not.toThrow();
        expect(seen()).toEqual({});
        expect(container.querySelectorAll(".d3-mark")).toHaveLength(1);
    });

    it("a provider that throws on save does not break the repaint that triggered it", () => {
        // A chart calls setUiState from inside a gesture handler. If that throws, the gesture
        // dies half-applied and the chart looks frozen - much worse than a lost preference.
        const angry: ViewStateProvider = {
            load: () => ({}),
            save: () => { throw new Error("disk full"); },
        };
        mount({ viewState: angry });
        expect(() => write({ camera: { yaw: 1 } })).not.toThrow();
    });

    it("ignores a non-object write rather than storing rubbish", () => {
        mount();
        write({ good: 1 });
        write(null); write("nope" as any); write(42 as any);
        expect(container[CONTAINER_SLOT_UI_STATE]).toEqual({ good: 1 });
    });
});
