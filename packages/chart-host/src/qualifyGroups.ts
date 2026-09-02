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
}

export function newQualifyGroupState(): QualifyGroupState {
    return { preview: false, previewClosed: false, projected: false, notRecommended: false };
}

/**
 * The heading (if any) that belongs immediately before `row`, MUTATING `state` so the caller's
 * loop stays a plain for-of. At most one heading per row: the boundaries cannot coincide, since
 * a row leaving the preview block is by definition not the row that opened it.
 *
 * ORDER OF THE CHECKS IS THE CONTRACT:
 *  1. "preview" opens the block - but never once the not-recommended block has opened, because a
 *     preview type the ontology ruled out is NOT floated and belongs where it landed.
 *  2. "main" closes it, at the first row that is not preview. Emitted only if a block opened.
 *  3. "projected" and 4. "notRecommended" are unchanged from the single-host original.
 */
export function qualifyGroupHeadingFor(
    row: QualifyGroupRow, state: QualifyGroupState,
): QualifyGroupHeading | null {
    const preview = row.isPreview === true;
    if (preview && !state.preview && !state.notRecommended) {
        state.preview = true;
        return "preview";
    }
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
// ─────────────────────────────────────────────────────────────────────────────

/** One row of a qualify result's `refused` array, in the only shape this logic cares about. */
export interface QualifyRefusalRow {
    name?: string | null;
    /** The gate's sentence. Absent is a real answer — the blocker rested on a runtime signal. */
    reason?: string | null;
    /** True = a required channel is ABSENT. Absent/false = a threshold we are willing to waive. */
    isVeto?: boolean | null;
}

/** Which heading to write BEFORE a refused row, if any. */
export type QualifyRefusalHeading = "poorFit" | "cannotDraw";

/** Carried across the refusal loop. One per render. */
export interface QualifyRefusalGroupState {
    poorFit: boolean;
    cannotDraw: boolean;
}

export function newQualifyRefusalGroupState(): QualifyRefusalGroupState {
    return { poorFit: false, cannotDraw: false };
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
 * The refused rows in RENDER ORDER: everything pickable first, then the vetoes.
 *
 * A STABLE PARTITION, not a sort — within each block the server's alphabetical order survives, so
 * two answers over the same shape stay diffable. Rows without a name are dropped: a control
 * labelled with nothing cannot be chosen and a reason with no subject cannot be read.
 *
 * The two blocks are ordered pickable-first because the reader opened this section to DO something.
 * Putting the inert half above the actionable half makes them scroll past every chart they cannot
 * have to reach the ones they can.
 */
export function orderRefusalsForDisplay<T extends QualifyRefusalRow>(
    rows: readonly T[] | null | undefined,
): T[] {
    if (!Array.isArray(rows)) return [];
    const named = rows.filter(r => !!r && typeof r.name === "string" && r.name.trim() !== "");
    return [...named.filter(refusalIsSelectable), ...named.filter(r => !refusalIsSelectable(r))];
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
