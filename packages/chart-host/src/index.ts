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
    MARK_CLASS, LEGEND_MARK_CLASS, AXIS_FILTER_CLASS, ROW_IDX_ATTR, LIFT_SELECTED_CLASS, CONTROL_CLASS,
    XFILTER_REFRESH_EVENT,
    CONTAINER_SLOT_ANIM_STOP, CONTAINER_SLOT_XF_CLEAR,
    CONTAINER_SLOT_INITIAL_XF_MARK, CONTAINER_SLOT_UI_STATE,
    VIEW_ONLY_UI_STATE_KEYS, withoutViewOnlyKeys,
    HOST_CONTAINER_CLASS, SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS, ACTIVE_TICK_CLASS,
    DIM_OPACITY_VAR, DIM_OPACITY_DEFAULT,
    chartOwnsTimeline, periodTickSuppressesFeedback,
    ANIM_PLAY_SPEED_DEFAULT, ANIM_PLAY_SPEED_MIN, ANIM_PLAY_SPEED_MAX,
    ANIM_LOOP_DELAY_DEFAULT, ANIM_LOOP_DELAY_MIN,
    ANIM_MAX_IDEAL_FRAMES_DEFAULT, ANIM_MAX_IDEAL_FRAMES_MIN, ANIM_MAX_IDEAL_FRAMES_MAX,
    ANIMATION_OPTION_KEYS,
    COLOR_SCALE_SELF_CLAMP_PCT_DEFAULT, COLOR_SCALE_SELF_CLAMP_PCT_MIN, COLOR_SCALE_SELF_CLAMP_PCT_MAX,
    FLIP_MODE_DEFAULT,
    APPROXIMATE_POSITIONS_DEFAULT,
    VALUE_AXIS_BASELINE_DEFAULT,
    SEASONAL_MARKERS_DEFAULT,
    MAX_MAP_POINTS_DEFAULT,
    type GeoPointPrecision, type GeoMapKind, type TimelineStyle, type FlipMode,
    type ApproximatePositions, type ValueAxisBaseline, type SeasonalMarkers,
    type ColorScaleScope, type RenderOptions, type ViewStateProvider, type ChartControlChange,
} from "./contract";
export { resolveOptions, type ResolveOptionsInput } from "./defaults";
// THE OPTIONS VOCABULARY (2026-09-25): the reader-facing options every host shares, one row each - the
// default, the bounds, when a change takes effect and where it travels. See optionsVocabulary.ts.
export {
    OPTIONS_VOCABULARY, LIVE_OPTION_KEYS, MAX_MAP_POINTS_MIN, MAX_MAP_POINTS_MAX, LIMIT_COUNT_MAX, wireLimitCount,
    type OptionVocabularyEntry, type OptionTiming, type OptionWire, type OptionKey,
} from "./optionsVocabulary";
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
// Which clock a chart reads its dates in - a host asks before passing buildRenderPayload opts.utcDays.
export { codeReadsDatesInLocalTime, vegaSpecReadsDatesInLocalTime } from "./dateCells";
// requiredD3Plugins + explainRenderFailure are the two halves of the d3-plugin story (GAP-6):
// ask BEFORE rendering, explain AFTER a failure. Both belong on the public surface — a host
// that can only do the second one has already drawn a blank chart.
// stripEsmExports is on the surface for the same reason: a host that receives the
// module-form artifact and wants to compile it itself needs the same normalization the
// host applies, or the two paths disagree about what a valid chart artifact is.
export { createChartHost, compileRenderFn, stripEsmExports, requiredD3Plugins, explainRenderFailure,
    sessionViewStateProvider, noopViewStateProvider, assembleD3, D3_PLUGIN_PACKAGES,
    type ChartHost, type ChartHostConfig, type RenderFn } from "./host";
// THE CROSS-FILTER GROUP (2026-09-24): several charts over one source table and one selection,
// with the payload-row -> source-row translation owned here. <BicChartGroup> in "./react" is a
// wrapper over it; a host without React calls it directly.
export { createChartGroup, toSourceRows, syncMemberSelection,
    type ChartGroup, type ChartGroupMember, type ChartGroupSelection, type ChartGroupChange,
    type ChartGroupMemberOptions, type ChartGroupSourceOptions, type ChartGroupPayload } from "./group";
export { createMarkResolver, isInsideControl, type MarkResolver, type MarkResolverEnv } from "./selection";
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
// A reader's suggestion box on a host's landing page (2026-09-16). Every host shows the same states - Send disabled
// until there is a message, disabled while sending, cleared on success, and the typed words KEPT on failure - and sends
// one payload shape; the host owns placement, words and its signed transport.
export {
    mountProductFeedbackBox, normaliseProductFeedbackText, productFeedbackSendable, buildProductFeedbackPayload,
    PRODUCT_FEEDBACK_MAX_CHARS, PRODUCT_FEEDBACK_MIN_CHARS,
    type ProductFeedbackBox, type ProductFeedbackBoxOptions, type ProductFeedbackText, type ProductFeedbackSendResult,
    type ProductFeedbackPayload, type ProductFeedbackIdentity, type ProductFeedbackHost,
} from "./productFeedback";

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
    // ...and the sentence for a refusal that names no requirement. A null reason is a real
    // answer, so every host has to write SOMETHING; leaving each one to remember that is how
    // three surfaces came to render a bare chart name under a heading claiming to know why.
    qualifyRefusalReason, QUALIFY_REFUSAL_UNSPECIFIED,
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

// Finding a chart type BY NAME in a list that reaches 137 rows. A filter, never a search: it
// hides rows and never reorders them, because the order is the picker's own ranking and
// re-sorting throws the answer away. Shared because three surfaces have to agree on whether
// "gan" matches a row, and a product that finds a chart in one host and not in another is the
// class of drift nobody notices from inside either one. The two size predicates live here for
// the same reason as the chooser's: two hosts, two layouts, two honest answers, written next
// to each other so the difference reads as a decision.
export {
    normalizeFilterTerm, filterQualifyRows, readQualifyChartRow, readQualifyRefusalRow,
    filterFitsChooser, listNeedsFilter, qualifyFilterGate, inlineFilterGate,
    FILTER_MIN_TERM_CHARS, FILTER_ROW_PX, FILTER_MIN_WIDTH_PX, FILTER_MIN_HEIGHT_PX,
    INLINE_FILTER_MIN_ROWS,
    // ...and the whole filtered VIEW - which rows, which headings are left introducing nothing,
    // whether the refusal block has to open, and which of the four sentences applies. Written
    // twice in two hosts before it was written once here, and identical both times.
    computeQualifyFilterView, qualifyFilterCountText,
    type QualifyFilterTier, type QualifyFilterResult, type QualifyFilterRead,
    type QualifyFilterGateReason, type QualifyFilterGateInput,
    type QualifyFilterRow, type QualifyFilterGroup, type QualifyFilterView,
    type QualifyFilterNoteKind,
} from "./qualifyFilter";

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

// A date, printed the way its SOURCE prints it (2026-09-09). The payload's date cells are ISO
// instants by contract, and anything that shows one to a reader has to undo that — the selection
// card first, but a host tooltip or a host-drawn label is the same problem. Exported with its
// `SourceFormats` shape because the host is the only thing that KNOWS the format: Excel reads
// `range.numberFormat`, the visual reads the model's format string, and a CSV has none, which is
// why the locale fallback is a first-class answer rather than an error path.
// `isExcelDateFormat` is the other half of the same reading: whether a cell holding 46082 is a date
// at all. One parser answers both questions, so a host cannot type a column as a date by a looser
// reading of its format than the one the card then renders it with.
export {
    formatSourceDate, formatSourceDateFor, isExcelDateFormat,
    type SourceFormats, type SourceFormatDialect, type SourceDateOptions,
} from "./sourceDateFormat";

// THE CHART'S DESCRIPTION AND ITS GENERATION WARNING, joined as two statements rather than one
// run-on sentence (2026-08-31). Every host shows the pair somewhere - a panel over the tile, a
// status bar under the pane, a tool result - and where one sentence ends and the next begins is
// the kind of one-line rule that gets rewritten slightly differently in each. The words around
// it stay per host.
export { composeSummaryText } from "./summaryText";

// A DECLARED mark that cannot receive a click is not a mark (2026-08-30). Two codegen habits
// leave a tagged element unhittable: an inert <g> whose painted children are all
// pointer-events:none (the canonical legend swatch), and a painted element that is itself
// pointer-events:none. createChartHost runs this after every render; it is exported for a host
// that drives render() itself. Additive, idempotent, and incapable of turning an UNtagged
// element into a target, so it cannot regress a chart that already works.
export { ensureCrossfilterHitTargets, type HitTargetReport } from "./hitTargets";

// CAN THE LABELS ON THE MARKS BE READ? Generated code picks an in-mark label's colour from the
// mark's NOMINAL hue, and the mark's ACTUAL rendered fill is often something else - a
// low-opacity band over white, a translucent pill over a tile, an arc whose hole is canvas. Only
// a post-render read of the real DOM knows the difference. Written and proven in the Power BI
// visual across a run of incidents (each named in the module), none of it Power-BI-specific, so
// it lives here now and the other hosts stop shipping unreadable labels. createChartHost runs
// `applyLabelContrast` after every render; the pure decision is exported for a host that measures
// its own DOM, and the constants so a host's telemetry reads the same as the visual's.
export {
    applyLabelContrast, LABEL_CONTRAST_DONE_ATTR, LABEL_CONTRAST_CAP,
    type LabelContrastOptions, type LabelContrastReport,
} from "./labelContrastDom";
export {
    decideLabelColor, toRGBA, compositeOver, relativeLuminance, contrastRatio,
    isPillBackdropAlpha, pillBacksGlyph, backingHoldsGlyph, cellSuppressesNormalize, glyphSampleGrid,
    DARK_TEXT, LIGHT_TEXT, MIN_CONTRAST, WHITE_TEXT_BG_LUM,
    PILL_MIN_ALPHA, PILL_OPAQUE_ALPHA, PILL_MIN_COVERAGE, PAGE_MATCH_TOLERANCE,
    BACKING_MAJORITY, GLYPH_SAMPLE_N,
    type LabelDecision,
} from "./labelContrast";

// A chart that ran clean and painted nothing (2026-09-01). The mark contract
// asking a question about itself: all three hosts run the same generated code against the same
// classes, so all three can go blank the same way and a copy per host is three chances to
// disagree about what blank means.
export { censusMarks, isBlankRender, blankRenderFlag, type MarkCensus, type BlankVerdictInput } from "./blankRender";

// A chart that STOPPED ON PURPOSE. Generated code throws the INVALID sentinel when a column it is
// built on is gone from the data - a data state, not a crash, and every host has to tell the two
// apart by the same rule or one host says "did not run" where another says what is missing.
// createChartHost routes the throw to `onInvalidSentinel`; these are for a host that runs
// render() itself or reads the message out of a log.
export { isInvalidSentinelError, invalidSentinelReason } from "./invalidSentinel";

// A mark drawn as a thin open stroke can only be clicked if you aim perfectly (2026-09-03). The
// sibling question to ensureCrossfilterHitTargets, one step further out: that pass heals marks
// that cannot be clicked AT ALL, this one MEASURES marks whose hit target is a hairline. It only
// counts — widening a hit band has a real failure mode (a band that is too generous steals the
// clicks of the marks beneath it), so the measurement ships on its own first. And it reads
// COMPUTED stroke width, which is the half a server-side code check structurally cannot see: a
// width bound to a scale is a number only the browser knows.
export { censusHitBands, hitBandFlag, MIN_HIT_BAND_PX, type HitBandCensus } from "./hitBands";

// HOW MUCH OF THIS CHART IS ONE SHADE (2026-09-09)? A right-skewed measure on a linear colour
// ramp is accurate and unreadable: the outliers eat the ramp and the dense bulk lands in one
// indistinguishable tint. The guardrail asking for a quantile/log scale exists and fires, and the
// model writes scaleLinear anyway - instruction without verification. This measures the OUTCOME
// rather than the mechanism, so a well-spread scale of any kind reports well and a curved or
// hand-rolled ramp is not a special case. It also sees what no code check can: whether a scale
// washes out depends on the DATA, and the shape's own Skewness is measured on the raw column
// while the ramp encodes an AGGREGATE - 2.04 against 5.00 on the chart that raised this.
export { censusColourSpread, colourSpreadFlag, SAME_SHADE_DELTA_E, MIN_RAMP_FILLS,
    type ColourSpreadCensus } from "./colourSpread";
// IS EACH DOT DRAWN AT ITS VALUE? A force layout pushes a beeswarm's dots along both axes, so on a
// dense column they drift off their values and pile against the band walls while the chart still
// looks right. This reads each single-row dot back to its row, finds the value axis as the column a
// straight line through the positions explains, and buckets the share more than a radius off it.
export { censusValuePlacement, valuePlacementFlag, VALUE_AXIS_MIN_FIT,
    type ValuePlacementCensus } from "./valuePlacement";

// DOES THE CHART FIT ITS FRAME, AND WHAT DO YOU DO WHEN IT DOES NOT (2026-09-03). The outermost
// <svg> clips at its own viewport in every browser and every host, so a chart that sets
// `svg height = options.height` and draws a taller body loses the overflow outright - the rows
// past the fold are not cramped, they are never painted, and the container's scrollHeight agrees
// that everything fits. Written and proven in the Power BI visual, where it recovered 9 of 25 lost
// rows on a paged Gantt; none of it was Power-BI-specific, so it lives here now and the other
// hosts stop clipping silently. `fitRenderedChart(container)` is the one call after a render.
export {
    SCROLL_SLACK_PX, MAX_FRAME_GROW_FACTOR, PHANTOM_FRACTION, FIT_CONTENT_SELECTOR,
    needsScroll, contentExtentOf, scrollFitFor, planFrameGrow, isPhantomBox,
    type MeasuredBox, type ContentExtent, type ScrollFit, type FrameGrowPlan,
} from "./fit";
export {
    fitRenderedChart, fitReadingFor, measureContainerBoxes, svgInkReach, ctmScaleOf,
    type FitReading, type InkReach, type FitRenderedChartOptions, type FitRenderedChartResult,
} from "./fitDom";
// THE AXIS STAYS WHILE THE ROWS SCROLL (2026-09-04). The row-scrollable family sizes one <svg>
// to its content and lets the host scroll it - correct for the rows, and it takes the time axis
// with them: on a 90-task schedule chart the axis was on screen for ~2% of the scroll range.
// `fitRenderedChart` now pins a copy of the horizontal axis at the viewport edge while the
// original is scrolled out, and hides it when the original is back. The pure planner is here for
// a host that scrolls on its own terms; `pinScrolledAxis` is the DOM half it calls.
export {
    AXIS_PIN_MIN_LABELS, AXIS_PIN_BAND_PAD_PX, AXIS_PIN_MAX_BAND_FRACTION, AXIS_PIN_TRACK_REACH_PX,
    isHorizontalLabelRow, labelBand, planAxisPin, axisPinPlacement,
    type LabelRowBox, type AxisBand, type AxisPinCandidate, type AxisPinPlan, type AxisPinEdge,
} from "./fit";
export { pinScrolledAxis, unpinScrolledAxis, type AxisPinReport } from "./fitDom";

// A CATEGORICAL PALETTE FROM THE SURFACE THE CHART SITS ON (2026-09-09). Proven in the Power BI
// visual against the report theme; none of it was Power-BI-specific, and the hosts without it
// were sending an empty palette and letting the model reach for d3.schemeCategory10. The visual
// seeds each slot from its own theme colour; a host with only ONE resolvable accent (an Excel
// table's fill) calls buildPaletteFromSeed and lets the walk do the spreading.
export {
    MIN_DELTA_E, pickDistinctColorFromSeed,
    // buildPalette is the RICH form - the host names each slot's base colour, which is
    // what a report theme is. buildPaletteFromSeed is the fallback for a host that can
    // resolve only one. Do not migrate a host from the first to the second.
    buildPalette, buildPaletteFromSeed,
    // For a host that assembles its OWN pool of surface colours with no authored order (an Excel
    // workbook's accents and their tints): most distinct first, then into buildPalette.
    orderMostDistinct,
    // Invented colours stay off both page extremes; `lightnessBand: null` re-derives what the
    // walk produced before the band, for a host recognising a palette it stored back then.
    LEGIBLE_LIGHTNESS,
    type PaletteResult, type SeedForSlot, type PaletteOptions,
} from "./palette";
// Perceptual distance between two hex colours (CIEDE2000, in-house - see deltaE.ts for why not
// the library). Exported so a host can state a palette's separation in its own tests and logs
// with the same number the package decides by.
export { deltaEHex } from "./deltaE";
// WHAT A BLANK COLOUR SCALE PICKER MEANS, AS TWO COLOURS. Nothing defined "automatic", so every
// generation invented one - a brighter() green that clipped to lime, six classes nobody could tell
// apart as painted. resolveOptions hands these to every chart as colorScaleAutoLow / High, and a
// host's pickers show the same two values while the reader's own are blank.
export { resolveAutoColorScale, autoRampMinStep, autoRampCanvas, AUTO_RAMP_CLASSES, AUTO_RAMP_DRAWN_OPACITY,
    AUTO_RAMP_MIN_STEP_DELTA_E, type AutoColorScale, type AutoColorScaleInput } from "./autoRamp";
// THE PENDING-GENERATE MARKER AND ITS RECOVERY DECISIONS. A generate is a promise the
// server keeps whether or not the client is still there to receive the answer, and every host that
// can lose a transport mid-stream needs the same answers: is this marker still worth polling for,
// does the served correlation prove the answer is ours, does a late pickup keep or clear it. Pure
// and host-neutral - the persistence and the polling stay per host, the DECISIONS do not.
export {
    PENDING_RECOVERY_WINDOW_MS, PENDING_RECOVERY_POLL_MS, PENDING_RECOVERY_FIRST_POLL_MS,
    PENDING_RECOVERY_FAST_PHASE_MS, PENDING_RECOVERY_MID_POLL_MS,
    PENDING_RECOVERY_SLOW_PHASE_MS, PENDING_RECOVERY_SLOW_POLL_MS,
    pendingRecoveryNextDelayMs, encodePendingGenerate, parsePendingGenerate,
    markerArmedBlind, isBlindMarker, servedCorrelationProves, sameMarker,
    decidePendingRecovery, recoveryPollRunning, recoveryOwnsTheSentence,
    latePickupAction, latePickupKeepsMarker, pollGiveUpKeepsMarker,
    pendingRecoveryRemainingMs, transportFailureShouldRecover,
    TRANSPORT_LOST_CHECKING_MESSAGE, GENERATION_CANCELLED_MESSAGE,
    recoveryAnswerIsCancelled, generationCancelledMessage,
    type PendingGenerateMarker, type PendingRecoveryDecision, type LatePickupAction,
} from "./pendingGenerate";
// Comment-blind code reading: a host deciding what a chart needs from its source must not count a word
// that only appears in a comment (requiredD3Plugins reads through it).
export { stripJsComments } from "./codeComments";
// A standing chart-type pick checked against a fresh qualify list - the one place a pick may be dropped
// for the reader, and always with a sentence saying so.
export { reconcileChartPick, type ChartPickReconciliation } from "./chartPick";
// Duplicate-generate suppression (2026-09-25): one user action never sends the same generate twice - an
// identical request is held while the previous one runs and for a short window after it started; a
// retry, a field change or a different pick always passes. Pure; the host keeps the state and the clock.
export {
    isDuplicateGenerate, armGenerateGuard, DUPLICATE_GENERATE_WINDOW_MS,
    type GenerateGuardKey, type GenerateGuardState,
} from "./duplicateGenerateGuard";
// The way back to the last working chart (2026-09-25): offer it whenever a positive version and its code
// are cached, whatever the current version is; restore it by itself after a licence is saved only when
// the reader was parked on version 0. Pure; the host passes its persisted cache.
export { canShowLastChart, shouldRestoreVersionAfterLicenseSave } from "./lastChart";
// Filter narrowing (2026-09-25): a per-schema high-water row count tells "a filter took the rows away"
// (fewer rows, or none, than this schema has delivered) from "the fields changed" (the schema moved).
// Pure; the host keeps the high water.
export {
    isNarrowedByFilter, isEmptiedByFilter, updateRowHighWater, type NarrowingState,
} from "./filterNarrowing";
// Thumbnail capture (2026-09-25): capture when the service forces it, or when the reader opted in (or the
// host's terms capture by default) on the first render of a generation; the consent flag beside the
// image is the opt-in alone. Pure; the host resolves each input.
export { shouldCaptureThumbnail, type ThumbnailGate, type ThumbnailDecision } from "./thumbnailPolicy";
// The model picker (2026-09-25): the rules every host's model list shares - no bring-your-own-key code in
// the open list, the default marked " — default" and sorted first, a stale pick back to the default.
// Labels, cost text and any row of the host's own stay the host's.
export {
    isPickableModelCode, markDefaultModel, defaultModelFirst, reconcileModelPick, DEFAULT_MODEL_SUFFIX,
} from "./modelPicker";
// Client identity (2026-09-24): the one ThumbmarkJS recipe every browser host fingerprints with - the user agent and
// browser version excluded, so an id outlives a browser release; vendor logging off - plus where an id came from and a
// per-component digest that names the input when a fingerprint moves. The library itself is injected by each host.
export { stableFingerprintOptions, fingerprintComponentDigest, type ClientIdSource } from "./clientIdentity";
// HOST SERVICES (2026-09-24): the object a host constructs and passes to shared logic, and the
// render-level services inside it - marker storage, preferences, theme, thumbnail consent, the
// snapshot target. An absent optional member is the host saying it cannot do that thing. Types
// only; each host's adapter is proven by the matching check in "@bicharts/chart-host/testing".
export type {
    HostServices, MarkerStore, PreferenceSource, HostTheme, ThemeSource, ThumbnailConsent, SnapshotTarget,
    WireSigner, WireTransport, WireResponse, CredentialTriple, CredentialSource,
    ViewportSource, Clock, DiagnosticEntry, DiagnosticsSink, RendererId,
} from "./host/services";
