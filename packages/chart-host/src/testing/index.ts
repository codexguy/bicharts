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

import type { MarkerStore, ViewStateService } from "../host/services";
import type { ViewStateProvider } from "../contract";

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

// ---- ViewStateService ----

/** What a host can hand `assertViewStateConformance` so it can exercise more of the contract. */
export interface ViewStateConformanceOptions {
    /**
     * Flushes a durable write that is debounced or asynchronous (a fake-timer tick, an awaited save),
     * and is called after every write to the durable store before the check reads it back. A host whose
     * durable `save()` lands synchronously omits it.
     */
    settle?: () => void | Promise<void>;
    /**
     * Builds the service again over the same element, the way the host does on a redraw. A viewing
     * store must read there what the first one saved. Without it that property goes unchecked, and the
     * report says so.
     */
    recreate?: () => ViewStateService;
    /**
     * Builds the service as a new viewing over the same saved file or workbook (a page switch, a
     * reopen). The durable store must read what was saved, and the viewing store must start clean.
     * Without it that property goes unchecked when there is a durable store, and the report says so.
     */
    reopen?: () => ViewStateService;
}

/** What a passing run covered. A failing run throws instead. */
export interface ViewStateConformanceReport {
    checked: readonly string[];
    /** Properties that need an option the caller did not pass. A host's own test can require this to be empty. */
    skipped: readonly string[];
}

function isPlainBag(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Key-order-independent JSON, so two bags compare by content. */
function canonical(v: unknown): string {
    return JSON.stringify(v, (_k, val) => (isPlainBag(val)
        ? Object.fromEntries(Object.keys(val).sort().map(k => [k, val[k]]))
        : val));
}

function isProvider(p: unknown): p is ViewStateProvider {
    return !!p && typeof (p as ViewStateProvider).load === "function" && typeof (p as ViewStateProvider).save === "function";
}

function policyEntryFailures(where: string, entry: unknown): string[] {
    if (!isPlainBag(entry)) return [`${where} is not an object`];
    const out: string[] = [];
    if (entry.lifetime !== "viewing" && entry.lifetime !== "durable") {
        out.push(`${where}.lifetime is ${JSON.stringify(entry.lifetime)}, not "viewing" or "durable"`);
    }
    if (typeof entry.dropOnNewVersion !== "boolean") out.push(`${where}.dropOnNewVersion is not a boolean`);
    if (typeof entry.dropOnFreshViewing !== "boolean") out.push(`${where}.dropOnFreshViewing is not a boolean`);
    if (entry.durableWhen !== undefined && (typeof entry.durableWhen !== "string" || !entry.durableWhen)) {
        out.push(`${where}.durableWhen is not a preference name`);
    }
    if (entry.lifetime === "viewing" && entry.durableWhen !== undefined) {
        out.push(`${where} has a durableWhen but a "viewing" lifetime, so the preference could never matter`);
    }
    return out;
}

function shapeFailures(service: ViewStateService): string[] {
    if (!service || typeof service !== "object") return ["the service is missing"];
    const out: string[] = [];
    if (!isProvider(service.viewing)) out.push("viewing is missing, or has no load() or save()");
    if (service.durable != null && !isProvider(service.durable)) out.push("durable has no load() or save()");
    if (!isPlainBag(service.policy)) out.push("policy is missing, or is not an object keyed by view-state key");
    else for (const k of Object.keys(service.policy)) out.push(...policyEntryFailures(`policy.${k}`, service.policy[k]));
    if (service.chartKeys != null) out.push(...policyEntryFailures("chartKeys", service.chartKeys));
    if (service.versionKey != null && (typeof service.versionKey !== "string" || !service.versionKey)) {
        out.push("versionKey is not a key name");
    }
    if (service.durableMaxChars != null
        && !(typeof service.durableMaxChars === "number" && Number.isInteger(service.durableMaxChars) && service.durableMaxChars > 0)) {
        out.push("durableMaxChars is not a positive whole number");
    }
    return out;
}

// Probe bags. Distinctive keys, so a store shared with real data cannot be confused by them, and
// nested values of every JSON kind, so a store that flattens or stringifies one is caught.
const PROBE_FIRST = {
    __bicharts_conformance_view_a__: 1,
    nested: { list: [1, "two", { three: 3 }], flag: true, none: null },
    text: "café \"quoted\"",
};
const PROBE_SECOND = { __bicharts_conformance_view_b__: ["only", "this"] };

/**
 * Checks a ViewStateService against the contract. A bag's store: `load()` never throws and reads `{}`
 * when nothing is stored; `save()` takes the WHOLE bag and replaces what was there; nested values come
 * back as written. The viewing store must survive the host being re-created on the same element (pass
 * `recreate`). The durable store, when there is one, must hold what it was given, including across a
 * reopen (pass `reopen`) where the viewing store starts clean. The policy must be well formed.
 *
 * Whatever the stores held before the check is put back before it returns, whether or not it passed.
 * Resolves to a report of what was covered and what needed an option that was not passed; throws a
 * ConformanceError listing every broken property otherwise.
 */
export async function assertViewStateConformance(
    service: ViewStateService,
    options: ViewStateConformanceOptions = {},
): Promise<ViewStateConformanceReport> {
    const failures: string[] = [];
    const checked: string[] = [];
    const skipped: string[] = [];
    const finish = (): ViewStateConformanceReport => {
        if (failures.length) throw new ConformanceError("ViewStateService", failures);
        return { checked, skipped };
    };

    const broken = shapeFailures(service);
    if (broken.length) { failures.push(...broken); finish(); }
    checked.push("shape");

    const flush = async (durable: boolean) => { if (durable && options.settle) await options.settle(); };
    const expectBag = (label: string, what: string, got: unknown, want: unknown) => {
        if (!isPlainBag(got)) failures.push(`${label}: ${what} returned ${canonical(got) ?? String(got)}, not an object`);
        else if (canonical(got) !== canonical(want)) {
            failures.push(`${label}: ${what} returned ${canonical(got)}, not ${canonical(want)}`);
        }
    };

    /** The store checks that need nothing but the store itself. */
    const checkStore = async (label: string, store: ViewStateProvider, durable: boolean) => {
        let before = "{}";
        try {
            const held = store.load();
            if (!isPlainBag(held)) failures.push(`${label}: load() of a store with nothing set returned ${String(held)}, not an object`);
            else before = canonical(held);
        } catch (e) {
            failures.push(`${label}: load() threw, and it must never: ${describeThrow(e)}`);
            return;
        }
        try {
            store.save({});
            await flush(durable);
            expectBag(label, "load() after save({})", store.load(), {});
            store.save(JSON.parse(canonical(PROBE_FIRST)));
            await flush(durable);
            expectBag(label, "load() after save()", store.load(), PROBE_FIRST);
            store.save(JSON.parse(canonical(PROBE_SECOND)));
            await flush(durable);
            const replaced = store.load();
            if (isPlainBag(replaced) && canonical(replaced) !== canonical(PROBE_SECOND)) {
                failures.push(`${label}: a second save() did not replace the first (a save takes the whole bag): load() returned ${canonical(replaced)}`);
            } else if (!isPlainBag(replaced)) {
                failures.push(`${label}: load() after a second save() returned ${String(replaced)}, not an object`);
            }
            store.save({});
            await flush(durable);
            const emptied = store.load();
            if (!isPlainBag(emptied) || Object.keys(emptied).length) {
                failures.push(`${label}: save({}) did not empty the store: load() returned ${canonical(emptied)}`);
            }
        } catch (e) {
            failures.push(`${label}: threw during an ordinary load() or save(): ${describeThrow(e)}`);
        } finally {
            try { store.save(JSON.parse(before)); await flush(durable); } catch { /* reported above if it matters */ }
        }
    };

    await checkStore("viewing", service.viewing, false);
    checked.push("viewing: load, save, replace, round trip");
    if (service.durable) {
        await checkStore("durable", service.durable, true);
        checked.push("durable: load, save, replace, round trip");
    }

    if (!options.recreate) {
        skipped.push("the viewing store survives a host re-created on the same element (pass options.recreate)");
    } else {
        let before = "{}";
        try {
            before = canonical(service.viewing.load());
            service.viewing.save(JSON.parse(canonical(PROBE_FIRST)));
            const again = options.recreate();
            if (!again || !isProvider(again.viewing)) failures.push("viewing: recreate() did not return a service with a viewing store");
            else expectBag("viewing", "load() on a service re-created over the same element", again.viewing.load(), PROBE_FIRST);
        } catch (e) {
            failures.push(`viewing: threw while checking a re-created service: ${describeThrow(e)}`);
        } finally {
            try { service.viewing.save(JSON.parse(before)); } catch { /* reported above if it matters */ }
        }
        checked.push("viewing: survives a host re-created on the same element");
    }

    if (service.durable) {
        if (!options.reopen) {
            skipped.push("the durable store survives a reopen and the viewing store starts clean (pass options.reopen)");
        } else {
            let before = "{}";
            let viewingBefore = "{}";
            try {
                before = canonical(service.durable.load());
                viewingBefore = canonical(service.viewing.load());
                service.viewing.save(JSON.parse(canonical(PROBE_SECOND)));
                service.durable.save(JSON.parse(canonical(PROBE_FIRST)));
                await flush(true);
                const reopened = options.reopen();
                if (!reopened || !isProvider(reopened.durable)) {
                    failures.push("durable: reopen() did not return a service with a durable store");
                } else {
                    expectBag("durable", "load() on a service reopened over the same saved file", reopened.durable.load(), PROBE_FIRST);
                }
                if (reopened && isProvider(reopened.viewing)) {
                    expectBag("viewing", "load() after a reopen (a viewing starts clean)", reopened.viewing.load(), {});
                }
            } catch (e) {
                failures.push(`durable: threw while checking a reopened service: ${describeThrow(e)}`);
            } finally {
                try { service.durable.save(JSON.parse(before)); await flush(true); } catch { /* reported above if it matters */ }
                try { service.viewing.save(JSON.parse(viewingBefore)); } catch { /* reported above if it matters */ }
            }
            checked.push("durable: survives a reopen; viewing: starts clean after one");
        }
    }

    return finish();
}

// Reader gestures on a hosted chart, and what it shows as selected - for an app's own tests.
export { chartContainers, marksOf, findMark, clickMark, clickEmpty, selectedRows } from "./interact";
