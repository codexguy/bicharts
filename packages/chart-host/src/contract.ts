// @bicharts/chart-host — the HOST CONTRACT the generated D3 code targets.
//
// Single source of truth for: the render options surface, the interaction grammar
// (mark classes, the cross-filter event, container lifecycle slots), and the
// option defaults/clamps. Shared by the Power BI visual (which assembles
// options through resolveOptions) and any other host (MCP preview/contract, SDK),
// so a knob's default lives in ONE place instead of drifting across the visual, the
// archetype `||` fallbacks, and the MCP prose.
//
// Types and defaults only; the runtime (createChartHost) and the selection extraction
// live alongside them.
// The generated code is unchanged — this describes what it already expects.

// Bump when the contract changes in a way a host must adapt to (semver). Stamped
// into the MCP integration contract so a caller can pin behavior.
// 1.2.0 (2026-08-02): gazetteer v2. GeoPointBinding gained mapKind; geoPoint gained
// ambiguousExamples; and ambiguousRows CHANGED MEANING — it now counts rows REFUSED
// (multiple possible matches, not plotted, null coordinates) where it used to count rows
// placed by a largest-city tie-break. Old generated code stays honest without changes:
// refused rows carry null coordinates, so its own off-map counting covers them.
// 1.1.0 (2026-08-02): GeoPointPrecision gained "country" for the World point map. Additive,
// but a host that switches exhaustively on the tier or holds its own Record<Precision, …>
// has a new case to handle — which is exactly what this version exists to announce.
export const HOST_CONTRACT_VERSION = "1.4.0";
// 1.4.0 (2026-08-04): __geoPrecision__. Point-map payloads gain a per-row column naming
// the tier that placed each row ("latlon" | "city" | "zip3" | "state" | "country", null
// when unplaced). Additive - the aggregate geoPoint counts are unchanged - but it is what
// lets a MARK disclose that it is not where its own row names: a country-tier row sits on
// the country largest city, so Inverness drew on London, stacked under the real London row
// with a tooltip reading as exact. A host on 1.3.0 simply ignores the extra column.
// 1.3.0 (2026-08-03): planTrivialChart. Additive - a host can now ask whether a dataset
// has exactly one defensible chart (a single value, a single categorical column, a single
// numeric column) and render it locally instead of paying for a generation. Nothing
// existing changes; the version moves so a caller pinning the contract can tell whether
// the API is present.

// The coarsest geocoding tier a point map used. Declared HERE, not imported from
// @bicharts/shape-core, because this type is part of chart-host's PUBLIC surface: shape-core
// is a build-time devDependency (its code is bundled in), so a consumer never installs it and
// a `.d.ts` importing from it would dangle. That bug shipped in the first packed build and
// went unnoticed because the test app had `skipLibCheck: true`, which skips .d.ts checking
// entirely. The two declarations are kept identical by a test in this package.
export type GeoPointPrecision = "latlon" | "city" | "zip3" | "state" | "country";
/** Every valid tier, ordered most precise → coarsest. Runtime form of GeoPointPrecision. */
export const GEO_POINT_PRECISIONS: readonly GeoPointPrecision[] =
    ["latlon", "city", "zip3", "state", "country"] as const;

/** Which point-map's gazetteer rows a lookup runs against (v2 unified table, 2026-08-02:
 *  one list, per-row map-kind flags). Duplicated from shape-core for the same reason as
 *  GeoPointPrecision above — public surface must not dangle on a bundled devDependency —
 *  and held identical by the same anti-drift test. */
export type GeoMapKind = "north-america" | "world";

// ---- Interaction grammar (what generated code emits; the host binds to these) ----

// CSS classes the generated code stamps on marks.
export const MARK_CLASS = "d3-mark";                 // a data mark
export const LEGEND_MARK_CLASS = "d3-legend-mark";   // a legend swatch (also filterable)
export const AXIS_FILTER_CLASS = "d3-axis-filter";   // an axis/scrubber tick (union of row idxs)

// The attribute each filterable mark carries: comma-joined __rowIdx__ values,
// frame-scoped for animated charts.
export const ROW_IDX_ATTR = "data-row-idx";

// Bubbling CustomEvent a chart dispatches on its container when its own selection
// changes (e.g. a scrubber period). detail = { clear:true, source } | { mark, source }.
export const XFILTER_REFRESH_EVENT = "llm-xfilter-refresh";

// Lifecycle slots the generated code sets on the container; the host calls/reads them.
export const CONTAINER_SLOT_ANIM_STOP = "__llmAnimStop";           // call before unmount/re-render
export const CONTAINER_SLOT_XF_CLEAR = "__llmXfClear";             // call to clear the chart's selection
export const CONTAINER_SLOT_INITIAL_XF_MARK = "__llmInitialXfMark"; // a mark to apply as the initial filter

// ---- Selection AFFORDANCE (what a selection LOOKS like) ----
//
// Generated code emits marks; it never styles the selected state — that is the host's
// job, because only the host knows what is selected. The Power BI visual has always
// done this by toggling two classes and dimming the rest through a CSS custom property
// (the visual injects the rules and sets the property). These
// constants name that SAME grammar so any other host produces the same affordance
// instead of inventing one — a chart should not look different because of where it runs.
// A drift test on the visual's side asserts these literals still match its CSS.
export const HOST_CONTAINER_CLASS = "bic-chart-host";        // stamped on every hosted container
export const SELECTION_ACTIVE_CLASS = "lch-has-selection";   // on the container while a selection exists
export const MARK_SELECTED_CLASS = "lch-mark-selected";      // on each mark in the selection
export const DIM_OPACITY_VAR = "--lch-dim-opacity";          // unselected-mark opacity (visual default 0.25)
export const DIM_OPACITY_DEFAULT = 0.25;

// ---- Option defaults / clamps (mirrored by the archetype `||` fallbacks) ----
export const ANIM_PLAY_SPEED_DEFAULT = 1000;
export const ANIM_PLAY_SPEED_MIN = 250;
export const ANIM_PLAY_SPEED_MAX = 5000;
// Loop-restart delay: seconds resting on the overview between auto-play passes.
// 0 is a meaningful value ("restart immediately") and a very large value means
// "play once per viewing" — both documented behaviors, hence a floor but no cap.
export const ANIM_LOOP_DELAY_DEFAULT = 3;
export const ANIM_LOOP_DELAY_MIN = 0;
export const ANIM_MAX_IDEAL_FRAMES_DEFAULT = 60;
export const ANIM_MAX_IDEAL_FRAMES_MIN = 3;
export const ANIM_MAX_IDEAL_FRAMES_MAX = 500;
// Outlier clamp for colorScaleScope="self": the diverging domain's half-width is the
// Nth percentile of |relative change| across all region-frame pairs (not the raw max),
// so one runaway region can't flatten everyone else's contrast to nothing. Deliberately a
// SETTING rather than a hardcoded 95 (2026-07-25): a percentile is a judgement about the
// data, and the person looking at the data is better placed to make it than we are.
// Floored at a minimum spread in resolveOptions so a near-flat dataset doesn't amplify
// noise to full saturation.
export const COLOR_SCALE_SELF_CLAMP_PCT_DEFAULT = 95;
export const COLOR_SCALE_SELF_CLAMP_PCT_MIN = 50;
export const COLOR_SCALE_SELF_CLAMP_PCT_MAX = 100;

export type TimelineStyle = "" | "line" | "boxes";
// Colour Scale Scope for animated continuous scales: "" = ONE global domain over
// every period (default; a colour means the same value in every frame); "frame" =
// re-scale each keyframe to its own min-max (in-frame contrast lens; the chart must
// redraw + relabel the colorbar per frame); "self" = diverging change-vs-own-average
// (2026-07-25 — encodes MOVEMENT rather
// than magnitude: each region's colour is its relative deviation from ITS OWN mean
// across all periods, so a small region's big swing reads as strongly as a large
// region's). Unknown values fail open to global.
export type ColorScaleScope = "" | "frame" | "self";

// The object handed to a generated render(container, data, options). Host-computed
// fields (geometry, theme, closures) are supplied by the caller; the knob fields
// carry the defaults/clamps applied by resolveOptions.
export interface RenderOptions {
    width: number;
    height: number;
    palette: string[];
    // Geo choropleths: {count, examples} of unresolved regions; the geometry
    // FeatureCollection (feature.id = the __geoIso__ join code).
    geoUnmatched?: { count: number; examples: string[] } | null;
    geo?: any;
    // POINT maps drawing from resolved place names (__geoLat__/__geoLon__ present).
    // `precision` is the COARSEST tier any row needed — "latlon" (real coordinates),
    // "city", "zip3" (a whole 3-digit ZIP prefix) or "state" (a whole state/province) —
    // so the chart can say what it actually plotted rather than implying exact positions.
    // `unplaced` feeds the off-map annotation; `ambiguousRows` counts rows placed by the
    // largest-match tie-break on a colliding bare city name. Null on every other chart.
    // `rolesBackfilled` / `rolesRefused` report what the ROLE resolution did to the
    // binding it was handed. The codegen response names which column is the city, the
    // state and the ZIP, and that answer is verified rather than trusted: a role it omits
    // is filled in from the values, and one it names wrongly is dropped. Both are ABSENT
    // when nothing was adjusted, so presence means "this binding is not what was asked
    // for" — worth a line on the chart, because it changes how the points were placed.
    // `precision` is a CEILING, never a description: one state-centroid row among 41 city
    // rows reports "state" exactly as an all-state map does. Annotate from
    // `precisionCounts` (rows per tier) and name the offenders from `coarseExamples` —
    // "3 of 42 placed at state centres", not a blanket "approximated to state centres"
    // that is false for the other 39.
    geoPoint?: {
        precision: GeoPointPrecision | null;
        precisionCounts: Record<GeoPointPrecision, number>;
        coarseExamples: string[];
        unplaced: number;
        unplacedExamples: string[];
        ambiguousRows: number;
        rolesBackfilled?: string[];
        rolesRefused?: string[];
    } | null;
    // Point-map mark-count ceiling (Format > Data "Max Map Points", default 1000).
    // The eligibility gate refuses to OFFER a point-map type above this many rows, but
    // a CACHED chart's row count is fixed at generation time while this dial can be
    // lowered afterward with no regeneration — so the chart itself must cap what it
    // draws and say so, live, every render. Undefined = no cap known (older client).
    maxMapPoints?: number;
    // Live-restyle knobs (changing any of these = re-render, never a regeneration).
    colorScaleLow?: string;
    colorScaleHigh?: string;
    colorScaleScope?: ColorScaleScope;
    // Outlier clamp (percentile, 50-100) for colorScaleScope="self" only; ignored by
    // the other two scopes. Default 95 — see COLOR_SCALE_SELF_CLAMP_PCT_DEFAULT.
    colorScaleSelfClampPct?: number;
    // Map fills. geoLandColor = the basemap landmass (and, on a choropleth, everywhere the
    // data doesn't reach); geoNoDataColor = regions in the data's geography that have no value
    // for what's currently shown, defaulting to geoLandColor so they're indistinguishable
    // unless deliberately set apart. BOTH are already high-contrast-resolved by the caller —
    // in HC the host substitutes the reserved background slot, so generated code consumes
    // these directly and never branches on isHighContrast (same contract as themeAccent).
    geoLandColor?: string;
    geoNoDataColor?: string;
    aggregation?: string;
    // Persisted view-state (animated charts persist {frame, selIdx}).
    uiState?: unknown;
    setUiState?: (s: unknown) => void;
    backgroundColor?: string;
    // Host theme (report theme canvas/text + high-contrast-safe accent).
    themeBg?: string;
    themeFg?: string;
    isHighContrast?: boolean;
    themeAccent?: string;
    cultureCode?: string;
    allowTooltips?: boolean;
    noDataText?: string;
    // Animation.
    animAutoPlay?: boolean;
    animPlaySpeedMs?: number;
    // Seconds resting on the overview between auto-play passes; also paces the
    // delayed auto-play re-engage when a chart resumes with saved view-state.
    // 0 = restart immediately; very large = effectively play once per viewing.
    animLoopDelaySec?: number;
    animMaxIdealFrames?: number;
    animStopAtEnd?: boolean;
    filtersDuringPlay?: boolean;
    animTimelineStyle?: TimelineStyle;
    // Card decks (the flippable multi-card). Deliberately NOT folded into the animation
    // knobs above: a deck pages through FACES, not time, so animPlaySpeedMs — ms per PERIOD
    // on a time axis a deck does not have, clamped 250..5000 — is the wrong dial.
    //   flipSync       — true (the default) advances every card together, and the deck carries
    //                    ONE control strip; false gives every card its own controls and its own
    //                    face, so a reader can park one card while paging another.
    //   flipIntervalMs — 0 (the default) is MANUAL ONLY, so a deck never moves unless someone
    //                    asks it to; a non-zero value is clamped chart-side to 500..120000.
    // BOTH ARE BOOLEAN/NUMBER VALUES, never callbacks — a generated chart that treats flipSync
    // as a subscription hook has misread this contract (dev 49020 did exactly that).
    flipSync?: boolean;
    flipIntervalMs?: number;
    // Optional selection callback some non-animated charts invoke (the DOM event +
    // data-row-idx bridge is the primary mechanism; see the interaction grammar).
    onSelect?: (rowIdxs: number[]) => void;
}
