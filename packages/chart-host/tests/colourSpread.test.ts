import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { censusColourSpread, colourSpreadFlag, SAME_SHADE_DELTA_E, MIN_RAMP_FILLS } from "../src/colourSpread";
import { MARK_CLASS, ROW_IDX_ATTR } from "../src/contract";

// TWO-THIRDS OF THE MAP IS ONE SHADE, AND THE ARITHMETIC IS PERFECT.
//
// The fixture below is the real one: 853 ZIP-3 regions, orders per region, min 1 / median 32 /
// max 432, painted through `d3.scaleLinear().domain([1, 432])`. 70% of regions land in the bottom
// tenth of the ramp. Nothing about that chart is wrong - the geography joins, the aggregate is
// right, the domain is the true extent - and it is unreadable, which is the harder failure to
// notice and the reason this census measures the OUTCOME rather than the mechanism.
//
// The cases that must NOT fire are the ones that make it an audit rather than a style opinion:
// a quantile scale over the same data (the recommended fix - it must report well), a categorical
// palette where one class dominates (correct, and not this census's business), and anything too
// small or too transparent to have an opinion about.

let dom: JSDOM;
let doc: Document;
let container: any;

function mark(fill: string, i: number) {
    const el = doc.createElementNS("http://www.w3.org/2000/svg", "path") as any;
    el.setAttribute("fill", fill);
    el.setAttribute("class", `region ${MARK_CLASS}`);
    el.setAttribute(ROW_IDX_ATTR, String(i));
    container.appendChild(el);
    return el;
}

/** `d3.interpolateBlues` at t, close enough for a fixture: white -> #08306b through blue. */
function blues(t: number): string {
    const c = Math.max(0, Math.min(1, t));
    const r = Math.round(247 + (8 - 247) * c);
    const g = Math.round(251 + (48 - 251) * c);
    const b = Math.round(255 + (107 - 255) * c);
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

/** The real ZIP-3 distribution's shape: a dense low bulk with a thin, long tail. */
function ordersPerRegion(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        // 70% under 40, a middle band, and a handful of metros an order of magnitude clear.
        out.push(i < n * 0.7 ? 1 + (i % 39)
            : i < n * 0.99 ? 40 + ((i * 7) % 120)
                : 200 + ((i * 53) % 232));
    }
    return out;
}

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><svg id='c'></svg></body></html>");
    doc = dom.window.document as any;
    container = doc.getElementById("c");
});

describe("censusColourSpread", () => {
    it("catches the washout: a skewed measure on a LINEAR ramp is mostly one shade", () => {
        const vals = ordersPerRegion(300);
        const max = Math.max(...vals);
        vals.forEach((v, i) => mark(blues((v - 1) / (max - 1)), i));

        const c = censusColourSpread(container, doc);
        expect(c.marks).toBe(300);
        expect(c.distinctFills).toBeGreaterThanOrEqual(MIN_RAMP_FILLS);
        // The complaint, as a number: most of the chart is one shade.
        expect(c.crowdShare).toBeGreaterThan(50);
        // And the ramp itself is wide - the colours EXIST, the data never reaches them, which is
        // exactly why "the scale is too narrow" is the wrong diagnosis.
        expect(c.spanDeltaE).toBeGreaterThan(30);
    });

    it("reports the SAME data well once a quantile scale spreads it - the recommended fix", () => {
        // Identical values, binned by rank instead of by magnitude. If this fired too, the census
        // would be measuring skew rather than readability and would condemn its own remedy.
        const vals = ordersPerRegion(300);
        const sorted = [...vals].slice().sort((a, b) => a - b);
        const cuts = [0.2, 0.4, 0.6, 0.8].map(q => sorted[Math.floor(q * sorted.length)]);
        vals.forEach((v, i) => {
            let bin = 0;
            while (bin < cuts.length && v > cuts[bin]) bin++;
            mark(blues(bin / 4), i);
        });

        const c = censusColourSpread(container, doc);
        expect(c.marks).toBe(300);
        // Five bins by rank: no bin can hold much more than a fifth.
        expect(c.crowdShare).toBeLessThan(40);
    });

    it("declines to speak about a CATEGORICAL palette, however lopsided the classes", () => {
        // schemeTableau10 with one dominant class. Most marks share a colour and that is a fact
        // about the data, not a defect - a chart drawn correctly must not be reported as one.
        // Note it is NOT the fill COUNT that saves this: five fills is exactly what a quantile
        // scale has. These colours are off the line joining their own extremes, and that is what
        // makes them classes rather than a ramp.
        const scheme = ["#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f"];
        for (let i = 0; i < 200; i++) mark(scheme[i < 160 ? 0 : 1 + (i % 4)], i);
        const c = censusColourSpread(container, doc);
        expect(c).toEqual({ marks: 0, distinctFills: 0, crowdShare: 0, spanDeltaE: 0 });
        expect(colourSpreadFlag(c)).toBe("");
    });

    it("declines a DIVERGING ramp - two arms from a neutral middle are not one line", () => {
        // Reported honestly as out of scope rather than measured as the longer arm. A diverging
        // scale that washes out is a real failure; it needs its own measurement, not this one
        // quietly answering a different question.
        const rdbu = ["#b2182b", "#ef8a62", "#fddbc7", "#f7f7f7", "#d1e5f0", "#67a9cf", "#2166ac"];
        for (let i = 0; i < 200; i++) mark(rdbu[i % rdbu.length], i);
        expect(censusColourSpread(container, doc).marks).toBe(0);
    });

    it("keeps the ramp test on the SLACK, so a five-bin quantile scale still qualifies", () => {
        // The regression this guards: a count floor of six would have excluded the remedy.
        for (let i = 0; i < 200; i++) mark(blues((i % 5) / 4), i);
        const c = censusColourSpread(container, doc);
        expect(c.marks).toBe(200);
        expect(c.distinctFills).toBe(5);
        expect(c.crowdShare).toBeLessThan(40);
    });

    it("says nothing when there are too few marks for a share to mean anything", () => {
        for (let i = 0; i < 10; i++) mark(blues(i / 10), i);
        expect(censusColourSpread(container, doc).marks).toBe(0);
    });

    it("ignores marks that paint nothing - fill:none and a zero alpha", () => {
        const vals = ordersPerRegion(120);
        const max = Math.max(...vals);
        vals.forEach((v, i) => mark(blues((v - 1) / (max - 1)), i));
        for (let i = 0; i < 40; i++) mark("none", 1000 + i);
        for (let i = 0; i < 40; i++) mark("rgba(0, 0, 0, 0)", 2000 + i);
        expect(censusColourSpread(container, doc).marks).toBe(120);
    });

    it("reads rgb() as well as hex, because a computed style is what jsdom hands back", () => {
        const vals = ordersPerRegion(120);
        const max = Math.max(...vals);
        vals.forEach((v, i) => {
            const h = blues((v - 1) / (max - 1));
            const rgb = [1, 3, 5].map(o => parseInt(h.slice(o, o + 2), 16));
            mark(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, i);
        });
        const c = censusColourSpread(container, doc);
        expect(c.marks).toBe(120);
        expect(c.crowdShare).toBeGreaterThan(50);
    });

    it("never throws, whatever it is handed", () => {
        expect(censusColourSpread(null as any)).toEqual({ marks: 0, distinctFills: 0, crowdShare: 0, spanDeltaE: 0 });
        expect(censusColourSpread({} as any)).toEqual({ marks: 0, distinctFills: 0, crowdShare: 0, spanDeltaE: 0 });
        expect(censusColourSpread({ querySelectorAll: () => { throw new Error("boom"); } } as any))
            .toEqual({ marks: 0, distinctFills: 0, crowdShare: 0, spanDeltaE: 0 });
    });
});

describe("colourSpreadFlag", () => {
    it("is a bucketed MEASUREMENT, not a verdict - there is no floor to judge against yet", () => {
        expect(colourSpreadFlag({ marks: 100, distinctFills: 40, crowdShare: 12, spanDeltaE: 50 }))
            .toBe("ramp:d3:crowd0");
        expect(colourSpreadFlag({ marks: 100, distinctFills: 40, crowdShare: 55, spanDeltaE: 50 }))
            .toBe("ramp:d3:crowd40");
        expect(colourSpreadFlag({ marks: 100, distinctFills: 40, crowdShare: 70, spanDeltaE: 50 }))
            .toBe("ramp:d3:crowd60");
        // 100% must not open a sixth bucket - the family has to be countable.
        expect(colourSpreadFlag({ marks: 100, distinctFills: 40, crowdShare: 100, spanDeltaE: 50 }))
            .toBe("ramp:d3:crowd80");
    });

    it("emits nothing when the census declined, so the buckets sum to a real denominator", () => {
        expect(colourSpreadFlag({ marks: 0, distinctFills: 0, crowdShare: 0, spanDeltaE: 0 })).toBe("");
    });

    it("keeps the same-shade distance a perceptual constant, not a tuned knob", () => {
        expect(SAME_SHADE_DELTA_E).toBe(5);
    });
});
