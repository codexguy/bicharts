import { describe, it, expect, vi } from "vitest";
import {
    createTelemetryClient, encodePayload, messageSignature, eventLogLine, keyedSigner,
    TELEMETRY_TIMEOUT_MS, TELEMETRY_TIMEOUT_DEV_MS,
    type TelemetryFailure, type WireTransport, type WireResponse, type ClientMessage,
} from "../src/index";

// The telemetry client posts what a host built, exactly as the host used to post it, and never lets
// a failure out except to the host's own reporter.

type Post = { url: string; body: string; headers: Record<string, string>; opts: { timeoutMs: number; signal?: AbortSignal } };

function recordingTransport(answer: (p: Post) => Promise<WireResponse>) {
    const posts: Post[] = [];
    const transport: WireTransport = {
        post: (url, body, headers, opts) => {
            const p = { url, body, headers, opts };
            posts.push(p);
            return answer(p);
        },
    };
    return { posts, transport };
}

const answered = (status: number, cancel = vi.fn(async () => undefined)): WireResponse => ({
    status, contentType: null, body: { cancel } as unknown as ReadableStream<Uint8Array>, text: async () => "",
});

const signer = keyedSigner("test-key");
const clock = { now: () => 1700000000123 };
const ROW: ClientMessage = { OutputHash: "H1", EventKind: "render-ok", Severity: 2, ClientVersion: "1.2.3.4", ClientRows: 12 };

function client(transport: WireTransport, over: Partial<Parameters<typeof createTelemetryClient>[1]> = {}) {
    const failures: TelemetryFailure[] = [];
    const c = createTelemetryClient({ signer, transport, clock }, {
        baseUrl: "https://service.example", clientVersion: "1.2.3.4", timeoutMs: 8000,
        onFailure: f => failures.push(f), ...over,
    });
    return { c, failures };
}

describe("a client message", () => {
    it("is the shared envelope, signed, posted to LogClientMsg with a nocache stamp from the clock", async () => {
        const { posts, transport } = recordingTransport(async () => answered(200));
        const { c, failures } = client(transport);
        await c.sendClientMessage(ROW);
        expect(posts).toHaveLength(1);
        const p = posts[0];
        expect(p.url).toBe("https://service.example/api/LogClientMsg/?nocache=1700000000123");
        expect(p.body).toBe(encodePayload(ROW));
        expect(p.headers).toEqual({ "Content-Type": "text/plain", "X-Signature": messageSignature(p.body, signer) });
        expect(p.opts).toEqual({ timeoutMs: 8000 });
        expect(failures).toEqual([]);
    });

    it("keeps the row's key order - the envelope compresses what the host wrote", async () => {
        const { posts, transport } = recordingTransport(async () => answered(200));
        const { c } = client(transport);
        const row = { Severity: 68, OutputHash: "H", EventKind: "render-error", StackTrace: "s" } as ClientMessage;
        await c.sendClientMessage(row);
        expect(posts[0].body).toBe(encodePayload({ Severity: 68, OutputHash: "H", EventKind: "render-error", StackTrace: "s" }));
    });

    it("reads a function base URL at every post, and honours another API path", async () => {
        const { posts, transport } = recordingTransport(async () => answered(200));
        let base = "https://one.example";
        const { c } = client(transport, { baseUrl: () => base, apiPath: "/svc" });
        await c.sendClientMessage(ROW);
        base = "https://two.example";
        await c.sendClientMessage(ROW);
        expect(posts.map(p => p.url.split("?")[0])).toEqual(["https://one.example/svc/LogClientMsg/", "https://two.example/svc/LogClientMsg/"]);
    });
});

describe("an event count", () => {
    it("is the plain line, unsigned, posted to eventlog", async () => {
        const { posts, transport } = recordingTransport(async () => answered(200));
        const { c } = client(transport);
        await c.countEvent("see_whats_sent", "cid-1");
        await c.countEvent("llm_touch", "cid-1", { count: 3, nonce: "n9" });
        expect(posts.map(p => [p.url, p.body, p.headers, p.opts])).toEqual([
            ["https://service.example/api/eventlog", eventLogLine("see_whats_sent", "1.2.3.4", "cid-1"), { "Content-Type": "text/plain" }, { timeoutMs: 8000 }],
            ["https://service.example/api/eventlog", "llm_touch,1.2.3.4|cid-1|3|n9", { "Content-Type": "text/plain" }, { timeoutMs: 8000 }],
        ]);
    });

    it("sends the code as given - checking it is the host's job", async () => {
        const { posts, transport } = recordingTransport(async () => answered(200));
        const { c } = client(transport);
        await c.countEvent("a|b", "cid");
        expect(posts[0].body).toBe("a|b,1.2.3.4|cid");
    });
});

describe("a post that does not land", () => {
    it("a transport rejection is reported as 'post' and never rejects the caller", async () => {
        const boom = new TypeError("Failed to fetch");
        const { transport } = recordingTransport(async () => { throw boom; });
        const { c, failures } = client(transport);
        await expect(c.sendClientMessage(ROW)).resolves.toBeUndefined();
        await expect(c.countEvent("x", "cid")).resolves.toBeUndefined();
        expect(failures).toEqual([
            { channel: "client-message", stage: "post", status: null, error: boom },
            { channel: "event-count", stage: "post", status: null, error: boom },
        ]);
    });

    it("a status outside 2xx is reported as 'status' with the status", async () => {
        const { transport } = recordingTransport(async p => answered(p.url.includes("eventlog") ? 503 : 500));
        const { c, failures } = client(transport);
        await c.sendClientMessage(ROW);
        await c.countEvent("x", "cid");
        expect(failures).toEqual([
            { channel: "client-message", stage: "status", status: 500, error: null },
            { channel: "event-count", stage: "status", status: 503, error: null },
        ]);
    });

    it("a row that cannot be built is reported as 'build', and nothing is posted", async () => {
        const { posts, transport } = recordingTransport(async () => answered(200));
        const blank = { sign: () => "" };
        const failures: TelemetryFailure[] = [];
        const c = createTelemetryClient({ signer: blank, transport, clock }, {
            baseUrl: "https://service.example", clientVersion: "1", timeoutMs: 8000, onFailure: f => failures.push(f),
        });
        await expect(c.sendClientMessage(ROW)).resolves.toBeUndefined();
        expect(posts).toHaveLength(0);
        expect(failures.map(f => [f.channel, f.stage])).toEqual([["client-message", "build"]]);
        const cyclic: any = { a: 1 }; cyclic.self = cyclic;
        await c.sendClientMessage(cyclic);
        expect(failures.map(f => f.stage)).toEqual(["build", "build"]);
    });

    it("with no reporter every failure is silent, and a reporter that throws is swallowed", async () => {
        const { transport } = recordingTransport(async () => { throw new Error("down"); });
        const quiet = createTelemetryClient({ signer, transport, clock }, { baseUrl: "https://s.example", clientVersion: "1", timeoutMs: 1 });
        await expect(quiet.sendClientMessage(ROW)).resolves.toBeUndefined();
        const loud = createTelemetryClient({ signer, transport, clock }, {
            baseUrl: "https://s.example", clientVersion: "1", timeoutMs: 1, onFailure: () => { throw new Error("reporter broke"); },
        });
        await expect(loud.countEvent("x", "c")).resolves.toBeUndefined();
    });

    it("an unread body is released after a post, landed or not", async () => {
        const cancel = vi.fn(async () => undefined);
        const { transport } = recordingTransport(async () => answered(500, cancel));
        const { c } = client(transport);
        await c.sendClientMessage(ROW);
        expect(cancel).toHaveBeenCalledTimes(1);
    });
});

describe("the telemetry deadline", () => {
    it("is 8 s, or 60 s against a development server", () => {
        expect([TELEMETRY_TIMEOUT_MS, TELEMETRY_TIMEOUT_DEV_MS]).toEqual([8000, 60000]);
    });
});

describe("construction", () => {
    const transport: WireTransport = { post: async () => answered(200) };
    const env = { baseUrl: "https://s.example", clientVersion: "1", timeoutMs: 8000 };
    it("a missing service or an unusable setting is a TypeError at once", () => {
        expect(() => createTelemetryClient({ signer: undefined as any, transport, clock }, env)).toThrow(TypeError);
        expect(() => createTelemetryClient({ signer, transport: null as any, clock }, env)).toThrow(TypeError);
        expect(() => createTelemetryClient({ signer, transport, clock: {} as any }, env)).toThrow(TypeError);
        expect(() => createTelemetryClient({ signer, transport, clock }, { ...env, baseUrl: "" })).toThrow(TypeError);
        expect(() => createTelemetryClient({ signer, transport, clock }, { ...env, clientVersion: "" })).toThrow(TypeError);
        for (const timeoutMs of [0, -1, NaN, Infinity]) {
            expect(() => createTelemetryClient({ signer, transport, clock }, { ...env, timeoutMs })).toThrow(TypeError);
        }
        expect(() => createTelemetryClient({ signer, transport, clock }, env)).not.toThrow();
    });
});
