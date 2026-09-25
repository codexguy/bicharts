import { describe, it, expect } from "vitest";
import { viewportFields, type ViewportSource } from "../src/index";

/** A source that counts how often it is measured and answers from a list, one per call. */
function countingSource(...answers: { width: number; height: number }[]): ViewportSource & { calls: number } {
    const s = {
        calls: 0,
        measure() { return answers[Math.min(s.calls++, answers.length - 1)]; },
    };
    return s;
}

describe("viewportFields - one measurement, stated twice", () => {
    it("states the request's size and the client hints' size from the same answer", () => {
        const f = viewportFields({ measure: () => ({ width: 640, height: 400 }) });
        expect(f.request).toEqual({ height: 400, width: 640 });
        expect(f.hints).toEqual({ viewportWidth: 640, viewportHeight: 400 });
    });

    it("measures once per call, so the two halves cannot disagree about a tile that is resizing", () => {
        const src = countingSource({ width: 640, height: 400 }, { width: 300, height: 200 });
        const f = viewportFields(src);
        expect(src.calls).toBe(1);
        expect(f.hints.viewportWidth).toBe(f.request.width);
        expect(f.hints.viewportHeight).toBe(f.request.height);
    });

    it("serialises in the order every host already sends: height then width, then width then height", () => {
        const f = viewportFields({ measure: () => ({ width: 1024, height: 768 }) });
        expect(JSON.stringify({ ...f.request })).toBe('{"height":768,"width":1024}');
        expect(JSON.stringify({ ...f.hints })).toBe('{"viewportWidth":1024,"viewportHeight":768}');
    });

    it("passes the source's numbers through unchanged - rounding and substitution are the source's", () => {
        const f = viewportFields({ measure: () => ({ width: 800.5, height: 600.25 }) });
        expect(f.request).toEqual({ height: 600.25, width: 800.5 });
        expect(f.hints).toEqual({ viewportWidth: 800.5, viewportHeight: 600.25 });
    });

    it("lets a source that throws throw - a request is never sized by a guess", () => {
        expect(() => viewportFields({ measure: () => { throw new Error("detached"); } })).toThrow("detached");
    });

    it("returns fresh objects, so a host that edits one half does not edit the other", () => {
        const f = viewportFields({ measure: () => ({ width: 10, height: 20 }) });
        (f.request as any).width = 99;
        expect(f.hints.viewportWidth).toBe(10);
    });
});
