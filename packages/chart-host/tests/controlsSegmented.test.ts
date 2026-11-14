// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createControls, readControls, attachControls } from "../src/controls";

// A CHART'S SEGMENTED CONTROL IS PAGE STATE TOO. A chart can draw a segmented row (d3.llmSegmented: "Compare by Channel |
// Plan | Region") beside or instead of sliders. It keeps the reader's choice in container.__lchSegments and persists it as
// uiState.segments. A page that filters by what the chart compares has to know the choice: reading only the slider bag
// left `values.compare` undefined forever and never told the page the reader had switched, so a click on a Plan curve
// went on filtering by Channel.

function segmented(d: HTMLElement, key: string, label: string, choices: string[], pressed: string) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "llm-segmented");
    g.setAttribute("data-segment-key", key);
    if (label) {
        const t = document.createElementNS(ns, "text");
        t.setAttribute("class", "llm-segmented-label");
        t.textContent = label;
        g.appendChild(t);
    }
    for (const c of choices) {
        const b = document.createElementNS(ns, "g");
        b.setAttribute("class", "llm-segmented-button lch-control");
        b.setAttribute("data-segment-value", c);
        b.setAttribute("aria-pressed", c === pressed ? "true" : "false");
        const t = document.createElementNS(ns, "text");
        t.setAttribute("class", "llm-segmented-text");
        t.textContent = c;
        b.appendChild(t);
        g.appendChild(b);
    }
    svg.appendChild(g);
    d.appendChild(svg);
    (d as any).__lchSegments = { ...((d as any).__lchSegments ?? {}), [key]: pressed };
}

describe("the controls handle reads a segmented row", () => {
    it("readControls lists the segmented choice with its label and the pressed button's words", () => {
        const d = document.createElement("div");
        segmented(d, "compare", "Compare by", ["Channel", "Plan", "Region"], "Plan");
        expect(readControls(d)).toEqual([{ key: "compare", value: "Plan", label: "Compare by", text: "Plan", kind: "segmented" }]);
    });

    it("sliders come first, then the segmented rows, and each says its kind", () => {
        const d = document.createElement("div");
        (d as any).__lchKnobs = { rate: 0.05 };
        segmented(d, "compare", "", ["Channel", "Plan"], "Channel");
        const info = readControls(d);
        expect(info.map(i => [i.key, i.kind])).toEqual([["rate", "slider"], ["compare", "segmented"]]);
    });

    it("a segmented switch reaches the page: values carry it and the page is told", async () => {
        const d = document.createElement("div");
        const c = createControls();
        const att = attachControls(() => null, d, c);
        segmented(d, "compare", "Compare by", ["Channel", "Plan"], "Channel");
        att.read();
        expect(c.values).toEqual({ compare: "Channel" });
        let told = 0;
        c.onChange(() => { told++; });
        // The reader presses Plan: the helper updates its bag and persists the whole uiState.
        d.innerHTML = "";
        segmented(d, "compare", "Compare by", ["Channel", "Plan"], "Plan");
        att.options.setUiState({ segments: { compare: "Plan" } });
        await Promise.resolve(); await Promise.resolve();
        expect(c.values).toEqual({ compare: "Plan" });
        expect(told).toBeGreaterThan(0);
    });

    it("before the chart has drawn, values fall back to the persisted segments", () => {
        const d = document.createElement("div");
        const c = createControls();
        const att = attachControls(() => null, d, c);
        att.options.setUiState({ segments: { compare: "Region" } });
        expect(c.values).toEqual({ compare: "Region" });
    });

    it("set puts a segmented key where the helper reads it, and a slider where sliders are read", () => {
        const d = document.createElement("div");
        const c = createControls();
        const att = attachControls(() => null, d, c);
        (d as any).__lchKnobs = { rate: 0.05 };
        segmented(d, "compare", "Compare by", ["Channel", "Plan"], "Channel");
        att.read();
        c.set({ compare: "Plan", rate: 0.07 });
        expect((att.options.uiState as any).segments).toEqual({ compare: "Plan" });
        expect((att.options.uiState as any).knobs).toEqual({ rate: 0.07 });
    });

    it("reset drops the segmented choice too, so the chart draws its own default", () => {
        const d = document.createElement("div");
        const c = createControls();
        const att = attachControls(() => null, d, c);
        att.options.setUiState({ segments: { compare: "Plan" } });
        c.reset();
        expect((att.options.uiState as any).segments).toBeUndefined();
    });

    it("a chart with sliders only reads exactly as before", () => {
        const d = document.createElement("div");
        (d as any).__lchKnobs = { rate: 0.05, horizon: 12 };
        expect(readControls(d).map(i => i.key)).toEqual(["rate", "horizon"]);
        expect(readControls(d).every(i => i.kind === "slider")).toBe(true);
    });
});
