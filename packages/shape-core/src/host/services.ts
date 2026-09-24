// HOST SERVICES - the wire-level half (2026-09-24).
//
// Shared client logic reaches its host only through services the host constructs and passes
// in. The shared code never reads a global (window, a host SDK, process), never asks which
// host it is running in, and never carries a per-host branch: where hosts differ, they differ
// in the services they pass, and the shared code branches on whether a service is PRESENT.
//
// This file declares the services that need no DOM - signing, transport, credentials, the
// clock, the viewport as a number pair, diagnostics - beside the wire types they serve. The
// render-level services (marker storage, preferences, theme, thumbnail consent, the snapshot
// target) and the composed HostServices object live in @bicharts/chart-host.
//
// TYPES ONLY. Nothing in this release consumes them; later releases move logic behind them
// one concern at a time. Each interface is written against every host before anything
// implements it: the Power BI visual, the Excel add-in, the Node MCP server (no DOM, no
// persistence, its own transport) and a plain web page (no credentials at run time).
//
// Required vs optional follows one rule: a member is required only when every host that
// sends requests provides it today. An optional member that is absent (or null) is the host
// saying it cannot do this; a capability is derived from that presence, never declared
// beside it.

/**
 * Signs an encoded request body. Every host that sends requests has one; the key stays in the
 * host (each keeps its own obfuscated literal) and the algorithm lives in the package.
 *
 * `sign` receives the body exactly as it will be sent - already encoded - and returns the
 * signature header value. It must be deterministic for a given body and must never return a
 * blank string: a well-formed signature that every request fails on reads as a network fault.
 */
export interface WireSigner {
    sign(encodedBody: string): string;
}

/**
 * The response half of a transport. `body` is the raw byte stream when the platform exposes
 * one (browser fetch, Node fetch) and null when it does not; `text()` always works and reads
 * the whole body. A consumer that streams reads `body`; one that does not calls `text()`.
 * Calling both on one response is not supported, as with fetch.
 */
export interface WireResponse {
    status: number;
    /** The Content-Type header as sent, or null when the server sent none. */
    contentType: string | null;
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
}

/**
 * Posts an encoded body. Every host provides one: the visual over its HTTP client, the
 * add-in over fetch with an abort controller, the MCP server over Node's fetch.
 *
 * `timeoutMs` is the host's deadline for the whole exchange; `signal` lets a caller cancel
 * earlier. A timeout or an abort rejects the promise; an HTTP error status does NOT reject -
 * it resolves with that status, because a 4xx body carries the server's own explanation.
 */
export interface WireTransport {
    post(
        url: string,
        encodedBody: string,
        headers: Record<string, string>,
        opts: { timeoutMs: number; signal?: AbortSignal },
    ): Promise<WireResponse>;
}

/** The licence triple as the wire carries it. Any member may be the empty string. */
export interface CredentialTriple {
    licensee: string;
    licenseKey: string;
    secretKey: string;
}

/**
 * What a request is entitled by. `triple()` is required: every host that sends requests can
 * answer it, even if every member is empty (a sign-in host before sign-in).
 *
 * Optional members, each from the host matrix:
 * - `linkNonce`: a host that signs in by a linked session rather than a typed key. Today the
 *   Excel add-in only; absent elsewhere.
 * - `freemiumKey`: a host with a free tier minted per install. Today the Power BI visual only;
 *   the add-in and the MCP server have no free tier by decision, and a page with no
 *   credentials has none either.
 * - `instanceKey`: an opaque per-install id for reporting, not a credential. The visual and
 *   the add-in mint one; the MCP server does not.
 *
 * Each returns null when the host supports it but has no value right now.
 */
export interface CredentialSource {
    triple(): CredentialTriple;
    linkNonce?: (() => string | null) | null;
    freemiumKey?: (() => string | null) | null;
    instanceKey?: (() => string | null) | null;
}

/**
 * The drawing area a request should be sized for, in CSS pixels. Provided by every host that
 * draws: the visual measures its tile, the add-in its pane, a web page its container. The MCP
 * server takes the size as arguments and passes none.
 */
export interface ViewportSource {
    measure(): { width: number; height: number };
}

/** Milliseconds since the epoch. Every host has one; a test passes a fixed one. */
export interface Clock {
    now(): number;
}

/**
 * One diagnostics breadcrumb: a short event name and an optional detail value. The sink owns
 * timestamping, summarising and shipping - the visual and the add-in each keep a bounded ring
 * and their own ship policy.
 */
export interface DiagnosticEntry {
    event: string;
    detail?: unknown;
}

/**
 * Where diagnostics breadcrumbs go. The visual and the add-in each provide one (a bounded
 * ring shipped to the server). The MCP server writes to stdio and keeps no verbose log, and a
 * demo page has nothing to ship to, so both pass none. `record` must never throw: a logger
 * that can break what it observes is worse than no logger.
 */
export interface DiagnosticsSink {
    record(entry: DiagnosticEntry): void;
}

/**
 * A chart renderer a host can execute. The set a host passes is what it can RUN, and is what
 * the request's supports* fields will be derived from, so a request can no longer ask for a
 * chart its host cannot draw. The MCP server generates without rendering, and passes the set
 * it asks the server for.
 */
export type RendererId = "D3" | "PLOTLY" | "VEGA" | "PYTHON";

/**
 * The wire-level subset of the services object a host constructs. The full object, with the
 * render-level services beside these, is `HostServices` in @bicharts/chart-host.
 */
export interface WireServices {
    // REQUIRED: every host that sends requests provides these, so their absence is a
    // compile error rather than a fallback at run time.
    signer: WireSigner;
    transport: WireTransport;
    credentials: CredentialSource;
    clock: Clock;
    renderers: ReadonlySet<RendererId>;
    // OPTIONAL: absent or null is the host declaring it cannot do this.
    /** Absent on the MCP server (sizes come as arguments). */
    viewport?: ViewportSource | null;
    /** Absent on the MCP server (stdio, no verbose log) and on a demo page. */
    diagnostics?: DiagnosticsSink | null;
}
