// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createChartHost, explainRenderFailure, requiredD3Plugins } from "../src/host";

// SHAREABLE-SDK-PLAN Phase 3 (GAP-6). "Requires D3 v7" was the whole of the d3 story, and
// it was wrong for the bundled path (compileRenderFn INJECTS d3, so there is no global).
// Worse, a missing PLUGIN surfaced as `d3.sankey is not a function` thrown several frames
// inside compiled chart source — a message that tells a host nothing about what to install.

describe("d3 failure messages are actionable", () => {
    let container: HTMLElement;
    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    it("names the missing PLUGIN package and how to attach it", () => {
        const e = explainRenderFailure(new TypeError("d3.sankey is not a function"), {});
        const msg = String((e as Error).message);
        expect(msg).toContain("d3-sankey");
        expect(msg).toContain("npm install d3-sankey");
        expect(msg).toContain("Object.assign(d3");
        expect(msg).toContain("SAME d3");          // attaching to a different d3 is the trap
    });

    it("maps every plugin the visual can load", () => {
        for (const [call, pkg] of [
            ["hexbin", "d3-hexbin"],
            ["voronoiTreemap", "d3-voronoi-treemap"],
            ["voronoiMap", "d3-voronoi-map"],
            ["weightedVoronoi", "d3-weighted-voronoi"],
        ] as const) {
            const e = explainRenderFailure(new TypeError(`d3.${call} is not a function`), {});
            expect(String((e as Error).message)).toContain(pkg);
        }
    });

    it("says d3 is MISSING when none was provided, rather than blaming a plugin", () => {
        const e = explainRenderFailure(new TypeError("d3.select is not a function"), undefined);
        const msg = String((e as Error).message);
        expect(msg).toContain("no d3 was provided");
        expect(msg).toMatch(/npm install d3@7/);
        expect(msg).toMatch(/window\.d3|createChartHost/);
    });

    it("passes an unrelated error through UNCHANGED", () => {
        // Rewriting every failure into a d3 story would bury real chart bugs.
        const orig = new TypeError("Cannot read properties of null (reading 'x')");
        expect(explainRenderFailure(orig, {})).toBe(orig);
    });

    it("surfaces the actionable error from an actual render()", () => {
        const host = createChartHost(container, {
            data: { columns: [{ name: "c" }], rows: [["a", 0]] },
            code: "function render(c,d,o){ d3.sankey(); }",
            d3: {},                                  // a d3 with no sankey attached
        });
        expect(() => host.render()).toThrow(/d3-sankey/);
    });
});

// GAP-6's other half (2026-07-31): asking BEFORE the render. The message above only arrives
// once the chart has already thrown and drawn nothing, which is too late for a host that
// could simply have installed the plugin — the exact position an MCP/React consumer is in.
describe("requiredD3Plugins — what this chart needs, before running it", () => {
    it("names the package for a sankey, from code alone", () => {
        expect(requiredD3Plugins("function render(){ const g = d3.sankey().nodeWidth(15); }"))
            .toEqual(["d3-sankey"]);
    });

    it("dedupes the many call names that come from ONE package", () => {
        // sankey/sankeyLinkHorizontal/sankeyJustify all ship in d3-sankey; a host should be
        // told to install one thing, not three.
        const code = "d3.sankey(); d3.sankeyLinkHorizontal(); d3.sankeyJustify(); d3.sankeyCenter();";
        expect(requiredD3Plugins(code)).toEqual(["d3-sankey"]);
    });

    it("reports every distinct package a chart touches, sorted for a stable message", () => {
        const code = "d3.voronoiTreemap(); d3.hexbin(); d3.weightedVoronoi();";
        expect(requiredD3Plugins(code)).toEqual(["d3-hexbin", "d3-voronoi-treemap", "d3-weighted-voronoi"]);
    });

    it("returns nothing for core-only d3 — the common case must stay silent", () => {
        // Over-reporting here would train hosts to ignore the list.
        expect(requiredD3Plugins("d3.select(el).append('svg'); d3.scaleLinear(); d3.max(v);")).toEqual([]);
    });

    it("is not fooled by whitespace, and ignores look-alike member names", () => {
        expect(requiredD3Plugins("d3 . sankey ( )")).toEqual(["d3-sankey"]);
        // `mysankey(` is not `d3.sankey(`, and a bare property read is not a call.
        expect(requiredD3Plugins("mysankey(); const f = d3.sankey;")).toEqual([]);
    });

    it("never throws on empty, null or non-string input", () => {
        expect(requiredD3Plugins("")).toEqual([]);
        expect(requiredD3Plugins(null as any)).toEqual([]);
        expect(requiredD3Plugins(undefined as any)).toEqual([]);
    });

    it("agrees with explainRenderFailure — the same call maps to the same package", () => {
        // The two halves must never drift: one predicts, the other diagnoses, and a host that
        // sees different package names from them has no idea which to trust.
        for (const call of ["sankey", "hexbin", "voronoiTreemap", "voronoiMap", "weightedVoronoi"]) {
            const [pkg] = requiredD3Plugins(`d3.${call}()`);
            const msg = String((explainRenderFailure(new TypeError(`d3.${call} is not a function`), {}) as Error).message);
            expect(msg).toContain(pkg);
        }
    });
});

describe("d3 failure messages, continued", () => {
    let container: HTMLElement;
    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    it("still surfaces the actionable error from an actual render()", () => {
        const host = createChartHost(container, {
            data: { columns: [{ name: "c" }], rows: [["a", 0]] },
            code: "function render(c,d,o){ d3.sankey(); }",
            d3: {},                                  // a d3 with no sankey attached
        });
        expect(() => host.render()).toThrow(/d3-sankey/);
    });
});
