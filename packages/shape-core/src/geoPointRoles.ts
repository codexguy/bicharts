// ──────────────────────────────────────────────────────────────────────────
// POINT-COLUMN ROLE RESOLUTION — which column is the city, the state, the ZIP
// ──────────────────────────────────────────────────────────────────────────
//
// geoPoint.ts answers "given a city/state/zip, WHERE is this row?". This module answers
// the question that comes first: "which COLUMN is the city, and which is the state?".
//
// That used to be answered by the model: the codegen response names pointCityColumn /
// pointStateColumn / pointZipColumn and the host geocoded from whatever it was handed.
// A production North America point map showed why that is not sufficient. The model was
//     City{distinct=23}, StateCode{distinct=16}, Country{distinct=4}, <2 measures>
// and answered `{"city":"City"}` — no state. Geocoding then ran city-only, so the
// City+State tier never engaged, the "state contradicts city" guard never had a state
// to check, and 8 of 32 marks were placed by the largest-match tie-break on a bare
// name ("Burlington" -> Burlington ONTARIO, not Vermont) with the map presenting them
// as ordinary points. Nothing was broken; a field was simply left blank.
//
// These roles are DETERMINISTICALLY RESOLVABLE from the values, and every classifier
// needed already exists in geoPoint.ts. So the model's answer is treated as a HINT that
// gets VERIFIED, and any role it omitted is BACKFILLED from the data. A hint is still
// useful — it disambiguates which of two plausible columns was intended — but it is
// never the only thing standing between the user and a wrong coordinate.
//
// THE COUNTRY TRAP this also closes. `resolveAdmin1("CA")` is CALIFORNIA. Measured
// across 15 country identifiers ("US" "USA" "United States" "CAN" "Canada" "MX" "MEX"
// "Mexico" …) that is the ONLY collision — but it is a catastrophic one: a Country
// column bound into the state slot makes every Canadian city fail to match inside
// California and fall back to the California centroid, piling Mississauga, Montréal,
// Burnaby and Laval onto one dot outside Bakersfield. "Canada, inside the USA."
//
// It cannot be fixed the way the sibling "Mexico" collision was (geoPoint.ts drops the
// bare admin1 NAME "mexico" because the country reading dominates and the State of
// México is obscure). For "CA" the California reading is overwhelmingly the common one
// in real US data, so deleting the key would break far more than it fixes. The fix has
// to be CONTEXTUAL, which is exactly what a column-level pass can do and a row-level
// lookup cannot: judge the column by ALL its values at once.

import { normalizePlaceName, resolveAdmin1, isKnownCity, zipPrefixCandidates } from "./geoPoint";

/** The place parts a coordinate can be resolved from. Any subset. */
export type PointBind = {
    city?: string;
    state?: string;
    zip?: string;
    lat?: string;
    lon?: string;
};

export type PointRoleResolution = {
    /** The binding to geocode with: hint, minus anything refused, plus anything backfilled. */
    bind: PointBind | null;
    /** Roles the hint omitted that were resolved from the data ("state=StateCode"). */
    backfilled: string[];
    /** Roles the hint named that were REFUSED, with why ("state=Country (country column)"). */
    refused: string[];
};

// Share of DISTINCT values a column must match before a role is claimed for it. Mirrors
// geoDetector's THRESHOLD_PCT: high enough that a column of something else cannot claim
// a role by accident, loose enough to tolerate the blanks and typos real data carries.
const THRESHOLD_PCT = 85;
// A role BACKFILLED from the data (no hint) additionally needs this many distinct
// matches — geoDetector's roster guard. One matching value is a coincidence, not a
// column: a lone "CA" is far likelier to be Canada than a single-state California table.
const MIN_DISTINCT_BACKFILL = 2;
// ZIP is held to a HIGHER bar than the name roles, because its classifier is pure digit
// shape and measures are digits too: a Revenue column carrying 54300 / 48900 / 33700
// reads as a perfectly good run of 5-digit ZIPs. Callers are expected to keep measures
// out of the candidate list, but that is one `isMeasure` flag away from failing open, and
// a measure silently adopted as the ZIP column would relocate every point on the map. A
// real ZIP column is ALL ZIPs, so demand exactly that.
const ZIP_THRESHOLD_PCT = 100;
// Classification reads DISTINCT values, so a wide column costs no more than a narrow
// one; this only bounds a pathological all-unique text column.
const MAX_DISTINCT_SCAN = 400;

// Country identifiers, normalized. Deliberately NOT a general ISO table: this exists
// only to break the one measured admin1 collision, and a column of countries is
// recognized by ALL its values being country identifiers, not by any single one.
const COUNTRY_IDS = new Set([
    "us", "usa", "u s", "u s a", "united states", "united states of america", "america",
    "ca", "can", "canada",
    "mx", "mex", "mexico", "estados unidos mexicanos",
]);

/** Distinct, normalized, non-blank values of a column (capped). */
function distinctNormalized(values: Array<unknown>): string[] {
    const seen = new Set<string>();
    for (const v of values) {
        if (v === null || v === undefined) continue;
        const k = normalizePlaceName(String(v));
        if (!k) continue;
        if (!seen.has(k)) {
            seen.add(k);
            if (seen.size >= MAX_DISTINCT_SCAN) break;
        }
    }
    return Array.from(seen);
}

/**
 * Is this column a list of COUNTRIES?
 *
 * True only when EVERY distinct value is a country identifier. That is the precise
 * shape of the trap: {US, CA, MX} and {CA} are countries, while {CA, TX} is a US state
 * column that happens to contain California. Being strict here matters — a loose test
 * would start refusing legitimate state columns.
 */
export function looksLikeCountryColumn(values: Array<unknown>): boolean {
    const d = distinctNormalized(values);
    if (d.length === 0) return false;
    return d.every(v => COUNTRY_IDS.has(v));
}

/** Share of DISTINCT values that resolve to a state/province, 0..100 (one decimal). */
export function admin1MatchPct(values: Array<unknown>): number {
    const d = distinctNormalized(values);
    if (d.length === 0) return 0;
    let n = 0;
    for (const v of d) if (resolveAdmin1(v)) n++;
    return Math.round((n / d.length) * 1000) / 10;
}

/** Distinct RAW (trimmed) values — for ZIPs, which normalizePlaceName would mangle:
 *  it rewrites punctuation to spaces, turning "90210-1234" into "90210 1234", which
 *  zipPrefixCandidates' ZIP+4 pattern then rejects. */
function distinctRaw(values: Array<unknown>): string[] {
    const seen = new Set<string>();
    for (const v of values) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (!s) continue;
        if (!seen.has(s)) {
            seen.add(s);
            if (seen.size >= MAX_DISTINCT_SCAN) break;
        }
    }
    return Array.from(seen);
}

/** Share of DISTINCT values that read as a ZIP / ZIP-prefix, 0..100 (one decimal). */
export function zipMatchPct(values: Array<unknown>): number {
    const d = distinctRaw(values);
    if (d.length === 0) return 0;
    let n = 0;
    for (const v of d) if (zipPrefixCandidates(v).length > 0) n++;
    return Math.round((n / d.length) * 1000) / 10;
}

/** Share of DISTINCT values that are known city names, 0..100 (one decimal). */
function cityPct(values: Array<unknown>): number {
    const d = distinctNormalized(values);
    if (d.length === 0) return 0;
    let n = 0;
    for (const v of d) if (isKnownCity(v)) n++;
    return Math.round((n / d.length) * 1000) / 10;
}

function distinctMatches(values: Array<unknown>, pred: (v: string) => boolean): number {
    let n = 0;
    for (const v of distinctNormalized(values)) if (pred(v)) n++;
    return n;
}

/** distinctMatches over RAW values (ZIP only — see distinctRaw). */
function distinctRawMatches(values: Array<unknown>, pred: (v: string) => boolean): number {
    let n = 0;
    for (const v of distinctRaw(values)) if (pred(v)) n++;
    return n;
}

/**
 * Verify the hinted point-column roles against the data and fill in what the hint left
 * out. Pure: `columns` are the available column names, `rows` the row objects keyed by
 * those names, `hint` whatever the codegen response named (may be null).
 *
 * `columns` MUST exclude measures. A place is a dimension; a measure that wandered into
 * this list can be adopted as the ZIP column on digit shape alone (see ZIP_THRESHOLD_PCT)
 * and would move every point on the map.
 *
 * A role is only ever REFUSED for a positive reason (the column is countries; the column
 * does not look like states at all) — never merely because the classifier is unsure. And
 * a refusal drops that ONE role, leaving the rest of the binding intact, because
 * geocoding from city alone still beats geocoding from nothing.
 */
export function resolvePointRoles(
    columns: string[],
    rows: Array<Record<string, any>>,
    hint: PointBind | null,
): PointRoleResolution {
    const backfilled: string[] = [];
    const refused: string[] = [];
    const out: PointBind = {};
    const colSet = new Set(columns);
    const valuesOf = (name: string) => rows.map(r => r[name]);

    // ---- 1. Carry over the hint, VERIFYING the two roles that can be catastrophically
    // wrong. city/lat/lon are carried as given: a mis-hinted city degrades to "no match"
    // (a visible off-map count), whereas a mis-hinted STATE actively relocates points.
    for (const role of ["city", "zip", "lat", "lon"] as const) {
        const name = hint?.[role];
        if (name && colSet.has(name)) out[role] = name;
    }
    const hintedState = hint?.state;
    if (hintedState && colSet.has(hintedState)) {
        const vals = valuesOf(hintedState);
        if (looksLikeCountryColumn(vals)) {
            // The "CA" trap. Every value is a country, so this is a country column that
            // landed in the state slot. Using it would resolve "CA" to California and
            // drag a whole country's cities into one US state.
            refused.push(`state=${hintedState} (every value is a country, not a state)`);
        } else if (admin1MatchPct(vals) < THRESHOLD_PCT) {
            refused.push(`state=${hintedState} (only ${admin1MatchPct(vals)}% of values are states/provinces)`);
        } else {
            out.state = hintedState;
        }
    }

    // ---- 2. Backfill the roles nothing supplied. This is the real-world fix: the model
    // named only the city, so the state column sat unused beside it.
    const taken = new Set(Object.values(out).filter(Boolean) as string[]);
    const candidates = columns.filter(c => !taken.has(c) && !c.startsWith("__"));

    if (!out.state) {
        let best: { name: string; pct: number } | null = null;
        for (const c of candidates) {
            const vals = valuesOf(c);
            if (looksLikeCountryColumn(vals)) continue;      // never a state
            const pct = admin1MatchPct(vals);
            if (pct < THRESHOLD_PCT) continue;
            if (distinctMatches(vals, v => !!resolveAdmin1(v)) < MIN_DISTINCT_BACKFILL) continue;
            if (!best || pct > best.pct) best = { name: c, pct };
        }
        if (best) {
            out.state = best.name;
            taken.add(best.name);
            backfilled.push(`state=${best.name} (${best.pct}% states/provinces)`);
        }
    }

    if (!out.zip) {
        for (const c of candidates) {
            if (taken.has(c)) continue;
            const vals = valuesOf(c);
            const pct = zipMatchPct(vals);
            if (pct < ZIP_THRESHOLD_PCT) continue;
            if (distinctRawMatches(vals, v => zipPrefixCandidates(v).length > 0) < MIN_DISTINCT_BACKFILL) continue;
            out.zip = c;
            taken.add(c);
            backfilled.push(`zip=${c} (${pct}% ZIP codes)`);
            break;
        }
    }

    if (!out.city) {
        let best: { name: string; pct: number } | null = null;
        for (const c of candidates) {
            if (taken.has(c)) continue;
            const vals = valuesOf(c);
            const pct = cityPct(vals);
            if (pct < THRESHOLD_PCT) continue;
            if (distinctMatches(vals, v => isKnownCity(v)) < MIN_DISTINCT_BACKFILL) continue;
            if (!best || pct > best.pct) best = { name: c, pct };
        }
        if (best) {
            out.city = best.name;
            backfilled.push(`city=${best.name} (${best.pct}% known cities)`);
        }
    }

    const any = !!(out.city || out.state || out.zip || (out.lat && out.lon));
    return { bind: any ? out : null, backfilled, refused };
}
