// THE TELEMETRY CLIENT (2026-09-25) - the encode, sign and post of both telemetry channels, once.
//
// telemetry.ts states the words a host's telemetry is written in; this file sends them. A host builds
// its own rows (what a render-ok row carries, which events it counts) and keeps its own ship policy
// (when to send, what to wait for first). What every host used to write by hand, and each wrote
// slightly differently, is the post itself: the envelope, the signature, the URL, the deadline and
// what happens when the post fails. That lives here, and reaches the network only through the
// WireTransport the host passes.
//
// TELEMETRY NEVER BREAKS WHAT IT OBSERVES. Neither method throws and neither promise rejects, whatever
// the transport does: a failure goes to the host's optional `onFailure` and nowhere else. A host that
// passes none hears nothing. A caller may await a post (to sequence after it) or drop the promise; the
// result is the same either way.

import type { Clock, WireSigner, WireTransport } from "./host/services";
import type { ClientMessage } from "./telemetry";
import { eventLogLine } from "./telemetry";
import { encodePayload, messageSignature } from "./wire";

/** The services a telemetry client needs - the wire-level subset every host that sends requests has. */
export interface TelemetryServices {
    signer: WireSigner;
    transport: WireTransport;
    clock: Clock;
}

/** Which channel a post went to. */
export type TelemetryChannel = "client-message" | "event-count";

/**
 * A post that did not land. `stage` says where it stopped: `build` (the row could not be encoded or
 * signed), `post` (the transport rejected: no connection, the deadline, an abort) or `status` (the
 * service answered, with a status outside 2xx). `status` is the HTTP status for a `status` failure and
 * null otherwise; `error` is what was thrown for `build` and `post`, and null for `status`.
 */
export interface TelemetryFailure {
    channel: TelemetryChannel;
    stage: "build" | "post" | "status";
    status: number | null;
    error: unknown;
}

export interface TelemetryEnv {
    /**
     * The service's origin, with no trailing slash: "https://example.com". A function is read at every
     * post, for a host whose target can change after the client is built.
     */
    baseUrl: string | (() => string);
    /** The API prefix between the origin and the route. Default "/api". */
    apiPath?: string;
    /** The version every event-count line carries. */
    clientVersion: string;
    /** The deadline for one post, in milliseconds. Both channels use it. */
    timeoutMs: number;
    /** Told of a post that did not land. Never required; a throw inside it is swallowed. */
    onFailure?: ((failure: TelemetryFailure) => void) | null;
}

export interface TelemetryClient {
    /**
     * Encode, sign and post one client message, as written - the row's key order is the envelope's.
     * The URL carries a `nocache` stamp from the clock. Resolves when the post settles; never rejects.
     */
    sendClientMessage(message: ClientMessage): Promise<void>;
    /**
     * Post one event-count line, unsigned and as plain text: `eventLogLine(code, clientVersion,
     * clientId, magnitude)`. The code is sent as given - a host that did not write the code itself
     * checks it with `isEventLogCode` first. Resolves when the post settles; never rejects.
     */
    countEvent(code: string, clientId: string, magnitude?: { count: number; nonce: string }): Promise<void>;
}

/**
 * Build a telemetry client over the host's services. A missing service or an unusable setting is a
 * TypeError here, at construction, never a fallback at the first post.
 */
export function createTelemetryClient(services: TelemetryServices, env: TelemetryEnv): TelemetryClient {
    const s = services as Partial<TelemetryServices> | null | undefined;
    if (!s || !s.signer || typeof s.signer.sign !== "function") throw new TypeError("createTelemetryClient needs the host's signer");
    if (!s.transport || typeof s.transport.post !== "function") throw new TypeError("createTelemetryClient needs the host's transport");
    if (!s.clock || typeof s.clock.now !== "function") throw new TypeError("createTelemetryClient needs the host's clock");
    if (!env || (typeof env.baseUrl !== "string" && typeof env.baseUrl !== "function")) {
        throw new TypeError("createTelemetryClient needs the service's base URL");
    }
    if (typeof env.baseUrl === "string" && env.baseUrl === "") throw new TypeError("createTelemetryClient needs the service's base URL");
    if (typeof env.clientVersion !== "string" || env.clientVersion === "") throw new TypeError("createTelemetryClient needs the client version");
    if (typeof env.timeoutMs !== "number" || !Number.isFinite(env.timeoutMs) || env.timeoutMs <= 0) {
        throw new TypeError("createTelemetryClient needs a positive deadline in milliseconds");
    }
    const { signer, transport, clock } = s as TelemetryServices;
    const apiPath = env.apiPath ?? "/api";
    const timeoutMs = env.timeoutMs;
    const base = (): string => (typeof env.baseUrl === "function" ? env.baseUrl() : env.baseUrl);

    const report = (failure: TelemetryFailure): void => {
        try { env.onFailure?.(failure); } catch { /* a reporter must not break the post it reports */ }
    };

    const post = async (channel: TelemetryChannel, url: string, body: string, headers: Record<string, string>): Promise<void> => {
        let status: number;
        try {
            const res = await transport.post(url, body, headers, { timeoutMs });
            status = res.status;
            // Nothing here reads the answer. Releasing an unread body frees the connection on a
            // runtime that holds it until the body is consumed; it changes nothing on the wire.
            try { void res.body?.cancel().catch(() => undefined); } catch { /* already released */ }
        } catch (error) {
            report({ channel, stage: "post", status: null, error });
            return;
        }
        if (status < 200 || status > 299) report({ channel, stage: "status", status, error: null });
    };

    return {
        async sendClientMessage(message: ClientMessage): Promise<void> {
            let url: string, body: string, signature: string;
            try {
                url = `${base()}${apiPath}/LogClientMsg/?nocache=${clock.now()}`;
                body = encodePayload(message);
                signature = messageSignature(body, signer);
            } catch (error) {
                report({ channel: "client-message", stage: "build", status: null, error });
                return;
            }
            await post("client-message", url, body, { "Content-Type": "text/plain", "X-Signature": signature });
        },

        async countEvent(code: string, clientId: string, magnitude?: { count: number; nonce: string }): Promise<void> {
            let url: string, line: string;
            try {
                url = `${base()}${apiPath}/eventlog`;
                line = eventLogLine(code, env.clientVersion, clientId, magnitude);
            } catch (error) {
                report({ channel: "event-count", stage: "build", status: null, error });
                return;
            }
            await post("event-count", url, line, { "Content-Type": "text/plain" });
        },
    };
}
