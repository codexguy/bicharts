// THE GENERATE CLIENT (2026-09-25) - the post and the read of every call a charting host makes to the
// chart service, once: a generation (and the version and correlation fetches that ride its route), the
// what-fits list, the image review and an example chart.
//
// Each host built these posts by hand, and each wrote the same steps slightly differently: the
// envelope, the signature, the URL and its cache-busting stamp, the deadline, and - the part that
// decided what a reader was told - what a failure IS. This client does the steps once and reaches the
// network only through the WireTransport the host passes. What stays with the host is its own: the
// request it builds (the payload is the host's), its words for every failure, and its rule for what
// happens next - retry, recover, or give up. This client decides none of those.
//
// EVERY CALL RESOLVES AS AN OUTCOME, one of three:
//  - answer     a 2xx whose body was read: the generate result (streamed or buffered, by
//               readGenerateStream), or the parsed JSON body of the other three calls;
//  - http       a status outside 2xx, with its reason phrase and the first HTTP_BODY_START_CHARS
//               characters of its body - the service's own explanation, when it sent one;
//  - transport  nothing to read: the connection failed, the deadline passed, the caller cancelled,
//               or a 2xx body broke off or did not parse. `headersReceived` says whether the service
//               answered before the failure - on a generate, the one fact that separates "the service
//               never saw this" from "the service may be building it now without us". The error is
//               carried as thrown, so a host can keep reading it the way it always has.
//
// A request that cannot be BUILT - a payload that will not serialize, a signer that fails, a deadline
// that is not a positive number - is not an outcome: the call rejects, exactly where encoding the
// request by hand would have thrown.

import type { Clock, WireResponse, WireSigner, WireTransport } from "./host/services";
import { encodePayload, messageSignature } from "./wire";
import { readGenerateStream, type OnStage } from "./wireStream";

/** The services a generate client needs - the wire-level subset every host that sends requests has. */
export interface GenerateClientServices {
    signer: WireSigner;
    transport: WireTransport;
    clock: Clock;
}

/** Which call a request is. */
export type GenerateCall = "generate" | "qualify" | "review" | "sample";

export interface GenerateClientEnv {
    /**
     * The service's origin, with no trailing slash: "https://example.com". A function is read at every
     * call, for a host whose target can change after the client is built.
     */
    baseUrl: string | (() => string);
    /** The API prefix between the origin and the route. Default "/api". */
    apiPath?: string;
    /**
     * The cache-busting value each URL carries as `nocache`, per call. Default: the clock's now(), in
     * decimal. A host that stamps its URLs another way passes its own.
     */
    nocache?: ((call: GenerateCall) => string) | null;
}

/** How many characters of a non-2xx body an `http` outcome keeps. */
export const HTTP_BODY_START_CHARS = 300;

/** A 2xx whose body was read. */
export interface AnswerOutcome<T> {
    kind: "answer";
    status: number;
    value: T;
}

/** A status outside 2xx. `statusText` is "" when the platform had no reason phrase (HTTP/2). */
export interface HttpOutcome {
    kind: "http";
    status: number;
    statusText: string;
    /** The first HTTP_BODY_START_CHARS characters of the body; "" when it was empty, unreadable or not read. */
    bodyStart: string;
}

/**
 * Nothing to read. `headersReceived` is true when a 2xx arrived and its body then broke off, timed out
 * or did not parse. `cancelled` is true when the caller's signal was aborted; `timedOut` when the
 * transport's deadline passed (an error named "TimeoutError") and the caller had not cancelled.
 */
export interface TransportOutcome {
    kind: "transport";
    headersReceived: boolean;
    timedOut: boolean;
    cancelled: boolean;
    error: unknown;
}

export type WireOutcome<T> = AnswerOutcome<T> | HttpOutcome | TransportOutcome;

export interface WireCallOptions {
    /** The deadline for the whole exchange, in milliseconds - the headers and the body. */
    timeoutMs: number;
    /** Cancels the call at any point. */
    signal?: AbortSignal | null;
    /**
     * Whether a non-2xx body is read for `bodyStart`. Default true. False leaves it unread (released,
     * never awaited), for a host that never shows it and must not wait on it.
     */
    readErrorBody?: boolean;
}

export interface GenerateCallOptions extends WireCallOptions {
    /** Each progress line of a streamed generate: its label and, from a newer server, its code. */
    onStage?: OnStage | null;
}

export interface QualifyCallOptions extends WireCallOptions {
    /** The route under the API prefix. Default "/LLMChart/qualify". */
    route?: string;
}

export interface GenerateClient {
    /**
     * POST a generate request - or a fetch by version or by correlation, which ride the same route and
     * differ only in the payload's fetch fields - as the signed envelope. The answer is the result the
     * response carries, read by readGenerateStream.
     */
    generate(payload: unknown, opts: GenerateCallOptions): Promise<WireOutcome<Record<string, any>>>;
    /** POST a what-fits request as the signed envelope. The answer is the parsed JSON body. */
    qualify(payload: unknown, opts: QualifyCallOptions): Promise<WireOutcome<unknown>>;
    /**
     * POST one image-review call as PLAIN JSON, signed over that text - never the envelope: the review
     * route reads and signs the raw body. The answer is the parsed JSON body.
     */
    review(wire: unknown, opts: WireCallOptions): Promise<WireOutcome<unknown>>;
    /** POST an example-chart request as the signed envelope. The answer is the parsed JSON body. */
    sample(payload: unknown, opts: WireCallOptions): Promise<WireOutcome<unknown>>;
}

const GENERATE_ROUTE = "/LLMChart/";
const QUALIFY_ROUTE = "/LLMChart/qualify";
const REVIEW_ROUTE = "/VisionReview/";
const SAMPLE_ROUTE = "/LLMChart/sample";

const isTimeout = (e: unknown): boolean =>
    !!e && typeof e === "object" && (e as { name?: unknown }).name === "TimeoutError";

const readJson = async (res: WireResponse): Promise<unknown> => JSON.parse(await res.text());

/** Let go of a body nobody will read, so the transport can end its deadline and free the connection. */
function release(res: WireResponse): void {
    try {
        if (res.body) void res.body.cancel().catch(() => undefined);
        else void res.text().catch(() => undefined);
    } catch { /* already released, or a response with nothing to release */ }
}

/**
 * Build a generate client over the host's services. A missing service or an unusable setting is a
 * TypeError here, at construction, never a fallback at the first call.
 */
export function createGenerateClient(services: GenerateClientServices, env: GenerateClientEnv): GenerateClient {
    const s = services as Partial<GenerateClientServices> | null | undefined;
    if (!s || !s.signer || typeof s.signer.sign !== "function") throw new TypeError("createGenerateClient needs the host's signer");
    if (!s.transport || typeof s.transport.post !== "function") throw new TypeError("createGenerateClient needs the host's transport");
    if (!s.clock || typeof s.clock.now !== "function") throw new TypeError("createGenerateClient needs the host's clock");
    if (!env || (typeof env.baseUrl !== "string" && typeof env.baseUrl !== "function")) {
        throw new TypeError("createGenerateClient needs the service's base URL");
    }
    if (typeof env.baseUrl === "string" && env.baseUrl === "") throw new TypeError("createGenerateClient needs the service's base URL");
    if (env.apiPath !== undefined && typeof env.apiPath !== "string") throw new TypeError("createGenerateClient's apiPath must be a string");
    if (env.nocache !== undefined && env.nocache !== null && typeof env.nocache !== "function") {
        throw new TypeError("createGenerateClient's nocache must be a function");
    }
    const { signer, transport, clock } = s as GenerateClientServices;
    const apiPath = env.apiPath ?? "/api";
    const base = (): string => (typeof env.baseUrl === "function" ? env.baseUrl() : env.baseUrl);
    const stamp = (call: GenerateCall): string => (env.nocache ? env.nocache(call) : String(clock.now()));

    async function exchange<T>(
        call: GenerateCall, route: string, body: string, opts: WireCallOptions,
        read: (res: WireResponse) => Promise<T>,
    ): Promise<WireOutcome<T>> {
        const url = `${base()}${apiPath}${route}?nocache=${stamp(call)}`;
        const headers = { "Content-Type": "text/plain", "X-Signature": messageSignature(body, signer) };
        const signal = opts.signal ?? undefined;
        const failed = (headersReceived: boolean, error: unknown): TransportOutcome => {
            const cancelled = !!signal?.aborted;
            return { kind: "transport", headersReceived, timedOut: !cancelled && isTimeout(error), cancelled, error };
        };

        let res: WireResponse;
        try {
            res = await transport.post(url, body, headers, signal ? { timeoutMs: opts.timeoutMs, signal } : { timeoutMs: opts.timeoutMs });
        } catch (error) {
            return failed(false, error);
        }
        if (res.status < 200 || res.status > 299) {
            let bodyStart = "";
            if (opts.readErrorBody === false) release(res);
            else {
                try { bodyStart = (await res.text()).slice(0, HTTP_BODY_START_CHARS); } catch { /* empty, cut or unreadable */ }
            }
            return { kind: "http", status: res.status, statusText: res.statusText ?? "", bodyStart };
        }
        try {
            return { kind: "answer", status: res.status, value: await read(res) };
        } catch (error) {
            return failed(true, error);
        }
    }

    function checked<O extends WireCallOptions>(call: GenerateCall, opts: O): O {
        if (!opts || typeof opts.timeoutMs !== "number" || !Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
            throw new TypeError(`The ${call} call needs a positive deadline in milliseconds`);
        }
        return opts;
    }

    return {
        async generate(payload, opts) {
            const o = checked("generate", opts);
            const onStage = o.onStage ?? undefined;
            return exchange("generate", GENERATE_ROUTE, encodePayload(payload), o, res => readGenerateStream(res, onStage));
        },

        async qualify(payload, opts) {
            const o = checked("qualify", opts);
            const route = o.route ?? QUALIFY_ROUTE;
            if (typeof route !== "string" || !route.startsWith("/")) throw new TypeError("The qualify route must start with '/'");
            return exchange("qualify", route, encodePayload(payload), o, readJson);
        },

        async review(wire, opts) {
            const o = checked("review", opts);
            const body = JSON.stringify(wire);
            if (typeof body !== "string") throw new TypeError("The review wire did not serialize to JSON");
            return exchange("review", REVIEW_ROUTE, body, o, readJson);
        },

        async sample(payload, opts) {
            const o = checked("sample", opts);
            return exchange("sample", SAMPLE_ROUTE, encodePayload(payload), o, readJson);
        },
    };
}
