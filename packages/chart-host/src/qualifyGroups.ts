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
