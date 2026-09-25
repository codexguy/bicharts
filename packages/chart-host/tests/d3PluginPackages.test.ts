import { describe, it, expect } from "vitest";
import { D3_PLUGIN_PACKAGES, requiredD3Plugins } from "../src/index";

// The plugin map is exported so a host that writes install instructions can prove it covers every
// package the scan can name. It is the same map requiredD3Plugins reads, and it cannot be edited
// from outside.
describe("D3_PLUGIN_PACKAGES", () => {
    it("is the map requiredD3Plugins reads: every name resolves to its package", () => {
        for (const [name, pkg] of Object.entries(D3_PLUGIN_PACKAGES)) {
            expect(requiredD3Plugins(`d3.${name}()`), name).toEqual([pkg]);
        }
    });

    it("names the packages the visual loads, and nothing else", () => {
        expect([...new Set(Object.values(D3_PLUGIN_PACKAGES))].sort()).toEqual([
            "d3-hexbin", "d3-sankey", "d3-voronoi-map", "d3-voronoi-treemap", "d3-weighted-voronoi", "mermaid",
        ]);
    });

    it("is frozen", () => {
        expect(Object.isFrozen(D3_PLUGIN_PACKAGES)).toBe(true);
        expect(() => { (D3_PLUGIN_PACKAGES as Record<string, string>).extra = "x"; }).toThrow();
    });
});
