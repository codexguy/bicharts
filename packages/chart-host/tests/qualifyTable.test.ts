import { describe, it, expect } from "vitest";
import { qualifyTableRows, QUALIFY_KIND_BADGES, qualifyKindBadgeStyle } from "../src/qualifyTable";
import { deltaEHex } from "../src/deltaE";
import { relativeLuminance, contrastRatio, toRGBA } from "../src/labelContrast";
import { parseQualifyResponse, QUALIFY_KINDS } from "@bicharts/shape-core";

describe("qualifyTableRows: the what-fits answer as table rows", () => {
    const rows = [
        { name: "Line chart", description: "A line.", rank: 1, language: "JavaScript", renderer: "D3", recommended: true, isPreview: false },
        { name: "Horizon chart", rank: 6, isPreview: true, recommended: true, alsoWorthALook: true },
        { name: "Pie chart", rank: 9, recommended: false },
        { name: "Unranked", description: null },
    ];

    it("keeps the server's order and carries rank, preview, verdict and the extra-pick flag", () => {
        expect(qualifyTableRows(rows)).toEqual([
            { rank: 1, name: "Line chart", preview: false, fit: "fits", description: "A line.", language: "JavaScript", renderer: "D3", alsoWorthALook: false, kind: null },
            { rank: 6, name: "Horizon chart", preview: true, fit: "fits", description: "", language: null, renderer: null, alsoWorthALook: true, kind: null },
            { rank: 9, name: "Pie chart", preview: false, fit: "can-also-render", description: "", language: null, renderer: null, alsoWorthALook: false, kind: null },
            { rank: null, name: "Unranked", preview: false, fit: "fits", description: "", language: null, renderer: null, alsoWorthALook: false, kind: null },
        ]);
    });

    it("never carries the selection weight", () => {
        const out = qualifyTableRows([{ name: "A", rank: 1, score: 61.9 } as never]);
        expect(Object.keys(out[0])).not.toContain("score");
    });
});

describe("the kind badge: a row's kind and the four badges", () => {
    it("carries a known kind; a plain chart, an unknown kind and an older server's row have kind null", () => {
        const out = qualifyTableRows([
            { name: "Choropleth", kind: "map" }, { name: "Pivot", kind: "table", isPreview: true }, { name: "KPI card", kind: "kpi" },
            { name: "Explainer", kind: "app" }, { name: "Bar", kind: "chart" }, { name: "Odd", kind: "widget" }, { name: "Old" },
        ]);
        expect(out.map(r => r.kind)).toEqual(["map", "table", "kpi", "app", null, null, null]);
        // The badge never reorders, drops or changes a row's other fields.
        expect(out.map(r => r.name)).toEqual(["Choropleth", "Pivot", "KPI card", "Explainer", "Bar", "Odd", "Old"]);
        expect(out[1].preview).toBe(true);
    });

    it("reads the kind straight from shape-core's parse of a qualify answer", () => {
        const parsed = parseQualifyResponse({ charts: [{ name: "A", kind: "map" }, { name: "B" }] }).charts!;
        expect(qualifyTableRows(parsed).map(r => r.kind)).toEqual(["map", null]);
    });

    it("badges exactly the kinds shape-core parses: four, and no Chart badge", () => {
        expect(Object.keys(QUALIFY_KIND_BADGES)).toEqual([...QUALIFY_KINDS]);
        expect(Object.values(QUALIFY_KIND_BADGES).map(b => b.label)).toEqual(["App", "Table", "Map", "KPI"]);
    });

    it("the light fills are the chart gallery's family tints, and the four fills differ on each pane", () => {
        expect(QUALIFY_KIND_BADGES.app.light.background).toBe("#FCE7E3");
        expect(QUALIFY_KIND_BADGES.table.light.background).toBe("#E6EBF2");
        expect(QUALIFY_KIND_BADGES.map.light.background).toBe("#E1F3EF");
        expect(QUALIFY_KIND_BADGES.kpi.light.background).toBe("#FBF0D6");
        for (const pane of ["light", "dark"] as const) {
            const fills = Object.values(QUALIFY_KIND_BADGES).map(b => b[pane].background.toLowerCase());
            expect(new Set(fills).size, pane).toBe(4);
        }
    });

    const contrast = (a: string, b: string) => contrastRatio(relativeLuminance(toRGBA(a)!), relativeLuminance(toRGBA(b)!));

    it("text reaches WCAG AA (4.5:1) on every fill, light and dark", () => {
        for (const [kind, b] of Object.entries(QUALIFY_KIND_BADGES)) {
            expect(contrast(b.light.text, b.light.background), `${kind} light`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(b.dark.text, b.dark.background), `${kind} dark`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("records how far apart the fills are (CIEDE2000): distinct with the word beside them, not 20", () => {
        const kinds = Object.keys(QUALIFY_KIND_BADGES) as (keyof typeof QUALIFY_KIND_BADGES)[];
        const closest = (pane: "light" | "dark") => {
            let min = Infinity;
            for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) {
                min = Math.min(min, deltaEHex(QUALIFY_KIND_BADGES[kinds[i]][pane].background, QUALIFY_KIND_BADGES[kinds[j]][pane].background));
            }
            return min;
        };
        // Measured: the nearest light pair (map, table) is about 8.5 apart; the nearest dark pair about 18.
        expect(closest("light")).toBeGreaterThan(8);
        expect(closest("dark")).toBeGreaterThan(17);
    });

    it("qualifyKindBadgeStyle: the pane's pair, no fill in high contrast, nothing for a chart", () => {
        expect(qualifyKindBadgeStyle("map", "light")).toEqual({ label: "Map", background: "#E1F3EF", color: "#175C52", border: "none" });
        expect(qualifyKindBadgeStyle("kpi", "dark")).toEqual({ label: "KPI", background: "#543A08", color: "#FBF0D6", border: "none" });
        expect(qualifyKindBadgeStyle("app", { highContrastForeground: "#ffff00" }))
            .toEqual({ label: "App", background: "transparent", color: "#ffff00", border: "1px solid #ffff00" });
        expect(qualifyKindBadgeStyle(null, "light")).toBeNull();
        expect(qualifyKindBadgeStyle("chart", "dark")).toBeNull();
        expect(qualifyKindBadgeStyle("toString", "light")).toBeNull();
    });
});
