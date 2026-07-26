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
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createChartHost, type ChartHost, type ChartHostConfig } from "./host";
import type { ResolveOptionsInput } from "./defaults";
import { buildRenderPayload, type GeoPointBinding } from "./payload";

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
    /** Identity within a <BicChartGroup> — the key other charts filter by. */
    id?: string;
    /** Take this group member's selection as a filter on THIS chart's rows. */
    filteredBy?: string;
    /** Selection callback in SOURCE row indices (group) or payload indices (standalone). */
    onSelect?: (rowIdxs: number[]) => void;
    className?: string;
    style?: React.CSSProperties;
}

// ── Group coordination ──────────────────────────────────────────────────────
//
// ONE active selection for the group, tagged with which chart produced it — the same
// model every BI tool uses. Every OTHER chart filters to it; the originating chart does
// not (it keeps showing all its marks, with the selected ones highlighted, so the user
// can see what they picked in context and click again to change it). That single rule
// gives mutual cross-filtering for free: click a bubble and the table filters, click a
// table row and the map filters, with no possibility of a feedback loop.
interface GroupSelection { sourceId: string | null; rows: number[] }
interface GroupCtx {
    /** Source rows as objects, shared by every member. */
    rows: Record<string, any>[];
    columns: any[];
    geo?: { column: string; kind: string } | null;
    point?: GeoPointBinding | null;
    /** Publish a member's selection, already translated to SOURCE row indices. */
    publish(id: string, sourceRowIdxs: number[]): void;
    /** The filter `id` should APPLY (null = show everything). Never its own selection. */
    filterFor(id: string | undefined): number[] | null;
    /** The whole group's active selection, whoever produced it. */
    selection: GroupSelection;
    clear(): void;
}
const Ctx = createContext<GroupCtx | null>(null);

/** Read the group's selection from a page — for a "clear" button or a count. */
export function useBicSelection() {
    const g = useContext(Ctx);
    return {
        rows: g?.selection.rows ?? [],
        sourceId: g?.selection.sourceId ?? null,
        clear: () => g?.clear(),
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
    children: ReactNode;
}

/**
 * Owns the source table and the selection bus. Members declare `id` and optionally
 * `filteredBy`; the group re-derives the filtered member's payload and translates row
 * indices in both directions, so a click in one chart filters another CORRECTLY.
 */
export function BicChartGroup({ rows, columns, geo, point, children }: BicChartGroupProps) {
    const [sel, setSel] = useState<GroupSelection>({ sourceId: null, rows: [] });
    const value = useMemo<GroupCtx>(() => ({
        rows, columns, geo, point,
        selection: sel,
        publish: (id, sourceRowIdxs) =>
            setSel(sourceRowIdxs.length ? { sourceId: id, rows: sourceRowIdxs }
                                        : { sourceId: null, rows: [] }),
        // A chart never filters itself — that is what keeps the gesture reversible:
        // the origin chart still shows every mark, so there is always something left
        // to click to change or clear the selection.
        filterFor: (id) => (sel.rows.length && sel.sourceId && sel.sourceId !== id) ? sel.rows : null,
        clear: () => setSel({ sourceId: null, rows: [] }),
    }), [rows, columns, geo, point, sel]);
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Build a payload for a subset of source rows, keeping the payload->source index map. */
function payloadFor(g: GroupCtx, sourceIdxs: number[] | null) {
    const idxs = sourceIdxs ?? g.rows.map((_, i) => i);
    const subset = idxs.map(i => g.rows[i]);
    const p = buildRenderPayload(g.columns, subset, g.geo ?? undefined, g.point ?? undefined);
    // p.rows[k] corresponds to source row idxs[k]. __rowIdx__ inside the payload was
    // re-based to 0..n-1 by the builder — THIS map is what makes the indices comparable
    // across charts, and it is exactly what a hand-rolled integration forgets.
    return { payload: p, rowMap: idxs };
}

export function BicChart(props: BicChartProps) {
    const { code, renderFn, options, d3, geoKind, id, filteredBy, onSelect, className, style } = props;
    const ref = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<ChartHost | null>(null);
    const rowMapRef = useRef<number[] | null>(null);
    const group = useContext(Ctx);

    // Resolve this chart's payload: from the group (filtered + mapped) or the raw prop.
    // `filteredBy` narrows this to ONE partner when a page wants explicit one-way wiring;
    // omit it and the chart responds to whichever sibling published — mutual by default.
    const active = group ? group.selection : null;
    const filterSel = !group ? null
        : (filteredBy ? (active!.sourceId === filteredBy ? group.filterFor(id) : null)
                      : group.filterFor(id));
    const built = useMemo(() => {
        if (!group) return null;
        return payloadFor(group, filterSel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group, filterSel && filterSel.join(",")]);
    const data = built ? built.payload : props.data;
    rowMapRef.current = built ? built.rowMap : null;

    // Keep the newest callback without making it a rebuild trigger.
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;

    // BUILD/TEARDOWN — only when the code identity changes. useLayoutEffect so the chart
    // paints before the browser does, avoiding a flash of empty container.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || (!code && !renderFn) || !data) return;
        const host = createChartHost(el, { code, renderFn, data, options, d3, geoKind });
        hostRef.current = host;
        const off = host.selection.onChange((payloadIdxs, source) => {
            // "host" = a programmatic clear WE issued (below) to drop a stale highlight.
            // Publishing it would overwrite the selection another chart just made — the
            // feedback loop that makes mutual cross-filtering fight itself.
            if (source === "host") return;
            const map = rowMapRef.current;
            // Translate to SOURCE indices before anything leaves this chart.
            const sourceIdxs = map ? payloadIdxs.map(i => map[i]).filter(i => i !== undefined) : payloadIdxs;
            if (group && id) group.publish(id, sourceIdxs);
            onSelectRef.current?.(sourceIdxs);
        });
        host.render();
        return () => {
            // StrictMode double-mount and every unmount land here: stop the timer, drop the
            // listeners, clear the DOM. Skipping this is the animated-chart leak.
            off();
            host.destroy();
            hostRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code, renderFn, d3, geoKind]);

    // LIVE RESTYLE — options change without recompiling (colour scale, aggregation,
    // animMaxIdealFrames, maxMapPoints…). This is the whole point of setOptions.
    const optKey = useMemo(() => JSON.stringify(options ?? {}), [options]);
    useEffect(() => {
        if (hostRef.current && options) hostRef.current.setOptions(options);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [optKey]);

    // DATA change (including a cross-filter re-derive) — repaint, never recompile.
    useEffect(() => {
        if (hostRef.current && data) hostRef.current.setData(data);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    // Drop a STALE highlight: once the group's selection belongs to someone else (or was
    // cleared), this chart must stop showing its own marks as selected. Without it a
    // "Clear" button empties the filter while the origin chart stays visibly dimmed.
    useEffect(() => {
        const host = hostRef.current;
        if (!host || !group) return;
        const mine = group.selection.sourceId === id && group.selection.rows.length > 0;
        if (!mine && host.selection.current && host.selection.current.length) host.selection.clear();
    }, [group?.selection, id, group]);

    // No children: the chart owns this element's contents.
    return <div ref={ref} className={className} style={style} />;
}
