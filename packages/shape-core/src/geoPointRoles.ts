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

import { normalizePlaceName, resolveAdmin1, isKnownCity, zipPrefixCandidates, type GeoMapKind } from "./geoPoint";
import { countryIso3 } from "./geoCountryNames";
import { ROLE_MATCH_PCT, CITY_ROLE_MATCH_PCT, isBlankLike } from "./matchQuality";
// ONE tokenizer for "is this column NAMED like a ZIP" — geoDetector owns it and both
// classifiers have to agree on the answer. (One-directional: geoDetector never imports back.)
import { hasAnyToken, ZIP_NAME_TOKENS } from "./geoDetector";

/** The place parts a coordinate can be resolved from. Any subset. */
export type PointBind = {
    city?: string;
    state?: string;
    zip?: string;
    lat?: string;
    lon?: string;
    /** Narrows a city name to the row's own country. Never inferred from a value in
     *  another slot — see the "CA" note above. */
    country?: string;
};

export type PointRoleResolution = {
    /** The binding to geocode with: hint, minus anything refused, plus anything backfilled. */
    bind: PointBind | null;
    /** Roles the hint omitted that were resolved from the data ("state=StateCode"). */
    backfilled: string[];
    /** Roles the hint named that were REFUSED, with why ("state=Country (country column)"). */
    refused: string[];
};

// Every role-identification threshold is ROLE_MATCH_PCT (matchQuality.ts) - ONE number,
// tunable in one place, covering city/state/ZIP/country alike.
// A role BACKFILLED from the data (no hint) additionally needs this many distinct
// matches — geoDetector's roster guard. One matching value is a coincidence, not a
// column: a lone "CA" is far likelier to be Canada than a single-state California table.
const MIN_DISTINCT_BACKFILL = 2;
// ZIP used to sit at 100 because it is classified on digit shape alone and a 5-digit Revenue
// column reads as a clean run of ZIPs. That was never what the 100 bought: a revenue column
// scores 100 too. The real protection is that callers pass DIMENSIONS ONLY, which is still
// true, so ZIP now shares the one threshold like every other role.
// Classification reads DISTINCT values, so a wide column costs no more than a narrow
// one; this only bounds a pathological all-unique text column.
const MAX_DISTINCT_SCAN = 400;
// The gazetteer-quality bar lives in matchQuality.ts so it is tunable in ONE place; see
// ROLE_MATCH_PCT there for the identification-versus-matching distinction it encodes.

/**
 * Is this normalized token a country identifier?
 *
 * This used to be a hardcoded fourteen-entry set of US/CA/MX spellings, and its comment
 * explained why: it existed "only to break the one measured admin1 collision", back when
 * country could do nothing but narrow a North-American city match. Every word of that was
 * true at 0.1.7 and none of it survived the world expansion — placement resolves all 195
 * countries through countryIso3, so detection that stops at three of them means a column of
 * European or Asian countries is not recognized as a country column at all, and the tier
 * that could place it never engages. That was the third guard behind the World (Bubbles)
 * empty state (dev LLMLogID 38905), after the two placeability gates.
 *
 * Detection and placement now read the SAME table, which is the only arrangement where
 * "we recognized it" and "we can place it" cannot disagree.
 */
function isCountryId(normalized: string): boolean {
    return !!countryIso3(normalized);
}

/** Distinct, normalized, non-blank values of a column (capped). */
function distinctNormalized(values: Array<unknown>): string[] {
    const seen = new Set<string>();
    for (const v of values) {
        if (v === null || v === undefined) continue;
        const k = normalizePlaceName(String(v));
        // isBlankLike, not just falsy: "-" and "?" already reduce to "" here, but "N/A"
        // survives as "n a" and would otherwise count as a FAILED match and drag the ratio
        // down. A blank is not a value, so it leaves the denominator rather than voting.
        if (isBlankLike(k)) continue;
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
 * Every distinct value must be a country identifier, AND at least one of them must be
 * UNAMBIGUOUS — a country identifier that is not also a state/province code.
 *
 * That second condition is not fussiness, it is the whole correctness of this function
 * under CROSS-FILTERING. Roles are re-resolved against whatever rows survive a filter, and
 * "CA" is the one token that is both a country (Canada) and an admin1 (California). Filter
 * a US table down to a single Californian row and its StateCode column becomes exactly
 * {"CA"} — trivially "all country identifiers". Without this condition that column is
 * adopted as the COUNTRY role, every city is then narrowed to Canada, nothing matches, and
 * the map goes BLANK on a single click. Observed on the real point map, 2026-07-26.
 *
 * So: {US, CA, MX} is a country column (US and MX are unambiguous), {Canada, Mexico} is a
 * country column, {CA, TX} is a US state column containing California, and {CA} ALONE is
 * not enough evidence for anything — which is the honest answer, because it genuinely is
 * not enough evidence.
 */
export function looksLikeCountryColumn(values: Array<unknown>): boolean {
    const d = distinctNormalized(values);
    if (d.length === 0) return false;

    // A MINIMUM RATIO against the gazetteer, not "every value" (Joel 2026-08-02: "there
    // probably needs to be a minimum ratio of successful matches against the gazette (e.g.
    // 97% - if data quality is worse, it's the user's responsibility to clean it)"). The old
    // all-or-nothing test meant one "N/A", one "Unknown" or one typo in an otherwise clean
    // country column disqualified the whole column and silently cost the map its country
    // role. 97% keeps that from being a cliff while staying far too strict for a column of
    // something else to claim the role by accident.
    if (countryMatchPct(values) < ROLE_MATCH_PCT) return false;

    // AN AMBIGUOUS TOKEN IS SETTLED BY THE COMPANY IT KEEPS (Joel, same note): "CA" should
    // read as Canada beside US/DE/IT, and as California beside CO/FL/WA. Count only the
    // values that can mean ONE thing — those are the column's actual evidence — and let them
    // decide. {CA, DE, IT}: IT is a country and nothing else, DE and CA are both, so the sole
    // evidence says country. {CA, CO, FL, WA}: FL and WA are states and nothing else, so it
    // says state (and the ratio test above has usually already excluded it).
    //
    // {CA} alone still decides NOTHING, which remains the honest answer: zero sole evidence
    // either way. That is the cross-filter case — one Californian row surviving a click must
    // not turn its StateCode column into "Canada" and blank the map.
    const soleCountry = d.filter(v => isCountryId(v) && !resolveAdmin1(v)).length;
    const soleState = d.filter(v => !isCountryId(v) && !!resolveAdmin1(v)).length;
    return soleCountry >= 1 && soleCountry >= soleState;
}

/**
 * The countries the NORTH-AMERICA scope can draw. This is a FILTER, not gazetteer truth:
 * the gazetteer knows every country regardless of which map is on screen, and a map decides
 * which of those readings are live for it (Joel 2026-08-02: "detection ought to be global…
 * same code base, but different filters depending on chart type. the gazette is 'true' no
 * matter the chart, though."). It matches the admin1 table's own coverage — US, Canada and
 * Mexico are exactly the countries whose states/provinces resolve.
 */
const NORTH_AMERICA_COUNTRIES = new Set(["USA", "CAN", "MEX"]);

/**
 * A token that could be read EITHER as a state/province or as a country the map can show.
 * Such a value cannot, on its own, decide a column's role.
 *
 * SCOPE IS LOAD-BEARING HERE, and it is why this takes a mapKind. The rule was written for
 * the single North-American collision, "CA" = Canada vs California. Once detection went
 * global (it must — see isCountryId) the collision set exploded: IL is Illinois AND Israel,
 * IN India, DE Germany, LA Laos, PA Panama, MD Moldova, and about a dozen more. Treating all
 * of those as ambiguous everywhere cost real placements — a two-row subset whose only state
 * value was "IL" stopped resolving the state role at all, and a row that placed in the full
 * table blanked under cross-filter, which is the one thing payloadGeoSubset.test.ts exists to
 * forbid.
 *
 * The resolution is not to shrink the gazetteer back down; it is to ask whether the COUNTRY
 * reading is live for THIS map. On a North America map, "IL" cannot mean Israel because
 * Israel is not on it, so Illinois wins uncontested. On a World map it genuinely can, and the
 * value stays ambiguous — which is the honest answer there.
 */
function isAmbiguousCountryState(normalized: string, mapKind?: GeoMapKind | null): boolean {
    if (!resolveAdmin1(normalized)) return false;
    const iso = countryIso3(normalized);
    if (!iso) return false;
    return mapKind === "world" ? true : NORTH_AMERICA_COUNTRIES.has(iso);
}

/** Share of DISTINCT values that are country identifiers, 0..100 (one decimal). */
export function countryMatchPct(values: Array<unknown>): number {
    const d = distinctNormalized(values);
    if (d.length === 0) return 0;
    let n = 0;
    for (const v of d) if (isCountryId(v)) n++;
    return Math.round((n / d.length) * 1000) / 10;
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
        // Same rule as distinctNormalized: a typed placeholder is a blank, and ZIP is held
        // to a 100% bar, so one "N/A" would otherwise disqualify an entire clean column.
        if (isBlankLike(normalizePlaceName(s))) continue;
        if (!seen.has(s)) {
            seen.add(s);
            if (seen.size >= MAX_DISTINCT_SCAN) break;
        }
    }
    return Array.from(seen);
}

/** Share of DISTINCT values that read as a ZIP / ZIP-prefix, 0..100 (one decimal). This is a
 *  VALUE question — "can this be read as a ZIP" — and it stays permissive about short forms,
 *  because a stripped leading zero really is a ZIP. Whether the COLUMN may hold the ZIP role
 *  is a different question; see zipColumnCorroborated. */
export function zipMatchPct(values: Array<unknown>): number {
    const d = distinctRaw(values);
    if (d.length === 0) return 0;
    let n = 0;
    for (const v of d) if (zipPrefixCandidates(v).length > 0) n++;
    return Math.round((n / d.length) * 1000) / 10;
}

/**
 * Is there evidence that this column is POSTAL at all, beyond its digit shape?
 *
 * ZIP is the one role identified on shape rather than a gazetteer, and a 3-4 digit value only
 * reads as a ZIP because integer storage ate a leading zero. That is real — the whole New
 * England / NJ / PR 0xxxx block depends on it — but taken alone it is just a small number, and
 * zipMatchPct rightly cannot tell the difference. Every dimension of short numeric codes (a
 * store number, a route, a plan code, a fiscal week) scores a clean 100% there, so the ratio
 * alone was enough to adopt one as the ZIP column and scatter the whole table across real
 * American centroids — reporting "zip3" precision, which is a claim, not a shrug.
 *
 * The split is the matchQuality doctrine applied to the one role that had blurred it: the
 * MEASURE says what the values could be, and this says whether the COLUMN has earned the role.
 * Two escapes, the same two geoDetector allows: a genuine 5-digit ZIP somewhere in the column,
 * or a column NAME that says postal.
 */
function zipColumnCorroborated(values: Array<unknown>, columnName?: string): boolean {
    if (hasAnyToken(columnName, ZIP_NAME_TOKENS)) return true;
    return distinctRaw(values).some(v => /^\d{5}(-\d{4})?$/.test(v.replace(/\.0+$/, "")));
}

/** Share of DISTINCT values that are known city names, 0..100 (one decimal). Scope
 *  follows the MAP being built (v2 tables carry per-row kind flags): a world map
 *  verifies its city column against the world rows, while the default stays North
 *  America so existing shapes classify exactly as before. */
function cityPct(values: Array<unknown>, mapKind?: GeoMapKind | null): number {
    const d = distinctNormalized(values);
    if (d.length === 0) return 0;
    let n = 0;
    for (const v of d) if (isKnownCity(v, mapKind)) n++;
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
 * this list can be adopted as the ZIP column on digit shape alone (see ROLE_MATCH_PCT)
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
    mapKind?: GeoMapKind | null,
): PointRoleResolution {
    const backfilled: string[] = [];
    const refused: string[] = [];
    const out: PointBind = {};
    const colSet = new Set(columns);
    const valuesOf = (name: string) => rows.map(r => r[name]);

    // ---- 1. Carry over the hint, VERIFYING the roles that can be catastrophically wrong.
    //
    // The dividing line is what a WRONG hint does. A mis-hinted CITY degrades to "no match":
    // the row falls to a coarser tier or shows up in the visible off-map count, and nothing
    // is asserted that isn't true. A mis-hinted STATE or ZIP actively RELOCATES the point —
    // both name a real centroid for whatever they resolve to — so both are checked against
    // the values before they are trusted. State has always been; ZIP was in this carry-over
    // loop with the harmless roles, which reads as deliberate and was not: a dimension of
    // 3-4 digit codes (a store number, a route, a plan code) scores 100% "ZIP" on digit shape
    // and would have scattered the map across real American cities.
    //
    // A refused hint is dropped from the binding, exactly like state, so the backfill below
    // gets its turn — that is the half the country role was missing until this same pass.
    for (const role of ["city", "lat", "lon", "country"] as const) {
        const name = hint?.[role];
        if (name && colSet.has(name)) out[role] = name;
    }
    const hintedZip = hint?.zip;
    if (hintedZip && colSet.has(hintedZip)) {
        const vals = valuesOf(hintedZip);
        const pct = zipMatchPct(vals);
        if (pct < ROLE_MATCH_PCT) refused.push(`zip=${hintedZip} (only ${pct}% of values read as ZIPs)`);
        else if (!zipColumnCorroborated(vals, hintedZip))
            refused.push(`zip=${hintedZip} (all values are 3-4 digits with nothing to say they are postal)`);
        else out.zip = hintedZip;
    }
    const hintedState = hint?.state;
    if (hintedState && colSet.has(hintedState)) {
        const vals = valuesOf(hintedState);
        const dvals = distinctNormalized(vals);
        if (dvals.length > 0 && dvals.every(v => isAmbiguousCountryState(v, mapKind))) {
            // Everything in this column is the Canada/California token and nothing else.
            // It is genuinely undecidable, so decide nothing: refuse it as a state (using it
            // would place Canadian cities in California) and do NOT promote it to country
            // (that would place Californian cities in Canada). Falling back to city-only
            // still resolves, which is the one outcome that cannot be badly wrong.
            refused.push(`state=${hintedState} (every value is "CA", which is both Canada and California)`);
        } else if (looksLikeCountryColumn(vals)) {
            // The "CA" trap. Every value is a country, so this is a country column that
            // landed in the state slot. Using it would resolve "CA" to California and
            // drag a whole country's cities into one US state.
            //
            // Having identified what the column actually IS, put it to work rather than
            // discarding it: as the COUNTRY role it narrows city matching to the right
            // country, which is most of the value the state would have provided.
            refused.push(`state=${hintedState} (every value is a country, not a state)`);
            if (!out.country) out.country = hintedState;
        } else if (admin1MatchPct(vals) < ROLE_MATCH_PCT) {
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
            if (pct < ROLE_MATCH_PCT) continue;
            // The roster guard, relaxed for UNAMBIGUOUS evidence. A cross-filter can shrink
            // any column to one distinct value, and demanding two flatly would drop the
            // state role on every single-row subset — degrading precision for no reason. One
            // "TX" is proof enough; one "CA" is not, because it is equally Canada.
            const hits = distinctMatches(vals, v => !!resolveAdmin1(v));
            const unambiguous = distinctMatches(vals, v => !!resolveAdmin1(v) && !isAmbiguousCountryState(v, mapKind));
            if (hits < MIN_DISTINCT_BACKFILL && unambiguous < 1) continue;
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
            if (pct < ROLE_MATCH_PCT) continue;
            if (!zipColumnCorroborated(vals, c)) continue;   // shape alone is not evidence
            if (distinctRawMatches(vals, v => zipPrefixCandidates(v).length > 0) < MIN_DISTINCT_BACKFILL) continue;
            out.zip = c;
            taken.add(c);
            backfilled.push(`zip=${c} (${pct}% ZIP codes)`);
            break;
        }
    }

    // COUNTRY narrows city matching to the row's own country, which is what keeps a bare
    // "Burlington" on a US row out of Ontario. Backfilled last among the narrowing roles
    // and only from an unambiguous all-country column, because a wrong country is worse
    // than none: it would filter every candidate away and drop the row to a coarser tier.
    //
    // A HINTED COUNTRY COLUMN THAT DOES NOT VERIFY MUST NOT BLOCK ONE THAT DOES. The hint is
    // carried in unchecked at step 1, which is right — as a narrowing constraint an
    // unrecognized country costs nothing. But it also OWNED the slot, so this backfill never
    // ran, and placement (which does require proof, see the two conditions below) had nothing
    // to work with even when a clean country column sat in the next field over.
    //
    // world_country_metrics is exactly that shape and is why this was found: the server named
    // `Country` — full names, and 42 of its 44 distinct values resolve (95.5%, half a point
    // under the bar; the two misses are the deliberate "Freedonia" and "Global (unassigned)"
    // rows) — while `CountryCode` beside it is clean ISO-3 at 100%, since those same two rows
    // leave the code BLANK and a blank is not a failed match. The map placed NOTHING instead
    // of 42 of 44, and reported only that the hint had failed.
    //
    // This is what the STATE role has always done — refuse what fails verification, then
    // resolve the role from the data — and country simply was never wired the same way. If
    // nothing verifies, the hint is left in place as a narrowing constraint, unchanged.
    const hintedCountry = out.country;
    if (!hintedCountry || !looksLikeCountryColumn(valuesOf(hintedCountry))) {
        // BEST, not first-past-the-post, matching what state and city already do. With two
        // qualifying columns the source order decided it, so a table carrying both a name
        // column and an ISO column could be read off whichever happened to come first —
        // arbitrary in exactly the situation where one of them is measurably cleaner.
        let best: { name: string; pct: number } | null = null;
        for (const c of candidates) {
            if (taken.has(c)) continue;      // `candidates` already excludes the hint itself
            if (!looksLikeCountryColumn(valuesOf(c))) continue;
            const pct = countryMatchPct(valuesOf(c));
            if (!best || pct > best.pct) best = { name: c, pct };
        }
        if (best) {
            if (hintedCountry) {
                refused.push(`country=${hintedCountry} (only ${countryMatchPct(valuesOf(hintedCountry))}% `
                    + `of values are country identifiers; using ${best.name} instead)`);
            }
            out.country = best.name;
            taken.add(best.name);
            backfilled.push(`country=${best.name}`);
        }
    }

    if (!out.city) {
        let best: { name: string; pct: number } | null = null;
        for (const c of candidates) {
            if (taken.has(c)) continue;
            const vals = valuesOf(c);
            const pct = cityPct(vals, mapKind);
            // Cities are open free text, not a closed vocabulary - see CITY_ROLE_MATCH_PCT.
            if (pct < CITY_ROLE_MATCH_PCT) continue;
            if (distinctMatches(vals, v => isKnownCity(v, mapKind)) < MIN_DISTINCT_BACKFILL) continue;
            if (!best || pct > best.pct) best = { name: c, pct };
        }
        if (best) {
            out.city = best.name;
            backfilled.push(`city=${best.name} (${best.pct}% known cities)`);
        }
    }

    // COUNTRY ALONE CAN PLACE, since the COUNTRY precision tier (0.4.2) — under two
    // conditions, both of which matter.
    //
    // This line used to exclude country outright, and said so deliberately. At 0.1.7, where
    // the rule was written, country could only NARROW the other tiers, so a country-only
    // binding really did mean "nothing to geocode". 0.4.2 added country PLACEMENT — every row
    // in a country on its centroid, the coarsest honest answer, with the precision tier
    // saying exactly that — and this rule was never revisited. The two then contradicted each
    // other: resolveGeoPoint would happily place a country-only row while this refused to
    // hand it one, so the capability shipped unreachable. Symptom: a World point map over
    // country-only data drew "No coordinate data available" with a perfectly resolvable
    // 44-country table behind it (dev LLMLogID 38905).
    //
    // CONDITION 1 — DETECTION, not a hint (Joel 2026-08-02: "you can certainly use country
    // alone - as long as the detection proves there IS a true country column"). A hinted
    // country role is carried above WITHOUT checking its values, which was safe while country
    // could only narrow: an unrecognized country is a no-op inside resolveGeoPoint. Now that
    // it can place, an unverified hint would open the gate on any column at all and append a
    // full set of null coordinates — telling the chart it has a map when it has none. So
    // placement requires looksLikeCountryColumn to agree. A hint that fails is still KEPT as
    // a narrowing constraint (it costs nothing); it just cannot be the thing that makes a
    // binding geocodable.
    //
    // CONDITION 2 — the column must actually DISTINGUISH rows. Joel: "World types yes, North
    // America, yes, USA - no." Gated on the structural trait rather than a map-type allowlist,
    // because that is what the map-type answer is really about: on a US map every row is in
    // the US, so country-alone stacks the entire dataset on one centroid. Two or more resolvable
    // countries is exactly the condition that makes the tier meaningful, and it gives Joel's
    // three answers without new plumbing — GeoMapKind cannot even express "usa" today, so a
    // literal per-map rule would be untestable AND would still miss a World map holding
    // single-country data, which is the same degenerate picture.
    const countryValues = out.country ? valuesOf(out.country) : [];
    const countryProven = !!out.country && looksLikeCountryColumn(countryValues);
    const distinctCountries = countryProven
        ? new Set(countryValues.map(v => countryIso3(v == null ? null : String(v))).filter(Boolean)).size
        : 0;
    const countryCanPlace = countryProven && distinctCountries >= 2;

    // LAT/LON NEEDED CONDITION 1 TOO. The paragraph above was written for country and is just
    // as true one slot over: two column NAMES were enough to declare the binding geocodable,
    // with nothing checking that the columns hold coordinates. A hint naming the wrong pair —
    // or the right pair in a table where they arrive as text, or as the 0/blank a join left
    // behind — passed this gate, appended a full set of null __geoLat__/__geoLon__ values, and
    // told the chart it had a map. That is the SAME empty state country-only data drew, minus
    // even a refusal line to explain it.
    //
    // The bar is deliberately one row, not a ratio: unlike the name roles, a coordinate needs
    // no gazetteer and no judgement — it either parses in range or it does not — and a table
    // where a handful of rows carry coordinates and the rest are blank is ordinary, honest
    // data whose misses the unplaced count already reports.
    const latLonCanPlace = !!(out.lat && out.lon) && rows.some(r => {
        const la = +String(r[out.lat!] ?? "").trim(), lo = +String(r[out.lon!] ?? "").trim();
        return isFinite(la) && isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180
            && String(r[out.lat!] ?? "").trim() !== "" && String(r[out.lon!] ?? "").trim() !== "";
    });
    if (out.lat && out.lon && !latLonCanPlace) {
        refused.push(`lat/lon=${out.lat}/${out.lon} (no row holds a usable coordinate pair)`);
    }

    if (out.country && !countryCanPlace && !(out.city || out.state || out.zip || latLonCanPlace)) {
        // The only candidate role was country and it cannot carry the map on its own. Say
        // which of the two conditions failed, so the chart can explain rather than blank.
        refused.push(countryProven
            ? `country=${out.country} (every row resolves to the same country - nothing to place apart)`
            : `country=${out.country} (values are not country identifiers)`);
    }

    const any = !!(out.city || out.state || out.zip || countryCanPlace || latLonCanPlace);
    return { bind: any ? out : null, backfilled, refused };
}
