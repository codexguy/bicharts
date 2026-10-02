// React binding for @bicharts/chart-host — <BicChart> and <BicChartGroup>.
//
// This is ~150 lines that every consumer would otherwise write, and get subtly wrong in the
// same four ways:
//
//   1. StrictMode double-mounts effects (React 19, dev). Without destroy() in cleanup an
//      animated chart leaks a running timer per mount — on every hot reload.
//   2. Prop changes must not RECOMPILE. `options` -> setOptions (live restyle), `data` ->
//      setData; only new code/module tears down and rebuilds. A naive useEffect([deps])
//      recompiles on every prop change and throws away animation state.
//   3. d3 must be INJECTED. There is no global in a bundler app, so `d3` is a required prop.
//   4. The chart OWNS its container's DOM. React must never render children into it.
//
// Cross-chart filtering lives in <BicChartGroup> for a reason that is not cosmetic: rowIdx
// values are positions WITHIN THE PAYLOAD A CHART RECEIVED. Filter the rows for chart B and
// its payload renumbers from zero, so the same integers now denote different records —
// silently. The group owns the source table, builds each chart's payload, keeps the
// payload-row -> source-row map, and translates selections across it. Consumers never see it.
//
// THE GROUP ITSELF IS THE CORE'S createChartGroup (group.ts) since 2026-09-24, so a host with
// no React coordinates charts by the same rules. What stays here is only what is React's: the
// context, the effects that hand a member its payload, and the state a page reads.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode, RefObject } from "react";
import { createChartHost, type ChartHost, type ChartHostConfig } from "./host";
import type { ResolveOptionsInput } from "./defaults";
import type { GeoPointBinding } from "./payload";
import { geoFromCache, loadGeo } from "./geoLazy";
import { createChartGroup, syncMemberSelection, toSourceRows, type ChartGroup, type ChartGroupSelection } from "./group";
import { bindFilter, createFilter, createFilterScope, payloadRowReader, viewToken, viewFromToken, type PageView,
         type Filter, type FilterBinding, type FilterOptions, type FilterScope } from "./filterScope";

export { assembleD3 } from "./host";
import { attachControls, createControls, type Controls, type ControlsAttachment } from "./controls";
export { createControls, type Controls, type ControlInfo } from "./controls";
export { noteBadges, badgeKey, notesFor, type MarkNoteLike, type NoteBadgeOptions } from "./markNotes";
export { viewToken, viewFromToken, LINKED_HOVER_CLASS, type PageView } from "./filterScope";
export { createFilter, createFilterScope, fromVegaInteraction,
         type Filter, type FilterOptions, type FilterScope, type FilterChangeReason } from "./filterScope";

export interface BicChartProps {
    /** Generated render() source (an ES module's `code` export, or the raw string). */
    code?: string;
    /** Pre-compiled render function — the alternative to `code`. */
    renderFn?: ChartHostConfig["renderFn"];
    /** The payload: { columns, rows, geoUnmatched?, geoPoint? } — MCP's data.sample.json verbatim. */
    data?: ChartHostConfig["data"];
    /** Raw options; shared defaults/clamps are applied by resolveOptions. */
    options?: ResolveOptionsInput;
    /** REQUIRED: the d3 v7 namespace. There is no global in a bundled app. */
    d3: any;
    /** Attach the bundled geometry for this kind as options.geo (choropleth or basemap). */
    geoKind?: string;
    /**
     * WHERE THIS APP KEEPS THE CHART'S RESTING VIEW-STATE - a sort, an expanded row, a 3D
     * camera. Omit for the session store parked on the container element, which is the right
     * answer for most pages: the chart remembers while it is mounted and forgets on reload.
     *
     * Supply one to outlive the page. A React app is the host that most often has somewhere
     * better to put it - localStorage, a URL query, a user profile on the server - and no
     * default could pick between them, which is why this is a prop rather than a flag.
     */
    viewState?: ChartHostConfig["viewState"];
    /**
     * CAN THE LABELS ON THE MARKS BE READ? Default on: after every render a label sitting on a
     * mark it cannot be read against is recoloured black or white. Pass `false` for a page that
     * owns its label colours, or `{ pageBg }` to name the canvas the chart sits on - a dark or
     * themed page is not white, and readability is measured against it. See createChartHost.
     */
    labelContrast?: ChartHostConfig["labelContrast"];
    /** What the label-contrast pass did after each render - counts, for a page that logs. */
    onLabelContrast?: ChartHostConfig["onLabelContrast"];
    /**
     * THE CHART STOPPED BECAUSE THE DATA LACKS A COLUMN IT IS BUILT ON. Supplied: the chart's
     * container is left empty and this is called with the chart's reason, instead of the throw
     * reaching React - so a page can say what is missing where the chart would be. Absent: the
     * throw propagates as before. See createChartHost's `onInvalidSentinel`.
     */
    onInvalidSentinel?: ChartHostConfig["onInvalidSentinel"];
    /** Identity within a <BicChartGroup> — the key other charts filter by. */
    id?: string;
    /** Take this group member's selection as a filter on THIS chart's rows. */
    filteredBy?: string;
    /**
     * How this chart REACTS to a sibling's selection.
     *
     *   "filter"    (default) — re-render with only the selected rows.
     *   "highlight"           — keep every mark, dim the ones outside the selection.
     *
     * A map almost always wants "highlight": filtering a bubble map to one city throws the
     * geography away, and the dashboard that motivated this option hand-rolled the dim out
     * of the `lch-*` classes to get it back. A table almost always wants "filter". The pair
     * — map highlights, table filters — is the ordinary coordinated dashboard, and it is
     * now two props rather than a DOM workaround.
     */
    respondsWith?: "filter" | "highlight";
    /**
     * THE PAGE FILTER THIS CHART SELECTS - from useBicFilter("RegionCode"). A click sets it, the
     * same click or a click on empty canvas clears it, and the filter's state is painted onto the
     * marks whoever changed it: `filter.clear()` from a page button clears the marks too. New data
     * keeps a selection whose key is still drawn and clears (reason "data") one whose key is gone.
     * The page reads `filter.value` / `filter.row` and never writes a select handler. With
     * `selects`, the filter owns what this chart shows as selected.
     */
    selects?: Filter;
    /**
     * THE CHART'S OWN CONTROLS AS PAGE STATE - from useBicControls(). For a chart that draws
     * sliders (the What-if projection's rate and horizon): `controls.values` holds every
     * knob's value from the first draw (no slider has to move first), `controls.info` / `summary`
     * the chart's own label and readout for each ("growth per year +5.5%"), `controls.set(saved)`
     * applies a saved scenario and `controls.reset()` returns to the defaults. It owns the chart's
     * uiState / setUiState.
     */
    controls?: Controls;
    /**
     * Selection callback in SOURCE row indices (group) or payload indices (standalone). An empty
     * list means the selection was CLEARED: the same mark clicked again, a click on empty canvas,
     * or new data that no longer draws what was selected. The chart toggles for you - set your
     * state from exactly what this gives you, never toggle it again. Prefer `selects`.
     */
    onSelect?: (rowIdxs: number[]) => void;
    /**
     * Notes on marks: a badge on each key's mark, redrawn after every render - e.g.
     * `[{ column: "RegionCode", value: "JPN", label: "2", title: "..." }]`. Keyed by a value in a column,
     * never a row position, so a filter or a re-query never moves one.
     */
    annotations?: ChartHostConfig["annotations"];
    /** A badge was clicked (the mark beneath is not selected). */
    onAnnotationClick?: ChartHostConfig["onAnnotationClick"];
    className?: string;
    style?: React.CSSProperties;
    /** What a screen reader announces for the chart ("Occupancy vs average daily rate, by country"). */
    ariaLabel?: string;
}

// ── Group coordination ──────────────────────────────────────────────────────
//
// ONE active selection for the group, tagged with which chart produced it — the same
// model every BI tool uses. Every OTHER chart filters to it; the originating chart does
// not (it keeps showing all its marks, with the selected ones highlighted, so the user
// can see what they picked in context and click again to change it). That single rule
// gives mutual cross-filtering for free: click a bubble and the table filters, click a
// table row and the map filters, with no possibility of a feedback loop. The rules live in
// the core group; the context carries it, a snapshot of its selection - a new object on every
// publish and clear, which is what re-evaluates the members - and a token that changes only
// with the source table. A member's payload is re-derived when the token or ITS OWN filter
// changes, never merely because the selection did: a member whose rows did not change is
// repainted, not redrawn.
interface GroupCtx {
    group: ChartGroup;
    /** The whole group's active selection, whoever produced it. */
    selection: ChartGroupSelection;
    /** A new object whenever the source table (or its bindings) changes, and only then. */
    source: object;
}
const Ctx = createContext<GroupCtx | null>(null);

/** Read the group's selection from a page — for a "clear" button or a count. */
export function useBicSelection() {
    const g = useContext(Ctx);
    return {
        rows: (g?.selection.rows ?? []) as number[],
        sourceId: g?.selection.sourceId ?? null,
        clear: () => g?.group.clear(),
    };
}

export interface BicChartGroupProps {
    /** The ONE source table. Every member's payload is derived from it. */
    rows: Record<string, any>[];
    columns: any[];
    /** Choropleth join binding, applied when building each member's payload. */
    geo?: { column: string; kind: string } | null;
    /** Point-map geocoding binding (city/state/zip/lat/lon column names). */
    point?: GeoPointBinding | null;
    /** A route's far end (an origin-destination flow map); `point` is then the origin. */
    destination?: GeoPointBinding | null;
    children: ReactNode;
}

/**
 * Owns the source table and the selection bus. Members declare `id` and optionally
 * `filteredBy`; the group re-derives the filtered member's payload and translates row
 * indices in both directions, so a click in one chart filters another CORRECTLY.
 */
export function BicChartGroup({ rows, columns, geo, point, destination, children }: BicChartGroupProps) {
    // ONE core group for the component's life. A member captures it when its host is built, so
    // it is never replaced: a new source table goes in through setSource, which keeps the
    // selection, as this component always did.
    const groupRef = useRef<ChartGroup | null>(null);
    if (!groupRef.current) groupRef.current = createChartGroup(columns, rows, { geo, point, destination });
    const group = groupRef.current;
    const [sel, setSel] = useState<ChartGroupSelection>(group.selection);
    // Applied during render, before the members render, so they derive from the new table in
    // the same pass. Idempotent, so StrictMode's double render costs nothing.
    const source = useMemo(() => {
        group.setSource(columns, rows, { geo, point, destination });
        return {};
    }, [group, rows, columns, geo, point, destination]);
    // A "source" change is this component's own props: the render already carries it.
    useEffect(() => group.onChange((s, change) => { if (change !== "source") setSel(s); }), [group]);
    const value = useMemo<GroupCtx>(() => ({ group, selection: sel, source }), [group, sel, source]);
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function BicChart(props: BicChartProps) {
    const { code, renderFn, options, d3, geoKind, viewState, labelContrast, onLabelContrast,
            onInvalidSentinel, id, filteredBy, respondsWith, onSelect, annotations, onAnnotationClick,
            className, style, selects, controls, ariaLabel } = props;
    const ref = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<ChartHost | null>(null);
    const rowMapRef = useRef<number[] | null>(null);
    const ctx = useContext(Ctx);
    const group = ctx ? ctx.group : null;

    // Resolve this chart's payload: from the group (filtered + mapped) or the raw prop.
    // `filteredBy` narrows this to ONE partner when a page wants explicit one-way wiring;
    // omit it and the chart responds to whichever sibling published — mutual by default.
    const incoming = group ? group.incomingFor(id, filteredBy) : null;
    // HIGHLIGHT mode keeps the FULL payload — the sibling's selection is painted onto the
    // marks below instead of removing rows. Splitting it here rather than downstream is
    // what makes it a re-paint and not a re-render: the chart is never rebuilt, so a map
    // keeps its projection, its zoom and its basemap while the table beside it filters.
    const highlightMode = respondsWith === "highlight";
    const filterSel = highlightMode ? null : incoming;
    const built = useMemo(() => {
        if (!group) return null;
        return group.payloadFor(filterSel);
        // Re-derived only when this member's rows can differ: a new source table, or a new filter
        // for THIS member. A selection change that leaves its filter where it was - the origin, a
        // highlight member, a member wired to a different partner - keeps the same payload, so the
        // data effect below does nothing and the selection effect repaints.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group, ctx?.source, filterSel && filterSel.join(",")]);
    const data = built ? built.payload : props.data;
    rowMapRef.current = built ? built.rowMap : null;
    const dataRef = useRef(data);
    dataRef.current = data;
    // What the page filter reads a drawn row as: the SOURCE row object in a group (the page's own
    // rows, keyed by column name), or the payload row otherwise.
    const groupRef = useRef(group);
    groupRef.current = group;
    const bindingRef = useRef<FilterBinding | null>(null);
    const controlsRef = useRef<ControlsAttachment | null>(null);
    const readControlsSoon = () => {
        const h = hostRef.current, c = controlsRef.current;
        if (h && c) h.rendered.then(c.read, () => {});
    };
    // Whether the selection this chart shows now was made by the reader on it (not painted in).
    const userSelectedRef = useRef(false);
    const optKey = useMemo(() => JSON.stringify(options ?? {}), [options]);
    const builtWithRef = useRef<{ data?: unknown; optKey?: string } | null>(null);

    // Keep the newest callback without making it a rebuild trigger.
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const onLabelContrastRef = useRef(onLabelContrast);
    onLabelContrastRef.current = onLabelContrast;
    const onInvalidSentinelRef = useRef(onInvalidSentinel);
    onInvalidSentinelRef.current = onInvalidSentinel;
    const onAnnotationClickRef = useRef(onAnnotationClick);
    onAnnotationClickRef.current = onAnnotationClick;
    // By content, so a page that builds the list inline on every render does not redraw the badges each time.
    const annKey = useMemo(() => JSON.stringify(annotations ?? []), [annotations]);
    const annotationsRef = useRef(annotations);
    annotationsRef.current = annotations;

    // GEOMETRY — core render() is synchronous by contract, so the host can only attach what
    // is already cached; a cold cache used to mean a bubble map that painted its marks over
    // NO land, with nothing but a console warning (2026-08-01). This binding is the one
    // async-aware layer, so it owns the fetch: when `geoKind` names geometry the cache
    // doesn't hold, load it and re-render.
    // loadGeo is cached and idempotent (StrictMode double-run is free), and a chart with no
    // geoKind never touches it. Preloading before mount still works and skips the one-frame
    // basemap pop-in.
    const [geoTick, setGeoTick] = useState(0);
    useEffect(() => {
        if (!geoKind || geoFromCache(geoKind)) return;
        let alive = true;
        loadGeo(geoKind).then(g => { if (alive && g) setGeoTick(t => t + 1); });
        return () => { alive = false; };
    }, [geoKind]);
    useEffect(() => {
        if (geoTick) hostRef.current?.render();
    }, [geoTick]);

    // BUILD/TEARDOWN — only when the code identity changes. useLayoutEffect so the chart
    // paints before the browser does, avoiding a flash of empty container.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || (!code && !renderFn) || !data) return;
        const ctl = controls ? attachControls(() => hostRef.current, el, controls) : null;
        controlsRef.current = ctl;
        const hostOptions = ctl ? { ...(options ?? {}), ...ctl.options } : options;
        const host = createChartHost(el, { code, renderFn, data, options: hostOptions, d3, geoKind, viewState,
                                           labelContrast,
                                           onLabelContrast: r => onLabelContrastRef.current?.(r),
                                           // A GETTER, not a wrapper: the host decides whether to
                                           // swallow the sentinel throw by whether this is SET, so
                                           // an always-present wrapper would hide the throw from a
                                           // page that never asked. Read at throw time, so the
                                           // newest prop wins without a rebuild.
                                           get onInvalidSentinel() {
                                               return onInvalidSentinelRef.current
                                                   ? (info: { reason: string; message: string }) => onInvalidSentinelRef.current?.(info)
                                                   : undefined;
                                           },
                                           annotations: annotationsRef.current ?? [],
                                           onAnnotationClick: a => onAnnotationClickRef.current?.(a) });
        hostRef.current = host;
        builtAnnKeyRef.current = annKey;
        const off = host.selection.onChange((payloadIdxs, source) => {
            // "host" = a programmatic clear WE issued (below) to drop a stale highlight.
            // Publishing it would overwrite the selection another chart just made — the
            // feedback loop that makes mutual cross-filtering fight itself.
            if (source === "host") return;
            userSelectedRef.current = payloadIdxs.length > 0;
            // Translate to SOURCE indices before anything leaves this chart.
            const sourceIdxs = toSourceRows(rowMapRef.current, payloadIdxs);
            if (group && id) group.publish(id, sourceIdxs);
            onSelectRef.current?.(sourceIdxs);
        });
        host.render();
        readControlsSoon();
        // What the host was BUILT with, so the effects below do not hand the same data or options
        // straight back: that was a second full render of every chart on mount.
        builtWithRef.current = { data, optKey };
        return () => {
            // StrictMode double-mount and every unmount land here: stop the timer, drop the
            // listeners, clear the DOM. Skipping this is the animated-chart leak.
            off();
            ctl?.detach();
            if (controlsRef.current === ctl) controlsRef.current = null;
            host.destroy();
            hostRef.current = null;
        };
        // labelContrast is a HOST config, read once at creation, so flipping it is a rebuild
        // (cheap: the code identity is unchanged, only the config) rather than a silent no-op.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code, renderFn, d3, geoKind, labelContrast, controls]);

    // THE PAGE FILTER - bound once the host exists, and again whenever the host is rebuilt or the
    // filter replaced. The first paint restores a selection made before this chart mounted (a
    // chart that remounts on a re-query shows what the page still holds).
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host || !selects) return;
        const payloadRows = payloadRowReader(() => dataRef.current as any);
        const b = bindFilter(host, selects, {
            container: ref.current,
            rowAt(i) {
                const g = groupRef.current, map = rowMapRef.current;
                if (g && map) {
                    const s = map[i];
                    return s === undefined ? null : (g.rows[s] as Record<string, unknown>) ?? null;
                }
                return payloadRows.rowAt(i);
            },
            rowCount() {
                const map = rowMapRef.current;
                return groupRef.current && map ? map.length : payloadRows.rowCount();
            },
        });
        bindingRef.current = b;
        // Reconcile, not just paint: a chart that remounted after its query reloaded adopts the
        // selection its click made and drops it if the new rows don't carry it.
        b.reconcile();
        return () => {
            b.detach();
            if (bindingRef.current === b) bindingRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selects, code, renderFn, d3, geoKind, labelContrast]);

    // LIVE RESTYLE — options change without recompiling (colour scale, aggregation,
    // animMaxIdealFrames, maxMapPoints…). This is the whole point of setOptions. Skipped when the
    // options are the ones the host was just built with.
    useEffect(() => {
        if (!hostRef.current || !options) return;
        if (builtWithRef.current?.optKey === optKey) return;
        builtWithRef.current = { ...builtWithRef.current, optKey };
        hostRef.current.setOptions(options);
        readControlsSoon();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [optKey]);

    // NOTES ON MARKS changed - the badges alone are redrawn; the chart is not.
    const builtAnnKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!hostRef.current || builtAnnKeyRef.current === annKey) return;
        builtAnnKeyRef.current = annKey;
        hostRef.current.setAnnotations(annotationsRef.current ?? []);
    }, [annKey]);

    // DATA change (including a cross-filter re-derive) — a redraw, never a recompile. Skipped when
    // it is the payload the host was just built with.
    useEffect(() => {
        if (!hostRef.current || !data) return;
        if (builtWithRef.current?.data === data) return;
        builtWithRef.current = { ...builtWithRef.current, data };
        hostRef.current.setData(data);
        // The page filter's selection, against the rows drawn now: kept if its key is still here.
        bindingRef.current?.reconcile();
        readControlsSoon();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    // Drop a STALE highlight: once the group's selection belongs to someone else (or was
    // cleared), this chart must stop showing its own marks as selected. Without it a
    // "Clear" button empties the filter while the origin chart stays visibly dimmed.
    //
    // In HIGHLIGHT mode the same effect does the opposite job as well: a sibling's
    // selection is PAINTED here rather than clearing. Both branches route through the
    // host's `"host"` source, so nothing published here comes back as a new selection.
    //
    // A chart bound to a page filter (`selects`) skips this: the filter owns what it shows.
    //
    // NEW DATA THAT DROPS A SELECTION IS REPORTED. When a new source table makes this effect clear
    // a selection the reader made on this chart, `onSelect([])` says so - the page's own state of
    // what's selected would otherwise go stale, still showing a pick the chart no longer does.
    const lastSourceRef = useRef<object | undefined>(ctx?.source);
    useEffect(() => {
        const host = hostRef.current;
        if (!host || !ctx) return;
        const sourceChanged = lastSourceRef.current !== ctx.source;
        lastSourceRef.current = ctx.source;
        if (selects) return;
        const before = (host.selection.current ?? []).length;
        syncMemberSelection(host, ctx.selection, id, highlightMode, incoming, rowMapRef.current);
        if (sourceChanged && before && !(host.selection.current ?? []).length && userSelectedRef.current) {
            userSelectedRef.current = false;
            onSelectRef.current?.([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ctx?.selection, id, ctx, highlightMode, incoming && incoming.join(","), selects]);

    // No children: the chart owns this element's contents.
    return <div ref={ref} className={className} style={style}
                role={ariaLabel ? "figure" : undefined} aria-label={ariaLabel || undefined} />;
}

// ── The page's filters ─────────────────────────────────────────────────────────
//
// What a page filters by, kept by column VALUES (a country code, a route's two ends) rather than
// by any chart's row positions, so it survives re-queries and works across charts drawn from
// different queries. See filterScope.ts for the rules; these are the React handles.

// The page every filter belongs to unless a <BicPage> says otherwise: one per app, so a page needs
// no provider for <BicFilterChips /> to list its filters - and a hook called in the same component
// that renders the chips can't miss them by sitting outside its own provider.
const defaultScope = createFilterScope();
const PageCtx = createContext<FilterScope>(defaultScope);

/**
 * A SEPARATE filter scope, for an app with several independent pages or panels mounted at once.
 * Not needed otherwise: every filter joins the app's one default scope. Call useBicFilter in a
 * component INSIDE it - a hook can't see a provider its own component renders.
 */
export function BicPage({ children }: { children: ReactNode }) {
    const ref = useRef<FilterScope | null>(null);
    if (!ref.current) ref.current = createFilterScope();
    return <PageCtx.Provider value={ref.current}>{children}</PageCtx.Provider>;
}

/**
 * A page filter keyed by one model column ("RegionCode") or several (a route:
 * ["OriginCode", "DestinationCode"]). Pass it to a chart's `selects` and read
 * `value` / `values` / `row` / `active` for the rest of the page; `clear()` clears it and the
 * chart's marks. Re-renders the component on every change. The key columns are read once.
 */
export function useBicFilter(columns: string | readonly string[], opts?: FilterOptions): Filter {
    const scope = useContext(PageCtx);
    const ref = useRef<Filter | null>(null);
    if (!ref.current) ref.current = createFilter(columns, opts);
    const f = ref.current;
    useEffect(() => scope.add(f), [scope, f]);
    useSyncExternalStore(cb => f.onChange(() => cb()), () => f.version, () => f.version);
    return f;
}

/**
 * A chart's in-chart controls as page state: pass to the chart's `controls`, read `values`, `info`
 * and `summary`, `set(saved)` to apply a saved scenario, `reset()` for the defaults. Re-renders the
 * component on every change. `initial` seeds the values the chart first draws with.
 */
export function useBicControls(initial?: Readonly<Record<string, unknown>>, opts?: { id?: string }): Controls {
    const scope = useContext(PageCtx);
    const ref = useRef<Controls | null>(null);
    if (!ref.current) ref.current = createControls(initial);
    const c = ref.current;
    // Registered with the page, so a saved view (useBicView, useBicUrlState) carries the chart's controls too.
    useEffect(() => scope.addControls(opts?.id ?? "controls", c), [scope, c, opts?.id]);
    useSyncExternalStore(cb => c.onChange(() => cb()), () => c.version, () => c.version);
    return c;
}

/**
 * THE PAGE'S VIEW, SAVED AND PUT BACK: every page filter's keys and every chart's controls (useBicControls). `save()`
 * returns a JSON-safe view to store (a saved view, a user preference); `restore(view)` puts one back; `token()` /
 * `restoreToken(t)` do the same as a URL-safe string for a link.
 */
export function useBicView(): { save: () => PageView; restore: (v: PageView | null | undefined) => void;
                                token: () => string; restoreToken: (t: string | null | undefined) => void } {
    const scope = useContext(PageCtx);
    return useMemo(() => ({
        save: () => scope.save(),
        restore: (v: PageView | null | undefined) => scope.restore(v),
        token: () => viewToken(scope.save()),
        restoreToken: (t: string | null | undefined) => scope.restore(viewFromToken(t)),
    }), [scope]);
}

/**
 * THE VIEW IN THE ADDRESS BAR (opt-in): restores the page's filters and controls from `?<param>=` on mount, then keeps
 * the parameter current as they change (history.replaceState - no navigation, no new history entries). A copied link
 * opens the page as it was. Call once, in the page component, after its useBicFilter / useBicControls calls.
 */
export function useBicUrlState(param = "view"): void {
    const scope = useContext(PageCtx);
    useEffect(() => {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        scope.restore(viewFromToken(url.searchParams.get(param)));
        return scope.onChange(() => {
            const u = new URL(window.location.href);
            const view = scope.save();
            const empty = !view.filters && !view.controls;
            if (empty) u.searchParams.delete(param); else u.searchParams.set(param, viewToken(view));
            if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u.href);
        });
    }, [scope, param]);
}

/**
 * A DEVELOPER'S VIEW OF THE PAGE'S STATE: every filter (its keys, its text, the last change and why), every chart's
 * controls, and the last changes in order. Collapsed in a corner; render it only in development.
 */
export function BicDevtools({ max = 20 }: { max?: number }) {
    const scope = useContext(PageCtx);
    const [, tick] = useState(0);
    const log = useRef<string[]>([]);
    useEffect(() => scope.onChange(() => {
        const at = new Date().toLocaleTimeString();
        const changed = scope.filters.map(f => `${f.label}: ${f.active ? f.text : "(none)"}${f.reason ? ` [${f.reason}]` : ""}`);
        log.current = [`${at}  ${changed.join(" | ")}`, ...log.current].slice(0, max);
        tick(t => t + 1);
    }), [scope, max]);
    const box: React.CSSProperties = { position: "fixed", right: 8, bottom: 8, zIndex: 2147483000, maxWidth: 420,
        maxHeight: "50vh", overflow: "auto", font: "12px/1.4 ui-monospace, monospace", background: "Canvas",
        color: "CanvasText", border: "1px solid GrayText", borderRadius: 6, padding: 6, opacity: 0.95 };
    return (
        <details className="bic-devtools" style={box}>
            <summary style={{ cursor: "pointer" }}>chart-host: {scope.active.length} filter(s) active</summary>
            {scope.filters.map(f => (
                <div key={f.id}>
                    <b>{f.label}</b> [{f.key}] {f.active ? JSON.stringify(f.keys) : "(none)"} {f.text && `"${f.text}"`}
                    {f.reason ? ` - last: ${f.reason}` : ""} v{f.version}
                </div>
            ))}
            {[...scope.controls].map(([k, c]) => <div key={k}><b>controls</b> [{k}] {c.summary || JSON.stringify(c.values)}</div>)}
            <div style={{ marginTop: 4, opacity: 0.8 }}>{log.current.map((l, i) => <div key={i}>{l}</div>)}</div>
        </details>
    );
}

/** Every filter on the page (or the enclosing <BicPage>), and its clear-all - for a page's own chip bar or count. */
export function useBicFilters(): { filters: readonly Filter[]; active: readonly Filter[]; clearAll: () => void } {
    const scope = useContext(PageCtx);
    const [, tick] = useState(0);
    useEffect(() => scope.onChange(() => tick(t => t + 1)), [scope]);
    return { filters: scope.filters, active: scope.active, clearAll: () => scope.clearAll() };
}

export interface BicFilterChipsProps {
    className?: string;
    /** Each chip's class (the label, the value and its × are inside). */
    chipClassName?: string;
    /** The words on the clear-all button, shown when two or more filters are active. Default "Clear all". */
    clearAllText?: string;
    style?: React.CSSProperties;
}

/**
 * What the page is filtered by: one chip per active filter ("Country: Japan ×"), a × that
 * clears it (and its chart's marks), and "Clear all" when two or more are active. Renders nothing
 * while nothing is filtered. Plain markup with class names to style.
 */
export function BicFilterChips({ className, chipClassName, clearAllText = "Clear all", style }: BicFilterChipsProps) {
    const { active, clearAll } = useBicFilters();
    if (!active.length) return null;
    const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 4px 2px 10px",
                                        border: "1px solid currentColor", borderRadius: 999, font: "inherit", lineHeight: 1.6 };
    const x: React.CSSProperties = { border: 0, background: "transparent", color: "inherit", cursor: "pointer",
                                     font: "inherit", padding: "0 6px", lineHeight: 1 };
    return (
        <div className={["bic-filter-chips", className].filter(Boolean).join(" ")} role="group" aria-label="Filters"
             style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", ...style }}>
            {active.map(f => (
                <span key={f.id} className={["bic-filter-chip", chipClassName].filter(Boolean).join(" ")}
                      style={chipClassName ? undefined : chip}>
                    <span className="bic-filter-chip-label">{f.label}: </span>
                    <span className="bic-filter-chip-value">{f.text}</span>
                    <button type="button" className="bic-filter-chip-clear" aria-label={`Clear ${f.label}`}
                            style={chipClassName ? undefined : x} onClick={() => f.clear()}>×</button>
                </span>
            ))}
            {active.length > 1 && (
                <button type="button" className="bic-filter-chips-clear-all" onClick={clearAll}
                        style={{ font: "inherit", background: "transparent", border: 0, color: "inherit",
                                 textDecoration: "underline", cursor: "pointer" }}>{clearAllText}</button>
            )}
        </div>
    );
}

/**
 * THE SIZE A CHART SHOULD DRAW AT: the element's measured box, kept current as it resizes.
 *
 * A chart draws to `options.width` / `options.height`, and a page that hard-codes them draws the
 * same size in a phone and on a wall. Give the element its size in CSS (a width of 100%, a height
 * or an aspect ratio) and pass what this measures. `{ width: 0, height: 0 }` until the element has
 * been measured - skip rendering until then rather than drawing at zero.
 */
export function useMeasuredSize(ref: RefObject<Element | null>): { width: number; height: number } {
    const [size, setSize] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const read = () => {
            const r = el.getBoundingClientRect();
            const width = Math.round(r.width), height = Math.round(r.height);
            // Same box, same object: a resize callback that changes nothing must not re-render.
            setSize(s => (s.width === width && s.height === height ? s : { width, height }));
        };
        read();
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref]);
    return size;
}
