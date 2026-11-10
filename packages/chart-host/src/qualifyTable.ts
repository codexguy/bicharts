// THE WHAT-FITS ANSWER AS A TABLE. One typed row per chart type, so a client that offers choices lays out rank, name,
// preview and verdict instead of bare names, and the MCP, the React demo and the hosts read one shape. The selection
// weight is never a field here: a printed "61.9" read as a quality score, and rank plus verdict carry the ordering.

/**
 * What kind of thing a chart type is, beyond a plain chart, in the chart gallery's own families: an app (a type with
 * its own controls or logic), a table, a map or a KPI card. A plain chart has no kind and no badge. The same four
 * strings shape-core's qualify parse accepts (a test pins the two lists equal).
 */
export type QualifyKind = "app" | "table" | "map" | "kpi";

/** A colour pair for one badge: the chip's fill and its text. */
export interface QualifyKindBadgeColours {
    background: string;
    text: string;
}

/** How one kind is badged: its word, and its colours on a light pane and on a dark pane. */
export interface QualifyKindBadge {
    /** The word on the badge. The word is the signal; colour only repeats it. */
    label: string;
    /** On a light pane: the gallery family's own light tint, with the family's colour darkened to 75% as the text. */
    light: QualifyKindBadgeColours;
    /** On a dark pane: the family's colour at 50% as the fill, with the gallery's light tint as the text. */
    dark: QualifyKindBadgeColours;
}

/**
 * The four badges, in the gallery's family order (apps, tables, maps, KPIs). Each host draws them in its own widget,
 * after the name and before a Preview badge, and a badge never reorders, hides or gates a row.
 *
 * The light fills are the chart gallery's family tints exactly. The gallery's own family text colour does not reach
 * 4.5:1 on three of its tints (about 3.6 to 4.5), so the text is that colour darkened to 75%, which keeps the hue and
 * clears 5.7:1 on every fill. The dark fills are the family colour at 50%, with the tint as text (above 9:1). Light
 * tints sit close to each other by nature (the nearest pair is about 8.5 apart by CIEDE2000), so the claim is that
 * the badges are distinct with the word on them, not that colour alone tells them apart.
 */
export const QUALIFY_KIND_BADGES: Readonly<Record<QualifyKind, QualifyKindBadge>> = Object.freeze({
    app: Object.freeze({
        label: "App",
        light: Object.freeze({ background: "#FCE7E3", text: "#923121" }),
        dark: Object.freeze({ background: "#612116", text: "#FCE7E3" }),
    }),
    table: Object.freeze({
        label: "Table",
        light: Object.freeze({ background: "#E6EBF2", text: "#35445A" }),
        dark: Object.freeze({ background: "#232D3C", text: "#E6EBF2" }),
    }),
    map: Object.freeze({
        label: "Map",
        light: Object.freeze({ background: "#E1F3EF", text: "#175C52" }),
        dark: Object.freeze({ background: "#103D37", text: "#E1F3EF" }),
    }),
    kpi: Object.freeze({
        label: "KPI",
        light: Object.freeze({ background: "#FBF0D6", text: "#7E560C" }),
        dark: Object.freeze({ background: "#543A08", text: "#FBF0D6" }),
    }),
});

/** The pane a badge is drawn on. In high contrast the host's own foreground colour is the only colour used. */
export type QualifyKindPane = "light" | "dark" | { highContrastForeground: string };

/** What a host sets on a badge element: its word, fill, text colour and border, as CSS values. */
export interface QualifyKindBadgeStyle {
    label: string;
    background: string;
    color: string;
    border: string;
}

/**
 * The style for one kind's badge on one pane, or null for no kind (a plain chart, or a kind this version does not
 * know). In high contrast the badge has no fill: the text and a 1px border take the host's foreground colour, so the
 * system's colours decide and the word stays the signal.
 */
export function qualifyKindBadgeStyle(kind: string | null | undefined, pane: QualifyKindPane): QualifyKindBadgeStyle | null {
    const k = knownKind(kind);
    if (!k) return null;
    const badge = QUALIFY_KIND_BADGES[k];
    if (typeof pane === "object") {
        const fg = pane.highContrastForeground;
        return { label: badge.label, background: "transparent", color: fg, border: `1px solid ${fg}` };
    }
    const c = pane === "dark" ? badge.dark : badge.light;
    return { label: badge.label, background: c.background, color: c.text, border: "none" };
}

function knownKind(v: unknown): QualifyKind | null {
    return typeof v === "string" && Object.prototype.hasOwnProperty.call(QUALIFY_KIND_BADGES, v) ? v as QualifyKind : null;
}

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
    /** The server's kind for the type ("app", "table", "map", "kpi"); absent or anything else is a plain chart. */
    kind?: string | null;
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
    /** The type's kind, for its badge (QUALIFY_KIND_BADGES); null for a plain chart. qualifyTableRows always sets it. */
    kind?: QualifyKind | null;
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
        kind: knownKind(r.kind),
    }));
}
