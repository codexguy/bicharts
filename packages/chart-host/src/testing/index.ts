// CONFORMANCE SUITES for the render-level host services (2026-09-24). Published as the
// "@bicharts/chart-host/testing" subpath, for a host's own test project - nothing in the
// runtime entries imports it.
//
// Each contract in host/services.ts ships a check a host runs against ITS OWN adapter before
// any shared logic that consumes the adapter is pointed at it. Framework-free: a check throws
// a ConformanceError listing every property the adapter broke, so a host calls it from
// whatever runner it already has.
//
// ConformanceError is declared here rather than re-exported from @bicharts/shape-core/testing
// for the reason host/services.ts gives: shape-core is bundled into this package, so a
// published declaration naming it would dangle. Same name, same shape, same message format.

import type { MarkerStore } from "../host/services";

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

function describeThrow(e: unknown): string {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** Keys the check writes. Distinctive, so a store shared with real data cannot collide. */
const PROBE_A = "__bicharts_conformance_marker_a__";
const PROBE_B = "__bicharts_conformance_marker_b__";

/**
 * A MarkerStore reads null for a key it does not hold, returns exactly what was written,
 * replaces on a second write, keeps keys independent, and reads null again after a clear.
 * Awaits every write, since a store may complete one asynchronously. Clears both probe keys
 * before returning, whether or not the check passed.
 */
export async function assertMarkerStoreConformance(store: MarkerStore): Promise<void> {
    const failures: string[] = [];
    const done = () => {
        if (failures.length) throw new ConformanceError("MarkerStore", failures);
    };
    if (!store || typeof store.read !== "function" || typeof store.write !== "function"
        || typeof store.clear !== "function") {
        failures.push("the store is missing read(), write() or clear()");
        done();
    }
    try {
        store.clear(PROBE_A);
        store.clear(PROBE_B);
        const absent = store.read(PROBE_A);
        if (absent !== null) {
            failures.push(`read() of a key never written returned ${JSON.stringify(absent)}, not null`);
        }

        const v1 = '{"at":1,"corr":"probe-1"}';
        await store.write(PROBE_A, v1);
        const r1 = store.read(PROBE_A);
        if (r1 !== v1) failures.push(`read() after write() returned ${JSON.stringify(r1)}, not the value written`);

        const other = store.read(PROBE_B);
        if (other !== null) failures.push(`writing one key changed another: it reads ${JSON.stringify(other)}`);

        const v2 = '{"at":2,"corr":"probe-2"}';
        await store.write(PROBE_A, v2);
        const r2 = store.read(PROBE_A);
        if (r2 !== v2) failures.push(`a second write() did not replace the first: read ${JSON.stringify(r2)}`);

        await store.write(PROBE_B, v1);
        store.clear(PROBE_A);
        const cleared = store.read(PROBE_A);
        if (cleared !== null) failures.push(`read() after clear() returned ${JSON.stringify(cleared)}, not null`);
        const kept = store.read(PROBE_B);
        if (kept !== v1) failures.push(`clear() of one key disturbed another: it reads ${JSON.stringify(kept)}`);
    } catch (e) {
        failures.push(`the store threw during an ordinary read, write or clear: ${describeThrow(e)}`);
    } finally {
        try { store.clear(PROBE_A); store.clear(PROBE_B); } catch { /* reported above if it matters */ }
    }
    done();
}
