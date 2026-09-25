// READING A GENERATE RESPONSE (2026-09-24): the NDJSON stream a generation answers with, and
// the single JSON body an older server or a buffering proxy answers with instead.
//
// The stream is one JSON object per line, each with a `type`: `progress` (a heartbeat carrying a
// stage label, and from servers of 2026-09-25 a `stageId` beside it) or `result` (the result object,
// wrapped). Every host read it with its own copy,
// and the copies disagreed at the edges; this is the one reader, and its rules are these.
//
// 1. THE CONTENT TYPE DECIDES FIRST. A response labelled NDJSON is read as a stream, line by
//    line, as it arrives. Anything else is read whole: a JSON body is the result itself.
// 2. A BODY LABELLED OTHERWISE THAT IS NOT ONE JSON VALUE is read as lines after all, because a
//    proxy can strip or rewrite the label on a real stream.
// 3. INSIDE A STREAM, an object with no `type` is accepted as the result only when it carries a
//    `code` or an `errorMessage` (either casing), and only when no typed result came first - the
//    shape of an older server's single-object answer. Any other untyped object, and any `type`
//    this reader does not know, is SKIPPED, never guessed at: the server may grow a line kind,
//    and a reader that took the first unknown object for the result would draw whatever it was.
// 4. A LINE THAT IS NOT JSON IS DROPPED - a torn chunk or a proxy's interjection - and the read
//    goes on; the result line, if it comes, still arrives.
// 5. NO RESULT IS A FAILURE, AND A LOUD ONE: a stream that ends after three heartbeats means the
//    connection died mid-generation. The throw says "without a result". A body where NOTHING
//    parsed rethrows the SyntaxError, so a host can tell a malformed answer (nothing to wait
//    for) from a cut connection (the server may still be finishing, and billing).
// 6. An error from the body itself - an abort, a network drop - propagates unchanged, so a host
//    reads its name exactly as it would have from its own transport.

import type { WireResponse } from "./host/services";
import { readWireField } from "./wire";

/** True when a Content-Type header names an NDJSON stream. */
export function isNdjsonContentType(contentType: string | null | undefined): boolean {
    return String(contentType ?? "").toLowerCase().includes("ndjson");
}

/**
 * A WireResponse over a fetch-style response: the platform `Response` of a browser, of Node, or
 * of any HTTP client that hands one back. Tolerates a response with no headers object or no body
 * (a test double, a runtime without streams): the content type is then null and the reader uses
 * text().
 */
export function wireResponseFromFetch(res: {
    status?: number;
    statusText?: string;
    headers?: { get(name: string): string | null } | null;
    body?: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
}): WireResponse {
    let contentType: string | null = null;
    try { contentType = res.headers?.get?.("content-type") ?? null; } catch { contentType = null; }
    return {
        status: typeof res.status === "number" ? res.status : 0,
        // The reason phrase only when the response has one to give; a double without it stays without.
        ...(typeof res.statusText === "string" ? { statusText: res.statusText } : {}),
        contentType,
        body: res.body ?? null,
        text: () => res.text(),
    };
}

type Line = { result: Record<string, any> | null; typed: boolean; parsed: boolean };

/** A progress line: the stage's display text (never empty) and its code, undefined from an older
 *  server. */
export type OnStage = (stage: string, stageId?: string) => void;

/** One line of text: the result it carries (typed or legacy), whether it was typed, whether it parsed. */
function readLine(text: string, onStage: OnStage | undefined, legacyNeedsFields: boolean): Line {
    const t = text.trim();
    if (!t) return { result: null, typed: false, parsed: false };
    let obj: any;
    try { obj = JSON.parse(t); } catch { return { result: null, typed: false, parsed: false }; }
    return classify(obj, onStage, legacyNeedsFields);
}

/** One parsed value, by rules 3 and 5. */
function classify(obj: any, onStage: OnStage | undefined, legacyNeedsFields: boolean): Line {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { result: null, typed: false, parsed: true };
    const type = readWireField(obj, "type");
    if (type !== undefined && type !== null) {
        if (type === "progress") {
            const stage = String(readWireField(obj, "stage") ?? "").trim();
            const stageId = String(readWireField(obj, "stageId") ?? "").trim();
            if (stage) onStage?.(stage, stageId || undefined);
            return { result: null, typed: true, parsed: true };
        }
        if (type === "result") {
            const inner = readWireField(obj, "result");
            return { result: inner && typeof inner === "object" ? inner : null, typed: true, parsed: true };
        }
        return { result: null, typed: true, parsed: true };
    }
    if (!legacyNeedsFields) return { result: obj, typed: false, parsed: true };
    const looksLikeResult = readWireField(obj, "code") !== undefined || readWireField(obj, "errorMessage") !== undefined;
    return { result: looksLikeResult ? obj : null, typed: false, parsed: true };
}

/** Accumulates lines under rule 3: a typed result always wins; a legacy one only fills an empty slot. */
class LineReader {
    result: Record<string, any> | null = null;
    anyParsed = false;
    constructor(private readonly onStage?: OnStage) {}
    take(text: string): void {
        const l = readLine(text, this.onStage, true);
        if (l.parsed) this.anyParsed = true;
        if (!l.result) return;
        if (l.typed || this.result === null) this.result = l.result;
    }
}

function noResult(): Error {
    return new Error("the generate response ended without a result");
}

async function readStream(res: WireResponse, onStage?: OnStage): Promise<Record<string, any>> {
    const body: any = res.body;
    if (!body || typeof body.getReader !== "function") return readLines(await res.text(), onStage, null);
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const lines = new LineReader(onStage);
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Keep the TAIL: a chunk boundary lands mid-line often enough that parsing whatever
            // arrived would drop heartbeats, and could drop half the result line.
            let nl: number;
            while ((nl = buffer.indexOf("\n")) >= 0) {
                lines.take(buffer.slice(0, nl));
                buffer = buffer.slice(nl + 1);
            }
        }
    } finally {
        try { reader.releaseLock?.(); } catch { /* already released */ }
    }
    // A stream may end without a trailing newline; the result line is exactly the one that
    // would be lost.
    buffer += decoder.decode();
    lines.take(buffer);
    if (!lines.result) throw noResult();
    return lines.result;
}

function readLines(text: string, onStage: OnStage | undefined, parseError: unknown): Record<string, any> {
    const lines = new LineReader(onStage);
    for (const line of text.split("\n")) lines.take(line);
    if (lines.result) return lines.result;
    if (!lines.anyParsed && parseError) throw parseError;
    throw noResult();
}

async function readBuffered(res: WireResponse, onStage?: OnStage): Promise<Record<string, any>> {
    const text = await res.text();
    let whole: any;
    try {
        whole = JSON.parse(text);
    } catch (e) {
        // Not one JSON value: a stream whose label was lost (rule 2), or a malformed body.
        return readLines(text, onStage, e);
    }
    // A JSON value that is not an object (null, a number, a string) is a malformed answer, not a
    // cut one: bytes arrived and parsed, and there is nothing running to wait for.
    if (!whole || typeof whole !== "object" || Array.isArray(whole)) {
        throw new SyntaxError("the generate response was JSON but not a result object");
    }
    // One JSON value. Untyped, it IS the result; typed, it is one line of a stream.
    const l = classify(whole, onStage, false);
    if (l.result) return l.result;
    throw noResult();
}

/**
 * The generate result a response carries, whether it streamed or not. `onStage` receives each
 * progress line as it arrives: the stage label (display text) and, from a server that sends one,
 * its `stageId` - the code a host picks its own waiting lines by (see `progressStageOf`), never the
 * label. A line with no label is skipped, as it always was. Throws when there is no result (see the rules at the top
 * of this file for which error means what).
 */
export async function readGenerateStream(
    res: WireResponse,
    onStage?: OnStage,
): Promise<Record<string, any>> {
    return isNdjsonContentType(res.contentType) ? readStream(res, onStage) : readBuffered(res, onStage);
}
