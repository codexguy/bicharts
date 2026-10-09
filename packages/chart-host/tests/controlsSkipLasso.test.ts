// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createControls, readControls, attachControls } from "../src/controls";
import { LASSO_KNOB_KEY } from "../src/lasso";

// THE LASSO LIVES IN THE KNOB BAG, BUT IT IS NOT A KNOB (2026-10-09). The bag the in-chart sliders share is
// also where the host keeps a drawn lasso, so that it is persisted with the same write. A page reading its
// chart's controls to save a "scenario" must not be handed a polygon as though it were a slider, and putting
// the sliders back to their defaults must not quietly drop the reader's selection.

const SHAPE = { v: 1, space: "unit", shapes: [{ mode: "free", pts: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] }] };

describe("the controls handle skips the lasso", () => {
    it("the key is the lasso's", () => {
        expect(LASSO_KNOB_KEY).toBe("lasso");
    });

    it("readControls lists the sliders and not the lasso", () => {
        const d = document.createElement("div");
        (d as any).__lchKnobs = { rate: 0.05, lasso: SHAPE, horizon: 12 };
        expect(readControls(d).map(i => i.key)).toEqual(["rate", "horizon"]);
    });

    it("a bag with only a lasso has no controls", () => {
        const d = document.createElement("div");
        (d as any).__lchKnobs = { lasso: SHAPE };
        expect(readControls(d)).toEqual([]);
    });

    it("values hold the sliders' values only, before the chart has reported", () => {
        const d = document.createElement("div");
        const c = createControls();
        const att = attachControls(() => null, d, c);
        att.options.setUiState({ knobs: { rate: 0.07, lasso: SHAPE } });
        expect(c.values).toEqual({ rate: 0.07 });
    });

    it("reset puts the sliders back to their defaults and keeps the reader's lasso", () => {
        const d = document.createElement("div");
        const c = createControls({ rate: 0.5 });
        const att = attachControls(() => null, d, c);
        att.options.setUiState({ knobs: { rate: 0.07, lasso: SHAPE } });
        c.reset();
        expect((att.options.uiState as any).knobs).toEqual({ lasso: SHAPE });
    });

    it("reset with no lasso drops the knobs altogether, as it always has", () => {
        const d = document.createElement("div");
        const c = createControls({ rate: 0.5 });
        const att = attachControls(() => null, d, c);
        att.options.setUiState({ knobs: { rate: 0.07 } });
        c.reset();
        expect((att.options.uiState as any).knobs).toBeUndefined();
    });

    it("set merges over the lasso rather than replacing it", () => {
        const d = document.createElement("div");
        const c = createControls();
        const att = attachControls(() => null, d, c);
        att.options.setUiState({ knobs: { rate: 0.07, lasso: SHAPE } });
        c.set({ rate: 0.2 });
        expect((att.options.uiState as any).knobs).toEqual({ rate: 0.2, lasso: SHAPE });
    });
});
