// Localized month-name → 0-based-index lookup. Extracted from the visual's
// dateUnshred.ts so BOTH the profiler (classifyTemporal in indexedText) and the
// visual's date-hierarchy unshredder share ONE implementation — a period axis
// like "Ene 2024" / "Januar 2024" must classify identically to how the unshredder
// reassembles it. dateUnshred.ts now imports these from here (single source).
// Pure + host-agnostic (Intl only), so it lives in shape-core.

// Cached per locale: building one asks Intl for the 12 long + 12 short names.
const monthLookupCache: Record<string, Record<string, number>> = {};

/** Lower-case and strip spaces / dots / bidi marks so "Sept.", "sept" and the
 *  RTL-wrapped forms some locales emit all compare equal. */
export function normalizeMonthKey(s: string): string {
    return s.toLowerCase().replace(/[.‎‏\s]/g, "");
}

/** Build (and cache) a normalized month-name → index map for a locale tag using
 *  Intl. Returns an empty map for an unknown tag, so callers fall back. */
export function monthLookupFor(locale: string): Record<string, number> {
    const key = locale || "en";
    const cached = monthLookupCache[key];
    if (cached) return cached;
    const map: Record<string, number> = {};
    try {
        const long = new Intl.DateTimeFormat(key, { month: "long" });
        const short = new Intl.DateTimeFormat(key, { month: "short" });
        for (let m = 0; m < 12; ++m) {
            const d = new Date(Date.UTC(2020, m, 15)); // mid-month → no tz day-shift
            map[normalizeMonthKey(long.format(d))] = m;
            map[normalizeMonthKey(short.format(d))] = m;
        }
    } catch {
        // Unknown locale tag — leave the map empty.
    }
    monthLookupCache[key] = map;
    return map;
}
