// CONFORMANCE SUITES for the host services (2026-09-24). Published as the
// "@bicharts/shape-core/testing" subpath, for a host's own test project - nothing in the
// runtime entry imports it.
//
// Each contract in host/services.ts ships a check a host runs against ITS OWN adapter, in its
// own test project, before any shared logic that consumes the adapter is pointed at it. A
// contract written down is a hope; a contract every host's adapter passes is a test.
//
// Framework-free on purpose: every check throws a ConformanceError listing each failed
// property, so a host calls it from whatever runner it already has (`await expect(...)
// .resolves` or a bare call inside a test body both work).

import type { WireSigner, WireResponse, WireTransport } from "../host/services";
import { readGenerateStream, isNdjsonContentType } from "../wireStream";

/** Thrown by every conformance check. `failures` names each property the adapter broke. */
export class ConformanceError extends Error {
    readonly contract: string;
    readonly failures: readonly string[];
    constructor(contract: string, failures: readonly string[]) {
        super(`${contract} conformance failed:\n - ${failures.join("\n - ")}`);
        this.name = "ConformanceError";
        this.contract = contract;
        this.failures = failures;
    }
}

/** Collects failures and throws once at the end, so one run reports every broken property
 *  rather than the first. */
class ConformanceReport {
    private readonly failures: string[] = [];
    constructor(private readonly contract: string) {}
    check(ok: boolean, failure: string): void {
        if (!ok) this.failures.push(failure);
    }
    fail(failure: string): void {
        this.failures.push(failure);
    }
    throwIfFailed(): void {
        if (this.failures.length) throw new ConformanceError(this.contract, this.failures.slice());
    }
}

/** Two encoded bodies of the shape a host actually signs: base64 with '/' written as '.'. */
const SIGNER_FIXTURE_A = "H4sIAAAAAAAAA6tWyk0tSs5ITUxRslIqS8wpTVWqBQBL0RbkEwAAAA==";
const SIGNER_FIXTURE_B = "H4sIAAAAAAAAA6tWSkksSVSyUsrMyyrKz1OqBQBVrD9YEAAAAA==";

function describeThrow(e: unknown): string {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/**
 * A WireSigner signs deterministically, returns a non-blank string, and gives two different
 * bodies two different signatures. It does not check the KEY - only the server can say
 * whether a signature is accepted, and a known-answer test in the host is where that lives.
 */
export function assertWireSignerConformance(signer: WireSigner): void {
    const r = new ConformanceReport("WireSigner");
    if (!signer || typeof signer.sign !== "function") {
        r.fail("the signer has no sign() method");
        r.throwIfFailed();
    }
    let a1: unknown, a2: unknown, b: unknown;
    try {
        a1 = signer.sign(SIGNER_FIXTURE_A);
        a2 = signer.sign(SIGNER_FIXTURE_A);
        b = signer.sign(SIGNER_FIXTURE_B);
    } catch (e) {
        r.fail(`sign() threw on an ordinary encoded body: ${describeThrow(e)}`);
        r.throwIfFailed();
    }
    r.check(typeof a1 === "string", `sign() returned ${typeof a1}, not a string`);
    r.check(typeof a1 !== "string" || a1.trim() !== "", "sign() returned a blank signature");
    r.check(a1 === a2, "sign() is not deterministic: the same body signed twice gave two signatures");
    r.check(a1 !== b, "sign() gave two different bodies the same signature");
    r.throwIfFailed();
}

/**
 * A host's WireResponse adapter, driven through the four responses every transport meets: an
 * NDJSON stream read as it arrives, a buffered JSON body, a body that errors part-way (an abort
 * or a dropped connection), and a 204 with no body. `adapt` turns a platform fetch `Response`
 * into a WireResponse - a host that wraps some other client passes the function that wraps that
 * client's response. Needs a global `Response` (browsers; Node 18 and later).
 */
export async function assertWireResponseConformance(adapt: (res: Response) => WireResponse): Promise<void> {
    const r = new ConformanceReport("WireResponse");
    const enc = new TextEncoder();
    const lines = [
        '{"type":"progress","stage":"Reading your data"}\n',
        '{"type":"result","result":{"code":"x","version":2}}\n',
    ];
    const streamOf = (chunks: Uint8Array[], failAfter = false) => new ReadableStream<Uint8Array>({
        start(ctl) {
            for (const c of chunks) ctl.enqueue(c);
            if (failAfter) ctl.error(Object.assign(new Error("the connection dropped"), { name: "AbortError" }));
            else ctl.close();
        },
    });

    try {
        const ndjson = adapt(new Response(streamOf(lines.map(l => enc.encode(l))), {
            status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        }));
        r.check(ndjson.status === 200, `a streamed 200 reported status ${ndjson.status}`);
        r.check(isNdjsonContentType(ndjson.contentType), `a streamed response reported content type ${JSON.stringify(ndjson.contentType)}`);
        const stages: string[] = [];
        const out = await readGenerateStream(ndjson, s => stages.push(s));
        r.check(out?.code === "x" && out?.version === 2, "the stream's result line did not come back as the result");
        r.check(stages.join("|") === "Reading your data", `progress stages read as ${JSON.stringify(stages)}`);
    } catch (e) {
        r.fail(`reading an NDJSON stream threw: ${describeThrow(e)}`);
    }

    try {
        const buffered = adapt(new Response('{"code":"y","errorMessage":""}', {
            status: 200, headers: { "Content-Type": "application/json" },
        }));
        r.check(!isNdjsonContentType(buffered.contentType), "a JSON response reported an NDJSON content type");
        const out = await readGenerateStream(buffered);
        r.check(out?.code === "y", "a buffered JSON body did not come back as the result");
    } catch (e) {
        r.fail(`reading a buffered JSON body threw: ${describeThrow(e)}`);
    }

    try {
        const cut = adapt(new Response(streamOf([enc.encode(lines[0])], true), {
            status: 200, headers: { "Content-Type": "application/x-ndjson" },
        }));
        let err: any = null;
        try { await readGenerateStream(cut); } catch (e) { err = e; }
        r.check(!!err, "a body that errored part-way was read as a success");
        r.check(!err || err.name === "AbortError", `a body that errored part-way surfaced as ${err?.name}: ${err?.message}, not the body's own error`);
    } catch (e) {
        r.fail(`adapting a response whose body errors threw before it was read: ${describeThrow(e)}`);
    }

    try {
        const empty = adapt(new Response(null, { status: 204 }));
        r.check(empty.status === 204, `a 204 reported status ${empty.status}`);
        const t = await empty.text();
        r.check(t === "", `a 204's text() returned ${JSON.stringify(t)}`);
    } catch (e) {
        r.fail(`a 204 with no body threw: ${describeThrow(e)}`);
    }
    r.throwIfFailed();
}

/** The platform fetch's signature, as a transport adapter takes it. */
export type FetchLike = (input: any, init?: any) => Promise<Response>;

/** What a stub fetch saw: the request normalised, whichever form the adapter called fetch in. */
interface SeenRequest {
    url: string;
    method: string;
    headers: Headers;
    body: string;
    signal: AbortSignal | null;
}

async function seeRequest(input: any, init?: any): Promise<SeenRequest> {
    const req: Request = input instanceof Request ? input : new Request(String(input), init);
    // A signal passed beside a Request (as some clients do) is the one that governs the call.
    const signal: AbortSignal | null = init?.signal ?? req.signal ?? null;
    return { url: req.url, method: req.method, headers: req.headers, body: await req.text(), signal };
}

const aborted = () => Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

/** Settle `p` or report that it never did inside `ms`. */
async function within<T>(p: Promise<T>, ms: number): Promise<{ settled: true; ok: true; value: T } | { settled: true; ok: false; error: unknown } | { settled: false }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<{ settled: false }>(res => { timer = setTimeout(() => res({ settled: false }), ms); });
    try {
        return await Promise.race([
            p.then(value => ({ settled: true as const, ok: true as const, value }), error => ({ settled: true as const, ok: false as const, error })),
            late,
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * A host's WireTransport, built over a fetch the check supplies: `make(fetch)` returns the host's
 * adapter wired to that fetch, so a host whose adapter wraps some other client passes the function
 * that wires that client to the given fetch. Driven through what every transport meets: an ordinary
 * post (url, method, body and headers reach the network as given), an HTTP error (RESOLVES with its
 * status, and its body is still readable - a 4xx body carries the server's own explanation), a 204,
 * a network failure (rejects), no answer inside the deadline (rejects, and the request is aborted so
 * the socket drops), a body that stalls after headers that came in time (the deadline covers the
 * whole exchange, so the read ends in an error), and a caller's signal (rejects when it aborts). Uses
 * real timers and a deadline of a few tens of milliseconds.
 */
export async function assertWireTransportConformance(make: (fetch: FetchLike) => WireTransport): Promise<void> {
    const r = new ConformanceReport("WireTransport");
    const URL_ = "https://service.example/api/route/?nocache=1";
    const BODY = "H4sIAAAAAAAAA6tWyk0tSs5ITUxRslIqS8wpTVWqBQBL0RbkEwAAAA==";
    const HEADERS = { "Content-Type": "text/plain", "X-Signature": "12345" };
    const DEADLINE = 40;
    const PATIENCE = 1000;

    // An ordinary post.
    try {
        let seen: SeenRequest | null = null;
        const t = make(async (input, init) => {
            seen = await seeRequest(input, init);
            return new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } });
        });
        const out = await within(t.post(URL_, BODY, HEADERS, { timeoutMs: 5000 }), PATIENCE);
        if (!out.settled) r.fail("an ordinary post never settled");
        else if (out.ok === false) r.fail(`an ordinary post rejected: ${describeThrow(out.error)}`);
        else {
            const s = seen as SeenRequest | null;
            r.check(!!s, "the adapter never called the fetch it was given");
            if (s) {
                r.check(s.url === URL_, `the request went to ${s.url}, not the URL it was given`);
                r.check(s.method === "POST", `the request was a ${s.method}, not a POST`);
                r.check(s.body === BODY, "the body did not reach the network as given");
                r.check(s.headers.get("content-type") === "text/plain", `Content-Type reached the network as ${s.headers.get("content-type")}`);
                r.check(s.headers.get("x-signature") === "12345", "a header the caller set did not reach the network");
            }
            r.check(out.value.status === 200, `a 200 reported status ${out.value.status}`);
            r.check(isNdjsonContentType(out.value.contentType) === false && /json/.test(String(out.value.contentType)),
                `the response's content type read as ${JSON.stringify(out.value.contentType)}`);
            r.check((await out.value.text()) === '{"ok":true}', "text() did not return the body");
        }
    } catch (e) {
        r.fail(`an ordinary post threw: ${describeThrow(e)}`);
    }

    // An HTTP error resolves, with its body.
    for (const status of [400, 500, 503]) {
        try {
            const t = make(async () => new Response('{"message":"why"}', { status, headers: { "Content-Type": "application/json" } }));
            const out = await within(t.post(URL_, BODY, HEADERS, { timeoutMs: 5000 }), PATIENCE);
            if (!out.settled) r.fail(`an HTTP ${status} never settled`);
            else if (out.ok === false) r.fail(`an HTTP ${status} rejected (${describeThrow(out.error)}) - a status is an answer, not a transport failure`);
            else {
                r.check(out.value.status === status, `an HTTP ${status} reported status ${out.value.status}`);
                r.check((await out.value.text()) === '{"message":"why"}', `an HTTP ${status}'s body could not be read`);
            }
        } catch (e) {
            r.fail(`an HTTP ${status} threw: ${describeThrow(e)}`);
        }
    }

    // A 204.
    try {
        const t = make(async () => new Response(null, { status: 204 }));
        const out = await within(t.post(URL_, BODY, HEADERS, { timeoutMs: 5000 }), PATIENCE);
        if (!out.settled || !out.ok) r.fail("a 204 did not resolve");
        else r.check(out.value.status === 204, `a 204 reported status ${out.value.status}`);
    } catch (e) {
        r.fail(`a 204 threw: ${describeThrow(e)}`);
    }

    // A network failure rejects.
    try {
        const t = make(async () => { throw new TypeError("Failed to fetch"); });
        const out = await within(t.post(URL_, BODY, HEADERS, { timeoutMs: 5000 }), PATIENCE);
        r.check(out.settled && !out.ok, "a failed connection did not reject");
    } catch (e) {
        r.fail(`a failed connection threw synchronously: ${describeThrow(e)}`);
    }

    // No answer inside the deadline rejects, and the request is aborted.
    try {
        let signal: AbortSignal | null = null;
        const t = make((input, init) => new Promise<Response>((_ok, fail) => {
            void seeRequest(input, init).then(s => {
                signal = s.signal;
                if (!s.signal) return;
                if (s.signal.aborted) fail(aborted());
                else s.signal.addEventListener("abort", () => fail(aborted()), { once: true });
            });
        }));
        const out = await within(t.post(URL_, BODY, HEADERS, { timeoutMs: DEADLINE }), PATIENCE);
        r.check(out.settled && !out.ok, `no answer inside a ${DEADLINE} ms deadline did not reject within ${PATIENCE} ms`);
        const sig = signal as AbortSignal | null;
        r.check(!!sig && sig.aborted, "the deadline passed but the request was not aborted - the socket would stay open");
    } catch (e) {
        r.fail(`the deadline check threw synchronously: ${describeThrow(e)}`);
    }

    // The deadline covers the BODY: headers that arrive in time and a body that then stalls end in an
    // error when the deadline passes, never a read that waits for ever.
    try {
        let signal: AbortSignal | null = null;
        const enc = new TextEncoder();
        const t = make(async (input, init) => {
            const s = await seeRequest(input, init);
            signal = s.signal;
            let ctl!: ReadableStreamDefaultController<Uint8Array>;
            const stream = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
            ctl.enqueue(enc.encode('{"type":"progress","stage":"Reading your data"}\n'));
            // Like a platform body, it errors when its request is aborted.
            s.signal?.addEventListener("abort", () => { try { ctl.error(aborted()); } catch { /* closed */ } }, { once: true });
            return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
        });
        const out = await within(t.post(URL_, BODY, HEADERS, { timeoutMs: DEADLINE }), PATIENCE);
        if (!out.settled || out.ok === false) r.fail("headers that arrived in time did not resolve the post");
        else {
            const read = await within(readGenerateStream(out.value), PATIENCE);
            r.check(read.settled && read.ok === false,
                `a body that stalled after its headers was still being read ${PATIENCE} ms after a ${DEADLINE} ms deadline`);
            const sig = signal as AbortSignal | null;
            r.check(!!sig && sig.aborted, "the deadline passed mid-body but the request was not aborted - the socket would stay open");
        }
    } catch (e) {
        r.fail(`the body-deadline check threw synchronously: ${describeThrow(e)}`);
    }

    // A caller's signal rejects when it aborts.
    try {
        const caller = new AbortController();
        const t = make((input, init) => new Promise<Response>((_ok, fail) => {
            void seeRequest(input, init).then(s => {
                if (!s.signal) return;
                if (s.signal.aborted) fail(aborted());
                else s.signal.addEventListener("abort", () => fail(aborted()), { once: true });
            });
        }));
        const p = t.post(URL_, BODY, HEADERS, { timeoutMs: 5000, signal: caller.signal });
        setTimeout(() => caller.abort(), 10);
        const out = await within(p, PATIENCE);
        r.check(out.settled && !out.ok, "aborting the caller's signal did not reject the post");
    } catch (e) {
        r.fail(`the caller-signal check threw synchronously: ${describeThrow(e)}`);
    }

    r.throwIfFailed();
}
