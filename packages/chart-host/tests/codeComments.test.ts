import { describe, it, expect } from "vitest";
import { stripJsComments } from "../src/codeComments";
import { requiredD3Plugins } from "../src/host";

// A WORD IN A COMMENT IS NOT A CALL. A helper prepended to every generated chart documented the chart
// types it serves - "Basic Sankey" among them - so every chart carrying it read as needing d3-sankey. The
// stripper removes comments and nothing else: a check that can only REMOVE evidence must never remove code.
describe("stripJsComments", () => {
    it("removes line and block comments", () => {
        expect(stripJsComments("a(); // Basic Sankey\nb();")).toBe("a();  \nb();");
        expect(stripJsComments("a(); /* d3.sankey() */ b();")).toBe("a();   b();");
    });

    it("keeps the newlines a block comment spanned, so line numbers do not move", () => {
        expect(stripJsComments("a();/* one\ntwo\nthree */b();").split("\n").length).toBe(3);
    });

    it("never treats // inside a string as a comment", () => {
        const code = `const u = "https://cdn.example/d3-sankey"; d3.sankey();`;
        expect(stripJsComments(code)).toBe(code);
        const single = `const u = 'http://x/*y'; d3.hexbin(); // tail`;
        expect(stripJsComments(single)).toBe(`const u = 'http://x/*y'; d3.hexbin();  `);
    });

    it("never treats // inside a template literal as a comment, and still strips inside ${...}", () => {
        const code = "const t = `see https://x.io/${ n /* count */ } items`; d3.sankey();";
        expect(stripJsComments(code)).toBe("const t = `see https://x.io/${ n   } items`; d3.sankey();");
    });

    it("never treats // inside a regex literal as a comment", () => {
        const code = String.raw`const re = /https?:\/\//; if (re.test(u)) d3.sankey();`;
        expect(stripJsComments(code)).toBe(code);
        const cls = "x = s.replace(/[/*]/g, ''); d3.hexbin();";
        expect(stripJsComments(cls)).toBe(cls);
    });

    it("reads a slash after a value as division, not as a regex", () => {
        expect(stripJsComments("const h = w / 2 / 3; // half")).toBe("const h = w / 2 / 3;  ");
        expect(stripJsComments("const r = (a + b) / 2; // mean")).toBe("const r = (a + b) / 2;  ");
    });

    it("reads a slash after return as a regex", () => {
        expect(stripJsComments(String.raw`return /\/\//.test(s); // done`)).toBe(String.raw`return /\/\//.test(s);  `);
    });

    it("keeps escaped quotes inside strings", () => {
        const code = `const s = "a \\" // not a comment"; f();`;
        expect(stripJsComments(code)).toBe(code);
    });

    it("is total on empty and odd input", () => {
        expect(stripJsComments("")).toBe("");
        expect(stripJsComments(undefined as any)).toBe("");
        expect(stripJsComments("/* never closed")).toBe(" ");
    });
});

describe("requiredD3Plugins ignores plugin calls that only appear in comments", () => {
    it("a commented-out call needs nothing", () => {
        expect(requiredD3Plugins("// const s = d3.sankey();\nd3.select('svg');")).toEqual([]);
        expect(requiredD3Plugins("/* d3.hexbin().radius(4) */ d3.scaleLinear();")).toEqual([]);
    });

    it("a real call still does", () => {
        expect(requiredD3Plugins("// a sankey\nconst s = d3.sankey().nodeWidth(12);")).toEqual(["d3-sankey"]);
    });
});
