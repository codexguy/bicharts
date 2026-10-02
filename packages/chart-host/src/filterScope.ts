// THE PAGE'S FILTERS, KEYED BY COLUMN VALUES, framework-free (2026-10-02).
//
// A data app's page does one thing with a chart click more than any other: it remembers WHAT was
// picked (a country, a route) and lets the rest of the page follow - another chart's rows, a
// query, a "Filtered to Japan - clear" button, a notes dialog. Left to the app, that wiring
// went wrong in every app an agent built (five of five, in different places): an empty selection
// ignored, so a second click never un-filtered; a page Clear that left the chart's marks lit; a
// re-query that dropped the chart's selection while the page still showed it.
//
// So the wiring lives here. A FILTER is one named thing a page can filter by, keyed by the values
// of one or more model columns - never by row positions, which renumber whenever a chart's rows
// change. Its rules:
//   - a click on a chart bound to it sets it; the same click again, or a click on empty canvas,
//     clears it (the chart's own toggle - nothing for the page to write);
//   - Ctrl/Cmd/Shift-click adds or removes one key;
//   - clear() from the page (a chip, a button) clears it AND the chart's marks;
//   - new data keeps a selection whose key is still drawn and clears one whose key is gone;
//   - every change says why: "click", "clear" (the chart's own clear gesture), "page" (code set
//     or cleared it), "data" (new data dropped its key) - the explicit clear a host can't miss.
//
// A SCOPE is the page's set of filters, for a chip bar and a clear-all. A filter works without
// one.
//
// bindFilter() is the chart side: it wires one chart host to one filter, so the React binding, a
// Blazor page over JS interop and a plain page apply the same rules.

import type { ChartHost } from "./host";

/** Why a filter changed. */
export type FilterChangeReason = "click" | "clear" | "page" | "data";

/** One selected key: a value per key column, in the filter's column order. */
export type FilterKey = readonly unknown[];

export interface FilterOptions {
    /** What a chip calls this filter ("Country"). Defaults to the key columns. */
    label?: string;
    /**
     * The column(s) a chip shows for a selected key, read from the selected rows ("Country" for a
     * RegionCode key; ["OriginName", "DestinationName"] for a route, joined " → ").
     * Defaults to the key columns.
     */
    display?: string | readonly string[];
    /** A stable id for this filter within its scope. Generated when absent. */
    id?: string;
}

export interface Filter {
    readonly id: string;
    /** The key column(s). */
    readonly columns: readonly string[];
    readonly label: string;
    /** True while anything is selected. */
    readonly active: boolean;
    /** The selected keys, each one value per key column. */
    readonly keys: readonly FilterKey[];
    /** The rows the selection was made from (for display names); rows of keys set by value are absent. */
    readonly rows: readonly Record<string, unknown>[];
    /** The first selected row, or null. */
    readonly row: Record<string, unknown> | null;
    /** The first key's first value, or null - the common one-column, one-pick case. */
    readonly value: unknown;
    /** Every selected key's first value. */
    readonly values: readonly unknown[];
    /** What a chip shows: the display column(s) of each selected key, "A → B" within a key, ", " between keys. */
    readonly text: string;
    /**
     * The display text for ANY key - a badge's, a key set by value - read from `rows` (a table carrying the display
     * columns, e.g. the chart's own rows) or else from the rows this filter has seen; the key's values when neither
     * has it.
     */
    textOf(key: FilterKey | unknown, rows?: readonly Record<string, unknown>[]): string;
    /** Why the last change happened (null before any). */
    readonly reason: FilterChangeReason | null;
    /** Bumped on every change: a cheap identity for memoising on the filter's state. */
    readonly version: number;

    /** Select these rows' keys (replacing the selection). An empty list clears. */
    selectRows(rows: readonly Record<string, unknown>[], reason?: FilterChangeReason): void;
    /** Select keys by value: one value per key (a one-column filter) or one array per key. */
    set(keys: readonly unknown[] | readonly FilterKey[] | unknown, reason?: FilterChangeReason): void;
    /** Clear the selection (and every bound chart's marks). */
    clear(reason?: FilterChangeReason): void;
    /** Does this row carry a selected key? Read on `columns` (default: the key columns). */
    has(row: Record<string, unknown>, columns?: readonly string[]): boolean;
    /**
     * The rows that carry a selected key - every row while nothing is selected. `columns` names
     * where this table keeps the key when it differs from the filter's: a one-column filter
     * matched against several columns keeps a row when ANY of them carries the key (a route
     * table filtered by a country keeps routes from OR to it). The same array comes back while
     * the input and the filter are unchanged, so it's safe to call during render.
     */
    keep<T extends Record<string, unknown>>(rows: readonly T[], columns?: readonly string[]): T[];
    /** Subscribe to changes. Returns the unsubscribe. */
    onChange(cb: (filter: Filter, reason: FilterChangeReason) => void): () => void;
}

/** A page's filters: what a chip bar lists and what clear-all clears. */
export interface FilterScope {
    readonly filters: readonly Filter[];
    /** The filters with something selected. */
    readonly active: readonly Filter[];
    /** Make a filter in this scope (see createFilter). */
    filter(columns: string | readonly string[], opts?: FilterOptions): Filter;
    /** Add an existing filter. Returns the remove. */
    add(filter: Filter): () => void;
    /** Clear every filter. */
    clearAll(reason?: FilterChangeReason): void;
    /** Subscribe to any change of any filter, and to filters being added or removed. */
    onChange(cb: (scope: FilterScope) => void): () => void;
}

// ── keys ────────────────────────────────────────────────────────────────────

/** One comparable string per key: a Date by its instant, everything else by JSON. */
function keyString(values: readonly unknown[]): string {
    return JSON.stringify(values.map(v => (v instanceof Date ? `__date:${v.getTime()}` : v === undefined ? null : v)));
}

function keyOfRow(row: Record<string, unknown>, columns: readonly string[]): FilterKey {
    return columns.map(c => row?.[c]);
}

/** Normalise what set() accepts to one array per key. */
function toKeys(input: unknown, width: number): FilterKey[] {
    if (input == null) return [];
    if (!Array.isArray(input)) return width === 1 ? [[input]] : [];
    if (input.length === 0) return [];
    if (width === 1) return input.map(v => (Array.isArray(v) ? [v[0]] : [v]));
    // Several key columns: an array of arrays, or ONE key given flat.
    if (input.every(v => Array.isArray(v))) return input.map(v => (v as unknown[]).slice(0, width));
    return input.length === width ? [input.slice()] : [];
}

let nextId = 0;

/** Make a filter keyed by `columns` (one name, or several for a compound key such as a route). */
export function createFilter(columns: string | readonly string[], opts: FilterOptions = {}): Filter {
    const cols = (Array.isArray(columns) ? columns.slice() : [columns as string]) as string[];
    if (!cols.length || cols.some(c => typeof c !== "string" || !c)) {
        throw new Error("createFilter: name the key column(s), e.g. createFilter(\"RegionCode\")");
    }
    const display = opts.display == null ? cols : (Array.isArray(opts.display) ? opts.display.slice() : [opts.display as string]);
    let keys: FilterKey[] = [];
    let keySet = new Set<string>();
    let rows: Record<string, unknown>[] = [];
    let reason: FilterChangeReason | null = null;
    let version = 0;
    const subs = new Set<(f: Filter, r: FilterChangeReason) => void>();
    // keep() memo: per input array, the last (version, columns) and its result.
    const kept = new WeakMap<readonly unknown[], { version: number; cols: string; out: any[] }>();

    const commit = (nextKeys: FilterKey[], nextRows: Record<string, unknown>[], why: FilterChangeReason) => {
        const nextSet = new Set(nextKeys.map(keyString));
        // A no-op (the same keys again, or clearing what's already clear) changes nothing and
        // notifies nobody - so a chart repainting what the filter already holds can't loop.
        if (nextSet.size === keySet.size && [...nextSet].every(k => keySet.has(k))) {
            if (nextRows.length) rows = nextRows;
            return;
        }
        keys = nextKeys;
        keySet = nextSet;
        rows = nextRows;
        reason = why;
        version++;
        for (const cb of Array.from(subs)) cb(filter, why);
    };

    const dedupe = (ks: FilterKey[]): FilterKey[] => {
        const seen = new Set<string>();
        return ks.filter(k => { const s = keyString(k); if (seen.has(s)) return false; seen.add(s); return true; });
    };

    // Display text for every row ever handed to the filter (a click, a selectRows), so a chip keeps its name.
    const seen = new Map<string, Record<string, unknown>>();
    const remember = (list: readonly Record<string, unknown>[]) => {
        for (const r of list) seen.set(keyString(keyOfRow(r, cols)), r);
    };
    const displayOf = (k: FilterKey, more?: readonly Record<string, unknown>[]): string => {
        const s = keyString(k);
        const row = (more ?? []).find(r => keyString(keyOfRow(r, cols)) === s) ?? seen.get(s);
        const parts = row ? display.map(d => row[d]) : k;
        const text = parts.filter(p => p != null && p !== "").map(String).join(" → ");
        return text || k.filter(p => p != null && p !== "").map(String).join(" → ");
    };
    let warnedKeep = false;

    const filter: Filter = {
        id: opts.id ?? `f${++nextId}`,
        columns: cols,
        label: opts.label ?? cols.join(" / "),
        get active() { return keys.length > 0; },
        get keys() { return keys; },
        get rows() { return rows; },
        get row() { return rows[0] ?? null; },
        get value() { return keys.length ? keys[0][0] : null; },
        get values() { return keys.map(k => k[0]); },
        get text() { return keys.map(k => displayOf(k)).join(", "); },
        textOf(key, more) {
            const k = Array.isArray(key) ? key as FilterKey : [key];
            return displayOf(k.slice(0, cols.length), more);
        },
        get reason() { return reason; },
        get version() { return version; },
        selectRows(selected, why = "page") {
            const list = (selected ?? []).filter(r => r && typeof r === "object") as Record<string, unknown>[];
            remember(list);
            commit(dedupe(list.map(r => keyOfRow(r, cols))), list, why);
        },
        set(input, why = "page") {
            const ks = dedupe(toKeys(input, cols.length));
            // Keep the rows we already know for keys that stay, so the chip keeps its name.
            const want = new Set(ks.map(keyString));
            commit(ks, rows.filter(r => want.has(keyString(keyOfRow(r, cols)))), why);
        },
        clear(why = "page") { commit([], [], why); },
        has(row, on) {
            if (!keys.length || !row) return false;
            const where = on && on.length ? on : cols;
            if (cols.length === 1 && where.length > 1) {
                // A one-column key read across several columns: any of them carrying it counts.
                return where.some(c => keySet.has(keyString([row[c]])));
            }
            return keySet.has(keyString(keyOfRow(row, where)));
        },
        keep(input, on) {
            const list = input ?? [];
            const colKey = (on ?? cols).join("\u0001");
            const hit = kept.get(list);
            if (hit && hit.version === version && hit.cols === colKey) return hit.out;
            const where = on && on.length ? on : cols;
            // A table that doesn't carry the key column can't be filtered by it: every row would drop, silently. Say
            // so once - query it with filterQuery instead, or add the key to its query.
            if (keys.length && list.length && !warnedKeep && !list.some(r => r && where.some(c => c in r))) {
                warnedKeep = true;
                try { console.warn(`[chart-host] filter "${filter.label}": these rows have no ${where.join(" / ")} column, `
                    + `so keep() drops them all - filter their query (filterQuery + treatAs) or add the key column.`); } catch { /* no console */ }
            }
            const out = keys.length ? list.filter(r => filter.has(r, on)) : list.slice();
            kept.set(list, { version, cols: colKey, out });
            return out;
        },
        onChange(cb) {
            subs.add(cb);
            return () => { subs.delete(cb); };
        },
    };
    return filter;
}

/** Make a page's filter scope. */
export function createFilterScope(): FilterScope {
    const list: Filter[] = [];
    const offs = new Map<Filter, () => void>();
    const subs = new Set<(s: FilterScope) => void>();
    const notify = () => { for (const cb of Array.from(subs)) cb(scope); };
    const scope: FilterScope = {
        get filters() { return list.slice(); },
        get active() { return list.filter(f => f.active); },
        filter(columns, opts) {
            const f = createFilter(columns, opts);
            scope.add(f);
            return f;
        },
        add(f) {
            if (!offs.has(f)) {
                list.push(f);
                offs.set(f, f.onChange(() => notify()));
                notify();
            }
            return () => {
                const off = offs.get(f);
                if (!off) return;
                off();
                offs.delete(f);
                const i = list.indexOf(f);
                if (i >= 0) list.splice(i, 1);
                notify();
            };
        },
        clearAll(why = "page") {
            for (const f of list.slice()) f.clear(why);
        },
        onChange(cb) {
            subs.add(cb);
            return () => { subs.delete(cb); };
        },
    };
    return scope;
}

// ── the chart side ─────────────────────────────────────────────────────────────

export interface FilterBinding {
    /**
     * Call after the chart is handed new data. A selection whose key is still drawn is repainted;
     * one whose key is gone is cleared (reason "data") when this chart made it. An empty payload is
     * treated as data still arriving, not as the key being gone.
     */
    reconcile(): void;
    /** Repaint the filter's selection onto the chart's marks. */
    paint(): void;
    /** Unwire. The filter keeps its selection. */
    detach(): void;
}

export interface BindFilterOptions {
    /** The source row (keyed by column name) behind payload row `i`, or null. */
    rowAt(i: number): Record<string, unknown> | null;
    /** How many rows the chart is drawing now. */
    rowCount(): number;
}

/** The source row behind each payload row, from a payload of { columns, rows: unknown[][] }. */
export function payloadRowReader(getPayload: () => { columns: readonly { name: string }[]; rows: readonly unknown[][] } | null | undefined): BindFilterOptions {
    return {
        rowAt(i) {
            const p = getPayload();
            const r = p?.rows?.[i];
            if (!p || !r) return null;
            const o: Record<string, unknown> = {};
            p.columns.forEach((c, k) => { o[c.name] = r[k]; });
            return o;
        },
        rowCount() { return getPayload()?.rows?.length ?? 0; },
    };
}

const sortedEq = (a: readonly number[], b: readonly number[]) => {
    if (a.length !== b.length) return false;
    const x = a.slice().sort((p, q) => p - q), y = b.slice().sort((p, q) => p - q);
    return x.every((v, i) => v === y[i]);
};

/**
 * Wire one chart host to one filter. A click on the chart sets the filter (reason "click"), the
 * chart's own clear gesture clears it (reason "clear"), and any change to the filter - from this
 * chart, another chart, or the page - is painted onto this chart's marks. Paints notify the host's
 * subscribers with source "host", which this binding (and a chart group) never republishes.
 */
export function bindFilter(host: ChartHost, filter: Filter, opts: BindFilterOptions): FilterBinding {
    // WHO MADE THE SELECTION. Only a selection made by a click on the chart bound to the filter is
    // that chart's to drop when its data no longer draws it; one the page set (a restored link, a
    // button) stays. Kept per filter rather than per binding so it survives a remount: a chart
    // that unmounts while its query reloads comes back as a new binding, adopts the selection it
    // made, and drops it if the new rows don't carry it.
    const token = {};
    const ownerKeys = () => keysString(filter.keys);
    const isMine = () => { const o = owners.get(filter); return !!o && o.token === token && o.keys === ownerKeys(); };
    {
        const o = owners.get(filter);
        if (o && o.orphan && o.keys === ownerKeys()) owners.set(filter, { token, keys: o.keys, orphan: false });
    }

    const wanted = (): number[] => {
        if (!filter.active) return [];
        const out: number[] = [];
        const n = opts.rowCount();
        for (let i = 0; i < n; i++) {
            const r = opts.rowAt(i);
            if (r && filter.has(r)) out.push(i);
        }
        return out;
    };

    const paint = () => {
        const want = wanted();
        const cur = host.selection.current ?? [];
        if (sortedEq(want, cur)) return;
        if (want.length) host.selection.highlight(want);
        else if (cur.length) host.selection.clear();
    };

    const offHost = host.selection.onChange((idxs, source) => {
        if (source === "host") return;
        if (!idxs.length) {
            if (filter.active) filter.clear("clear");
            return;
        }
        const rows = idxs.map(i => opts.rowAt(i)).filter((r): r is Record<string, unknown> => !!r);
        if (!rows.length) return;
        filter.selectRows(rows, "click");
        owners.set(filter, { token, keys: ownerKeys(), orphan: false });
    });
    const offFilter = filter.onChange(() => {
        // Another hand moved the filter: the selection is no longer the one a click here made.
        const o = owners.get(filter);
        if (o && o.keys !== ownerKeys()) owners.delete(filter);
        paint();
    });

    return {
        reconcile() {
            if (filter.active && opts.rowCount() > 0 && isMine()) {
                const drawn = new Set<string>();
                const n = opts.rowCount();
                for (let i = 0; i < n; i++) {
                    const r = opts.rowAt(i);
                    if (r) drawn.add(keyString(keyOfRow(r, filter.columns)));
                }
                const keep = filter.keys.filter(k => drawn.has(keyString(k)));
                if (keep.length !== filter.keys.length) {
                    filter.set(keep, "data");
                    return;                          // the filter's own change repaints
                }
            }
            paint();
        },
        paint,
        detach() {
            offHost();
            offFilter();
            const o = owners.get(filter);
            if (o && o.token === token) owners.set(filter, { ...o, orphan: true });
        },
    };
}

/** Per filter: the binding whose click made the current selection, and that selection's keys. */
const owners = new WeakMap<Filter, { token: object; keys: string; orphan: boolean }>();
const keysString = (keys: readonly FilterKey[]) => keys.map(k => keyString(k)).sort().join("|");

// ── Microsoft's visuals ─────────────────────────────────────────────────────────

/** The interaction events @microsoft/fabric-visuals' VegaVisual and DataGrid emit (onInteraction). */
export interface VegaInteractionEvent {
    action: string;
    selections?: Array<{ predicates?: Array<{ type?: string; name?: string; values?: unknown[] }> }>;
}

/**
 * Apply a VegaVisual / DataGrid `onInteraction` event list to a filter, so Microsoft's charts take
 * part in the same page filters as ours: `onInteraction={e => fromVegaInteraction(country, e)}`.
 * A `select` sets the filter from the set predicates that name its key columns (a selection
 * missing one of them is skipped); a `clear` clears it. Returns whether the filter changed.
 */
export function fromVegaInteraction(filter: Filter, events: readonly VegaInteractionEvent[] | null | undefined): boolean {
    const before = filter.version;
    for (const ev of events ?? []) {
        if (ev?.action === "clear") { filter.clear("clear"); continue; }
        if (ev?.action !== "select") continue;
        const keys: unknown[][] = [];
        for (const sel of ev.selections ?? []) {
            const preds = sel?.predicates ?? [];
            const key = filter.columns.map(c => {
                const p = preds.find(q => q?.name === c && (q.type === undefined || q.type === "set"));
                return p && p.values && p.values.length ? p.values[0] : undefined;
            });
            if (key.every(v => v !== undefined)) keys.push(key);
        }
        if (keys.length) filter.set(keys, "click");
    }
    return filter.version !== before;
}
