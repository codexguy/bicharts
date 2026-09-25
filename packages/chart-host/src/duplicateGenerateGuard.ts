// DUPLICATE-GENERATE SUPPRESSION: one user action must never send the same generate twice.
//
// THE EVIDENCE. A production visual produced two identical refusals from one chart instance, 510 ms
// apart, with byte-identical text, zero tokens and no charge. Nobody presses Generate twice in half
// a second, so the client sent the shape twice for one user action.
//
// IT WAS FREE, WHICH IS EXACTLY WHY IT SURVIVED. Nothing was billed and no user saw an error; the
// only trace was a doubled count on the refusal path. The next double-fire on a path that DOES cost
// money is the same defect with an invoice attached.
//
// WHY AN "IN FLIGHT" FLAG IS NOT ENOUGH. Measured from the log: the first call ran 12.740 -> 12.906
// and the second STARTED at 13.250 - 344 ms after the first had already returned. The two calls
// were SEQUENTIAL, not concurrent, so a re-entrancy flag would have caught nothing. Suppression has
// to survive past the end of the first call, which means a short window.
//
// WHAT MAKES THE WINDOW SAFE. The key includes the schema hash, the fresh-generation flag, the
// explicit chart pick AND the retry counter:
//
//   - schema hash  - a change of fields changes the hash, so a re-generate after an edit is never
//                    suppressed. This protects the "fix the data and try again" path that a
//                    refused user is most likely to take.
//   - trycnt       - a retry loop that counts down carries a different value on every retry, so a
//                    retry passes straight through. Suppressing a retry would be a far worse bug
//                    than the one being fixed.
//   - gennew, pick - a different intent is a different request.
//   - intent, text - optional, for a host whose request carries more than the above (an adjustment's
//                    intent, the reader's typed request): a different one is a different request.
//
// And the window is 2.5 s against a generation that takes 25-300 s. A user cannot receive a chart
// and ask for another one inside it; the only thing that fits in 2.5 s is a machine firing twice.
// A refusal returns in ~170 ms, so the window has to cover that gap - but a person reacting to a
// refusal has to read it, change something and act, which moves the schema hash anyway.
//
// Pure and side-effect free: the host passes its clock reading and keeps the state.

/** What identifies one generate request for suppression purposes. */
export interface GenerateGuardKey {
    /** Field/column fingerprint. A field change moves this, and must not be suppressed. */
    schemaHash: number;
    /** A fresh generation vs a fetch/regeneration - different intents. */
    gennew: boolean;
    /** The explicit chart-type pick ("" when the picker is free to choose). */
    favorStyle: string;
    /** The retry counter. Differs on every retry, so a retry is never suppressed. */
    trycnt: number;
    /**
     * Anything else the host's request asks for that makes it a different request - an adjustment's
     * intent, a chosen projection. Absent and "" are the same. A host that keys only on the fields
     * above passes none, and its guard behaves exactly as before.
     */
    intent?: string;
    /**
     * The reader's typed request text. A different text is a different request and always passes.
     * Absent and "" are the same.
     */
    text?: string;
}

/** The last generate a host started, plus whether it is still running. */
export interface GenerateGuardState extends GenerateGuardKey {
    /** The host's clock (performance.now()) when the call STARTED. */
    startedAt: number;
    /** True from the start of the generate until it settles. */
    inFlight: boolean;
}

/** Two calls this close together, with everything else equal, are one user action. */
export const DUPLICATE_GENERATE_WINDOW_MS = 2500;

function sameRequest(a: GenerateGuardKey, b: GenerateGuardKey): boolean {
    return a.schemaHash === b.schemaHash
        && a.gennew === b.gennew
        && a.trycnt === b.trycnt
        && a.favorStyle === b.favorStyle
        && (a.intent ?? "") === (b.intent ?? "")
        && (a.text ?? "") === (b.text ?? "");
}

/**
 * Should this generate be suppressed as a duplicate of the one before it?
 *
 * Suppress when the request is identical AND either the previous call is still running, or it
 * started within the window. Anything else proceeds.
 *
 * @param prev  what the host last started, or null on its first generate
 * @param next  the request about to be made
 * @param now   the host's clock (performance.now()) at the moment of the call
 */
export function isDuplicateGenerate(
    prev: GenerateGuardState | null | undefined,
    next: GenerateGuardKey,
    now: number,
): boolean {
    if (!prev) return false;
    if (!sameRequest(prev, next)) return false;
    if (prev.inFlight) return true;
    const elapsed = now - prev.startedAt;
    // A negative elapsed means the clock moved backwards under us. Treat it as "cannot tell" and
    // let the request through: a duplicated generate costs one generation, a wrongly suppressed
    // one costs the user their chart.
    if (elapsed < 0) return false;
    return elapsed < DUPLICATE_GENERATE_WINDOW_MS;
}

/** The state to record when a generate is allowed to proceed. */
export function armGenerateGuard(next: GenerateGuardKey, now: number): GenerateGuardState {
    return { ...next, startedAt: now, inFlight: true };
}
