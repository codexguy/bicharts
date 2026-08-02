// The "world" geoKind — the context basemap for World (Bubbles), 2026-08-02.
//
// Two properties are worth a test and both are the kind that fail SILENTLY:
//
//   1. POLYGONS ONLY. The world asset carries 62 centroid Point features (join aids the
//      choropleth needs for countries whose polygons are sub-pixel). d3.geoPath renders a
//      Point as a small circle, so shipping them to a BUBBLE map would scatter 62 grey
//      dots that look exactly like data marks. Nothing would throw; the map would just be
//      quietly wrong, which is the failure mode this package exists to remove.
//   2. THE TWO ROUTES AGREE. geo.ts (static, everything bundled) and geoLazy.ts (dynamic,
//      per-asset import) are deliberate mirrors. A kind added to one and not the other
//      gives a host geometry on one path and nothing on the other, depending only on how
//      it happened to import.
import { describe, it, expect, beforeEach } from "vitest";
import { geoForKind } from "../src/geo";
import { geoAssetFor, geoFromCache, loadGeo, clearGeoCache, registerGeoAsset } from "../src/geoLazy";

const isPoint = (f: any) => f?.geometry?.type === "Point";

describe("static route (geo.ts)", () => {
    it("serves the world kind", () => {
        const geo = geoForKind("world");
        expect(geo).toBeTruthy();
        expect(geo.type).toBe("FeatureCollection");
        expect(geo.features.length).toBeGreaterThan(100);
    });

    it("strips every centroid Point — the whole reason this is not the raw asset", () => {
        const raw = geoForKind("country-iso3");                 // the unfiltered asset
        const world = geoForKind("world");
        expect(raw.features.some(isPoint)).toBe(true);          // the asset really has them
        expect(world.features.some(isPoint)).toBe(false);       // …and the basemap has none
    });

    it("keeps the poles — a world map is not clipped like the NA basemap", () => {
        const world = geoForKind("world");
        const lats: number[] = [];
        const walk = (c: any) => Array.isArray(c[0]) ? c.forEach(walk) : lats.push(c[1]);
        world.features.forEach((f: any) => walk(f.geometry.coordinates));
        expect(Math.max(...lats)).toBeGreaterThan(75);          // NA basemap clips at 75
    });
});

describe("lazy route (geoLazy.ts)", () => {
    beforeEach(() => clearGeoCache());

    it("routes the world kind to the world asset", () => {
        expect(geoAssetFor("world")).toBe("world");
    });

    it("loads and serves polygons only", async () => {
        const geo = await loadGeo("world");
        expect(geo).toBeTruthy();
        expect(geo.features.some(isPoint)).toBe(false);
        expect(geo.features.length).toBeGreaterThan(100);
    });

    it("re-registering the asset re-derives the basemap (no stale collection)", async () => {
        await loadGeo("world");
        expect(geoFromCache("world").features.length).toBeGreaterThan(100);
        // A host that swaps in its own world asset must not keep being served the old one.
        registerGeoAsset("world", {
            type: "FeatureCollection",
            features: [
                { type: "Feature", id: "AAA", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
                { type: "Feature", id: "BBB", geometry: { type: "Point", coordinates: [5, 5] } },
            ],
        });
        const after = geoFromCache("world");
        expect(after.features.length).toBe(1);                  // re-derived, and still filtered
        expect(after.features.some(isPoint)).toBe(false);
    });

    it("does not disturb the north-america basemap it shares an asset with", async () => {
        const na = await loadGeo("north-america");
        const world = await loadGeo("world");
        expect(na.features.length).toBeLessThan(world.features.length);
        expect(na.features.some(isPoint)).toBe(false);
    });
});

describe("the two routes agree", () => {
    beforeEach(() => clearGeoCache());
    it("returns the same feature count for world on both paths", async () => {
        const staticGeo = geoForKind("world");
        const lazyGeo = await loadGeo("world");
        expect(lazyGeo.features.length).toBe(staticGeo.features.length);
    });
});
