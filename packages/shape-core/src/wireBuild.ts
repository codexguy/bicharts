// BUILDING A GENERATE REQUEST, ONE CONCERN AT A TIME.
//
// Every host builds its own generate request - the Power BI visual from its format pane, the Excel
// add-in from its task pane, the MCP server from a tool call's arguments - and most of what each
// one sends is its own: its settings, its credentials, its identity. What is the SAME rule in every
// host lives here, as a function that returns the fields it owns. Each host places them where it
// always placed them, so a request serialises to the same bytes before and after a concern moves.
//
// A concern moves here only when every host already applies the same rule. Where hosts send
// different values for one field, that difference is a decision, not a refactor, and it stays in
// the hosts until it is made. Where the rule is shared and the values are each host's own policy,
// only the rule is here: the host passes its values in.

import type { CredentialSource, ViewportSource } from "./host/services";

/** A generate request's credential fields. */
export interface CredentialFields {
    /** The licence triple and the free-tier key: the first four fields of every host's request, in this order. */
    request: { licenseKey: string; licensee: string; secretKey: string; freemiumKey: string };
    /**
     * The linked session's nonce as the wire carries it: trimmed, "" when the host has no live link
     * right now. Null when the source has no `linkNonce` member - a host that never signs in by a
     * linked session sends no such field. The host places it; it sits at a different key in each.
     */
    linkNonce: string | null;
}

/**
 * THE CREDENTIALS A REQUEST CARRIES: ONE CREDENTIAL, AND A LINKED SESSION'S NONCE WINS.
 *
 * The server takes the linked-session path only when a nonce is present AND the licence triple is
 * empty. So a request carrying both is not "either will do": the nonce is silently ignored and the
 * triple authenticates, which is the hole a linked session exists to close (a triple lifted out of a
 * saved file buys generation anywhere). A live nonce therefore travels INSTEAD of the triple, never
 * beside it - and there is no fallback to the triple when the nonce is refused.
 *
 * What each value holds is the source's own: a host that resolves a mode (licensed or free tier) or
 * trims what a reader typed does that in its source. The free-tier key rides beside either, "" when
 * the source has none.
 */
export function credentialFields(source: CredentialSource): CredentialFields {
    const linkNonce = source.linkNonce ? (source.linkNonce() ?? "").trim() : null;
    const t = linkNonce ? { licensee: "", licenseKey: "", secretKey: "" } : source.triple();
    return {
        request: {
            licenseKey: t.licenseKey,
            licensee: t.licensee,
            secretKey: t.secretKey,
            freemiumKey: source.freemiumKey?.() ?? "",
        },
        linkNonce,
    };
}

/** The two places a generate request states its drawing area, in the order they travel. */
export interface ViewportFields {
    /** The request's own `height` and `width`. */
    request: { height: number; width: number };
    /** The client hints' `viewportWidth` and `viewportHeight`. */
    hints: { viewportWidth: number; viewportHeight: number };
}

/**
 * THE VIEWPORT A REQUEST IS SIZED FOR: one measurement, stated twice.
 *
 * A generate request carries its drawing area in two places - the request's `width`/`height` and
 * the client hints' `viewportWidth`/`viewportHeight` - and the server reads each in a different
 * place (the chart gates on one side, the prompt's size guidance on the other). If they disagree,
 * the server's two readers are told two different sizes for the same chart. So the source is
 * measured ONCE per call and both halves come from that one answer.
 *
 * The numbers are the source's, unchanged: a host that rounds, clamps or substitutes a stated size
 * for a measured one does it in its source, where it knows why.
 */
export function viewportFields(source: ViewportSource): ViewportFields {
    const { width, height } = source.measure();
    return {
        request: { height, width },
        hints: { viewportWidth: width, viewportHeight: height },
    };
}

/**
 * THE LARGEST CATEGORY COUNT AMONG THE DIMENSIONS - the client hints' `maxNonMeasureCardinality`.
 *
 * The server reads it for its label-density and many-series advice: how many distinct values a chart
 * may have to lay out along one axis or in one legend. Every host sends it by one rule: the largest `distinctCount`
 * among the columns that are not measures, 0 when there is none. A count that is not a number is not
 * a count and is skipped.
 */
export function maxNonMeasureCardinality(
    columns: readonly { isMeasure?: boolean | null; distinctCount?: number | null }[],
): number {
    let max = 0;
    for (const col of columns) {
        if (col.isMeasure) continue;
        const dc = col.distinctCount;
        if (typeof dc === "number" && dc > max) max = dc;
    }
    return max;
}
