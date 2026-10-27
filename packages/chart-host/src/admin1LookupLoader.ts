// THE ADMIN-1 LOOKUP LOADER. The lookup (cities and first-level divisions, built from GeoNames) is served beside the
// geometry and is far too big to bundle, so a host fetches it once, on the first table that could use it, and hands
// it to the resolver. Until it arrives nothing resolves to a province, and province maps are simply not offered:
// that is the designed fail-closed state, so a failed or slow load costs a map, never a chart.

import { registerAdmin1Lookup, admin1LookupRegistered } from "@bicharts/shape-core";

/** Where the lookup is served, relative to the site origin. Versioned in the file name, so a rebuilt lookup is a new
 *  URL rather than a stale cache entry. */
export const ADMIN1_LOOKUP_PATH = "/geo/admin1-lookup.v1.json";

let inflight: Promise<boolean> | null = null;

/**
 * Fetch and register the lookup. Resolves true once it is registered (immediately when it already is), false on a
 * timeout, a failed fetch or a body that is not a lookup - and never throws. One fetch is in flight at a time, so N
 * charts on a page cause one request. `timeoutMs` bounds how long a host waits before profiling without it (default
 * 3000); a late arrival still registers, for the next profile.
 */
export async function loadAdmin1Lookup(
    url: string,
    opts: { timeoutMs?: number; fetchJson?: (url: string) => Promise<any>; log?: (tag: string, data?: any) => void } = {},
): Promise<boolean> {
    if (admin1LookupRegistered()) return true;
    const log = opts.log;
    if (!inflight) {
        const started = Date.now();
        inflight = (async () => {
            try {
                const doc = opts.fetchJson
                    ? await opts.fetchJson(url)
                    : await (await fetch(url, { credentials: "omit" })).json();
                const counts = registerAdmin1Lookup(doc);
                log?.("admin1-lookup-loaded", { url, ms: Date.now() - started, ...counts });
                return true;
            } catch (e) {
                log?.("admin1-lookup-failed", { url, ms: Date.now() - started, error: String(e).slice(0, 200) });
                inflight = null;   // a later table may try again
                return false;
            }
        })();
    }
    const timeoutMs = opts.timeoutMs ?? 3000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>(resolve => {
        timer = setTimeout(() => {
            log?.("admin1-lookup-timeout", { url, timeoutMs });
            resolve(false);
        }, timeoutMs);
    });
    try {
        return await Promise.race([inflight, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// Words a column NAME uses for a first-level division or a city, in the shipped languages' most common forms. A name
// match only decides whether loading the lookup is worth it; the lookup itself decides what the values are.
const PLACE_TOKENS = /(^|[^a-z])(city|cities|town|ville|stadt|ciudad|citta|cidade|state|province|provincia|provinz|county|department|departement|departamento|prefecture|oblast|canton|kanton|bundesland|municipality)([^a-z]|$)/i;
// NOT here, on purpose: region, territory, district and a bare "land". They name a first-level division in some countries
// and a SALES region ("North", "EMEA") in most reports, so on their own they do not justify a fetch (half a megabyte, on
// a sandbox with no cache); a table that also carries a country or city column loads the lookup anyway.

/**
 * Is the lookup worth loading for a table, judged from its profile? True when a column was profiled as a country or a
 * city, or when a dimension's name reads as a city or a first-level division. Takes plain column records, so a host
 * passes its profile as is.
 */
export function needsAdmin1Lookup(columns: ReadonlyArray<{ name?: string | null; geoKind?: string | null; isMeasure?: boolean | null }> | null | undefined): boolean {
    if (!columns) return false;
    const geographic = columns.some(c => {
        const kind = (c?.geoKind ?? "").toLowerCase();
        return kind.startsWith("country") || kind.startsWith("city");
    });
    if (geographic) return true;
    return columns.some(c => !!c && !c.isMeasure && !!c.name && PLACE_TOKENS.test(c.name.replace(/[_-]+/g, " ")));
}

/** Forget an in-flight load. Tests only. */
export function resetAdmin1LookupLoaderForTests(): void {
    inflight = null;
}
