// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { censusClippedText, clippedTextFlag } from "../src/clippedText";

// jsdom has no layout, so each box is stubbed: the census is arithmetic over rectangles.
function box(l: number, t: number, w: number, h: number) {
    return () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON() {} }) as DOMRect;
}
function frame(texts: Array<{ txt: string; rect: [number, number, number, number]; style?: string }>, svgRect: [number, number, number, number] = [0, 0, 400, 300]) {
    const c = document.createElement("div");
    c.innerHTML = `<svg>${texts.map((t, i) => `<text id="t${i}" style="${t.style ?? ""}">${t.txt}</text>`).join("")}</svg>`;
    const svg = c.querySelector("svg")!;
    svg.getBoundingClientRect = box(...svgRect);
    texts.forEach((t, i) => { (c.querySelector(`#t${i}`) as any).getBoundingClientRect = box(...t.rect); });
    document.body.appendChild(c);
    return c;
}

describe("censusClippedText", () => {
    it("counts a title whose glyphs rise above the frame (the panel-title case: 3 px over)", () => {
        const c = frame([{ txt: "Central", rect: [10, -3, 40, 12] }, { txt: "inside", rect: [10, 50, 40, 12] }]);
        const r = censusClippedText(c);
        expect(r.laidOut).toBe(true);
        expect(r.measured).toBe(2);
        expect(r.clippedCount).toBe(1);
        expect(r.clipped[0]).toMatchObject({ text: "Central", top: 3, left: 0, bottom: 0, right: 0 });
        expect(clippedTextFlag(r)).toBe('1 of 2 text label(s) are cut off by the frame; the worst, "Central", by 3px at the top.');
    });

    it("tolerates a pixel of rounding, and reports the other three sides", () => {
        const r = censusClippedText(frame([
            { txt: "ok", rect: [10, -1, 40, 12] },
            { txt: "left", rect: [-7, 50, 40, 12] },
            { txt: "bottom", rect: [10, 295, 40, 12] },
            { txt: "right", rect: [385, 50, 40, 12] },
        ]));
        expect(r.clipped.map(c => c.text).sort()).toEqual(["bottom", "left", "right"]);
    });

    it("skips hidden text and zero-size boxes", () => {
        const r = censusClippedText(frame([{ txt: "hidden", rect: [10, -9, 40, 12], style: "display:none" }, { txt: "empty", rect: [10, -9, 0, 0] }]));
        expect(r.measured).toBe(0);
        expect(r.clippedCount).toBe(0);
    });

    it("says it measured nothing when there is no layout, which is not a pass", () => {
        const c = document.createElement("div"); c.innerHTML = "<svg><text>a</text></svg>";
        const r = censusClippedText(c);
        expect(r.laidOut).toBe(false);
        expect(clippedTextFlag(r)).toBe("");
    });
});
