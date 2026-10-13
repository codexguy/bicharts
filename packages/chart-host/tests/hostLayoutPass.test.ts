// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createChartHost } from "../src/host";
import { LIGHT_TEXT } from "../src/labelContrast";

// THE HOST'S LAYOUT PASS (ChartHostConfig.layoutPass).
//
// A host that moves a legend or grows the viewBox after a render needs one fixed moment to do it: after
// the labels have their colours, and before anything measures marks or the frame (the hit-target heal,
// the selection repaint, the censuses, the fit). These cases pin that moment on both render lanes, on
// every re-render, and that a pass which throws costs the chart nothing.

// A dark tile with one label on it (label contrast recolours the label to white), plus an inert legend
// swatch group the hit-target heal fills with a transparent rect. jsdom has no layout, so the artifact
// stubs its own boxes.
const TILE = `
function render(container, data, options) {
  var doc = container.ownerDocument;
  var NS = "http://www.w3.org/2000/svg";
  var svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("width", String(options.width));
  svg.setAttribute("height", String(options.height));
  var r = doc.createElementNS(NS, "rect");
  r.setAttribute("fill", "#12239e");
  r.setAttribute("class", "d3-mark");
  r.setAttribute("data-row-idx", "0");
  r.getBoundingClientRect = function () { return { x: 0, y: 0, width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 }; };
  var t = doc.createElementNS(NS, "text");
  t.setAttribute("fill", "#252423");
  t.textContent = String(data.rows[0][0]) + (options.aggregation === "sum" ? " (sum)" : "");
  t.getBoundingClientRect = function () { return { x: 120, y: 90, width: 60, height: 20, top: 90, left: 120, right: 180, bottom: 110 }; };
  var lg = doc.createElementNS(NS, "g");
  lg.setAttribute("class", "d3-legend-mark");
  lg.setAttribute("data-row-idx", "0");
  var lt = doc.createElementNS(NS, "text");
  lt.style.pointerEvents = "none";
  lt.textContent = "Legend";
  lg.appendChild(lt);
  lg.getBBox = function () { return { x: 250, y: 10, width: 40, height: 12 }; };
  svg.appendChild(r); svg.appendChild(t); svg.appendChild(lg);
  container.appendChild(svg);
  if (typeof window.__nextRender === "function") return window.__nextRender();
}`;

const payload = { columns: [{ name: "City" }], rows: [["Qingdao"]] };
const OPTIONS = { width: 300, height: 200 } as any;

interface Seen { label: string | null; fill: string | null; healed: boolean; fitDone: boolean }

let container: HTMLElement;
beforeEach(() => {
    document.body.innerHTML = "<div id='c'></div>";
    container = document.getElementById("c")!;
    delete (window as any).__nextRender;
});

function recordingPass(seen: Seen[], fitCalls: { n: number }) {
    return (c: HTMLElement) => {
        const text = c.querySelector("svg > text");
        seen.push({
            label: text?.textContent ?? null,
            fill: text?.getAttribute("fill") ?? null,
            healed: !!c.querySelector('rect[data-lch-hit="1"]'),
            fitDone: fitCalls.n > 0,
        });
    };
}

describe("createChartHost - layoutPass", () => {
    it("runs once per render, and again on setOptions and setData", () => {
        const seen: Seen[] = [];
        const fit = { n: 0 };
        const host = createChartHost(container, {
            data: payload, code: TILE, d3: {}, options: OPTIONS, layoutPass: recordingPass(seen, fit),
        });
        host.render();
        expect(seen).toHaveLength(1);
        host.setOptions({ aggregation: "sum" } as any);
        expect(seen).toHaveLength(2);
        expect(seen[1].label).toBe("Qingdao (sum)");
        host.setData({ columns: payload.columns, rows: [["Lima"]] });
        expect(seen).toHaveLength(3);
        expect(seen[2].label).toBe("Lima (sum)");
        host.destroy();
    });

    it("sees the labels already recoloured, the hit targets not yet healed, and runs before the fit", () => {
        const seen: Seen[] = [];
        const fit = { n: 0 };
        const order: string[] = [];
        const host = createChartHost(container, {
            data: payload, code: TILE, d3: {}, options: OPTIONS,
            onLabelContrast: () => order.push("label-contrast"),
            layoutPass: c => { order.push("layout"); recordingPass(seen, fit)(c); },
            onFit: () => { fit.n++; order.push("fit"); },
        });
        host.render();
        expect(order).toEqual(["label-contrast", "layout", "fit"]);
        expect(seen[0]).toMatchObject({ fill: LIGHT_TEXT, healed: false, fitDone: false });
        // ...and the heal did run after it, so the pass really did see the DOM before it.
        expect(container.querySelector('rect[data-lch-hit="1"]')).not.toBeNull();
        host.destroy();
    });

    it("a pass that throws leaves render() returning, the chart drawn and `rendered` resolved", async () => {
        const fits: number[] = [];
        const host = createChartHost(container, {
            data: payload, code: TILE, d3: {}, options: OPTIONS,
            layoutPass: () => { throw new Error("boom"); },
            onFit: () => fits.push(1),
        });
        expect(() => host.render()).not.toThrow();
        await expect(host.rendered).resolves.toBeUndefined();
        expect(container.querySelector("svg")).not.toBeNull();
        // The passes after it still ran.
        expect(fits).toHaveLength(1);
        expect(container.querySelector('rect[data-lch-hit="1"]')).not.toBeNull();
        host.destroy();
    });

    it("a chart that draws asynchronously gets the pass after it settles, and a superseded draw never does", async () => {
        const gates: Array<() => void> = [];
        (window as any).__nextRender = () => new Promise<void>(res => gates.push(res));
        const seen: Seen[] = [];
        const host = createChartHost(container, {
            data: payload, code: TILE, d3: {}, options: OPTIONS, layoutPass: recordingPass(seen, { n: 0 }),
        });
        host.render();                                   // draw A, pending
        expect(seen).toHaveLength(0);                    // not before it settles
        host.setOptions({ aggregation: "sum" } as any);  // draw B supersedes A
        expect(gates).toHaveLength(2);
        gates[1]();                                      // B settles first
        await host.rendered;
        expect(seen).toHaveLength(1);
        expect(seen[0].label).toBe("Qingdao (sum)");
        gates[0]();                                      // the superseded A settles late
        await new Promise(r => setTimeout(r, 0));
        expect(seen).toHaveLength(1);
        host.destroy();
    });

    it("absent, the host draws exactly what it drew before: the same DOM as a pass that does nothing", () => {
        const a = createChartHost(container, { data: payload, code: TILE, d3: {}, options: OPTIONS });
        a.render();
        const without = container.innerHTML;
        a.destroy();
        let calls = 0;
        const b = createChartHost(container, {
            data: payload, code: TILE, d3: {}, options: OPTIONS, layoutPass: () => { calls++; },
        });
        b.render();
        expect(calls).toBe(1);
        expect(container.innerHTML).toBe(without);
        b.destroy();
    });
});
