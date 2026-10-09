// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fitDeferredLabels } from "../../src/legendFit/frameFitDom";
import { Rect, ViewBox } from "../../src/legendFit/frameFit";

/*
    A DEFERRED LABEL IS FITTED, AND SAYS SO.

    jsdom has no layout, so the measurement is handed in (as fitTextToFrame hands in its CTM
    mapping): each label is 0.6 of its font size per character, anchored at its x. The frame is
    a Bullet chart's after the viewBox rescue: x from -68.
*/
const NS = "http://www.w3.org/2000/svg";
const FRAME: ViewBox = { x: -68, y: 0, w: 1298, h: 626 };

function label(s: string, x: number, anchor: string, fs = 12, y = 40): SVGTextElement {
    const t = document.createElementNS(NS, "text") as SVGTextElement;
    t.setAttribute("x", String(x)); t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", anchor); t.setAttribute("font-size", String(fs));
    t.textContent = s;
    return t;
}
function measure(el: Element): Rect {
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join("");
    const fs = parseFloat(el.getAttribute("font-size") || "10");
    const w = own.length * 0.6 * fs, x = parseFloat(el.getAttribute("x") || "0"), y = parseFloat(el.getAttribute("y") || "0");
    const a = el.getAttribute("text-anchor");
    const left = a === "end" ? x - w : a === "middle" ? x - w / 2 : x;
    return { left, right: left + w, top: y - fs, bottom: y + fs * 0.3 };
}
const inside = (b: Rect) => b.left >= FRAME.x && b.right <= FRAME.x + FRAME.w && b.top >= FRAME.y && b.bottom <= FRAME.y + FRAME.h;

describe("fitDeferredLabels - the labels the viewBox could not rescue", () => {
    it("cuts an end-anchored KPI name that runs off the left edge until it is inside, and keeps the full name in a title", () => {
        const svg = document.createElementNS(NS, "svg");
        const name = "Customer Service Effort - Reduce effort to resolve a case";   // 57 chars: 410 units at 12px
        const t = label(name, 228, "end");
        svg.appendChild(t);
        const r = fitDeferredLabels([t], FRAME, measure);
        expect(r.cut).toBe(1);
        expect(inside(measure(t))).toBe(true);
        expect(t.textContent!.startsWith("Customer Service")).toBe(true);
        expect(t.querySelector("title")!.textContent).toBe(name);
        expect(r.labels[0]).toBe(name.slice(0, 40));
    });

    it("shrinks a label that fits at a slightly smaller size instead of cutting it", () => {
        const t = label("x".repeat(44), 228, "end", 12);     // 316.8 wide, room 295
        const r = fitDeferredLabels([t], FRAME, measure);
        expect(r.shrunk).toBe(1);
        expect(r.cut).toBe(0);
        expect(t.textContent).toBe("x".repeat(44));
        expect(parseFloat(t.getAttribute("font-size")!)).toBeLessThan(12);
        expect(inside(measure(t))).toBe(true);
    });

    it("counts, and leaves alone, what shortening cannot fit", () => {
        const below = label("footer", 10, "start", 12, 700);          // overflows vertically
        const held = label("left edge", -200, "start", 12);           // its held edge is outside
        const spans = label("", 228, "end", 12);
        spans.appendChild(document.createElementNS(NS, "tspan")).textContent = "a wrapped caption running off";
        const r = fitDeferredLabels([below, held, spans], FRAME, measure);
        expect(r.unfixable).toBe(3);
        expect(below.textContent).toBe("footer");
        expect(held.textContent).toBe("left edge");
    });

    it("never cuts inside a number", () => {
        // Room 130 units: 18 characters at 7.2 each, so the widest prefix is "Tickets closed 1,"
        const t = label("Tickets closed 1,234,567 in period", 63, "end", 12);
        fitDeferredLabels([t], FRAME, measure);
        const own = Array.from(t.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join("");
        expect(own).toBe("Tickets closed…");
    });
});
