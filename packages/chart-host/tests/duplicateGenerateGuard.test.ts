import { describe, it, expect } from "vitest";
import {
    isDuplicateGenerate,
    armGenerateGuard,
    DUPLICATE_GENERATE_WINDOW_MS,
    type GenerateGuardKey,
} from "../src/index";

// A production visual sent the same shape twice for a single user action: two identical refusals,
// one chart instance, 510 ms apart, nothing charged. It was free, which is why it survived - the only
// symptom was a doubled count on the refusal path.
//
// The tests below are built around the two facts that decide the design: the calls were SEQUENTIAL
// (so an in-flight flag catches nothing), and a real user cannot re-generate inside the window (so a
// short window cannot cost anybody a chart). They were written against the visual's own copy of this
// guard and moved here with every expected value unchanged.

const KEY: GenerateGuardKey = { schemaHash: 12345, gennew: true, favorStyle: "", trycnt: 0 };

describe("duplicate generate guard", () => {
    it("lets the first generate of an instance through", () => {
        expect(isDuplicateGenerate(null, KEY, 1000)).toBe(false);
        expect(isDuplicateGenerate(undefined, KEY, 1000)).toBe(false);
    });

    it("suppresses the SEQUENTIAL double-fire that production actually produced", () => {
        // The first call ran 12.740 -> 12.906; the second started at 13.250. The first had already
        // RETURNED, so inFlight is false and only the window can catch it.
        const prev = armGenerateGuard(KEY, 12_740);
        prev.inFlight = false;                     // the first call completed at 12.906
        expect(isDuplicateGenerate(prev, KEY, 13_250)).toBe(true);
    });

    it("suppresses a genuinely concurrent second call too", () => {
        const prev = armGenerateGuard(KEY, 1000);  // still running
        expect(prev.inFlight).toBe(true);
        expect(isDuplicateGenerate(prev, KEY, 1100)).toBe(true);
    });

    it("NEVER suppresses a retry - the retry counter is part of the identity", () => {
        // A retry loop that counts down fires the generate again within milliseconds. Suppressing
        // one of those would be a far worse bug than the one being fixed.
        const prev = armGenerateGuard({ ...KEY, trycnt: 2 }, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, { ...KEY, trycnt: 1 }, 1010)).toBe(false);
        expect(isDuplicateGenerate(prev, { ...KEY, trycnt: 0 }, 1020)).toBe(false);
    });

    it("NEVER suppresses after the user changes fields", () => {
        // The path a refused user is most likely to take: read the reason, add the missing column,
        // generate again. A field change moves the schema hash, so the guard cannot see it as a
        // duplicate however fast it happens.
        const prev = armGenerateGuard(KEY, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, { ...KEY, schemaHash: 999 }, 1200)).toBe(false);
    });

    it("NEVER suppresses a different intent", () => {
        const prev = armGenerateGuard(KEY, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, { ...KEY, gennew: false }, 1200)).toBe(false);
        expect(isDuplicateGenerate(prev, { ...KEY, favorStyle: "Bar chart" }, 1200)).toBe(false);
    });

    it("lets an identical request through once the window has passed", () => {
        const prev = armGenerateGuard(KEY, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, KEY, 1000 + DUPLICATE_GENERATE_WINDOW_MS - 1)).toBe(true);
        expect(isDuplicateGenerate(prev, KEY, 1000 + DUPLICATE_GENERATE_WINDOW_MS)).toBe(false);
        expect(isDuplicateGenerate(prev, KEY, 1000 + DUPLICATE_GENERATE_WINDOW_MS + 1)).toBe(false);
    });

    it("the window is far shorter than a generation and far longer than a double-fire", () => {
        // The number has to sit in a gap, and the gap is wide: a refusal returns in ~170 ms and a
        // real generation takes 25-300 s. Anything in between is a machine firing twice.
        expect(DUPLICATE_GENERATE_WINDOW_MS).toBeGreaterThan(510);   // the observed gap
        expect(DUPLICATE_GENERATE_WINDOW_MS).toBeLessThan(25_000);   // the fastest real generation
    });

    it("lets the request through when the clock moves backwards", () => {
        // A duplicated generate costs one generation; a wrongly suppressed one costs the user their
        // chart. When elapsed time is unreadable, fail toward the cheaper mistake.
        const prev = armGenerateGuard(KEY, 5000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, KEY, 4000)).toBe(false);
    });

    it("arms with the request identity and marks it in flight", () => {
        const armed = armGenerateGuard(KEY, 777);
        expect(armed).toMatchObject({ ...KEY, startedAt: 777, inFlight: true });
    });
});

describe("duplicate generate guard - a host that also keys on intent and typed text", () => {
    const TYPED: GenerateGuardKey = { ...KEY, intent: "generate", text: "revenue by region" };

    it("suppresses the same typed request fired twice", () => {
        const prev = armGenerateGuard(TYPED, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, { ...TYPED }, 1300)).toBe(true);
    });

    it("never suppresses a different typed text - the reader asked for something else", () => {
        const prev = armGenerateGuard(TYPED, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, { ...TYPED, text: "revenue by segment" }, 1300)).toBe(false);
    });

    it("never suppresses a different intent - an adjustment is not the generate before it", () => {
        const prev = armGenerateGuard(TYPED, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, { ...TYPED, intent: "similar" }, 1300)).toBe(false);
    });

    it("reads an absent intent or text as the empty one, so a host that passes none is unchanged", () => {
        const prev = armGenerateGuard(KEY, 1000);
        prev.inFlight = false;
        expect(isDuplicateGenerate(prev, { ...KEY, intent: "", text: "" }, 1300)).toBe(true);
        expect(isDuplicateGenerate(prev, { ...KEY, text: "x" }, 1300)).toBe(false);
    });

    it("the state it records carries the intent and text it was armed with", () => {
        const s = armGenerateGuard(TYPED, 5);
        expect([s.intent, s.text, s.startedAt, s.inFlight]).toEqual(["generate", "revenue by region", 5, true]);
    });
});
