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
    /** A later draw of a chart version this session already reported, for a reason not yet said. */
    REDRAW: "redraw",
    /** The reader selected something in a chart version, said once per version per session. */
    INTERACT: "interact",
} as const);

/**
 * WHY A CHART WAS DRAWN. Each value names the event that caused the draw:
 * - `open`: a saved chart drawn when the document or report opened.
 * - `generate`: a new version arriving.
 * - `version`: a switch to another saved version.
 * - `rebind`: the chart pointed at other data.
 * - `data`: the data under it changed (an edit, a refresh, a filter from elsewhere).
 * - `sample`: an example chart shown.
 * - `fix`: a review's correction redrawn.
 * - `resize`: the frame changed size.
 * - `other`: a redraw with none of those causes.
 * A draw-row only says a chart drew. The reason says whether a reader came back, the data moved, or
 * the frame changed size, and a view count that cannot tell those apart overcounts.
 */
export const DRAW_REASONS = Object.freeze(
    ["open", "generate", "version", "rebind", "data", "sample", "fix", "resize", "other"] as const);
export type DrawReason = (typeof DRAW_REASONS)[number];

/**
 * The render row's Location for a draw: `draw:<reason>`, after the host's own Location when it has one
 * (`excel-view;draw:open`). The reason rides Location because that field is kept per render row; the
 * behaviour flags are kept once per chart version, so a reason sent there after the first draw is lost.
 */
export function drawLocation(reason: DrawReason, base?: string | null): string {
    return base ? `${base};draw:${reason}` : `draw:${reason}`;
}

/** What a host knows about one draw, and about the draw before it in this session (null on the first). */
export interface DrawFacts {
    /** The reason when the caller knows it (a review fix, an example); it wins over everything below. */
    hint?: DrawReason | null;
    /** The draw shows a version that was generated just now. */
    generated: boolean;
    outputHash: string;
    /** Changes whenever new data arrives under the chart; equal across draws of the same data. */
    dataSignature: string;
    /** The frame's size, as any string that changes when the size does. */
    viewport: string;
    previous: { outputHash: string; dataSignature: string; viewport: string } | null;
}

/**
 * The reason for a draw a host has to infer. Checked in order: the caller's hint; a new version;
 * the session's first draw; another version than the last draw; new data; a new frame size. Anything
 * else is `other`. A host whose every draw call knows its reason passes that reason and never calls this.
 */
export function classifyDraw(f: DrawFacts): DrawReason {
    if (f.hint) return f.hint;
    if (f.generated) return "generate";
    if (!f.previous) return "open";
    if (f.outputHash !== f.previous.outputHash) return "version";
    if (f.dataSignature !== f.previous.dataSignature) return "data";
    if (f.viewport !== f.previous.viewport) return "resize";
    return "other";
}

/**
 * The once-per-session gates for the two signals. A chart version's reason is said once (a slicer
 * dragged across fifty values is one `data`, not fifty rows), and its first selection is said once:
 * the question is whether a chart was clicked at all, never how often, and a count of gestures is a
 * trace of one reader. Nothing about what was selected is ever sent.
 */
export interface DrawLedger {
    /** True the first time this (version, reason) is seen this session. */
    firstDraw(outputHash: string, reason: DrawReason): boolean;
    /** True the first time this version is selected in this session. */
    firstInteract(outputHash: string): boolean;
}

export function createDrawLedger(): DrawLedger {
    const draws = new Set<string>();
    const clicked = new Set<string>();
    return {
        firstDraw(outputHash, reason) {
            if (!outputHash) return false;
            const key = `${outputHash}|${reason}`;
            if (draws.has(key)) return false;
            draws.add(key);
            return true;
        },
        firstInteract(outputHash) {
            if (!outputHash || clicked.has(outputHash)) return false;
            clicked.add(outputHash);
            return true;
        },
    };
}

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
