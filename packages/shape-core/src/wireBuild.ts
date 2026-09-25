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

import type { CredentialSource, RendererId, ViewportSource, WireServices } from "./host/services";

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

/** What a request asks the server to fetch, if anything, as the host knows it. */
export interface FetchRequest {
    /** The caller asks for a new generation. A recovery poll overrides it: a poll only ever fetches. */
    genNew: boolean;
    /** A recovery poll keyed by the correlation of the generation it is looking for. null/absent = not one. */
    fetchCorrelationId?: string | null;
    /** A recovery poll keyed by version. null/absent = not one. */
    recoveryFetchVersion?: number | null;
    /** A version the reader stated - asked for by number. null or 0 mean "no preference", never "version zero". */
    settingVersion?: number | null;
    /** The version whose code the host is holding now. */
    codeVersion?: number | null;
}

/** The request's fetch fields, in the order every host sends them. An undefined member is not sent. */
export interface FetchFields {
    genNew: boolean;
    version: number | null;
    fetchOnly: boolean | undefined;
    fetchCorrelationId: string | undefined;
}

/**
 * WHICH VERSION A REQUEST ASKS FOR, AND WHETHER THE SERVER MAY FALL THROUGH TO MAKING A NEW ONE.
 *
 * Seen in production: a refetch sent an unset version setting while the client held version 4. The
 * server read "don't generate, version <nothing>", had nothing to fetch, and generated a fresh chart
 * instead - a full model call, a different renderer, and a charge. Hence the rules:
 *
 *  1. A recovery poll keyed by correlation asks by correlation and sends NO version. That is the
 *     safety property, not an omission: a server too old to read the correlation refuses a fetch-only
 *     request with no version, where a version would have had it serve whichever chart the data shape
 *     numbered that - versions are numbered per data shape, not per client.
 *  2. A recovery poll keyed by version asks for that version.
 *  3. A generation carries the stated version exactly as before and is never marked fetch-only.
 *  4. Otherwise a version the reader stated wins, then the version in hand - never an unset setting.
 *  5. A fetch is a FETCH: whenever a real version was resolved, `fetchOnly` tells the server a miss
 *     comes back as "not found", never as a fresh, billed generation. With no version at all there is
 *     nothing to protect, and the request keeps its behaviour rather than silently becoming a no-op.
 */
export function resolveFetchVersion(i: {
    genNew: boolean;
    /** A recovery poll's explicit target, when that path owns the request. */
    recoveryFetchVersion?: number | null;
    /** The request is a recovery poll keyed by correlation - send no version. */
    recoveryFetchByCorrelation?: boolean;
    /** A version the reader stated. null/0 mean "no preference", NOT "version zero". */
    settingVersion?: number | null;
    /** The version whose code the client is currently holding. */
    codeVersion?: number | null;
}): { version: number | null; fetchOnly: boolean | undefined } {
    if (i.recoveryFetchByCorrelation) {
        return { version: null, fetchOnly: true };
    }
    if (i.recoveryFetchVersion != null) {
        return { version: i.recoveryFetchVersion, fetchOnly: true };
    }
    const setting = i.settingVersion ?? null;
    // A GENERATE is unaffected - it carries the setting exactly as before, and must never be
    // marked fetch-only or it could not do its job.
    if (i.genNew) return { version: setting, fetchOnly: undefined };

    const explicit = (setting ?? 0) > 0 ? setting : null;
    const inHand = (i.codeVersion ?? 0) > 0 ? i.codeVersion! : null;
    const version = explicit ?? inHand ?? setting;
    // Fetch-only whenever we resolved a REAL version to ask for. With no version at all there is
    // nothing to protect and the request keeps its old behaviour rather than silently becoming a
    // no-op the caller cannot diagnose.
    return { version, fetchOnly: version != null && version > 0 ? true : undefined };
}

/**
 * THE FETCH FIELDS OF A REQUEST - `genNew`, `version`, `fetchOnly`, `fetchCorrelationId` - decided
 * together, so the two that must agree cannot drift apart as two independent expressions did.
 *
 * A recovery poll (by correlation or by version) is never a generation, whatever the caller asked;
 * the version and the fetch-only flag are `resolveFetchVersion`'s. A member that is undefined is not
 * sent, so an ordinary generation serialises exactly as it did before any of these existed.
 */
export function fetchFields(r: FetchRequest): FetchFields {
    const byCorrelation = r.fetchCorrelationId != null;
    const recovery = byCorrelation || r.recoveryFetchVersion != null;
    const genNew = recovery ? false : r.genNew;
    const v = resolveFetchVersion({
        genNew,
        recoveryFetchVersion: r.recoveryFetchVersion,
        recoveryFetchByCorrelation: byCorrelation,
        settingVersion: r.settingVersion,
        codeVersion: r.codeVersion,
    });
    return { genNew, version: v.version, fetchOnly: v.fetchOnly, fetchCorrelationId: r.fetchCorrelationId ?? undefined };
}

/** The renderer capability flags a generate request carries. */
export interface CapabilityFields {
    supportsD3: boolean;
    supportsPlotly: boolean;
    supportsVega: boolean;
}

/**
 * WHAT THE HOST CAN RUN, AS THE REQUEST STATES IT - derived from the renderers the host passes, never
 * declared beside them, so a request can no longer ask for a chart its host cannot draw.
 *
 * The server reads each flag to decide which renderers it may pick; a flag that is absent is inferred
 * from the client's version number, which says nothing about what THIS host can run. So every flag is
 * stated, true or false, whatever the host. A host that generates without drawing (a server handing
 * the code to someone else's page) passes the renderers it asks the server for.
 *
 * Python has no flag on the wire: a host that runs it says so in its renderer set and nothing here
 * reads it. The host places each flag where it always has; they sit in a different order in each.
 */
export function capabilityFields(services: Pick<WireServices, "renderers">): CapabilityFields {
    const has = (r: RendererId) => services.renderers.has(r);
    return { supportsD3: has("D3"), supportsPlotly: has("PLOTLY"), supportsVega: has("VEGA") };
}
