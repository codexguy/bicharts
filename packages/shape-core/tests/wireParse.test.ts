import { describe, it, expect } from "vitest";
import {
    parseGenerateResponse, parseQualifyResponse, parseReviewVerdict, type ParsedGenerateResponse,
} from "../src/index";

// KNOWN ANSWERS over response bodies shaped exactly as the server serialises them - every
// property present, null where it has nothing to say - in camelCase, and again with every key
// (nested rows included) in PascalCase. A field a host needs must read identically either way.

/** Every key, at every depth, with its first letter upper-cased. */
function pascalize(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(pascalize);
    if (v && typeof v === "object") {
        return Object.fromEntries(Object.entries(v as Record<string, unknown>)
            .map(([k, x]) => [k.charAt(0).toUpperCase() + k.slice(1), pascalize(x)]));
    }
    return v;
}

const NULL_POINTS = {
    pointCityColumn: null, pointStateColumn: null, pointZipColumn: null, pointLatColumn: null,
    pointLonColumn: null, pointCountryColumn: null, destPointCityColumn: null, destPointStateColumn: null,
    destPointZipColumn: null, destPointLatColumn: null, destPointLonColumn: null, destPointCountryColumn: null,
};

/** A successful point-map generation, as the server serialises it. */
const POINT_MAP = {
    errorMessage: null, code: "function render(c, d, o) {}", version: 4, codeSummary: "Revenue by city",
    chartName: "North America (Bubbles)", isServiceError: false, isRefusal: false, refusalCode: null,
    isRateLimited: false, retryAfterSeconds: null, isVersionNotFound: false, isGenerationCancelled: false,
    servedCorrelationId: null, creditBalanceBefore: 120, creditCost: 3,
    outputHash: "6f1c2c1e-0b7e-4d4a-9f0e-6c5b7f1a2d33", warningMessage: null, advisoryForceShow: false,
    overrideThumbnailUpload: false, forceClientLogging: false, language: "D3", rendererSpecificPayload: null,
    signedLLMRequestID: "sig-1", editCodeKey: "ek-1", improvementSuggestion: null,
    finalChartName: "North America (Bubbles)", suppressSelectionGlyph: false, geoColumn: null,
    geoKind: "north-america", ...NULL_POINTS, pointCityColumn: "City", pointStateColumn: "State",
    freemiumPercentUsed: null, freemiumExhausted: null, userReply: null, userReplyOutcome: null,
    validatorToken: "vt-1",
};

const POINT_MAP_PARSED: ParsedGenerateResponse = {
    errorMessage: "", code: "function render(c, d, o) {}", language: "D3", version: 4,
    codeSummary: "Revenue by city", chartName: "North America (Bubbles)",
    finalChartName: "North America (Bubbles)", warningMessage: "",
    outputHash: "6f1c2c1e-0b7e-4d4a-9f0e-6c5b7f1a2d33", validatorToken: "vt-1", editCodeKey: "ek-1",
    signedLLMRequestID: "sig-1", userReply: "", userReplyOutcome: "", improvementSuggestion: "",
    geoColumn: "", geoKind: "north-america", geoPointCols: { city: "City", state: "State" },
    creditBalanceBefore: 120, creditCost: 3, isServiceError: false, isRateLimited: false,
    isRefusal: false, isVersionNotFound: false, isGenerationCancelled: false,
    retryAfterSeconds: null, servedCorrelationId: "",
};

/** An origin-destination flow map: both ends named. */
const ROUTE = {
    ...POINT_MAP, chartName: "Origin-Destination Flow Map", geoKind: "world", ...NULL_POINTS,
    pointCityColumn: "Origin Port", pointCountryColumn: "Origin Country",
    destPointCityColumn: "Destination Port", destPointCountryColumn: "Destination Country",
};

/** A throttle: a considered refusal carrying the measured wait. */
const THROTTLED = {
    ...POINT_MAP, code: null, version: null, codeSummary: null, chartName: null, finalChartName: null,
    errorMessage: "The service is busy - try again in about a minute.", isRateLimited: true,
    retryAfterSeconds: 42, creditBalanceBefore: null, creditCost: 0, outputHash: null,
    signedLLMRequestID: null, editCodeKey: null, validatorToken: null, geoKind: null, ...NULL_POINTS,
};

/** A fetch by correlation that finds nothing yet, then one the server cancelled. */
const NOT_YET = { ...THROTTLED, errorMessage: "Not ready.", isRateLimited: false, retryAfterSeconds: null,
    isVersionNotFound: true, servedCorrelationId: "corr-7" };
const CANCELLED = { ...NOT_YET, errorMessage: "Stopped - nothing was charged.", isGenerationCancelled: true };

describe("parseGenerateResponse", () => {
    it("a point map: every field typed, the binding packed from the columns the server named", () => {
        expect(parseGenerateResponse(POINT_MAP)).toEqual(POINT_MAP_PARSED);
    });

    it("a route: the second endpoint nested under dest, after the origin's roles", () => {
        const p = parseGenerateResponse(ROUTE);
        expect(p.geoPointCols).toEqual({
            city: "Origin Port", country: "Origin Country",
            dest: { city: "Destination Port", country: "Destination Country" },
        });
        expect(JSON.stringify(p.geoPointCols)).toBe(
            '{"city":"Origin Port","country":"Origin Country","dest":{"city":"Destination Port","country":"Destination Country"}}');
    });

    it("a throttle carries its wait only when the server sent a finite number", () => {
        const p = parseGenerateResponse(THROTTLED);
        expect(p.errorMessage).toBe("The service is busy - try again in about a minute.");
        expect(p.isRateLimited).toBe(true);
        expect(p.retryAfterSeconds).toBe(42);
        expect(p.code).toBe("");
        expect(p.version).toBe(0);
        expect(p.geoPointCols).toBeNull();
        expect(parseGenerateResponse({ ...THROTTLED, retryAfterSeconds: "42" }).retryAfterSeconds).toBeNull();
        expect(parseGenerateResponse({ ...THROTTLED, retryAfterSeconds: Infinity }).retryAfterSeconds).toBeNull();
        expect(parseGenerateResponse({ ...THROTTLED, retryAfterSeconds: null }).retryAfterSeconds).toBeNull();
    });

    it("the recovery answers: still running, and cancelled", () => {
        const a = parseGenerateResponse(NOT_YET);
        expect([a.isVersionNotFound, a.isGenerationCancelled, a.servedCorrelationId]).toEqual([true, false, "corr-7"]);
        const b = parseGenerateResponse(CANCELLED);
        expect([b.isVersionNotFound, b.isGenerationCancelled]).toEqual([true, true]);
    });

    for (const [name, body] of Object.entries({ POINT_MAP, ROUTE, THROTTLED, NOT_YET, CANCELLED })) {
        it(`${name} reads the same in PascalCase`, () => {
            expect(parseGenerateResponse(pascalize(body))).toEqual(parseGenerateResponse(body));
        });
    }

    it("a flag is true only when the server sent true", () => {
        for (const v of ["true", 1, "yes", {}, null, undefined, false]) {
            const p = parseGenerateResponse({ isServiceError: v, isRateLimited: v, isRefusal: v, isVersionNotFound: v, isGenerationCancelled: v });
            expect([p.isServiceError, p.isRateLimited, p.isRefusal, p.isVersionNotFound, p.isGenerationCancelled], String(v))
                .toEqual([false, false, false, false, false]);
        }
    });

    it("credit numbers: a number, a numeric string, else null", () => {
        expect(parseGenerateResponse({ creditBalanceBefore: 0, creditCost: "2.5" })).toMatchObject({ creditBalanceBefore: 0, creditCost: 2.5 });
        expect(parseGenerateResponse({ creditBalanceBefore: "x", creditCost: " " })).toMatchObject({ creditBalanceBefore: null, creditCost: null });
    });

    it("chartName falls back to an older server's chartType", () => {
        expect(parseGenerateResponse({ chartType: "Line chart" }).chartName).toBe("Line chart");
        expect(parseGenerateResponse({ chartName: "Bar", chartType: "Line chart" }).chartName).toBe("Bar");
    });

    it("a null, missing or non-object body reads as empty, never a throw", () => {
        for (const v of [null, undefined, "text", 7]) {
            const p = parseGenerateResponse(v);
            expect(p.code).toBe("");
            expect(p.errorMessage).toBe("");
            expect(p.version).toBe(0);
            expect(p.geoPointCols).toBeNull();
        }
    });
});

/** A what-fits answer, as the server serialises it. */
const QUALIFY = {
    errorMessage: null,
    charts: [
        { name: "Bar chart", description: "Bars.", rank: 1, score: 100, renderer: "D3", language: "JavaScript",
          recommended: true, isPreview: null, viaProjectionKey: null, viaProjection: null, detailNote: null },
        { name: "Scatter plot", description: null, rank: null, score: null, renderer: null, language: null,
          recommended: false, isPreview: true, viaProjectionKey: "sum-region", viaProjection: "Sum by Region",
          detailNote: "shows every observation" },
        { name: null, description: "a row the server could not name", rank: 3, score: 1, renderer: null,
          language: null, recommended: null, isPreview: null, viaProjectionKey: null, viaProjection: null, detailNote: null },
    ],
    refused: [
        { name: "Arc diagram", reason: "needs 2 category fields, and this data has 1 (Region)", isVeto: true },
        { name: "Heatmap", reason: "", isVeto: false },
        { name: "", reason: "nameless", isVeto: true },
    ],
    noFitSummary: null,
};

describe("parseQualifyResponse", () => {
    it("rows in the server's order, typed, a nameless row dropped", () => {
        const p = parseQualifyResponse(QUALIFY);
        expect(p.errorMessage).toBe("");
        expect(p.noFitSummary).toBe("");
        expect(p.charts).toEqual([
            { name: "Bar chart", description: "Bars.", rank: 1, score: 100, renderer: "D3", language: "JavaScript",
              isPreview: false, recommended: true, viaProjection: undefined, viaProjectionKey: undefined, detailNote: undefined },
            { name: "Scatter plot", description: "", rank: undefined, score: undefined, renderer: undefined, language: undefined,
              isPreview: true, recommended: false, viaProjection: "Sum by Region", viaProjectionKey: "sum-region",
              detailNote: "shows every observation" },
        ]);
        expect(p.refused).toEqual([
            { name: "Arc diagram", reason: "needs 2 category fields, and this data has 1 (Region)", isVeto: true },
            { name: "Heatmap", reason: "", isVeto: false },
        ]);
    });

    it("reads the same in PascalCase, rows included", () => {
        expect(parseQualifyResponse(pascalize(QUALIFY))).toEqual(parseQualifyResponse(QUALIFY));
    });

    it("isVeto is true only when the server sent true", () => {
        for (const v of ["true", 1, null, undefined]) {
            expect(parseQualifyResponse({ refused: [{ name: "X", isVeto: v }] }).refused[0].isVeto, String(v)).toBe(false);
        }
    });

    it("recommended stays unassessed unless the server sent a boolean", () => {
        const rows = parseQualifyResponse({ charts: [{ name: "A", recommended: "false" }, { name: "B" }] }).charts!;
        expect(rows.map(r => r.recommended)).toEqual([undefined, undefined]);
    });

    it("an older server's names: chartTypeName and chartDesc", () => {
        const p = parseQualifyResponse({ charts: [{ chartTypeName: "Pie", chartDesc: "Slices." }], refused: [{ chartTypeName: "Map", reason: "no geo" }] });
        expect(p.charts![0]).toMatchObject({ name: "Pie", description: "Slices." });
        expect(p.refused[0]).toEqual({ name: "Map", reason: "no geo", isVeto: false });
    });

    it("no list at all is null, not an empty list; a missing refusal list is empty", () => {
        expect(parseQualifyResponse({ errorMessage: "No licence." })).toEqual(
            { errorMessage: "No licence.", charts: null, refused: [], noFitSummary: "" });
        expect(parseQualifyResponse({ charts: "nope" }).charts).toBeNull();
        expect(parseQualifyResponse(null)).toEqual({ errorMessage: "", charts: null, refused: [], noFitSummary: "" });
    });
});

describe("parseReviewVerdict", () => {
    it("reads either casing and keeps the fix as the raw generate body", () => {
        const fix = { code: "function render(){}", version: 9 };
        expect(parseReviewVerdict({ status: "OK", verdictReason: "tidied", instruction: null, fix, errorMessage: null }))
            .toEqual({ status: "OK", verdictReason: "tidied", instruction: null, fix, errorMessage: null });
        expect(parseReviewVerdict({ Status: "PROPOSED", VerdictReason: "labels overlap", Instruction: "rotate the labels" }))
            .toEqual({ status: "PROPOSED", verdictReason: "labels overlap", instruction: "rotate the labels", fix: null, errorMessage: null });
    });

    it("a null or non-object body is no verdict", () => {
        expect(parseReviewVerdict(null)).toBeNull();
        expect(parseReviewVerdict(undefined)).toBeNull();
        expect(parseReviewVerdict("OK")).toBeNull();
        expect(parseReviewVerdict({})).toEqual({ status: "", verdictReason: null, instruction: null, fix: null, errorMessage: null });
    });
});
