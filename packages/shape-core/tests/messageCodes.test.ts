// The server's message codes, read by the shared parsers and decided on by the shared helpers.
//
// The property every case holds: the SAME answer with its text in another language is read and
// decided identically, because the code - never the sentence - is what a host branches on. An older
// server that sends no code degrades to exactly what hosts did before.
import { describe, it, expect } from "vitest";
import {
    parseGenerateResponse, parseQualifyResponse, parseReviewVerdict, readGenerateStream,
    progressStageOf, answerIsRetryable, PROGRESS_STAGE_IDS, FREEMIUM_ATTEMPT_SPENT, CLIENT_SECRET_MISMATCH,
    FREEMIUM_COLUMN_CAP,
} from "../src/index";
import type { WireResponse } from "../src/index";

function pascalize(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(pascalize);
    if (v && typeof v === "object") {
        return Object.fromEntries(Object.entries(v as Record<string, unknown>)
            .map(([k, x]) => [k.charAt(0).toUpperCase() + k.slice(1), pascalize(x)]));
    }
    return v;
}

/** A provider timeout, as the server serialises it (other fields trimmed to the ones that matter). */
const TIMEOUT = {
    errorMessage: "The AI service took too long to respond. Please try again.", errorCode: "PROVIDER_TIMEOUT",
    retryable: true, isServiceError: true, notices: null, code: null, freemiumStatusCode: null, refusalCode: null,
};
/** The same answer with its sentence translated - what a translated server sends a Spanish reader. */
const TIMEOUT_ES = { ...TIMEOUT, errorMessage: "El servicio de IA tardó demasiado en responder. Inténtalo de nuevo." };

/** A chart with a composed two-sentence warning. */
const WARNED = {
    code: "function render(){}", errorMessage: null, errorCode: null, retryable: null,
    warningMessage: "Revenue is a rate; it was averaged, not summed. Showing Bar chart instead of Pie chart.",
    notices: [
        { code: "summed-rate", severity: "data", text: "Revenue is a rate; it was averaged, not summed." },
        { code: "pick-substituted", severity: "substituted", text: "Showing Bar chart instead of Pie chart." },
        { code: "empty", severity: "advisory", text: "" },
    ],
};

describe("parseGenerateResponse reads the codes", () => {
    it("errorCode and the retry flag, in either casing", () => {
        const p = parseGenerateResponse(TIMEOUT);
        expect([p.errorCode, p.retryable]).toEqual(["PROVIDER_TIMEOUT", true]);
        expect(parseGenerateResponse(pascalize(TIMEOUT))).toEqual(p);
    });

    it("a translated sentence reads the same code and the same retry decision", () => {
        const en = parseGenerateResponse(TIMEOUT), es = parseGenerateResponse(TIMEOUT_ES);
        expect([es.errorCode, es.retryable, answerIsRetryable(es)]).toEqual([en.errorCode, en.retryable, answerIsRetryable(en)]);
    });

    it("the retry flag is three-state: true, false, or not said", () => {
        expect(parseGenerateResponse({ retryable: false }).retryable).toBe(false);
        for (const v of [null, undefined, "true", 1, {}]) expect(parseGenerateResponse({ retryable: v }).retryable, String(v)).toBeNull();
    });

    it("notices in the server's order, typed, with the empty one dropped; their texts join to the warning", () => {
        const p = parseGenerateResponse(WARNED);
        expect(p.notices).toEqual([
            { code: "summed-rate", severity: "data", text: "Revenue is a rate; it was averaged, not summed." },
            { code: "pick-substituted", severity: "substituted", text: "Showing Bar chart instead of Pie chart." },
        ]);
        expect(p.notices.map(n => n.text).join(" ")).toBe(p.warningMessage);
        expect(parseGenerateResponse(pascalize(WARNED)).notices).toEqual(p.notices);
        expect(parseGenerateResponse({ notices: "nope" }).notices).toEqual([]);
    });

    it("the freemium state and the refusal code", () => {
        const p = parseGenerateResponse({ freemiumStatusCode: FREEMIUM_ATTEMPT_SPENT, refusalCode: FREEMIUM_COLUMN_CAP, isRefusal: true });
        expect([p.freemiumStatusCode, p.refusalCode]).toEqual(["FREEMIUM_ATTEMPT_SPENT", "FREEMIUM_COLUMN_CAP"]);
    });

    it("an older server - no codes at all - reads as not said", () => {
        const p = parseGenerateResponse({ errorMessage: "The AI service took too long to respond." });
        expect([p.errorCode, p.retryable, p.notices, p.freemiumStatusCode, p.refusalCode]).toEqual(["", null, [], "", ""]);
        expect(answerIsRetryable(p)).toBeNull();
    });
});

describe("parseQualifyResponse and parseReviewVerdict read the codes", () => {
    it("a refusal's reasonCode beside its reason, and the answer's errorCode", () => {
        const body = {
            errorMessage: null, errorCode: null, charts: [],
            refused: [{ name: "Arc diagram", reason: "an Arc diagram needs 2 category fields", reasonCode: "MIN_CATEGORY_FIELDS", isVeto: true }],
        };
        const p = parseQualifyResponse(body);
        expect(p.refused[0].reasonCode).toBe("MIN_CATEGORY_FIELDS");
        expect(parseQualifyResponse(pascalize(body))).toEqual(p);
        expect(parseQualifyResponse({ errorMessage: "No.", errorCode: "QUALIFY_ACCESS_DENIED" }).errorCode).toBe("QUALIFY_ACCESS_DENIED");
    });

    it("a review verdict's errorCode", () => {
        expect(parseReviewVerdict({ Status: "REFUSED", ErrorMessage: "Licensed only.", ErrorCode: "REVIEW_LICENSED_ONLY" })!.errorCode)
            .toBe("REVIEW_LICENSED_ONLY");
    });
});

describe("the progress stage, by its code first", () => {
    const streamed = (lines: string[]): WireResponse => ({
        status: 200, contentType: "application/x-ndjson", body: null, text: async () => lines.join(""),
    });
    const line = (o: object) => JSON.stringify(o) + "\n";

    it("the stream hands each progress line's stageId to the host beside its label", async () => {
        const seen: Array<[string, string | undefined]> = [];
        await readGenerateStream(streamed([
            line({ type: "progress", stage: "Working", stageId: "working" }),
            line({ Type: "progress", Stage: "Analizando tus datos", StageId: "analyze" }),
            line({ type: "progress", stage: "Generating your chart" }),                 // an older server
            line({ type: "result", result: { code: "x" } }),
        ]), (stage, stageId) => seen.push([stage, stageId]));
        expect(seen).toEqual([["Working", "working"], ["Analizando tus datos", "analyze"], ["Generating your chart", undefined]]);
    });

    it("a known code wins over the label, whatever language the label is in", () => {
        expect(progressStageOf("analyze", "Analizando tus datos")).toBe("analyze");
        expect(progressStageOf("review", "Analyzing")).toBe("review");
        expect(progressStageOf("REFINE", "")).toBe("refine");
        for (const id of PROGRESS_STAGE_IDS) expect(progressStageOf(id, "texto traducido")).toBe(id);
    });

    it("with no code (an older server), reads the English label the way hosts always did", () => {
        expect(progressStageOf(undefined, "Analyzing your data")).toBe("analyze");
        expect(progressStageOf(null, "Generating your chart")).toBe("generate");
        expect(progressStageOf("", "Refining")).toBe("refine");
        expect(progressStageOf(undefined, "Reviewing the output")).toBe("review");
        expect(progressStageOf(undefined, "Working")).toBeNull();
        expect(progressStageOf("some-future-stage", "Analizando")).toBeNull();
    });
});

describe("the codes a host branches on", () => {
    it("are the server's spelling", () => {
        expect([FREEMIUM_ATTEMPT_SPENT, CLIENT_SECRET_MISMATCH, FREEMIUM_COLUMN_CAP])
            .toEqual(["FREEMIUM_ATTEMPT_SPENT", "CLIENT_SECRET_MISMATCH", "FREEMIUM_COLUMN_CAP"]);
        expect([...PROGRESS_STAGE_IDS]).toEqual(["working", "analyze", "generate", "refine", "review"]);
    });

    it("answerIsRetryable reads only the flag", () => {
        expect(answerIsRetryable({ retryable: true })).toBe(true);
        expect(answerIsRetryable({ retryable: false })).toBe(false);
        expect(answerIsRetryable({ retryable: null })).toBeNull();
        expect(answerIsRetryable(null)).toBeNull();
    });
});
