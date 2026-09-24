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

import type { WireSigner } from "../host/services";

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
