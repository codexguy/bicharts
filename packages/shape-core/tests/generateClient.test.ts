import { describe, it, expect, vi } from "vitest";
import {
    createGenerateClient, fetchTransport, encodePayload, messageSignature, keyedSigner, HTTP_BODY_START_CHARS,
    type WireResponse, type WireTransport, type GenerateClientEnv,
} from "../src/index";

// The generate client: the post and the read of a generation, a what-fits list, an image review and an
// example chart, over the host's transport - every call resolving as an answer, an HTTP status or a
// transport failure the host words and acts on, and every request byte-identical to what the hosts
// built by hand.

const SIGNER = keyedSigner("test-key");
const CLOCK = { now: () => 1727260000123 };
const PAYLOAD = { genNew: true, version: 0, shape: [{ name: "Region", dataType: "String" }], correlationId: "c-1" };

type Posted = { url: string; body: string; headers: Record<string, string>; opts: { timeoutMs: number; signal?: AbortSignal } };

/** A transport that records what it was asked to post and answers with `respond`. */
function recording(respond: (p: Posted) => Promise<WireResponse>) {
    const posted: Posted[] = [];
    const transport: WireTransport = {
        post: vi.fn(async (url, body, headers, opts) => {
            const p = { url, body, headers, opts };
            posted.push(p);
            return respond(p);
        }),
    };
    return { posted, transport };
}

/** A WireResponse whose whole body is `text`. */
function wire(status: number, text: string, contentType: string | null = "application/json", statusText?: string): WireResponse {
    return {
        status,
        ...(statusText !== undefined ? { statusText } : {}),
        contentType,
        body: null,
        text: async () => text,
    };
}

const ENV: GenerateClientEnv = { baseUrl: "https://svc.example" };

function client(transport: WireTransport, env: GenerateClientEnv = ENV) {
    return createGenerateClient({ signer: SIGNER, transport, clock: CLOCK }, env);
}

const RESULT_LINE = '{"type":"result","result":{"code":"function render(){}","version":2}}\n';

describe("createGenerateClient: construction", () => {
    it("a missing service or an unusable setting is a TypeError at construction", () => {
        const t = recording(async () => wire(200, "{}")).transport;
        expect(() => createGenerateClient({ signer: null as any, transport: t, clock: CLOCK }, ENV)).toThrow(/signer/);
        expect(() => createGenerateClient({ signer: SIGNER, transport: {} as any, clock: CLOCK }, ENV)).toThrow(/transport/);
        expect(() => createGenerateClient({ signer: SIGNER, transport: t, clock: null as any }, ENV)).toThrow(/clock/);
        expect(() => createGenerateClient({ signer: SIGNER, transport: t, clock: CLOCK }, { baseUrl: "" })).toThrow(/base URL/);
        expect(() => createGenerateClient({ signer: SIGNER, transport: t, clock: CLOCK }, { baseUrl: "x", nocache: "7" as any })).toThrow(/nocache/);
    });

    it("a deadline that is not a positive number rejects the call, and nothing is posted", async () => {
        const { posted, transport } = recording(async () => wire(200, "{}"));
        const c = client(transport);
        for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(c.qualify(PAYLOAD, { timeoutMs })).rejects.toThrow(TypeError);
        }
        expect(posted).toHaveLength(0);
    });

    it("a request that cannot be built rejects where encoding it by hand would have thrown", async () => {
        const { posted, transport } = recording(async () => wire(200, "{}"));
        const blank = createGenerateClient({ signer: { sign: () => "" }, transport, clock: CLOCK }, ENV);
        await expect(blank.generate(PAYLOAD, { timeoutMs: 1000 })).rejects.toThrow();
        await expect(client(transport).review(undefined, { timeoutMs: 1000 })).rejects.toThrow(TypeError);
        const circular: any = {}; circular.self = circular;
        await expect(client(transport).sample(circular, { timeoutMs: 1000 })).rejects.toThrow(TypeError);
        expect(posted).toHaveLength(0);
    });
});

describe("createGenerateClient: what reaches the transport", () => {
    it("generate: the envelope to /api/LLMChart/?nocache=<clock>, signed, two headers in order, the deadline", async () => {
        const { posted, transport } = recording(async () => wire(200, RESULT_LINE, "application/x-ndjson"));
        await client(transport).generate(PAYLOAD, { timeoutMs: 900000 });
        const p = posted[0];
        expect(p.url).toBe("https://svc.example/api/LLMChart/?nocache=1727260000123");
        expect(p.body).toBe(encodePayload(PAYLOAD));
        expect(Object.keys(p.headers)).toEqual(["Content-Type", "X-Signature"]);
        expect(p.headers["Content-Type"]).toBe("text/plain");
        expect(p.headers["X-Signature"]).toBe(messageSignature(encodePayload(PAYLOAD), SIGNER));
        expect(p.opts).toEqual({ timeoutMs: 900000 });
    });

    it("the caller's signal is passed on only when there is one", async () => {
        const { posted, transport } = recording(async () => wire(200, RESULT_LINE));
        const ctl = new AbortController();
        await client(transport).generate(PAYLOAD, { timeoutMs: 1000, signal: ctl.signal });
        await client(transport).generate(PAYLOAD, { timeoutMs: 1000, signal: null });
        expect(posted[0].opts.signal).toBe(ctl.signal);
        expect("signal" in posted[1].opts).toBe(false);
    });

    it("qualify and sample: the envelope to their routes; qualify's route can be the host's own", async () => {
        const { posted, transport } = recording(async () => wire(200, "{}"));
        const c = client(transport);
        await c.qualify(PAYLOAD, { timeoutMs: 15000 });
        await c.qualify(PAYLOAD, { timeoutMs: 15000, route: "/RegiaBI/whatfits" });
        await c.sample(PAYLOAD, { timeoutMs: 15000 });
        expect(posted.map(p => p.url)).toEqual([
            "https://svc.example/api/LLMChart/qualify?nocache=1727260000123",
            "https://svc.example/api/RegiaBI/whatfits?nocache=1727260000123",
            "https://svc.example/api/LLMChart/sample?nocache=1727260000123",
        ]);
        for (const p of posted) {
            expect(p.body).toBe(encodePayload(PAYLOAD));
            expect(p.headers["X-Signature"]).toBe(messageSignature(p.body, SIGNER));
        }
        await expect(c.qualify(PAYLOAD, { timeoutMs: 1000, route: "RegiaBI/whatfits" })).rejects.toThrow(TypeError);
    });

    it("review: PLAIN JSON, never the envelope, signed over that text, to /api/VisionReview/", async () => {
        const { posted, transport } = recording(async () => wire(200, '{"status":"NOCHANGE"}'));
        const w = { request: { genNew: false }, imageBase64: "AAAA", version: 4, correlationId: "c-1" };
        await client(transport).review(w, { timeoutMs: 900000 });
        expect(posted[0].url).toBe("https://svc.example/api/VisionReview/?nocache=1727260000123");
        expect(posted[0].body).toBe(JSON.stringify(w));
        expect(posted[0].headers).toEqual({ "Content-Type": "text/plain", "X-Signature": messageSignature(JSON.stringify(w), SIGNER) });
    });

    it("the host's own stamp, told which call it is; its API prefix; a base URL read at every call", async () => {
        const { posted, transport } = recording(async () => wire(200, "{}"));
        let base = "https://one.example";
        const seen: string[] = [];
        const c = client(transport, {
            baseUrl: () => base, apiPath: "/v2",
            nocache: call => { seen.push(call); return `h-${call}`; },
        });
        await c.qualify(PAYLOAD, { timeoutMs: 1000 });
        base = "https://two.example";
        await c.sample(PAYLOAD, { timeoutMs: 1000 });
        expect(posted.map(p => p.url)).toEqual([
            "https://one.example/v2/LLMChart/qualify?nocache=h-qualify",
            "https://two.example/v2/LLMChart/sample?nocache=h-sample",
        ]);
        expect(seen).toEqual(["qualify", "sample"]);
    });
});

describe("createGenerateClient: the outcome", () => {
    it("answer: a streamed generate's result, with every progress line passed on", async () => {
        const body = '{"type":"progress","stage":"Reading your data","stageId":"read"}\n' + RESULT_LINE;
        const { transport } = recording(async () => wire(200, body, "application/x-ndjson"));
        const stages: [string, string | undefined][] = [];
        const out = await client(transport).generate(PAYLOAD, { timeoutMs: 1000, onStage: (s, id) => stages.push([s, id]) });
        expect(out).toEqual({ kind: "answer", status: 200, value: { code: "function render(){}", version: 2 } });
        expect(stages).toEqual([["Reading your data", "read"]]);
    });

    it("answer: a buffered generate body, and the parsed JSON of the other calls", async () => {
        const { transport } = recording(async () => wire(200, '{"code":"x","version":3}'));
        const c = client(transport);
        expect(await c.generate(PAYLOAD, { timeoutMs: 1000 })).toEqual({ kind: "answer", status: 200, value: { code: "x", version: 3 } });
        expect(await c.qualify(PAYLOAD, { timeoutMs: 1000 })).toEqual({ kind: "answer", status: 200, value: { code: "x", version: 3 } });
    });

    it("http: a status outside 2xx RESOLVES with its reason phrase and the start of its body", async () => {
        const long = "y".repeat(HTTP_BODY_START_CHARS + 100);
        for (const [status, phrase] of [[500, "Internal Server Error"], [502, "Bad Gateway"], [504, "Gateway Timeout"], [400, "Bad Request"], [302, "Found"]] as const) {
            const { transport } = recording(async () => wire(status, long, "text/html", phrase));
            const out = await client(transport).generate(PAYLOAD, { timeoutMs: 1000 });
            expect(out).toEqual({ kind: "http", status, statusText: phrase, bodyStart: "y".repeat(HTTP_BODY_START_CHARS) });
        }
        expect(HTTP_BODY_START_CHARS).toBe(300);
    });

    it("http: no reason phrase reads as '' (HTTP/2), and an empty or unreadable body as ''", async () => {
        const noPhrase = recording(async () => wire(503, "")).transport;
        expect(await client(noPhrase).sample(PAYLOAD, { timeoutMs: 1000 })).toEqual({ kind: "http", status: 503, statusText: "", bodyStart: "" });
        const unreadable = recording(async () => ({ status: 500, contentType: null, body: null, text: async () => { throw new TypeError("gone"); } })).transport;
        expect(await client(unreadable).sample(PAYLOAD, { timeoutMs: 1000 })).toEqual({ kind: "http", status: 500, statusText: "", bodyStart: "" });
    });

    it("http with readErrorBody false: the body is released, never read or waited on", async () => {
        let cancelled = false;
        const text = vi.fn(async () => "never");
        const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
        const { transport } = recording(async () => ({ status: 500, statusText: "Internal Server Error", contentType: null, body: stream, text }));
        const out = await client(transport).qualify(PAYLOAD, { timeoutMs: 1000, readErrorBody: false });
        expect(out).toEqual({ kind: "http", status: 500, statusText: "Internal Server Error", bodyStart: "" });
        expect(text).not.toHaveBeenCalled();
        expect(cancelled).toBe(true);
    });

    it("transport: a rejected post is 'no headers', carrying the error exactly as thrown", async () => {
        const err = new TypeError("Failed to fetch");
        const { transport } = recording(async () => { throw err; });
        const out = await client(transport).generate(PAYLOAD, { timeoutMs: 1000 });
        expect(out).toEqual({ kind: "transport", headersReceived: false, timedOut: false, cancelled: false, error: err });
        expect((out as any).error).toBe(err);
    });

    it("transport: a 2xx body that does not parse is 'headers received', with the parser's error", async () => {
        const { transport } = recording(async () => wire(200, "<html>proxy</html>", "text/html"));
        const out = await client(transport).qualify(PAYLOAD, { timeoutMs: 1000 });
        expect(out.kind).toBe("transport");
        expect(out).toMatchObject({ headersReceived: true, timedOut: false, cancelled: false });
        expect((out as any).error).toBeInstanceOf(SyntaxError);
    });

    it("transport: a generate that ends without a result is 'headers received'", async () => {
        const { transport } = recording(async () => wire(200, '{"type":"progress","stage":"Working"}\n', "application/x-ndjson"));
        const out = await client(transport).generate(PAYLOAD, { timeoutMs: 1000 });
        expect(out).toMatchObject({ kind: "transport", headersReceived: true, timedOut: false, cancelled: false });
    });
});

describe("createGenerateClient over fetchTransport: the deadline and the caller's signal", () => {
    const abortError = () => Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

    /** A fetch that answers after its signal aborts - never, unless it does. */
    const hanging = (_u: string, init: any) => new Promise<Response>((_ok, fail) => {
        if (init.signal.aborted) fail(init.signal.reason ?? abortError());
        else init.signal.addEventListener("abort", () => fail(init.signal.reason ?? abortError()), { once: true });
    });

    /** Headers now, one progress line, then silence; the body errors when the request aborts. */
    const stalling = async (_u: string, init: any) => {
        let ctl!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
        ctl.enqueue(new TextEncoder().encode('{"type":"progress","stage":"Reading your data"}\n'));
        init.signal.addEventListener("abort", () => { try { ctl.error(init.signal.reason ?? abortError()); } catch { /* closed */ } }, { once: true });
        return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
    };

    it("no headers inside the deadline: timed out, no headers", async () => {
        const out = await client(fetchTransport(hanging)).generate(PAYLOAD, { timeoutMs: 30 });
        expect(out).toMatchObject({ kind: "transport", headersReceived: false, timedOut: true, cancelled: false });
    });

    it("a body that stalls after its headers: timed out, headers received", async () => {
        const stages: string[] = [];
        const out = await client(fetchTransport(stalling)).generate(PAYLOAD, { timeoutMs: 30, onStage: s => stages.push(s) });
        expect(out).toMatchObject({ kind: "transport", headersReceived: true, timedOut: true, cancelled: false });
        expect(stages).toEqual(["Reading your data"]);
    });

    it("the caller cancels before the headers, or part-way through the body: cancelled, never timed out", async () => {
        const before = new AbortController();
        setTimeout(() => before.abort(), 10);
        expect(await client(fetchTransport(hanging)).generate(PAYLOAD, { timeoutMs: 5000, signal: before.signal }))
            .toMatchObject({ kind: "transport", headersReceived: false, timedOut: false, cancelled: true });

        const during = new AbortController();
        setTimeout(() => during.abort(), 10);
        expect(await client(fetchTransport(stalling)).generate(PAYLOAD, { timeoutMs: 5000, signal: during.signal }))
            .toMatchObject({ kind: "transport", headersReceived: true, timedOut: false, cancelled: true });

        const already = new AbortController();
        already.abort();
        expect(await client(fetchTransport(hanging)).generate(PAYLOAD, { timeoutMs: 5000, signal: already.signal }))
            .toMatchObject({ kind: "transport", headersReceived: false, cancelled: true });
    });

    it("on the wire: the request a host's fetch sees - credentials 'omit', exactly two headers, the envelope", async () => {
        const seen: { url: string; init: any }[] = [];
        const f = vi.fn(async (url: string, init: any) => {
            seen.push({ url, init });
            return new Response(RESULT_LINE, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
        });
        const out = await client(fetchTransport(f)).generate(PAYLOAD, { timeoutMs: 1000 });
        expect(out.kind).toBe("answer");
        const req = new Request(seen[0].url, seen[0].init);
        expect(req.method).toBe("POST");
        expect(req.credentials).toBe("omit");
        expect(Object.fromEntries(req.headers.entries())).toEqual({
            "content-type": "text/plain",
            "x-signature": messageSignature(encodePayload(PAYLOAD), SIGNER),
        });
        expect(await req.text()).toBe(encodePayload(PAYLOAD));
    });

    it("a platform response's reason phrase reaches the http outcome", async () => {
        const f = async () => new Response("down", { status: 504, statusText: "Gateway Timeout" });
        expect(await client(fetchTransport(f)).generate(PAYLOAD, { timeoutMs: 1000 }))
            .toEqual({ kind: "http", status: 504, statusText: "Gateway Timeout", bodyStart: "down" });
    });
});
