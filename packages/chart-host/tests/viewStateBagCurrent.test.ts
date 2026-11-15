// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// THE BAG THE HOST HANDS BACK IS THE ONE THE READER LEFT. When the host owns the view state (no raw setUiState from the
// caller), a chart's setUiState went to provider.save and nowhere else: the bag the host passes as options.uiState on its
// NEXT render stayed the object load() returned at the start. A provider whose save stores a NEW object (a page that keeps
// one row per person in a database, as the audited segments app did) then drew the reader's old choice again on the
// host's next redraw - a resize, a theme switch, a setOptions - so "choose 3 segments" snapped back to Auto within the
// session. setUiState now replaces the host's own bag too (REPLACE semantics, as before), whatever the provider does.

const CODE = `function render(container, data, options) {
  container.__seen = (container.__seen || []).concat([JSON.stringify(options.uiState || null)]);
  container.__set = options.setUiState;
  const m = container.ownerDocument.createElement("div");
  m.className = "d3-mark"; m.setAttribute("data-row-idx", "0");
  container.appendChild(m);
}`;
const DATA = { columns: [{ name: "c" }], rows: [["a", 0]] };

describe("a host-owned view state stays current across the host's own redraws", () => {
    let container: HTMLElement;
    beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
    afterEach(() => { container.remove(); });

    it("with a provider whose save stores a new object, the next render reads the reader's choice", () => {
        const store: { current: Record<string, unknown> } = { current: { segments: { k: "auto" } } };
        const viewState = { load: () => store.current, save: (s: Record<string, unknown>) => { store.current = { ...s }; } };
        const host = createChartHost(container, { data: DATA, code: CODE, d3: {}, options: {}, viewState } as any);
        host.render();
        (container as any).__set({ segments: { k: "3" } });
        host.setOptions({ themeFg: "#111" });
        host.render();
        const seen: string[] = (container as any).__seen;
        expect(JSON.parse(seen[seen.length - 1])).toEqual({ segments: { k: "3" } });
        expect(store.current).toEqual({ segments: { k: "3" } });
        host.destroy();
    });

    it("REPLACE semantics hold: a key the new bag leaves out is gone", () => {
        const viewState = { load: () => ({ a: 1, b: 2 }), save: () => { /* a provider that keeps nothing */ } };
        const host = createChartHost(container, { data: DATA, code: CODE, d3: {}, options: {}, viewState } as any);
        host.render();
        (container as any).__set({ a: 5 });
        host.render();
        const seen: string[] = (container as any).__seen;
        expect(JSON.parse(seen[seen.length - 1])).toEqual({ a: 5 });
        host.destroy();
    });
});
