// A WIRE TRANSPORT OVER A PLATFORM FETCH (2026-09-25).
//
// Every host that sends requests has a fetch: a browser page, an Office pane, a report visual's
// sandbox and Node 18 or later. This builds the WireTransport contract (host/services.ts) over one,
// so a host passes its fetch and gets the contract's semantics without writing them:
//
//  - a POST with the body and headers as given, and credentials "omit" unless the host asks
//    otherwise: the service needs no cookie, and a page served from the service's own origin must
//    not send one;
//  - an HTTP status outside 2xx RESOLVES, with its body readable - a 4xx body carries the server's
//    own explanation, and deciding what a status means is the caller's job, not the transport's;
//  - the deadline covers the WHOLE exchange: no headers in time rejects with a TimeoutError, and a
//    body still arriving when it passes errors with one, so a stalled stream cannot hold its caller;
//  - a caller's signal cancels at any point.
//
// The fetch is the host's, passed in: this package never reads a global.

import type { WireResponse, WireTransport } from "./host/services";
import { wireResponseFromFetch } from "./wireStream";

/** A platform fetch, or anything shaped like one. Called as a plain function. */
export type FetchFunction = (input: string, init?: any) => Promise<{
    status?: number;
    headers?: { get(name: string): string | null } | null;
    body?: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
}>;

export interface FetchTransportOptions {
    /** The credentials mode every request carries. Default "omit". */
    credentials?: "omit" | "same-origin" | "include";
}

function timeoutError(ms: number): Error {
    return Object.assign(new Error(`The request did not finish within ${ms} ms.`), { name: "TimeoutError" });
}

/**
 * A WireTransport over `fetchFn`. Every request is a POST; each call's `timeoutMs` covers the headers
 * and the body; the caller's `signal`, when given, cancels as well.
 */
export function fetchTransport(fetchFn: FetchFunction, options: FetchTransportOptions = {}): WireTransport {
    if (typeof fetchFn !== "function") throw new TypeError("fetchTransport needs the host's fetch");
    const call = fetchFn;
    const credentials = options.credentials ?? "omit";
    return {
        async post(url, encodedBody, headers, opts): Promise<WireResponse> {
            const ms = opts.timeoutMs;
            const controller = new AbortController();
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; controller.abort(timeoutError(ms)); }, ms);
            const onCallerAbort = () => controller.abort(opts.signal?.reason);
            if (opts.signal) {
                if (opts.signal.aborted) onCallerAbort();
                else opts.signal.addEventListener("abort", onCallerAbort, { once: true });
            }
            let finished = false;
            const done = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                opts.signal?.removeEventListener("abort", onCallerAbort);
            };
            const failure = (e: unknown) => (timedOut ? timeoutError(ms) : e);

            let res: Awaited<ReturnType<FetchFunction>>;
            try {
                res = await call(url, { method: "POST", body: encodedBody, headers, credentials, signal: controller.signal });
            } catch (e) {
                done();
                throw failure(e);
            }
            const wire = wireResponseFromFetch(res);
            if (!wire.body) {
                // Nothing to stream: text() is the only read, and it ends the deadline.
                return {
                    status: wire.status, contentType: wire.contentType, body: null,
                    text: async () => {
                        try { return await wire.text(); } catch (e) { throw failure(e); } finally { done(); }
                    },
                };
            }
            // The deadline runs until the body is read to its end, fails, or is cancelled. Pull-based,
            // so nothing is read before the caller asks.
            const reader = wire.body.getReader();
            const body = new ReadableStream<Uint8Array>({
                async pull(ctl) {
                    try {
                        const next = await reader.read();
                        if (next.done) { done(); ctl.close(); return; }
                        ctl.enqueue(next.value);
                    } catch (e) {
                        done();
                        ctl.error(failure(e));
                    }
                },
                cancel(reason) {
                    done();
                    return reader.cancel(reason);
                },
            });
            return {
                status: wire.status, contentType: wire.contentType, body,
                text: () => new Response(body).text(),
            };
        },
    };
}
