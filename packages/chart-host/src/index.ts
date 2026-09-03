// @bicharts/chart-host public surface (Phase A: contract + defaults; Phase B: geometry +
// shared payload; Phase C: the createChartHost runtime).
// NAMED, never `export *`, and that is load-bearing rather than stylistic.
//
// A consumer compiling with TypeScript's `moduleResolution: NodeNext` - the setting a
// Power BI custom visual and any modern Node build use - resolves this package through
// `exports`, lands on dist/types/index.d.ts, and then follows the re-exports inside it.
// The NAMED forms below resolve; a bare `export * from "./contract"` does NOT, and it
// fails SILENTLY: every symbol in contract.ts simply appears not to exist, with an error
// that names the symbol rather than the star. So the entire interaction grammar - the
// mark classes, the row-index attribute, the container slots, the affordance classes -
// was unimportable from a NodeNext consumer for as long as this line was a star, which is
// exactly why one of them ended up keeping its own hand-copied constants. Discovered
// 2026-08-30 when a consumer tried to stop duplicating them.
//
// Keep this list explicit and keep it in sync with contract.ts. `npm run typecheck` fails
// on a name that no longer exists; a name ADDED to contract.ts and not added here is the
// quiet direction, so add both together.
export {
    HOST_CONTRACT_VERSION,
    GEO_POINT_PRECISIONS,
    MARK_CLASS, LEGEND_MARK_CLASS, AXIS_FILTER_CLASS, ROW_IDX_ATTR, LIFT_SELECTED_CLASS,
    XFILTER_REFRESH_EVENT,
    CONTAINER_SLOT_ANIM_STOP, CONTAINER_SLOT_XF_CLEAR,
    CONTAINER_SLOT_INITIAL_XF_MARK, CONTAINER_SLOT_UI_STATE,
    HOST_CONTAINER_CLASS, SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS, ACTIVE_TICK_CLASS,
    DIM_OPACITY_VAR, DIM_OPACITY_DEFAULT,
    chartOwnsTimeline, periodTickSuppressesFeedback,
    ANIM_PLAY_SPEED_DEFAULT, ANIM_PLAY_SPEED_MIN, ANIM_PLAY_SPEED_MAX,
    ANIM_LOOP_DELAY_DEFAULT, ANIM_LOOP_DELAY_MIN,
    ANIM_MAX_IDEAL_FRAMES_DEFAULT, ANIM_MAX_IDEAL_FRAMES_MIN, ANIM_MAX_IDEAL_FRAMES_MAX,
    COLOR_SCALE_SELF_CLAMP_PCT_DEFAULT, COLOR_SCALE_SELF_CLAMP_PCT_MIN, COLOR_SCALE_SELF_CLAMP_PCT_MAX,
    FLIP_MODE_DEFAULT,
    APPROXIMATE_POSITIONS_DEFAULT,
    VALUE_AXIS_BASELINE_DEFAULT,
    type GeoPointPrecision, type GeoMapKind, type TimelineStyle, type FlipMode,
    type ApproximatePositions, type ValueAxisBaseline,
    type ColorScaleScope, type RenderOptions, type ViewStateProvider,
} from "./contract";
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
export { createChartHost, compileRenderFn, stripEsmExports, requiredD3Plugins, explainRenderFailure,
    sessionViewStateProvider, noopViewStateProvider,
    type ChartHost, type ChartHostConfig, type RenderFn } from "./host";
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
    // ...and the same job for the REFUSED half, behind "Show all chart types". The
    // boundary there is possibility rather than quality: `refusalIsSelectable` is the one place
    // either host decides whether a refused type gets a control or only a sentence.
    orderRefusalsForDisplay, refusalIsSelectable, hasRefusalsToShow,
    qualifyRefusalHeadingFor, newQualifyRefusalGroupState,
    type QualifyRefusalRow, type QualifyRefusalGroupState, type QualifyRefusalHeading,
} from "./qualifyGroups";

// The same list used as a LAUNCH PAD - opened by Generate rather than browsed beside it. Which
// outcomes exist (pick / auto / cancel, never two), when there is room to draw the chooser at
// all, and when a failed qualify may fall through to a generation. Hosts own the chrome; these
// answers are the ones that mislead silently when two hosts differ.
export {
    qualifyPick, qualifyAuto, qualifyCancel,
    launchGenerates, launchFavorStyle,
    chooserFitsViewport, shouldOpenChooserOnGenerate, shouldOpenInlineChooserOnGenerate,
    canConfirmLaunch, confirmLaunch, qualifyFailureFallsOpen,
    CHOOSER_MIN_WIDTH_PX, CHOOSER_MIN_HEIGHT_PX,
    type QualifyLaunchOutcome, type ChooserGateInput,
} from "./qualifyLaunch";

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

// A DECLARED mark that cannot receive a click is not a mark (2026-08-30). Two codegen habits
// leave a tagged element unhittable: an inert <g> whose painted children are all
// pointer-events:none (the canonical legend swatch), and a painted element that is itself
// pointer-events:none. createChartHost runs this after every render; it is exported for a host
// that drives render() itself. Additive, idempotent, and incapable of turning an UNtagged
// element into a target, so it cannot regress a chart that already works.
export { ensureCrossfilterHitTargets, type HitTargetReport } from "./hitTargets";

// A chart that ran clean and painted nothing (2026-09-01). The mark contract
// asking a question about itself: all three hosts run the same generated code against the same
// classes, so all three can go blank the same way and a copy per host is three chances to
// disagree about what blank means.
export { censusMarks, isBlankRender, blankRenderFlag, type MarkCensus, type BlankVerdictInput } from "./blankRender";
