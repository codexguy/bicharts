// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { censusCategoryColours, MAX_LISTED_PAIRS } from "../src/categoryColours";
import type { CategoryColourCensus } from "../src/categoryColours";
import { MARK_CLASS, LEGEND_MARK_CLASS, ROW_IDX_ATTR, CATEGORY_DELTA_E_FLOOR } from "../src/contract";
import { createChartHost } from "../src/host";
import * as pkg from "../src/index";

// THE FLOOR, ON THE COLOURS AS PAINTED. Two categories must sit at least CATEGORY_DELTA_E_FLOOR (25) apart by CIEDE2000,
// measured on each colour blended at its own opacity over the page; marks a selection dims are exempt. The census
// reports every pair under it as a finding and never repaints. The distances under simulated red-green colour vision
// (Machado 2009, severity 1, in linear sRGB) are reported for the record, with no verdict.
//
// Reference numbers are the offline painted-colour table's (the same CIEDE2000 and the same matrices, computed there).

let dom: JSDOM;
let doc: Document;
let container: any;
const SVG = "http://www.w3.org/2000/svg";

function mark(fill: string, i: number, attrs: Record<string, string> = {}) {
    const el = doc.createElementNS(SVG, "circle") as any;
    el.setAttribute("fill", fill);
    el.setAttribute("class", `dot ${MARK_CLASS}`);
    el.setAttribute(ROW_IDX_ATTR, String(i));
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    container.appendChild(el);
}
function paint(colours: string[], attrs: Record<string, string> = {}, per = 5) {
    let i = 0;
    for (const c of colours) for (let k = 0; k < per; k++) mark(c, i++, attrs);
}

// The set a reader could not tell apart (8.2 and 10.0); the set a reader could (closest 20.9, still under 25 twice);
// a chart's four workbook slots as painted at 0.8; a well-spread four.
const FIRST = ["#8cbc6c", "#516992", "#7ba061", "#71809d"];
const SECOND = ["#7092b8", "#f69c46", "#aa49bd", "#cf9dfb"];
const WORKBOOK_AT_08 = ["#70ad47", "#264478", "#5a8a39", "#4e6286"];
const SPREAD = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728"];

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><svg id='c'></svg></body></html>");
    doc = dom.window.document as any;
    container = doc.getElementById("c");
});

describe("the category-colour census holds the painted colours to the floor", () => {
    it("the floor is 25 and is exported from the package root", () => {
        expect(CATEGORY_DELTA_E_FLOOR).toBe(25);
        expect(pkg.CATEGORY_DELTA_E_FLOOR).toBe(25);
    });

    it("the set a reader could tell apart still has two pairs under 25, listed closest first", () => {
        paint(SECOND);
        const c = censusCategoryColours(container, doc);
        expect(c.floor).toBe(25);
        expect(c.belowFloor).toBe(true);
        expect(c.pairsBelowFloorCount).toBe(2);
        expect(c.pairsBelowFloor.map(p => p.deltaE)).toEqual([20.9, 22.4]);
        expect(c.pairsBelowFloor[0].colours.slice().sort()).toEqual(["#7092b8", "#cf9dfb"]);
        expect(c.closestPairPainted.slice().sort()).toEqual(["#7092b8", "#cf9dfb"]);
    });

    it("the floor is applied AS PAINTED: a chart's slots drawn at 0.8 report the painted distances", () => {
        paint(WORKBOOK_AT_08, { "fill-opacity": "0.8" });
        const c = censusCategoryColours(container, doc);
        expect(c.belowFloor).toBe(true);
        expect(c.closestDeltaEPainted!).toBeCloseTo(8.2, 0);
        expect(c.pairsBelowFloor.map(p => Math.round(p.deltaE))).toEqual([8, 10]);
    });

    it("a well-spread set clears the floor: nothing listed", () => {
        paint(SPREAD);
        const c = censusCategoryColours(container, doc);
        expect(c.closestDeltaEPainted!).toBeGreaterThanOrEqual(25);
        expect(c.belowFloor).toBe(false);
        expect(c.pairsBelowFloorCount).toBe(0);
        expect(c.pairsBelowFloor).toEqual([]);
    });

    it("dimmed marks are exempt: a set that clears the floor painted is not below it for its dimmed distance", () => {
        paint(SPREAD);
        const c = censusCategoryColours(container, doc);
        expect(c.closestDeltaEDimmed!).toBeLessThan(25);
        expect(c.belowFloor).toBe(false);
    });

    it("the red-green simulated distances are reported, and carry no verdict", () => {
        paint(SECOND);
        const c = censusCategoryColours(container, doc);
        expect(c.closestDeltaEDeutan!).toBeCloseTo(9.8, 0);
        expect(c.closestDeltaEProtan!).toBeCloseTo(12.1, 0);
        expect(c.pairsBelowFloorCount).toBe(2);              // the floor is typical vision's only
        container.innerHTML = "";
        paint(FIRST);
        const d = censusCategoryColours(container, doc);
        expect(d.closestDeltaEDeutan!).toBeCloseTo(8.0, 0);
        expect(d.closestDeltaEProtan!).toBeCloseTo(8.2, 0);
    });

    it("lists at most MAX_LISTED_PAIRS pairs but counts them all", () => {
        // Five distinct hues, each drawn in three near-identical shades: three pairs under 25 per hue, fifteen in all.
        const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
        const hues = [[200, 40, 40], [40, 150, 40], [40, 60, 200], [220, 160, 20], [140, 40, 150]];
        paint(hues.flatMap(([r, g, b]) => [hex(r, g, b), hex(r + 8, g, b), hex(r, g + 8, b)]), {}, 2);
        const c = censusCategoryColours(container, doc);
        expect(c.declined).toBe("");
        expect(c.pairsBelowFloorCount).toBeGreaterThan(MAX_LISTED_PAIRS);
        expect(c.pairsBelowFloor.length).toBe(MAX_LISTED_PAIRS);
        const ds = c.pairsBelowFloor.map(p => p.deltaE);
        expect(ds).toEqual(ds.slice().sort((a, b) => a - b));
    });

    it("ten categorical colours are held to the floor, not declined as a ramp; a sequential ramp still declines", () => {
        paint(["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"], {}, 2);
        const cat = censusCategoryColours(container, doc);
        expect(cat.declined).toBe("");
        expect(cat.slots).toBe(10);
        expect(cat.belowFloor).toBe(true);
        container.innerHTML = "";
        const lerp = (a: number[], b: number[], t: number) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
        const hex = (c: number[]) => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
        paint(Array.from({ length: 9 }, (_, i) => hex(lerp([247, 251, 255], [8, 48, 107], i / 8))), {}, 2);
        expect(censusCategoryColours(container, doc).declined).toBe("ramp");
    });

    it("declined or empty: no finding", () => {
        paint(["#4e79a7"]);
        const c = censusCategoryColours(container, doc);
        expect(c.belowFloor).toBeNull();
        expect(c.pairsBelowFloorCount).toBe(0);
        expect(c.closestDeltaEDeutan).toBeNull();
        expect(c.floor).toBe(25);
    });

    it("the legend's colours are the ones held to the floor when there is a legend", () => {
        for (const f of SECOND) {
            const s = doc.createElementNS(SVG, "rect") as any;
            s.setAttribute("fill", f);
            s.setAttribute("class", LEGEND_MARK_CLASS);
            container.appendChild(s);
        }
        paint(SPREAD);
        const c = censusCategoryColours(container, doc);
        expect(c.source).toBe("legend");
        expect(c.pairsBelowFloorCount).toBe(2);
    });

    it("never repaints, even with pairs under the floor", () => {
        paint(FIRST);
        const before = container.innerHTML;
        const c = censusCategoryColours(container, doc);
        expect(c.belowFloor).toBe(true);
        expect(container.innerHTML).toBe(before);
    });
});

describe("the host hands the finding to onCategoryColourCensus and leaves the chart as painted", () => {
    it("pairs under the floor reach the callback; the marks keep their fills", async () => {
        const code = `function render(container, data) {
  const d = container.ownerDocument, svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
  container.appendChild(svg);
  const colours = ${JSON.stringify(SECOND)};
  data.rows.forEach((r, i) => { const c = d.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", "d3-mark"); c.setAttribute("data-row-idx", String(i)); c.setAttribute("fill", colours[i % 4]); svg.appendChild(c); });
}`;
        const el = document.createElement("div");
        document.body.appendChild(el);
        const seen: CategoryColourCensus[] = [];
        const host = createChartHost(el, {
            data: { columns: [{ name: "g" }, { name: "__rowIdx__" }], rows: Array.from({ length: 8 }, (_, i) => ["g" + (i % 4), i]) },
            code, onCategoryColourCensus: (c: CategoryColourCensus) => seen.push(c),
        } as any);
        host.render();
        await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
        const last = seen[seen.length - 1];
        expect(last.belowFloor).toBe(true);
        expect(last.pairsBelowFloor.map(p => p.deltaE)).toEqual([20.9, 22.4]);
        expect(typeof last.closestDeltaEDeutan).toBe("number");
        expect([...el.querySelectorAll(".d3-mark")].slice(0, 4).map(e => e.getAttribute("fill"))).toEqual(SECOND);
        el.remove();
    });
});
