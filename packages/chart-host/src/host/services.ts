// HOST SERVICES - the render-level half, and the composed object a host passes (2026-09-24).
//
// Shared client logic reaches its host only through services the host constructs. The shared
// code never reads a global, never asks which host it is in, and never carries a per-host
// branch; it branches on whether a service is PRESENT. The DOM-free services (signing,
// transport, credentials, clock, viewport, diagnostics) are declared in @bicharts/shape-core
// beside the wire types they serve. This file declares the ones that belong to rendering and
// to the reader's session, and HostServices, the whole object.
//
// TYPES ONLY in this release. Nothing consumes them yet; later releases move logic behind them
// one concern at a time, and each contract ships a conformance check in the
// "@bicharts/chart-host/testing" subpath that every host runs against its own adapter first.
//
// WHY THE WIRE INTERFACES ARE RESTATED BELOW rather than imported: shape-core is bundled into
// this package, not installed beside it, so a published declaration naming
// "@bicharts/shape-core" would point a consumer at a package they never installed (the same
// reason GeoPointPrecision is declared in contract.ts). The two declarations are held identical
// by a test in this package that assigns each one to the other in both directions.

import type { RenderOptions } from "../contract";

// ---- The wire-level services, restated (see above; kept identical to shape-core's) ----

/** Signs an encoded request body. See @bicharts/shape-core's host/services.ts. */
export interface WireSigner {
    sign(encodedBody: string): string;
}

/** The response half of a transport. See @bicharts/shape-core's host/services.ts. */
export interface WireResponse {
    status: number;
    contentType: string | null;
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
}

/** Posts an encoded body. See @bicharts/shape-core's host/services.ts. */
export interface WireTransport {
    post(
        url: string,
        encodedBody: string,
        headers: Record<string, string>,
        opts: { timeoutMs: number; signal?: AbortSignal },
    ): Promise<WireResponse>;
}

/** The licence triple as the wire carries it. */
export interface CredentialTriple {
    licensee: string;
    licenseKey: string;
    secretKey: string;
}

/** What a request is entitled by. See @bicharts/shape-core's host/services.ts. */
export interface CredentialSource {
    triple(): CredentialTriple;
    linkNonce?: (() => string | null) | null;
    freemiumKey?: (() => string | null) | null;
    instanceKey?: (() => string | null) | null;
}

/** The drawing area a request should be sized for, in CSS pixels. */
export interface ViewportSource {
    measure(): { width: number; height: number };
}

/** Milliseconds since the epoch. */
export interface Clock {
    now(): number;
}

/** One diagnostics breadcrumb. */
export interface DiagnosticEntry {
    event: string;
    detail?: unknown;
}

/** Where diagnostics breadcrumbs go. `record` never throws. */
export interface DiagnosticsSink {
    record(entry: DiagnosticEntry): void;
}

/** A chart renderer a host can execute. */
export type RendererId = "D3" | "PLOTLY" | "VEGA" | "PYTHON";

// ---- The render-level services ----

/**
 * Small string values that must outlive the page: the pending-generate marker is the first.
 * The visual keeps them in the report, the add-in in the workbook. The MCP server holds a
 * generate only for the length of one call and passes none; a demo page has nothing to
 * recover and passes none.
 *
 * `read` returns null - not undefined, not "" - for a key never written or cleared. `write`
 * replaces; it may complete asynchronously, and a caller that needs the value durable awaits
 * it. `clear` removes the key.
 */
export interface MarkerStore {
    read(key: string): string | null;
    write(key: string, value: string): void | Promise<void>;
    clear(key: string): void;
}

/**
 * The reader's saved settings, read one key at a time. The visual reads its format pane, the
 * add-in its task-pane preferences, a web page whatever its caller configured. The MCP server
 * takes its options as arguments and passes none.
 *
 * Keyed on RenderOptions until the shared options vocabulary lands; `undefined` means the
 * reader has not set the key and the shared default applies.
 */
export interface PreferenceSource<Vocab extends object = RenderOptions> {
    get<K extends keyof Vocab & string>(key: K): Vocab[K] | undefined;
}

/** The surface a chart sits on, as colours a chart can use directly. */
export interface HostTheme {
    /** Canvas colour, as a CSS colour string. */
    background: string;
    /** Default text colour, as a CSS colour string. */
    foreground: string;
    /** True when the host is in a forced high-contrast mode. */
    isHighContrast: boolean;
    /** The host's own categorical colours, when it has any (a report theme; a workbook's accents). */
    palette?: readonly string[];
}

/**
 * Reads the host's current theme. The visual reads the report theme, the add-in the Office
 * theme. The MCP preview is not a product surface and passes none; a demo page that reads the
 * browser's colour scheme passes one.
 */
export interface ThemeSource {
    read(): HostTheme;
}

/**
 * Whether a rendered chart may be captured as a thumbnail. `consented` is the reader's (or
 * their administrator's) answer; `forced` is a host rule that captures regardless (a
 * first-render capture a licence requires). The visual and the add-in provide it; the MCP
 * server has no DOM and a demo page no credentials, so both pass none.
 */
export interface ThumbnailConsent {
    consented(): boolean;
    forced(): boolean;
}

/** The rendered chart's root <svg>, or null when the chart drew none (a canvas, a table). */
export interface SnapshotTarget {
    svg(): SVGSVGElement | null;
}

/**
 * The whole services object a host constructs and passes to shared logic.
 *
 * Required members are the ones every host that sends requests provides today, so their
 * absence is a compile error. An optional member that is absent - or null, which means the
 * same - is the host declaring it cannot do that thing. What a host can do is derived from
 * this object, never declared beside it, so a capability cannot be claimed without the service
 * that backs it.
 *
 * Each optional member's host coverage today:
 * - viewport: visual, add-in, web page; not the MCP server (sizes are arguments).
 * - markers: visual, add-in; not the MCP server (in-call only) or a demo page.
 * - prefs: visual, add-in, web page; not the MCP server (options are arguments).
 * - theme: visual, add-in; a web page when it reads the browser's scheme; not the MCP server.
 * - thumbnails and snapshot: visual, add-in; not the MCP server (no DOM) or a demo page.
 * - diagnostics: visual, add-in; not the MCP server (stdio) or a demo page.
 */
export interface HostServices {
    signer: WireSigner;
    transport: WireTransport;
    credentials: CredentialSource;
    clock: Clock;
    renderers: ReadonlySet<RendererId>;
    viewport?: ViewportSource | null;
    markers?: MarkerStore | null;
    prefs?: PreferenceSource | null;
    theme?: ThemeSource | null;
    thumbnails?: ThumbnailConsent | null;
    snapshot?: SnapshotTarget | null;
    diagnostics?: DiagnosticsSink | null;
}
