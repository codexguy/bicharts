// THE CLIENT TELEMETRY VOCABULARY (2026-09-25) - the words every host's telemetry is written in.
//
// A host reports two kinds of fact to the service, over two channels:
//  - a CLIENT MESSAGE (one row per event: a chart rendered, a render failed, a chart was viewed),
//    posted as a signed body whose field names are the service's own, and whose Severity is a small
//    bit field;
//  - an EVENT COUNT (a participation counter), posted as one plain-text line the service parses by
//    position: "<code>,<version>|<clientId>" and, with a magnitude, "...|<count>|<nonce>".
// Each host wrote both by hand, with its own copy of the severity numbers and the line format. This
// file states them once. Nothing here sends anything: the row a host builds and when it ships it stay
// the host's.

/** Severity levels a client message carries, in its low bits. */
export const SEV_INFO = 2;
export const SEV_WARNING = 3;
export const SEV_ERROR = 4;
/** A bit OR-ed onto a level: the reader SAW this (an error on screen, a warning in a banner). */
export const SEV_USER_PRESENTED = 0x40;

/**
 * How long one telemetry post may take, on both channels, before it is abandoned: nothing waits on a
 * telemetry post, so the deadline only bounds how long a hung one holds its connection. A host talking
 * to a development server (a tunnel that can be slow to wake) uses the longer one.
 */
export const TELEMETRY_TIMEOUT_MS = 8_000;
export const TELEMETRY_TIMEOUT_DEV_MS = 60_000;

/**
 * The fields of a client message, by the service's names. Every field is optional; a host sends what
 * it knows. The service derives a failure from a non-empty StackTrace, so a failure must carry one.
 */
export interface ClientMessage {
    Message?: string;
    StackTrace?: string;
    Location?: string;
    Code?: string | null;
    Duration?: number | null;
    OutputHash?: string | null;
    UpDownVote?: number | null;
    ClientId?: string | null;
    LanguageCode?: string | null;
    TriesLeft?: number | null;
    ClientRows?: number | null;
    RenderedRowCount?: number | null;
    ImageWidth?: number | null;
    ImageHeight?: number | null;
    ImageThumbnail?: string | null;
    ThumbnailUserConsent?: boolean | null;
    ClientVersion?: string;
    ClientBehaviorFlags?: string | null;
    ClientBuild?: string | null;
    Severity?: number | null;
    EventKind?: string | null;
}

/**
 * The event kinds the service's views count by. `render-ok` and `view` are what a chart's view count
 * counts; the others are recorded beside it without inflating it.
 */
export const CLIENT_EVENT_KINDS = Object.freeze({
    RENDER_START: "render-start",
    RENDER_OK: "render-ok",
    RENDER_ERROR: "render-error",
    VIEW: "view",
    VIEW_VERDICT: "view-verdict",
} as const);

/**
 * Can this code name an event counter? The service splits the line on "|" and keys the counter on
 * everything before it, with "," separating code from version - so a code carrying either delimiter
 * would land as a DIFFERENT counter, a row nobody reports on. An empty code names nothing.
 */
export function isEventLogCode(code: string): boolean {
    return !!code && !code.includes("|") && !code.includes(",");
}

/**
 * The event-count line: "<code>,<version>|<clientId>", or with a magnitude
 * "<code>,<version>|<clientId>|<count>|<nonce>" - the count rounded and floored at 0, the nonce keeping
 * repeated equal counts from being merged by the service. Built as given: a host checks the code with
 * `isEventLogCode` first when it did not write the code itself.
 */
export function eventLogLine(code: string, version: string, clientId: string, magnitude?: { count: number; nonce: string }): string {
    const base = `${code},${version}|${clientId}`;
    if (!magnitude) return base;
    return `${base}|${Math.max(0, Math.round(magnitude.count))}|${magnitude.nonce}`;
}
