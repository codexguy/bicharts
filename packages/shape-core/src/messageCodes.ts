// THE SERVER'S MESSAGE CODES A HOST DECIDES BY (2026-09-25).
//
// Every message the server returns now carries a stable code beside its text: an answer's
// `errorCode`, a freemium state's `freemiumStatusCode`, a progress line's `stageId`, a refusal's
// `reasonCode`, each notice's `code`. The TEXT is for display and is due to be translated; a host
// that decided anything by matching it - which progress lines to rotate, whether a painted chart
// contradicts the freemium wall, whether a licence error means a stale secret, whether to retry -
// would go silently blind the day it is. So hosts decide by these codes, and read the sentence only
// for a server older than the codes.
//
// Only the codes a host BRANCHES on are named here - the server's vocabulary is larger, and a host
// that merely shows a message needs no code at all. A code names the MESSAGE, not its wording, and
// codes are append-only: a host reads the ones it knows and falls back to the text for the rest.

/** The progress stages a generation reports, as the stream's `stageId`. `working` is the stage
 *  before the first milestone. */
export const PROGRESS_STAGE_IDS = ["working", "analyze", "generate", "refine", "review"] as const;
export type ProgressStageId = typeof PROGRESS_STAGE_IDS[number];

/**
 * Which stage a progress line reports: its `stageId` when the server sent a known one, otherwise -
 * an older server, which sends only the English label - the label read the way hosts always read it
 * (`analyz`, `generat`, `refin`, `review`). null when neither says: a host then shows the label as
 * it is. A known code always wins over the label, whatever language the label is in.
 */
export function progressStageOf(stageId: string | null | undefined, stageLabel: string | null | undefined): ProgressStageId | null {
    const id = String(stageId ?? "").trim().toLowerCase();
    if ((PROGRESS_STAGE_IDS as readonly string[]).includes(id)) return id as ProgressStageId;
    const s = String(stageLabel ?? "").toLowerCase();
    if (s.includes("analyz")) return "analyze";
    if (s.includes("generat")) return "generate";
    if (s.includes("refin")) return "refine";
    if (s.includes("review")) return "review";
    return null;
}

/** The freemium state that claims the attempt produced NO chart - the one message a chart already
 *  on screen contradicts. Every other freemium state (the limit reached, a warning) stays true with
 *  a chart painted. */
export const FREEMIUM_ATTEMPT_SPENT = "FREEMIUM_ATTEMPT_SPENT";

/** The licence answer for an account whose Client Secret Key is missing or does not match - the
 *  one a host answers by dropping a stale saved secret. */
export const CLIENT_SECRET_MISMATCH = "CLIENT_SECRET_MISMATCH";

/** The free tier's field cap: a wall that spent nothing (the historical `refusalCode`, kept). */
export const FREEMIUM_COLUMN_CAP = "FREEMIUM_COLUMN_CAP";

/**
 * May the same request, sent again, answer differently? The server's `retryable` flag when it sent
 * one; null when it did not (a success, or a server older than the flag) - the host then decides as
 * it did before. Never read from the message text.
 */
export function answerIsRetryable(answer: { retryable?: boolean | null } | null | undefined): boolean | null {
    const r = answer?.retryable;
    return typeof r === "boolean" ? r : null;
}
