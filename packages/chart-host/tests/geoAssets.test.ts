import { describe, it, expect, beforeEach } from "vitest";
import { geoAssetFor, geoFromCache, registerGeo, registerGeoAsset, clearGeoCache } from "../src/geoLazy";
import { WORLD_110M } from "../src/geoWorld110m.generated";
import { NA_ISO3 } from "../src/geoNaRegions";

// PER-ASSET GEOMETRY (0.1.9). A host can now bundle SOME assets and supply the rest itself.
//
// The case that forced it: a Power BI custom visual is one JS blob with no chunk server, so
// loadGeo's dynamic import has nowhere to resolve to; and its sandbox iframe lacks
// allow-same-origin, so localStorage/IndexedDB throw SecurityError and a fetch cannot be
// cached across sessions. That host wants world + us-states bundled (offline, as before) and
// the 810 KB ZIP-3 asset — 31% of its whole bundle, for a chart type with no production use —
// fetched on demand. registerGeoAsset is the seam; these tests are what stop it rotting.
//
// The load-bearing assertion is the LAST one: an asset nobody registered must stay
// unresolvable. If it ever resolves, some import path is dragging the geometry back in and
// the host's bundle silently doubles again with nothing going red.

// The cache is module-level and page-lived by design, so every test starts by clearing it —
// otherwise one test's registration silently satisfies the next one's "is it still absent?".
beforeEach(() => clearGeoCache());

describe("geoAssetFor — the one place kind -> asset lives", () => {
    it("routes every country-* kind to the world asset", () => {
        for (const k of ["country-iso3", "country-iso2", "country-name", "COUNTRY-ISO3"]) {
            expect(geoAssetFor(k)).toBe("world");
        }
    });

    it("routes the North America basemap to the world asset it is derived from", () => {
        expect(geoAssetFor("north-america")).toBe("world");
    });

    it("routes both US state kinds to us-states, and zip5 to us-zip3", () => {
        expect(geoAssetFor("us-state-code")).toBe("us-states");
        expect(geoAssetFor("us-state-name")).toBe("us-states");
        expect(geoAssetFor("us-zip5")).toBe("us-zip3");
    });

    it("returns null for an unknown or absent kind rather than guessing", () => {
        expect(geoAssetFor("moon-craters")).toBeNull();
        expect(geoAssetFor(null)).toBeNull();
        expect(geoAssetFor(undefined)).toBeNull();
        expect(geoAssetFor("")).toBeNull();
    });
});

describe("registerGeoAsset serves every kind that routes to the asset", () => {
    beforeEach(() => registerGeoAsset("world", WORLD_110M));

    it("seeds the open-ended country lane from ONE call", () => {
        // The reason the store is keyed by asset and not by kind: /^country/ cannot be
        // enumerated, so a kind-keyed seed would need a call per spelling and still miss one.
        expect(geoFromCache("country-iso3")).toBe(WORLD_110M);
        expect(geoFromCache("country-iso2")).toBe(WORLD_110M);
        expect(geoFromCache("country-name")).toBe(WORLD_110M);
    });

    it("is case-insensitive on the kind, like the rest of the geo path", () => {
        expect(geoFromCache("COUNTRY-ISO3")).toBe(WORLD_110M);
    });

    it("DERIVES the North America basemap from the world asset", () => {
        const na = geoFromCache("north-america");
        expect(na?.type).toBe("FeatureCollection");
        expect(na.features.length).toBeGreaterThanOrEqual(10);
        // The derivation is the real one, not a passthrough: membership filtered, Greenland
        // dropped, centroid Points excluded.
        expect(na.features.every((f: any) => NA_ISO3.has(f.id))).toBe(true);
        expect(na.features.some((f: any) => f.id === "GRL")).toBe(false);
        expect(na.features.every((f: any) => f.geometry.type !== "Point")).toBe(true);
        expect(na).not.toBe(WORLD_110M);
    });

    it("re-derives the basemap when a NEW world asset is registered", () => {
        const first = geoFromCache("north-america");
        registerGeoAsset("world", {
            type: "FeatureCollection",
            features: (WORLD_110M.features as any[]).filter(f => f.id === "CAN"),
        });
        const second = geoFromCache("north-america");
        expect(second).not.toBe(first);
        expect(second.features.length).toBe(1);
        registerGeoAsset("world", WORLD_110M);   // restore for the rest of the file
    });

    it("ignores a null asset or null geometry instead of poisoning the cache", () => {
        registerGeoAsset("world", null);
        registerGeoAsset(null as any, { type: "FeatureCollection", features: [] });
        expect(geoFromCache("country-iso3")).toBe(WORLD_110M);
    });
});

describe("an exact-kind registration outranks the asset store", () => {
    it("lets a caller who names a kind mean that kind — the MCP's data.geo.json case", () => {
        registerGeoAsset("world", WORLD_110M);
        const bespoke = { type: "FeatureCollection", features: [] };
        registerGeo("country-iso3", bespoke);
        expect(geoFromCache("country-iso3")).toBe(bespoke);
        // …and only that kind. Its siblings still resolve from the asset.
        expect(geoFromCache("country-name")).toBe(WORLD_110M);
    });
});

describe("an unregistered asset stays unresolvable", () => {
    it("does NOT serve us-zip3 from a bundle that never imported it", () => {
        // THE POINT OF THE WHOLE EXERCISE. A host that bundles world + us-states and fetches
        // ZIP-3 must get undefined here until its fetch lands. If this ever returns geometry,
        // some import path is pulling the 810 KB asset back into the bundle — which is exactly
        // the regression that is otherwise invisible until someone re-measures the artifact.
        expect(geoFromCache("us-zip5")).toBeUndefined();
    });

    it("resolves it once the host supplies it, from wherever the host got it", () => {
        const fetched = { type: "FeatureCollection", features: [{ id: "902", type: "Feature" }] };
        registerGeoAsset("us-zip3", fetched);
        expect(geoFromCache("us-zip5")).toBe(fetched);
    });

    it("clearGeoCache releases both stores, so a re-fetch is possible", () => {
        registerGeoAsset("world", WORLD_110M);
        registerGeo("country-iso3", { type: "FeatureCollection", features: [] });
        clearGeoCache();
        expect(geoFromCache("country-iso3")).toBeUndefined();
        expect(geoFromCache("country-name")).toBeUndefined();
        expect(geoFromCache("north-america")).toBeUndefined();
    });
});
