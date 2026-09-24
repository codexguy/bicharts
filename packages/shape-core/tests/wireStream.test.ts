import { describe, it, expect } from "vitest";
import { readGenerateStream, isNdjsonContentType, wireResponseFromFetch } from "../src/index";
import type { WireResponse } from "../src/index";
import { assertWireResponseConformance, ConformanceError } from "../src/testing/index";

// The generate response reader. Each case below was a behaviour of at least one host's own copy
// before there was one reader; the ones where the copies disagreed are marked, with the rule that
// settled them.

const RESULT = { code: "function render(){}", language: "D3", version: 3, codeSummary: "Revenue by region" };
const progressLine = (stage: string) => JSON.stringify({ type: "progress", stage }) + "\n";
const resultLine = (result: any = RESULT) => JSON.stringify({ type: "result", result }) + "\n";

/** A WireResponse whose body streams the given chunks, in order - arbitrary chunk boundaries. */
function streamed(chunks: string[], contentType: string | null = "application/x-ndjson"): WireResponse {
    const enc = new TextEncoder();
    let i = 0;
    return {
        status: 200,
        contentType,
        body: {
            getReader: () => ({
                read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }),
                releaseLock: () => {},
            }),
        } as any,
        text: async () => chunks.join(""),
    };
}
const bufferedBody = (text: string, contentType: string | null = "application/json"): WireResponse =>
    ({ status: 200, contentType, body: null, text: async () => text });

describe("the content type decides first", () => {
    it("names NDJSON in any case, with parameters", () => {
        expect(isNdjsonContentType("application/x-ndjson")).toBe(true);
        expect(isNdjsonContentType("Application/X-NDJSON; charset=utf-8")).toBe(true);
        expect(isNdjsonContentType("application/json")).toBe(false);
        expect(isNdjsonContentType(null)).toBe(false);
        expect(isNdjsonContentType(undefined)).toBe(false);
    });
});

describe("an NDJSON stream", () => {
    it("returns the result line's payload and reports every progress stage in order", async () => {
        const stages: string[] = [];
        const out = await readGenerateStream(streamed([progressLine("Analyzing your data"), progressLine("Generating your chart"), resultLine()]), s => stages.push(s));
        expect(out).toEqual(RESULT);
        expect(stages).toEqual(["Analyzing your data", "Generating your chart"]);
    });

    it("survives a line split across chunk boundaries", async () => {
        const whole = resultLine();
        for (const cut of [1, 12, 30, whole.length - 2]) {
            const out = await readGenerateStream(streamed([progressLine("Reviewing"), whole.slice(0, cut), whole.slice(cut)]));
            expect(out).toEqual(RESULT);
        }
    });

    it("accepts a final result line with no trailing newline", async () => {
        const out = await readGenerateStream(streamed([progressLine("Working"), JSON.stringify({ type: "result", result: RESULT })]));
        expect(out).toEqual(RESULT);
    });

    it("SKIPS an unknown line type rather than guessing it is the result", async () => {
        const out = await readGenerateStream(streamed([JSON.stringify({ type: "telemetry", n: 1 }) + "\n", resultLine()]));
        expect(out).toEqual(RESULT);
    });

    it("an unknown line type with no result after it is a throw, never the answer", async () => {
        await expect(readGenerateStream(streamed([JSON.stringify({ type: "telemetry", n: 1 }) + "\n"]))).rejects.toThrow(/without a result/);
    });

    it("drops blank lines, torn chunks and a proxy's interjection, and still finishes", async () => {
        const out = await readGenerateStream(streamed(["\n", "{not json\n", "not json at all\n", resultLine()]));
        expect(out).toEqual(RESULT);
    });

    it("a stream that ends after heartbeats alone is an error, not the last heartbeat", async () => {
        await expect(readGenerateStream(streamed([progressLine("Working"), progressLine("Still working")]))).rejects.toThrow(/without a result/);
    });

    it("reports no empty stage", async () => {
        let calls = 0;
        await readGenerateStream(streamed([progressLine(""), JSON.stringify({ type: "progress" }) + "\n", resultLine()]), () => { calls++; });
        expect(calls).toBe(0);
    });

    it("reads the discriminator and its fields in either casing", async () => {
        const stages: string[] = [];
        const out = await readGenerateStream(streamed([
            JSON.stringify({ Type: "progress", Stage: "Working" }) + "\n",
            JSON.stringify({ Type: "result", Result: RESULT }) + "\n",
        ]), s => stages.push(s));
        expect(out).toEqual(RESULT);
        expect(stages).toEqual(["Working"]);
    });

    it("a result line whose result is not an object is skipped", async () => {
        await expect(readGenerateStream(streamed([JSON.stringify({ type: "result", result: null }) + "\n"]))).rejects.toThrow(/without a result/);
    });

    // DISAGREED: one host skipped every untyped object inside a stream; two accepted one that
    // looked like a result. Ruled: accepted only with code or errorMessage, only into an empty slot.
    it("accepts an untyped object carrying code or errorMessage (either casing) as a legacy result", async () => {
        expect(await readGenerateStream(streamed([JSON.stringify(RESULT) + "\n"]))).toEqual(RESULT);
        const pascal = await readGenerateStream(streamed([JSON.stringify({ Code: "x", ErrorMessage: "" })]));
        expect(pascal.Code).toBe("x");
        const refusal = await readGenerateStream(streamed([JSON.stringify({ errorMessage: "No chart fits" }) + "\n"]));
        expect(refusal.errorMessage).toBe("No chart fits");
    });

    it("an untyped object with neither field is skipped", async () => {
        await expect(readGenerateStream(streamed([JSON.stringify({ note: "hello" }) + "\n"]))).rejects.toThrow(/without a result/);
    });

    it("a typed result wins over an earlier legacy one, and a later legacy one never replaces a typed one", async () => {
        const legacy = { code: "legacy" };
        expect((await readGenerateStream(streamed([JSON.stringify(legacy) + "\n", resultLine()]))).code).toBe(RESULT.code);
        expect((await readGenerateStream(streamed([resultLine(), JSON.stringify(legacy) + "\n"]))).code).toBe(RESULT.code);
    });

    it("with no readable body, reads the whole text as lines", async () => {
        const res = { ...streamed([progressLine("Working") + resultLine()]), body: null };
        expect(await readGenerateStream(res)).toEqual(RESULT);
    });

    it("an error from the body itself propagates unchanged", async () => {
        const res = streamed([]);
        res.body = { getReader: () => ({ read: async () => { throw Object.assign(new Error("net"), { name: "TypeError" }); }, releaseLock() {} }) } as any;
        await expect(readGenerateStream(res)).rejects.toMatchObject({ name: "TypeError", message: "net" });
    });
});

describe("a body that is not labelled NDJSON", () => {
    it("a JSON body IS the result", async () => {
        expect(await readGenerateStream(bufferedBody(JSON.stringify(RESULT)))).toEqual(RESULT);
    });

    it("any untyped JSON object is the result, even one with neither field - the host's parser says what is missing", async () => {
        expect(await readGenerateStream(bufferedBody('{"isServiceError":true}'))).toEqual({ isServiceError: true });
    });

    it("a typed result object in a buffered body is unwrapped", async () => {
        expect(await readGenerateStream(bufferedBody(JSON.stringify({ type: "result", result: RESULT })))).toEqual(RESULT);
    });

    it("a lone typed progress object is no result", async () => {
        await expect(readGenerateStream(bufferedBody(JSON.stringify({ type: "progress", stage: "x" })))).rejects.toThrow(/without a result/);
    });

    // DISAGREED: one host trusted the label and would have failed a relabelled stream; two
    // sniffed every body. Ruled: the label decides, and a body that is not one JSON value is read
    // as lines after all.
    it("a real stream whose label was lost is still read, stages and all", async () => {
        const stages: string[] = [];
        const out = await readGenerateStream(streamed([progressLine("Working"), resultLine()], null), s => stages.push(s));
        expect(out).toEqual(RESULT);
        expect(stages).toEqual(["Working"]);
        expect(await readGenerateStream(bufferedBody(progressLine("A") + resultLine(), "text/plain"))).toEqual(RESULT);
    });

    it("a body where NOTHING parses rethrows the SyntaxError - a malformed answer, not a cut one", async () => {
        await expect(readGenerateStream(bufferedBody("<html>Bad gateway</html>"))).rejects.toBeInstanceOf(SyntaxError);
    });

    it("JSON that is not an object is malformed too", async () => {
        await expect(readGenerateStream(bufferedBody("null"))).rejects.toBeInstanceOf(SyntaxError);
        await expect(readGenerateStream(bufferedBody("42"))).rejects.toBeInstanceOf(SyntaxError);
    });

    it("a mislabelled body of heartbeats alone is a cut, not a malformed answer", async () => {
        const err = await readGenerateStream(bufferedBody(progressLine("A") + progressLine("B"), "text/plain")).catch(e => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(SyntaxError);
        expect(String(err.message)).toMatch(/without a result/);
    });
});

describe("wireResponseFromFetch", () => {
    it("adapts a platform Response, and passes the conformance check every host's adapter runs", async () => {
        await expect(assertWireResponseConformance(wireResponseFromFetch)).resolves.toBeUndefined();
    });

    it("tolerates a response with no headers and no body", async () => {
        const w = wireResponseFromFetch({ text: async () => JSON.stringify(RESULT) });
        expect(w.contentType).toBeNull();
        expect(w.body).toBeNull();
        expect(await readGenerateStream(w)).toEqual(RESULT);
    });

    it("the conformance check fails an adapter that loses the content type", async () => {
        const lossy = (res: Response): WireResponse => ({ ...wireResponseFromFetch(res), contentType: null });
        const err = await assertWireResponseConformance(lossy).catch(e => e);
        expect(err).toBeInstanceOf(ConformanceError);
        expect(err.message).toMatch(/content type/);
    });
});
