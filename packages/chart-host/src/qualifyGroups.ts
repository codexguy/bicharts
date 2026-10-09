// THE "WHAT FITS?" LIST IS PARTITIONED, AND EVERY HOST MUST PARTITION IT THE SAME WAY.
//
// The server decides the ORDER (see LLMPicker: FloatPreviewGroup, then SinkNotRecommended, with
// projected candidates appended in between). Hosts render strictly in the order received. What
// they each have to do is notice the BOUNDARIES and write a heading at them - and that rule now
// exists in two hosts, which is the point at which it stops being an idiom and starts being a
// thing that can disagree.
//
// The failure it prevents is specific and silent: a preview block floated to the TOP with no
// heading looks like the highest-ranked charts, and a preview block whose heading is never
// CLOSED makes every ranked chart below it read as preview too. Neither throws. Both mislead in
// the direction of "this is the best chart for your data", which is exactly the claim a
// weight-0 preview type is not allowed to make.
//
// Heading TEXT is not here: hosts localize, and the visual runs every string through Localize.
// The one exception is the tile block of the refused list (QUALIFY_TOO_SMALL_HEADING below): it is
// new, it has to read the same in every host, and a host that localizes passes it through its own
// lookup like the rest.

/** One row of a qualify result, in the only shape this logic cares about. */
export interface QualifyGroupRow {
    /** Newer type, deliberately unscorable. Server-stamped from the chart catalogue. */
    isPreview?: boolean | null;
    /** false = the ontology says a required channel cannot be satisfied by these fields. */
    recommended?: boolean | null;
    /** Non-empty when the type qualifies only against an AGGREGATED projection of the shape. */
    viaProjection?: string | null;
}

/** Which heading to write BEFORE a row, if any. */
export type QualifyGroupHeading = "preview" | "main" | "projected" | "notRecommended";

/** Carried across the loop. Create one per render with `newQualifyGroupState()`. */
export interface QualifyGroupState {
    preview: boolean;
    previewClosed: boolean;
    projected: boolean;
    notRecommended: boolean;
    /** A ranked (non-preview) row has been seen: from here on a badge is a badge, not a block. */
    rankedSeen: boolean;
}

export function newQualifyGroupState(): QualifyGroupState {
    return { preview: false, previewClosed: false, projected: false, notRecommended: false, rankedSeen: false };
}

/**
 * The heading (if any) that belongs immediately before `row`, MUTATING `state` so the caller's
 * loop stays a plain for-of. At most one heading per row: the boundaries cannot coincide, since
 * a row leaving the preview block is by definition not the row that opened it.
 *
 * ORDER OF THE CHECKS IS THE CONTRACT:
 *  1. "preview" opens the block - but never once the not-recommended block has opened, because a
 *     preview type the ontology ruled out is NOT floated and belongs where it landed. AND NEVER
 *     ONCE A RANKED ROW HAS BEEN SEEN. The preview BLOCK is the set of rows the server floated
 *     to the top (preview TYPES, which cannot be scored); a preview LANE sits on a scorable type
 *     that ranks on its own merits and is deliberately left where it ranks, carrying only its
 *     badge. Before this clause, one badged lane mid-list opened "New - in preview" above row 13
 *     and closed it with "Best fit for your data" above row 14 - two headings claiming a
 *     grouping the list did not have.
 *  2. "main" closes it, at the first row that is not preview. Emitted only if a block opened.
 *  3. "projected" and 4. "notRecommended" are unchanged from the single-host original.
 */
export function qualifyGroupHeadingFor(
    row: QualifyGroupRow, state: QualifyGroupState,
): QualifyGroupHeading | null {
    const preview = row.isPreview === true;
    if (preview && !state.preview && !state.notRecommended && !state.rankedSeen) {
        state.preview = true;
        return "preview";
    }
    if (!preview) state.rankedSeen = true;
    if (state.preview && !state.previewClosed && !preview) {
        state.previewClosed = true;
        return "main";
    }
    const projected = typeof row.viaProjection === "string" && row.viaProjection !== "";
    if (projected && !state.projected && !state.notRecommended) {
        state.projected = true;
        return "projected";
    }
    if (row.recommended === false && !state.notRecommended) {
        state.notRecommended = true;
        return "notRecommended";
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  THE REFUSED LIST — "Show all chart types"
//
//  A SECOND PARTITION, OVER A DIFFERENT ARRAY, ANSWERING A DIFFERENT QUESTION. Everything above
//  partitions `charts` — types that FIT, ordered by how well. This partitions `refused` — types
//  that did not — and the boundary that matters there is not quality but POSSIBILITY.
//
//  WHY IT IS A SHARED RULE RATHER THAN A HOST IDIOM. Both hosts had a full-catalogue surface that
//  offered every chart type equally: the visual's chart-type dropdown greyed the non-qualifying
//  ones and let you pick them anyway, and the Excel pane simply had no such surface at all. Both
//  were wrong in the same direction — offering a control whose only possible outcome is a refusal
//  — and the fix has to land identically or the two hosts disagree about what the product can do.
//
//  THE LINE IS DRAWN BY THE SERVER, NOT GUESSED HERE. `isVeto` is the gate's own verdict, gathered
//  under exactly the relaxations an explicit pick receives. A host that inferred the split from
//  reason text, or from a name list, would be re-deriving a decision it was already handed — the
//  precise mistake that, measured against real traffic, misread 25.5% of honoured picks.
//
//  A THIRD BLOCK FOR THE TILE. `isVeto` says whether the reader may pick a row; it does not say
//  what would change the answer. A refusal whose code names the tile's size or shape is answered
//  by resizing, not by rebinding, so it gets its own heading (see QUALIFY_TILE_REFUSAL_CODES).
// ─────────────────────────────────────────────────────────────────────────────

/** One row of a qualify result's `refused` array, in the only shape this logic cares about. */
export interface QualifyRefusalRow {
    name?: string | null;
    /** The gate's sentence. Absent is a real answer — the blocker rested on a runtime signal. */
    reason?: string | null;
    /** True = a required channel is ABSENT. Absent/false = a threshold we are willing to waive. */
    isVeto?: boolean | null;
    /**
     * WHICH GATE wrote `reason`, as the server's stable code. Absent from a server that predates
     * the code, which reads as "not known to be about the tile": the row keeps the grouping the
     * list always had.
     */
    reasonCode?: string | null;
}

/** Which heading to write BEFORE a refused row, if any. */
export type QualifyRefusalHeading = "poorFit" | "tooSmall" | "cannotDraw";

/** Carried across the refusal loop. One per render. */
export interface QualifyRefusalGroupState {
    poorFit: boolean;
    tooSmall: boolean;
    cannotDraw: boolean;
}

export function newQualifyRefusalGroupState(): QualifyRefusalGroupState {
    return { poorFit: false, tooSmall: false, cannotDraw: false };
}

/**
 * THE REFUSAL CODES THAT MEAN "THE TILE", NOT "THE FIELDS".
 *
 * Each refusal carries the code of the gate that wrote its sentence. These gates compare what a
 * chart type needs with the size and shape of the tile and nothing else:
 *  - TILE_TOO_NARROW, TILE_TOO_SHORT, TILE_NOT_SQUARE, TILE_NOT_TALL: too narrow, too short, not
 *    square enough, not tall enough.
 *  - TILE_TOO_SMALL: a type that does not hold up on a small tile, turned down because the tile is
 *    under the size the full catalogue needs, whatever the data is.
 *  - EMBED_NOTHING_FITS_TILE: a headline-plus-small-drawing type whose drawing has no form that
 *    fits the tile; the headline alone is still drawable on a plain card.
 *  - EMBED_BEESWARM_TILE_TOO_SMALL: a beeswarm turned down because the tile is under the size it
 *    needs.
 * The data can be exactly right and the type is still turned down, and the one thing that changes
 * the answer is a bigger tile.
 *
 * Without this split those rows sat under "Can't be drawn from the fields as bound" or "Poor fit
 * for these fields" - headings that send the reader to rebind data that is fine.
 *
 * ONLY GATES THAT LOOK AT THE TILE ALONE ARE LISTED. A gate that weighs the tile against the data
 * (ROWS_CRAMPED, a row-per-category floor; TOO_MANY_PANELS, a panel budget; CATEGORIES_TOO_WIDE)
 * can be answered by either, so naming it a tile problem would be the same false instruction
 * turned around. A code is added here when the server starts sending one that is purely about the
 * tile; an unknown code keeps the grouping it had.
 */
export const QUALIFY_TILE_REFUSAL_CODES: readonly string[] = Object.freeze([
    "TILE_TOO_NARROW",
    "TILE_TOO_SHORT",
    "TILE_NOT_SQUARE",
    "TILE_NOT_TALL",
    "TILE_TOO_SMALL",
    "EMBED_NOTHING_FITS_TILE",
    "EMBED_BEESWARM_TILE_TOO_SMALL",
]);

/**
 * THE HEADING OVER THE TILE BLOCK, in the one place every host reads it from, so the wording
 * cannot drift between them and a test pins it once.
 *
 * It says what the reader can do about it, not what category the row is in, and it says nothing
 * about the fields: the rows under it are exactly the ones the fields are not the problem for.
 * English source text - a host that localizes looks it up like its other headings.
 */
export const QUALIFY_TOO_SMALL_HEADING = "Needs a bigger tile";

/**
 * IS THIS REFUSAL ABOUT THE TILE'S SIZE OR SHAPE? Decided from the server's code, never from the
 * sentence: a host that matched the English would go blind the day the sentences are translated,
 * and would re-derive a verdict it was already handed.
 *
 * A row with no code (an older server) is NOT tile-bound. That is the safe direction: it keeps
 * the two-heading grouping the list had before the code existed.
 */
export function refusalIsTileBound(row: QualifyRefusalRow | null | undefined): boolean {
    const code = row?.reasonCode;
    return typeof code === "string" && QUALIFY_TILE_REFUSAL_CODES.includes(code);
}

/**
 * MAY THE READER PICK THIS ONE? The single place that answers it, in either host.
 *
 * DEFAULTS TO YES, and the asymmetry is deliberate. An older server sends no `isVeto` at all, so
 * every row reads selectable and the reader is offered something that may be refused — one wasted
 * click, and the refusal that follows names its own reason. The opposite default would hide charts
 * from readers on exactly the servers that cannot tell us it is wrong to.
 */
export function refusalIsSelectable(row: QualifyRefusalRow | null | undefined): boolean {
    return !!row && row.isVeto !== true;
}

/**
 * The refused rows in RENDER ORDER: the pickable ones first, then the ones the tile alone turned
 * down, then the vetoes the fields cause.
 *
 * A STABLE PARTITION, not a sort — within each block the server's alphabetical order survives, so
 * two answers over the same shape stay diffable. Rows without a name are dropped: a control
 * labelled with nothing cannot be chosen and a reason with no subject cannot be read.
 *
 * The blocks are ordered pickable-first because the reader opened this section to DO something.
 * Putting the inert half above the actionable half makes them scroll past every chart they cannot
 * have to reach the ones they can.
 *
 * THE TILE BLOCK SITS BETWEEN THE TWO, and its own rows are pickable-first too. A tile refusal is
 * a veto or a waivable one like any other (the reader may still pick the waivable ones), but what
 * it asks of the reader is different: resize, not rebind. Every row the code marks as about the
 * tile goes there whichever way its veto flag points, so none is left under a heading that names
 * the fields.
 */
export function orderRefusalsForDisplay<T extends QualifyRefusalRow>(
    rows: readonly T[] | null | undefined,
): T[] {
    if (!Array.isArray(rows)) return [];
    const named = rows.filter(r => !!r && typeof r.name === "string" && r.name.trim() !== "");
    const tile = named.filter(refusalIsTileBound);
    const rest = named.filter(r => !refusalIsTileBound(r));
    return [
        ...rest.filter(refusalIsSelectable),
        ...tile.filter(refusalIsSelectable), ...tile.filter(r => !refusalIsSelectable(r)),
        ...rest.filter(r => !refusalIsSelectable(r)),
    ];
}

/**
 * The heading (if any) belonging immediately before `row`, MUTATING `state` — same shape as
 * `qualifyGroupHeadingFor` so the two loops read alike.
 *
 * Assumes `rows` came through `orderRefusalsForDisplay`; fed an unpartitioned list it would write
 * a heading at every alternation, which is why the ordering and the headings are one export pair
 * rather than two independent helpers a host can half-adopt.
 */
export function qualifyRefusalHeadingFor(
    row: QualifyRefusalRow, state: QualifyRefusalGroupState,
): QualifyRefusalHeading | null {
    // THE TILE CHECK COMES FIRST: a tile refusal is judged by its code before its veto flag, since
    // the flag only says whether the reader may pick it, not what the reader would have to change.
    if (refusalIsTileBound(row)) {
        if (!state.tooSmall) { state.tooSmall = true; return "tooSmall"; }
        return null;
    }
    if (refusalIsSelectable(row)) {
        if (!state.poorFit) { state.poorFit = true; return "poorFit"; }
        return null;
    }
    if (!state.cannotDraw) { state.cannotDraw = true; return "cannotDraw"; }
    return null;
}

/**
 * Is there anything behind "Show all chart types"? A checkbox that reveals nothing is worse than
 * no checkbox: it reads as a broken control rather than an empty category.
 */
export function hasRefusalsToShow(rows: readonly QualifyRefusalRow[] | null | undefined): boolean {
    return orderRefusalsForDisplay(rows).length > 0;
}

/**
 * THE SENTENCE FOR A REFUSAL THAT NAMES NO REQUIREMENT.
 *
 * A null reason is a REAL answer, not a gap: the server walks a chart's DECLARED structural
 * requirements and stays silent rather than fabricating a cause when the blocker rests on a
 * runtime signal it cannot see - a viewport, a facet budget, a raw-observation floor. Both
 * refusal builders say in so many words that the client renders that null as a fallback
 * sentence. No host did. All three tested `if (reason)` and skipped the element, so the row
 * came out as a bare chart name under a heading that claimed to know why it was refused.
 *
 * It lives here, beside `refusalIsSelectable`, for the same reason that predicate does: three
 * hosts answering one question, and a fallback that only two of them remember to write is the
 * drift this module exists to prevent. Call `qualifyRefusalReason` rather than reading `.reason`
 * - a host cannot forget a fallback it never has to supply.
 *
 * IT DOES NOT GUESS. "We turned this down and cannot point at one requirement" is exactly what
 * happened, and it is more useful than silence: the reader learns the row is an ANSWER rather
 * than a rendering that failed to load.
 */
export const QUALIFY_REFUSAL_UNSPECIFIED =
    "refused for the fields as bound - no single requirement to name";

/**
 * The sentence to render beside a refused chart's name: the server's own words when it has them,
 * and {@link QUALIFY_REFUSAL_UNSPECIFIED} when it does not. Never empty, which is the point.
 *
 * `fallback` lets a host localize without re-implementing the decision.
 */
export function qualifyRefusalReason(
    reason: string | null | undefined,
    fallback: string = QUALIFY_REFUSAL_UNSPECIFIED,
): string {
    const s = (reason ?? "").trim();
    return s !== "" ? s : fallback;
}
