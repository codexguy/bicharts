import { describe, it, expect, vi } from "vitest";
import { fetchTransport, readGenerateStream, type WireTransport } from "../src/index";
import { assertWireTransportConformance, ConformanceError, type FetchLike } from "../src/testing/index";

// The transport over a platform fetch, and the conformance check every host's transport runs.

const abortError = () => Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

/** A 200 whose body the test writes; like a platform body, it errors when the request's signal aborts. */
function heldResponse(signal: AbortSignal, contentType = "application/x-ndjson") {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
    signal.addEventListener("abort", () => { try { ctl.error(signal.reason ?? abortError()); } catch { /* closed */ } }, { once: true });
    const enc = new TextEncoder();
    return {
        response: new Response(stream, { status: 200, headers: { "Content-Type": contentType } }),
        write: (t: string) => ctl.enqueue(enc.encode(t)),
        close: () => ctl.close(),
    };
}

describe("fetchTransport", () => {
    it("passes the WireTransport conformance check", async () => {
        await expect(assertWireTransportConformance(f => fetchTransport(f))).resolves.toBeUndefined();
    });

    it("posts with credentials 'omit' by default, and as asked otherwise", async () => {
        const seen: any[] = [];
        const f = vi.fn(async (_u: string, init: any) => { seen.push(init.credentials); return new Response(""); });
        await fetchTransport(f).post("https://s.example/a", "b", {}, { timeoutMs: 1000 });
        await fetchTransport(f, { credentials: "same-origin" }).post("https://s.example/a", "b", {}, { timeoutMs: 1000 });
        expect(seen).toEqual(["omit", "same-origin"]);
    });

    it("streams a body the caller reads as it arrives", async () => {
        const t = fetchTransport(async (_u, init) => {
            const h = heldResponse(init.signal);
            h.write('{"type":"progress","stage":"Reading your data"}\n');
            setTimeout(() => { h.write('{"type":"result","result":{"code":"x","version":2}}\n'); h.close(); }, 5);
            return h.response;
        });
        const res = await t.post("https://s.example/a", "b", {}, { timeoutMs: 1000 });
        const stages: string[] = [];
        const out = await readGenerateStream(res, s => stages.push(s));
        expect(out.code).toBe("x");
        expect(stages).toEqual(["Reading your data"]);
    });

    it("the deadline covers the BODY: a stream that stalls after its headers errors with a TimeoutError", async () => {
        let signal!: AbortSignal;
        const t = fetchTransport(async (_u, init) => {
            signal = init.signal;
            const h = heldResponse(init.signal);
            h.write('{"type":"progress","stage":"Reading your data"}\n');
            return h.response;
        });
        const res = await t.post("https://s.example/a", "b", {}, { timeoutMs: 40 });
        const started = Date.now();
        const err = await readGenerateStream(res).then(() => null, e => e);
        expect(err?.name).toBe("TimeoutError");
        expect(Date.now() - started).toBeLessThan(2000);
        expect(signal.aborted, "the request is aborted, so the socket drops").toBe(true);
    });

    it("no headers in time rejects with a TimeoutError", async () => {
        const t = fetchTransport((_u, init) => new Promise((_ok, fail) => {
            init.signal.addEventListener("abort", () => fail(abortError()), { once: true });
        }));
        await expect(t.post("https://s.example/a", "b", {}, { timeoutMs: 20 })).rejects.toMatchObject({ name: "TimeoutError" });
    });

    it("a body read to its end ends the deadline: nothing is aborted afterwards", async () => {
        let signal!: AbortSignal;
        const t = fetchTransport(async (_u, init) => { signal = init.signal; return new Response("done"); });
        const res = await t.post("https://s.example/a", "b", {}, { timeoutMs: 30 });
        expect(await res.text()).toBe("done");
        await new Promise(r => setTimeout(r, 80));
        expect(signal.aborted).toBe(false);
    });

    it("a cancelled body ends the deadline too", async () => {
        let signal!: AbortSignal;
        const t = fetchTransport(async (_u, init) => { signal = init.signal; return heldResponse(init.signal).response; });
        const res = await t.post("https://s.example/a", "b", {}, { timeoutMs: 30 });
        await res.body!.cancel();
        await new Promise(r => setTimeout(r, 80));
        expect(signal.aborted).toBe(false);
    });

    it("a caller's signal cancels mid-body, with the caller's reason rather than a timeout", async () => {
        const caller = new AbortController();
        const t = fetchTransport(async (_u, init) => heldResponse(init.signal).response);
        const res = await t.post("https://s.example/a", "b", {}, { timeoutMs: 5000, signal: caller.signal });
        const reading = readGenerateStream(res).then(() => null, e => e);
        caller.abort(abortError());
        const err = await reading;
        expect(err?.name).toBe("AbortError");
    });

    it("needs the host's fetch", () => {
        expect(() => fetchTransport(undefined as any)).toThrow(TypeError);
    });
});

// A broken adapter makes the check wait out its patience window on every case it fails.
describe("assertWireTransportConformance catches what it claims to", { timeout: 15000 }, () => {
    const failuresOf = async (make: (f: FetchLike) => WireTransport): Promise<string[]> => {
        try {
            await assertWireTransportConformance(make);
            return [];
        } catch (e) {
            expect(e).toBeInstanceOf(ConformanceError);
            return [...(e as ConformanceError).failures];
        }
    };

    it("a transport that throws on an HTTP error", async () => {
        const f = await failuresOf(fetch => {
            const inner = fetchTransport(fetch);
            return {
                post: async (...a) => {
                    const res = await inner.post(...a);
                    if (res.status >= 400) throw Object.assign(new Error(`Request failed with status code ${res.status}`), { name: "HTTPError" });
                    return res;
                },
            };
        });
        expect(f.some(m => /HTTP 500 rejected/.test(m))).toBe(true);
    });

    it("a transport with no deadline", async () => {
        const f = await failuresOf(fetch => ({
            post: async (url, body, headers) => {
                const res = await fetch(url, { method: "POST", body, headers });
                return { status: res.status, contentType: res.headers.get("content-type"), body: res.body, text: () => res.text() };
            },
        }));
        expect(f.some(m => /deadline did not reject/.test(m))).toBe(true);
        expect(f.some(m => /caller's signal did not reject/.test(m))).toBe(true);
    });

    it("a transport whose deadline stops at the headers", async () => {
        const f = await failuresOf(fetch => ({
            post: async (url, body, headers, opts) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
                try {
                    const res = await fetch(url, { method: "POST", body, headers, signal: controller.signal });
                    return { status: res.status, contentType: res.headers.get("content-type"), body: res.body, text: () => res.text() };
                } finally {
                    clearTimeout(timer);
                }
            },
        }));
        expect(f.some(m => /stalled after its headers was still being read/.test(m))).toBe(true);
        expect(f.some(m => /HTTP \d+ rejected/.test(m))).toBe(false);
    });

    it("a transport that drops a header", async () => {
        const f = await failuresOf(fetch => {
            const inner = fetchTransport(fetch);
            return { post: (url, body, _h, opts) => inner.post(url, body, { "Content-Type": "text/plain" }, opts) };
        });
        expect(f).toContain("a header the caller set did not reach the network");
    });

    it("a transport whose deadline surfaces as a plain abort, so a caller would read it as a dropped connection", async () => {
        const f = await failuresOf(fetch => ({
            post: async (url, body, headers, opts) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
                const res = await fetch(url, { method: "POST", body, headers, signal: controller.signal }).catch(e => {
                    clearTimeout(timer);
                    throw e;
                });
                // The deadline runs on through the body (it covers the whole exchange), but ends as an AbortError.
                return { status: res.status, contentType: res.headers.get("content-type"), body: res.body, text: () => res.text() };
            },
        }));
        expect(f.some(m => /deadline's rejection was named "AbortError"/.test(m))).toBe(true);
        expect(f.some(m => /deadline's body error was named "AbortError"/.test(m))).toBe(true);
    });
});
