// PROVINCE SIGNALS a profile carries, read through the hosted admin-1 lookup (admin1Lookup.ts). Nothing here runs
// until a host has registered the lookup; without it no column gains a province kind and no measurement is made, so
// province maps are simply not offered.
//
// Two kinds of column carry provinces:
//   * a PROVINCE column - ISO 3166-2 codes ("admin1-code") or province names ("admin1-name");
//   * a CITY column (geoKind city-name / city-name-world) whose cities roll up to provinces. It keeps its city kind and
//     gains the rollup measurements, since the same column can still place bubbles.
// Every figure is opaque to the source values: an enum, percentages and small counts.

import { resolveCityAdmin1, admin1CodesForName, provinceIdForAdmin1Code, isKnownProvinceId, admin1LookupRegistered } from "./admin1Lookup";
import { countryRegion } from "./geoExtent";
import { toGeoIso, hasAnyToken, CITY_NAME_TOKENS, NAME_KIND_MIN_DISTINCT } from "./geoDetector";
import { CITY_ROLE_MATCH_PCT } from "./matchQuality";

/** A province column needs this share of its distinct values to match, or the lower share when its NAME reads as a
 *  province. The server re-checks against its own threshold; this is only whether to emit the kind at all. */
export const ADMIN1_MATCH_PCT = 85;
export const ADMIN1_MATCH_PCT_NAMED = 60;
const PROVINCE_NAME = /(^|[^a-z])(state|province|provincia|provinz|region|regione|regiao|county|department|departement|departamento|prefecture|oblast|canton|kanton|bundesland|land|territory)([^a-z]|$)/i;

export interface Admin1ColumnSignals {
    kind?: "admin1-code" | "admin1-name";
    matchPct?: number;
    ambiguous?: boolean;
    rollupPct?: number;
    regionCount?: number;
    countryCount?: number;
    dominantRegion?: string;
    dominantRegionPct?: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const ccOfProvince = (pid: string) => pid.split("-")[0];

function regionSummary(rowsPerCc: Map<string, number>): { dominantRegion?: string; dominantRegionPct?: number } {
    const perRegion = new Map<string, number>();
    let total = 0;
    rowsPerCc.forEach((n, cc) => {
        const r = countryRegion(cc);
        if (!r) return;
        perRegion.set(r, (perRegion.get(r) || 0) + n);
        total += n;
    });
    if (total === 0) return {};
    const [region, n] = [...perRegion].sort((a, b) => b[1] - a[1])[0];
    return { dominantRegion: region, dominantRegionPct: round1(100 * n / total) };
}

/**
 * The province a row sits in, from its province value, or failing that its city (narrowed by its country). Null when
 * none resolves to exactly one province. A province value takes precedence over the city.
 */
export function provinceIdForRow(args: { province?: unknown; provinceKind?: string | null; city?: unknown; country?: unknown }): string | null {
    const pv = args.province === null || args.province === undefined ? "" : String(args.province).trim();
    if (pv) return provinceIdForValue(pv, args.provinceKind, args.country);
    if (!admin1LookupRegistered()) return null;
    const cv = args.city === null || args.city === undefined ? "" : String(args.city).trim();
    if (!cv) return null;
    const r = resolveCityAdmin1(cv, { country: args.country === null || args.country === undefined ? null : String(args.country) });
    return r.status === "resolved" ? r.provinceId : null;
}

/** One province VALUE to its id: an ISO 3166-2 code, a province name (narrowed by the country), or a US state (code or
 *  name, which needs no lookup: a state's id is "US-" + its USPS code). Null when it names no single province. */
function provinceIdForValue(pv: string, kind: string | null | undefined, country: unknown): string | null {
    if (kind === "us-state-code" || kind === "us-state-name") {
        const usps = toGeoIso(pv, kind);
        return usps ? "US-" + usps : null;
    }
    if (!admin1LookupRegistered()) return null;
    if (kind === "admin1-code") return isKnownProvinceId(pv) ? pv.toUpperCase() : null;
    const cc = country === null || country === undefined ? null : String(country);
    const pids = new Set(admin1CodesForName(pv, cc).map(provinceIdForAdmin1Code).filter((x): x is string => !!x));
    return pids.size === 1 ? [...pids][0] : null;
}

/** What placed a row on a province map. */
export type ProvinceSource = "province" | "coordinates" | "city";

export interface ProvinceIsoColumn {
    /** Per-row province id, aligned with the rows; null where the row did not place. */
    iso: (string | null)[];
    /** Per-row source of the id, null where the row did not place. */
    source: (ProvinceSource | null)[];
    /** Distinct province or city values that named no single province (feeds the unmatched note). */
    unmatched: string[];
    matchedRows: number;
    totalRows: number;
    /** Rows whose city matched more than one province under the tie-break: counted, never guessed. */
    ambiguousRows: number;
    ambiguousExamples: string[];
    /** Rows with coordinates that landed in no province (and had no city to fall back on). */
    unplacedPoints: number;
}

/**
 * THE PROVINCE JOIN COLUMN for a province map, per row in a fixed precedence: the province value, then the coordinates,
 * then the city. A province cell that is FILLED is the reader's own value and is never overridden: when it names no
 * province the row stays unmatched and is counted. Only a BLANK province cell falls through, and only while the reader
 * derives provinces; with `deriveProvinces` false a row places by its province value alone.
 *
 * Coordinates need the province geometry, which this package does not carry: the caller passes `locate`, returning the
 * province id a coordinate falls in (or null). Without it, coordinates are skipped.
 */
export function buildProvinceIsoColumn(
    rows: ReadonlyArray<{ province?: unknown; city?: unknown; country?: unknown; lat?: unknown; lon?: unknown }>,
    opts: { provinceKind?: string | null; deriveProvinces?: boolean; locate?: (lat: number, lon: number) => string | null } = {},
): ProvinceIsoColumn {
    const derive = opts.deriveProvinces !== false;
    const iso: (string | null)[] = new Array(rows.length);
    const source: (ProvinceSource | null)[] = new Array(rows.length);
    const unmatchedSeen = new Set<string>(), unmatched: string[] = [];
    const ambiguousSeen = new Set<string>(), ambiguousExamples: string[] = [];
    let matchedRows = 0, ambiguousRows = 0, unplacedPoints = 0;
    const miss = (v: string) => { const k = v.toLowerCase(); if (!unmatchedSeen.has(k)) { unmatchedSeen.add(k); unmatched.push(v); } };
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const cityCache = new Map<string, ReturnType<typeof resolveCityAdmin1>>();

    rows.forEach((r, i) => {
        iso[i] = null; source[i] = null;
        const country = r.country === null || r.country === undefined || String(r.country).trim() === "" ? null : String(r.country).trim();
        const pv = r.province === null || r.province === undefined ? "" : String(r.province).trim();
        if (pv) {
            const pid = provinceIdForValue(pv, opts.provinceKind, country);
            if (pid) { iso[i] = pid; source[i] = "province"; matchedRows++; } else miss(pv);
            return;
        }
        if (!derive) return;
        const lat = num(r.lat), lon = num(r.lon);
        let triedPoint = false;
        if (opts.locate && lat !== null && lon !== null && isFinite(lat) && isFinite(lon)) {
            triedPoint = true;
            const pid = opts.locate(lat, lon);
            if (pid) { iso[i] = pid; source[i] = "coordinates"; matchedRows++; return; }
        }
        const cv = r.city === null || r.city === undefined ? "" : String(r.city).trim();
        if (cv && admin1LookupRegistered()) {
            const key = cv.toLowerCase() + "\u0001" + (country ?? "");
            let res = cityCache.get(key);
            if (!res) { res = resolveCityAdmin1(cv, { country }); cityCache.set(key, res); }
            if (res.status === "resolved" && res.provinceId) { iso[i] = res.provinceId; source[i] = "city"; matchedRows++; return; }
            if (res.status === "ambiguous") {
                ambiguousRows++;
                if (!ambiguousSeen.has(key)) { ambiguousSeen.add(key); if (ambiguousExamples.length < 8) ambiguousExamples.push(cv); }
                return;
            }
            miss(cv);
            return;
        }
        if (triedPoint) unplacedPoints++;
    });
    return { iso, source, unmatched, matchedRows, totalRows: rows.length, ambiguousRows, ambiguousExamples, unplacedPoints };
}

/**
 * Province signals for every column of a profiled table. `rows` are positional; `cols` carry the kinds the
 * per-column profile already found. Returns one entry per column index that gained a signal.
 */
export function measureAdmin1Columns(
    cols: ReadonlyArray<{ name: string; isMeasure?: boolean; geoKind?: string }>,
    rows: ReadonlyArray<ReadonlyArray<unknown>>,
    opts: { cities?: boolean } = {},
): Map<number, Admin1ColumnSignals> {
    const out = new Map<number, Admin1ColumnSignals>();
    if (!admin1LookupRegistered() || rows.length === 0) return out;
    const countryIdx = cols.findIndex(c => !c.isMeasure && (c.geoKind || "").startsWith("country"));
    const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

    // How a column's values roll up as cities, by distinct (city, country) pair: the share that resolves to one province
    // (rollupPct) and the share that is a known city at all, resolved or ambiguous (cityPct).
    const cityRollup = (i: number): { signals: Admin1ColumnSignals; cityPct: number; distinct: number } | null => {
        const pairs = new Map<string, { city: string; country: string | null; rows: number }>();
        for (const row of rows) {
            const city = str(row[i]); if (!city) continue;
            const country = countryIdx >= 0 ? str(row[countryIdx]) || null : null;
            const k = city + "\u0001" + (country ?? "");
            const p = pairs.get(k); if (p) p.rows++; else pairs.set(k, { city, country, rows: 1 });
        }
        if (pairs.size === 0) return null;
        let resolved = 0, known = 0;
        const pids = new Set<string>(), ccs = new Map<string, number>();
        pairs.forEach(p => {
            const r = resolveCityAdmin1(p.city, { country: p.country });
            if (r.status !== "unmatched") known++;
            if (r.status !== "resolved" || !r.provinceId) return;
            resolved++; pids.add(r.provinceId);
            ccs.set(r.cc, (ccs.get(r.cc) || 0) + p.rows);
        });
        return {
            signals: { rollupPct: round1(100 * resolved / pairs.size), regionCount: pids.size, countryCount: ccs.size, ...regionSummary(ccs) },
            cityPct: 100 * known / pairs.size, distinct: pairs.size,
        };
    };

    cols.forEach((c, i) => {
        if (c.isMeasure || i === countryIdx) return;
        const kind = c.geoKind || "";

        // ---- a CITY column: how well do its cities roll up to provinces? Not measured when the reader does not derive
        // provinces (`cities: false`), so a city column is never offered a province map.
        if (kind.startsWith("city")) {
            if (opts.cities === false) return;
            const r = cityRollup(i);
            if (r) out.set(i, r.signals);
            return;
        }

        // ---- an unclassified column: is it a province column?
        if (kind) return;
        const distinct = new Map<string, number>();
        const countryOf = new Map<string, string | null>();
        for (const row of rows) {
            const v = str(row[i]); if (!v) continue;
            distinct.set(v, (distinct.get(v) || 0) + 1);
            if (!countryOf.has(v)) countryOf.set(v, countryIdx >= 0 ? str(row[countryIdx]) || null : null);
        }
        if (distinct.size < 3) return;
        let codeHits = 0, nameHits = 0, nameAmbiguous = 0;
        const pids = new Set<string>(), ccs = new Map<string, number>();
        distinct.forEach((n, v) => {
            if (isKnownProvinceId(v)) {
                codeHits++; const pid = v.toUpperCase(); pids.add(pid);
                ccs.set(ccOfProvince(pid), (ccs.get(ccOfProvince(pid)) || 0) + n);
                return;
            }
            const cand = new Set(admin1CodesForName(v, countryOf.get(v)).map(provinceIdForAdmin1Code).filter((x): x is string => !!x));
            if (cand.size === 1) {
                nameHits++; const pid = [...cand][0]; pids.add(pid);
                ccs.set(ccOfProvince(pid), (ccs.get(ccOfProvince(pid)) || 0) + n);
            } else if (cand.size > 1) nameAmbiguous++;
        });
        const named = PROVINCE_NAME.test(c.name.replace(/[_-]+/g, " "));
        const floor = named ? ADMIN1_MATCH_PCT_NAMED : ADMIN1_MATCH_PCT;
        const codePct = 100 * codeHits / distinct.size, namePct = 100 * nameHits / distinct.size;
        const useCode = codePct >= namePct;
        const pct = useCode ? codePct : namePct;
        if (pct < floor) {
            // NOT A PROVINCE COLUMN - perhaps cities the profile's gazetteer is too small to know. The lookup covers every
            // town of 15,000+, where detection's bundled table covers the larger cities only, so a column of towns
            // classifies as nothing and would never be offered a province map. It gains the rollup figures, never a geo
            // kind (a point map could not place these towns), when its values are cities at detection's own bar and, for a
            // short list, its name reads as a city (a roster of people or products can share city names).
            if (opts.cities === false) return;
            const r = cityRollup(i);
            if (!r || r.cityPct < CITY_ROLE_MATCH_PCT) return;
            if (r.distinct < NAME_KIND_MIN_DISTINCT && !hasAnyToken(c.name, CITY_NAME_TOKENS)) return;
            out.set(i, r.signals);
            return;
        }
        out.set(i, {
            kind: useCode ? "admin1-code" : "admin1-name",
            matchPct: round1(pct),
            ambiguous: !useCode && nameAmbiguous / distinct.size > 0.15 ? true : undefined,
            regionCount: pids.size,
            countryCount: ccs.size,
            ...regionSummary(ccs),
        });
    });
    return out;
}
