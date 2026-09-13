import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { censusValuePlacement, valuePlacementFlag } from "../src/valuePlacement";
import { ROW_IDX_ATTR } from "../src/contract";

// IS EACH DOT DRAWN AT ITS VALUE? The census reads the dots back to their rows and finds the value
// axis itself, so every case here is built the way a chart builds it: a linear scale from a column
// to pixels, dots placed through it, and then either left on their values or pushed off them the
// way a force layout pushes them.

let dom: JSDOM;
let doc: Document;
let svg: any;

beforeEach(() => {
    dom = new JSDOM("<!doctype html><div id='c'><svg></svg></div>");
    doc = dom.window.document;
    svg = doc.querySelector("svg");
});

function dot(g: any, i: number | string, cx: number, cy: number, r = 3) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", "circle") as any;
    el.setAttribute("class", "d3-mark");
    el.setAttribute(ROW_IDX_ATTR, String(i));
    el.setAttribute("cx", String(cx));
    el.setAttribute("cy", String(cy));
    el.setAttribute("r", String(r));
    g.appendChild(el);
    return el;
}

/** A right-skewed distance column, deterministic: most trips short, a long tail. */
function trips(n: number) {
    const rows: any[][] = [];
    for (let i = 0; i < n; i++) {
        const u = ((i * 0.6180339887) % 1);
        rows.push([i % 3 === 0 ? "Cash" : "Card", Math.round((0.8 + 18 * u * u * u) * 100) / 100, 5 + 30 * u]);
    }
    return { columns: [{ name: "PaymentType" }, { name: "TripDistanceKm" }, { name: "DurationMinutes" }], rows };
}

const y = (km: number) => 600 - km * 30;          // a linear value scale, inverted like an SVG y axis
const band = (cat: string) => (cat === "Card" ? 200 : 500);

describe("censusValuePlacement - finds the value axis and measures the drift", () => {
    it("every dot on its value (a dodge across the band): off0", () => {
        const data = trips(300);
        data.rows.forEach((r, i) => dot(svg, i, band(r[0]) + ((i * 37) % 120) - 60, y(r[1])));
        const c = censusValuePlacement(doc.getElementById("c"), data);
        expect(c.marks).toBe(300);
        expect(c.axis).toBe("y");
        expect(c.column).toBe("TripDistanceKm");
        expect(c.offShare).toBe(0);
        expect(valuePlacementFlag(c)).toBe("place:d3:off0");
    });

    it("dots pushed off their values the way a collision force pushes them are counted, and the line is not dragged along", () => {
        const data = trips(400);
        data.rows.forEach((r, i) => {
            // The dense short trips get shoved up or down by several radii; the tail stays put.
            const push = r[1] < 4 ? ((i % 2 ? 1 : -1) * (6 + (i % 5) * 3)) : 0;
            dot(svg, i, band(r[0]), Math.min(600, y(r[1]) + push));
        });
        const c = censusValuePlacement(doc.getElementById("c"), data);
        expect(c.axis).toBe("y");
        expect(c.column).toBe("TripDistanceKm");
        expect(c.offShare).toBeGreaterThan(50);
        expect(c.medianOffRadii).toBeGreaterThan(1);
        expect(valuePlacementFlag(c)).toBe("place:d3:off50");
    });

    it("a horizontal value axis is found the same way", () => {
        const data = trips(120);
        data.rows.forEach((r, i) => dot(svg, i, 40 + r[1] * 30, band(r[0]) / 5 + ((i * 13) % 30)));
        const c = censusValuePlacement(doc.getElementById("c"), data);
        expect(c.axis).toBe("x");
        expect(c.offShare).toBe(0);
    });

    it("a log value axis is tried too", () => {
        const data = trips(120);
        data.rows.forEach((r, i) => dot(svg, i, band(r[0]), 600 - Math.log10(r[1]) * 200));
        const c = censusValuePlacement(doc.getElementById("c"), data);
        expect(c.column).toBe("TripDistanceKm");
        expect(c.offShare).toBe(0);
    });

    it("a few strays land in the finer low buckets", () => {
        const data = trips(200);
        data.rows.forEach((r, i) => dot(svg, i, band(r[0]), y(r[1]) + (i % 50 === 0 ? 20 : 0)));
        expect(valuePlacementFlag(censusValuePlacement(doc.getElementById("c"), data))).toBe("place:d3:off1");
    });
});

describe("censusValuePlacement - declines rather than guessing", () => {
    it("too few dots", () => {
        const data = trips(10);
        data.rows.forEach((r, i) => dot(svg, i, band(r[0]), y(r[1])));
        expect(censusValuePlacement(doc.getElementById("c"), data).marks).toBe(0);
    });

    it("marks shared by several rows are not dots of one", () => {
        const data = trips(120);
        for (let i = 0; i < 120; i += 3) dot(svg, `${i},${i + 1},${i + 2}`, band(data.rows[i][0]), y(data.rows[i][1]));
        expect(valuePlacementFlag(censusValuePlacement(doc.getElementById("c"), data))).toBe("");
    });

    it("no column explains the positions", () => {
        const data = trips(120);
        data.rows.forEach((r, i) => dot(svg, i, (i * 97) % 700, (i * 53) % 500));
        expect(censusValuePlacement(doc.getElementById("c"), data).marks).toBe(0);
    });

    it("the same row drawn in several frames is not one dot per row", () => {
        const data = trips(60);
        for (let f = 0; f < 3; f++) data.rows.forEach((r, i) => dot(svg, i, band(r[0]) + f, y(r[1])));
        expect(censusValuePlacement(doc.getElementById("c"), data).marks).toBe(0);
    });

    it("never throws on junk", () => {
        expect(censusValuePlacement(null, null).marks).toBe(0);
        expect(censusValuePlacement(doc.getElementById("c"), { columns: [], rows: [] }).marks).toBe(0);
        for (let i = 0; i < 40; i++) dot(svg, i, NaN as any, 5);
        expect(censusValuePlacement(doc.getElementById("c"), trips(40)).marks).toBe(0);
    });
});
