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
//   - new data keeps the selection, a key it no longer draws included (the chart says how many are hidden);
//   - every change says why: "click", "clear" (the chart's own clear gesture), "page" (code set
//     or cleared it), "data" (kept for compatibility; nothing in this package sends it any more).
//
// A SCOPE is the page's set of filters, for a chip bar and a clear-all. A filter works without
// one.
//
// bindFilter() is the chart side: it wires one chart host to one filter, so the React binding, a
// Blazor page over JS interop and a plain page apply the same rules.

import type { ChartHost } from "./host";
import type { Controls } from "./controls";
import type { FilterScopeFact } from "./contract";

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
    /** Its name in a saved view (scope.save / a link). Defaults to the key columns joined with "+". */
    key?: string;
    /**
     * LINKED HOVER: hovering a mark on a chart bound to this filter lights the marks with the same key on every other
     * chart bound to it (a glow, never a filter). Off by default.
     */
    hover?: boolean;
    /**
     * ONE PICK ACROSS SEVERAL PANELS. Filters with the same group name in one scope (one page) are one pick: a map, a
     * table and a scatter that each pick a country, each with its own filter so each panel's query can leave its own pick
     * out. A pick in one member clears the others, so the most recent pick is the page's one pick, and only the member
     * holding it is active: one chip, one scope line, and a side list over the members' keys names that pick alone.
     * Every member's chart shows the pick, so clicking the picked mark again in whichever panel shows it clears it.
     * The members share their key columns; a filter keyed differently stays out of the group (said once in the console).
     */
    group?: string;
}

export interface Filter {
    readonly id: string;
    /** Its name in a saved view. */
    readonly key: string;
    /** Whether linked hover is on (FilterOptions.hover). */
    readonly hoverEnabled: boolean;
    /** The key being hovered on a bound chart now, or null. */
    readonly hovered: FilterKey | null;
    /** Set or clear the hovered key (bound charts do this; a page may too). */
    setHover(key: FilterKey | null): void;
    /** Subscribe to hover changes. Returns the unsubscribe. */
    onHover(cb: (key: FilterKey | null) => void): () => void;
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
     * has it. `parts` names the key columns to say (a query that maps only some of them, see ScopedFilter): a display
     * column speaks for the key column it is, or for the key column in its place when there is one display column per
     * key column; a wildcard part says nothing. Absent, or naming every key column: the whole key.
     */
    textOf(key: FilterKey | unknown, rows?: readonly Record<string, unknown>[], parts?: readonly string[]): string;
    /** Why the last change happened (null before any). */
    readonly reason: FilterChangeReason | null;
    /** Bumped on every change: a cheap identity for memoising on the filter's state. */
    readonly version: number;

    /** Select these rows' keys (replacing the selection). An empty list clears. `keep` adds keys held already that these
     *  rows cannot name (keys another filter hid from the chart that made the selection): they stay selected. */
    selectRows(rows: readonly Record<string, unknown>[], reason?: FilterChangeReason, keep?: readonly FilterKey[]): void;
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
    /** Its group's name (FilterOptions.group), or null. */
    readonly group?: string | null;
    /**
     * The filter holding the pick this one shows: the group member a reader last picked in, or this filter itself when it
     * has no group; null while nothing is picked. A chart bound to a member paints this filter's keys.
     */
    readonly pick?: Filter | null;
    /** Subscribe to the pick changing: this filter's, or any member's of its group. Returns the unsubscribe. */
    onPick?(cb: () => void): () => void;
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
    /** Subscribe to any change of any filter or controls, and to either being added or removed. */
    onChange(cb: (scope: FilterScope) => void): () => void;
    /** A chart's controls, to be saved and restored with the page's view. Returns the remove. */
    addControls(key: string, controls: Controls): () => void;
    /** The registered controls, by key. */
    readonly controls: ReadonlyMap<string, Controls>;
    /** The page's view now: every filter's keys and every registered controls' values - JSON-safe. */
    save(): PageView;
    /** Put a saved view back: each filter set (or cleared when the view doesn't name it), each controls set. */
    restore(view: PageView | null | undefined): void;
}

/** A saved page view: what save() returns and restore() takes. */
export interface PageView {
    v: 1;
    filters?: Record<string, unknown[][]>;
    controls?: Record<string, Record<string, unknown>>;
}

/** A view as a URL-safe token (base64url of its JSON), for a link or a bookmark. */
export function viewToken(view: PageView): string {
    const bytes = new TextEncoder().encode(JSON.stringify(view));
    let bin = "";
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A token from viewToken back to a view; null when it isn't one. */
export function viewFromToken(token: string | null | undefined): PageView | null {
    if (!token) return null;
    try {
        const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((token.length + 3) % 4);
        const bin = atob(b64);
        const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
        const v = JSON.parse(new TextDecoder().decode(bytes));
        return v && v.v === 1 ? v as PageView : null;
    } catch {
        return null;
    }
}

// ── keys ────────────────────────────────────────────────────────────────────

/**
 * A KEY VALUE THAT MATCHES ANY VALUE. A label pick (an axis label naming a region on a chart of region by stage) selects on
 * the label's own field, so the filter's other key columns are left free: the key is (EMEA, ANY_VALUE), "EMEA in any
 * stage", and a stage that comes back once another filter clears is still in the pick. JSON-safe: a saved view's
 * `{ "__bicAny": true }` reads back as the same wildcard.
 */
export const ANY_VALUE: Readonly<{ __bicAny: true }> = Object.freeze({ __bicAny: true as const });

/** Whether a key value is the wildcard (ANY_VALUE, or its JSON round trip). */
export function isAnyValue(v: unknown): boolean {
    return !!v && typeof v === "object" && (v as { __bicAny?: unknown }).__bicAny === true;
}

/** One comparable string per key: a Date by its instant, the wildcard as itself, everything else by JSON. */
function keyString(values: readonly unknown[]): string {
    return JSON.stringify(values.map(v => (v instanceof Date ? `__date:${v.getTime()}` : isAnyValue(v) ? "__bic:any" : v === undefined ? null : v)));
}

/** Does a key match a row read on `columns` - position by position, a wildcard matching anything? */
function keyMatchesRow(key: FilterKey, row: Record<string, unknown>, columns: readonly string[]): boolean {
    return columns.every((c, i) => isAnyValue(key[i]) || keyString([key[i]]) === keyString([row?.[c]]));
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

// A GROUP'S MEMBERS, shared by every member (one Set per group per scope), and who follows each filter's pick. The scope
// links a member when it is added and unlinks it when removed; a filter outside a scope has no group to join.
const peersOf = new WeakMap<Filter, Set<Filter>>();
const pickSubsOf = new WeakMap<Filter, Set<() => void>>();
const firePick = (f: Filter) => {
    for (const m of Array.from(peersOf.get(f) ?? [f])) for (const cb of Array.from(pickSubsOf.get(m) ?? [])) cb();
};

/** Make a filter keyed by `columns` (one name, or several for a compound key such as a route). */
export function createFilter(columns: string | readonly string[], opts: FilterOptions = {}): Filter {
    const cols = (Array.isArray(columns) ? columns.slice() : [columns as string]) as string[];
    if (!cols.length || cols.some(c => typeof c !== "string" || !c)) {
        throw new Error("createFilter: name the key column(s), e.g. createFilter(\"RegionCode\")");
    }
    const display = opts.display == null ? cols : (Array.isArray(opts.display) ? opts.display.slice() : [opts.display as string]);
    let keys: FilterKey[] = [];
    let keySet = new Set<string>();
    let wildKeys: FilterKey[] = [];       // the keys a label pick left partly free, matched position by position
    let rows: Record<string, unknown>[] = [];
    let reason: FilterChangeReason | null = null;
    let version = 0;
    const subs = new Set<(f: Filter, r: FilterChangeReason) => void>();
    let hovered: FilterKey | null = null;
    const hoverSubs = new Set<(k: FilterKey | null) => void>();
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
        wildKeys = nextKeys.filter(k => k.some(isAnyValue));
        rows = nextRows;
        reason = why;
        version++;
        // ONE PICK PER GROUP: a pick here replaces the one a sibling held, before anyone hears of either.
        if (nextKeys.length) for (const p of Array.from(peersOf.get(filter) ?? [])) if (p !== filter && p.active) p.clear(why);
        for (const cb of Array.from(subs)) cb(filter, why);
        firePick(filter);
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
        const shown = (p: unknown) => p != null && p !== "" && !isAnyValue(p);
        const text = parts.filter(shown).map(String).join(" → ");
        return text || k.filter(shown).map(String).join(" → ");
    };
    // The named key parts only (textOf's `parts`).
    const partsOf = (k: FilterKey, more: readonly Record<string, unknown>[] | undefined, names: readonly string[]): string => {
        const s = keyString(k);
        const pos = cols.map((c, i) => (names.includes(c) && !isAnyValue(k[i]) ? i : -1)).filter(i => i >= 0);
        const row = (more ?? []).find(r => keyString(keyOfRow(r, cols)) === s) ?? seen.get(s);
        const speaksFor = (d: string, j: number) => (cols.includes(d) ? cols.indexOf(d) : display.length === cols.length ? j : -1);
        const shown = (p: unknown) => p != null && p !== "" && !isAnyValue(p);
        const text = row ? display.filter((d, j) => pos.includes(speaksFor(d, j))).map(d => row[d]).filter(shown).map(String).join(" → ") : "";
        return text || pos.map(i => k[i]).filter(shown).map(String).join(" → ");
    };
    let warnedKeep = false;

    const filter: Filter = {
        id: opts.id ?? `f${++nextId}`,
        key: opts.key ?? cols.join("+"),
        hoverEnabled: !!opts.hover,
        get hovered() { return hovered; },
        setHover(k) {
            const next = k && k.length ? k.slice(0, cols.length) : null;
            if ((next ? keyString(next) : null) === (hovered ? keyString(hovered) : null)) return;
            hovered = next;
            for (const cb of Array.from(hoverSubs)) cb(hovered);
        },
        onHover(cb) {
            hoverSubs.add(cb);
            return () => { hoverSubs.delete(cb); };
        },
        columns: cols,
        label: opts.label ?? cols.join(" / "),
        get active() { return keys.length > 0; },
        get keys() { return keys; },
        get rows() { return rows; },
        get row() { return rows[0] ?? null; },
        get value() { return keys.length ? keys[0][0] : null; },
        get values() { return keys.map(k => k[0]); },
        get text() { return keys.map(k => displayOf(k)).join(", "); },
        textOf(key, more, parts) {
            const k = (Array.isArray(key) ? key as FilterKey : [key]).slice(0, cols.length);
            return parts && cols.some(c => !parts.includes(c)) ? partsOf(k, more, parts) : displayOf(k, more);
        },
        get reason() { return reason; },
        get version() { return version; },
        selectRows(selected, why = "page", keep) {
            const list = (selected ?? []).filter(r => r && typeof r === "object") as Record<string, unknown>[];
            remember(list);
            const held = dedupe(toKeys(keep ?? [], cols.length));
            if (!held.length) { commit(dedupe(list.map(r => keyOfRow(r, cols))), list, why); return; }
            // The kept keys keep the rows already known for them, so their chips keep their names.
            const keepSet = new Set(held.map(keyString));
            const known = rows.filter(r => keepSet.has(keyString(keyOfRow(r, cols))));
            commit(dedupe(list.map(r => keyOfRow(r, cols)).concat(held)), list.concat(known), why);
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
            if (keySet.has(keyString(keyOfRow(row, where)))) return true;
            return wildKeys.some(k => keyMatchesRow(k, row, where));
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
        group: opts.group || null,
        get pick() {
            const peers = peersOf.get(filter);
            if (!peers) return keys.length ? filter : null;
            for (const p of peers) if (p.active) return p;
            return null;
        },
        onPick(cb) {
            pickSubs.add(cb);
            return () => { pickSubs.delete(cb); };
        },
    };
    const pickSubs = new Set<() => void>();
    pickSubsOf.set(filter, pickSubs);
    return filter;
}

/** Make a page's filter scope. */
export function createFilterScope(): FilterScope {
    const list: Filter[] = [];
    const offs = new Map<Filter, () => void>();
    const ctl = new Map<string, Controls>();
    const ctlOffs = new Map<string, () => void>();
    const subs = new Set<(s: FilterScope) => void>();
    const notify = () => { for (const cb of Array.from(subs)) cb(scope); };
    const groups = new Map<string, Set<Filter>>();
    const join = (f: Filter) => {
        const name = f.group;
        if (!name) return;
        const members = groups.get(name) ?? new Set<Filter>();
        const first = members.values().next().value as Filter | undefined;
        if (first && first.columns.join("\u0001") !== f.columns.join("\u0001")) {
            try { console.warn(`[chart-host] filter "${f.label}" is keyed by ${f.columns.join(", ")} but its group "${name}" by `
                + `${first.columns.join(", ")}, so it stays out of the group: give one pick's filters the same key columns.`); } catch { /* no console */ }
            return;
        }
        // Joining while a sibling holds the pick: the sibling's stays the one pick.
        if (f.active && [...members].some(m => m.active)) f.clear("page");
        members.add(f);
        groups.set(name, members);
        peersOf.set(f, members);
        firePick(f);
    };
    const leave = (f: Filter) => {
        const members = f.group ? groups.get(f.group) : undefined;
        if (!members?.has(f)) return;
        members.delete(f);
        peersOf.delete(f);
        if (!members.size) groups.delete(f.group!);
        firePick(f);
        const rest = members.values().next().value as Filter | undefined;
        if (rest) firePick(rest);
    };
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
                join(f);
                notify();
            }
            return () => {
                const off = offs.get(f);
                if (!off) return;
                off();
                offs.delete(f);
                const i = list.indexOf(f);
                if (i >= 0) list.splice(i, 1);
                leave(f);
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
        get controls() { return ctl; },
        addControls(key, c) {
            let k = key, n = 1;
            while (ctl.has(k) && ctl.get(k) !== c) k = `${key}-${++n}`;
            if (!ctl.has(k)) {
                ctl.set(k, c);
                ctlOffs.set(k, c.onChange(() => notify()));
                notify();
            }
            return () => {
                if (ctl.get(k) !== c) return;
                ctlOffs.get(k)?.();
                ctlOffs.delete(k);
                ctl.delete(k);
                notify();
            };
        },
        save() {
            const view: PageView = { v: 1 };
            for (const f of list) if (f.active) (view.filters ??= {})[f.key] = f.keys.map(k => k.slice());
            for (const [k, c] of ctl) {
                const values = c.values;
                if (Object.keys(values).length) (view.controls ??= {})[k] = { ...values };
            }
            return view;
        },
        restore(view) {
            if (!view || view.v !== 1) return;
            // A group saves only the member holding its pick, so the first member the view names takes it back (members
            // sharing one key would otherwise each take it in turn, and the last would hold it).
            const restored = new Set<string>();
            for (const f of list) {
                const keys = view.filters?.[f.key];
                const g = f.group && peersOf.get(f) ? f.group : null;
                if (g && restored.has(g)) continue;
                if (keys && keys.length) {
                    f.set(keys, "page");
                    if (g) restored.add(g);
                } else f.clear("page");
            }
            for (const [k, c] of ctl) {
                const values = view.controls?.[k];
                if (values) c.set(values);
            }
        },
    };
    return scope;
}

/**
 * A FILTER AS ONE PANEL'S QUERY TAKES IT, for filterScopeOf and BicChart's scopedBy. A query that maps only some of a
 * compound key's columns (treatAs(cell, "Accounts[Region]") on a Region x Stage pick) is narrowed by those parts alone,
 * so its scope line names only them: `{ filter: cell, takes: ["Region"] }` says "Europe", never "Europe → 3-Propose".
 */
export interface ScopedFilter {
    filter: Filter;
    /** The filter's key columns this panel's query maps (by name, as the filter is keyed). Absent: the whole key. */
    takes?: readonly string[];
    /** What the scope line calls it. Default: the filter's label, or the taken columns while the filter has no label of its own. */
    label?: string;
}

/** What filterScopeOf and scopedBy take: a filter whose whole key the query maps, or a ScopedFilter. */
export type ScopeSource = Filter | ScopedFilter;

/** The filter behind a scope source, or null. */
export function scopeFilterOf(src: ScopeSource | null | undefined): Filter | null {
    if (!src || typeof src !== "object") return null;
    if (Array.isArray((src as Filter).keys)) return src as Filter;
    const f = (src as ScopedFilter).filter;
    return f && typeof f === "object" ? f : null;
}

const warnedTakes = new Set<string>();

/**
 * THE PAGE FILTERS THAT NARROWED A CHART'S ROWS, as the fact the chart is told (RenderOptions.filterScope, contract
 * 1.23.0). For filters applied to the chart's QUERY, so its rows arrive already narrowed and it can't see the filter.
 * Only the active ones count. The field is each one's label (its key columns when it has none), joined ", "; the values
 * are what its chip shows for each key, in order, each once. Nothing active, nothing to say: undefined.
 *
 * A ScopedFilter whose `takes` leaves key columns out says only the taken parts, as treatAs maps them: a pick whose
 * taken parts are all wildcards keeps every row of that query, so while one is held the filter narrows nothing there.
 */
export function filterScopeOf(filters: ScopeSource | readonly ScopeSource[] | null | undefined): FilterScopeFact | undefined {
    const list = (Array.isArray(filters) ? filters : filters ? [filters] : []) as readonly ScopeSource[];
    const values: string[] = [];
    const fields: string[] = [];
    for (const src of list) {
        const f = scopeFilterOf(src);
        if (!f || !f.active) continue;
        const entry = src === f ? null : src as ScopedFilter;
        const takes = entry?.takes;
        for (const c of takes ?? []) {
            if (f.columns.includes(c) || warnedTakes.has(`${f.id}\u0001${c}`)) continue;
            warnedTakes.add(`${f.id}\u0001${c}`);
            try { console.warn(`[chart-host] scopedBy: filter "${f.label}" isn't keyed by ${c} (its key: ${f.columns.join(", ")}), `
                + `so its scope line can't take it - name the filter's own key columns in takes.`); } catch { /* no console */ }
        }
        const part = takes ? f.columns.filter(c => takes.includes(c)) : f.columns;
        const whole = part.length === f.columns.length;
        if (!whole) {
            const at = part.map(c => f.columns.indexOf(c));
            if (!at.length || f.keys.some(k => at.every(i => isAnyValue(k[i])))) continue;
        }
        let said = false;
        for (const k of f.keys) {
            const t = (whole ? f.textOf(k) : f.textOf(k, undefined, part)).trim();
            if (t) said = true;
            if (t && !values.includes(t)) values.push(t);
        }
        if (!whole && !said) continue;
        const label = entry?.label || (whole || f.label !== f.columns.join(" / ") ? f.label : part.join(" / "));
        if (label && !fields.includes(label)) fields.push(label);
    }
    if (!values.length) return undefined;
    return { field: fields.join(", "), values };
}

// ── the chart side ─────────────────────────────────────────────────────────────

export interface FilterBinding {
    /**
     * Call after the chart is handed new data. The selection is repainted where its keys are drawn now, and a key the new
     * rows do not carry stays selected (the chart is told how many through hostSelection.hidden): new data never clears it.
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
    /** The chart's container, for linked hover (FilterOptions.hover). Without it the chart takes no part in hover. */
    container?: HTMLElement | null;
}

/** The class a mark wears while its key is hovered on another chart bound to the same filter. */
export const LINKED_HOVER_CLASS = "bic-linked-hover";
let hoverStyled = false;
function ensureHoverStyle(doc: Document) {
    if (hoverStyled || !doc?.head) return;
    hoverStyled = true;
    const s = doc.createElement("style");
    s.setAttribute("data-bic", "linked-hover");
    // A glow, never a colour: a mark keeps its own fill and stroke, which carry the chart's encoding.
    s.textContent = `.${LINKED_HOVER_CLASS}{filter:drop-shadow(0 0 2px var(--bic-linked-hover,rgba(0,0,0,.65))) drop-shadow(0 0 1px var(--bic-linked-hover,rgba(0,0,0,.65)))}`;
    doc.head.appendChild(s);
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
    // THE PICK THIS CHART SHOWS: its filter's, or the group member's that holds the page's one pick (FilterOptions.group).
    const pickOf = (): Filter => filter.pick ?? filter;
    const wanted = (): number[] => {
        const src = pickOf();
        if (!src.active) return [];
        const out: number[] = [];
        const n = opts.rowCount();
        for (let i = 0; i < n; i++) {
            const r = opts.rowAt(i);
            if (r && src.has(r)) out.push(i);
        }
        return out;
    };

    // THE KEYS THIS CHART'S ROWS CANNOT SHOW (contract 1.21.0): selected keys no row of its current data carries, because
    // another filter narrowed the data. The filter goes on holding them, so the chart is told how many (a checkbox column
    // says "2 selected, 2 hidden"), and a selection the chart makes among the rows in view keeps them (keepHidden).
    const hiddenKeys = (): FilterKey[] => {
        const src = pickOf();
        if (!src.active) return [];
        const carried = new Set<string>();
        const n = opts.rowCount();
        for (let i = 0; i < n; i++) {
            const r = opts.rowAt(i);
            if (r) carried.add(keyString(keyOfRow(r, filter.columns)));
        }
        const anyRowMatches = (k: FilterKey) => {
            for (let i = 0; i < n; i++) { const r = opts.rowAt(i); if (r && keyMatchesRow(k, r, filter.columns)) return true; }
            return false;
        };
        return src.keys.filter(k => k.some(isAnyValue) ? !anyRowMatches(k) : !carried.has(keyString(k)));
    };

    const paint = () => {
        const want = wanted();
        const cur = host.selection.current ?? [];
        if (!sortedEq(want, cur)) {
            if (want.length) host.selection.highlight(want);
            else if (cur.length) host.selection.clear();
        }
        host.selection.setHidden?.(hiddenKeys().length);
    };

    const offHost = host.selection.onChange((idxs, source, meta) => {
        if (source === "host") return;
        const keep = meta?.keepHidden ? hiddenKeys() : [];
        if (!idxs.length && !keep.length) {
            // The chart's clear gesture clears the pick it shows, whichever group member holds it.
            const src = pickOf();
            if (src.active) src.clear("clear");
            return;
        }
        const rows = idxs.map(i => opts.rowAt(i)).filter((r): r is Record<string, unknown> => !!r);
        if (!rows.length && !keep.length) return;
        // A LABEL PICKS ITS OWN FIELD: the key columns its rows share and that tell this label from the chart's others;
        // the rest are left free. A label whose rows share every key column (or none) is an ordinary pick.
        const label = meta?.fromLabel && !keep.length ? labelKey(rows) : null;
        if (label) { filter.set([label], "click"); return; }
        // A GROUP MARK PICKS WHAT ITS ROWS SHARE: one mark over several rows (a region row over its stages) picks the key
        // columns they agree on and leaves the rest free, so a stage another filter hid at click time is still in the pick.
        // Rows that agree on every key column (or none) are an ordinary pick; a lasso or a Ctrl-click names every row's key.
        const group = meta?.fromMark && !keep.length ? sharedKey(rows) : null;
        if (group) { filter.set([group], "click"); return; }
        filter.selectRows(rows, "click", keep);
    });
    const sharedKey = (rows: Record<string, unknown>[]): FilterKey | null => {
        const key = filter.columns.map(c => {
            const v = rows[0][c];
            return rows.every(r => keyString([r[c]]) === keyString([v])) ? v : ANY_VALUE;
        });
        return key.some(isAnyValue) && !key.every(isAnyValue) ? key : null;
    };
    const labelKey = (rows: Record<string, unknown>[]): FilterKey | null => {
        const n = opts.rowCount();
        const key = filter.columns.map(c => {
            const v = rows[0][c];
            if (!rows.every(r => keyString([r[c]]) === keyString([v]))) return ANY_VALUE;
            for (let i = 0; i < n; i++) {                                   // shared by the label: does it tell labels apart?
                const r = opts.rowAt(i);
                if (r && keyString([r[c]]) !== keyString([v])) return v;
            }
            return ANY_VALUE;                                               // the same in every row of the chart: not its field
        });
        return key.some(isAnyValue) && !key.every(isAnyValue) ? key : null;
    };
    const offFilter = filter.onPick ? filter.onPick(() => paint()) : filter.onChange(() => paint());

    // LINKED HOVER: this chart's hovered mark sets the filter's hovered key; any hovered key lights this chart's marks.
    const el = opts.container ?? null;
    let offHoverDom = () => {};
    let offHover = () => {};
    if (filter.hoverEnabled && el) {
        ensureHoverStyle(el.ownerDocument);
        const markRow = (t: EventTarget | null): number | null => {
            const m = (t as Element | null)?.closest?.(".d3-mark[data-row-idx]");
            const v = m ? parseInt((m.getAttribute("data-row-idx") ?? "").split(",")[0], 10) : NaN;
            return Number.isFinite(v) ? v : null;
        };
        const over = (e: Event) => {
            const i = markRow(e.target);
            const r = i === null ? null : opts.rowAt(i);
            if (r) filter.setHover(keyOfRow(r, filter.columns));
        };
        const leave = () => filter.setHover(null);
        el.addEventListener("mouseover", over);
        el.addEventListener("mouseleave", leave);
        offHoverDom = () => { el.removeEventListener("mouseover", over); el.removeEventListener("mouseleave", leave); };
        const paintHover = (k: FilterKey | null) => {
            const want = k ? keyString(k) : null;
            el.querySelectorAll(".d3-mark[data-row-idx]").forEach(m => {
                const idx = parseInt((m.getAttribute("data-row-idx") ?? "").split(",")[0], 10);
                const r = Number.isFinite(idx) ? opts.rowAt(idx) : null;
                const on = !!want && !!r && keyString(keyOfRow(r, filter.columns)) === want;
                m.classList.toggle(LINKED_HOVER_CLASS, on);
            });
        };
        offHover = filter.onHover(paintHover);
    }

    return {
        // NEW DATA NEVER DROPS A SELECTION (contract 1.21.0). A key the new rows do not carry stays selected, whoever selected
        // it, as Power BI keeps a selected row a slicer hid: the page goes on filtering by it, the chip goes on naming it, and the
        // chart is told how many of its keys it cannot show (hostSelection.hidden) so it can say so and offer a clear. It used
        // to be cleared here (reason "data") when this chart had made it, which lost a reader's pick to someone else's filter.
        reconcile() {
            paint();
        },
        paint,
        detach() {
            offHost();
            offFilter();
            offHoverDom();
            offHover();
        },
    };
}

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
