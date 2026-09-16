// PENDING-GENERATE MARKER + RECOVERY DECISION.
//
// A generate is a promise a host makes to the chart service on the user's behalf, and the service
// keeps it whether or not the host is still there to receive the answer. A connection that drops
// part-way through - common on corporate proxies, airport and hotel wi-fi, and mobile networks -
// does not stop the service finishing the chart and charging for it. A host that then lets the user
// click Generate again pays for the same chart twice and shows only the second one.
//
// The fix is a small persisted MARKER written when a generate STARTS and cleared when the service
// ANSWERS. Anything else - a transport failure after the service accepted the request, or a host
// re-mount that finds the marker still there - means the answer may still be coming, so the host
// POLLS for that generation instead of generating again. The service only FETCHES on that poll
// (fetchOnly), so a poll can never cost a chart.
//
// This module is the PURE half, shared by every host: encode and decode the marker, and decide what
// a mount or a transport failure should do with it. Nothing here knows what a report, a workbook or
// a React tree is. The I/O half - where the marker is persisted, how the poll is scheduled, how a
// recovered chart is drawn - is host-specific and lives in each host. What must NOT differ between
// hosts is the decision: when a marker is stale, whether a poll may run, whether a served
// correlation proves the answer is yours. Two hosts answering that differently is a difference
// nobody can see from inside either one.

export interface PendingGenerateMarker {
    /** The version this generate will produce: (version in hand || 0) + 1.
     *  Diagnostic only - see "WHY `v` IS NOT A PREDICTION" below before trusting it. */
    v: number;
    /** Epoch ms when the generate started (client clock). */
    t: number;
    /** Correlation id of the generate - the ONLY safe handle for recovering it. */
    c: string;
    /** The explicit chart-type pick the user made for this generate ("" = none). */
    p: string;
    /** The version the host actually HELD when the generate started (0 = none).
     *  Absent on markers written by older builds. Diagnostics, plus the blind test. */
    h?: number;
}

// WHY `v` IS NOT A PREDICTION (2026-08-26).
//
// `v` is computed client-side as "the version I hold, plus one". That is only meaningful if version
// numbers belong to the HOST. They do not: the service numbers versions per DATA SHAPE, and resolves
// a fetch by shape and version with the requesting host playing no part. Many hosts, on many
// devices, can each produce versions of the same shape.
//
// So a brand-new host arms `v:1` perfectly honestly - it holds nothing - and a poll by version then
// fetches THE FIRST CHART ANYONE EVER MADE for that data. Seen in production: a host whose own
// generate was stamped version 10 recovered version 1, a different chart made for the same data
// weeks earlier, painted it, cleared the marker as a success, and discarded the chart the user had
// just paid for. (Scoped to one account, so a correctness defect rather than a leak.)
//
// Hence recovery is keyed by CORRELATION, never by version: see isBlindMarker and
// servedCorrelationProves. A recovery that cannot tell your chart from a stranger's is worse than no
// recovery.

// HOW LONG THE POLL WAITS, AND WHY IT IS NO LONGER FOUR MINUTES (2026-08-30).
//
// The first window was 240 s, sized from a sample ten generations wide. Measured against every
// successful generate with a correlation:
//
//   PRODUCTION, 90 days, n=492:  p50= 82 s  p90=235 s  p99=383 s  max= 552 s
//   DEVELOPMENT, 30 days, n=372: p50=286 s  p90=691 s  p99=1472 s max=2391 s
//
// So the window sat below the development median and cut off the slowest tenth of production. One
// trace shows the whole failure: an animated chart armed at 12:22:17, the poll gave up at 12:26:17,
// and the service finished it at 12:30:17 - eight minutes for a chart the recovery had already
// declared undeliverable, by which time the user had paid for a second one. The poll was never
// wrong; it was never given long enough.
//
// 900 s covers production's worst observed generate (552 s) with 63% headroom and development's
// p90. It deliberately does NOT chase development's p99 (24 min): polls are cheap but not free, and
// a window that long would be sized by one slow development setup rather than by the product. If a
// long tail starts costing real charts, the honest fix is a service-delivered value per
// environment, not a bigger constant here.
export const PENDING_RECOVERY_WINDOW_MS = 900_000;
/** Poll cadence for the first {@link PENDING_RECOVERY_FAST_PHASE_MS}. Each poll is one
 *  cheap fetch (and one server log row), so this is deliberately slow: the cost of finding the
 *  chart 15 s late is nothing next to the cost of a second generation. */
export const PENDING_RECOVERY_POLL_MS = 15_000;
/** First poll after a re-mount fires quickly - the service may already be done. */
export const PENDING_RECOVERY_FIRST_POLL_MS = 2_000;
/** Up to here the poll runs at {@link PENDING_RECOVERY_POLL_MS} - covers production's p50. */
export const PENDING_RECOVERY_FAST_PHASE_MS = 120_000;
/** ...then at this cadence up to {@link PENDING_RECOVERY_SLOW_PHASE_MS}. */
export const PENDING_RECOVERY_MID_POLL_MS = 30_000;
export const PENDING_RECOVERY_SLOW_PHASE_MS = 300_000;
/** ...and at this one for the rest of the window. */
export const PENDING_RECOVERY_SLOW_POLL_MS = 60_000;

/**
 * How long to wait before the NEXT poll, given how long the generate has been running.
 *
 * Tripling the window would have tripled the poll count at a flat 15 s (60 requests, 60 server log
 * rows), and every one of them after the first couple of minutes is asking about a generate that is
 * plainly slow. So the cadence backs off with age while leaving the FAST phase exactly as it was - a
 * chart that lands inside production's normal range is still picked up within 15 s of finishing,
 * which is the case that actually happens.
 *
 *   0 - 2 min   every 15 s   (9 polls)   production p50 82 s lands here
 *   2 - 5 min   every 30 s   (6 polls)   production p99 383 s lands here
 *   5 - 15 min  every 60 s   (10 polls)  the long tail
 *
 * ~25 polls across 15 minutes, against 60 for a flat cadence over the same window.
 */
export function pendingRecoveryNextDelayMs(elapsedMs: number): number {
    if (elapsedMs < PENDING_RECOVERY_FAST_PHASE_MS) return PENDING_RECOVERY_POLL_MS;
    if (elapsedMs < PENDING_RECOVERY_SLOW_PHASE_MS) return PENDING_RECOVERY_MID_POLL_MS;
    return PENDING_RECOVERY_SLOW_POLL_MS;
}

export function encodePendingGenerate(m: PendingGenerateMarker): string {
    const o: Record<string, unknown> = { v: m.v, t: m.t, c: m.c, p: m.p ?? "" };
    // Only written when known, so an older marker round-trips unchanged.
    if (Number.isFinite(m.h as number)) o.h = Math.max(0, Math.floor(m.h as number));
    return JSON.stringify(o);
}

export function parsePendingGenerate(raw: unknown): PendingGenerateMarker | null {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    try {
        const o = JSON.parse(raw);
        const v = Number(o?.v), t = Number(o?.t);
        if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(t) || t <= 0) return null;
        const h = Number(o?.h);
        const m: PendingGenerateMarker = { v: Math.floor(v), t: Math.floor(t), c: typeof o.c === "string" ? o.c : "", p: typeof o.p === "string" ? o.p : "" };
        if (Number.isFinite(h) && h >= 0) m.h = Math.floor(h);
        return m;
    } catch {
        return null;
    }
}

export type PendingRecoveryDecision =
    | "none"        // no marker
    | "delivered"   // the version in hand is already >= the marker's: clear it
    | "expired"     // too old to still be in flight: clear it, restore the pick
    | "blind"       // no correlation to ask by: a version would name a stranger's chart
    | "poll";       // inside the window and not in hand: poll for it

/**
 * What to do with a marker found at mount (or after a transport failure).
 * @param persistedVersion the version the host HAS, 0/null = none
 */
/**
 * Was this marker armed holding NO version? If so its `v` is 1, which the service reads as "the
 * shape's first chart" rather than "this host's first chart". `h` is the explicit signal; the
 * `v - 1` fallback says the same thing for markers written by older builds.
 */
export function markerArmedBlind(m: PendingGenerateMarker | null | undefined): boolean {
    if (!m) return false;
    return (m.h ?? (m.v - 1)) <= 0;
}

/**
 * Can this marker be recovered AT ALL? Only by CORRELATION, so only if it carries one.
 *
 * A version number is never a safe handle, not even when we held one: the number we hold came FROM
 * the service and is therefore a shape version, so "mine + 1" is still a guess about what everyone
 * else did next. The poll consequently asks by correlation ALONE and sends no version at all - which
 * is also what makes this safe against a service too old to understand the field, because such a
 * service refuses a fetchOnly request with no version and can serve nothing. A marker with no
 * correlation (written by an older build) has no usable handle and is not polled.
 *
 * One definition, shared by the mount-time decision and the transport-lost message.
 */
export function isBlindMarker(m: PendingGenerateMarker | null | undefined): boolean {
    if (!m) return false;
    return typeof m.c !== "string" || m.c.trim() === "";
}

/**
 * Does `served` (the service's statement of whose generation it returned) prove this marker's
 * chart? Absence is REFUSAL, not assent: an older service says nothing here, and a recovery that
 * cannot tell your chart from a stranger's is worse than no recovery.
 */
export function servedCorrelationProves(m: PendingGenerateMarker | null | undefined, served: string | null | undefined): boolean {
    if (!m || typeof m.c !== "string" || m.c.trim() === "") return false;
    if (typeof served !== "string" || served.trim() === "") return false;
    return served.trim().toLowerCase() === m.c.trim().toLowerCase();
}

/**
 * Are these the SAME pending generate? By correlation, never by version.
 *
 * Found 2026-08-30, and the log showed the bug in two adjacent lines. A poll was running for one
 * correlation when the user clicked Generate again, arming a second. The poll's "has the marker
 * changed under me?" guard compared `m.v` - and EVERY marker armed by a host holding no chart is
 * `v: 1`, so `1 !== 1` was false and the stale poll did not notice it had been superseded. Four
 * minutes later its window closed and it cleared the marker belonging to the generate that was
 * still running:
 *
 *     pending-gen-poll-end  {"outcome":"window-closed","c":"<the first correlation>"}
 *     pending-gen-cleared   {"reason":"poll-window-closed","c":"<the second correlation>"}
 *
 * The live generate lost its recovery marker 35 s after starting, and the user was told "nothing
 * was delivered" about a chart that was still being written. The same lesson as `v` above: a shape
 * version that the whole account moves can never identify one host's request. The correlation can.
 *
 * Two markers with no correlation are never "the same" - there is nothing to compare, and a false
 * match here is what clears a stranger's marker.
 */
export function sameMarker(a: PendingGenerateMarker | null | undefined, b: PendingGenerateMarker | null | undefined): boolean {
    if (!a || !b) return false;
    if (typeof a.c !== "string" || typeof b.c !== "string") return false;
    const ca = a.c.trim().toLowerCase(), cb = b.c.trim().toLowerCase();
    if (ca === "" || cb === "") return false;
    return ca === cb;
}

export function decidePendingRecovery(m: PendingGenerateMarker | null, nowMs: number, persistedVersion: number | null | undefined): PendingRecoveryDecision {
    if (!m) return "none";
    if ((persistedVersion ?? 0) >= m.v) return "delivered";
    if (nowMs - m.t > PENDING_RECOVERY_WINDOW_MS) return "expired";
    if (isBlindMarker(m)) return "blind";
    // A clock that went BACKWARDS (t in the future) is treated as fresh, not expired:
    // polling a little longer is the cheap mistake, abandoning a paid chart is not.
    return "poll";
}

/**
 * Did the recovery actually START A PICKUP? Only "poll" does - "expired", "delivered", "blind" and
 * "none" all clear the marker and walk away.
 *
 * ONE definition, because the caller's SENTENCE has to agree with it. Found 2026-08-28: a generate
 * ran nearly seventeen minutes, the transport died, and the transport-lost branch chose its wording
 * from `isBlindMarker` alone - true enough on its own terms, the marker did carry a correlation -
 * while the recovery had already returned "expired" against the window and polled for nothing. The
 * user was told the chart was being checked for and would appear, with nothing checking for
 * anything. A property of the MARKER cannot answer a question about the DECISION; only the decision
 * can.
 */
export function recoveryPollRunning(d: PendingRecoveryDecision): boolean {
    return d === "poll";
}

/**
 * Does the RECOVERY PATH own the sentence for this trigger, or does its caller?
 *
 * On "transport-lost" the host's retry loop is mid-render and already owns the message, which it
 * words from the decision (recoveryPollRunning above). Anything the recovery says on top of that
 * stacks a second sentence stating the same fact, and when both are painted the reader sees it twice
 * in slightly different words - seen 2026-09-04, where the connection-dropped explanation appeared
 * back to back with itself.
 *
 * On a MOUNT (or any other trigger) nothing else speaks, so the recovery must.
 */
export function recoveryOwnsTheSentence(trigger: string): boolean {
    return trigger !== "transport-lost";
}

/**
 * THE ONE-SHOT LATE PICKUP.
 *
 * An EXPIRED marker used to be cleared on sight. But "expired" is a fact about the POLL WINDOW, not
 * about the chart: the service writes the generation when it finishes and serves it by correlation
 * for good. Seen in production: a corporate egress proxy cut the stream at 66 s, the poll armed, the
 * host stopped reporting within seconds, the service finished at 75 s - and a reader who reopened
 * the report later would have found the marker, called it expired, and cleared a finished, charged
 * chart.
 *
 * So a MOUNT that finds an expired marker with a correlation fetches ONCE before letting go:
 *   "fetch"  - a correlation to ask by, and this host instance has not asked for it yet;
 *   "keep"   - this instance already asked (its own poll ran out, or a pickup already tried), so the
 *              marker waits for the NEXT mount - a data refresh seconds after the window closed must not
 *              spend the one fetch before a slow generate has finished;
 *   "clear"  - no marker, or no correlation to ask by (a version is never a safe handle).
 */
export type LatePickupAction = "fetch" | "keep" | "clear";

export function latePickupAction(m: PendingGenerateMarker | null | undefined, triedThisInstance: boolean): LatePickupAction {
    if (!m || isBlindMarker(m)) return "clear";
    return triedThisInstance ? "keep" : "fetch";
}

/**
 * After the late pickup's one fetch: only a TRANSPORT failure keeps the marker - the question never
 * reached the service, so a later mount may still ask. An answer of not-found, or a definitive
 * refusal, is the service saying there is nothing to deliver, and the marker goes.
 */
export function latePickupKeepsMarker(outcome: "found" | "not-yet" | "hard-error" | "transport"): boolean {
    return outcome === "transport";
}

/**
 * When the 15-minute poll runs out ("window-closed"), the marker STAYS for the next mount's late
 * pickup, as long as it carries a correlation. A definitive refusal ("hard-error") still clears it.
 */
export function pollGiveUpKeepsMarker(outcome: string, m: PendingGenerateMarker | null | undefined): boolean {
    return outcome === "window-closed" && !!m && !isBlindMarker(m);
}

/** Milliseconds left in the recovery window from `nowMs`, floored at 0. */
export function pendingRecoveryRemainingMs(m: PendingGenerateMarker, nowMs: number): number {
    return Math.max(0, m.t + PENDING_RECOVERY_WINDOW_MS - (nowMs));
}

/**
 * Whether a transport failure on a generate should hand off to the recovery poll (true) or fall back
 * to the ordinary retry (false). The discriminator is whether the service ACCEPTED the request: a
 * streaming endpoint commits its 200 headers the moment it starts, so headers-received plus a later
 * failure means the generate is running server-side and a retry would make a SECOND chart. No
 * headers means the service never saw it, and retrying is the right move.
 */
export function transportFailureShouldRecover(headersReceived: boolean, genNew: boolean): boolean {
    return headersReceived && genNew;
}
