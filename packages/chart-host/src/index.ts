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
// The city PLACEMENT table follows the SAME bundle-or-register shape as the geometry: it is
// no longer inside the resolver, because package size is the constraint in a Power BI visual
// and 93 KB of coordinates is only needed when a point map actually draws. DETECTION stays
// bundled in shape-core so offerability never waits on a fetch.
// Bundle it via "@bicharts/chart-host/geo/point-cities", or fetch the JSON and register.
// WRAPPED rather than re-exported: shape-core is bundled INTO this package, not a dependency
// of it, so a shipped .d.ts naming "@bicharts/shape-core" would point consumers at a package
// they never installed. typeSelfContainment.test.ts is what says so, and it caught this.
import { registerCityTable as _registerCityTable, isCityTableLoaded as _isCityTableLoaded } from "@bicharts/shape-core";

/** Hand the city placement table to the resolver. Without it, city lookups degrade to
 *  ZIP-3 / state / country and REPORT that coarser precision — they never guess. */
export function registerCityTable(packed: string): void { _registerCityTable(packed); }

/** True once a placement table is registered, i.e. the city tier can return coordinates. */
export function isCityTableLoaded(): boolean { return _isCityTableLoaded(); }
export { buildRenderPayload, type RenderPayload, type GeoPointBinding } from "./payload";
// requiredD3Plugins + explainRenderFailure are the two halves of the d3-plugin story (GAP-6):
// ask BEFORE rendering, explain AFTER a failure. Both belong on the public surface — a host
// that can only do the second one has already drawn a blank chart.
// stripEsmExports is on the surface for the same reason: a host that receives the
// module-form artifact and wants to compile it itself needs the same normalization the
// host applies, or the two paths disagree about what a valid chart artifact is.
export { createChartHost, compileRenderFn, stripEsmExports, requiredD3Plugins, explainRenderFailure, type ChartHost, type ChartHostConfig, type RenderFn } from "./host";
export { createMarkResolver, type MarkResolver, type MarkResolverEnv } from "./selection";

