import { describe, it, expect } from "vitest";
import { styleDeclaresScroll } from "../../src/legendFit/legendReconcileDom";

// Locks the self-managed-scroll-layout detection. A table-with-embedded scorecard renders an HTML table in a <foreignObject> with its own
// inner scroll body (overflow-y:auto). Its below-the-fold rows are SCROLLED, not clipped —
// but the legend-reconcile content-fit pass read them as clipped and ballooned the viewBox,
// which preserveAspectRatio then letterboxed into huge side gutters + tiny text. The fix
// skips reconcile for such layouts; styleDeclaresScroll is the discriminating predicate.
describe("styleDeclaresScroll", () => {
    it("flags overflow-y auto/scroll (the D3 generator's inline scroll-body style)", () => {
        expect(styleDeclaresScroll("overflow-y: auto")).toBe(true);
        expect(styleDeclaresScroll("overflow-y:scroll")).toBe(true);
        expect(styleDeclaresScroll("color:#222; overflow-y: auto; padding:4px")).toBe(true);
    });
    it("flags shorthand overflow auto/scroll and overflow-x", () => {
        expect(styleDeclaresScroll("overflow: auto")).toBe(true);
        expect(styleDeclaresScroll("overflow:scroll")).toBe(true);
        expect(styleDeclaresScroll("overflow-x: scroll")).toBe(true);
    });
    it("does NOT flag hidden / visible / unrelated / empty", () => {
        expect(styleDeclaresScroll("overflow: hidden")).toBe(false);
        expect(styleDeclaresScroll("overflow-y: hidden")).toBe(false);
        expect(styleDeclaresScroll("overflow: visible")).toBe(false);
        expect(styleDeclaresScroll("color:red; padding:2px")).toBe(false);
        expect(styleDeclaresScroll("")).toBe(false);
        expect(styleDeclaresScroll(null)).toBe(false);
        expect(styleDeclaresScroll(undefined)).toBe(false);
    });
    it("flags via the computed overflow / overflowY fallback (browser path)", () => {
        expect(styleDeclaresScroll("", "visible", "auto")).toBe(true);
        expect(styleDeclaresScroll("", "scroll", "visible")).toBe(true);
        expect(styleDeclaresScroll("", "hidden", "hidden")).toBe(false);
        expect(styleDeclaresScroll(null, undefined, undefined)).toBe(false);
    });
});
