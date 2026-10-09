// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { reconcileLegendInSvg } from "../../src/legendFit/legendReconcileDom";
import { installSvgLayout, el, makeSvg, shownText } from "./support/svgLayout";

// AXIS THINNING (STRIDE AND NOMINAL) AND LABEL-ROW THINNING.
//
// Two phases hide labels that collide with their own neighbours, and a third refuses to hide the
// names on a nominal axis and cuts them to their band instead:
//
//  - AXIS-THIN keys on the `.tick` groups d3.axis emits. On an ORDERED axis (numbers, dates) it hides the
//    labels a stride drops - the smallest stride that clears every collision, else just the two ends - and
//    leaves the tick LINES. On a NOMINAL axis (any label that is neither a number nor date-like) nothing
//    is ever hidden: each label is shrunk, then cut to its band with the full name in a <title>.
//  - LABEL-THIN is the same planner for rows of numeric text nobody drew with d3.axis (a hand-placed
//    colorbar's three tick values), and only where the row sits along a track in a mark-free group - which
//    is what tells a colorbar from a row of data labels.
//
// Both measure the real text, so they read client rects. The layout stub is 0.6 em per character, honest
// for which labels survive and what they say, not for a browser's font metrics.

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

interface AxisOpts { x0?: number; pitch?: number; y?: number; anchor?: string; fs?: number; cls?: string; rotate?: boolean }

/** A d3-style horizontal axis: <g class="x-axis" text-anchor> > g.tick(translate) > line + text. */
function axis(svg: Element, labels: string[], o: AxisOpts = {}): { g: Element; ticks: Element[]; texts: Element[] } {
    const g = el(svg, "g", { class: o.cls ?? "x-axis", "text-anchor": o.anchor ?? "middle" });
    if (o.rotate) g.setAttribute("transform", "rotate(-45)");
    const ticks: Element[] = [], texts: Element[] = [];
    labels.forEach((name, i) => {
        const tick = el(g, "g", { class: "tick", transform: `translate(${(o.x0 ?? 40) + i * (o.pitch ?? 30)},${o.y ?? 300})` });
        el(tick, "line", { x1: 0, x2: 0, y1: 0, y2: 6 });
        texts.push(el(tick, "text", { y: 9, "font-size": o.fs ?? 10 }, name));
        ticks.push(tick);
    });
    return { g, ticks, texts };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dates = (n: number) => MONTHS.slice(0, n).map(m => `${m} 2026`);
const hiddenOf = (texts: Element[]) => texts.filter(t => t.getAttribute("display") === "none");
const hiddenIdx = (texts: Element[]) => texts.map((t, i) => (t.getAttribute("display") === "none" ? i : -1)).filter(i => i >= 0);

describe("axis-thin on an ORDERED axis - the smallest stride that clears the collisions", () => {
    it("THE CASE: eleven 'Mon 2026' labels 30 apart (each 48 wide) hide every second label", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, dates(11));
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "axis-thin", at: "axes1 hid5 k2", axisThin: { axes: 1, hidden: 5, stride: 2 } });
        expect(res.axisThin?.nominal).toBeUndefined();
        expect(hiddenIdx(a.texts)).toEqual([1, 3, 5, 7, 9]);
        expect(a.g.getAttribute("data-lch-ticks-thinned")).toBe("1");
    });

    it("hides the TEXT only: every tick line stays, undisplayed nothing, and survivors keep their words", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, dates(11));
        reconcileLegendInSvg(svg);
        expect(a.ticks.every(t => t.querySelector("line")!.getAttribute("display") === null)).toBe(true);
        expect(svg.querySelectorAll(".tick line").length).toBe(11);
        expect(a.texts.filter(t => t.getAttribute("display") !== "none").map(shownText)).toEqual(
            ["Jan 2026", "Mar 2026", "May 2026", "Jul 2026", "Sep 2026", "Nov 2026"]);
        expect(a.texts.every(t => t.querySelector("title") === null)).toBe(true);
    });

    it("a tighter axis needs a wider stride: twelve labels 20 apart keep every third", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, dates(12), { pitch: 20 });
        const res = reconcileLegendInSvg(svg);
        expect(res.at).toBe("axes1 hid8 k3");
        expect(res.axisThin).toMatchObject({ axes: 1, hidden: 8, stride: 3 });
        expect(hiddenIdx(a.texts)).toEqual([1, 2, 4, 5, 7, 8, 10, 11]);
    });

    it("a numeric axis thins the same way", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, ["50K", "60K", "70K", "80K", "90K", "100K", "110K", "120K"], { pitch: 12, x0: 40 });
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "axis-thin", axisThin: { axes: 1, stride: 2 } });
        expect(hiddenOf(a.texts).length).toBe(res.axisThin!.hidden);
        expect(res.axisThin!.hidden).toBeGreaterThan(0);
    });

    it("when no regular stride clears, the two ends survive (reported as stride 1: the stride is 0 and never beats 1)", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, dates(4), { pitch: 20 });
        const res = reconcileLegendInSvg(svg);
        expect(res.at).toBe("axes1 hid2 k1");
        expect(res.axisThin).toMatchObject({ axes: 1, hidden: 2, stride: 1 });
        expect(hiddenIdx(a.texts)).toEqual([1, 2]);
    });

    it("an axis still colliding when only its ends survive is left exactly as drawn", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, dates(4), { pitch: 10 });
        const res = reconcileLegendInSvg(svg);
        expect(res.applied).toBe(false);
        expect(res.axisThin).toBeUndefined();
        expect(res.at).toBeUndefined();
        expect(hiddenOf(a.texts)).toEqual([]);
        expect(a.g.getAttribute("data-lch-ticks-thinned")).toBeNull();
    });

    it("an axis whose labels do not collide is left alone", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, dates(6), { pitch: 80 });
        const res = reconcileLegendInSvg(svg);
        expect(res.applied).toBe(false);
        expect(hiddenOf(a.texts)).toEqual([]);
    });

    it("fewer than four ticks are never thinned, even when the two ends would clear and the middle one collides", () => {
        const svg = makeSvg(700, 324);
        // Three 48-wide labels 30 apart: neighbours collide, the ends (60 apart) do not - a four-tick axis would lose the middle.
        const a = axis(svg, dates(3), { pitch: 30 });
        expect(reconcileLegendInSvg(svg).applied).toBe(false);
        expect(hiddenOf(a.texts)).toEqual([]);
        expect(a.g.getAttribute("data-lch-ticks-thinned")).toBeNull();
    });

    it("rotated labels are the generation's own answer to density: left alone (on the axis group too)", () => {
        const own = makeSvg(700, 324);
        const a = axis(own, dates(11));
        a.texts.forEach(t => t.setAttribute("transform", "rotate(-45)"));
        expect(reconcileLegendInSvg(own).axisThin).toBeUndefined();
        expect(hiddenOf(a.texts)).toEqual([]);

        const above = makeSvg(700, 324);
        const b = axis(above, dates(11), { rotate: true });
        expect(reconcileLegendInSvg(above).axisThin).toBeUndefined();
        expect(hiddenOf(b.texts)).toEqual([]);
    });

    it("a VERTICAL axis is left alone: its labels spread down y, and thinning rows deletes data, not captions", () => {
        const svg = makeSvg(700, 324);
        const g = el(svg, "g", { class: "y-axis", "text-anchor": "end" });
        const texts: Element[] = [];
        dates(8).forEach((n, i) => {
            const tick = el(g, "g", { class: "tick", transform: `translate(60,${40 + i * 14})` });
            texts.push(el(tick, "text", { x: -3, "font-size": 10 }, n));
        });
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin).toBeUndefined();
        expect(hiddenOf(texts)).toEqual([]);
    });

    /** Labels laid along a diagonal: each tick moves `dx` across and `dy` down from the last. */
    function diagonal(dx: number, dy: number): { svg: SVGSVGElement; texts: Element[] } {
        const svg = makeSvg(700, 500);
        const g = el(svg, "g", { class: "axis", "text-anchor": "start" });
        const texts: Element[] = [];
        dates(8).forEach((n, i) => {
            const tick = el(g, "g", { class: "tick", transform: `translate(${40 + i * dx},${40 + i * dy})` });
            texts.push(el(tick, "text", { y: 9, "font-size": 10 }, n));
        });
        return { svg, texts };
    }

    it("an axis is horizontal only if it spreads MORE across than down: a steep run (30 across, 60 down per label) is left alone", () => {
        const { svg, texts } = diagonal(30, 60);
        expect(reconcileLegendInSvg(svg).axisThin).toBeUndefined();
        expect(hiddenOf(texts)).toEqual([]);
    });

    it("equal spread across and down (30 and 30 per label) counts as vertical", () => {
        const { svg, texts } = diagonal(30, 30);
        expect(reconcileLegendInSvg(svg).axisThin).toBeUndefined();
        expect(hiddenOf(texts)).toEqual([]);
    });

    it("the same labels on a shallow run (30 across, 15 down per label) are a horizontal axis and thin", () => {
        const { svg, texts } = diagonal(30, 15);
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin).toMatchObject({ axes: 1, stride: 2 });
        expect(hiddenIdx(texts)).toEqual([1, 3, 5, 7]);
    });

    it("two axes are thinned separately: the report sums the axes and the labels hidden, and keeps the widest stride", () => {
        const svg = makeSvg(700, 424);
        const a = axis(svg, dates(11), { y: 300 });
        const b = axis(svg, dates(12), { y: 380, pitch: 20, cls: "x-axis-2" });
        const res = reconcileLegendInSvg(svg);
        expect(res.at).toBe("axes2 hid13 k3");
        expect(res.axisThin).toMatchObject({ axes: 2, hidden: 13, stride: 3 });
        expect(hiddenOf(a.texts).length).toBe(5);
        expect(hiddenOf(b.texts).length).toBe(8);
    });

    it("a thinned axis is stamped and not thinned again by a later pass over the same svg", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, dates(11));
        reconcileLegendInSvg(svg);
        const before = hiddenIdx(a.texts);
        svg.removeAttribute("data-lch-legend-fixed");
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin).toBeUndefined();
        expect(hiddenIdx(a.texts)).toEqual(before);
    });
});

describe("axis-thin on a NOMINAL axis - fitted to the band, never hidden", () => {
    const NAMES = ["Operations", "Engineering", "Marketing", "Procurement", "Compliance"];

    it("a name that only needs a little room is SHRUNK, not cut: the full text stays and no title is added", () => {
        const svg = makeSvg(700, 324);
        // 14 px names ~59-84 wide into a 72 pitch: room 70, and a shrink to >= 80% of 14px (11.2) can reach it.
        const a = axis(svg, ["Operations", "Marketing", "Compliance", "Logistics", "Finance"], { pitch: 72, fs: 14, x0: 60 });
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "axis-thin" });
        // "Finance" is 58.8 wide and already fits: it is neither shrunk nor cut.
        expect(res.axisThin).toMatchObject({ axes: 1, hidden: 0, stride: 1, nominal: true, cut: 0, shrunk: 4 });
        expect(res.at).toBe("axes1 hid0 k1 cut0 shr4");
        expect(hiddenOf(a.texts)).toEqual([]);
        expect(a.texts.map(shownText)).toEqual(["Operations", "Marketing", "Compliance", "Logistics", "Finance"]);
        expect(a.texts.every(t => t.querySelector("title") === null)).toBe(true);
        a.texts.slice(0, 4).forEach(t => expect(parseFloat(t.getAttribute("font-size")!)).toBeLessThan(14));
        expect(a.texts[4].getAttribute("font-size")).toBe("14");
    });

    it("a name that cannot be shrunk to fit is CUT to its band, its full text riding a <title>; one that fits its band exactly is not", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, NAMES, { pitch: 56, x0: 60 });
        const res = reconcileLegendInSvg(svg);
        // Pitch 56 less the 2-unit gap is a 54-unit room; "Marketing" is exactly 54 wide and is left whole.
        expect(res.axisThin).toMatchObject({ axes: 1, hidden: 0, nominal: true, cut: 4, shrunk: 0 });
        expect(res.at).toBe("axes1 hid0 k1 cut4 shr0");
        a.texts.forEach((t, i) => {
            if (NAMES[i] === "Marketing") {
                expect(shownText(t)).toBe("Marketing");
                expect(t.querySelector("title")).toBeNull();
                return;
            }
            expect(shownText(t).endsWith("…"), shownText(t)).toBe(true);
            expect(NAMES[i].startsWith(shownText(t).slice(0, -1))).toBe(true);
            expect(t.querySelector("title")!.textContent).toBe(NAMES[i]);
        });
        expect(a.texts.every(t => t.getAttribute("display") === null)).toBe(true);
        expect(res.axisThin!.colliding).toBeUndefined();
    });

    it("a band too narrow for even one character leaves the first letter and an ellipsis, and the report counts the collisions left", () => {
        const svg = makeSvg(700, 324);
        const eight = ["Operations", "Engineering", "Marketing", "Procurement", "Compliance", "Logistics", "Finance", "Research"];
        const a = axis(svg, eight, { pitch: 11, x0: 60 });
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin).toMatchObject({ axes: 1, hidden: 0, nominal: true, cut: 8, shrunk: 0, colliding: 7 });
        expect(a.texts.map(shownText)).toEqual(["O…", "E…", "M…", "P…", "C…", "L…", "F…", "R…"]);
        expect(a.texts.map(t => t.querySelector("title")!.textContent)).toEqual(eight);
    });

    it("a nominal axis the planner cannot clear even by its two ends is left as drawn - the fit only runs when the stride planner found something to drop", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, NAMES, { pitch: 11, x0: 60 });
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin).toBeUndefined();
        expect(res.applied).toBe(false);
        expect(a.texts.map(shownText)).toEqual(NAMES);
        expect(a.texts.every(t => t.querySelector("title") === null)).toBe(true);
    });

    it("one name among dates makes the whole axis nominal: nothing is hidden, the colliding labels are cut", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, ["Jan 2026", "Feb 2026", "Mar 2026", "Unassigned"], { pitch: 30 });
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin).toMatchObject({ nominal: true, hidden: 0 });
        expect(hiddenOf(a.texts)).toEqual([]);
        expect(res.axisThin!.cut! + res.axisThin!.shrunk!).toBeGreaterThan(0);
    });

    it("a nominal axis whose names already fit is left exactly as drawn", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, ["North", "South", "East", "West", "Central"], { pitch: 90 });
        const res = reconcileLegendInSvg(svg);
        expect(res.applied).toBe(false);
        expect(a.texts.map(shownText)).toEqual(["North", "South", "East", "West", "Central"]);
        expect(a.g.getAttribute("data-lch-ticks-thinned")).toBeNull();
    });

    it("rotated names are left alone, like rotated dates", () => {
        const svg = makeSvg(700, 324);
        const a = axis(svg, NAMES, { pitch: 56, x0: 60, rotate: true });
        const res = reconcileLegendInSvg(svg);
        expect(res.axisThin).toBeUndefined();
        expect(a.texts.map(shownText)).toEqual(NAMES);
    });

    it("start-anchored names are fitted from their left edge, end-anchored from their right", () => {
        for (const anchor of ["start", "end"]) {
            const svg = makeSvg(700, 324);
            const a = axis(svg, NAMES, { pitch: 56, x0: 260, anchor });
            const res = reconcileLegendInSvg(svg);
            expect(res.axisThin, anchor).toMatchObject({ nominal: true, hidden: 0, cut: 4 });
            expect(a.texts.every(t => t.getAttribute("display") === null), anchor).toBe(true);
            const boxes = a.texts.map(t => t.getBoundingClientRect()).sort((p, q) => p.left - q.left);
            for (let i = 1; i < boxes.length; i++) expect(boxes[i].left, anchor).toBeGreaterThanOrEqual(boxes[i - 1].right);
        }
    });
});

/** A hand-placed colorbar: a track rect over a row of labels, in a mark-free group (the shape of a hand-built choropleth colorbar). */
function colorbar(parent: Element, labels: [string, number, string][],
                  o: { track?: boolean; transform?: string; trackX?: number; trackW?: number } = {}): Element {
    const g = el(parent, "g", { class: "cb", transform: o.transform ?? "translate(40,300)" });
    if (o.track !== false) el(g, "rect", { x: o.trackX ?? 0, y: -14, width: o.trackW ?? 120, height: 10, fill: "#cccccc" });
    labels.forEach(([t, x, a]) => el(g, "text", { x, y: 10, "font-size": 10, "text-anchor": a }, t));
    return g;
}
const ABUTTING: [string, number, string][] = [["210,000", 0, "start"], ["294,000", 60, "middle"], ["378,000", 120, "end"]];

describe("label-thin - rows of numeric text nobody drew with d3.axis", () => {
    it("THE CASE: three colorbar values that abut keep their min and max and lose the middle", () => {
        const svg = makeSvg(700, 400);
        const g = colorbar(svg, ABUTTING);
        const [lo, mid, hi] = Array.from(g.querySelectorAll("text"));
        const res = reconcileLegendInSvg(svg);
        expect(res).toMatchObject({ applied: true, reason: "label-thin", lt: "rows1 hid1 k0", labelThin: { rows: 1, hidden: 1, stride: 0 } });
        expect(mid.getAttribute("display")).toBe("none");
        expect(mid.getAttribute("data-lch-label-thinned")).toBe("1");
        expect(lo.getAttribute("display")).toBeNull();
        expect(hi.getAttribute("display")).toBeNull();
        expect(g.querySelector("rect")!.getAttribute("display")).toBeNull();
    });

    it("a longer row takes the planner's stride, like an axis: five labels 30 apart keep every second one", () => {
        const svg = makeSvg(700, 400);
        const g = colorbar(svg, [["10,000", 0, "middle"], ["20,000", 30, "middle"], ["30,000", 60, "middle"], ["40,000", 90, "middle"], ["50,000", 120, "middle"]],
            { transform: "translate(80,300)", trackX: -20, trackW: 160 });
        const res = reconcileLegendInSvg(svg);
        expect(res.lt).toBe("rows1 hid2 k2");
        expect(res.labelThin).toEqual({ rows: 1, hidden: 2, stride: 2 });
        expect(Array.from(g.querySelectorAll("text")).map(t => t.getAttribute("display") === "none")).toEqual([false, true, false, true, false]);
    });

    it("three labels that clear each other are left alone", () => {
        const svg = makeSvg(700, 400);
        colorbar(svg, [["210,000", 0, "start"], ["294,000", 80, "middle"], ["378,000", 160, "end"]]);
        const res = reconcileLegendInSvg(svg);
        expect(res.labelThin).toBeUndefined();
        expect(svg.querySelectorAll("[display]").length).toBe(0);
    });

    it("two labels are the archetype's own min / max form and are never thinned", () => {
        const svg = makeSvg(700, 400);
        colorbar(svg, [["210,000", 0, "start"], ["378,000", 20, "end"]]);
        expect(reconcileLegendInSvg(svg).labelThin).toBeUndefined();
    });

    it("only NUMERIC text: three words that collide exactly like the values do are a caption row, not tick values", () => {
        const svg = makeSvg(700, 400);
        const g = colorbar(svg, [["Low value", 0, "start"], ["Mid value", 60, "middle"], ["High value", 120, "end"]]);
        expect(reconcileLegendInSvg(svg).labelThin).toBeUndefined();
        expect(g.querySelectorAll("[display]").length).toBe(0);
    });

    it("a row of DATA labels has no track under it: left alone", () => {
        const svg = makeSvg(700, 400);
        colorbar(svg, ABUTTING, { track: false });
        const res = reconcileLegendInSvg(svg);
        expect(res.labelThin).toBeUndefined();
        expect(svg.querySelectorAll("[display]").length).toBe(0);
    });

    it("a track that covers too little of the row is not its track", () => {
        const svg = makeSvg(700, 400);
        const g = colorbar(svg, ABUTTING, { track: false });
        el(g, "rect", { x: 0, y: -14, width: 40, height: 10 });
        expect(reconcileLegendInSvg(svg).labelThin).toBeUndefined();
    });

    it("a group that holds a plot mark is data territory (a treemap's cells keep their value beside the mark)", () => {
        const svg = makeSvg(700, 400);
        const g = colorbar(svg, ABUTTING);
        el(g, "rect", { class: "d3-mark", x: 0, y: -30, width: 20, height: 10 });
        expect(reconcileLegendInSvg(svg).labelThin).toBeUndefined();
    });

    it("a flat layout - the row's only common ancestor is the svg - is not reasoned about", () => {
        const svg = makeSvg(700, 400);
        el(svg, "rect", { x: 40, y: 286, width: 120, height: 10, fill: "#cccccc" });
        ABUTTING.forEach(([t, x, a]) => el(svg, "text", { x: 40 + x, y: 310, "font-size": 10, "text-anchor": a }, t));
        expect(reconcileLegendInSvg(svg).labelThin).toBeUndefined();
    });

    it("rotated rows, hidden labels, helper furniture, ticks and nested svgs are not in the population", () => {
        const rotated = makeSvg(700, 400);
        colorbar(rotated, ABUTTING, { transform: "translate(40,300) rotate(-30)" });
        expect(reconcileLegendInSvg(rotated).labelThin).toBeUndefined();

        const furniture = makeSvg(700, 400);
        const f = colorbar(furniture, ABUTTING);
        f.setAttribute("class", "llm-map-labels");
        expect(reconcileLegendInSvg(furniture).labelThin).toBeUndefined();

        const nested = makeSvg(700, 400);
        const inner = el(nested, "svg", { width: 200, height: 40 });
        colorbar(inner, ABUTTING);
        expect(reconcileLegendInSvg(nested).labelThin).toBeUndefined();

        const hidden = makeSvg(700, 400);
        const h = colorbar(hidden, ABUTTING);
        h.querySelectorAll("text")[1].setAttribute("display", "none");
        expect(reconcileLegendInSvg(hidden).labelThin).toBeUndefined();
    });

    it("only the colliding row of two colorbars is thinned", () => {
        const svg = makeSvg(700, 500);
        const a = colorbar(svg, ABUTTING);
        const b = colorbar(svg, [["1", 0, "start"], ["2", 80, "middle"], ["3", 160, "end"]], { transform: "translate(40,420)" });
        const res = reconcileLegendInSvg(svg);
        expect(res.labelThin).toEqual({ rows: 1, hidden: 1, stride: 0 });
        expect(a.querySelectorAll("[display]").length).toBe(1);
        expect(b.querySelectorAll("[display]").length).toBe(0);
    });
});
