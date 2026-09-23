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
        // `mysankey(` is not `d3.sankey(`. (A bare read of d3.sankey IS a use since 2026-09-23 - see below.)
        expect(requiredD3Plugins("mysankey();")).toEqual([]);
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

// A PLUGIN REACHED THROUGH A MEMBER, NOT A CALL. Mermaid attaches onto d3 like every other
// plugin, but it is a NAMESPACE object: the chart says d3.mermaid.render(id, text), so the
// plugin name is followed by a DOT and a parenthesis-only scan found nothing to install. The
// host then learned what the chart needed only from the crash — the exact blind spot
// requiredD3Plugins exists to close.
describe("requiredD3Plugins — a plugin reached through a member", () => {
    it("names mermaid from d3.mermaid.render(...)", () => {
        expect(requiredD3Plugins("async function render(c,d,o){ const s = await d3.mermaid.render('id', txt); }"))
            .toEqual(["mermaid"]);
    });

    it("names it however the call is spaced, and from any member of it", () => {
        expect(requiredD3Plugins("d3 . mermaid . render(id, txt)")).toEqual(["mermaid"]);
        expect(requiredD3Plugins("d3.mermaid.initialize({ startOnLoad: false });")).toEqual(["mermaid"]);
    });

    it("names mermaid from the HELPER a real chart actually calls", () => {
        // The shape that made this necessary: the server prepends a helper into the generated
        // code and the HELPER is what reaches for the library, so a genuine diagram chart says
        // d3.llmMermaid(...) and never once writes d3.mermaid. Knowing only the library name,
        // this scan answered "nothing to install" for exactly the charts that need it most.
        expect(requiredD3Plugins("return d3.llmMermaid(frame, dsl, { options: options });"))
            .toEqual(["mermaid"]);
        expect(requiredD3Plugins("function render(c,d,o){ return d3.llmMermaid(f, t, {}); }"))
            .toEqual(["mermaid"]);
    });

    it("reports mermaid ONCE when a chart names both the helper and the library", () => {
        expect(requiredD3Plugins("d3.llmMermaid(f, t, {}); d3.mermaid.parse(t);")).toEqual(["mermaid"]);
    });

    it("does not name it for the OTHER server-shipped helpers", () => {
        // llmMermaid is mapped because the helper it names reaches a library the host must
        // install. Every other d3.llm* helper is self-contained, and mapping one of those would
        // send a host to npm for a chart that needs nothing.
        expect(requiredD3Plugins("d3.llmTooltip(container); d3.llmFitLabel(t, 100, {});")).toEqual([]);
        expect(requiredD3Plugins("d3.llmSlider(svg, {}); d3.llmScrubber(svg, {});")).toEqual([]);
    });

    it("reports a bare READ, an alias, a bracket and a destructure - any reference is a use", () => {
        // Was "a read is not a use". Reversed on 2026-09-23: a chart that aliases the plugin needs
        // it as much as one that calls it, and the Power BI visual kept a loose test of its own to cover
        // that. One contract now serves every host.
        expect(requiredD3Plugins("const m = d3.mermaid;")).toEqual(["mermaid"]);
        expect(requiredD3Plugins("mysankey(); const f = d3.sankey;")).toEqual(["d3-sankey"]);
        expect(requiredD3Plugins("if (typeof d3.hexbin === 'function') {}")).toEqual(["d3-hexbin"]);
        expect(requiredD3Plugins("const layout = d3['sankey'];")).toEqual(["d3-sankey"]);
        expect(requiredD3Plugins("const { sankey, sankeyLinkHorizontal: link } = d3;")).toEqual(["d3-sankey"]);
        // still gated by the map: a core member or a look-alike name is nothing to install
        expect(requiredD3Plugins("const s = d3.scaleLinear; const x = d3.sankeyish;")).toEqual([]);
        // and still blind to comments
        expect(requiredD3Plugins("// const f = d3.sankey;\nd3.select('svg');")).toEqual([]);
    });

    it("leaves every PRE-EXISTING answer exactly where it was", () => {
        // A scan that learned about dots must not have changed a single old verdict.
        expect(requiredD3Plugins("d3.sankey().nodeWidth(15)")).toEqual(["d3-sankey"]);
        expect(requiredD3Plugins("d3.sankeyLinkHorizontal(); d3.sankeyJustify(); d3.sankeyCenter(); d3.sankeyLeft(); d3.sankeyRight();"))
            .toEqual(["d3-sankey"]);
        expect(requiredD3Plugins("d3.hexbin().radius(8)")).toEqual(["d3-hexbin"]);
        expect(requiredD3Plugins("d3.voronoiTreemap(); d3.voronoiMap(); d3.weightedVoronoi();"))
            .toEqual(["d3-voronoi-map", "d3-voronoi-treemap", "d3-weighted-voronoi"]);
        // Core d3 chained through a member is the case a widened scan could have broken.
        expect(requiredD3Plugins("d3.scaleLinear.name; d3.select(el).append('svg'); d3.max(v); d3.timeFormat('%Y')('x');"))
            .toEqual([]);
    });
});

describe("explainRenderFailure — a missing Mermaid says so", () => {
    it("names the library, says this host did not load it, and shows how to attach it", () => {
        for (const raw of [
            "d3.mermaid.render is not a function",
            "Cannot read properties of undefined (reading 'render') — d3.mermaid is undefined",
            "mermaid is not defined",
        ]) {
            const msg = String((explainRenderFailure(new TypeError(raw), {}) as Error).message);
            expect(msg).toContain("[@bicharts/chart-host]");
            expect(msg).toContain("Mermaid");
            expect(msg).toContain("d3.mermaid.render");
            expect(msg).toContain("npm install mermaid");
            expect(msg).toContain("Object.assign(d3, { mermaid })");
            expect(msg).toContain("SAME d3");        // attaching to a different d3 is the trap
            expect(msg).toContain(raw);              // the original is never thrown away
            // A namespace library has a DEFAULT export; the generic plugin advice would send a
            // host to `import { mermaid } from "mermaid"`, which does not exist.
            expect(msg).not.toContain("import { mermaid }");
        }
    });

    it("steps aside once a real mermaid IS attached", () => {
        // The chart names mermaid while failing for its own reason; that is not a missing library.
        const orig = new TypeError("mermaid diagram text was empty");
        expect(explainRenderFailure(orig, { mermaid: { render: () => {} } })).toBe(orig);
    });

    it("still blames the MISSING d3 before it blames Mermaid", () => {
        const e = explainRenderFailure(new TypeError("d3.mermaid.render is not a function"), undefined);
        expect(String((e as Error).message)).toContain("no d3 was provided");
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
