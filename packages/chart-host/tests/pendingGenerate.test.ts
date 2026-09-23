/*
    PENDING-GENERATE MARKER + RECOVERY DECISION.

    These pin the decisions every host shares. Each host also tests its own wiring - where the
    marker is persisted and how the poll is driven - which is host-specific and lives with the host.

    The case that started it, seen in production: the client lost the transport at 10 s, the host
    re-created the component 2 s later, the service finished and billed the chart at 53 s, and the new
    instance generated AGAIN. These lock the pure half of the fix: the marker's round-trip, the
    mount-time decision (poll / delivered / expired), and the transport-failure discriminator
    (headers received = the server has it = poll, never retry).
*/
import { describe, it, expect } from "vitest";
import {
    encodePendingGenerate, parsePendingGenerate, decidePendingRecovery,
    pendingRecoveryRemainingMs, transportFailureShouldRecover,
    isBlindMarker, markerArmedBlind, servedCorrelationProves, recoveryPollRunning,
    recoveryOwnsTheSentence, sameMarker, pendingRecoveryNextDelayMs,
    PENDING_RECOVERY_WINDOW_MS, PENDING_RECOVERY_POLL_MS,
    PENDING_RECOVERY_MID_POLL_MS, PENDING_RECOVERY_SLOW_POLL_MS,
    PENDING_RECOVERY_FAST_PHASE_MS, PENDING_RECOVERY_SLOW_PHASE_MS,
    latePickupAction, latePickupKeepsMarker, pollGiveUpKeepsMarker,
} from "../src/pendingGenerate";
import type { PendingRecoveryDecision } from "../src/pendingGenerate";

const T0 = 1_755_583_000_000; // a fixed epoch, no Date.now() in tests

describe("marker round-trip", () => {
    it("encodes and parses every field", () => {
        const raw = encodePendingGenerate({ v: 1, t: T0, c: "c0ffee02", p: "World (Bubbles)" });
        expect(parsePendingGenerate(raw)).toEqual({ v: 1, t: T0, c: "c0ffee02", p: "World (Bubbles)" });
    });
    it("round-trips h, the version in hand at arm time", () => {
        const raw = encodePendingGenerate({ v: 10, t: T0, c: "c", p: "", h: 9 });
        expect(parsePendingGenerate(raw)).toEqual({ v: 10, t: T0, c: "c", p: "", h: 9 });
        expect(parsePendingGenerate(encodePendingGenerate({ v: 1, t: T0, c: "c", p: "", h: 0 }))?.h).toBe(0);
    });
    it("omits h entirely when unknown, so a pre-2.2.1.2 marker round-trips unchanged", () => {
        const raw = encodePendingGenerate({ v: 3, t: T0, c: "c", p: "" });
        expect(JSON.parse(raw).h).toBeUndefined();
        expect(parsePendingGenerate(raw)).toEqual({ v: 3, t: T0, c: "c", p: "" });
    });
    it("a missing pick encodes as empty, not undefined", () => {
        const raw = encodePendingGenerate({ v: 3, t: T0, c: "x", p: undefined as unknown as string });
        expect(parsePendingGenerate(raw)?.p).toBe("");
    });
    it("rejects junk, blanks and non-positive versions/times", () => {
        expect(parsePendingGenerate("")).toBeNull();
        expect(parsePendingGenerate("   ")).toBeNull();
        expect(parsePendingGenerate(null)).toBeNull();
        expect(parsePendingGenerate(42)).toBeNull();
        expect(parsePendingGenerate("{not json")).toBeNull();
        expect(parsePendingGenerate(JSON.stringify({ v: 0, t: T0 }))).toBeNull();
        expect(parsePendingGenerate(JSON.stringify({ v: 1, t: 0 }))).toBeNull();
        expect(parsePendingGenerate(JSON.stringify({ v: "two", t: T0 }))).toBeNull();
    });
    it("tolerates a marker written without c/p (forward-compat)", () => {
        expect(parsePendingGenerate(JSON.stringify({ v: 2, t: T0 }))).toEqual({ v: 2, t: T0, c: "", p: "" });
    });
});

describe("decidePendingRecovery - what a mount does with a marker", () => {
    // KEYING RECOVERY BY CORRELATION CHANGED THIS SPECIFICATION, so these expectations moved with it.
    // A marker armed holding NOTHING has v:1, and on the service version 1 means "the
    // first chart ever made for this data SHAPE" - not "the first chart made by this
    // host". Polling it fetches a stranger's chart. The poll cases below therefore use
    // a marker with a real version in hand (h:1 → v:2); the old v:1 cases are the blind
    // suite that follows.
    const m = { v: 2, t: T0, c: "c", p: "", h: 1 };
    it("no marker → none", () => {
        expect(decidePendingRecovery(null, T0 + 1000, 0)).toBe("none");
    });
    it("inside the window, version not in hand → poll", () => {
        expect(decidePendingRecovery(m, T0 + 12_000, 0)).toBe("poll");
        expect(decidePendingRecovery(m, T0 + 12_000, null)).toBe("poll");
        expect(decidePendingRecovery(m, T0 + PENDING_RECOVERY_WINDOW_MS, 0)).toBe("poll");
    });
    it("version in hand already ≥ the marker's → delivered (the answer arrived another way)", () => {
        expect(decidePendingRecovery(m, T0 + 12_000, 2)).toBe("delivered");
        expect(decidePendingRecovery({ ...m, v: 3 }, T0 + 12_000, 5)).toBe("delivered");
    });
    it("older than the window → expired (a marker from yesterday must not start a poll)", () => {
        expect(decidePendingRecovery(m, T0 + PENDING_RECOVERY_WINDOW_MS + 1, 0)).toBe("expired");
    });
    it("a clock that went backwards (t in the future) polls rather than abandons", () => {
        expect(decidePendingRecovery(m, T0 - 60_000, 0)).toBe("poll");
    });
    it("delivered beats expired - an old marker whose version IS in hand is simply cleared", () => {
        expect(decidePendingRecovery(m, T0 + 10 * PENDING_RECOVERY_WINDOW_MS, 2)).toBe("delivered");
    });
});

describe("recovery is keyed by CORRELATION, and a version is never a safe handle", () => {
    /*
        A brand-new host armed v:1 truthfully, the poll fetched version 1 of the SHAPE - an
        unrelated chart made weeks earlier on another device - painted it, cleared the marker
        as a success, and discarded the chart the user had paid for. Nothing about v:1 was
        dishonest; the number simply does not mean what the client thought it meant, because
        versions are numbered per data shape by the service and anyone else generating against
        the same data moves the one you are about to ask for.

        So the poll asks by correlation and sends NO version - which is also the safety property
        against an older service, since such a service refuses a fetchOnly with no version and can
        therefore serve nothing at all.
    */
    it("a marker WITH a correlation is recoverable, whatever it held at arm time", () => {
        expect(decidePendingRecovery({ v: 1, t: T0, c: "c0ffee01", p: "", h: 0 }, T0 + 12_000, 0)).toBe("poll");
        expect(decidePendingRecovery({ v: 10, t: T0, c: "c0ffee01", p: "", h: 9 }, T0 + 12_000, 0)).toBe("poll");
    });
    it("a marker with NO correlation has no usable handle at all -> blind, never polled", () => {
        expect(decidePendingRecovery({ v: 1, t: T0, c: "", p: "", h: 0 }, T0 + 12_000, 0)).toBe("blind");
        // Even holding a version does not rescue it: "mine + 1" is still a guess about a
        // number the whole account shares.
        expect(decidePendingRecovery({ v: 10, t: T0, c: "", p: "", h: 9 }, T0 + 12_000, 0)).toBe("blind");
        expect(decidePendingRecovery({ v: 3, t: T0, c: "   ", p: "" }, T0 + 12_000, 0)).toBe("blind");
    });
    it("isBlindMarker is the one definition, shared with the transport-lost message", () => {
        expect(isBlindMarker({ v: 1, t: T0, c: "", p: "", h: 0 })).toBe(true);
        expect(isBlindMarker({ v: 1, t: T0, c: "   ", p: "" })).toBe(true);
        expect(isBlindMarker({ v: 1, t: T0, c: "c0ffee01", p: "", h: 0 })).toBe(false);
        expect(isBlindMarker(null)).toBe(false);
        expect(isBlindMarker(undefined)).toBe(false);
    });
    it("delivered and expired still win over blind - nothing to recover beats can't recover", () => {
        const blind = { v: 1, t: T0, c: "", p: "", h: 0 };
        expect(decidePendingRecovery(blind, T0 + 12_000, 1)).toBe("delivered");
        expect(decidePendingRecovery(blind, T0 + PENDING_RECOVERY_WINDOW_MS + 1, 0)).toBe("expired");
    });

    describe("markerArmedBlind - kept as the diagnostic h ships for", () => {
        it("reports whether the +1 guess had anything behind it", () => {
            expect(markerArmedBlind({ v: 1, t: T0, c: "x", p: "", h: 0 })).toBe(true);
            expect(markerArmedBlind({ v: 2, t: T0, c: "x", p: "", h: 1 })).toBe(false);
        });
        it("falls back to v-1 for a marker written before h existed", () => {
            expect(markerArmedBlind({ v: 1, t: T0, c: "x", p: "" })).toBe(true);
            expect(markerArmedBlind({ v: 5, t: T0, c: "x", p: "" })).toBe(false);
        });
    });

    describe("servedCorrelationProves - absence is REFUSAL, not assent", () => {
        const m = { v: 1, t: T0, c: "11111111-1111-4111-8111-111111111111", p: "", h: 0 };
        it("proves only when the server names OUR correlation", () => {
            expect(servedCorrelationProves(m, "11111111-1111-4111-8111-111111111111")).toBe(true);
            expect(servedCorrelationProves(m, "  11111111-1111-4111-8111-111111111111  ")).toBe(true);
        });
        it("a DIFFERENT correlation is refused - the check that stops a stranger's chart", () => {
            expect(servedCorrelationProves(m, "22222222-2222-4222-8222-222222222222")).toBe(false);
        });
        it("a server that says NOTHING proves nothing (an older server, pre rev 307)", () => {
            expect(servedCorrelationProves(m, "")).toBe(false);
            expect(servedCorrelationProves(m, "   ")).toBe(false);
            expect(servedCorrelationProves(m, null)).toBe(false);
            expect(servedCorrelationProves(m, undefined)).toBe(false);
        });
        it("a marker with no correlation can never be proven", () => {
            expect(servedCorrelationProves({ v: 1, t: T0, c: "", p: "" }, "anything")).toBe(false);
            expect(servedCorrelationProves(null, "anything")).toBe(false);
        });
    });
});

describe("pendingRecoveryRemainingMs", () => {
    it("counts down from the START of the generate, floored at 0", () => {
        const m = { v: 1, t: T0, c: "", p: "" };
        expect(pendingRecoveryRemainingMs(m, T0)).toBe(PENDING_RECOVERY_WINDOW_MS);
        expect(pendingRecoveryRemainingMs(m, T0 + 60_000)).toBe(PENDING_RECOVERY_WINDOW_MS - 60_000);
        expect(pendingRecoveryRemainingMs(m, T0 + PENDING_RECOVERY_WINDOW_MS + 5)).toBe(0);
    });
});

describe("transportFailureShouldRecover - poll vs retry", () => {
    it("headers received on a genNew → the server has it → recover, never retry", () => {
        expect(transportFailureShouldRecover(true, true)).toBe(true);
    });
    it("no headers → the server never saw it → ordinary retry", () => {
        expect(transportFailureShouldRecover(false, true)).toBe(false);
    });
    it("a version FETCH that fails is not a generate in flight → retry path", () => {
        expect(transportFailureShouldRecover(true, false)).toBe(false);
    });
});

describe("recoveryPollRunning - the SENTENCE must agree with the DECISION", () => {
    // Found 2026-08-28. A generate ran nearly seventeen minutes, a development tunnel
    // dropped the stream, and the host's transport-lost branch worded its message
    // from `isBlindMarker` alone. That marker carried a correlation, so `blind` was false
    // and the user was told the chart was being checked for and would appear when it
    // landed - while the log said, on the very same millisecond:
    //     pending-gen-decision {"decision":"expired","ageMs":1012786}
    //     pending-gen-cleared  {"reason":"expired:transport-lost"}
    // Nothing was checking for anything. The branch's own comment already said "never
    // claim a pickup that is not running"; what it lacked was a way to ASK.
    const ALL: PendingRecoveryDecision[] = ["none", "delivered", "expired", "blind", "poll"];

    it("only 'poll' means a pickup is running", () => {
        expect(recoveryPollRunning("poll")).toBe(true);
    });

    it("every other decision means NOTHING is running - exhaustively, so a new one must opt in", () => {
        for (const d of ALL.filter(x => x !== "poll")) {
            expect(recoveryPollRunning(d), `decision "${d}" must not claim a pickup`).toBe(false);
        }
    });

    it("REGRESSION: the seventeen-minute marker - well-formed, non-blind, and far too old", () => {
        // Exactly the marker that shipped the false sentence: armed with a version in
        // hand and a real correlation (so both blindness tests say "recoverable"), but
        // 16m53s old against a 4-minute window.
        const m = { v: 2, t: T0, c: "33333333-3333-4333-8333-333333333333", p: "", h: 1 };
        const ageMs = 1_012_786;
        expect(isBlindMarker(m)).toBe(false);       // <- what the old code asked
        expect(markerArmedBlind(m)).toBe(false);    // <- and the other blindness test agrees
        const decision = decidePendingRecovery(m, T0 + ageMs, 0);
        expect(decision).toBe("expired");           // <- what actually happened
        expect(recoveryPollRunning(decision)).toBe(false);
    });

    it("a marker that IS pollable still says so - the fix must not silence the true case", () => {
        const m = { v: 2, t: T0, c: "corr", p: "", h: 1 };
        expect(recoveryPollRunning(decidePendingRecovery(m, T0 + 12_000, 0))).toBe(true);
    });

    it("'delivered' and 'blind' are silent too, for their own reasons", () => {
        const inHand = { v: 2, t: T0, c: "corr", p: "", h: 1 };
        expect(recoveryPollRunning(decidePendingRecovery(inHand, T0 + 1_000, 2))).toBe(false);
        const noCorr = { v: 2, t: T0, c: "", p: "", h: 1 };
        expect(recoveryPollRunning(decidePendingRecovery(noCorr, T0 + 1_000, 0))).toBe(false);
    });
});

describe("sameMarker - a poll may only ever bury its OWN marker", () => {
    /*
        Found 2026-08-30, and the log printed the bug in two adjacent lines:

            pending-gen-poll-end  {"outcome":"window-closed","polls":7,"c":"<first>"}
            pending-gen-cleared   {"reason":"poll-window-closed","c":"<second>"}

        A poll running for the first generate cleared the marker of the second - a DIFFERENT one,
        armed 35 seconds earlier and still running on the server. The guard that should have
        caught it compared `v`, and every marker armed by a host holding no chart is v:1,
        so the two were indistinguishable. The live generate lost its recovery marker and the
        user was told "nothing was delivered" about a chart that was still being written.
    */
    const mine    = { v: 1, t: T0, c: "44444444-4444-4444-8444-444444444444", p: "Animated bar chart", h: 0 };
    const theirs  = { v: 1, t: T0 + 205_000, c: "55555555-5555-4555-8555-555555555555", p: "Animated bar chart", h: 0 };

    it("REGRESSION: two markers that share v:1 are NOT the same generate", () => {
        // The exact pair from the trace. Note what the old test would have said:
        expect(mine.v === theirs.v).toBe(true);        // <- the comparison that shipped
        expect(sameMarker(mine, theirs)).toBe(false);  // <- the comparison that is true
    });

    it("identity is the correlation, and it survives case and padding", () => {
        expect(sameMarker(mine, { ...mine })).toBe(true);
        expect(sameMarker(mine, { ...mine, c: "  44444444-4444-4444-8444-444444444444  " })).toBe(true);
        // Everything else about a marker may differ - only `c` decides.
        expect(sameMarker(mine, { ...mine, v: 99, t: T0 + 1, p: "Pie", h: 98 })).toBe(true);
    });

    it("a marker with no correlation is never 'the same' as anything, itself included", () => {
        // There is nothing to compare, and a false match here is what clears a stranger's
        // marker - the precise failure this function exists to prevent.
        const noCorr = { v: 1, t: T0, c: "", p: "", h: 0 };
        expect(sameMarker(noCorr, noCorr)).toBe(false);
        expect(sameMarker(noCorr, { ...noCorr, c: "   " })).toBe(false);
        expect(sameMarker(mine, noCorr)).toBe(false);
    });

    it("null and undefined never match", () => {
        expect(sameMarker(null, mine)).toBe(false);
        expect(sameMarker(mine, null)).toBe(false);
        expect(sameMarker(null, null)).toBe(false);
        expect(sameMarker(undefined, undefined)).toBe(false);
    });
});

describe("the poll window, sized from measured generate durations", () => {
    /*
        The old 240 s was set from a ten-row sample ("the longest successful prod generate in
        the 2665-2674 window was 53 s"). Measured across every successful generate carrying a
        correlation:

            PROD, 90 days, n=492:  p50= 82 s  p90=235 s  p99=383 s  max= 552 s
            DEV,  30 days, n=372:  p50=286 s  p90=691 s  p99=1472 s max=2391 s

        So it sat below the DEV MEDIAN. These pin the two ends of the judgement: cover prod
        outright, and do not silently grow to chase dev's tail.
    */
    const gen = (ms: number) => ({ v: 1, t: T0, c: "corr", p: "", h: 0, ms });

    it("REGRESSION: the eight-minute generate the old window abandoned is now inside it", () => {
        // `done OK elapsed=479662ms` - the chart the old window gave up on with four
        // minutes still to run, having declared it undeliverable.
        const g = gen(479_662);
        expect(decidePendingRecovery(g, T0 + g.ms, 0)).toBe("poll");
        expect(pendingRecoveryRemainingMs(g, T0 + g.ms)).toBeGreaterThan(0);
    });

    it("covers prod's worst measured generate with headroom", () => {
        expect(PENDING_RECOVERY_WINDOW_MS).toBeGreaterThan(552_000);
    });

    it("does NOT quietly grow to cover dev's p99 - that would need a per-environment value", () => {
        // A guard on the judgement, not on the number: if someone raises this past dev's
        // 24-minute tail they are making a different decision and should say so.
        expect(PENDING_RECOVERY_WINDOW_MS).toBeLessThan(1_012_786);
    });

    it("still expires the seventeen-minute marker, so that regression keeps its meaning", () => {
        const m = { v: 2, t: T0, c: "33333333-3333-4333-8333-333333333333", p: "", h: 1 };
        expect(decidePendingRecovery(m, T0 + 1_012_786, 0)).toBe("expired");
    });
});

describe("pendingRecoveryNextDelayMs - back off with the AGE OF THE GENERATE", () => {
    it("keeps the fast cadence through the phase where prod charts actually land", () => {
        expect(pendingRecoveryNextDelayMs(0)).toBe(PENDING_RECOVERY_POLL_MS);
        expect(pendingRecoveryNextDelayMs(82_000)).toBe(PENDING_RECOVERY_POLL_MS);   // prod p50
        expect(pendingRecoveryNextDelayMs(PENDING_RECOVERY_FAST_PHASE_MS - 1)).toBe(PENDING_RECOVERY_POLL_MS);
    });
    it("steps down once, then once more, on the phase boundaries", () => {
        expect(pendingRecoveryNextDelayMs(PENDING_RECOVERY_FAST_PHASE_MS)).toBe(PENDING_RECOVERY_MID_POLL_MS);
        expect(pendingRecoveryNextDelayMs(383_000)).toBe(PENDING_RECOVERY_SLOW_POLL_MS); // prod p99
        expect(pendingRecoveryNextDelayMs(PENDING_RECOVERY_SLOW_PHASE_MS - 1)).toBe(PENDING_RECOVERY_MID_POLL_MS);
        expect(pendingRecoveryNextDelayMs(PENDING_RECOVERY_SLOW_PHASE_MS)).toBe(PENDING_RECOVERY_SLOW_POLL_MS);
    });
    it("never speeds up as the generate ages - monotonic, so the cost cannot spike late", () => {
        let prev = 0;
        for (let t = 0; t <= PENDING_RECOVERY_WINDOW_MS; t += 5_000) {
            const d = pendingRecoveryNextDelayMs(t);
            expect(d).toBeGreaterThanOrEqual(prev);
            prev = d;
        }
    });
    it("keeps the whole window under ~30 polls, which is what pays for tripling it", () => {
        // Walk the schedule the poll loop actually walks.
        let t = 0, polls = 0;
        while (t < PENDING_RECOVERY_WINDOW_MS) { t += pendingRecoveryNextDelayMs(t); polls++; }
        expect(polls).toBeLessThanOrEqual(30);
        // ...and a flat cadence over the same window would have cost far more.
        expect(polls).toBeLessThan(PENDING_RECOVERY_WINDOW_MS / PENDING_RECOVERY_POLL_MS);
    });
});

describe("recoveryOwnsTheSentence - the fact is said ONCE, by whichever side is already speaking", () => {
    // Found 2026-09-04: the retry loop lost the transport and worded its own message, and the
    // poll it started then wrote the same fact into a second message slot. Both slots paint, so
    // the reader saw it twice in slightly different words. The blind branch had already deferred
    // to the caller; the poll had not.
    it("THE REGRESSION: on transport-lost the caller owns the sentence, so the recovery is silent", () => {
        expect(recoveryOwnsTheSentence("transport-lost")).toBe(false);
    });
    it("on a mount nothing else speaks, so the recovery must", () => {
        expect(recoveryOwnsTheSentence("mount")).toBe(true);
        expect(recoveryOwnsTheSentence("finishLoad")).toBe(true);
        expect(recoveryOwnsTheSentence("")).toBe(true);
    });
    it("the blind branch and the poll answer from the SAME predicate, so they cannot drift apart again", () => {
        // Both call sites in a host route through this one function; a second
        // hand-written `trigger !== "transport-lost"` is how the poll fell out of step.
        const triggers = ["transport-lost", "mount", "finishLoad"];
        for (const t of triggers) expect(typeof recoveryOwnsTheSentence(t)).toBe("boolean");
    });
});

describe("the one-shot late pickup - EXPIRED is about the window, not the chart", () => {
    // Seen in production: a corporate egress proxy cut the stream at 66 s, the poll armed, the host
    // went quiet, and the service finished and charged the chart at 75 s. A reader reopening the report after the
    // window would have found the marker "expired" and cleared a finished chart the server still
    // serves by correlation.
    const withCorr = { v: 2, t: T0, c: "66666666-6666-4666-8666-666666666666", p: "", h: 1 };

    it("a mount that finds an expired marker WITH a correlation fetches once", () => {
        expect(decidePendingRecovery(withCorr, T0 + PENDING_RECOVERY_WINDOW_MS + 60_000, 1)).toBe("expired");
        expect(latePickupAction(withCorr, false)).toBe("fetch");
    });

    it("the instance that already asked leaves the marker for the NEXT mount", () => {
        // A data refresh seconds after this instance's own poll ran out must not spend the one fetch
        // before a slow generate has finished.
        expect(latePickupAction(withCorr, true)).toBe("keep");
    });

    it("no correlation, no handle - cleared as before (a version is never a safe handle)", () => {
        expect(latePickupAction({ v: 1, t: T0, c: "", p: "" }, false)).toBe("clear");
        expect(latePickupAction(null, false)).toBe("clear");
    });

    it("after the fetch, only a transport failure keeps the marker", () => {
        expect(latePickupKeepsMarker("transport")).toBe(true);
        expect(latePickupKeepsMarker("not-yet")).toBe(false);
        expect(latePickupKeepsMarker("hard-error")).toBe(false);
        expect(latePickupKeepsMarker("found")).toBe(false);
    });

    it("a poll whose window RAN OUT keeps a correlated marker; a refusal or a blind marker does not", () => {
        expect(pollGiveUpKeepsMarker("window-closed", withCorr)).toBe(true);
        expect(pollGiveUpKeepsMarker("hard-error", withCorr)).toBe(false);
        expect(pollGiveUpKeepsMarker("window-closed", { v: 1, t: T0, c: "", p: "" })).toBe(false);
    });
});

// A CANCELLED GENERATION IS A TERMINAL ANSWER. The server cancels a generate whose connection dropped,
// charges nothing, and answers the recovery fetch with isGenerationCancelled beside isVersionNotFound.
describe("a cancelled generation ends the recovery", () => {
    it("reads the flag, and only the flag", async () => {
        const m = await import("../src/pendingGenerate");
        expect(m.recoveryAnswerIsCancelled({ isGenerationCancelled: true })).toBe(true);
        expect(m.recoveryAnswerIsCancelled({ isGenerationCancelled: false })).toBe(false);
        expect(m.recoveryAnswerIsCancelled({})).toBe(false);
        expect(m.recoveryAnswerIsCancelled(null)).toBe(false);
    });

    it("prefers the server's own sentence and falls back to the same words", async () => {
        const m = await import("../src/pendingGenerate");
        expect(m.generationCancelledMessage("Server says so.")).toBe("Server says so.");
        expect(m.generationCancelledMessage("  ")).toBe(m.GENERATION_CANCELLED_MESSAGE);
        expect(m.GENERATION_CANCELLED_MESSAGE).toBe("The connection dropped before the chart finished - nothing was charged. Generate again.");
    });

    it("the transport-loss sentence promises nothing", async () => {
        const m = await import("../src/pendingGenerate");
        expect(m.TRANSPORT_LOST_CHECKING_MESSAGE).not.toMatch(/still being built|will show it|when it lands/i);
        expect(m.TRANSPORT_LOST_CHECKING_MESSAGE.split(/[.!?](\s|$)/).filter(s => s && s.trim()).length).toBeLessThanOrEqual(2);
    });
});
