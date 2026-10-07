// THE WHAT-FITS ANSWER AS A TABLE. One typed row per chart type, so a client that offers choices lays out rank, name,
// preview and verdict instead of bare names, and the MCP, the React demo and the hosts read one shape. The selection
// weight is never a field here: a printed "61.9" read as a quality score, and rank plus verdict carry the ordering.

/** What a what-fits row must carry to become a table row (the shape-core parse result satisfies it). */
export interface QualifyTableSource {
    name: string;
    description?: string | null;
    rank?: number | null;
    language?: string | null;
    renderer?: string | null;
    recommended?: boolean | null;
    isPreview?: boolean | null;
    alsoWorthALook?: boolean | null;
}

export interface QualifyTableRow {
    /** The position in the order asked for, or null for a row the server did not rank. */
    rank: number | null;
    name: string;
    /** True for a newer, less proven type (still selectable by name). */
    preview: boolean;
    /** "fits" = the ontology judges it a fit for this data; "can-also-render" = it can draw this, but it is a weaker fit. */
    fit: "fits" | "can-also-render";
    description: string;
    language: string | null;
    renderer: string | null;
    /** One of the "something different" picks drawn from below the top fits. */
    alsoWorthALook: boolean;
}

/** The rows as table rows, in the order given (the server's order IS the ranking). */
export function qualifyTableRows(rows: readonly QualifyTableSource[]): QualifyTableRow[] {
    return rows.map((r): QualifyTableRow => ({
        rank: typeof r.rank === "number" && Number.isFinite(r.rank) ? r.rank : null,
        name: r.name,
        preview: r.isPreview === true,
        fit: r.recommended === false ? "can-also-render" : "fits",
        description: r.description ?? "",
        language: r.language ? r.language : null,
        renderer: r.renderer ? r.renderer : null,
        alsoWorthALook: r.alsoWorthALook === true,
    }));
}
