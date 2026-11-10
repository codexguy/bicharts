// THE COLUMNS A CHART WAS GENERATED ON, KEPT WITH THE CHART.
//
// A host that redraws saved chart code can only compare the columns bound now with the columns bound a moment ago. Two
// questions need the columns the code was WRITTEN for instead: "is this missing name the same field under the name another
// language gave it?" (the host renames an automatic aggregation per viewer) and "was this removed field ever part of the
// chart?" (a field added after generation and removed again was not). A host stores this beside the saved code and reads it
// back with it. A chart saved without it answers "unknown" to both, and the host behaves as it did before.

/** One bound column as the host delivered it when the generate was asked. */
export interface GenerationColumn {
    /** The host's display name. */
    n: string;
    /** The host's query name, "" when the host has none. */
    q: string;
}

export interface GenerationColumns {
    v: 1;
    /** The host's locale tag when the generate was asked, "" when unknown. */
    l: string;
    c: GenerationColumn[];
}

/** A stored value longer than this is not written: the chart then behaves as one saved without the structure. */
export const GENERATION_COLUMNS_MAX_CHARS = 16000;

/** The text a host stores. "" when there is nothing to store or the text would pass the cap. */
export function serializeGenerationColumns(cols: ReadonlyArray<{ n: unknown; q?: unknown }> | null | undefined,
                                           locale: string | null | undefined): string {
    // A real array only: test doubles and half-built contexts hand over other things, and those store nothing.
    if (!Array.isArray(cols)) return "";
    const c: GenerationColumn[] = [];
    for (const col of cols) {
        const n = typeof col?.n === "string" ? col.n : "";
        if (n === "") continue;
        c.push({ n, q: typeof col?.q === "string" ? col.q : "" });
    }
    if (c.length === 0) return "";
    const text = JSON.stringify({ v: 1, l: typeof locale === "string" ? locale : "", c });
    return text.length > GENERATION_COLUMNS_MAX_CHARS ? "" : text;
}

/** Read a stored value back. Anything unusable reads as null (unknown), never as an empty list. */
export function parseGenerationColumns(raw: unknown): GenerationColumns | null {
    if (typeof raw !== "string" || raw === "" || raw.length > GENERATION_COLUMNS_MAX_CHARS) return null;
    let o: any;
    try { o = JSON.parse(raw); } catch { return null; }
    if (!o || o.v !== 1 || !Array.isArray(o.c)) return null;
    const c: GenerationColumn[] = [];
    for (const e of o.c) {
        if (!e || typeof e.n !== "string" || e.n === "") return null;
        c.push({ n: e.n, q: typeof e.q === "string" ? e.q : "" });
    }
    return c.length === 0 ? null : { v: 1, l: typeof o.l === "string" ? o.l : "", c };
}

/**
 * May the stored names stand in for live ones in this session? Only when the session's locale differs from the generation's.
 * In the same locale the host composes the same names, so a stored name that is missing now was renamed or re-aggregated by
 * the reader - a real field change. An unknown locale on either side allows it.
 */
export function generationColumnsAnswerInLocale(gen: GenerationColumns | null | undefined, liveLocale: string | null | undefined): boolean {
    if (!gen) return false;
    const a = gen.l.trim().toLowerCase();
    const b = String(liveLocale ?? "").trim().toLowerCase();
    return a === "" || b === "" || a !== b;
}

/**
 * Of the names that went away, the ones the chart was never generated on. Empty when the generation's columns are unknown:
 * the host then says what it said before.
 */
export function columnsNeverGeneratedOn(goneNames: readonly string[], gen: GenerationColumns | null | undefined): string[] {
    if (!gen || gen.c.length === 0) return [];
    const written = new Set(gen.c.map(c => c.n));
    return goneNames.filter(n => !written.has(n));
}
