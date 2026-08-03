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
// The city gazetteer is BUNDLED in the resolver (shape-core), deliberately — a served table
// silently coarsens by-name point maps in air-gapped and shared-report sessions, and the
// Power BI sandbox has no durable cache to soften that. registerCityTable is the escape
// hatch for a host that needs a DIFFERENT gazetteer, not a required setup step.
// WRAPPED rather than re-exported: shape-core is bundled INTO this package, not a dependency
// of it, so a shipped .d.ts naming "@bicharts/shape-core" would point consumers at a package
// they never installed. typeSelfContainment.test.ts is what says so, and it caught that.
import { registerCityTable as _registerCityTable } from "@bicharts/shape-core";

/** REPLACE the bundled city gazetteer with another packed table. Rarely needed — see the
 *  note above registerCityTable in shape-core's geoPoint.ts before using it. */
export function registerCityTable(packed: string): void { _registerCityTable(packed); }
export { buildRenderPayload, type RenderPayload, type GeoPointBinding } from "./payload";
// requiredD3Plugins + explainRenderFailure are the two halves of the d3-plugin story (GAP-6):
// ask BEFORE rendering, explain AFTER a failure. Both belong on the public surface — a host
// that can only do the second one has already drawn a blank chart.
// stripEsmExports is on the surface for the same reason: a host that receives the
// module-form artifact and wants to compile it itself needs the same normalization the
// host applies, or the two paths disagree about what a valid chart artifact is.
export { createChartHost, compileRenderFn, stripEsmExports, requiredD3Plugins, explainRenderFailure, type ChartHost, type ChartHostConfig, type RenderFn } from "./host";
export { createMarkResolver, type MarkResolver, type MarkResolverEnv } from "./selection";
// Deterministic charts for shapes with exactly one defensible answer: a single value, a
// single categorical column, a single numeric column. Returns null for everything else, so
// a host can ask BEFORE paying for a generation and fall through the moment the answer
// becomes a real choice. d3-free by design — these draw before any chart library loads.
export { planTrivialChart, type TrivialPlan, type TrivialShapeKind } from "./trivial";

