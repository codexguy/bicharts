// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createChartHost, explainRenderFailure } from "../src/host";

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
