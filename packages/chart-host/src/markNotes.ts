// READERS' NOTES -> BADGES ON MARKS (2026-10-02).
//
// An app that lets readers leave a note on a country or a route stores each note with the mark's
// KEY (a country code; a route's two ends) and shows a badge on that mark. Every agent-built app
// wrote this mapping by hand from the guide, and parsed its own badge ids back apart ("AUS|CHL"
// split on "|") to find which mark a clicked badge meant. It's the same few lines for every app,
// so it lives here, keyed the way the page filters are: by column values, never row positions.
//
// The defaults read the notes entity setup_fabric_app writes (chart, markKey, markKeyTo, body);
// `keyOf` / `textOf` adapt any other shape.

import type { MarkAnnotation } from "./annotations";
import type { Filter, FilterKey } from "./filterScope";

export interface MarkNoteLike {
    chart?: string | null;
    markKey?: unknown;
    markKeyTo?: unknown;
    body?: string | null;
}

export interface NoteBadgeOptions<N> {
    /** The chart's key column(s) the note keys live in: "CountryCode", or a route's two ends. */
    columns: string | readonly string[];
    /** Only notes whose `chart` is this (one notes table serving several charts). */
    chart?: string;
    /** A note's key, one value per column. Default: [markKey] or [markKey, markKeyTo]. */
    keyOf?: (note: N) => readonly unknown[];
    /** A note's text. Default: body. */
    textOf?: (note: N) => string;
}

const keyText = (k: readonly unknown[]) => JSON.stringify(k.map(v => (v == null ? "" : String(v).trim())));

/** The default key: markKey, plus markKeyTo for a route. */
function defaultKey(n: MarkNoteLike, width: number): unknown[] {
    return width > 1 ? [n.markKey, n.markKeyTo] : [n.markKey];
}

/**
 * One badge per noted mark: the count of its notes, the latest note as the tooltip (notes are
 * taken in the order given - pass them newest first). Pass to a chart's `annotations`.
 */
export function noteBadges<N extends MarkNoteLike>(notes: readonly N[] | null | undefined,
                                                   opts: NoteBadgeOptions<N>): MarkAnnotation[] {
    const cols = typeof opts.columns === "string" ? [opts.columns] : opts.columns.slice();
    const keyOf = opts.keyOf ?? ((n: N) => defaultKey(n, cols.length));
    const textOf = opts.textOf ?? ((n: N) => String(n.body ?? ""));
    const byKey = new Map<string, { key: readonly unknown[]; list: N[] }>();
    for (const n of notes ?? []) {
        if (opts.chart !== undefined && n.chart !== opts.chart) continue;
        const key = keyOf(n).slice(0, cols.length);
        if (key.length < cols.length || key.some(v => v == null || v === "")) continue;
        const id = keyText(key);
        const hit = byKey.get(id);
        if (hit) hit.list.push(n);
        else byKey.set(id, { key, list: [n] });
    }
    return [...byKey.entries()].map(([id, { key, list }]) => {
        const title = list.length > 1 ? `${textOf(list[0])} (+${list.length - 1} more)` : textOf(list[0]);
        const base = { id, label: String(list.length), title };
        if (cols.length === 1) return { ...base, column: cols[0], value: key[0] as string | number };
        const where: Record<string, string | number> = {};
        cols.forEach((c, i) => { where[c] = key[i] as string | number; });
        return { ...base, where };
    });
}

/** The key values of a badge noteBadges made (for a click: which mark's notes to open). */
export function badgeKey(a: MarkAnnotation): FilterKey {
    try {
        const v = JSON.parse(String(a.id ?? ""));
        if (Array.isArray(v)) return v;
    } catch { /* not one of ours */ }
    if (a.where) return Object.values(a.where);
    return a.value !== undefined ? [a.value] : [];
}

/**
 * The notes on one mark - a key given directly, or the first key selected in a page filter - in
 * the order given. Keys compare as trimmed text, so a numeric code and its string agree.
 */
export function notesFor<N extends MarkNoteLike>(notes: readonly N[] | null | undefined,
                                                  key: Filter | FilterKey | null | undefined,
                                                  opts: Omit<NoteBadgeOptions<N>, "textOf">): N[] {
    const cols = typeof opts.columns === "string" ? [opts.columns] : opts.columns.slice();
    const want = !key ? null : Array.isArray(key) ? key : (key as Filter).keys[0] ?? null;
    if (!want) return [];
    const keyOf = opts.keyOf ?? ((n: N) => defaultKey(n, cols.length));
    const target = keyText((want as readonly unknown[]).slice(0, cols.length));
    return (notes ?? []).filter(n => (opts.chart === undefined || n.chart === opts.chart)
        && keyText(keyOf(n).slice(0, cols.length)) === target);
}
