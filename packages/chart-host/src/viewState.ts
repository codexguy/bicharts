// VIEW STATE: THE SERVICE'S HELPERS AND RULES. Published as "@bicharts/chart-host/view-state".
//
// A chart keeps its resting state (a sort, a frame, a 3D camera) in a small bag it reads from
// `options.uiState` and writes through `options.setUiState`. Where that bag lives, and which of its
// keys may outlive a redraw, a reopen or a new version of the chart, is the host's to say, through a
// ViewStateService (host/services.ts). This entry holds the plain functions around that contract.
//
// Their own entry, not the package's main one, so a host that only draws charts loads none of it: the
// main entry's eager closure is budgeted (scripts/checkEagerSize.mjs). The TYPES are exported from the
// main entry, which costs nothing at run time.

import type { ViewStateProvider } from "./contract";
import type { ViewStateKeyPolicy, ViewStateService } from "./host/services";

/**
 * A service that stores nothing: a static preview, a server-side render, a thumbnail capture,
 * where remembering would be wrong rather than merely absent (a thumbnail must be the same picture
 * every time it is taken). Saying so out loud differs from passing no service at all, which leaves
 * the choice to the host. The viewing store reads `{}` always and there is no durable store.
 */
export function noopViewStateService(): ViewStateService {
    const nowhere: ViewStateProvider = { load: () => ({}), save: () => { /* deliberately nowhere */ } };
    return { viewing: nowhere, durable: null, policy: {} };
}

/**
 * Whether this host can remember a chart's view across a close and reopen. This is the one
 * definition of "remembers the view": it is derived from the service, never declared beside it, so
 * a host cannot claim it without a durable store to back the claim.
 */
export function viewStateIsDurable(service: ViewStateService | null | undefined): boolean {
    return !!service && !!service.durable;
}

// ---- The rules ----
//
// Two pure functions, one for each direction through the stores, and a third for a host that learns of
// a chart swap by an event instead of by reading a version. Nothing here touches a DOM, a timer, a
// global or storage of its own: they read and write only through the service they are handed, so a
// host's tests can run them against plain objects.

/**
 * The rule for a key the chart's own code writes, when a service names no other. The chart keeps it:
 * it reaches the durable store, and it survives a new version of the chart and a fresh viewing.
 * Such a key can be stale (a sort on a column the new chart doesn't have), and that is the chart's to
 * handle: whatever it reads from the bag is untrusted, and it validates it.
 */
export const CHART_OWNED_KEY_POLICY: Readonly<ViewStateKeyPolicy> = Object.freeze({
    lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: false,
});

/** A key a rule took out of the bag a chart is handed, and why. */
export interface ViewStateDrop {
    key: string;
    reason: "fresh-viewing" | "new-version";
}

export interface ResolveViewStateOptions {
    /** The version of the chart about to draw. Compared with what the bag recorded under `versionKey`. */
    codeVersion?: number | string | null;
    /**
     * True when this viewing has not yet written a bag of its own (a page just opened, a file just
     * opened). False when it has, which makes the viewing store the bag even if it reads empty, so a
     * chart that cleared its state is not handed the older state the durable store still holds.
     * Absent: a bag read from the durable store is a fresh viewing, and one read from the viewing store is not.
     */
    freshViewing?: boolean;
}

export interface ResolvedViewState {
    /** The bag to hand the chart as `options.uiState`. The caller's own copy: nothing in a store aliases it. */
    bag: Record<string, unknown>;
    /** Where the bag was read from. `"none"`: neither store held anything. */
    source: "viewing" | "durable" | "none";
    /** Every key a rule took out, in the order the rules ran, so a host can log what it did. */
    dropped: ViewStateDrop[];
}

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function isBag(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A bag with content: any key, or any other truthy value. A saved number or array is handed on as it was saved. */
function holds(v: unknown): boolean {
    return isBag(v) ? Object.keys(v).length > 0 : !!v;
}

/** A store's bag, or `{}`. A store that throws is an empty one: a chart must never be blocked from drawing by storage. */
function loadOrEmpty(store: ViewStateProvider | null | undefined): unknown {
    try {
        const bag = store ? store.load() : undefined;
        return bag == null ? {} : bag;
    } catch {
        return {};
    }
}

function put(into: Record<string, unknown>, key: string, value: unknown): void {
    // defineProperty, not assignment: a saved file can carry a key named __proto__.
    Object.defineProperty(into, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Deep copy of plain JSON data; anything else (a Date, a function) is kept by reference. */
function copyOf(v: unknown, depth = 0): unknown {
    if (v === null || typeof v !== "object" || depth > 64) return v;
    if (Array.isArray(v)) return v.map(x => copyOf(x, depth + 1));
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) put(out, k, copyOf((v as Record<string, unknown>)[k], depth + 1));
    return out;
}

function policyFor(service: ViewStateService, key: string): ViewStateKeyPolicy {
    if (service.policy && own(service.policy, key)) return service.policy[key];
    return service.chartKeys ?? CHART_OWNED_KEY_POLICY;
}

/**
 * BUILD THE BAG A CHART IS HANDED.
 *
 * Read order: the viewing store when it holds anything (or when the viewing has already written, see
 * `freshViewing`), otherwise the durable store, otherwise nothing. The viewing store is the newer of
 * the two within a viewing: a durable store can lag its own writes by a round trip, and a redraw in
 * that window must see the write, not the state before it. A key whose lifetime is `"viewing"` is
 * never believed from the durable store.
 *
 * Then two rules run, in this order, each over the keys a service's policy names (and, for the keys
 * it doesn't, over `chartKeys`):
 * - a fresh viewing drops every key marked `dropOnFreshViewing` whose value is set. A value that is
 *   already off (false, 0, "") stays: dropping it would change nothing the chart can tell.
 * - a version change drops every key marked `dropOnNewVersion` that is present, and then records the
 *   current version under `versionKey` so the bag no longer reads as another chart's. Only when
 *   the service has a `versionKey`; a host without one applies the rule itself, with
 *   `viewStateAfterSwap`, wherever it learns the chart changed.
 *
 * The stamp is part of the bag the chart receives. The chart's own write carries it forward; a write
 * that replaces the bag without it reads as another chart's on the next call.
 *
 * Never throws, and never changes a store: the bag is a copy the caller may let the chart mutate.
 * A saved value that is not an object (a number, an array) is handed on as saved, with no rule run.
 */
export function resolveViewState(
    service: ViewStateService,
    options: ResolveViewStateOptions = {},
): ResolvedViewState {
    const viewed = loadOrEmpty(service.viewing);
    let source: ResolvedViewState["source"];
    let raw: unknown;
    if (holds(viewed) || options.freshViewing === false) {
        source = "viewing";
        raw = holds(viewed) ? viewed : {};
    } else {
        const stored = loadOrEmpty(service.durable);
        source = holds(stored) ? "durable" : "none";
        raw = holds(stored) ? stored : {};
        if (isBag(raw)) {
            const believed: Record<string, unknown> = {};
            for (const k of Object.keys(raw)) if (policyFor(service, k).lifetime !== "viewing") put(believed, k, raw[k]);
            raw = believed;
        }
    }

    const bag = copyOf(raw) as Record<string, unknown>;
    const dropped: ViewStateDrop[] = [];
    if (!isBag(bag)) return { bag, source, dropped };

    const versionKey = service.versionKey || null;
    const fresh = options.freshViewing ?? source !== "viewing";
    if (fresh) {
        for (const key of Object.keys(bag)) {
            if (key === versionKey) continue;
            if (policyFor(service, key).dropOnFreshViewing && bag[key]) {
                delete bag[key];
                dropped.push({ key, reason: "fresh-viewing" });
            }
        }
    }
    if (versionKey) {
        const version = options.codeVersion ?? null;
        if (bag[versionKey] !== version) {
            for (const key of Object.keys(bag)) {
                if (key === versionKey) continue;
                if (policyFor(service, key).dropOnNewVersion) {
                    delete bag[key];
                    dropped.push({ key, reason: "new-version" });
                }
            }
            put(bag, versionKey, version);
        }
    }
    return { bag, source, dropped };
}

/**
 * WHEN THE CHART CHANGES UNDER A BAG THAT KEPT NO VERSION. Returns a copy of `bag` without the keys the
 * policy marks `dropOnNewVersion` (and, if `chartKeys` marks it, without every key the chart wrote). A
 * host that sees the swap itself (a regenerate, a version load, a cleared chart) calls it where it
 * learns of it and saves what comes back. `versionKey` is left as it is: the next `resolveViewState`
 * brings it up to date. A bag that is not an object, or nothing, comes back as `{}`.
 */
export function viewStateAfterSwap(service: ViewStateService, bag: unknown): Record<string, unknown> {
    const copy = copyOf(bag);
    if (!isBag(copy)) return {};
    const versionKey = service.versionKey || null;
    for (const key of Object.keys(copy)) {
        if (key !== versionKey && policyFor(service, key).dropOnNewVersion) delete copy[key];
    }
    return copy;
}

/** What `commitViewState` did. */
export interface CommitViewStateResult {
    /**
     * `"saved"`: handed to the stores. `"ignored"`: not an object (or not serializable), so nothing was
     * saved anywhere. `"too-large"`: the durable payload exceeded the service's `durableMaxChars`, so
     * nothing was saved anywhere and the next read sees the state before this write.
     */
    outcome: "saved" | "ignored" | "too-large";
    /** The viewing store's `save` ran without throwing. */
    viewingSaved: boolean;
    /** The durable store's `save` ran without throwing. False too when the service has no durable store. */
    durableSaved: boolean;
    /** Keys kept out of the durable store because their `durableWhen` preference is off, in policy order. */
    withheld: string[];
    /** Characters of JSON in the durable payload, measured only when the service sets a limit. */
    durableChars: number | null;
    /** A store that threw. The other store is still written, and the write never throws out of the chart. */
    errors: Array<{ store: "viewing" | "durable"; error: unknown }>;
}

/**
 * What the commit asks of a preference source: the value behind a switch's name. A host's own
 * `PreferenceSource` (HostServices.prefs) satisfies it; so does `{ get: name => settings[name] }`.
 */
export interface ViewStatePreferences {
    get(key: string): unknown;
}

function preferenceOn(prefs: ViewStatePreferences | null | undefined, name: string): boolean {
    try {
        return !!(prefs && prefs.get(name));
    } catch {
        return false;
    }
}

/**
 * DECIDE WHAT A CHART'S WRITE REACHES.
 *
 * `next` is the whole bag the chart wrote (a write replaces; the chart merges its own siblings). The
 * viewing store always gets all of it, so a reader who turns a 3D cube keeps their angle while the page
 * is open whatever they have chosen to share. The durable store gets the same bag less the keys that
 * must not reach it: a `"viewing"` lifetime, or a `durableWhen` preference that doesn't read true. The
 * preference is read now, when the chart writes, not when the render began; an unset preference, a
 * missing source or a source that throws all read as off, so a view is never shared by accident.
 *
 * The viewing store is written first and unconditionally, so a durable store that skips a write that
 * changes nothing in its own payload (a camera-only change with the camera withheld) cannot cost the
 * session the new pose. The one case where neither store is written is a refusal: a durable payload
 * over `durableMaxChars` is dropped whole, so the next read sees the state before it.
 *
 * Never throws. A store that throws is reported in `errors` and the other store is still written.
 */
export function commitViewState(
    next: unknown,
    service: ViewStateService,
    prefs?: ViewStatePreferences | null,
): CommitViewStateResult {
    const result: CommitViewStateResult = {
        outcome: "saved", viewingSaved: false, durableSaved: false, withheld: [], durableChars: null, errors: [],
    };
    if (next == null || typeof next !== "object") return { ...result, outcome: "ignored" };
    const bag = next as Record<string, unknown>;

    const durable = service.durable || null;
    let forFile: Record<string, unknown> = bag;
    if (durable && isBag(bag)) {
        let trimmed: Record<string, unknown> | null = null;
        const withheld = new Set<string>();
        for (const key of Object.keys(bag)) {
            const policy = policyFor(service, key);
            const keep = policy.lifetime !== "viewing"
                && (policy.durableWhen === undefined || preferenceOn(prefs, policy.durableWhen));
            if (keep) continue;
            trimmed ??= { ...bag };
            delete trimmed[key];
            if (policy.lifetime !== "viewing") withheld.add(key);
        }
        if (trimmed) forFile = trimmed;
        const declared = Object.keys(service.policy || {});
        result.withheld = [...declared.filter(k => withheld.has(k)), ...[...withheld].filter(k => !declared.includes(k))];
    }

    if (durable && service.durableMaxChars) {
        try {
            result.durableChars = JSON.stringify(forFile).length;
        } catch (error) {
            result.errors.push({ store: "durable", error });
            return { ...result, outcome: "ignored" };
        }
        if (result.durableChars > service.durableMaxChars) return { ...result, outcome: "too-large" };
    }

    try {
        service.viewing.save(bag);
        result.viewingSaved = true;
    } catch (error) {
        result.errors.push({ store: "viewing", error });
    }
    if (durable) {
        try {
            durable.save(forFile);
            result.durableSaved = true;
        } catch (error) {
            result.errors.push({ store: "durable", error });
        }
    }
    return result;
}
