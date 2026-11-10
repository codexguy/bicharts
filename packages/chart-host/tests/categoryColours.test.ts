import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { censusCategoryColours, MAX_CATEGORY_SLOTS, RAMP_DECLINE_MIN_SLOTS } from "../src/categoryColours";
import { MARK_CLASS, LEGEND_MARK_CLASS, ROW_IDX_ATTR, DIM_OPACITY_DEFAULT } from "../src/contract";
import { deltaEHex } from "../src/deltaE";

// CAN THE READER TELL THE CATEGORIES APART, IN THE COLOURS ACTUALLY PAINTED? The fixtures are the two four-colour sets
// a reader compared on one chart: the first (two greens, two blue-greys) could not be told apart and measures about
// 8.2; the second measures about 20.9. The census reports; it never decides and never repaints.

let dom: JSDOM;
let doc: Document;
let container: any;
const SVG = "http://www.w3.org/2000/svg";

function mark(fill: string, i: number, attrs: Record<string, string> = {}, tag = "circle") {
    const el = doc.createElementNS(SVG, tag) as any;
    el.setAttribute("fill", fill);
    el.setAttribute("class", `dot ${MARK_CLASS}`);
    el.setAttribute(ROW_IDX_ATTR, String(i));
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    container.appendChild(el);
    return el;
}

function swatch(fill: string) {
    const el = doc.createElementNS(SVG, "rect") as any;
    el.setAttribute("fill", fill);
    el.setAttribute("class", LEGEND_MARK_CLASS);
    container.appendChild(el);
    return el;
}

/** Each colour on several marks, as a categorical chart paints it. */
function paint(colours: string[], perColour = 6, attrs: Record<string, string> = {}) {
    let i = 0;
    for (const c of colours) for (let k = 0; k < perColour; k++) mark(c, i++, attrs);
}

const FIRST = ["#8cbc6c", "#516992", "#7ba061", "#71809d"];
const SECOND = ["#7092b8", "#f69c46", "#aa49bd", "#cf9dfb"];

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><svg id='c'></svg></body></html>");
    doc = dom.window.document as any;
    container = doc.getElementById("c");
});

describe("censusCategoryColours", () => {
    it("the set a reader could not tell apart reports its closest pair at about 8.2", () => {
        paint(FIRST);
        const c = censusCategoryColours(container, doc);
        expect(c.declined).toBe("");
        expect(c.source).toBe("marks");
        expect(c.slots).toBe(4);
        expect(c.closestDeltaE!).toBeCloseTo(8.2, 1);
        expect(c.closestPair.sort()).toEqual(["#7ba061", "#8cbc6c"]);
        // Four colours on one path is reported, not declined as a ramp: that shape IS the too-close case.
        expect(c.rampLike).toBe(true);
    });

    it("the set a reader could tell apart reports about 20.9", () => {
        paint(SECOND);
        const c = censusCategoryColours(container, doc);
        expect(c.closestDeltaE!).toBeCloseTo(20.9, 1);
        expect(c.rampLike).toBe(false);
    });

    it("a sequential ramp declines", () => {
        const ramp = Array.from({ length: 8 }, (_, i) => {
            const t = i / 7;
            return "#" + [247 + (8 - 247) * t, 251 + (48 - 251) * t, 255 + (107 - 255) * t]
                .map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
        });
        expect(ramp.length).toBeGreaterThanOrEqual(RAMP_DECLINE_MIN_SLOTS);
        paint(ramp, 3);
        const c = censusCategoryColours(container, doc);
        expect(c.declined).toBe("ramp");
        expect(c.closestDeltaE).toBeNull();
    });

    it("a continuous colour channel (more colours than categories) declines", () => {
        for (let i = 0; i <= MAX_CATEGORY_SLOTS; i++) mark("#" + (0x100000 + i * 0x070b13).toString(16).slice(-6), 100 + i);
        expect(censusCategoryColours(container, doc).declined).toBe("too-many");
    });

    it("the legend's swatches win over the marks, and a legend colour missing from the marks is reported", () => {
        SECOND.forEach(swatch);
        paint(FIRST);
        const c = censusCategoryColours(container, doc);
        expect(c.source).toBe("legend");
        expect(c.closestDeltaE!).toBeCloseTo(20.9, 1);
        expect(c.legendMatchesMarks).toBe(false);
    });

    it("a legend painted in the marks' colours matches them", () => {
        SECOND.forEach(swatch);
        paint(SECOND);
        expect(censusCategoryColours(container, doc).legendMatchesMarks).toBe(true);
    });

    it("a pair distinct at full strength reports closer at the 25% dim level over white", () => {
        paint(SECOND);
        const c = censusCategoryColours(container, doc);
        expect(c.dimOpacity).toBe(DIM_OPACITY_DEFAULT);
        expect(c.closestDeltaEPainted).toBe(c.closestDeltaE);
        expect(c.closestDeltaEDimmed!).toBeLessThan(c.closestDeltaE!);
        // The dimmed figure is the distance of the two colours blended at 25% over white.
        const blend = (h: string, a: number) => "#" + [1, 3, 5].map(k => Math.round(parseInt(h.slice(k, k + 2), 16) * a + 255 * (1 - a))
            .toString(16).padStart(2, "0")).join("");
        const pairs = SECOND.flatMap((x, i) => SECOND.slice(i + 1).map(y => deltaEHex(blend(x, 0.25), blend(y, 0.25))));
        expect(c.closestDeltaEDimmed!).toBeCloseTo(Math.min(...pairs), 1);
    });

    it("a mark's own opacity and the page background are part of what is painted", () => {
        paint(SECOND, 6, { opacity: "0.4" });
        const light = censusCategoryColours(container, doc);
        expect(light.closestDeltaEPainted!).toBeLessThan(light.closestDeltaE!);
        const dark = censusCategoryColours(container, doc, { pageBg: "#1f1f1f", dimOpacity: 0.5 });
        expect(dark.dimOpacity).toBe(0.5);
        expect(dark.closestDeltaEPainted).not.toBe(light.closestDeltaEPainted);
    });

    it("a line mark is measured by its stroke", () => {
        let i = 0;
        for (const c of FIRST) mark("none", i++, { stroke: c }, "path");
        expect(censusCategoryColours(container, doc).closestDeltaE!).toBeCloseTo(8.2, 1);
    });

    it("one colour, or nothing at all, reports nothing", () => {
        paint(["#4e79a7"]);
        const c = censusCategoryColours(container, doc);
        expect(c.declined).toBe("none");
        expect(c.slots).toBe(1);
        expect(c.closestDeltaE).toBeNull();
        expect(censusCategoryColours(null).declined).toBe("none");
    });

    it("never changes what was painted", () => {
        paint(FIRST);
        const before = container.innerHTML;
        censusCategoryColours(container, doc, { dimOpacity: 0.1 });
        expect(container.innerHTML).toBe(before);
    });
});
