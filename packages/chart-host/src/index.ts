// @bicharts/chart-host public surface (Phase A: contract + defaults; Phase B: geometry +
// shared payload; Phase C: the createChartHost runtime).
export * from "./contract";
export { resolveOptions, type ResolveOptionsInput } from "./defaults";
// GEOMETRY IS NOT RE-EXPORTED HERE ON PURPOSE. "./geo" statically imports ~1.3 MB of
// generated FeatureCollections, so re-exporting it from the package entry made every
// consumer pay for a basemap to draw a bar chart. The lazy API below costs nothing until
// called; the sync `geoForKind` lives at the "@bicharts/chart-host/geo" subpath for hosts that
// want everything bundled, and the per-asset "@bicharts/chart-host/geo/<asset>" subpaths for
// hosts that want SOME of it bundled and the rest supplied via registerGeoAsset.
export {
    loadGeo, geoFromCache, registerGeo, registerGeoAsset, geoAssetFor, clearGeoCache,
    type GeoAssetName,
} from "./geoLazy";
export { buildRenderPayload, type RenderPayload, type GeoPointBinding } from "./payload";
export { createChartHost, compileRenderFn, type ChartHost, type ChartHostConfig, type RenderFn } from "./host";
export { createMarkResolver, type MarkResolver, type MarkResolverEnv } from "./selection";

