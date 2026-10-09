// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg } from "../../src/legendFit/legendReconcileDom";
import { axisLabelsAreNominal, isDateLikeLabelText, nominalLabelRooms } from "../../src/legendFit/legendReconcile";

// THE AXIS-THIN PASS MUST NOT HIDE CATEGORY NAMES ON A NOMINAL AXIS.
//
// A Pareto of five failure modes at 700x324: the model drew 10 px horizontal labels (the longest
// ~240 px) into ~118 px bands, they collided, and the client hid every second one -
// `axis-thin {"axes":1,"hidden":2,"stride":2}`. On a date or numeric axis the neighbours imply a
// hidden tick; on a band of names each label is the only record of its bar, and the hidden ones
// were `.d3-axis-filter` click targets too. A nominal axis is never thinned: each label is cut to
// its band with the full name in a <title>.
//
// jsdom has no layout, so getBoundingClientRect is stubbed from the element's own text: 0.6 x
// font size per character, placed at its tick's translate() by its text-anchor. Honest for what
// is tested - which labels survive and what they say - not for the browser's font metrics.

const SVG = "http://www.w3.org/2000/svg";
const BAND = 118;

function ownText(el: Element): string {
    let s = "";
    el.childNodes.forEach(n => { if (n.nodeType === 3) s += n.nodeValue || ""; });
    return s;
}

function boxOf(el: Element): { left: number; right: number; top: number; bottom: number } {
    if (el.tagName.toLowerCase() !== "text") return { left: 0, right: 0, top: 0, bottom: 0 };
    if (el.getAttribute("display") === "none") return { left: 0, right: 0, top: 0, bottom: 0 };
    const fs = parseFloat(el.getAttribute("font-size") || "10");
    const w = ownText(el).length * fs * 0.6;
    const tick = el.closest(".tick");
    const m = /translate\(\s*([-\d.]+)/.exec(tick?.getAttribute("transform") || "");
    const x = m ? parseFloat(m[1]) : 0;
    let anchor = "";
    for (let n: Element | null = el; n && !anchor; n = n.parentElement) anchor = n.getAttribute("text-anchor") || "";
    const left = anchor === "end" ? x - w : anchor === "start" ? x : x - w / 2;
    return { left, right: left + w, top: 290, bottom: 290 + fs };
}

beforeEach(() => {
    (Element.prototype as any).getBoundingClientRect = function (this: Element) {
        const b = boxOf(this);
        return { ...b, width: b.right - b.left, height: b.bottom - b.top, x: b.left, y: b.top, toJSON: () => ({}) };
    };
    document.body.innerHTML = "";
});

function chart(labels: string[], opts: { anchor?: string; clickable?: boolean } = {}): SVGSVGElement {
    const svg = document.createElementNS(SVG, "svg") as SVGSVGElement;
    svg.setAttribute("width", "700");
    svg.setAttribute("height", "324");
    const axis = document.createElementNS(SVG, "g");
    axis.setAttribute("class", "x-axis");
    axis.setAttribute("text-anchor", opts.anchor ?? "middle");
    labels.forEach((name, i) => {
        const tick = document.createElementNS(SVG, "g");
        tick.setAttribute("class", "tick");
        tick.setAttribute("transform", `translate(${40 + BAND / 2 + i * BAND},0)`);
        const line = document.createElementNS(SVG, "line");
        tick.appendChild(line);
        const t = document.createElementNS(SVG, "text");
        t.setAttribute("font-size", "10");
        if (opts.clickable !== false) t.setAttribute("class", "d3-axis-filter");
        t.textContent = name;
        tick.appendChild(t);
        axis.appendChild(tick);
    });
    svg.appendChild(axis);
    document.body.appendChild(svg);
    return svg;
}

// Five failure-mode names, the longest 40 characters = 240 px at 10 px - a real report's geometry.
const MODES = [
    "Insufficient lubrication of main bearing",
    "Seal degradation under thermal cycling",
    "Operator error during changeover",
    "Contamination in hydraulic supply line",
    "Electrical fault in drive controller",
];

const texts = (svg: SVGSVGElement) => Array.from(svg.querySelectorAll(".tick text"));

describe("the axis-thin pass on a NOMINAL band axis", () => {
    it("THE CASE: five long names in 118 px bands - no label is hidden (it hid two)", () => {
        const svg = chart(MODES);
        const res = reconcileLegendInSvg(svg);
        const hidden = texts(svg).filter(t => t.getAttribute("display") === "none");
        expect(hidden.length).toBe(0);
        expect(res.axisThin?.hidden ?? 0).toBe(0);
    });

    it("every label is cut to its band, keeps its full name as a <title>, and no two collide", () => {
        const svg = chart(MODES);
        const res = reconcileLegendInSvg(svg);
        const ts = texts(svg);
        ts.forEach((t, i) => {
            const shown = ownText(t);
            expect(shown.length, MODES[i]).toBeGreaterThan(1);
            expect(shown.endsWith("…"), shown).toBe(true);
            expect(MODES[i].startsWith(shown.slice(0, -1).trimEnd())).toBe(true);
            expect(t.querySelector("title")?.textContent).toBe(MODES[i]);
        });
        const boxes = ts.map(t => t.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right);
        expect(res.axisThin).toMatchObject({ axes: 1, hidden: 0, cut: 5, nominal: true });
    });

    it("every label stays a .d3-axis-filter click target - displayed, class intact", () => {
        const svg = chart(MODES);
        reconcileLegendInSvg(svg);
        const ts = texts(svg);
        expect(ts.length).toBe(5);
        for (const t of ts) {
            expect(t.getAttribute("display")).not.toBe("none");
            expect(t.getAttribute("class")).toContain("d3-axis-filter");
            expect(t.getAttribute("pointer-events")).not.toBe("none");
        }
    });

    it("a label that already fits its band is left exactly as drawn", () => {
        const svg = chart(["North", ...MODES.slice(1)]);
        reconcileLegendInSvg(svg);
        const first = texts(svg)[0];
        expect(ownText(first)).toBe("North");
        expect(first.querySelector("title")).toBeNull();
    });

    it("start-anchored names are cut to the step too", () => {
        const svg = chart(MODES, { anchor: "start" });
        reconcileLegendInSvg(svg);
        const boxes = texts(svg).map(t => t.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThanOrEqual(boxes[i - 1].right);
        expect(texts(svg).every(t => t.getAttribute("display") !== "none")).toBe(true);
    });

    it("an axis of DATES still thins by stride - the neighbours imply the hidden tick", () => {
        const months = Array.from({ length: 12 }, (_, i) => `${["January","February","March","April","May","June","July","August","September","October","November","December"][i]} 2026`);
        const svg = document.createElementNS(SVG, "svg") as SVGSVGElement;
        const axis = document.createElementNS(SVG, "g");
        axis.setAttribute("text-anchor", "middle");
        months.forEach((m, i) => {
            const tick = document.createElementNS(SVG, "g");
            tick.setAttribute("class", "tick");
            tick.setAttribute("transform", `translate(${30 + i * 40},0)`);
            const t = document.createElementNS(SVG, "text");
            t.textContent = m;
            tick.appendChild(t);
            axis.appendChild(tick);
        });
        svg.appendChild(axis);
        document.body.appendChild(svg);
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin?.hidden).toBeGreaterThan(0);
        expect(res.axisThin?.nominal).toBeFalsy();
    });

    it("is idempotent - a second pass over a cut axis changes nothing", () => {
        const svg = chart(MODES);
        reconcileLegendInSvg(svg);
        const after = texts(svg).map(t => ownText(t));
        svg.removeAttribute("data-lch-legend-fixed");
        reconcileLegendInSvg(svg);
        expect(texts(svg).map(t => ownText(t))).toEqual(after);
        expect(texts(svg).every(t => t.querySelectorAll("title").length === 1)).toBe(true);
    });
});

describe("axisLabelsAreNominal - which axes may be thinned", () => {
    it("names are nominal", () => {
        expect(axisLabelsAreNominal(MODES)).toBe(true);
        expect(axisLabelsAreNominal(["North", "South", "East", "West"])).toBe(true);
    });
    it("numbers, dates, months, quarters and times are ordered", () => {
        for (const set of [
            ["0", "50K", "100K", "150K"],
            ["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026"],
            ["Jan", "Feb", "Mar", "Apr"],
            ["January", "February", "March", "April"],
            ["Q1", "Q2", "Q3", "Q4"],
            ["Q1 2025", "Q2 2025", "Q3 2025", "Q4 2025"],
            ["FY2023", "FY2024", "FY2025", "FY2026"],
            ["1/15", "2/15", "3/15", "4/15"],
            ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"],
            ["Mon", "Tue", "Wed", "Thu"],
            ["12 AM", "6 AM", "12 PM", "6 PM"],
            ["W1", "W2", "W3", "W4"],
        ]) expect(axisLabelsAreNominal(set), set.join("|")).toBe(false);
    });
    it("one name among dates makes the axis nominal - that name has no neighbour to imply it", () => {
        expect(axisLabelsAreNominal(["Jan 2026", "Feb 2026", "Mar 2026", "Unassigned"])).toBe(true);
    });
    it("empty labels say nothing either way", () => {
        expect(axisLabelsAreNominal(["", "Jan", "", "Mar"])).toBe(false);
        expect(axisLabelsAreNominal([])).toBe(false);
    });
    it("isDateLikeLabelText reads the runtime locale's month names too", () => {
        const local = new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2026, 2, 15));
        expect(isDateLikeLabelText(local)).toBe(true);
    });
});

describe("nominalLabelRooms - each label's room is its band", () => {
    it("evenly spaced anchors give every label the step less the gap", () => {
        expect(nominalLabelRooms([59, 177, 295, 413, 531], 2)).toEqual([116, 116, 116, 116, 116]);
    });
    it("uneven spacing gives each label its NARROWER neighbour step", () => {
        expect(nominalLabelRooms([0, 100, 150], 2)).toEqual([98, 48, 48]);
    });
    it("anchors in any order are answered in input order", () => {
        expect(nominalLabelRooms([150, 0, 100], 2)).toEqual([48, 98, 48]);
    });
    it("a lone anchor has no band to fit and gets no room limit", () => {
        expect(nominalLabelRooms([10], 2)).toEqual([Infinity]);
    });
});
