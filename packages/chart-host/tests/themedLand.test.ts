import { describe, it, expect } from "vitest";
import { resolveOptions } from "../src/defaults";

/*
    A DARK CANVAS GETS A DARK LANDMASS. A map's land and no-data regions default to a light grey inside the chart -
    right on a light page, a glaring white world on a dark one. Only the Power BI visual named geoLandColor, so a React
    page in dark mode drew its choropleth as a white world on a dark tile.
*/
describe("map land on a dark canvas", () => {
    it("a dark canvas with no land colour named gets the theme's ink laid over it", () => {
        const o = resolveOptions({ backgroundColor: "#1f1f1f", themeFg: "#e8e8e8" } as any);
        expect(o.geoLandColor).toMatch(/^#[0-9a-f]{6}$/);
        const v = parseInt(o.geoLandColor!.slice(1, 3), 16);
        expect(v).toBeGreaterThan(0x1f);   // lighter than the canvas, so land reads against it
        expect(v).toBeLessThan(0x80);      // and nowhere near the light default
    });

    it("a light canvas is left to the chart's own default, and a named colour always wins", () => {
        expect(resolveOptions({ backgroundColor: "#ffffff", themeFg: "#333333" } as any).geoLandColor).toBeUndefined();
        expect(resolveOptions({} as any).geoLandColor).toBeUndefined();
        expect(resolveOptions({ backgroundColor: "#1f1f1f", geoLandColor: "#445566" } as any).geoLandColor).toBe("#445566");
    });
});
