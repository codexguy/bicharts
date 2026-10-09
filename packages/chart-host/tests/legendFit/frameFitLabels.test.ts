// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
    fitTextToFrame, fitDeferredLabels, fitLabelToRoom, isClippedOrScrolled, FRAME_FIT_TEXT_CAP,
} from "../../src/legendFit/frameFitDom";
import { installSvgLayout, el, shownText, placeSvg, sizeSvg, withholdCtm, userBox } from "./support/svgLayout";

// THE FRAME FIT, AND ITS LABEL FIT.
//
// Generated code parks a footer caption against the raw svg edge (`y = height - 2`), where a glyph's
// descenders are sliced by the host's overflow:hidden frame. fitTextToFrame measures every <text> in the
// chart's own svg, grows the viewBox by the few units text pokes past it (and no more than 8% a side), and
// DEFERS text that is structurally outside; the deferred labels are then FITTED in place - the type shrinks
// first (never under 10px or 80% of the chart's size), then the string is cut to the widest prefix that
// fits, never inside a number, with the full text kept in a <title>. A label that overflows vertically, on
// the side its anchor holds, is rotated, or is built from tspans cannot be fitted by shortening and is only
// counted. Driven through the module's public exports on support/svgLayout.ts, which keeps the svg's CTM
// (viewBox, scale, page offset) honest so the pass's second measurement - after it grew the frame - is real.

beforeEach(() => {
    installSvgLayout();
    document.body.innerHTML = "";
});

/** A host div holding a chart svg of the given size (no viewBox: generated code sets width / height only). */
function chart(w = 690, h = 340, viewBox?: string): { host: HTMLElement; svg: SVGSVGElement } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    if (viewBox) svg.setAttribute("viewBox", viewBox);
    host.appendChild(svg);
    return { host, svg };
}

const label = (svg: Element, text: string, x: number, y: number, anchor = "start", fs = 12, extra: Record<string, string | number> = {}) =>
    el(svg, "text", { x, y, "text-anchor": anchor, "font-size": fs, ...extra }, text);

describe("fitTextToFrame - nothing to measure", () => {
    it("a host with no svg answers null", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        expect(fitTextToFrame(host)).toBeNull();
    });

    it("an svg with no text answers null", () => {
        const { host, svg } = chart();
        el(svg, "rect", { class: "d3-mark", x: 0, y: 0, width: 10, height: 10 });
        expect(fitTextToFrame(host)).toBeNull();
    });

    it("an svg with no screen matrix answers null", () => {
        const { host, svg } = chart();
        label(svg, "caption", 10, 339);
        withholdCtm(svg);
        expect(fitTextToFrame(host)).toBeNull();
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("an unreadable viewBox answers null, and leaves it as it was", () => {
        for (const bad of ["0 0 abc 340", "0 0 690", "0 0 690 340 9"]) {
            const { host, svg } = chart(690, 340, bad);
            label(svg, "caption", 10, 339);
            expect(fitTextToFrame(host), bad).toBeNull();
            expect(svg.getAttribute("viewBox")).toBe(bad);
        }
    });

    it("no viewBox and no size anywhere answers null", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const svg = el(host, "svg");
        label(svg, "caption", 10, 339);
        expect(fitTextToFrame(host)).toBeNull();
    });

    it("more than 600 texts is not measured: a Tabular's cells scroll their own body", () => {
        expect(FRAME_FIT_TEXT_CAP).toBe(600);
        const { host, svg } = chart();
        for (let i = 0; i < 601; i++) label(svg, "c", 10, 20);
        expect(fitTextToFrame(host)).toEqual({ skipped: { texts: 601, cap: 600 } });
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("exactly 600 texts is still measured", () => {
        const { host, svg } = chart();
        for (let i = 0; i < 600; i++) label(svg, "c", 10, 20);
        expect(fitTextToFrame(host)).toMatchObject({ plan: { action: "none", reason: "all-inside", considered: 600 } });
    });
});

describe("fitTextToFrame - the viewBox grows for text a few units past the frame", () => {
    it("THE CASE: a 7.5px caption flush with the frame's bottom edge grows the frame 1.5 units", () => {
        const { host, svg } = chart();
        label(svg, "Source: ERP extract, Q3", 10, 300, "start", 10);
        label(svg, "Source: ERP extract, Q3 (rounded)", 10, 339, "start", 7.5);
        const out = fitTextToFrame(host)!;
        // The caption's ink runs to 340.5 (a baseline at 339 + 0.2 em): 0.5 past the frame, + the 1-unit pad.
        expect(out.plan).toMatchObject({
            action: "extend", bottom: 1.5, top: 0, left: 0, right: 0, considered: 2, rescued: 1, deferred: 0, reason: "bottom+1.5",
            newViewBox: { x: 0, y: 0, w: 690, h: 341.5 },
        });
        expect(out.labels).toBeUndefined();
        expect(svg.getAttribute("viewBox")).toBe("0 0 690 341.5");
        expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    });

    it("every edge is judged on its own, each by its worst box", () => {
        const { host, svg } = chart();
        label(svg, "left", -6, 100, "start", 10);
        label(svg, "right edge text", 640, 150, "start", 10);
        label(svg, "top", 300, 2, "start", 10);
        label(svg, "bottom", 300, 343, "start", 10);
        const out = fitTextToFrame(host)!;
        expect(out.plan).toMatchObject({ action: "extend", left: 7, right: 41, top: 7, bottom: 6 });
        expect(out.plan!.reason).toBe("top+7,right+41,bottom+6,left+7");
        expect(svg.getAttribute("viewBox")).toBe("-7 -7 738 353");
    });

    it("text comfortably inside changes nothing and writes nothing", () => {
        const { host, svg } = chart();
        label(svg, "title", 20, 30);
        expect(fitTextToFrame(host)).toMatchObject({ plan: { action: "none", reason: "all-inside", considered: 1, rescued: 0, deferred: 0 } });
        expect(svg.getAttribute("viewBox")).toBeNull();
        expect(svg.getAttribute("preserveAspectRatio")).toBeNull();
    });

    it("an existing viewBox is the frame, keeps its origin, and keeps its preserveAspectRatio", () => {
        const { host, svg } = chart(690, 340, "10 20 690 340");
        svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
        label(svg, "caption", 20, 359, "start", 10);
        const out = fitTextToFrame(host)!;
        // Ink to 361 against a frame that ends at 360: 1 + 1.
        expect(out.plan).toMatchObject({ action: "extend", bottom: 2, newViewBox: { x: 10, y: 20, w: 690, h: 342 } });
        expect(svg.getAttribute("viewBox")).toBe("10 20 690 342");
        expect(svg.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
    });

    it("works in USER units whatever the rendered scale and page offset: half size, 30 px in from the page", () => {
        const { host, svg } = chart(345, 170, "0 0 690 340");
        placeSvg(svg, 30, 50);
        label(svg, "caption", 10, 339, "start", 7.5);
        const out = fitTextToFrame(host)!;
        expect(out.plan).toMatchObject({ action: "extend", bottom: 1.5 });
        expect(svg.getAttribute("viewBox")).toBe("0 0 690 341.5");
    });

    it("no viewBox and no width / height: the host's own size is the frame", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        Object.defineProperty(host, "offsetWidth", { value: 690 });
        Object.defineProperty(host, "offsetHeight", { value: 340 });
        const svg = el(host, "svg") as SVGSVGElement;
        sizeSvg(svg, 690, 340);
        label(svg, "caption", 10, 339, "start", 7.5);
        const out = fitTextToFrame(host)!;
        expect(out.plan).toMatchObject({ action: "extend", bottom: 1.5, newViewBox: { x: 0, y: 0, w: 690, h: 341.5 } });
        expect(svg.getAttribute("viewBox")).toBe("0 0 690 341.5");
    });

    it("a second pass over a grown frame has nothing left to do", () => {
        const { host, svg } = chart();
        label(svg, "caption", 10, 339, "start", 7.5);
        fitTextToFrame(host);
        expect(fitTextToFrame(host)).toMatchObject({ plan: { action: "none", reason: "all-inside" } });
        expect(svg.getAttribute("viewBox")).toBe("0 0 690 341.5");
    });

    it("uses the chart's own svg (the stamped one) when a carousel puts a peek first", () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const peek = el(host, "svg", { width: 690, height: 340 });
        label(peek, "peek", 10, 339, "start", 7.5);
        const real = el(host, "svg", { width: 690, height: 340, "data-lch-snapshot": "1" });
        label(real, "caption", 10, 339, "start", 7.5);
        fitTextToFrame(host);
        expect(peek.getAttribute("viewBox")).toBeNull();
        expect(real.getAttribute("viewBox")).toBe("0 0 690 341.5");
    });
});

describe("fitTextToFrame - text the chart means to have outside the frame is not measured", () => {
    it("text under a clip-path, a mask, inside <defs>, or inside a scrolling subtree is left out", () => {
        const { host, svg } = chart();
        label(svg, "ok", 20, 30);
        const clipped = el(svg, "g", { "clip-path": "url(#c)" });
        label(clipped, "horizon band", 10, 700);
        const masked = el(svg, "g", { mask: "url(#m)" });
        label(masked, "masked", 10, 700);
        const defs = el(svg, "defs");
        label(defs, "template", 10, 700);
        const scrolled = el(svg, "g", { style: "overflow-y: auto" });
        label(scrolled, "scrolled row", 10, 700);
        const out = fitTextToFrame(host)!;
        expect(out.plan).toMatchObject({ action: "none", reason: "all-inside", considered: 1 });
        expect(svg.getAttribute("viewBox")).toBeNull();
    });

    it("empty and display:none text measure nothing and are skipped", () => {
        const { host, svg } = chart();
        label(svg, "ok", 20, 30);
        label(svg, "", 10, 700);
        label(svg, "gone", 10, 700, "start", 12, { display: "none" });
        expect(fitTextToFrame(host)).toMatchObject({ plan: { action: "none", reason: "all-inside", considered: 1 } });
    });
});

describe("fitTextToFrame - the labels the viewBox could not rescue are fitted in place", () => {
    const KPI = "Customer Service Effort - Reduce effort to resolve a case";   // 57 chars: 410 units at 12px

    it("THE CASE: an end-anchored KPI name running far off the left is CUT to the frame, its full text in a title", () => {
        const { host, svg } = chart(1230, 626);
        const t = label(svg, KPI, 228, 40, "end");
        const out = fitTextToFrame(host)!;
        // Needs 183 units on the left; 8% of 1230 is 98.4, so the viewBox leaves it alone and the label is fitted.
        expect(out.plan).toMatchObject({ action: "defer", considered: 1, rescued: 0, deferred: 1, deferredIdx: [0], reason: "all-overflow-structural" });
        expect(svg.getAttribute("viewBox")).toBeNull();
        expect(out.labels).toMatchObject({ deferred: 1, shrunk: 0, cut: 1, unfixable: 0, labels: [KPI.slice(0, 40)] });
        expect(shownText(t).startsWith("Customer Service Effort")).toBe(true);
        expect(shownText(t).endsWith("…")).toBe(true);
        expect(t.querySelector("title")!.textContent).toBe(KPI);
        expect(userBox(t)!.left).toBeGreaterThanOrEqual(1);
        expect(userBox(t)!.right).toBe(228);
    });

    it("the rescued labels grow the frame first, and the deferred ones are fitted to the GROWN frame (shrunk, not cut)", () => {
        const { host, svg } = chart(1230, 626);
        // Rescued: 15 characters = 108 wide ending at x=40 hangs 68 off the left (+1 pad = 69, under the 98.4 ceiling).
        label(svg, "Customer effort", 40, 80, "end", 12);
        // Deferred: 46 characters = 331.2 wide ending at 228 needs 104.2 > 98.4. In the grown frame it has 296 of room.
        const long = label(svg, "x".repeat(46), 228, 120, "end", 12);
        const out = fitTextToFrame(host)!;
        expect(out.plan).toMatchObject({ action: "extend", left: 69, rescued: 1, deferred: 1, deferredIdx: [1] });
        expect(svg.getAttribute("viewBox")).toBe("-69 0 1299 626");
        expect(out.labels).toMatchObject({ deferred: 1, shrunk: 1, cut: 0, unfixable: 0 });
        expect(shownText(long)).toBe("x".repeat(46));
        expect(long.getAttribute("font-size")).toBe("10.5");
        expect(long.querySelector("title")).toBeNull();
    });

    it("a label that overflows vertically cannot be shortened into the frame: counted, left alone", () => {
        const { host, svg } = chart(1230, 626);
        const t = label(svg, "far below the fold", 10, 900);
        const out = fitTextToFrame(host)!;
        // y=900 is outside the 8% ceiling and outside every fit; it is counted as deferred and then as unfixable.
        expect(out.plan).toMatchObject({ action: "defer", deferred: 1 });
        expect(out.labels).toMatchObject({ deferred: 1, unfixable: 1, shrunk: 0, cut: 0 });
        expect(shownText(t)).toBe("far below the fold");
    });

    it("a rotated label has no horizontal room to give: counted as unfixable", () => {
        const { host, svg } = chart(1230, 626);
        const t = label(svg, KPI, 228, 40, "end");
        (t as any).getCTM = () => ({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 });
        const out = fitTextToFrame(host)!;
        expect(out.labels).toMatchObject({ deferred: 1, unfixable: 1, cut: 0, shrunk: 0 });
        expect(shownText(t)).toBe(KPI);
    });

    it("a second pass over the fitted chart finds every label inside and fits nothing", () => {
        const { host, svg } = chart(1230, 626);
        const t = label(svg, KPI, 228, 40, "end");
        fitTextToFrame(host);
        const after = shownText(t);
        const out = fitTextToFrame(host)!;
        expect(out.plan).toMatchObject({ action: "none", reason: "all-inside" });
        expect(out.labels).toBeUndefined();
        expect(shownText(t)).toBe(after);
        expect(t.querySelectorAll("title").length).toBe(1);
    });
});

// The measurement for fitDeferredLabels is handed in; this one is 0.6 em per character from the label's own x.
const NS = "http://www.w3.org/2000/svg";
const FRAME = { x: -68, y: 0, w: 1298, h: 626 };
function mk(s: string, x: number, anchor: string, fs: number | string = 12, y = 40, parent?: Element): SVGTextElement {
    const t = document.createElementNS(NS, "text") as SVGTextElement;
    t.setAttribute("x", String(x)); t.setAttribute("y", String(y));
    if (anchor) t.setAttribute("text-anchor", anchor);
    if (fs !== "") t.setAttribute("font-size", String(fs));
    t.textContent = s;
    if (parent) parent.appendChild(t);
    return t;
}
function measure(e: Element) {
    const own = Array.from(e.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join("");
    const fs = parseFloat(e.getAttribute("font-size") || "10");
    const w = own.length * 0.6 * fs, x = parseFloat(e.getAttribute("x") || "0"), y = parseFloat(e.getAttribute("y") || "0");
    const a = e.getAttribute("text-anchor");
    const left = a === "end" ? x - w : a === "middle" ? x - w / 2 : x;
    return { left, right: left + w, top: y - fs, bottom: y + fs * 0.3 };
}

describe("fitDeferredLabels - how each label is judged", () => {
    it("a start-anchored label running off the right is cut from the right, and keeps its left edge", () => {
        const t = mk("Operations review for the quarter ended in September", 1100, "start");
        const r = fitDeferredLabels([t], FRAME, measure);
        expect(r).toMatchObject({ deferred: 1, cut: 1, unfixable: 0 });
        expect(measure(t).left).toBe(1100);
        expect(measure(t).right).toBeLessThanOrEqual(FRAME.x + FRAME.w - 1 + 0.5);
        expect(t.querySelector("title")!.textContent).toBe("Operations review for the quarter ended in September");
    });

    it("a middle-anchored label keeps its centre and is fitted to the nearer edge", () => {
        const t = mk("A very long centred heading that cannot possibly fit near the edge", 1200, "middle");
        const r = fitDeferredLabels([t], FRAME, measure);
        expect(r.cut + r.shrunk).toBe(1);
        const b = measure(t);
        expect((b.left + b.right) / 2).toBeCloseTo(1200, 5);
        expect(b.right).toBeLessThanOrEqual(FRAME.x + FRAME.w - 1 + 0.5);
    });

    it("a label whose HELD edge is itself outside the frame cannot be shortened into it: end, start and middle alike", () => {
        const end = mk("An end-anchored label past the right edge", 1300, "end");
        const start = mk("A start-anchored label before the left edge", -200, "start");
        const middle = mk("A centred label whose centre is outside", 1400, "middle");
        const r = fitDeferredLabels([end, start, middle], FRAME, measure);
        expect(r).toMatchObject({ deferred: 3, unfixable: 3, cut: 0, shrunk: 0, labels: [] });
        expect(shownText(end)).toBe("An end-anchored label past the right edge");
        expect(shownText(start)).toBe("A start-anchored label before the left edge");
        expect(shownText(middle)).toBe("A centred label whose centre is outside");
    });

    it("an empty or whitespace label is skipped silently: neither fitted nor counted as unfixable", () => {
        const t = mk("   ", 228, "end");
        const r = fitDeferredLabels([t], FRAME, () => ({ left: -300, right: 228, top: 30, bottom: 43 }));
        expect(r).toEqual({ deferred: 1, shrunk: 0, cut: 0, unfixable: 0, labels: [] });
    });

    it("a measurement that returns nothing, or throws, is unfixable and never escapes", () => {
        const a = mk("some label", 228, "end");
        const b = mk("another label", 228, "end");
        const r = fitDeferredLabels([a, b], FRAME, e => { if (e === a) return null; throw new Error("no layout"); });
        expect(r).toMatchObject({ deferred: 2, unfixable: 2, cut: 0, shrunk: 0 });
    });

    it("the log line carries at most the first six full labels, 40 characters each", () => {
        const els = Array.from({ length: 8 }, (_, i) => mk(`Label number ${i} that is far too long to sit in the room it has`, 228, "end", 12, 40 + i));
        const r = fitDeferredLabels(els, FRAME, measure);
        expect(r.deferred).toBe(8);
        expect(r.cut + r.shrunk).toBe(8);
        expect(r.labels.length).toBe(6);
        expect(r.labels[0]).toBe("Label number 0 that is far too long to s");
    });
});

describe("fitLabelToRoom - shrink first, then cut, never below the floor", () => {
    const widthOf = (e: Element, fs: number | null = null) =>
        Array.from(e.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join("").length * 0.6 * (fs ?? parseFloat(e.getAttribute("font-size") || "12"));

    it("a label that already fits is left exactly as it is", () => {
        const t = mk("fits", 100, "start");
        expect(fitLabelToRoom(t, 24, 100, () => widthOf(t))).toBe("none");
        expect(shownText(t)).toBe("fits");
        expect(t.getAttribute("font-size")).toBe("12");
    });

    it("shrinks the type when the full text fits at no less than 80% of its size and the 10px floor", () => {
        const t = mk("x".repeat(44), 100, "start");        // 316.8 wide at 12px
        expect(fitLabelToRoom(t, 316.8, 295, () => widthOf(t))).toBe("shrunk");
        expect(t.getAttribute("font-size")).toBe("11");
        expect(shownText(t)).toBe("x".repeat(44));
        expect(t.querySelector("title")).toBeNull();
    });

    it("cuts when the shrink would go under the floor, and the full text rides a title", () => {
        const t = mk("x".repeat(44), 100, "start");
        expect(fitLabelToRoom(t, 316.8, 150, () => widthOf(t))).toBe("cut");
        expect(t.getAttribute("font-size")).toBe("12");
        expect(shownText(t).endsWith("…")).toBe(true);
        expect(widthOf(t)).toBeLessThanOrEqual(150.5);
        expect(t.querySelector("title")!.textContent).toBe("x".repeat(44));
    });

    it("if the shrink did not buy the room (hinting disagreed), it falls through to the cut and keeps the smaller type", () => {
        const t = mk("x".repeat(44), 100, "start");
        // A measurement that does not respond to the font size, as hinted text can fail to.
        const stubborn = () => shownText(t).length * 7.2;
        expect(fitLabelToRoom(t, 316.8, 295, stubborn)).toBe("cut");
        expect(t.getAttribute("font-size")).toBe("11");
        expect(shownText(t).endsWith("…")).toBe(true);
        expect(t.querySelector("title")).not.toBeNull();
    });

    it("an existing <title> is reused, not stacked", () => {
        const t = mk("x".repeat(44), 100, "start");
        const title = document.createElementNS(NS, "title");
        title.textContent = "tooltip already here";
        t.appendChild(title);
        fitLabelToRoom(t, 316.8, 150, () => widthOf(t));
        expect(t.querySelectorAll("title").length).toBe(1);
        expect(t.querySelector("title")!.textContent).toBe("tooltip already here");
        expect(shownText(t).endsWith("…")).toBe(true);
    });

    it("room for nothing leaves the label EMPTY - unless the caller says how many characters must survive", () => {
        const a = mk("Operations", 100, "start");
        expect(fitLabelToRoom(a, 60, 3, () => widthOf(a))).toBe("cut");
        expect(shownText(a)).toBe("");

        const b = mk("Operations", 100, "start");
        expect(fitLabelToRoom(b, 60, 3, () => widthOf(b), 3)).toBe("cut");
        expect(shownText(b)).toBe("Ope…");
        expect(b.querySelector("title")!.textContent).toBe("Operations");

        const c = mk("Op", 100, "start");
        expect(fitLabelToRoom(c, 12, 3, () => widthOf(c), 3)).toBe("cut");
        expect(shownText(c)).toBe("");
    });

    it("never cuts inside a number: 'largest 128 of 400' does not become 'largest 12…'", () => {
        const t = mk("largest 128 of 400", 100, "start");
        // Room for 11 characters at 7.2: the widest prefix is "largest 12…", which splits 128.
        fitLabelToRoom(t, 129.6, 80, () => widthOf(t));
        expect(shownText(t)).toBe("largest…");
    });
});

describe("isClippedOrScrolled - is being outside the frame the chart's intent?", () => {
    function inChain(tag: string, attrs: Record<string, string> = {}): { text: Element; svg: Element; holder: Element } {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const svg = el(host, "svg", { width: 100, height: 100 });
        const holder = el(svg, tag, attrs);
        const text = el(holder, "text", { x: 0, y: 0 }, "t");
        return { text, svg, holder };
    }

    it("defs, clipPath, mask and symbol subtrees are never on screen", () => {
        for (const tag of ["defs", "clipPath", "mask", "symbol"]) {
            const { text, svg } = inChain(tag);
            expect(isClippedOrScrolled(text, svg), tag).toBe(true);
        }
    });

    it("a clip-path or mask attribute on the element or any ancestor", () => {
        const a = inChain("g", { "clip-path": "url(#c)" });
        expect(isClippedOrScrolled(a.text, a.svg)).toBe(true);
        const b = inChain("g", { mask: "url(#m)" });
        expect(isClippedOrScrolled(b.text, b.svg)).toBe(true);
        const c = inChain("g");
        c.text.setAttribute("clip-path", "url(#c)");
        expect(isClippedOrScrolled(c.text, c.svg)).toBe(true);
    });

    it("a scrolling ancestor, by overflow or overflow-y", () => {
        for (const style of ["overflow: auto", "overflow: scroll", "overflow-y: auto", "overflow-y: scroll"]) {
            const { text, svg } = inChain("g", { style });
            expect(isClippedOrScrolled(text, svg), style).toBe(true);
        }
    });

    it("hidden or visible overflow, and an ordinary group, are not", () => {
        for (const style of ["overflow: hidden", "overflow: visible", "color: red"]) {
            const { text, svg } = inChain("g", { style });
            expect(isClippedOrScrolled(text, svg), style).toBe(false);
        }
        const plain = inChain("g");
        expect(isClippedOrScrolled(plain.text, plain.svg)).toBe(false);
    });

    it("the walk stops at the svg's own parent: a scrolling wrapper OUTSIDE the chart does not count, the svg itself does", () => {
        const wrapper = document.createElement("div");
        wrapper.setAttribute("style", "overflow: auto");
        document.body.appendChild(wrapper);
        const svg = el(wrapper, "svg", { width: 100, height: 100 });
        const text = el(svg, "text", { x: 0, y: 0 }, "t");
        expect(isClippedOrScrolled(text, svg)).toBe(false);
        svg.setAttribute("style", "overflow: auto");
        expect(isClippedOrScrolled(text, svg)).toBe(true);
    });
});
