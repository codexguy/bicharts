// LAZY geometry — the split half of GAP-11.
//
// `geo.ts` STATICALLY imports all three generated assets (world-110m 198 KB + us-states
// 250 KB + us-zip3 810 KB). That is right for the Power BI visual, which ships offline and
// air-gapped where the assets ARE the product. It is wrong for a web SDK: `createChartHost`
// imported geoForKind, so every consumer paid ~1.3 MB raw to render a bar chart. Measured
// on the first real build: a 2 KB entry pulling a 1,423 KB shared chunk.
//
// This module holds NO static asset import, so the runtime entry stays lean. A host that
// wants bundled geometry either awaits loadGeo() (per-asset dynamic import → its own chunk,
// which any bundler can split and any CDN can cache separately) or imports the sync
// `geoForKind` from the "@bicharts/chart-host/geo" subpath and passes options.geo itself.
//
// The cache is module-level and shared with the sync path's result shape, so a chart
// rendered after loadGeo() resolves gets the geometry with no further work from the caller.
const cache = new Map<string, any>();

/** Normalise a server geoKind to the ASSET it needs — the one place that mapping lives. */
function assetFor(geoKind: string): "world" | "us-states" | "us-zip3" | null {
    const k = geoKind.toLowerCase();
    if (/^country/.test(k)) return "world";
    if (k === "north-america") return "world";          // derived from the world asset
    if (k === "us-state-code" || k === "us-state-name") return "us-states";
    if (k === "us-zip5") return "us-zip3";
    return null;
}

/**
 * Load (and cache) the geometry for a geoKind. Per-asset dynamic import: requesting a US
 * state map never downloads the 810 KB zip3 asset. Resolves to undefined for an unknown
 * kind — callers treat that exactly like "no geometry", same as the sync path.
 */
export async function loadGeo(geoKind: string | null | undefined): Promise<any | undefined> {
    if (!geoKind) return undefined;
    const key = geoKind.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const asset = assetFor(key);
    if (!asset) return undefined;
    let geo: any;
    if (asset === "us-states") {
        geo = (await import("./geoUsStates.generated")).US_STATES;
    } else if (asset === "us-zip3") {
        geo = (await import("./geoUsZip3.generated")).US_ZIP3;
    } else {
        const { WORLD_110M } = await import("./geoWorld110m.generated");
        if (key === "north-america") {
            // Same derivation as geo.ts's northAmerica(), kept in geoNaRegions (which carries
            // no geometry) so this module stays asset-free until the dynamic import runs.
            const { NA_ISO3, NA_LAT_MAX, clipFeatureToLat } = await import("./geoNaRegions");
            geo = {
                type: "FeatureCollection",
                features: (WORLD_110M.features as any[])
                    .filter((f: any) => NA_ISO3.has(f?.id) && f?.geometry && f.geometry.type !== "Point")
                    .map((f: any) => clipFeatureToLat(f, NA_LAT_MAX))
                    .filter((f: any) => f !== null),
            };
        } else {
            geo = WORLD_110M;
        }
    }
    cache.set(key, geo);
    return geo;
}

/** Synchronous cache read — what createChartHost uses, so render() stays sync. Returns
 *  undefined until loadGeo() has resolved for this kind (or a provider supplied it). */
export function geoFromCache(geoKind: string | null | undefined): any | undefined {
    return geoKind ? cache.get(geoKind.toLowerCase()) : undefined;
}

/** Seed the cache from geometry the caller already holds — e.g. the MCP's data.geo.json,
 *  or the sync geoForKind from the "@bicharts/chart-host/geo" subpath. */
export function registerGeo(geoKind: string, geo: any): void {
    if (geoKind && geo) cache.set(geoKind.toLowerCase(), geo);
}

