// READING WHAT THE SERVER ANSWERED (2026-09-24): one field list for a generate result, a
// qualify ("what fits") answer and a vision-review verdict.
//
// Every host read these bodies with its own list of fields, and the lists drifted: a field the
// server added reached one host and was silently dropped by another, because a whitelist parse
// drops what it does not name and nothing fails. A point map drew blank on one host for exactly
// that reason, twice. One list, read here, means a field named once reaches every host.
//
// FIELDS ONLY - no policy. Each parser reads every field in either casing (readWireField) and
// normalises its TYPE: text is a string ("" when absent or null), a flag is true only when the
// server sent true, a number is a finite number or null. What a host DOES with a result - which
// message to show, when to retry, when a result is a failure - stays in the host.

import { readWireField } from "./wire";

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const flag = (v: unknown): boolean => v === true;
/** A wire number that may arrive as a number, a numeric string, or not at all. */
const numOrNull = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
    return null;
};

/** The columns a point map resolves a coordinate from, by role. Only roles the server named. */
export interface WirePointColumns {
    city?: string;
    state?: string;
    zip?: string;
    lat?: string;
    lon?: string;
    country?: string;
}

/** A point binding; `dest` is the second endpoint of a route (an origin-destination flow map). */
export interface WirePointBinding extends WirePointColumns {
    dest?: WirePointColumns;
}

/** A generate result's fields, typed. */
export interface ParsedGenerateResponse {
    /** The server's own words when it declined. "" on a success. */
    errorMessage: string;
    code: string;
    language: string;
    /** 0 when absent. */
    version: number;
    codeSummary: string;
    /** The chart drawn: the wire's `chartName` (an older server's `chartType`). */
    chartName: string;
    /** The chart the server settled on after any substitution. */
    finalChartName: string;
    warningMessage: string;
    outputHash: string;
    validatorToken: string;
    editCodeKey: string;
    signedLLMRequestID: string;
    userReply: string;
    userReplyOutcome: string;
    improvementSuggestion: string;
    geoColumn: string;
    geoKind: string;
    /** The point-map binding, packed from the point columns the server named; null when none. */
    geoPointCols: WirePointBinding | null;
    creditBalanceBefore: number | null;
    creditCost: number | null;
    isServiceError: boolean;
    isRateLimited: boolean;
    /** A verdict the server reached before any model ran; asking again gets the same answer. */
    isRefusal: boolean;
    isVersionNotFound: boolean;
    isGenerationCancelled: boolean;
    /** Seconds until a throttle clears, only when the server sent a finite number. */
    retryAfterSeconds: number | null;
    /** Whose generation a fetch by correlation served; "" when the server did not say. */
    servedCorrelationId: string;
}

const POINT_ROLES: ReadonlyArray<[keyof WirePointColumns, string]> = [
    ["city", "CityColumn"], ["state", "StateColumn"], ["zip", "ZipColumn"],
    ["lat", "LatColumn"], ["lon", "LonColumn"], ["country", "CountryColumn"],
];

/** The point columns under one prefix ("point" or "destPoint"), only those named. */
function pointColumns(data: unknown, prefix: string): WirePointColumns {
    const out: WirePointColumns = {};
    for (const [role, suffix] of POINT_ROLES) {
        const v = str(readWireField(data, prefix + suffix));
        if (v) out[role] = v;
    }
    return out;
}

/**
 * A generate result body -> its fields, typed. Also reads a fetch by correlation and the fix a
 * vision review returns, which are the same shape. A null or non-object body reads as empty.
 */
export function parseGenerateResponse(data: unknown): ParsedGenerateResponse {
    const f = (name: string) => readWireField(data, name);
    const retry = f("retryAfterSeconds");
    const point: WirePointBinding = pointColumns(data, "point");
    // THE ROUTE'S SECOND ENDPOINT, nested under `dest` so the two ends can never be confused.
    // Dropping it is not a degraded map but a broken one: a route with one resolved end has
    // nothing to draw an arc between.
    const dest = pointColumns(data, "destPoint");
    if (Object.keys(dest).length) point.dest = dest;
    return {
        errorMessage: str(f("errorMessage")),
        code: str(f("code")),
        language: str(f("language")),
        version: Number(f("version") ?? 0),
        codeSummary: str(f("codeSummary")),
        chartName: str(f("chartName") ?? f("chartType")),
        finalChartName: str(f("finalChartName")),
        warningMessage: str(f("warningMessage")),
        outputHash: str(f("outputHash")),
        validatorToken: str(f("validatorToken")),
        editCodeKey: str(f("editCodeKey")),
        signedLLMRequestID: str(f("signedLLMRequestID")),
        userReply: str(f("userReply")),
        userReplyOutcome: str(f("userReplyOutcome")),
        improvementSuggestion: str(f("improvementSuggestion")),
        geoColumn: str(f("geoColumn")),
        geoKind: str(f("geoKind")),
        geoPointCols: Object.keys(point).length ? point : null,
        creditBalanceBefore: numOrNull(f("creditBalanceBefore")),
        creditCost: numOrNull(f("creditCost")),
        isServiceError: flag(f("isServiceError")),
        isRateLimited: flag(f("isRateLimited")),
        isRefusal: flag(f("isRefusal")),
        isVersionNotFound: flag(f("isVersionNotFound")),
        isGenerationCancelled: flag(f("isGenerationCancelled")),
        retryAfterSeconds: typeof retry === "number" && Number.isFinite(retry) ? retry : null,
        servedCorrelationId: str(f("servedCorrelationId")),
    };
}

/** One chart type that qualifies, as the server describes it. */
export interface ParsedQualifyChart {
    /** The wire's `name` (an older server's `chartTypeName`). Never empty: a nameless row is dropped. */
    name: string;
    /** The wire's `description` (an older server's `chartDesc`). */
    description: string;
    /** 1 = the best fit; undefined when the server sent none. */
    rank: number | undefined;
    /** 0..100 relative weight; undefined when the server sent none. */
    score: number | undefined;
    renderer: string | undefined;
    language: string | undefined;
    /** True only when the server said so: a newer, less proven type. */
    isPreview: boolean;
    /** False = a required channel is poorly served; undefined = unassessed, never a demotion. */
    recommended: boolean | undefined;
    /** Non-empty when the type qualifies only against an aggregated projection. */
    viaProjection: string | undefined;
    viaProjectionKey: string | undefined;
    /** Why the type moved under a level-of-detail preference, in the reader's terms. */
    detailNote: string | undefined;
}

/** One chart type that did not qualify, and why. */
export interface ParsedQualifyRefusal {
    name: string;
    /** A sentence naming one requirement the data fails; "" when the server could not name it. */
    reason: string;
    /**
     * True only when the server said so: a required channel is absent and no rebinding supplies
     * it. Absent, null or anything but true reads as a preference an explicit pick may override -
     * the safe direction on an older server.
     */
    isVeto: boolean;
}

/** A qualify answer's fields, typed. */
export interface ParsedQualifyResponse {
    errorMessage: string;
    /** In the server's order - it IS the ranking. null when the body carried no list at all. */
    charts: ParsedQualifyChart[] | null;
    refused: ParsedQualifyRefusal[];
    /** The server's headline for an empty list, when it can state a fact; "" otherwise. */
    noFitSummary: string;
}

const numOrUndefined = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const textOrUndefined = (v: unknown): string | undefined => str(v) || undefined;

/** A qualify ("what fits") body -> its fields, typed. A null or non-object body reads as empty. */
export function parseQualifyResponse(data: unknown): ParsedQualifyResponse {
    const rawCharts = readWireField(data, "charts");
    const rawRefused = readWireField(data, "refused");
    const charts: ParsedQualifyChart[] | null = Array.isArray(rawCharts)
        ? rawCharts.map((c: unknown): ParsedQualifyChart => {
            const f = (name: string) => readWireField(c, name);
            const recommended = f("recommended");
            return {
                name: str(f("chartTypeName") ?? f("name")),
                description: str(f("description") ?? f("chartDesc")),
                rank: numOrUndefined(f("rank")),
                score: numOrUndefined(f("score")),
                renderer: textOrUndefined(f("renderer")),
                language: textOrUndefined(f("language")),
                isPreview: flag(f("isPreview")),
                recommended: typeof recommended === "boolean" ? recommended : undefined,
                viaProjection: textOrUndefined(f("viaProjection")),
                viaProjectionKey: textOrUndefined(f("viaProjectionKey")),
                detailNote: textOrUndefined(f("detailNote")),
            };
        }).filter(c => c.name)
        : null;
    const refused: ParsedQualifyRefusal[] = Array.isArray(rawRefused)
        ? rawRefused.map((r: unknown): ParsedQualifyRefusal => ({
            name: str(readWireField(r, "chartTypeName") ?? readWireField(r, "name")),
            reason: str(readWireField(r, "reason")),
            isVeto: flag(readWireField(r, "isVeto")),
        })).filter(r => r.name)
        : [];
    return {
        errorMessage: str(readWireField(data, "errorMessage")),
        charts,
        refused,
        noFitSummary: str(readWireField(data, "noFitSummary")),
    };
}

/** A vision-review verdict's fields. */
export interface ParsedReviewVerdict {
    /** "PROPOSED" | "OK" | "NOCHANGE" | "REFUSED" | "ERROR", or whatever a newer server sends. */
    status: string;
    verdictReason: string | null;
    /** Set on PROPOSED: the instruction, sent back verbatim if the reader accepts. */
    instruction: string | null;
    /**
     * On OK, the finished fix: a whole generate result, left as the raw body because
     * parseGenerateResponse is what reads that shape.
     */
    fix: unknown;
    errorMessage: string | null;
}

/** A vision-review body -> its verdict. null for a null or non-object body. */
export function parseReviewVerdict(data: unknown): ParsedReviewVerdict | null {
    if (!data || typeof data !== "object") return null;
    return {
        status: String(readWireField(data, "status") ?? ""),
        verdictReason: readWireField(data, "verdictReason") ?? null,
        instruction: readWireField(data, "instruction") ?? null,
        fix: readWireField(data, "fix") ?? null,
        errorMessage: readWireField(data, "errorMessage") ?? null,
    };
}
