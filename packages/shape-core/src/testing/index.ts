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

import type { WireSigner, WireResponse } from "../host/services";
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
