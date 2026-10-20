// createChartHost — the host-side RUNTIME of the contract (Phase C, first cut).
//
// A minimal, host-agnostic implementation of everything a page must do to run a
// generated render(container, data, options) chart: compile the code the same way
// the visual/preview/exec-gate do, resolve options through the shared defaults,
// wire the cross-filter bridge (mark clicks + the llm-xfilter-refresh event), honor
// the container lifecycle slots, and re-render on setOptions/setData — which is how
// the live-restyle knobs (colorScaleLow/High, aggregation, animMaxIdealFrames) work.
//
// The Power BI visual does NOT use this runtime (its own bridge carries years of
// PBI-specific behavior: selectionManager, host tooltips, glyphs, geometry hit
// disambiguation); this is for OTHER hosts — the MCP preview, an SDK page, tests.
// Delegating the visual's generic half onto shared selection logic remains the
// harness-gated last step of Phase C.
//
// Animation scope (v1): the contract exposes only __llmAnimStop (stop) — playback
// and frame stepping are chart-owned (the play button + scrubber the chart draws).
// An imperative play()/goTo() would need NEW contract slots on the archetypes
// (contract v1.1 candidate, replay-gated) — deliberately not invented here.
import { type RenderOptions, ROW_IDX_ATTR, MARK_CLASS, LEGEND_MARK_CLASS, AXIS_FILTER_CLASS,
    XFILTER_REFRESH_EVENT, CONTAINER_SLOT_ANIM_STOP, CONTAINER_SLOT_XF_CLEAR,
    CONTAINER_SLOT_INITIAL_XF_MARK, CONTAINER_SLOT_UI_STATE, CONTAINER_SLOT_CLICKED_MARKS, HOST_CONTAINER_CLASS, SELECTION_ACTIVE_CLASS,
    MARK_SELECTED_CLASS, ACTIVE_TICK_CLASS, DIM_OPACITY_VAR, DIM_OPACITY_DEFAULT, LIFT_SELECTED_CLASS,
    chartOwnsTimeline, periodTickSuppressesFeedback,
    HOST_CONTRACT_VERSION, type ViewStateProvider } from "./contract";
import { resolveOptions, type ResolveOptionsInput } from "./defaults";
import { stripJsComments } from "./codeComments";
// Deliberately NOT "./geo": that module statically imports ~1.3 MB of generated geometry,
// which every consumer then paid for even to draw a bar chart (GAP-11). geoLazy holds the
// cache and the dynamic loader but no asset, so the runtime entry stays lean.
import { geoFromCache } from "./geoLazy";
import { createMarkResolver, isInsideControl, nextSelection, selectionRuleOf, markKeyOf, planSelectionPaint,
    nextClickedMarks, trackPress, clickWasDrag, clearPress, validRowSet, sameRowSet,
    collectGlyphCentersWhere, paintSelectionGlyphs, clearSelectionGlyphs,
    type ClickedMarks, type SelectionRule, type SelectionPaintMode, type GlyphCenter } from "./selection";

/** What onSelectionPaint reports: the declared rule, how this paint decided, and how many marks it lit. */
export interface SelectionPaintReport {
    rule: SelectionRule;
    mode: SelectionPaintMode;
    lit: number;
    marks: number;
    selection: number;
}
import { ensureCrossfilterHitTargets } from "./hitTargets";
import { censusMarks, isBlankRender, type MarkCensus } from "./blankRender";
import { censusHitBands, type HitBandCensus } from "./hitBands";
import { censusColourSpread, type ColourSpreadCensus } from "./colourSpread";
import { censusClippedText, type ClippedTextCensus } from "./clippedText";
import { censusValuePlacement, type ValuePlacementCensus } from "./valuePlacement";
import { fitRenderedChart, unpinScrolledAxis, rememberScroll, takeScroll, clipWindowOf, type FitRenderedChartOptions, type FitRenderedChartResult } from "./fitDom";
import { applyLabelContrast, type LabelContrastOptions, type LabelContrastReport } from "./labelContrastDom";
import { newIdScope, scopeChartIds, type IdScopeReport } from "./idScope";
import { isInvalidSentinelError, invalidSentinelReason } from "./invalidSentinel";
import { createAnnotationLayer, type MarkAnnotation, type AnnotationReport } from "./annotations";
import { installLasso, lassoEffect, LASSO_OUTLINE_CLASS, type LassoHandle } from "./lasso";
// TYPES ONLY: the zoom memory is its own entry ("@bicharts/chart-host/zoom-memory"), off the main entry's eager closure.
import type { ZoomMemoryHook, ZoomCapture } from "./zoomMemory/zoomMemoryDom";

export type RenderFn = (container: HTMLElement, data: any, options: RenderOptions) => void;

/**
 * THE SESSION PROVIDER — what every host got hard-coded before contract 1.6.0, now named.
 *
 * The bag is parked on the CONTAINER ELEMENT, which outlives the host object in every host that
 * destroys and re-creates itself on the same node — the Excel add-in does exactly that on every
 * resize and every cell edit, so a chart's resting knob used to reset whenever the pane moved.
 * It dies with the element, which is precisely the scope "session" means here.
 *
 * `load()` returns the LIVE store, and `save()` mutates it in place rather than replacing the
 * object, so a caller holding the bag from before a save still sees the current values. That is
 * the 1.5.0 behaviour preserved exactly.
 */
export function sessionViewStateProvider(container: HTMLElement): ViewStateProvider {
    const holder = container as unknown as Record<string, unknown>;
    const existing = holder[CONTAINER_SLOT_UI_STATE];
    const store = (existing && typeof existing === "object")
        ? existing as Record<string, unknown>
        : (holder[CONTAINER_SLOT_UI_STATE] = {} as Record<string, unknown>);
    return {
        load: () => store,
        save: (next) => {
            if (!next || typeof next !== "object") return;
            // REPLACE semantics, matching setUiState: the argument is the whole new bag, so a
            // chart keeping sibling keys reads options.uiState and merges itself.
            for (const k of Object.keys(store)) delete store[k];
            Object.assign(store, next);
        },
    };
}

/**
 * NOWHERE TO PUT IT, said out loud. For a host with no session to speak of — a server-side
 * render, a static preview, a thumbnail capture — where remembering would be wrong rather than
 * merely absent: a thumbnail must be the same picture every time it is taken.
 *
 * Deliberately not the same as omitting a provider. Omitting one gets the session store and a
 * chart that remembers within the page; choosing this one says the forgetting is the point.
 */
export function noopViewStateProvider(): ViewStateProvider {
    return { load: () => ({}), save: () => { /* deliberately nowhere */ } };
}

export interface ChartHostConfig {
    // The payload as buildRenderPayload / the MCP data.sample.json produce it. geoUnmatched
    // and geoPoint ride ALONGSIDE the table because they are facts ABOUT the binding, and
    // render() auto-promotes them into options — a host that just hands over the whole file
    // gets honest annotations without knowing they exist.
    data: {
        columns: any[];
        rows: any[][];
        geoUnmatched?: { count: number; examples: string[] };
        geoPoint?: RenderOptions["geoPoint"];
        /** The DESTINATION endpoint's report on an origin-destination flow map — promoted
         *  into options exactly like geoPoint, so a host that hands over the whole payload
         *  gets both ends annotated without knowing the field exists. */
        geoPointDest?: RenderOptions["geoPointDest"];
        /** Set by buildRenderPayload(..., { utcDays: true }) - promoted into options exactly like geoPoint. */
        dateCellsAreUtcDays?: boolean;
        /** Provenance the MCP stamps into data.sample.json. `hostContract` is checked
         *  against HOST_CONTRACT_VERSION so a major-version drift is LOUD, not silent. */
        meta?: { hostContract?: string; chart?: string;
            /** The generate answer's fact that this chart's family never takes a selection glyph. Promoted into
             *  options.suppressSelectionGlyph, so a host that hands over the whole payload honors it unasked. */
            suppressSelectionGlyph?: boolean };
    };
    /** Generated render() source — compiled exactly like the visual/preview/exec-gate. */
    code?: string;
    /** Pre-compiled alternative to `code`. */
    renderFn?: RenderFn;
    /** Partial raw options; resolveOptions applies the shared defaults/clamps. */
    options?: ResolveOptionsInput;
    /** WHERE this host keeps a chart's resting view-state (contract 1.6.0). Omit for the
     *  session store parked on the container — the behaviour every host had before 1.6.0.
     *  A raw `options.setUiState` still wins over this, so an existing caller is untouched. */
    viewState?: ViewStateProvider;
    /**
     * REMEMBER THE READER'S ZOOM AND PAN on a chart that calls d3.zoom(), across every re-render (and across a
     * close and reopen, if the host's store says so). Build it with createZoomMemoryHook() from
     * "@bicharts/chart-host/zoom-memory", ONCE per chart, and hand the same hook to every host built for that chart
     * (on the same element or, after a remount, a new one): a host that is destroyed releases the hook's watcher, so
     * the hook can go to the next. Absent (the default), d3.zoom is never wrapped and nothing is listened for. It
     * applies to a chart compiled from `code` only: a precompiled `renderFn` closed over its own d3.
     */
    zoomMemory?: ZoomMemoryHook | null;
    /** D3 v7 instance handed to the compiled code. Default: (globalThis as any).d3. */
    d3?: any;
    /** Attach geometry for this geoKind as options.geo (choropleths / basemaps). Resolved
     *  from `geoProvider` or the geoLazy cache — see `loadGeo`. NOT eagerly bundled. */
    geoKind?: string;
    /** Supply geometry for a geoKind synchronously. The escape hatch for a host that
     *  already holds its assets (e.g. `geoForKind` from "@bicharts/chart-host/geo", or the
     *  data.geo.json the MCP wrote next to the chart). */
    geoProvider?: (geoKind: string) => any | undefined;
    /**
     * Called when a render completes cleanly having painted NO data marks against a non-empty
     * table (2026-09-01). The chart did not throw, so nothing else will tell you — this is
     * the only notification that the rectangle your reader is looking at is empty.
     *
     * The commonest cause by far is schema drift: generated code binds columns BY NAME, so a
     * renamed or removed field sends its own `findIndex(...) === -1` guard down the no-data
     * branch. A host that knows the binding can say WHICH column; one that does not should still
     * surface it, because "empty and silent" is the state this exists to abolish.
     */
    onBlankRender?: (info: { census: MarkCensus; rows: number }) => void;
    /**
     * Called after every render with the hit-band census — how many of this chart's marks are
     * thin open strokes, and how many of those have no wider companion to catch a click
     * (2026-09-03). Counts only; the host decides what, if anything, to record. It fires even
     * when everything is fine, because a rate needs a denominator and `interactive` is it: a
     * chart with no open-stroke marks reports zeroes and should be excluded, not counted as good.
     *
     * This is the half a server-side code check structurally cannot do. A regex reads
     * `.attr('stroke-width', 2)` and nothing else; `.attr('stroke-width', d => scale(d.v))` is a
     * number only the browser knows, and this reads the COMPUTED width off the rendered element.
     */
    onHitBandCensus?: (census: HitBandCensus) => void;
    /**
     * HOW MUCH OF THIS CHART IS ONE SHADE (2026-09-09)? Runs after every render, counts only.
     *
     * The sibling question to the hit-band census, on the colour channel: a right-skewed measure
     * on a linear ramp is accurate and unreadable, because the outliers eat the ramp and the
     * dense bulk lands in one indistinguishable tint. It measures the OUTCOME, never the scale,
     * so a well-spread scale of any kind reports well and a curved or hand-rolled ramp needs no
     * special case; it declines outright on a categorical palette or a diverging ramp, which are
     * a different question wearing the same numbers.
     *
     * The other half a server-side check cannot do. A code rule reads `scaleLinear()` and a
     * domain built from `d3.max`; whether THAT washes out depends on the data, and the shape's
     * own skew is measured on the raw column while the ramp encodes an aggregate.
     */
    onColourSpreadCensus?: (census: ColourSpreadCensus) => void;
    /**
     * IS ANY TEXT CUT OFF BY THE FRAME? Runs after every render, counts only, and never moves anything: a title
     * drawn above its own origin is clipped without anything throwing, so only a measurement against the SVG box
     * sees it. A host without layout reports `laidOut: false`, which is not a pass.
     */
    onClippedTextCensus?: (census: ClippedTextCensus) => void;
    /**
     * IS EACH DOT DRAWN AT ITS VALUE? Runs after every render, counts only.
     *
     * A chart drawing one dot per row along a value axis promises that a dot's position IS its
     * value, and a force layout breaks that promise without a trace in the code: collision pushes
     * dots along both axes, so on a dense column they drift off their values and pile against the
     * band walls. This reads each single-row circle back to its row, finds the value axis as the
     * column a straight line through the positions explains, and reports the share of dots more than
     * a radius off it. It declines on anything that is not that shape.
     */
    onValuePlacementCensus?: (census: ValuePlacementCensus) => void;
    /**
     * HOW A DECLARED SELECTION RULE LIT THE MARKS. Called on every selection paint of a chart that
     * declares a rule other than the default (SELECTION_RULE_ATTR), never for one that declares none.
     * `mode` "fallback-any-row" means no clicked or exactly-matching mark was found for the selection,
     * so the default rule lit the chart for that paint: worth a log line.
     */
    onSelectionPaint?: (report: SelectionPaintReport) => void;
    /** This chart declares time keyframes: frame one is allowed to be empty, so no blank verdict
     *  is issued for it. */
    animated?: boolean;
    /** The chart's marks are not tagged with the shared contract (a Vega lane names its own
     *  marks), so a mark count proves nothing and the blank verdict is suppressed. */
    contractUntagged?: boolean;
    /**
     * DOES THE RENDERED CHART FIT ITS FRAME (2026-09-03)? Runs after every render.
     *
     * The outermost <svg> clips at its own viewport in every browser, so a chart that sets
     * `svg height = options.height` and draws a taller body loses the overflow OUTRIGHT - the
     * rows past the fold are never painted, and the container's scrollHeight agrees that
     * everything fits, so nothing anywhere offers a scrollbar. This grows the frame to the ink
     * the chart actually drew and THEN sets the container's overflow, in that order, because a
     * scrollbar on an un-grown frame scrolls to nothing.
     *
     * DEFAULT ON, because the alternative is silent data loss and the pass only acts when ink is
     * measurably outside the frame (8px of slack, and a 20x ceiling against a mark parked in the
     * weeds). Pass `false` for a host that owns its own layout, or an options object to take the
     * reading without touching the chart (`grow: false`, `applyOverflow: false`).
     */
    fit?: boolean | FitRenderedChartOptions;
    /**
     * KEEP THE READER'S SCROLL when the SAME chart is drawn again - a resize, a filter, a theme
     * switch, or a new host on the same element. Default true: the offset is parked on the
     * container before each clear and put back by the fit, clamped to what the new layout can
     * scroll; a different chart (other code, or a renderFn with other source) opens at the top. Pass `false`
     * for a page that manages the container's scrolling itself: nothing is remembered or restored,
     * and a memory an earlier host left on the element is discarded at the next render.
     */
    restoreScroll?: boolean;
    /** The fit result after each render - what was grown, and how the chart measured. */
    onFit?: (result: FitRenderedChartResult) => void;
    /**
     * CAN THE LABELS ON THE MARKS BE READ? Runs after every render, BEFORE the hit-target heal
     * (which injects transparent rects this pass must not mistake for backdrops).
     *
     * Generated code picks an in-mark label's colour from the mark's NOMINAL hue; the mark's
     * ACTUAL rendered fill - a 0.18-opacity band over white, a translucent pill over a tile, an
     * arc whose hole is canvas - is something else, and only a post-render read of the real DOM
     * knows it. This resolves which shapes really back each label (geometry, not bounding
     * boxes), composites the real stack over the page, and recolours to black or white only
     * where the label would otherwise be unreadable or a tile's labels would read as mixed.
     *
     * DEFAULT ON, because the alternative is text nobody can read, and the pass only ever sets a
     * text's fill. Pass `false` for a host that owns its own label colours, or an options object
     * to name the page background it composites onto (`pageBg`) - a themed or high-contrast
     * canvas is not white, and every readability answer is measured against it.
     */
    labelContrast?: boolean | LabelContrastOptions;
    /** What the label-contrast pass did after each render - counts, so a host can log them. */
    onLabelContrast?: (report: LabelContrastReport) => void;
    /**
     * What the selection-glyph pass did after each paint of an active selection - counts, so a host can log them.
     * Called only when options.selectionGlyph is "dot" or "check"; `suppressed` is true when the chart's family never
     * takes a glyph (options.suppressSelectionGlyph, or the same fact in data.meta). A repaint that only follows marks
     * moving without a render (a pan, a transition) is not reported again.
     */
    onSelectionGlyphs?: (report: { mode: "dot" | "check"; drawn: number; total: number; suppressed: boolean }) => void;
    /**
     * A LAYOUT PASS the host brings, run after every render (both the synchronous and the promise lane, and every
     * setOptions / setData re-render) AFTER the label-contrast pass and BEFORE the hit-target heal, the selection
     * repaint, the censuses and the fit - the order a pass that moves the legend or grows the viewBox needs, because
     * the fit must measure the final layout. Absent by default: the main entry carries no such pass. Build one with
     * createLegendFitPass() from "@bicharts/chart-host/legend-fit". It must not throw (a throw is swallowed and the
     * render stands); it reports through its own callback, never through this host.
     */
    layoutPass?: (container: HTMLElement) => void;
    /**
     * What the id-scoping pass did after each render: how many of the chart's ids got this host's suffix, and which
     * of them also existed elsewhere in the page (a clash it prevented - two same-size charts naming one clip path).
     */
    onIdScope?: (report: IdScopeReport) => void;
    /**
     * THE CHART SAID THE DATA LACKS SOMETHING IT IS BUILT ON. Generated code has one sanctioned
     * hard stop at runtime: a column the chart needs is gone from `data.columns`, and it throws
     * `new Error('INVALID:column "<name>" not found')`. That is a DATA STATE, not a broken chart -
     * the same code draws again once the column is back - so a host should say what is missing,
     * keep the code, and re-render on the next data change rather than report a crash.
     *
     * Supplied: render() clears the container, calls this with the chart's reason (the text after
     * `INVALID:` on that line) and the full message, and returns normally - nothing was drawn, so
     * no post-render pass (label contrast, hit-target heal, census, fit) runs. Absent: render()
     * throws exactly as it always has, so an existing host is untouched.
     */
    onInvalidSentinel?: (info: { reason: string; message: string }) => void;
    /**
     * NOTES ON MARKS. Each annotation names a key - a value in a column of this chart's data, such as a
     * country code - and the host draws a badge on that key's mark after every render, wherever a filter,
     * a re-query or a zoom has put it. Keyed by value, never by row position. Change them with
     * setAnnotations; none (the default) draws nothing.
     */
    annotations?: MarkAnnotation[];
    /** A badge was clicked. The mark beneath is not selected. */
    onAnnotationClick?: (annotation: MarkAnnotation) => void;
    /**
     * WHETHER THIS CHART'S SELECTION REACHES ANYTHING OUTSIDE IT - a page filter bound to it, a chart group that
     * cross-filters. Read when a filtering lasso (RenderOptions.lasso.effect "filter", the default) circles a
     * group: false makes the host say once, in the console, that the page gave the chart no filter to set, so the
     * lasso only highlights. Absent: the selection reaches something when anything subscribes to it
     * (selection.onChange, which bindFilter and a group's attach both use). The React binding answers it from
     * `selects` and the group itself. Never throws through: an answer that throws counts as reached.
     */
    selectionReachesPage?: () => boolean;
}

export interface ChartHost {
    /** Replace the notes drawn on marks (see ChartHostConfig.annotations); redraws them at once. */
    setAnnotations(list: MarkAnnotation[]): void;
    /** How many annotations the last draw placed on a mark, and how many had none in this render. */
    readonly annotationReport: AnnotationReport;
    render(): void;
    /**
     * THE LAST RENDER, SETTLED. render() stays synchronous — it returns nothing, exactly as it
     * always has — but a generated chart whose drawing library has no synchronous API returns a
     * PROMISE from its own render(), and every post-render pass (label contrast, hit-target
     * heal, census, fit) has to wait for that before it measures anything. This is how a caller
     * waits for the same moment: it resolves once those passes have run, and rejects with the
     * error render() would have thrown had the chart drawn synchronously.
     *
     * On a synchronous chart it is an ALREADY-RESOLVED promise, so awaiting it is free and
     * correct for both kinds and a host needs no test for which it has. Replaced on every
     * render(), so read it after the render() whose finish you mean; when renders overlap, the
     * LAST one wins and the superseded one settles without touching the chart.
     */
    readonly rendered: Promise<void>;
    /** Merge raw option changes and re-render — the live-restyle path (colour scale,
     *  aggregation, animMaxIdealFrames, timeline style…). Never a regeneration. */
    setOptions(partial: ResolveOptionsInput): void;
    setData(data: ChartHostConfig["data"]): void;
    readonly options: RenderOptions;
    selection: {
        /** Subscribe to cross-filter changes (mark clicks + the chart's own
         *  llm-xfilter-refresh dispatches). rowIdxs = [] means cleared. */
        onChange(cb: (rowIdxs: number[], source: string) => void): () => void;
        /** Clear the chart's own selection (calls __llmXfClear when the chart set it). */
        clear(): void;
        /**
         * Paint a selection that came from ANOTHER chart — highlight instead of filter.
         *
         * The chart keeps every mark and dims the ones outside `rowIdxs`, which is what a
         * map wants when a companion table is filtered: the geography stays legible and
         * there is still something to click to change or clear the selection. Contrast the
         * `<BicChartGroup>` default, which re-derives a FILTERED payload for the partner.
         *
         * Indices are in THIS chart's payload space. In a group that is the same space as
         * the source chart's, because the group hands every member the same rows; outside
         * one, translate first — the row-index hazard this package exists to absorb.
         *
         * Subscribers are notified with source `"host"`, so a mutual pair does not
         * republish what the other just sent and fight itself.
         */
        highlight(rowIdxs: number[]): void;
        readonly current: number[] | null;
    };
    animation: {
        /** Stop playback (calls __llmAnimStop when set). Call before unmount. */
        stop(): void;
    };
    /** The mark the chart nominated as its initial filter (__llmInitialXfMark), if any. */
    initialMark(): Element | null;
    destroy(): void;
}

const parseRowIdxs = (s: string | null | undefined): number[] =>
    (s || "").split(",").map(x => parseInt(x, 10)).filter(n => Number.isFinite(n));

/**
 * ONE d3 OBJECT FROM d3 AND ITS PLUGINS - the object a chart is handed as `d3`.
 *
 * In a bundled app d3 and each plugin (d3-sankey, d3-hexbin, ...) are separate module
 * namespaces, and a chart reaches all of them through one `d3`. A namespace is also FROZEN, and a
 * generated chart installs its own helpers onto the d3 it is given, so the object must be a plain
 * extensible copy: `assembleD3(d3, d3Sankey, d3Hexbin)`. Later arguments win on a name clash.
 * `requiredD3Plugins(code)` names the plugin packages a given chart needs.
 */
export function assembleD3(base: object, ...plugins: object[]): Record<string, any> {
    return Object.assign({}, base, ...plugins);
}

// d3 plugins are separate packages that ATTACH onto the d3 object. When one is missing the
// generated code fails as `d3.sankey is not a function` several frames deep inside compiled
// chart source — a message that tells a host nothing about what to install. Name the cause
// and the way forward instead; the package list matches what the Power BI visual loads, so
// a chart behaves the same in both hosts.
//
// EXPORTED (frozen) so a host that writes install instructions can check it covers every package
// this map can name - the one list requiredD3Plugins reads, so the instructions and the scan
// cannot drift. Keys are the names a chart reaches on d3; values are npm package names.
export const D3_PLUGIN_PACKAGES: Readonly<Record<string, string>> = Object.freeze({
    sankey: "d3-sankey", sankeyLinkHorizontal: "d3-sankey", sankeyJustify: "d3-sankey",
    sankeyCenter: "d3-sankey", sankeyLeft: "d3-sankey", sankeyRight: "d3-sankey",
    hexbin: "d3-hexbin",
    voronoiTreemap: "d3-voronoi-treemap", voronoiMap: "d3-voronoi-map",
    weightedVoronoi: "d3-weighted-voronoi",
    // Attached onto d3 like the rest, but reached as d3.mermaid.render(...) — a NAMESPACE
    // OBJECT with methods, not a function on d3. The scan below accounts for that shape.
    mermaid: "mermaid",
    // AND THE NAME A REAL CHART ACTUALLY WRITES. This one is not a member of the mermaid
    // package at all: it is a helper the SERVER prepends into the generated code, and the
    // helper is what reaches for the library. So a genuine diagram chart contains
    // `d3.llmMermaid(` and never once writes `d3.mermaid` — measured on the first real
    // generation of that type, for which this scan returned an EMPTY list. It drew, because
    // the host it ran in happened to carry the library; a host relying on this answer to
    // decide what to install would have been told nothing and failed several frames deep.
    //
    // Mapping the helper is right rather than a hack, because this map answers "what must a
    // host INSTALL for this code to run" and not "which package exports this symbol". For
    // code that calls the helper, the answer is the library the helper reaches for.
    llmMermaid: "mermaid",
});

// FAIL FAST, not fail deep (GAP-6, 2026-07-31). explainRenderFailure below turns a plugin
// crash into an actionable message, but only AFTER the chart has thrown and drawn nothing.
// A host that knows what a chart needs BEFORE running it can install the plugin, warn, or
// choose a different chart. The Power BI visual has always sniffed the code this way to pick
// which CDN bundles to load; this is that sniff, exported, so an SDK/MCP host stops being the
// only consumer flying blind.
//
// Deliberately a STATIC SCAN of every `d3.<name>` reference rather than a trial render:
// synchronous, side effect free, and safe on untrusted generated code — which executing is
// not. Over-reporting is the safe direction: naming a plugin the chart turns out not to reach
// costs a needless install, while missing one costs a blank chart failing several frames deep.
export function requiredD3Plugins(code: string): string[] {
    const out = new Set<string>();
    // A DOT ends the plugin name as legitimately as a parenthesis does. Not every plugin is a
    // FUNCTION on d3: one that attaches a namespace object is only ever reached through a
    // member of it, so `d3.mermaid.render(...)` puts no `(` after the plugin name at all and a
    // parenthesis-only scan saw nothing to install. Accepting a dot cannot over-match
    // dangerously — the map lookup on the next line gates every hit, so a core member access
    // like `d3.scaleLinear.domain` is read and discarded like any other unmapped name.
    //
    // COMMENTS ARE NOT CALLS. A chart's prose - and the prose of every helper prepended to it - names
    // things it does not do, and a `d3.sankey(...)` in a comment is a sentence, not a requirement. The scan
    // reads the code with its comments removed (stripJsComments keeps strings, template literals and regex
    // literals intact, so nothing real is lost).
    //
    // ANY REFERENCE IS A USE, not only a call (2026-09-23). A chart that aliases the plugin
    // (const mk = d3.sankey; mk()), tests for it (typeof d3.sankey === 'function'), or reaches it as
    // d3['sankey'] or const { sankey } = d3 needs it exactly as much as one that calls it - and the Power
    // BI visual kept a loose name test of its own for that reason. One contract now serves every host, in
    // the safe direction this scan was built on: the map gates every name, so the most a stray reference
    // costs is an install. Replayed over 3,712 stored D3 charts (dev and prod): no chart gains or loses a
    // plugin it references.
    const body = stripJsComments(String(code || ""));
    const add = (name: string) => { const pkg = D3_PLUGIN_PACKAGES[name]; if (pkg) out.add(pkg); };
    for (const m of body.matchAll(/\bd3\s*\.\s*(\w+)/g)) add(m[1]);
    for (const m of body.matchAll(/\bd3\s*\[\s*['"](\w+)['"]\s*\]/g)) add(m[1]);
    for (const m of body.matchAll(/\{([^{}]*)\}\s*=\s*d3\b/g)) {
        for (const part of m[1].split(",")) add(part.split(":")[0].trim());
    }
    return [...out].sort();
}

export function explainRenderFailure(err: unknown, d3: any): unknown {
    const msg = String((err as any)?.message ?? err ?? "");
    if (!d3) {
        return new Error(
            "[@bicharts/chart-host] no d3 was provided, so the generated chart could not run. " +
            "Pass it explicitly — createChartHost(el, { d3 }) / <BicChart d3={d3} /> — or set " +
            "window.d3. The chart needs D3 v7 (npm install d3@7). Original error: " + msg);
    }
    // MERMAID FIRST, because it fails in a shape the generic plugin branch below misreads.
    // It is reached as d3.mermaid.render(...), so a missing one surfaces as a property read on
    // `undefined` or as a non-function `render` — and the generic branch would then tell a host
    // to `import { mermaid } from "mermaid"`, which is not how a default-exporting diagram
    // library attaches. Gated on the d3 actually in hand, so a chart that names mermaid while
    // failing for some other reason keeps its own error.
    if (typeof d3?.mermaid?.render !== "function" && /\bmermaid\b/i.test(msg)) {
        return new Error(
            "[@bicharts/chart-host] this chart draws its diagram with Mermaid, which it reaches " +
            "as d3.mermaid.render(...), and the d3 you passed has no mermaid on it — this host " +
            "did not load the library. A host supplies it exactly the way the other plugins are " +
            "supplied: hand createChartHost ONE d3 that carries it, the SAME d3 every chart gets —  " +
            "npm install mermaid  then  import * as d3base from 'd3'; import mermaid from 'mermaid'; " +
            "import { assembleD3 } from '@bicharts/chart-host'; " +
            "const d3 = assembleD3(d3base, { mermaid });  (an ES-module d3 namespace is frozen, so " +
            "assigning onto it throws)  Original error: " + msg);
    }
    const m = /d3\.(\w+) is not a function|(\w+) is not a function/.exec(msg);
    const name = m?.[1] ?? m?.[2] ?? "";
    const pkg = D3_PLUGIN_PACKAGES[name];
    if (pkg) {
        return new Error(
            `[@bicharts/chart-host] this chart calls d3.${name}(), which comes from the separate ` +
            `"${pkg}" package and is not attached to the d3 you passed. Install it and hand the ` +
            `host ONE d3 that carries it, the SAME d3 every chart gets:  npm install ${pkg}  then  ` +
            `import * as d3base from "d3"; import { ${name} } from "${pkg}"; ` +
            `import { assembleD3 } from "@bicharts/chart-host"; ` +
            `const d3 = assembleD3(d3base, { ${name} });  (an ES-module d3 namespace is frozen, so ` +
            `assigning onto it throws)  Original error: ` + msg);
    }
    return err;
}

// A generated chart is delivered in one of two forms — the bare render() function, or the
// SAME code plus an ES-module export clause so it can be `import`ed from a file. Both are
// legitimate artifacts of the same generator, and nothing in either form tells the caller
// which one a given host accepts. Feeding the module form to the code-string path below
// threw a SyntaxError inside `new Function` before a single line ran: a blank chart, no
// mark, no annotation, and an error whose text says nothing about the artifact form.
//
// So accept both. The export clause is pure module bookkeeping and carries no behaviour —
// `render` is already a top-level binding, which is exactly what the compile below picks
// up — so removing it changes nothing about what the chart does.
//
// Deliberately narrow: only STATEMENT-POSITION export forms at the start of a line, so an
// `export` inside a string, a comment, or a property name is untouched. `export function` /
// `export const` keep their declaration and lose only the keyword, because the binding they
// introduce is the one being returned.
const ESM_EXPORT_CLAUSE = /^[ \t]*export[ \t]+(?:\{[^}]*\}|default[ \t]+[A-Za-z_$][\w$]*)[ \t]*;?[ \t]*$/gm;
const ESM_EXPORT_DECL = /^([ \t]*)export[ \t]+(?=(?:async[ \t]+)?function\b|const\b|let\b|var\b|class\b)/gm;

export function stripEsmExports(code: string): string {
    return String(code || "")
        .replace(ESM_EXPORT_CLAUSE, "")
        .replace(ESM_EXPORT_DECL, "$1");
}

// A generated chart INSTALLS the shared helpers it calls. The generator prepends the source of
// any `d3.llmX` helper the code uses but does not define, so the artifact self-installs it with
// `d3.llmX = function (...) {}` on whatever d3 this host hands it — no client asset required.
//
// `import * as d3 from "d3"` yields an ES module NAMESPACE object, which is non-extensible by
// specification. The compile below is `new Function`, i.e. SLOPPY mode, where adding a property
// to a non-extensible object does not throw — it silently does nothing. So the install evaporates
// and the chart dies a few lines later on `d3.llmTooltip is not a function`: an error that names
// the helper and gives no hint that the cause is one word in the caller's import statement.
//
// A host that reaches d3 through a script tag or a bundler that emits a plain object never sees
// this, which is how it survives verification and then fails in the field.
//
// So take a copy when the original will not take a property. The same reasoning covers plugins:
// assigning one onto a namespace object fails too (in an ES module it throws), which is why the
// diagnostic above tells callers to build one d3 with `assembleD3(d3base, { sankey })`.
function writableD3(d3: any): any {
    if (d3 == null || typeof d3 !== "object") return d3;
    // Extensible already — hand it straight back, so a caller who augments d3 later still wins.
    if (Object.isExtensible(d3)) return d3;
    return { ...d3 };
}

export function compileRenderFn(code: string, win: any, doc: any, d3: any): RenderFn {
    // Same compile the preview/exec-gate use: the code must define a top-level render().
    const body = stripEsmExports(code) + "\n;return (typeof render === 'function') ? render : null;";
    let factory: Function;
    try {
        factory = new Function("container", "data", "options", "window", "document", "d3", body);
    } catch (e) {
        // A SyntaxError here happens BEFORE any chart code runs, so there is no mark, no
        // annotation and nothing on screen — and the raw message ("Unexpected token") names
        // a token, not a cause. Say what was handed in and what it needs to be.
        const msg = String((e as any)?.message ?? e ?? "");
        const modular = /\bimport\b|\bexport\b/.test(String(code || ""));
        throw new Error(
            "[@bicharts/chart-host] the generated code could not be COMPILED, so nothing was " +
            "drawn. This path evaluates the chart as a code string, which cannot contain " +
            "ES-module syntax" +
            (modular
                ? " — and this code still has `import`/`export` in it after the export clause was " +
                  "stripped. Either request the plain form from the generator, or `import` the " +
                  "module yourself and pass the render function directly."
                : ".") +
            " Original error: " + msg);
    }
    const fn = factory.call(null, null, null, null, win, doc, writableD3(d3));
    if (typeof fn !== "function") throw new Error("generated code did not define render(container, data, options)");
    return fn as RenderFn;
}

// HOW LONG A CHART MAY TAKE TO FINISH DRAWING before the host stops waiting. Only the async
// lane can reach it: a synchronous chart either returns or throws, and neither hangs. Generous
// on purpose — a diagram library parsing its own source, a layout that iterates, a first paint
// on a cold worker are all slow and all legitimate — but bounded, because an unbounded await is
// a chart that never says anything at all: no marks, no error, no census, forever. A host that
// gives up is at least a host that can tell the reader something.
const ASYNC_RENDER_TIMEOUT_MS = 15000;

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
    !!v && (typeof v === "object" || typeof v === "function") && typeof (v as any).then === "function";

// THE PAGE'S OWN INLINE --lch-dim-opacity on a container (value and priority, null when there was none), saved by the first
// host to write there and put back by the last to let go. Per element, not per host: two hosts can overlap on one (the
// next is built before the old is torn down), and a second one reading the container would take the first one's write for
// the page's and put it back after the page's own was restored. `wrote` is the level last written there: the last host to
// let go restores the page's value only if the container still holds it, so a value the page set since is left alone.
const dimVarPage = new WeakMap<object, { was: { value: string; priority: string } | null; holders: number; wrote: string }>();

export function createChartHost(container: HTMLElement, config: ChartHostConfig): ChartHost {
    const doc: any = container.ownerDocument;
    const win: any = doc?.defaultView ?? (globalThis as any);
    const d3 = config.d3 ?? (globalThis as any).d3 ?? win?.d3;
    // THE d3 THE CHART IS HANDED, taken once: compileRenderFn's own writableD3 hands an extensible object back
    // unchanged, so the zoom memory below wraps the very object the chart's code reaches.
    const chartD3 = writableD3(d3);
    let data = config.data;
    // A generated chart is COMMITTED SOURCE that outlives the tool that wrote it, so a host
    // on a different major version of the grammar is a real possibility. Warn once, loudly
    // and specifically — a renamed mark class fails as "nothing is clickable", which is
    // exactly the kind of silent breakage nobody traces back to a version.
    {
        const stamped = config.data?.meta?.hostContract;
        const major = (v?: string) => (v || "").split(".")[0];
        if (stamped && major(stamped) !== major(HOST_CONTRACT_VERSION)) {
            try {
                (win?.console ?? console)?.warn(
                    `[@bicharts/chart-host] contract MAJOR mismatch: this chart was generated against ` +
                    `v${stamped}, the host implements v${HOST_CONTRACT_VERSION}. Marks, container ` +
                    `slots or the cross-filter event may not line up — regenerate the chart.`);
            } catch { /* no console — the check is advisory, never fatal */ }
        }
    }
    let raw: ResolveOptionsInput = { ...(config.options ?? {}) };
    // SESSION VIEW-STATE (contract 1.5.0). A host that supplies no setUiState gets one, backed
    // by a store PARKED ON THE CONTAINER — so a chart's resting knob, base date or focus path
    // survives a host that is destroyed and re-created on the same element every draw. The Excel
    // add-in does that on every resize (debounced) and every cell edit, so without this a slider
    // reset whenever the pane moved. The element outlives the host object, which is why the
    // element is where the store belongs; the Flippable deck already parks its own state there
    // for the same reason. The Power BI visual supplies its own persisted pair and is untouched.
    //
    // REPLACE semantics, matching the visual: setUiState(s) is the whole new bag, not a merge, so
    // a chart wanting to keep sibling keys reads options.uiState and merges itself. destroy()
    // deliberately leaves the store alone — it dies with the element, which is the session the
    // add-in means.
    // WHICH PROVIDER, in strict precedence (contract 1.6.0 restated the middle rung; the outer
    // two are unchanged): a raw setUiState pair from the caller wins outright, then an explicit
    // viewState provider, then the session store. The first rung is what keeps the Power BI
    // visual — which has persisted into the report file since long before providers existed —
    // byte-identical without being ported.
    if (typeof raw.setUiState !== "function") {
        const provider = config.viewState ?? sessionViewStateProvider(container);
        let bag: Record<string, unknown>;
        try {
            bag = provider.load() ?? {};
        } catch {
            // A provider that throws on load is a storage problem, never a reason not to draw.
            bag = {};
        }
        // A caller-supplied uiState SEEDS an empty bag once; on later re-creations the bag is
        // what the reader actually left behind, and a stale seed must not overwrite it.
        if (raw.uiState && typeof raw.uiState === "object" && Object.keys(bag).length === 0)
            Object.assign(bag, raw.uiState as Record<string, unknown>);
        raw.uiState = bag;
        raw.setUiState = (s: unknown) => {
            if (!s || typeof s !== "object") return;
            try {
                provider.save(s as Record<string, unknown>);
            } catch { /* a chart must never fail to repaint because a save failed */ }
        };
    }
    // NO HOST TOOLTIP HERE, SO AN UNSENT FLAG MEANS THE CHART OWNS HOVER. Generated code draws
    // its own tooltip only when `options.allowTooltips` is truthy, because a host that shows its
    // own (the Power BI visual) sends false to stop two tooltips fighting. This runtime draws
    // none, so a host that never mentions the flag - the usual case outside Power BI - left
    // every chart with no hover detail at all. Only an explicit false switches it off.
    //
    // Applied HERE rather than in resolveOptions on purpose: resolveOptions is also the visual's
    // option assembly, where the flag is always a computed boolean and the premise above is not
    // true, and it is locked to pass host fields through untouched.
    const resolveForHost = (input: ResolveOptionsInput): RenderOptions => {
        const out = resolveOptions(input);
        return out.allowTooltips == null ? { ...out, allowTooltips: true } : out;
    };
    let resolved = resolveForHost(raw);
    let renderFn: RenderFn | null = config.renderFn ?? null;
    let destroyed = false;
    let warnedGeo = false;
    let warnedBlank = false;   // once per host: a repainting chart must not spam the console
    let warnedIds = false;     // the same, for an id clash the scoping pass prevented
    let warnedLassoNoFilter = false;   // the same, for a filtering lasso whose selection reaches nothing
    const idScope = newIdScope();
    // WHICH RENDER IS THE CURRENT ONE. A synchronous chart cannot overlap with itself, but an
    // async one can: setOptions/setData during a slow draw starts a second render while the
    // first is still in flight, and without a way to tell them apart the FIRST one's post-render
    // passes would land on the SECOND one's DOM and the older draw would win by finishing last.
    // Every render takes a ticket; a continuation that no longer holds the current one stops.
    let renderSeq = 0;
    // Notes on marks (annotations.ts): drawn by the host after every settled render, keyed by a
    // column value in THIS chart's data, so a filter or a group member's own payload never moves one.
    const annotationLayer = createAnnotationLayer(container, a => config.onAnnotationClick?.(a));
    const drawAnnotations = () => annotationLayer.draw(
        { columns: data.columns, rows: data.rows },
        { fg: (resolved as any).themeFg, accent: (resolved as any).themeAccent,
          bg: (resolved as any).backgroundColor ?? (resolved as any).themeBg });
    annotationLayer.set(config.annotations ?? []);
    // What `host.rendered` hands out — replaced by every render, so a caller always awaits the
    // latest draw rather than a stale one.
    let renderedPromise: Promise<void> = Promise.resolve();
    const settle = (p: Promise<void>): void => {
        renderedPromise = p;
        // A rejection nobody awaited must not become an unhandled-rejection crash in the host
        // page: on the synchronous lane render() has ALREADY thrown the same error at the
        // caller, and a host that ignores `rendered` is making a legitimate choice. Attaching
        // this marks the promise handled without consuming it — an await still rejects.
        p.catch(() => { /* the caller's await is the real channel */ });
    };
    // Whether THIS host holds the container's --lch-dim-opacity (it wrote it), so it lets go of only its own hold: the last
    // host to let go puts back what the page had (dimVarPage) instead of removing it.
    let dimVarSet = false;
    const releaseDimVar = () => {
        if (!dimVarSet) return;
        dimVarSet = false;
        const page = dimVarPage.get(container);
        if (!page || --page.holders > 0) return;
        dimVarPage.delete(container);
        try {
            if (container.style?.getPropertyValue?.(DIM_OPACITY_VAR) !== page.wrote) return;   // the page has set its own since
            if (page.was) container.style?.setProperty(DIM_OPACITY_VAR, page.was.value, page.was.priority);
            else container.style?.removeProperty(DIM_OPACITY_VAR);
        } catch { /* frozen element */ }
    };
    let current: number[] | null = null;
    // The axis tick / group header that created the CURRENT selection, and whether that
    // tick is a PERIOD (see periodTickSuppressesFeedback in contract.ts). Held as the
    // ELEMENT so the affordance survives a repaint that does not rebuild it, and
    // isConnected-guarded so a re-render that replaces the node silently drops it.
    let activeTickEl: any = null;
    let selectionIsPeriod = false;
    // Whether the CURRENT selection was published by the chart itself (llm-xfilter-refresh with a
    // mark) rather than read off a clicked mark or handed in by the host. Only a selection the
    // chart owns is the chart's to undo - see the empty-click branch in onClick.
    let selectionFromChart = false;
    // Whether the CURRENT selection was told to the subscribers. False only for a highlight-only lasso
    // (RenderOptions.lasso.effect "highlight"): the page never heard it, so its clear is not told either.
    let selectionPublished = true;
    // The marks the reader clicked, for a chart that declared "clicked-marks". Parked on the
    // CONTAINER (CONTAINER_SLOT_CLICKED_MARKS), so a host re-created on the same element keeps it.
    const clickedMarks = (): ClickedMarks | null => (container as any)[CONTAINER_SLOT_CLICKED_MARKS] ?? null;
    const setClickedMarks = (c: ClickedMarks | null) => { try { (container as any)[CONTAINER_SLOT_CLICKED_MARKS] = c; } catch { /* frozen element */ } };
    const subs = new Set<(rowIdxs: number[], source: string) => void>();

    // ---- Selection affordance ------------------------------------------------
    // Inject the dim/hover rules ONCE per document, scoped to hosted containers, using
    // the same class grammar the Power BI visual uses. Without this a click cross-filters
    // other charts but the clicked chart itself gives no feedback — the "I clicked a
    // legend swatch and nothing happened" report from the React demo.
    const ensureAffordanceStyles = () => {
        try {
            if (!doc || doc.getElementById("bic-chart-host-affordances")) return;
            const st = doc.createElement("style");
            st.id = "bic-chart-host-affordances";
            st.textContent = `
/* TYPOGRAPHY FIREWALL. Generated charts set font-size but almost never line-height or
   letter-spacing, so they INHERIT whatever the host page cascades in. A page with
   \`:root { font: 18px/145% }\` (the stock Vite template does exactly this) hands every
   chart an inherited 26.1px line box; an 11px label in a 14px band is then sliced through
   the middle. The chart is not wrong and the host is not wrong — the boundary between
   them is, so the boundary fixes it. Both properties are overridable: a chart that sets
   its own line-height still wins. Deliberately NOT resetting font-family or color, which
   a host SHOULD be able to theme. Found 2026-07-26 in the React demo, on a chart that
   renders perfectly inside Power BI. */
.${HOST_CONTAINER_CLASS} { line-height: normal; letter-spacing: normal; }
/* BACKGROUND MARKS ARE NOT DATA. A mark whose ${ROW_IDX_ATTR} is EMPTY has no rows in the
   CURRENT frame — an animated map's region before its country enters the series. Every
   affordance below therefore skips it: brightening or dimming it manufactures a shade
   that appears in no legend, and at 25% grey over white it comes out LIGHTER than plain
   land, which reads as a real bottom-of-scale value rather than as absence. The guard is
   exactly [${ROW_IDX_ATTR}=""] — an ABSENT attribute is a tagged companion layer (an
   anomaly badge, a highlight stroke) and must keep dimming with its datum. */
.${HOST_CONTAINER_CLASS} .${MARK_CLASS} { cursor: pointer; transition: opacity 120ms ease-in-out, filter 100ms ease-in-out; }
.${HOST_CONTAINER_CLASS} .${MARK_CLASS}:not([${ROW_IDX_ATTR}=""]):hover { filter: brightness(1.1) drop-shadow(0 0 1.5px rgba(0,0,0,0.5)) !important; }
.${HOST_CONTAINER_CLASS}:has(.${MARK_CLASS}:not([${ROW_IDX_ATTR}=""]):hover) .${MARK_CLASS}:not(:hover):not([${ROW_IDX_ATTR}=""]) { opacity: 0.55; }
.${HOST_CONTAINER_CLASS}.${SELECTION_ACTIVE_CLASS} .${MARK_CLASS}:not(.${MARK_SELECTED_CLASS}):not([${ROW_IDX_ATTR}=""]) {
    opacity: var(${DIM_OPACITY_VAR}, ${DIM_OPACITY_DEFAULT}) !important;
}
/* THE LIFT, BY DECLARATION ONLY. Dimming the others is all the rule above does; a selected
   mark keeps whatever paint its chart gave it. A chart that draws every mark pale on purpose
   (a parallel-coordinates plot at 0.38 so overplotting reads) therefore shows its SELECTED
   lines at 38% - the same eye-reading as dimmed. Inside a group the chart stamps
   ${LIFT_SELECTED_CLASS} on, a selected mark is painted at full opacity. Opacity only, never
   stroke geometry. Undeclared charts are byte-identical, which is what keeps an alpha
   ENCODING (a depth cue, a hierarchy level) from being flattened by a fix meant for one. */
.${HOST_CONTAINER_CLASS}.${SELECTION_ACTIVE_CLASS} .${LIFT_SELECTED_CLASS} .${MARK_CLASS}.${MARK_SELECTED_CLASS},
.${HOST_CONTAINER_CLASS}.${SELECTION_ACTIVE_CLASS} .${MARK_CLASS}.${LIFT_SELECTED_CLASS}.${MARK_SELECTED_CLASS} {
    opacity: 1 !important; stroke-opacity: 1 !important; fill-opacity: 1 !important;
}
.${HOST_CONTAINER_CLASS} .${LEGEND_MARK_CLASS} { cursor: pointer; }
/* An axis/group header that filters when clicked LOOKS like inert text, and until it is
   marked there is no way to tell a landed filter from a dead label — the report reads
   "the axis labels are not clickable" even when every click resolved. Weight + underline
   rather than a colour: these labels sit wherever the host page's theme puts them, and
   the host has no reliable contrast partner out in the axis gutter. This paints NO marks,
   so it is the one acknowledgement a PERIOD tick can have without breaking the rule that
   a timeline never dims its own chart. */
.${HOST_CONTAINER_CLASS} .${AXIS_FILTER_CLASS} { cursor: pointer; }
.${HOST_CONTAINER_CLASS} .${ACTIVE_TICK_CLASS},
.${HOST_CONTAINER_CLASS} .${ACTIVE_TICK_CLASS} text {
    font-weight: 700 !important;
    text-decoration: underline !important;
}`;
            (doc.head || doc.documentElement)?.appendChild(st);
        } catch { /* no document (jsdom edge) — affordance is cosmetic, never fatal */ }
    };

    // Paint the current selection onto the marks. Re-run after EVERY render, because
    // the chart rebuilds its DOM and the classes would otherwise be lost on repaint.
    const paintSelection = () => {
        // A destroyed host owns nothing on the container any more: a late highlight or clear must not paint on it.
        if (destroyed) return;
        try {
            const sel = current;
            const active = !!sel && sel.length > 0;
            // A PERIOD selection filters everything downstream but never repaints THIS
            // chart: it is already showing that period by being on the frame, and dimming
            // by time invents shades no legend explains. A CATEGORY tick, and every mark
            // click, dims normally. See periodTickSuppressesFeedback in contract.ts.
            const dim = active && !selectionIsPeriod;
            container.classList?.[dim ? "add" : "remove"](SELECTION_ACTIVE_CLASS);
            // THE DIM LEVEL, when the host chose one. Written on the container so the injected rule's var() reads it; a
            // page that styles the variable itself keeps its value: in a stylesheet it is never touched, and inline on
            // the container it is saved on the first write and put back when the option goes away, unless the page has set
            // its own value in the meantime.
            const want = resolved.dimOpacity;
            if (typeof want === "number") {
                const level = String(want);
                let page = dimVarPage.get(container);
                if (!dimVarSet) {
                    if (!page) {
                        const value = container.style?.getPropertyValue?.(DIM_OPACITY_VAR) ?? "";
                        page = { was: value ? { value, priority: container.style?.getPropertyPriority?.(DIM_OPACITY_VAR) ?? "" } : null, holders: 0, wrote: level };
                        dimVarPage.set(container, page);
                    }
                    page.holders++;
                    dimVarSet = true;
                }
                if (page) page.wrote = level;
                container.style?.setProperty(DIM_OPACITY_VAR, level);
            } else releaseDimVar();
            // The clicked tick is marked under BOTH origins — it colours no marks, so it
            // is outside the period rule by construction and is the only feedback a
            // scrubbed period gets. Cleared when the selection empties or the anchor is
            // gone (a re-render replaces the node).
            const lit = container.querySelectorAll(`.${ACTIVE_TICK_CLASS}`);
            for (const t of Array.from(lit)) t.classList?.remove(ACTIVE_TICK_CLASS);
            const tickStillDrawn = !!activeTickEl && (typeof container.contains === "function"
                ? container.contains(activeTickEl)
                : activeTickEl.isConnected !== false);
            if (active && tickStillDrawn) activeTickEl.classList?.add(ACTIVE_TICK_CLASS);
            const wanted = new Set(sel ?? []);
            const marks = container.querySelectorAll(`.${MARK_CLASS}[${ROW_IDX_ATTR}], .${LEGEND_MARK_CLASS}[${ROW_IDX_ATTR}]`);
            // A CHART THAT DECLARED A RULE (contract 1.14.0) is painted through the shared plan:
            // only the marks the reader clicked light. The default below is untouched.
            const rule = selectionRuleOf(container);
            if (rule !== "any-row") {
                const list = Array.from(marks);
                const plan = planSelectionPaint(
                    list.map(m => ({ key: markKeyOf(m), rows: parseRowIdxs(m.getAttribute(ROW_IDX_ATTR)) })),
                    active ? wanted : [], rule, clickedMarks());
                list.forEach((m, i) => m.classList?.[plan.on[i] ? "add" : "remove"](MARK_SELECTED_CLASS));
                // What this paint lit becomes the clicked set, so a Ctrl-click after a restored
                // selection adds to the word already lit rather than starting over.
                setClickedMarks(plan.keys.length ? { keys: plan.keys, selection: Array.from(wanted) } : null);
                if (active) {
                    try {
                        config.onSelectionPaint?.({ rule, mode: plan.mode, lit: plan.on.filter(Boolean).length,
                            marks: list.length, selection: wanted.size });
                    } catch { /* a report must never break a paint */ }
                }
                return;
            }
            for (const m of Array.from(marks)) {
                // A mark represents SEVERAL rows (a legend swatch, an aggregated slice);
                // it counts as selected when ANY of its rows is in the selection, which is
                // what makes a legend click light up its own swatch and its marks together.
                const rows = parseRowIdxs(m.getAttribute(ROW_IDX_ATTR));
                const on = active && rows.some(r => wanted.has(r));
                m.classList?.[on ? "add" : "remove"](MARK_SELECTED_CLASS);
            }
        } catch { /* cosmetic */ }
    };

    // THE SELECTED-MARK GLYPH (options.selectionGlyph): a small dot or check on each selected mark, in a layer this host
    // owns inside the container. Kept OUT of paintSelection on purpose: that function returns early for a chart that
    // declares a selection rule, and such a chart still gets its glyphs. It runs after every selection change and, on a
    // render, after the layout pass and the fit, so neither of them ever measures a glyph as ink. A render clears the
    // container, so the layer is rebuilt when it is needed and never outlives the draw it was painted on.
    const GLYPH_LAYER_CLASS = "bic-selection-glyphs";
    // The container's inline position before THIS host made it relative for the layer, or null when it never did, so
    // destroy() hands the page back what it left.
    let glyphPositionWas: string | null = null;
    // MARKS THAT MOVE WITHOUT A RENDER - a pan or zoom, a transition, an animation frame, a legend toggle that hides a
    // series. While glyphs are lit the chart is watched for the attribute writes that move or hide a mark, and the glyphs
    // are repainted on the next frame, once however many writes land in it. Only a write ON a mark, or on an element that
    // holds one (the zoom layer, the svg), counts: a hover focus dot or a tooltip moved on every pointer move would
    // otherwise repaint every glyph once a frame. Blind to the layer's own changes and to the lasso outline. Connected
    // only while there is something to follow; a render disconnects it, and the paint after the render reconnects it.
    let glyphObserver: MutationObserver | null = null;
    // A LAYOUT CHANGE THAT WRITES NOTHING - a hidden tab shown (its marks measured 0 x 0 while it was hidden), a
    // responsive chart whose container the page resized - moves the marks with no attribute write at all. The container
    // is watched for its size while glyphs are lit, where the browser can (ResizeObserver), with the mutation observer.
    let glyphResize: ResizeObserver | null = null;
    let glyphSize = "";
    let glyphQueued = false;
    let glyphQueuedReport = false;
    // What the last report said, so a repaint after a layout change reports only when it drew a different count.
    let glyphReported = "";
    const sizeOfContainer = () => `${container.offsetWidth ?? 0}x${container.offsetHeight ?? 0}`;
    const glyphBlind = `.${GLYPH_LAYER_CLASS}, .${LASSO_OUTLINE_CLASS}`;
    const movesAMark = (r: MutationRecord) => {
        const t = r.target as Element;
        if (!t || t.closest?.(glyphBlind)) return false;
        return !!(t.classList?.contains(MARK_CLASS) || t.querySelector?.(`.${MARK_CLASS}`));
    };
    const queueGlyphs = (reportIfChanged: boolean) => {
        if (reportIfChanged) glyphQueuedReport = true;
        if (glyphQueued) return;
        glyphQueued = true;
        const run = () => {
            const r = glyphQueuedReport;
            glyphQueued = false; glyphQueuedReport = false;
            if (glyphObserver || glyphResize) paintGlyphLayer(r ? "if-changed" : false);
        };
        if (win?.requestAnimationFrame) win.requestAnimationFrame(run); else setTimeout(run, 16);
    };
    const followGlyphs = (on: boolean) => {
        if (!on) {
            if (glyphObserver) { glyphObserver.disconnect(); glyphObserver = null; }
            if (glyphResize) { glyphResize.disconnect(); glyphResize = null; }
            return;
        }
        const MO = win?.MutationObserver as typeof MutationObserver | undefined;
        if (!glyphObserver && MO) {
            glyphObserver = new MO(records => { if (!glyphQueued && records.some(movesAMark)) queueGlyphs(false); });
            glyphObserver.observe(container, { subtree: true, attributes: true,
                attributeFilter: ["transform", "d", "x", "y", "cx", "cy", "points", "width", "height",
                                  "visibility", "opacity", "style", "class"] });
        }
        const RO = (win as any)?.ResizeObserver as typeof ResizeObserver | undefined;
        if (!glyphResize && RO) {
            // Its first call reports the size already drawn at; only a size that differs from the last paint's repaints.
            glyphResize = new RO(() => { if (sizeOfContainer() !== glyphSize) queueGlyphs(true); });
            glyphResize.observe(container);
        }
    };
    // A MARK THE READER CAN'T SEE GETS NO GLYPH: hidden by visibility or opacity (a legend toggle hides a series that
    // way, and its marks keep their selected class), or, by where its glyph would go, outside its svg's frame or a
    // clip-path window on its way up (a point panned into the axis margin, or out of the plot entirely). The browser's
    // checkVisibility answers the first where it exists; elsewhere the computed styles do.
    const markShown = (m: Element): boolean => {
        try {
            const cv = (m as any).checkVisibility;
            if (typeof cv === "function") return cv.call(m, { visibilityProperty: true, opacityProperty: true }) !== false;
            const cs = win?.getComputedStyle;
            if (typeof cs !== "function") return true;
            const own = cs.call(win, m);
            if (own.visibility === "hidden" || own.visibility === "collapse") return false;
            for (let el: Element | null = m; el && el !== container; el = el.parentElement) {
                const s = el === m ? own : cs.call(win, el);
                if (s.display === "none" || (s.opacity !== "" && parseFloat(s.opacity) === 0)) return false;
            }
        } catch { /* a mark that won't say is shown */ }
        return true;
    };
    const glyphWindows = (): ((m: Element, x: number, y: number) => boolean) => {
        type Win = { left: number; top: number; right: number; bottom: number };
        const windowOf = new Map<Element, Win | null>();
        const read = (el: Element): Win | null => {
            if (!windowOf.has(el)) {
                let w: Win | null = null;
                try {
                    if ((el.tagName || "").toLowerCase() === "svg") {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) w = r;
                    } else if (el.hasAttribute?.("clip-path")) w = clipWindowOf(el);
                } catch { w = null; }
                windowOf.set(el, w);
            }
            return windowOf.get(el) ?? null;
        };
        const EPS = 0.5;
        return (m, x, y) => {
            for (let el: Element | null = m; el && el !== container; el = el.parentElement) {
                const w = read(el);
                if (w && (x < w.left - EPS || x > w.right + EPS || y < w.top - EPS || y > w.bottom + EPS)) return false;
            }
            return true;
        };
    };
    // `report` is false for a repaint that only follows moving marks: the selection and its counts are the ones already
    // reported, and a pan would otherwise report once a frame. "if-changed", for a repaint after a layout change,
    // reports when it drew a different count (a chart shown from a hidden tab), once, not for every frame of a resize.
    const paintGlyphLayer = (report: boolean | "if-changed" = true) => {
        if (destroyed) return;
        let follow = false;
        try {
            let layer = container.querySelector<HTMLElement>(`:scope > .${GLYPH_LAYER_CLASS}`);
            clearSelectionGlyphs(layer);
            const mode = resolved.selectionGlyph;
            if (mode !== "dot" && mode !== "check") { glyphReported = ""; return; }
            // A PERIOD selection dims nothing, so it marks nothing either (periodTickSuppressesFeedback).
            const active = !!current && current.length > 0 && !selectionIsPeriod;
            if (!active) { glyphReported = ""; return; }
            if (resolved.suppressSelectionGlyph) {
                if (report === true) try { config.onSelectionGlyphs?.({ mode, drawn: 0, total: 0, suppressed: true }); } catch { /* a report never breaks a paint */ }
                glyphReported = "";
                return;
            }
            follow = true;
            if (!layer) {
                layer = doc.createElement("div") as HTMLElement;
                layer.className = GLYPH_LAYER_CLASS;
                layer.setAttribute("aria-hidden", "true");
                // UNDER the note badges' layer (z-index 2) and the lasso's caption (2), and under the pinned axis copy
                // (3, fitDom), whose opaque band covers the rows scrolled beneath it: a glyph on one of those rows must
                // be covered with it, not float over the axis. A chart's own tooltip or control that sets a z-index
                // above 1 stays over the glyphs too. Hidden overflow, at the size set below: see there.
                Object.assign(layer.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0",
                    overflow: "hidden", pointerEvents: "none", zIndex: "1" });
                // A positioned ancestor for the layer, set only when the page left the container static - the same
                // rule the note badges and the axis pin follow. The fit can make this container scroll, and a layer
                // anchored outside it would neither scroll with the marks nor be clipped with them.
                try {
                    const pos = win?.getComputedStyle?.(container)?.position || container.style.position;
                    if (!pos || pos === "static") {
                        const was = container.style.position;
                        container.style.position = "relative";
                        if (glyphPositionWas === null) glyphPositionWas = was;
                    }
                } catch { /* no layout */ }
                container.appendChild(layer);
            }
            // THE LAYER COVERS WHAT THE CONTAINER SCROLLS, AND CLIPS THERE: a glyph at a plot's edge, half past it,
            // would otherwise widen the container's scroll area (and, where it scrolls, give it a scrollbar to nothing).
            // Collapsed first, so the size it reads is the chart's alone and a container that shrank is not held open.
            layer.style.width = "0";
            layer.style.height = "0";
            const sw = container.scrollWidth || 0, sh = container.scrollHeight || 0;
            layer.style.width = `${sw}px`;
            layer.style.height = `${sh}px`;
            glyphSize = sizeOfContainer();
            const centers: GlyphCenter[] = [];
            collectGlyphCentersWhere(container, layer.getBoundingClientRect(), centers, { shown: markShown, at: glyphWindows() });
            // Ink and halo as the Power BI visual draws them: the theme's slots in high contrast, near-black on white otherwise.
            const hc = !!resolved.isHighContrast;
            const drawn = centers.length ? paintSelectionGlyphs(layer, centers, {
                symbol: mode === "check" ? "✓" : "●",
                color: hc ? (resolved.themeFg || "#111") : "#111",
                halo: hc ? (resolved.themeBg || "#fff") : "#fff",
            }) : 0;
            const said = `${mode}:${drawn}:${centers.length}`;
            if (report === true || (report === "if-changed" && said !== glyphReported)) {
                glyphReported = said;
                try { config.onSelectionGlyphs?.({ mode, drawn, total: centers.length, suppressed: false }); } catch { /* a report never breaks a paint */ }
            }
        } catch { /* cosmetic - a glyph must never break a paint */ }
        finally {
            try {
                followGlyphs(follow);
                // Writes made before this paint (the selection's own class changes among them) are already in it.
                glyphObserver?.takeRecords();
            } catch { /* following is a courtesy */ }
        }
    };

    // `tick` is the axis/group element that drove this selection, or null for a data-mark
    // click / a clear. It decides BOTH the affordance anchor and, with the container's own
    // timeline slots, whether the marks dim at all.
    // `publish` false paints the selection without telling the subscribers: a highlight-only lasso.
    const notify = (rowIdxs: number[], source: string, tick?: any, fromChart = false, publish = true) => {
        if (destroyed) return;
        current = rowIdxs;
        selectionFromChart = rowIdxs.length > 0 && fromChart;
        selectionPublished = publish;
        activeTickEl = rowIdxs.length ? (tick ?? null) : null;
        selectionIsPeriod = rowIdxs.length > 0
            && periodTickSuppressesFeedback(!!tick, chartOwnsTimeline(container));
        paintSelection();
        paintGlyphLayer();
        if (!publish) return;
        for (const cb of subs) { try { cb(rowIdxs, source); } catch { /* subscriber error is not ours */ } }
    };

    // WHAT A LASSO DOES TO THE PAGE (contract 1.17.0). "filter", the default, publishes the circled rows exactly as
    // a click does, so a page filter bound to the chart takes every circled key and the other charts follow.
    // "highlight" lights them here and tells nobody. A filtering lasso whose selection reaches nothing outside the
    // chart is a highlight in effect, and the host says so once: a page built without wiring the chart to a filter
    // otherwise looks as though the lasso did nothing to the rest of the page, with nothing to say why.
    const selectFromLasso = (rows: number[]) => {
        if (lassoEffect(resolved.lasso) === "highlight") { notify(rows, "user", null, true, false); return; }
        notify(rows, "user", null, true);
        if (warnedLassoNoFilter || !rows.length) return;
        let reaches = true;
        try { reaches = config.selectionReachesPage ? config.selectionReachesPage() !== false : subs.size > 0; }
        catch { /* an answer that throws is not a reason to warn */ }
        if (reaches) return;
        warnedLassoNoFilter = true;
        try {
            (win?.console ?? console)?.warn(
                `[@bicharts/chart-host] a lasso circled ${rows.length} ${rows.length === 1 ? "row" : "rows"}, but the page ` +
                `gave this chart no filter to set (no \`selects\` or bindFilter, no chart group), so the lasso only ` +
                `highlights inside the chart and the rest of the page does not follow. To filter the page, pass ` +
                `selects={useBicFilter("<key column>")} to this chart and filter the other charts by that filter; ` +
                `for a highlight on purpose, set lasso.effect to "highlight".`);
        } catch { /* advisory only */ }
    };

    // The chart's own dispatch (scrubber ticks, period changes) — the primary
    // mechanism for animated charts. detail = {clear,source} | {mark,source} | {rows,source}.
    // xfAt timestamps it so the click handler can tell "the chart already handled this
    // gesture" from "a static chart marked an axis label and dispatched nothing".
    let xfAt = 0;
    const XF_ECHO_MS = 150;
    const onXf = (e: any) => {
        const d = e?.detail || {};
        xfAt = Date.now();
        // A chart-dispatched mark IS the tick it came from — a scrubber hands over its own
        // period tick — so it anchors the affordance and, on a timeline-owning chart, marks
        // the selection as a PERIOD. `source` cannot be used for this: the scrubber reports
        // an honest 'user' when the reader clicked it.
        // A clear of a highlight-only lasso (its clear slot dispatching) is not told to the page, which never heard it.
        if (d.clear) notify([], d.source || "chart", undefined, false, selectionPublished || !(current && current.length));
        else if (d.mark) notify(parseRowIdxs(d.mark.getAttribute?.(ROW_IDX_ATTR)), d.source || "chart", d.mark, true);
        // A selection the chart COMPUTED (a drawn region, a brushed range) has no element to point at, so it
        // carries the row indices themselves. Untrusted, so read through validRowSet; an empty set is a clear.
        // fromChart, like a mark: the chart owns this selection, so an empty click calls its clear slot first.
        else if (Array.isArray(d.rows)) notify(validRowSet(d.rows), d.source || "chart", null, true);
    };
    // Plain mark clicks (static charts + choropleth regions): the chart does NOT
    // dispatch the event for these — the host reads data-row-idx itself.
    //
    // The selector MATCHES THE VISUAL's (`.d3-mark, .d3-legend-mark, .d3-axis-filter`).
    // .d3-axis-filter used to be excluded here on the assumption that a chart owning an
    // axis-tick click always dispatches llm-xfilter-refresh — true for ANIMATED scrubber
    // ticks, false for the static charts that label a category axis `.d3-axis-filter` and
    // dispatch nothing (measured 2026-07-26 on a cold-generated grouped bar: the class and
    // data-row-idx are emitted, no dispatch anywhere in the file). Clicking a category
    // label therefore did nothing in an SDK host while working in Power BI. `xfJustFired`
    // below keeps the animated case from double-firing.
    const resolver = createMarkResolver({
        root: container, doc,
        log: () => { /* diagnostics are the visual's concern; the resolution logic is shared */ },
    });
    // A READER'S CLEAR on empty canvas: the click below, and the lasso's own empty click and Escape. Click on empty
    // canvas CLEARS, the way every BI tool behaves. Without this a selection is a one-way door: the React demo could
    // filter to one city and had no gesture to get back ("how can I go back to nothing selected?").
    const clearFromGesture = () => {
        if (current && current.length) {
            // THE CHART CLEARS ITSELF WHEN IT OWNS THE SELECTION (2026-09-15). `clear()`
            // beside this handler has always called the container's __llmXfClear slot
            // first; the CLICK path never did, so it published an empty selection while
            // the chart went on drawing the filter it had set. Measured through 0.5.101
            // in Chromium: zoomed on Sales, a real click on an empty corner fired
            // selection.onChange([], 'user') with the breadcrumb still reading
            // All > Sales. Every chart that owns its own selection drifts the same way -
            // a zoomable Sunburst's focus, an animated chart's period on its scrubber.
            //
            // The slot zooms the chart back out and publishes its own clear through
            // llm-xfilter-refresh, which onXf already turns into notify([]). So notify
            // only when the chart did NOT settle it: a chart that clears without
            // dispatching would otherwise leave the host believing the old selection is
            // live - the same reason clear() settles unconditionally.
            //
            // ONLY WHEN THE CHART PUBLISHED THIS SELECTION. The slot does more than clear:
            // an animated chart's returns the scrubber to "All periods". A reader paused on
            // one period who clicked a BAR and then empty canvas asked to drop the bar, not
            // the period they were reading - measured in Chromium, the unconditional call
            // jumped that chart to All. A selection read off a clicked mark, or handed in by
            // the host, is not the chart's to undo; it clears exactly as it did before.
            const slot = (container as any)[CONTAINER_SLOT_XF_CLEAR];
            if (selectionFromChart && typeof slot === "function") {
                try { slot(); } catch { /* chart already clear */ }
            }
            // A highlight-only lasso was never told to the page, so neither is its clear.
            if (current && current.length) notify([], "user", undefined, false, selectionPublished);
        }
    };

    // THE HOST LASSO (lasso.ts), installed after every render and torn down before the next, because a render
    // clears the container and the lasso's surface goes with it. It selects through notify, so it shares the
    // dim, the subscribers and the clear slot with a mark click instead of keeping a selection of its own.
    let lasso: LassoHandle | null = null;
    const disposeLasso = () => { const l = lasso; lasso = null; try { l?.destroy(); } catch { /* it drew nothing that matters now */ } };
    const clickSel = `.${MARK_CLASS}[${ROW_IDX_ATTR}], .${LEGEND_MARK_CLASS}[${ROW_IDX_ATTR}], .${AXIS_FILTER_CLASS}[${ROW_IDX_ATTR}]`;
    const onClick = (e: any) => {
        // A DRAG IS NOT A CLICK (2026-10-09). The click that ends a press which moved 5px or more is
        // the tail of a gesture the chart owns - a brush, an orbit, a lasso - and it lands wherever
        // the pointer was released. Read as a click it selected the mark under the release point, or,
        // released on empty canvas, cleared the selection the gesture had just made. Read first and
        // spent here, so the press on record is always the one this click belongs to.
        const wasDrag = clickWasDrag(container, e);
        clearPress(container);
        if (wasDrag) return;
        // A chart that dispatched for THIS gesture has already been handled by onXf, which
        // runs first (the chart's own handler sits on the tick; this one on the container).
        if (Date.now() - xfAt < XF_ECHO_MS) return;
        // A CLICK IN THE CHART'S OWN CONTROL (2026-09-24) - a number box, a slider's hit area - is
        // not a gesture on the data. It resolves no mark, so below it would read as empty canvas
        // and clear the reader's selection the moment they focused a box to type; and the
        // geometry fallback could select whatever mark sits under the box. Skipped before both.
        if (isInsideControl(e?.target, container)) return;
        let el: any = resolver.findMark(e?.target, clickSel, e as MouseEvent);
        // OVERLAY PENETRATION then GEOMETRY — the two hardenings the visual has carried
        // since two production charts exposed it, already ported into selection.ts but never wired up here.
        // Without them a tooltip/crosshair overlay painted OVER the marks (fill:'transparent'
        // is a painted fill, so it hit-tests) makes every mark click read as "empty canvas"
        // and the chart silently cannot cross-filter — which is exactly what a cold consumer
        // hit on 2026-07-26, then worked around with their own elementsFromPoint hack.
        // Both run ONLY on the branch that already resolved nothing, so neither can alter a
        // click that resolved normally.
        if (!el) el = resolver.penetrateOverlayAt(e?.clientX, e?.clientY, clickSel);
        if (!el) el = resolver.resolveByGeometry(e?.clientX, e?.clientY, clickSel);
        if (!el) {
            clearFromGesture();
            return;
        }
        const rows = parseRowIdxs(el.getAttribute(ROW_IDX_ATTR));
        if (!rows.length) return;
        // Is the thing clicked an axis/group header? That is what makes it eligible to be
        // a period AND what gives the affordance something to light. A legend swatch is
        // not a tick: it names a series, and its own MARK_SELECTED_CLASS already says so.
        const tick = (el.classList?.contains?.(AXIS_FILTER_CLASS)) ? el : null;

        // MULTI-SELECT (Ctrl / Cmd / Shift) and the plain click's replace-or-toggle-off, by the
        // one rule the Power BI visual applies too (nextSelection). Without the modifiers a chart
        // that grows a selection fine inside Power BI silently could not outside it.
        //
        // A multi-select mixes origins; the last click decides, exactly as the visual does -
        // ticks do not participate in multi-select in practice, so this stays simple rather than
        // tracking a per-row origin map. A plain click that clears (a toggle-off) lights no tick.
        const multi = !!(e?.ctrlKey || e?.metaKey || e?.shiftKey);
        const next = nextSelection(current, rows, { ctrl: !!(e?.ctrlKey || e?.metaKey), shift: !!e?.shiftKey });
        const toggledOff = !multi && next.length === 0;
        // Which mark was clicked: what a chart that declared "clicked-marks" lights. Kept for every
        // chart; one that declared nothing never reads it.
        setClickedMarks(nextClickedMarks(clickedMarks(), current, markKeyOf(el), next,
            { ctrl: !!(e?.ctrlKey || e?.metaKey), shift: !!e?.shiftKey }));
        notify(next, "user", toggledOff ? null : tick);
    };
    container.addEventListener(XFILTER_REFRESH_EVENT, onXf);
    const untrackPress = trackPress(container);
    container.addEventListener("click", onClick);
    container.classList?.add(HOST_CONTAINER_CLASS);
    ensureAffordanceStyles();

    const fitOpts: boolean | FitRenderedChartOptions = config.fit ?? true;
    const labelContrastOpts: boolean | LabelContrastOptions = config.labelContrast ?? true;

    const stopAnim = () => { const s = (container as any)[CONTAINER_SLOT_ANIM_STOP]; if (typeof s === "function") { try { s(); } catch { /* chart timer already dead */ } } };

    // THE ZOOM MEMORY (config.zoomMemory): what the current render captured, and the key its view is kept under.
    const zoomMemory = config.zoomMemory ?? null;
    let zoomCap: ZoomCapture | null = null;
    let zoomKey = "";
    // A gesture still settling is recorded from the chart it was made on, before that chart's DOM goes away.
    const flushZoom = () => { if (zoomMemory) { try { zoomMemory.flush(); } catch { /* never costs a render */ } } };
    // A destroyed host lets the hook go of its container, so a hook handed to the next host (or replaced) is not left
    // watching an element nobody draws into.
    const releaseZoom = () => { if (zoomMemory) { try { zoomMemory.release?.(container); } catch { /* never costs a teardown */ } } };

    // THE READER'S SCROLL survives a redraw of the SAME chart: remembered on the container before it is cleared (here and in
    // destroy(), so a host re-created on the same element finds it), restored by the fit only when the chart is the same one.
    // The chart is its source text: the `code` the host was given, or the renderFn's own source. Not the function's
    // identity: a page that re-creates its host on every data update, or <BicChart renderFn={(c, d, o) => draw(c, d, o)}>
    // (a new closure on every parent render, so a new host), would otherwise have every cross-filter put the reader back
    // at the top. Two closures with the same source and different captured values run the same drawing code, so for the
    // scroll they are the same chart; the offset is clamped to what the new draw can scroll anyway. Bound and native
    // functions all print alike, so they restore one another's offset, as every chart did before scroll was keyed at all.
    // Nothing is remembered before this host has drawn: a scroll the container carried before then was not made on this
    // chart. `restoreScroll: false` leaves the scroll to the page.
    const keepScroll = config.restoreScroll !== false;
    let chartSource: string | undefined;
    const scrollKey = (): unknown => {
        if (config.code) return config.code;
        if (chartSource === undefined && typeof config.renderFn === "function") {
            try { chartSource = Function.prototype.toString.call(config.renderFn); } catch { return config.renderFn; }
        }
        return chartSource;
    };
    let hasRendered = false;

    // EVERYTHING THAT HAPPENS AFTER THE CHART HAS DRAWN, in one place and with exactly one
    // definition. A chart that draws asynchronously must receive the IDENTICAL treatment a
    // synchronous one gets, and the only way to guarantee that as passes are added is for both
    // lanes to call the same function rather than each keep a copy that drifts.
    const runPostRenderPasses = () => {
        // THE REMEMBERED ZOOM, FIRST and synchronously: it has to land before the browser paints, or the reader sees
        // the chart at full extent and then jump, and before every pass below, so they measure the view the reader
        // will actually see.
        if (zoomMemory && zoomCap) {
            try { zoomMemory.restore(container, zoomCap, zoomKey, chartD3); } catch { /* never costs a render */ }
        }
        // ONE PAGE, ONE ID SPACE - first, before any pass reads the DOM. The chart's clip paths and gradients get this
        // host's suffix and its url(#...) references follow, so a second chart of the same size can't be clipped by
        // the first one's rectangle. A clash it prevented is said once, in the console, where a developer looks.
        try {
            const r = scopeChartIds(container, idScope);
            if (r.collisions.length && !warnedIds) {
                warnedIds = true;
                try {
                    (win?.console ?? console)?.warn(
                        `[@bicharts/chart-host] ids shared with another chart, scoped: ${r.collisions.slice(0, 5).join(", ")}`);
                } catch { /* advisory only */ }
            }
            config.onIdScope?.(r);
        } catch { /* a scoping pass must never break a render that already succeeded */ }
        // CAN THE LABELS ON THE MARKS BE READ? First of the post-render passes, and BEFORE
        // the hit-target heal on purpose: that heal injects fill:'transparent' rects over
        // tagged groups, and although this pass treats alpha-0 as "not a backdrop", the
        // order keeps the two from ever having to know about each other. The page
        // background comes from the resolved options - the same value the chart itself
        // was handed - unless the host names one; a themed canvas is not white, and every
        // readability answer is measured against it. Never throws; reported, never fatal.
        if (labelContrastOpts !== false) {
            try {
                const lc = labelContrastOpts === true ? {} : { ...labelContrastOpts };
                if (!lc.pageBg) {
                    const bg = (resolved as any).backgroundColor ?? (resolved as any).themeBg;
                    if (typeof bg === "string" && bg) lc.pageBg = bg;
                }
                const r = applyLabelContrast(container, lc);
                config.onLabelContrast?.(r);
            } catch { /* a contrast pass must never break a render that already succeeded */ }
        }
        // THE HOST'S LAYOUT PASS (legend reconcile, frame fit), after the labels have their colors and before anything
        // measures marks or the frame. Never fatal.
        if (config.layoutPass) {
            try { config.layoutPass(container); } catch { /* a layout pass must never break a render that already succeeded */ }
        }
        // A DECLARED mark that cannot receive a click is not a mark. Heal the two
        // habits that leave one unhittable (an inert <g> whose painted children are
        // pointer-events:none, and a painted element that is itself pointer-events:
        // none) before anything tries to click it. Purely additive and idempotent —
        // it only ever makes clickable something the chart already tagged. It matters
        // most for the FURNITURE: a legend swatch or an axis / group header is exactly
        // what a chart tends to draw as inert text, and exactly what a reader tries.
        ensureCrossfilterHitTargets(container, doc);
        // The chart just rebuilt its DOM, so the selection classes are gone. Repaint
        // them or a cross-filtered chart loses its own highlight on every restyle.
        paintSelection();
        // DID IT ACTUALLY DRAW? A render that returns without throwing is
        // not the same as a render that painted something, and the difference is invisible
        // from out here — generated code guards its own column lookups and bails to a
        // "no data" div, which reaches this line as a complete success. Runs LAST, after
        // hit-target healing, so a mark that only became countable there still counts.
        // Never throws: a diagnostic must not be why a delivered render fails.
        try {
            const census = censusMarks(container);
            if (isBlankRender({
                markCount: census.markCount,
                rows: data.rows ? data.rows.length : 0,
                animated: config.animated,
                contractUntagged: config.contractUntagged,
                declaresNoRowMarks: census.declaresNoRowMarks,
            })) {
                if (!warnedBlank) {
                    warnedBlank = true;
                    try {
                        (win?.console ?? console)?.warn(
                            `[@bicharts/chart-host] this chart rendered without error but painted no data ` +
                            `marks, against ${data.rows.length} row(s) — so the container is empty. The usual ` +
                            `cause is that the generated code binds a column BY NAME that is no longer in ` +
                            `the data, sending it down its own "no data" branch. Check that the columns in ` +
                            `your table still match the ones the chart was generated for.`);
                    } catch { /* advisory only */ }
                }
                config.onBlankRender?.({ census, rows: data.rows ? data.rows.length : 0 });
            }
        } catch { /* a census must never break a render */ }
        // CAN THE MARKS BE HIT? Counted separately from whether they exist, because a thin
        // open stroke is present, correct, tagged, and still unclickable unless you aim at
        // the hairline. Reported, never repaired: widening a hit band has a real failure
        // mode of its own, so the measurement lands first and alone. After hit-target
        // healing, for the same reason the blank census is — a mark that only became
        // countable there should be measured as it will actually behave.
        if (config.onHitBandCensus) {
            try { config.onHitBandCensus(censusHitBands(container, doc)); }
            catch { /* a census must never break a render */ }
        }
        // AND HOW MUCH OF IT IS ONE SHADE? Same position and the same contract as the hit
        // band above: after every heal, counts only, and it says nothing at all rather than
        // guessing when the fills are not a ramp.
        if (config.onColourSpreadCensus) {
            try { config.onColourSpreadCensus(censusColourSpread(container, doc)); }
            catch { /* a census must never break a render */ }
        }
        if (config.onClippedTextCensus) {
            try { config.onClippedTextCensus(censusClippedText(container)); }
            catch { /* a census must never break a render */ }
        }
        // AND IS EACH DOT AT ITS VALUE? Same contract again; it needs the rows, because the
        // only way to know a dot's value is to read it back through data-row-idx.
        if (config.onValuePlacementCensus) {
            try { config.onValuePlacementCensus(censusValuePlacement(container, data)); }
            catch { /* a census must never break a render */ }
        }
        // DOES IT FIT, AND IF NOT CAN THE READER GET AT THE REST (2026-09-03)? Runs
        // LAST, after every heal and census, because it measures what is finally on screen.
        // The <svg> clips at its own viewport, so a chart drawing past its declared height
        // loses those rows outright while the container reports that everything fits - the
        // frame is grown to the ink FIRST, and only then does a scrollbar mean anything.
        // Taken on every render, fit or no fit, so a waiting memory never outlives the render it was kept for.
        const scrollMem = takeScroll(container);
        if (fitOpts !== false) {
            try {
                const base: FitRenderedChartOptions = fitOpts === true ? {} : fitOpts;
                const r = fitRenderedChart(container, keepScroll ? { ...base, restoreScroll: { memory: scrollMem, key: scrollKey() } } : base);
                config.onFit?.(r);
            } catch { /* a fit pass must never break a render that already succeeded */ }
        }
        // NOTES ON MARKS, after the fit: the badges sit on the marks where they finally are.
        try { drawAnnotations(); } catch { /* a badge must never break a render that already succeeded */ }
        // THE SELECTED-MARK GLYPHS, after the layout pass and the fit: they sit on the marks where they finally are.
        paintGlyphLayer();
        // THE LASSO, last: it reads the marks' boxes and covers the plot, so it goes on once everything else has
        // measured and moved the chart. A chart that is not capable, a reader who switched it off, and a chart over
        // the row cap each get nothing here (the last gets its caption); and a lasso kept from before is re-applied
        // and announced to the chart without being published.
        try {
            lasso = installLasso({
                container, options: () => resolved, rows: data.rows ? data.rows.length : 0,
                select: selectFromLasso,
                clearSelection: clearFromGesture,
            });
        } catch { /* a lasso that cannot install is a chart without one, never a render that failed */ }
    };

    // ONE FAILURE BODY for both lanes, for the same reason the passes above are one function:
    // a chart that fails by REJECTING and one that fails by THROWING said the same thing, and
    // two copies of this decision would eventually disagree about which is a crash.
    //
    // Returns the error to raise, or null when the failure was an INVALID sentinel the host
    // asked to handle — a DATA STATE, not a crash: the code ran and said the data in front of
    // it lacks something it is built on. Then stop anything the chart started, drop the
    // half-built frame (it is not a chart), and let the host say what is missing. Nothing was
    // drawn, so there is nothing to heal, count or fit.
    const renderFailure = (err: unknown): unknown => {
        const message = String((err as any)?.message ?? err ?? "");
        if (config.onInvalidSentinel && isInvalidSentinelError(message)) {
            stopAnim();
            container.innerHTML = "";
            config.onInvalidSentinel({ reason: invalidSentinelReason(message), message });
            return null;
        }
        return explainRenderFailure(err, d3);
    };

    const host: ChartHost = {
        render() {
            if (destroyed) return;
            // THIS RENDER'S TICKET. Taken before anything is torn down, so a continuation from
            // an earlier async render can see that it has been superseded the moment this line
            // runs — which is also the moment the old chart's DOM stops existing.
            const seq = ++renderSeq;
            stopAnim();                          // contract: stop the old timer before repaint
            followGlyphs(false);                 // the draw's own writes are not marks moving; the paint after it reconnects
            disposeLasso();                      // its surface is about to go; its listeners must go with it
            flushZoom();                         // a pending zoom gesture is read off the old chart first
            if (hasRendered && keepScroll) rememberScroll(container, scrollKey());   // where the reader was, before the clear sends it to the top
            container.innerHTML = "";            // the host owns clearing between renders
            hasRendered = true;
            if (!renderFn) {
                if (!config.code) throw new Error("createChartHost: provide code or renderFn");
                renderFn = compileRenderFn(config.code, win, doc, chartD3);
            }
            // Attach geometry + unmatched when configured and not explicitly supplied.
            // render() is SYNCHRONOUS by contract, so geoKind resolves against whatever the
            // caller has already made available — an explicit geoProvider, or the cache that
            // `await loadGeo(kind)` / registerGeo() fills. A caller who sets geoKind without
            // doing either gets no geometry, which is why that case warns rather than drawing
            // a mysteriously empty map.
            if (resolved.geo === undefined && config.geoKind) {
                const g = config.geoProvider?.(config.geoKind) ?? geoFromCache(config.geoKind);
                if (g) resolved = { ...resolved, geo: g };
                else if (!warnedGeo) {
                    warnedGeo = true;
                    try {
                        (win?.console ?? console)?.warn(
                            `[@bicharts/chart-host] geoKind "${config.geoKind}" was set but no geometry is ` +
                            `available, so this chart will draw without a basemap. Either ` +
                            `\`await loadGeo("${config.geoKind}")\` before rendering, pass a geoProvider, ` +
                            `or import { geoForKind } from "@bicharts/chart-host/geo" and set options.geo.`);
                    } catch { /* advisory only */ }
                }
            }
            if (resolved.geoUnmatched === undefined && data.geoUnmatched) resolved = { ...resolved, geoUnmatched: data.geoUnmatched };
            // Same promotion for point maps: without it the chart cannot say which rows it
            // could not place, or that a "city" dot is really a state centroid.
            if (resolved.geoPoint === undefined && data.geoPoint) resolved = { ...resolved, geoPoint: data.geoPoint };
            // The route's OTHER end. Promoted separately rather than folded into geoPoint:
            // an arc is only as honest as its worse endpoint, and a chart that cannot tell
            // which end is coarse cannot say so.
            if (resolved.geoPointDest === undefined && data.geoPointDest) resolved = { ...resolved, geoPointDest: data.geoPointDest };
            // A fact about the cells themselves: without it a date shim inside the chart re-examines rows the
            // host already re-anchored. Harmless (it would find nothing to move), but the declaration is the contract.
            if (resolved.dateCellsAreUtcDays === undefined && data.dateCellsAreUtcDays) resolved = { ...resolved, dateCellsAreUtcDays: true };
            // The generate answer's glyph suppression, when the host handed over the whole payload rather than the option.
            if (resolved.suppressSelectionGlyph === undefined && data.meta?.suppressSelectionGlyph === true)
                resolved = { ...resolved, suppressSelectionGlyph: true };
            // THE RENDER ITSELF, AND WHAT IT HANDED BACK. A generated chart whose drawing
            // library has no synchronous API — one that must parse, lay out or fetch before it
            // can paint — returns a PROMISE, and anything measured before that settles is not
            // measuring this chart. RenderFn is declared `=> void`, which in TypeScript permits
            // a function returning anything, so the value is read back as unknown.
            let outcome: unknown;
            // REMEMBERED ZOOM: d3.zoom is wrapped while the chart's code runs (that is when it creates its zoom
            // behavior) and released after, whatever happens. Only for a chart compiled here from `code`: a
            // precompiled renderFn closed over a d3 this host never saw.
            zoomCap = null;
            if (zoomMemory && config.code && !config.renderFn) {
                try {
                    zoomKey = zoomMemory.keyFor(config.code, resolved.width ?? container.clientWidth,
                                                resolved.height ?? container.clientHeight);
                    zoomCap = zoomMemory.capture(chartD3);
                } catch { zoomCap = null; }
            }
            try {
                try {
                    outcome = renderFn(container, { columns: data.columns, rows: data.rows }, resolved);
                } finally {
                    try { zoomCap?.release(); } catch { /* a release that fails leaves d3.zoom wrapped, never the chart broken */ }
                }
            } catch (err) {
                const fatal = renderFailure(err);
                if (fatal) { settle(Promise.reject(fatal)); throw fatal; }
                // An INVALID sentinel the host asked to handle: render() returns normally,
                // exactly as it always has, and `rendered` resolves — nothing FAILED, there was
                // simply nothing to draw.
                settle(Promise.resolve());
                return;
            }
            if (!isThenable(outcome)) {
                // THE SYNCHRONOUS LANE, UNCHANGED — and it stays unchanged deliberately, because
                // every chart type shipped so far comes through here. The passes run inline,
                // before render() returns, and `rendered` is an already-resolved promise so a
                // caller that awaits it unconditionally pays nothing and waits for nothing.
                runPostRenderPasses();
                settle(Promise.resolve());
                return;
            }
            // THE ASYNCHRONOUS LANE. Routed back through the SAME two functions the synchronous
            // lane uses, and BOUNDED, because a promise that never settles is a chart that never
            // says anything at all — no marks, no error, no census — and a host that gives up is
            // at least a host that can tell its reader something.
            settle(new Promise<void>((resolve, reject) => {
                const timer: any = setTimeout(() => {
                    reject(new Error(
                        "[@bicharts/chart-host] the chart did not finish drawing within " +
                        `${Math.round(ASYNC_RENDER_TIMEOUT_MS / 1000)}s, so the host stopped waiting ` +
                        "for it. Nothing past that point ran: no label-contrast pass, no hit-target " +
                        "heal, no census, no fit. A render() that returns a promise has to settle it."));
                }, ASYNC_RENDER_TIMEOUT_MS);
                const done = (fn: () => void) => { clearTimeout(timer); fn(); };
                Promise.resolve(outcome).then(
                    () => done(() => {
                        // SUPERSEDED, SO STOP. A later render has already cleared this chart's DOM
                        // and is drawing its own; running these passes now would measure and mutate
                        // the NEW chart against the OLD one's data and options, and the older draw
                        // would win by finishing last. Resolve quietly — this promise is no longer
                        // the one `host.rendered` hands out, so nobody is waiting on it.
                        if (destroyed || seq !== renderSeq) { resolve(); return; }
                        runPostRenderPasses();
                        resolve();
                    }),
                    err => done(() => {
                        // The same rule on the failure side, for a sharper reason: a superseded
                        // render must not clear the container or announce a missing column to a
                        // host that has already moved on to the chart now on screen.
                        if (destroyed || seq !== renderSeq) { resolve(); return; }
                        const fatal = renderFailure(err);
                        if (fatal) reject(fatal); else resolve();
                    }));
            }));
        },
        // A DESTROYED HOST OWNS NOTHING ON THE CONTAINER any more. A host rebuilt on the same element has taken over
        // the chart's slots (its clear, its animation stop, its initial mark) and the clicked-marks record, so every
        // method below that reaches the container returns first: a stale reference to the old host (a closure, a late
        // callback) must not clear, stop or annotate the chart that is on screen now.
        setOptions(partial) {
            if (destroyed) return;
            raw = { ...raw, ...partial };
            resolved = resolveForHost(raw);
            host.render();
        },
        setData(next) {
            if (destroyed) return;
            data = next;
            host.render();
        },
        get options() { return resolved; },
        setAnnotations(list) {
            if (destroyed) return;
            annotationLayer.set(list);
            try { drawAnnotations(); } catch { /* never breaks the chart on screen */ }
        },
        get annotationReport() { return annotationLayer.report; },
        // A GETTER, not a captured value: `rendered` names the LATEST render, so a host that
        // read it once would otherwise hold the promise of a draw long since replaced.
        get rendered() { return renderedPromise; },
        selection: {
            onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
            clear() {
                if (destroyed) return;
                const s = (container as any)[CONTAINER_SLOT_XF_CLEAR];
                if (typeof s === "function") { try { s(); } catch { /* chart already clear */ } }
                setClickedMarks(null);
                // A selection cleared from outside leaves no lasso drawn around it. Not published again: the clear below is.
                lasso?.clear({ publish: false, source: "host" });
                // Always settle the host's own state, even when the chart owns the clear:
                // a chart that clears WITHOUT dispatching would otherwise leave the host
                // (and every subscriber) believing the old selection is still live.
                notify([], "host");
            },
            highlight(rowIdxs) {
                if (destroyed) return;
                // HIGHLIGHT, DON'T FILTER — the second half of a coordinated dashboard, and
                // until now the half a host had to hand-roll out of the lch-* class grammar
                // after reading this package's source. (Measured 2026-08-01: ~5 minutes of a
                // build spent exactly there.)
                //
                // Source "host" is load-bearing, not a label: it is the marker that says
                // "this selection came from OUTSIDE, do not publish it back". Without it a
                // pair of mutually-linked charts each republish what the other just sent and
                // the dashboard fights itself.
                const rows = Array.isArray(rowIdxs) ? rowIdxs.slice() : [];
                // A selection handed in that is not the lasso's rows is no longer what the outline describes. The
                // same rows repainted (a group re-deriving the origin's own selection) leave it where it is.
                if (lasso && lasso.rows().length && !sameRowSet(rows, lasso.rows())) lasso.clear({ publish: false, source: "host" });
                notify(rows, "host");
            },
            get current() { return current; },
        },
        animation: { stop() { if (!destroyed) stopAnim(); } },
        initialMark() { return destroyed ? null : ((container as any)[CONTAINER_SLOT_INITIAL_XF_MARK] as Element) ?? null; },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            stopAnim();
            container.removeEventListener(XFILTER_REFRESH_EVENT, onXf);
            container.removeEventListener("click", onClick);
            untrackPress();
            clearPress(container);
            disposeLasso();
            subs.clear();
            // A host rebuilt on the same element must not inherit a dim level this one wrote; the page's own comes back.
            releaseDimVar();
            annotationLayer.destroy();
            if (hasRendered && keepScroll) rememberScroll(container, scrollKey());   // for the next host on this element
            unpinScrolledAxis(container);        // its scroll listener outlives the cleared DOM
            flushZoom();                         // a pending zoom gesture is read off the chart before it goes
            releaseZoom();
            followGlyphs(false);
            container.innerHTML = "";
            // The position the glyph layer needed goes back to what the page left, unless the page has changed it since.
            if (glyphPositionWas !== null) {
                try { if (container.style.position === "relative") container.style.position = glyphPositionWas; } catch { /* frozen element */ }
                glyphPositionWas = null;
            }
        },
    };
    return host;
}

