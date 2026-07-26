import { describe, it, expect } from "vitest";
import { NA_ISO3, NA_LAT_MAX, clipFeatureToLat } from "../src/geoNaRegions";
import { WORLD_110M } from "../src/geoWorld110m.generated";

// Locks BOTH halves of the Greenland decision (2026-07-25): dropped from the North
// America BASEMAP, kept on the world map. Deliberately imports geoNaRegions + the world
// asset directly rather than geo.ts — geo.ts statically pulls ~1.3 MB (world + US states +
// US ZIP-3), which is enough to tip vitest's parallel module graph over. The NA basemap is
// derived by filtering the world asset with NA_ISO3, so applying the REAL set to the REAL
// asset here exercises the shipped behaviour without duplicating the filter's intent.

// Mirrors geo.ts's northAmerica(): membership filter, then the northern cutoff.
const naFeatures = () => (WORLD_110M.features as any[])
    .filter(f => NA_ISO3.has(f?.id) && f?.geometry && f.geometry.type !== "Point")
    .map(f => clipFeatureToLat(f, NA_LAT_MAX))
    .filter(f => f !== null);

// Every coordinate pair in a feature, regardless of Polygon/MultiPolygon nesting.
function coords(f: any): number[][] {
    const out: number[][] = [];
    const walk = (co: any) => {
        if (typeof co[0] === "number") { out.push(co as number[]); return; }
        for (const c of co) walk(c);
    };
    walk(f.geometry.coordinates);
    return out;
}

describe("North America basemap membership", () => {
    it("EXCLUDES Greenland — data-less bulk that dominates the fitExtent frame", () => {
        expect(NA_ISO3.has("GRL")).toBe(false);
        expect(naFeatures().some(f => f.id === "GRL")).toBe(false);
    });

    it("still carries the continental, Central American and Caribbean regions", () => {
        for (const iso of ["USA", "CAN", "MEX", "GTM", "PAN", "CUB", "PRI"]) {
            expect(NA_ISO3.has(iso)).toBe(true);
        }
        expect(naFeatures().length).toBeGreaterThanOrEqual(10);
    });

    it("dropping Greenland tightens the eastern extent — the reason it was removed", () => {
        // GRL reaches ~-12 lon; without it the basemap stops near -53, so the projection
        // spends its width on the continent instead of empty North Atlantic.
        let lonMax = -Infinity;
        const walk = (co: any) => {
            if (typeof co[0] === "number") { if (co[0] > lonMax) lonMax = co[0]; return; }
            for (const c of co) walk(c);
        };
        for (const f of naFeatures()) walk(f.geometry.coordinates);
        expect(lonMax).toBeLessThan(-40);
    });

    it("is polygons only — the world asset's centroid Points are join aids, not context", () => {
        expect(naFeatures().every(f => f.geometry.type !== "Point")).toBe(true);
    });
});

describe("northern cutoff", () => {
    it("nothing on the basemap sits above the cutoff", () => {
        for (const f of naFeatures()) {
            for (const [, lat] of coords(f)) expect(lat).toBeLessThanOrEqual(NA_LAT_MAX + 1e-9);
        }
    });

    it("keeps every populated latitude — Alaska's north coast and the Canadian mainland", () => {
        // The cutoff must trim empty Arctic, not real territory: both still reach into the 60s+.
        const top = (iso: string) => Math.max(...coords(naFeatures().find(f => f.id === iso)).map(c => c[1]));
        expect(top("USA")).toBeGreaterThan(65);   // Alaska
        expect(top("CAN")).toBeGreaterThan(65);
        expect(naFeatures().some(f => f.id === "CAN")).toBe(true);
        expect(naFeatures().some(f => f.id === "USA")).toBe(true);
    });

    it("actually cuts something — Canada reached past the cutoff before clipping", () => {
        const raw = (WORLD_110M.features as any[]).find(f => f.id === "CAN");
        const rawTop = Math.max(...coords(raw).map(c => c[1]));
        expect(rawTop).toBeGreaterThan(NA_LAT_MAX);   // ~83N (Ellesmere) — the reason for the cutoff
    });

    it("leaves rings closed and polygons well-formed after clipping", () => {
        for (const f of naFeatures()) {
            const rings: number[][][] = f.geometry.type === "Polygon"
                ? f.geometry.coordinates
                : ([] as number[][][]).concat(...f.geometry.coordinates);
            for (const r of rings) {
                expect(r.length).toBeGreaterThanOrEqual(4);
                expect(r[0]).toEqual(r[r.length - 1]);
            }
        }
    });

    it("is a no-op for geometry entirely below the cutoff", () => {
        const mex = (WORLD_110M.features as any[]).find(f => f.id === "MEX");
        expect(clipFeatureToLat(mex, NA_LAT_MAX)).toEqual(mex);
    });

    it("drops a feature that lies entirely above the cutoff", () => {
        const above = { id: "X", type: "Feature", properties: {},
            geometry: { type: "Polygon", coordinates: [[[0, 80], [10, 80], [10, 82], [0, 82], [0, 80]]] } };
        expect(clipFeatureToLat(above, NA_LAT_MAX)).toBeNull();
    });

    it("cuts a straddling polygon exactly on the parallel", () => {
        const straddle = { id: "X", type: "Feature", properties: {},
            geometry: { type: "Polygon", coordinates: [[[0, 70], [10, 70], [10, 80], [0, 80], [0, 70]]] } };
        const cut = clipFeatureToLat(straddle, NA_LAT_MAX)!;
        const lats = coords(cut).map(c => c[1]);
        expect(Math.max(...lats)).toBe(NA_LAT_MAX);
        expect(Math.min(...lats)).toBe(70);
    });
});

describe("the world asset is NOT affected by the basemap decision", () => {
    it("KEEPS Greenland as a joinable region for the world choropleths", () => {
        // Explicitly, by product decision: "Greenland on the world map is fine." Only the NA basemap drops it.
        const grl = (WORLD_110M.features as any[]).find(f => f.id === "GRL");
        expect(grl).toBeDefined();
        expect(grl.geometry).toBeTruthy();
    });
});
