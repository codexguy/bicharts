// THE CROSS-FILTER GROUP, framework-free (2026-09-24).
//
// Several charts drawn from ONE source table, coordinated by ONE selection. This is the logic
// the React binding's <BicChartGroup> always carried, lifted out so that a host with no React -
// a plain page, a Blazor app over JS interop, a web component - coordinates charts by the same
// rules instead of writing them again. The React binding is now a thin wrapper over this.
//
// THE ROW-INDEX HAZARD is the reason this exists at all. A chart's row indices are positions
// WITHIN THE PAYLOAD IT RECEIVED. Filter the rows for chart B and its payload renumbers from
// zero, so the same integers now denote different records, and comparing them across charts
// does not throw - it quietly selects the wrong thing. The group owns the source table, builds
// every member's payload from it, keeps each payload-row -> source-row map, and speaks only
// SOURCE row indices to the outside.
//
// The rules, each one load-bearing:
//   - ONE active selection, tagged with the member that made it.
//   - Every OTHER member responds to it; the member that made it never filters itself, so the
//     gesture stays reversible - there is always something left to click.
//   - `filteredBy` wires a member to ONE partner instead of to whichever sibling published.
//   - `respondsWith: "highlight"` keeps the member's full payload and paints the selection onto
//     its marks instead of filtering (a map that keeps its geography).
//   - A selection painted from OUTSIDE (source "host") is never republished, which is what
//     stops two linked charts fighting over the selection.

import type { ChartHost } from "./host";
import { buildRenderPayload, type GeoPointBinding, type RenderPayload } from "./payload";

/** The group's one active selection, in SOURCE row indices. `sourceId` is the member that made it. */
export interface ChartGroupSelection {
    readonly sourceId: string | null;
    readonly rows: readonly number[];
}

/** The table every member's payload is derived from, and the geo bindings applied to each. */
export interface ChartGroupSourceOptions {
    /** Choropleth join binding, applied when building each member's payload. */
    geo?: { column: string; kind: string } | null;
    /** Point-map geocoding binding (city/state/zip/lat/lon column names). */
    point?: GeoPointBinding | null;
}

/** How one member takes part in the group. */
export interface ChartGroupMemberOptions {
    /** Respond only to this member's selection (one-way wiring). Absent: respond to any sibling. */
    filteredBy?: string;
    /** "filter" (default) re-derives the member's payload; "highlight" keeps it and paints. */
    respondsWith?: "filter" | "highlight";
}

/** A member's payload and the map from each payload row to its source row. */
export interface ChartGroupPayload {
    payload: RenderPayload;
    /** `rowMap[k]` is the source row index of payload row `k`. */
    rowMap: number[];
}

/** Why the group notified: a member's selection, a clear, or a new source table. */
export type ChartGroupChange = "select" | "clear" | "source";

/** A live chart wired into the group by `attach`. */
export interface ChartGroupMember {
    /** The payload-row -> source-row map of the payload the member is drawing now. */
    readonly rowMap: readonly number[];
    /** Unwire the member: its clicks stop publishing and the group stops redrawing it. */
    detach(): void;
}

export interface ChartGroup {
    /** The active selection. A new object on every publish and clear; kept across a new source. */
    readonly selection: ChartGroupSelection;
    readonly columns: readonly any[];
    readonly rows: readonly Record<string, any>[];
    /**
     * The source rows member `id` should be FILTERED to now, or null for all of them. Never the
     * member's own selection. With `filteredBy`, only that partner's selection counts.
     */
    incomingFor(id: string | undefined, filteredBy?: string): number[] | null;
    /** A payload for a subset of source rows (null = every row), with its row map. */
    payloadFor(sourceRowIdxs: readonly number[] | null): ChartGroupPayload;
    /** The payload member `id` should draw now, under the given options. */
    memberPayload(id: string | undefined, opts?: ChartGroupMemberOptions): ChartGroupPayload;
    /** Publish member `id`'s selection in SOURCE rows. An empty list clears the selection. */
    publish(id: string, sourceRowIdxs: readonly number[]): void;
    /** Clear the group's selection. */
    clear(): void;
    /** Replace the source table (and bindings). The selection is kept, as source indices. */
    setSource(columns: readonly any[], rows: readonly Record<string, any>[], opts?: ChartGroupSourceOptions): void;
    /** Subscribe to every change. Returns the unsubscribe. */
    onChange(cb: (selection: ChartGroupSelection, change: ChartGroupChange) => void): () => void;
    /**
     * Wire a live chart host into the group as member `id` (undefined: a member that responds but
     * never publishes). Create the host with `memberPayload(id, opts).payload` as its data. From
     * then on its clicks publish SOURCE rows (and reach `onSelect`), and every group change hands
     * it a re-derived payload and paints or clears the selection it should show.
     */
    attach(id: string | undefined, host: ChartHost,
           opts?: ChartGroupMemberOptions & { onSelect?: (sourceRowIdxs: number[]) => void }): ChartGroupMember;
    /** Detach every member and drop every subscriber. */
    destroy(): void;
}

const EMPTY: ChartGroupSelection = Object.freeze({ sourceId: null, rows: Object.freeze([]) as readonly number[] });

/** Payload row indices -> source row indices, dropping any the map does not cover. */
export function toSourceRows(rowMap: readonly number[] | null | undefined, payloadRowIdxs: readonly number[]): number[] {
    if (!rowMap) return payloadRowIdxs.slice();
    return payloadRowIdxs.map(i => rowMap[i]).filter((i): i is number => i !== undefined);
}

/** Source row indices -> this payload's row indices, dropping any the payload does not carry. */
function toPayloadRows(rowMap: readonly number[], sourceRowIdxs: readonly number[]): number[] {
    const at = new Map<number, number>();
    rowMap.forEach((src, k) => { if (!at.has(src)) at.set(src, k); });
    return sourceRowIdxs.map(s => at.get(s)).filter((k): k is number => k !== undefined);
}

const sameRows = (a: readonly number[], b: readonly number[]): boolean => {
    if (a.length !== b.length) return false;
    const x = a.slice().sort((p, q) => p - q), y = b.slice().sort((p, q) => p - q);
    return x.every((v, i) => v === y[i]);
};

/**
 * Make a member's painted selection agree with the group's. A highlight member with an incoming
 * selection paints it. Any other member that still shows a selection clears it - a stale
 * highlight left on the origin after the selection moved elsewhere, or after a clear.
 *
 * THE MEMBER THAT MADE THE SELECTION keeps it, repainted in the payload it draws NOW when
 * `rowMap` (that payload's row map) is given. Its host holds the selection as PAYLOAD rows, and
 * a member that was filtered when it was clicked stops filtering the moment it becomes the
 * origin - its payload grows back to the whole table and renumbers, so the payload rows its
 * host holds would name different records. The group's selection is in source rows, so it is
 * translated through the new map and repainted when it differs.
 *
 * Every path notifies with source "host", so nothing done here is republished.
 */
export function syncMemberSelection(host: ChartHost, selection: ChartGroupSelection, id: string | undefined,
                                    highlight: boolean, incoming: readonly number[] | null,
                                    rowMap?: readonly number[] | null): void {
    const mine = selection.sourceId === id && selection.rows.length > 0;
    if (mine) {
        if (rowMap) {
            const want = toPayloadRows(rowMap, selection.rows);
            if (!sameRows(want, host.selection.current ?? [])) host.selection.highlight(want);
        }
        return;
    }
    if (highlight && incoming && incoming.length) {
        // Group members share one row space (each is handed the same source rows), so the
        // sibling's source indices ARE this member's payload indices - which holds only while a
        // highlight member keeps the unfiltered payload, and it always does.
        host.selection.highlight(incoming.slice());
        return;
    }
    if (host.selection.current && host.selection.current.length) host.selection.clear();
}

/**
 * Create a cross-filter group over one source table: `rows` are objects keyed by column name,
 * `columns` the column descriptors (`ingest()` returns both).
 */
export function createChartGroup(columns: readonly any[], rows: readonly Record<string, any>[],
                                 opts: ChartGroupSourceOptions = {}): ChartGroup {
    let cols = columns;
    let table = rows;
    let geo = opts.geo ?? null;
    let point = opts.point ?? null;
    let selection: ChartGroupSelection = EMPTY;
    const subs = new Set<(s: ChartGroupSelection, c: ChartGroupChange) => void>();
    const members = new Set<ChartGroupMember>();

    const notify = (change: ChartGroupChange) => {
        for (const cb of Array.from(subs)) cb(selection, change);
    };

    const incomingFor = (id: string | undefined, filteredBy?: string): number[] | null => {
        const s = selection;
        const forId = (s.rows.length && s.sourceId && s.sourceId !== id) ? s.rows.slice() : null;
        if (filteredBy) return s.sourceId === filteredBy ? forId : null;
        return forId;
    };

    const payloadFor = (sourceRowIdxs: readonly number[] | null): ChartGroupPayload => {
        const idxs = sourceRowIdxs ? sourceRowIdxs.slice() : table.map((_, i) => i);
        const subset = idxs.map(i => table[i]);
        // p.rows[k] corresponds to source row idxs[k]. __rowIdx__ inside the payload is re-based
        // to 0..n-1 by the builder - this map is what makes indices comparable across charts.
        const payload = buildRenderPayload(cols as any, subset as any, geo ?? undefined, point ?? undefined);
        return { payload, rowMap: idxs };
    };

    const memberPayload = (id: string | undefined, o: ChartGroupMemberOptions = {}): ChartGroupPayload =>
        payloadFor(o.respondsWith === "highlight" ? null : incomingFor(id, o.filteredBy));

    const group: ChartGroup = {
        get selection() { return selection; },
        get columns() { return cols; },
        get rows() { return table; },
        incomingFor,
        payloadFor,
        memberPayload,
        publish(id, sourceRowIdxs) {
            selection = sourceRowIdxs.length ? { sourceId: id, rows: sourceRowIdxs.slice() } : { sourceId: null, rows: [] };
            notify(sourceRowIdxs.length ? "select" : "clear");
        },
        clear() {
            selection = { sourceId: null, rows: [] };
            notify("clear");
        },
        setSource(nextColumns, nextRows, o = {}) {
            cols = nextColumns;
            table = nextRows;
            geo = o.geo ?? null;
            point = o.point ?? null;
            notify("source");
        },
        onChange(cb) {
            subs.add(cb);
            return () => { subs.delete(cb); };
        },
        attach(id, host, o = {}) {
            const highlight = o.respondsWith === "highlight";
            let rowMap = memberPayload(id, o).rowMap;
            const offHost = host.selection.onChange((payloadIdxs, source) => {
                // "host" = a paint or clear the group itself issued; publishing it back would
                // overwrite the selection a sibling just made.
                if (source === "host") return;
                const sourceIdxs = toSourceRows(rowMap, payloadIdxs);
                if (id) group.publish(id, sourceIdxs);
                o.onSelect?.(sourceIdxs);
            });
            const offGroup = group.onChange(sel => {
                const incoming = incomingFor(id, o.filteredBy);
                const next = payloadFor(highlight ? null : incoming);
                rowMap = next.rowMap;
                host.setData(next.payload);
                syncMemberSelection(host, sel, id, highlight, incoming, rowMap);
            });
            const member: ChartGroupMember = {
                get rowMap() { return rowMap; },
                detach() {
                    offHost();
                    offGroup();
                    members.delete(member);
                },
            };
            members.add(member);
            return member;
        },
        destroy() {
            for (const m of Array.from(members)) m.detach();
            subs.clear();
        },
    };
    return group;
}
