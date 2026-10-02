// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, useBicControls, type Controls } from "../src/react";
import { readControls } from "../src/controls";

// IN-CHART CONTROLS AS PAGE STATE. A What-if chart draws its own sliders and keeps their values in
// a bag on its container, persisting only when a reader lets go of one. Five of five agent-built
// apps couldn't save a scenario before a slider moved (nothing reported yet), and one labelled a
// monthly rate "/ yr". The host now reads the bag and the chart's own label and readout after
// every render.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Behaves as d3.llmSlider does: restores from options.uiState.knobs, else the default; fills the
// container's bag at init WITHOUT persisting; draws g.llm-slider with a label and a readout; a
// "drag end" (a click on the handle) persists the whole bag through options.setUiState.
const SLIDERS = `
function render(container, data, options) {
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const ui = options.uiState || {};
  const knobs = ui.knobs || {};
  container.__lchKnobs = {};
  const defs = [["rate", 0.055, v => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%", "growth per month"],
                ["horizon", 12, v => v + " months", "horizon"]];
  for (const [key, def, fmt, label] of defs) {
    const v = typeof knobs[key] === "number" ? knobs[key] : def;
    container.__lchKnobs[key] = v;
    const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "llm-slider");
    const l = doc.createElementNS("http://www.w3.org/2000/svg", "text"); l.setAttribute("class", "llm-slider-label"); l.textContent = label;
    const r = doc.createElementNS("http://www.w3.org/2000/svg", "text"); r.setAttribute("class", "llm-slider-readout"); r.textContent = fmt(v);
    const h = doc.createElementNS("http://www.w3.org/2000/svg", "rect"); h.setAttribute("class", "handle-" + key);
    h.addEventListener("click", () => {
      const nv = key === "rate" ? 0.08 : 24;
      container.__lchKnobs[key] = nv; r.textContent = fmt(nv);
      options.setUiState({ ...(options.uiState || {}), knobs: { ...container.__lchKnobs } });
    });
    g.appendChild(l); g.appendChild(r); g.appendChild(h);
    container.appendChild(g);
  }
  container.setAttribute("data-renders", String(Number(container.getAttribute("data-renders") || 0) + 1));
}`;
const DATA = { columns: [{ name: "Year", dataType: "Int64" }], rows: [[2024], [2025]] };
const D3 = {};

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

let ctl: Controls | null = null;
function Page(p: { initial?: Record<string, unknown> }) {
    ctl = useBicControls(p.initial);
    return createElement("div", null,
        createElement("span", { className: "summary" }, ctl.summary),
        createElement(BicChart, { code: SLIDERS, data: DATA as any, d3: D3, className: "proj", labelContrast: false, controls: ctl }));
}
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const summary = () => (el.querySelector(".summary") as HTMLElement).textContent;

describe("useBicControls", () => {
    it("knows the opening values before any slider moves (the live defect: Save had nothing to save)", async () => {
        await act(async () => { root.render(createElement(Page)); });
        await settle();
        expect(ctl!.ready).toBe(true);
        expect(ctl!.values).toEqual({ rate: 0.055, horizon: 12 });
        // The chart's own words, so the unit is the chart's (a monthly rate stays monthly).
        expect(summary()).toBe("growth per month +5.5% · horizon 12 months");
    });

    it("follows a slider the reader moved", async () => {
        await act(async () => { root.render(createElement(Page)); });
        await settle();
        await act(async () => { (el.querySelector(".handle-rate") as Element).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await settle();
        expect(ctl!.values.rate).toBe(0.08);
        expect(summary()).toContain("+8.0%");
    });

    it("applies a saved scenario, and reset returns to the chart's defaults", async () => {
        await act(async () => { root.render(createElement(Page)); });
        await settle();
        await act(async () => { ctl!.set({ rate: 0.02, horizon: 36 }); });
        await settle();
        expect(ctl!.values).toEqual({ rate: 0.02, horizon: 36 });
        expect(summary()).toBe("growth per month +2.0% · horizon 36 months");
        await act(async () => { ctl!.reset(); });
        await settle();
        expect(ctl!.values).toEqual({ rate: 0.055, horizon: 12 });
    });

    it("a value kept across a re-render: a moved slider survives new data", async () => {
        let setData: (d: any) => void = () => {};
        function DataPage() {
            ctl = useBicControls();
            const [data, set] = useState<any>(DATA);
            setData = set;
            return createElement(BicChart, { code: SLIDERS, data, d3: D3, className: "proj", labelContrast: false, controls: ctl });
        }
        await act(async () => { root.render(createElement(DataPage)); });
        await settle();
        await act(async () => { (el.querySelector(".handle-horizon") as Element).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        await settle();
        await act(async () => { setData({ ...DATA, rows: [[2024], [2025], [2026]] }); });
        await settle();
        expect(ctl!.values.horizon).toBe(24);
    });

    it("seeds the first draw with initial values (a scenario restored from a link)", async () => {
        await act(async () => { root.render(createElement(Page, { initial: { rate: 0.01 } })); });
        await settle();
        expect(ctl!.values.rate).toBe(0.01);
    });
});

describe("readControls", () => {
    it("is empty for a chart without controls", () => {
        const d = document.createElement("div");
        expect(readControls(d)).toEqual([]);
    });
});
