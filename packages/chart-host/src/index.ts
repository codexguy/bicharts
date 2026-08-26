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
// It emits SOURCE, not a closure: a host persists chart code and re-renders it on reopen,
// shares it inside a report, and may open it on an older build — so a deterministic chart
// has to be ordinary render() source that travels the same path as generated code.
export { planTrivialChart, compileTrivialSource, type TrivialPlan, type TrivialShapeKind } from "./trivial";

// The rendered chart AS PIXELS. Telemetry thumbnails, the AI vision review, an export
// affordance - anything that wants "what the user is actually looking at" goes through the
// same serialize/rasterize/fallback path, and its traps (CSS-only sizing, non-latin1 labels,
// hung decodes) are solved once here rather than once per host.
export { captureSvgSnapshot, svgToDataUrl, svgNaturalSize, rasterizeSvgToPngDataUrl, type SnapshotOptions } from "./snapshot";
// The AI vision review's pure decision core: when to review, what the wire looks like, and
// how a verdict maps to an action. Hosts own the capture, the POST, and the ask-the-user
// dialog; the DECIDING lives here so every host resolves ambiguity the same way - toward the
// outcome that costs the user nothing.
export { shouldReview, buildReviewWire, bareBase64, actionFor, type ReviewGate, type ReviewWire, type ReviewVerdict, type ReviewAction } from "./review";
// The consent half of the same flow. It briefly existed once per host, and two copies of
// "every ambiguous answer is No" is how two hosts come to charge differently for the same
// click. Hosts localize strings and skin the chrome; the resolution rule is not an option.
export { askApplyImprovements, type ReviewDialogOptions, type ReviewDialogText } from "./reviewDialog";

// Where the "what fits?" list breaks into groups. The server decides the ORDER; hosts have to
// notice the boundaries and label them identically, or a preview block floated to the top reads
// as the highest-ranked charts in one host and as an unlabelled oddity in the other.
export {
    qualifyGroupHeadingFor, newQualifyGroupState,
    type QualifyGroupRow, type QualifyGroupState, type QualifyGroupHeading,
} from "./qualifyGroups";

// What a click on a mark AMOUNTS to (2026-08-25). The dimming already tells the reader WHICH
// marks they picked; in a host with no cross-filter to answer into — Excel, MCP, React — that
// dimming is also the ONLY response, so the selection has to state its own numbers. Arithmetic
// only, and deliberately so: it runs over the payload every consumer already holds at draw
// time, which is what makes "all chart types" true by construction and hands the capability to
// already-cached charts retroactively. The chrome is thin and per host; this is not.
export {
    computeSelectionCard, normaliseAggregation,
    type SelectionCardModel, type SelectionCardLine, type SelectionCardOptions,
} from "./selectionCard";
