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
    /**
     * The signed-in account's access token as the wire carries it (the request's `accessToken`):
     * trimmed, "" when the host signs in this way but has no token right now. Null when the source
     * has no `accessToken` member, and null whenever a live link nonce travels instead.
     */
    accessToken: string | null;
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
 *
 * A SIGNED-IN ACCOUNT'S ACCESS TOKEN follows the same rule for the same reason: the server reads the
 * token only when the triple is empty, so a live token travels with an EMPTY triple, never beside a
 * key. A live nonce outranks it (a source offering both has two sessions, and the nonce is the one
 * this rule already sends). Which of a key and a token a host prefers is decided in its source: a
 * host that holds a key returns no token.
 */
export function credentialFields(source: CredentialSource): CredentialFields {
    const linkNonce = source.linkNonce ? (source.linkNonce() ?? "").trim() : null;
    const accessToken = linkNonce ? null : (source.accessToken ? (source.accessToken() ?? "").trim() : null);
    const t = linkNonce || accessToken ? { licensee: "", licenseKey: "", secretKey: "" } : source.triple();
    return {
        request: {
            licenseKey: t.licenseKey,
            licensee: t.licensee,
            secretKey: t.secretKey,
            freemiumKey: source.freemiumKey?.() ?? "",
        },
        linkNonce,
        accessToken,
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
    /**
     * When the generation a correlation poll looks for was started: the host's pending-generate marker time, epoch
     * milliseconds on the host's own clock. Used only with `fetchCorrelationId`; see `fetchFields`.
     */
    fetchArmedAtMs?: number | null;
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
    /** Present only on a poll by correlation that stated a usable arm time; never a key holding `undefined`. */
    fetchArmedAtMs?: number;
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
 * THE FETCH FIELDS OF A REQUEST - `genNew`, `version`, `fetchOnly`, `fetchCorrelationId`, and a poll's
 * `fetchArmedAtMs` - decided together, so the two that must agree cannot drift apart as two
 * independent expressions did.
 *
 * A recovery poll (by correlation or by version) is never a generation, whatever the caller asked;
 * the version and the fetch-only flag are `resolveFetchVersion`'s. A member that is undefined is not
 * sent, so an ordinary generation serialises exactly as it did before any of these existed.
 *
 * THE ARM TIME rides a poll by correlation, and only that: it tells the server when the generation
 * began, which is what lets it tell one that died with a server restart from one still running. The
 * server binds it as an integer, and a value it cannot bind (a fraction, a string, an exponent form)
 * fails the whole request rather than just that field, so it is sent only as a positive whole number
 * and its key is left off otherwise. A server that predates the field drops it unread.
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
    const armed = r.fetchArmedAtMs;
    const armedAtMs = byCorrelation && typeof armed === "number" && Number.isSafeInteger(armed) && armed > 0 ? armed : undefined;
    return {
        genNew, version: v.version, fetchOnly: v.fetchOnly, fetchCorrelationId: r.fetchCorrelationId ?? undefined,
        ...(armedAtMs !== undefined ? { fetchArmedAtMs: armedAtMs } : {}),
    };
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

/** The retry pair a generate request carries. */
export interface RetryFields {
    triesLeft: number;
    maxTries: number;
}

/**
 * THE RETRY PAIR: `maxTries`, the budget of attempts this request belongs to, and `triesLeft`, how many
 * of them remain. The server reads the pair to size its own retry loop and to decide which of the
 * request's modifiers to drop on a late attempt - so a pair that claims a budget the host will not
 * spend changes what the server does on the first attempt.
 *
 * The budget is each host's own policy and is passed in. What is shared is how the pair is formed:
 *  - `maxTries` is the budget, capped where the host's loop caps what it will actually spend on this
 *    request (`cap`; absent = no cap) - the request states the budget the loop will honour, never a
 *    larger one;
 *  - `triesLeft` is the host's count for this attempt, and on a first attempt (none passed) the whole
 *    of `maxTries`.
 */
export function retryFields(p: { budget: number; cap?: number | null; triesLeft?: number }): RetryFields {
    const maxTries = p.cap != null && p.budget > p.cap ? p.cap : p.budget;
    return { triesLeft: p.triesLeft ?? maxTries, maxTries };
}

/**
 * THE LEAF COUNT A REQUEST STATES - the client hints' `leafCardinality`: how many distinct combinations
 * of the dimensions the rows hold. The server reads it where it would otherwise multiply each
 * dimension's distinct count (which overstates the cells of any nested table), and it reads an absent
 * count and a zero one alike - every reader tests for a positive number. So a count is sent only when
 * it is one: a positive number, rounded to the whole count the server's integer field holds; zero, a
 * negative, NaN or nothing sends no field at all. Spread where the host has always placed it.
 */
export function leafCardinalityField(count: number | null | undefined): { leafCardinality?: number } {
    return count && count > 0 ? { leafCardinality: Math.round(count) } : {};
}

/** The completeness fields a request's client hints carry. Each is absent when the host does not know it. */
export interface DataCompletenessFields {
    dataComplete?: boolean;
    rowsWithheld?: number;
    rowsFilteredOut?: number;
}

/**
 * WHETHER EVERY ROW ARRIVED, AS THE REQUEST STATES IT - the client hints' `dataComplete`, `rowsWithheld`
 * and `rowsFilteredOut`.
 *  - `dataComplete` is false when rows the reader did not choose to remove never reached the chart: a row
 *    cap, a load that stalled, a host memory ceiling, a query limit. A filter the reader applied (a slicer,
 *    a sheet filter) is their view of the data, not a cut, and never lowers it.
 *  - `rowsWithheld` is how many rows such a cut left out, sent only when the host knows the exact number.
 *  - `rowsFilteredOut` is how many rows the reader's own filter hides inside the bound range, kept apart
 *    from the cut so a chart can say so without the cut's warning.
 *
 * ABSENT MEANS UNKNOWN, NEVER TRUE: a server that reads a missing `dataComplete` as "complete" would call
 * a cut table whole, so the host says nothing unless it knows. Only a boolean is a statement about
 * completeness, and a count travels only when it is a whole number above zero - a zero, a fraction or a
 * non-number says nothing the absence did not. Spread where the host builds its hints.
 */
export function dataCompletenessFields(
    complete?: boolean | null,
    withheld?: number | null,
    filteredOut?: number | null,
): DataCompletenessFields {
    const count = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
    return {
        ...(typeof complete === "boolean" ? { dataComplete: complete } : {}),
        ...(count(withheld) ? { rowsWithheld: withheld } : {}),
        ...(count(filteredOut) ? { rowsFilteredOut: filteredOut } : {}),
    };
}

/** The order of the "what fits" list: by how well each type suits the data, or by the picker's selection order. */
export type QualifyOrder = "fit" | "variety";

/** The two orders' reader-facing names, for any host's control. */
export const QUALIFY_ORDER_LABELS: Readonly<Record<QualifyOrder, string>> = {
    fit: "Best fit",
    variety: "Something different",
};

/** A stored or typed order read back: one of the two the server knows (case and padding ignored), else null. */
export function qualifyOrderOf(raw: unknown): QualifyOrder | null {
    if (typeof raw !== "string") return null;
    const v = raw.trim().toLowerCase();
    return v === "fit" || v === "variety" ? v : null;
}

/**
 * THE ORDER A "WHAT FITS" REQUEST ASKS FOR - the client hints' `qualifyOrder`. Sent only when the reader
 * has chosen one: an unmade choice sends no field, so the server's own default applies, and a server
 * that predates the field ignores it. Spread where the host builds its hints.
 */
export function qualifyOrderField(raw: unknown): { qualifyOrder?: QualifyOrder } {
    const o = qualifyOrderOf(raw);
    return o ? { qualifyOrder: o } : {};
}

/**
 * IS A CAPTURED "WHAT FITS" LIST STALE? True when the list was captured for one schema and the
 * request now describes another - the reader changed the fields since they looked, so the list is not
 * the one in front of them. The keys are the host's own schema keys, compared as given; an unknown
 * key on either side (null or undefined) is not evidence of a change, and the list stands.
 */
export function shortlistIsStale(
    capturedFor: string | number | null | undefined,
    now: string | number | null | undefined,
): boolean {
    return capturedFor != null && now != null && capturedFor !== now;
}

/**
 * THE SHORTLIST A REQUEST CARRIES - the "what fits" list the reader was looking at when they chose, and
 * how long ago they saw it.
 *
 * A list captured for a different schema is DROPPED rather than sent with a misleading age
 * (`shortlistIsStale`): it was computed for other fields, which makes it wrong rather than merely old.
 * There is no age CAP - a reader who studied the list for ten minutes and then generated was still
 * working from it. `ageMs` is the whole milliseconds since `atMs` (never negative), and undefined when
 * no capture time is known; it follows the list's own fields.
 *
 * `stale` says why a present list was not returned, so a host can record the drop.
 */
export function offeredShortlistFor<T extends object>(
    shortlist: T | null | undefined,
    at: { capturedFor?: string | number | null; now?: string | number | null; atMs: number; nowMs: number },
): { shortlist: (T & { ageMs?: number }) | undefined; stale: boolean } {
    if (!shortlist) return { shortlist: undefined, stale: false };
    if (shortlistIsStale(at.capturedFor, at.now)) return { shortlist: undefined, stale: true };
    return {
        shortlist: { ...shortlist, ageMs: at.atMs > 0 ? Math.max(0, Math.round(at.nowMs - at.atMs)) : undefined },
        stale: false,
    };
}
