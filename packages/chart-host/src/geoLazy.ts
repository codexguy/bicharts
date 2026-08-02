// LAZY geometry — the split half of GAP-11.
//
// `geo.ts` STATICALLY imports all three generated assets (world-110m 198 KB + us-states
// 250 KB + us-zip3 810 KB). That is right for a host that ships offline and air-gapped where
// the assets ARE the product. It is wrong for a web SDK: `createChartHost` imported
// geoForKind, so every consumer paid ~1.3 MB raw to render a bar chart. Measured on the
// first real build: a 2 KB entry pulling a 1,423 KB shared chunk.
//
// This module holds NO static asset import, so the runtime entry stays lean. A host has
// three ways to get geometry in, and may MIX them per asset:
//
//   1. await loadGeo(kind)                       — per-asset dynamic import; bundler splits.
//   2. import "@bicharts/chart-host/geo"         — all assets, sync, offline-proof.
//   3. import "@bicharts/chart-host/geo/world"   — ONE asset, sync, + registerGeoAsset().
//
// (3) exists because for some hosts (1) is unavailable and (2) is too much. A Power BI custom
// visual is delivered as a single JS blob with no chunk server behind it, so a dynamic import
// has nowhere to resolve to; and its sandbox iframe lacks allow-same-origin, so it has no
// persistent store to cache a fetch in either. Such a host wants MOST assets bundled (offline,
// as before) and the one 810 KB outlier fetched — which is (3) plus a fetch of the host's own
// choosing feeding registerGeoAsset. Nothing here knows or cares where the bytes came from.
//
// The cache is module-level and shared across all three routes, so a chart rendered after any
// of them resolves gets the geometry with no further work from the caller.
import { NA_ISO3, NA_LAT_MAX, clipFeatureToLat } from "./geoNaRegions";

/** The generated assets, as distinct from the many geoKinds that route to them. */
export type GeoAssetName = "world" | "us-states" | "us-zip3";

// Geometry supplied for ONE EXACT geoKind (registerGeo) — e.g. the MCP's data.geo.json, which
// is whatever that chart was generated against and need not be a shipped asset at all. Takes
// precedence over the asset store: a caller who names a kind means that kind.
const byKind = new Map<string, any>();
// Geometry supplied per ASSET (registerGeoAsset / loadGeo), serving every kind that routes to
// it. Keyed by asset rather than by kind because the country lane is open-ended — it matches
// /^country/, so no caller could enumerate the kinds to seed them one at a time.
const byAsset = new Map<GeoAssetName, any>();
// The North America basemap, derived from the world asset on first use (see northAmerica).
let _na: any | undefined;

/** Normalise a server geoKind to the ASSET it needs — the one place that mapping lives. */
export function geoAssetFor(geoKind: string | null | undefined): GeoAssetName | null {
    if (!geoKind) return null;
    const k = geoKind.toLowerCase();
    if (/^country/.test(k)) return "world";
    if (k === "north-america") return "world";          // derived from the world asset
    if (k === "world") return "world";                  // basemap-as-context (World Bubbles)
    if (k === "us-state-code" || k === "us-state-name") return "us-states";
    if (k === "us-zip5") return "us-zip3";
    return null;
}

// North America BASEMAP for point-map (lat/lon) types. Not a join target: pure grey context
// polygons, filtered from the world asset at runtime (zero extra bytes). Polygons only — the
// world asset's centroid Point features are join aids for the choropleth and would only
// clutter a context map. Mirrors geo.ts's northAmerica(); membership and the Greenland
// exclusion live in geoNaRegions, which carries no geometry, so importing it statically here
// leaves this module asset-free.
// WORLD BASEMAP for the World point map. Same job as northAmerica() — pure grey context
// polygons — minus the membership filter and the latitude clip, so it is not simply the
// raw asset: the world FeatureCollection also carries 62 centroid POINT features (join
// aids the choropleth needs for countries whose polygons are sub-pixel), and d3.geoPath
// renders a Point as a small circle. Handing those to a BUBBLE map would sprinkle 62 grey
// dots across the basemap that are indistinguishable from data marks. Polygons only.
let _worldBase: any | undefined;
function worldBasemap(world: any): any {
    if (!_worldBase) {
        _worldBase = {
            type: "FeatureCollection",
            features: (world.features as any[])
                .filter((f: any) => f?.geometry && f.geometry.type !== "Point"),
        };
    }
    return _worldBase;
}

function northAmerica(world: any): any {
    if (!_na) {
        _na = {
            type: "FeatureCollection",
            features: (world.features as any[])
                .filter((f: any) => NA_ISO3.has(f?.id) && f?.geometry && f.geometry.type !== "Point")
                .map((f: any) => clipFeatureToLat(f, NA_LAT_MAX))
                .filter((f: any) => f !== null),
        };
    }
    return _na;
}

/** Resolve a kind from the ASSET store alone (deriving the NA basemap if world is present). */
function fromAssets(key: string): any | undefined {
    const asset = geoAssetFor(key);
    if (!asset) return undefined;
    const geo = byAsset.get(asset);
    if (!geo) return undefined;
    if (key === "north-america") return northAmerica(geo);
    if (key === "world") return worldBasemap(geo);
    return geo;
}

/**
 * Load (and cache) the geometry for a geoKind. Per-asset dynamic import: requesting a US
 * state map never downloads the 810 KB zip3 asset. Resolves to undefined for an unknown
 * kind — callers treat that exactly like "no geometry", same as the sync path.
 */
export async function loadGeo(geoKind: string | null | undefined): Promise<any | undefined> {
    if (!geoKind) return undefined;
    const key = geoKind.toLowerCase();
    const already = geoFromCache(key);
    if (already) return already;
    const asset = geoAssetFor(key);
    if (!asset) return undefined;
    if (asset === "us-states") {
        byAsset.set(asset, (await import("./geoUsStates.generated")).US_STATES);
    } else if (asset === "us-zip3") {
        byAsset.set(asset, (await import("./geoUsZip3.generated")).US_ZIP3);
    } else {
        byAsset.set(asset, (await import("./geoWorld110m.generated")).WORLD_110M);
    }
    return fromAssets(key);
}

/** Synchronous cache read — what createChartHost uses, so render() stays sync. Returns
 *  undefined until the geometry has arrived by any of the three routes above. */
export function geoFromCache(geoKind: string | null | undefined): any | undefined {
    if (!geoKind) return undefined;
    const key = geoKind.toLowerCase();
    return byKind.get(key) ?? fromAssets(key);
}

/** Seed the cache for ONE EXACT geoKind from geometry the caller already holds — e.g. the
 *  MCP's data.geo.json, or the sync geoForKind from the "@bicharts/chart-host/geo" subpath. */
export function registerGeo(geoKind: string, geo: any): void {
    if (geoKind && geo) byKind.set(geoKind.toLowerCase(), geo);
}

/**
 * Seed the cache for an ASSET, serving every geoKind that routes to it — including the
 * derived North America basemap once the world asset lands. This is the seam for a host that
 * bundles some assets and fetches others: pass `WORLD_110M` from
 * "@bicharts/chart-host/geo/world", or a JSON body parsed off your own CDN. The geometry must
 * have the shape the generated asset has — a GeoJSON FeatureCollection whose feature.id is the
 * join key — because generated code binds __geoIso__ against feature.id.
 */
export function registerGeoAsset(asset: GeoAssetName, geo: any): void {
    if (!asset || !geo) return;
    byAsset.set(asset, geo);
    // Re-derive BOTH world-derived basemaps from the new asset. Missing either one here
    // leaves a stale FeatureCollection serving a kind whose source geometry just changed.
    if (asset === "world") { _na = undefined; _worldBase = undefined; }
}

/**
 * Drop every cached FeatureCollection, by kind and by asset. The cache is module-level and
 * lives as long as the page, which is what a host wants while maps are on screen — this is
 * the way back out: release ~1 MB when they are not, force a re-fetch of an asset that has
 * been republished, or start a test from a cold cache. Bundled assets seeded via
 * registerGeoAsset need re-seeding afterwards; loadGeo re-imports on its own.
 */
export function clearGeoCache(): void {
    byKind.clear();
    byAsset.clear();
    _na = undefined;
    _worldBase = undefined;
}
