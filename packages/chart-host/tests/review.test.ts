import { describe, it, expect } from "vitest";
import { shouldReview, buildReviewWire, bareBase64, actionFor, type ReviewGate, type ReviewVerdict } from "../src/review";

// The vision review's decision core. The through-line under test: EVERY ambiguous state
// resolves toward the outcome that costs the user nothing — an unreadable verdict keeps the
// chart, a proposal with no instruction keeps the chart, and nothing here can ever produce a
// charge on its own (the one billing call sits behind an explicit human yes in the host).

const openGate = (over: Partial<ReviewGate> = {}): ReviewGate => ({
    enabled: true,
    modeLicensed: true,
    firstRenderAfterGenerate: true,
    codeVersion: 3,
    reviewedVersions: new Set<number>(),
    inFlight: false,
    ...over,
});

describe("shouldReview: every clause is a reason NOT to", () => {
    it("fires only when every gate is open", () => {
        expect(shouldReview(openGate())).toBe(true);
    });

    it("is strictly opt-in", () => {
        expect(shouldReview(openGate({ enabled: false }))).toBe(false);
    });

    it("is licensed-only", () => {
        expect(shouldReview(openGate({ modeLicensed: false }))).toBe(false);
    });

    it("reviews only the FIRST render after a generate — never a resize or restore repaint", () => {
        expect(shouldReview(openGate({ firstRenderAfterGenerate: false }))).toBe(false);
    });

    it("needs a real version on screen", () => {
        expect(shouldReview(openGate({ codeVersion: 0 }))).toBe(false);
        expect(shouldReview(openGate({ codeVersion: null }))).toBe(false);
        expect(shouldReview(openGate({ codeVersion: undefined }))).toBe(false);
    });

    it("never re-reviews a version — a fix of a fix of a fix is a billing loop", () => {
        expect(shouldReview(openGate({ reviewedVersions: new Set([3]) }))).toBe(false);
    });

    it("never overlaps itself", () => {
        expect(shouldReview(openGate({ inFlight: true }))).toBe(false);
    });
});

describe("bareBase64 / buildReviewWire", () => {
    it("strips a data-URL prefix and keeps its media type", () => {
        expect(bareBase64("data:image/png;base64,AAAA")).toEqual({ b64: "AAAA", mediaType: "image/png" });
        expect(bareBase64("data:image/svg+xml;base64,BBBB")).toEqual({ b64: "BBBB", mediaType: "image/svg+xml" });
    });

    it("passes bare base64 through as PNG", () => {
        expect(bareBase64("CCCC")).toEqual({ b64: "CCCC", mediaType: "image/png" });
        expect(bareBase64("")).toEqual({ b64: "", mediaType: "image/png" });
    });

    it("builds the wire with every nullable coerced to a string", () => {
        const w = buildReviewWire({
            request: { genNew: false }, capture: "data:image/png;base64,ZZ", version: 4,
            originalAsk: null, codeSummary: undefined, chartType: "Bar chart", correlationId: null,
        });
        expect(w.imageBase64).toBe("ZZ");
        expect(w.version).toBe(4);
        expect(w.originalAsk).toBe("");
        expect(w.codeSummary).toBe("");
        expect(w.chartType).toBe("Bar chart");
        expect(w.correlationId).toBe("");
        // The judging call NEVER carries an instruction — its presence is what bills.
        expect(w.applyInstruction).toBeUndefined();
    });
});

describe("actionFor: ambiguity resolves free", () => {
    const proposed = (over: Partial<ReviewVerdict> = {}): ReviewVerdict => ({
        status: "PROPOSED",
        verdictReason: "The y-axis labels overlap.",
        instruction: "Reduce the tick count to 4.",
        ...over,
    });

    it("a proposal becomes a question, never an application", () => {
        const a = actionFor(proposed());
        expect(a.kind).toBe("propose");
        if (a.kind !== "propose") throw new Error("unreachable");
        expect(a.instruction).toBe("Reduce the tick count to 4.");
    });

    it("a proposal with no instruction keeps the chart — an empty dialog is worse than silence", () => {
        expect(actionFor(proposed({ instruction: "" })).kind).toBe("keep");
        expect(actionFor(proposed({ instruction: "   " })).kind).toBe("keep");
        expect(actionFor(proposed({ instruction: null })).kind).toBe("keep");
    });

    it("the accepted round-trip's OK-with-fix applies", () => {
        expect(actionFor({ status: "OK", fix: { version: 5 } }).kind).toBe("apply-fix");
    });

    it("OK without a fix keeps", () => {
        expect(actionFor({ status: "OK" }).kind).toBe("keep");
    });

    it("NOCHANGE, REFUSED, ERROR, null and novel statuses all keep, silently", () => {
        for (const v of [
            { status: "NOCHANGE" }, { status: "REFUSED", errorMessage: "licence" },
            { status: "ERROR" }, { status: "SOMETHING_NEW" }, null, undefined,
        ] as (ReviewVerdict | null | undefined)[]) {
            const a = actionFor(v);
            expect(a.kind).toBe("keep");
            if (a.kind === "keep") expect(a.userVisible).toBe(false);
        }
    });

    it("instruction and reason arrive trimmed, so no host renders ragged whitespace", () => {
        const a = actionFor(proposed({ instruction: "  do it  ", verdictReason: "  why  " }));
        if (a.kind !== "propose") throw new Error("expected propose");
        expect(a.instruction).toBe("do it");
        expect(a.reason).toBe("why");
    });
});
