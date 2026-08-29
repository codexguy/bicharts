// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { CONTAINER_SLOT_UI_STATE } from "../src/contract";

// SESSION VIEW-STATE (contract 1.5.0).
//
// A chart that lets the reader move something - a slider, a base date, an expanded path - has to
// put that somewhere, and until now "somewhere" meant whatever the HOST supplied. The Power BI
// visual supplies a persisted pair; the Excel add-in supplies neither AND destroys and re-creates
// the host on the same element on every resize and every cell edit; the MCP preview passed an
// explicit no-op. So the same chart kept its knob in one host and silently reset it in the other
// two - a parity gap in the shared layer, which is exactly where it should not be.
//
// The store is parked on the CONTAINER because the element is the only thing that outlives the
// host object across those re-creations. It dies with the element, which is the session the
// add-in means.

const CODE = `function render(container, data, options) {
  container.__seenOptions = options;
  const m = container.ownerDocument.createElement("div");
  m.className = "d3-mark"; m.setAttribute("data-row-idx", "0");
  container.appendChild(m);
}`;

const DATA = { columns: [{ name: "c" }], rows: [["a", 0]] };

describe("session view-state store", () => {
    let container: HTMLElement;

    const mount = (options?: Record<string, unknown>, el: HTMLElement = container) => {
        const host = createChartHost(el, { data: DATA, code: CODE, d3: {}, options });
        host.render();
        return { host, seen: (el as any).__seenOptions as Record<string, any> };
    };

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });
    afterEach(() => { container.remove(); });

    it("installs a bag and a setter when the caller supplies neither", () => {
        const { seen } = mount();
        expect(seen.uiState).toBeTypeOf("object");
        expect(seen.uiState).not.toBeNull();
        expect(seen.setUiState).toBeTypeOf("function");
    });

    it("survives destroy and re-creation on the SAME element - the add-in's resize path", () => {
        // This is the whole point of the foundation. The add-in calls replaceChildren() and then
        // create(container, …) again on every draw, so anything the chart parked on the HOST is
        // gone by the time it renders again. Anything on the ELEMENT is not.
        const first = mount();
        first.seen.setUiState({ knobs: { rate: 0.04, horizon: 12 } });
        first.host.destroy();

        const second = mount();
        expect(second.seen.uiState).toEqual({ knobs: { rate: 0.04, horizon: 12 } });
    });

    it("REPLACES rather than merges, matching the visual's persist semantics", () => {
        // The visual's persistUiState writes the whole bag. If the shared store merged instead,
        // a chart would behave differently in the two hosts - which is the drift this exists to
        // prevent. A chart that wants to keep sibling keys reads uiState and merges ITSELF, which
        // is what d3.llmSlider does with its single shared knobs bag.
        const { seen } = mount();
        seen.setUiState({ a: 1 });
        seen.setUiState({ b: 2 });
        expect(seen.uiState).toEqual({ b: 2 });
    });

    it("ignores a non-object write instead of corrupting the bag", () => {
        const { seen } = mount();
        seen.setUiState({ a: 1 });
        seen.setUiState(null);
        seen.setUiState("nonsense");
        expect(seen.uiState).toEqual({ a: 1 });
    });

    it("leaves a caller-supplied setter alone - the Power BI visual's path", () => {
        const writes: unknown[] = [];
        const mine = { frame: 3 };
        const { seen } = mount({ uiState: mine, setUiState: (s: unknown) => writes.push(s) });
        expect(seen.uiState).toBe(mine);              // the caller's object, not a copy in a store
        seen.setUiState({ frame: 4 });
        expect(writes).toEqual([{ frame: 4 }]);       // and the caller's setter is what ran
        expect((container as any)[CONTAINER_SLOT_UI_STATE]).toBeUndefined();
    });

    it("seeds from a caller uiState ONCE, and a later stale seed never overwrites the reader", () => {
        // A host may pass a starting bag without a setter (a saved default). It seeds an empty
        // store - but on the next re-creation the store holds what the READER left, and handing
        // the same starting bag again must not undo them.
        const { seen } = mount({ uiState: { knobs: { rate: 0.02 } } });
        expect(seen.uiState).toEqual({ knobs: { rate: 0.02 } });
        seen.setUiState({ knobs: { rate: 0.09 } });

        const again = mount({ uiState: { knobs: { rate: 0.02 } } });
        expect(again.seen.uiState).toEqual({ knobs: { rate: 0.09 } });
    });

    it("gives a different container a different store", () => {
        const other = document.createElement("div");
        document.body.appendChild(other);
        try {
            const a = mount();
            a.seen.setUiState({ who: "a" });
            const b = mount(undefined, other);
            expect(b.seen.uiState).toEqual({});
            expect(a.seen.uiState).toEqual({ who: "a" });
        } finally {
            other.remove();
        }
    });

    it("adopts a store an earlier host already parked, rather than starting a new one", () => {
        (container as any)[CONTAINER_SLOT_UI_STATE] = { knobs: { rate: 0.07 } };
        const { seen } = mount();
        expect(seen.uiState).toBe((container as any)[CONTAINER_SLOT_UI_STATE]);
        expect(seen.uiState).toEqual({ knobs: { rate: 0.07 } });
    });
});
