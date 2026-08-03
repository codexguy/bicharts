// ──────────────────────────────────────────────────────────────────────────
// Client-side GEO detector (geo/choropleth Phase 0 — the enabling SIGNAL)
// ──────────────────────────────────────────────────────────────────────────
//
// Measures whether a categorical column is a GEOGRAPHIC dimension and, if so,
// of which KIND (country / US-state / US-ZIP / US-county). Runs client-side in
// shape-core so BOTH the Power BI visual and the MCP classifier share ONE
// implementation — the profiler has the ACTUAL cell values (the server sees
// only obfuscated tokens), so geo recognition MUST happen here.
//
// What ships to the server is an ENUM + a PERCENT + a bool, never raw values:
//   geoKind      — the most specific kind that clears threshold (see GeoKind)
//   geoMatchPct  — % of DISTINCT values that resolved to that kind
//   geoAmbiguous — the value set is a known code collision (ISO-2 vs USPS,
//                  ZIP vs county-FIPS, or country-name vs US-state-name) that a
//                  single column cannot disambiguate; the server gate should be
//                  conservative. Set only when genuinely undecidable here.
// This is strictly less revealing than isTemporal (shipped unconditionally) —
// "column X looks like countries, 98% matched" is not a user secret — so the
// caller runs detection regardless of privacy level and ships only the summary.
//
// Design decisions (2026-07-21):
//   • ISO codes are the interchange. Normal form: country → ISO 3166-1 alpha-3;
//     US state → USPS. (Normalization to normal form is Phase 1's __geoIso__
//     builder; Phase 0 only DETECTS.)
//   • Country NAMES are recognized in all 27 languages the visual supports, built
//     at runtime from Intl.DisplayNames(type:'region') (the monthNames.ts pattern —
//     zero shipped name table), UNION a small flat alias overlay (alias → ISO3) for
//     forms Intl doesn't emit ("USA", "UK", "Holland", historical names). The
//     overlay is a plain map on purpose: trivial for an LLM to extend.
//   • us-county-NAME is intentionally NOT detected here — it needs a sibling STATE
//     column to disambiguate (Illinois "Lake" vs Indiana "Lake"), which a single-
//     column detector can't see. Deferred to Phase 3, where the caller supplies
//     cross-column context.
//
// Returns null when nothing clears threshold → the caller ships no geo fields
// (older servers ignore them anyway; the signal is inert until Phase 1's gate).

// The city table lives in geoPoint (the point-geocode cascade owns it); this module
// only asks "is this a known city?" to emit the city-name KIND. One-directional —
// geoPoint never imports geoDetector — so there is no import cycle.
import { isKnownCity, normalizeZip5 } from "./geoPoint";
import { ROLE_MATCH_PCT, CITY_ROLE_MATCH_PCT, isBlankLike } from "./matchQuality";
// The country tables + the shared normalizer moved to geoCountryNames when the World
// point map needed them too — geoPoint could not import them back without a cycle.
import {
    ISO_3166_PAIRS, ISO2_TO_ISO3, ISO2_SET, ISO3_SET, SUPPORTED_LANGS,
    COUNTRY_ALIAS_OVERLAY, countryNameMap, normalizePlaceName, countryIso3,
} from "./geoCountryNames";

// ISO 3166-1: alpha-2 → alpha-3, the full assigned set. This is the ONLY geo
// name/code table that ships (a few KB); everything else (country names in 27

// US states + DC + the five inhabited territories: USPS code ↔ name. Small
// enough to ship verbatim (no Intl source for subnational names).
const US_STATE_PAIRS: [string, string][] = [
    ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
    ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
    ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
    ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
    ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
    ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
    ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
    ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
    ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
    ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
    ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
    ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
    ["WI", "Wisconsin"], ["WY", "Wyoming"], ["DC", "District of Columbia"],
    ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"],
    ["AS", "American Samoa"], ["MP", "Northern Mariana Islands"],
];
const USPS_SET: Set<string> = new Set(US_STATE_PAIRS.map(p => p[0]));

// Common / traditional (AP-style) state abbreviations users actually type — the forms
// USPS 2-letter codes and full names both miss ("Calif.", "Fla.", "N.Y.", "Wash."). Keys
// are pre-normalize spellings (normalizeName strips the periods → "calif", "n y", "wash");
// values are USPS. A plain map so an LLM can extend it (the COUNTRY_ALIAS_OVERLAY pattern).
// Bare 2-letter forms (with/without a period) already resolve via USPS us-state-code, so
// this focuses on the distinctive multi-char + punctuated abbreviations.
const US_STATE_ALIAS_OVERLAY: Record<string, string> = {
    "Ala.": "AL", "Alab.": "AL", "Ariz.": "AZ", "Ark.": "AR",
    "Calif.": "CA", "Cal.": "CA", "Colo.": "CO", "Col.": "CO", "Conn.": "CT",
    "Del.": "DE", "Fla.": "FL", "Flor.": "FL", "Ga.": "GA",
    "Ill.": "IL", "Ind.": "IN", "Kan.": "KS", "Kans.": "KS", "Ky.": "KY",
    "La.": "LA", "Md.": "MD", "Mass.": "MA", "Mich.": "MI", "Minn.": "MN",
    "Miss.": "MS", "Mo.": "MO", "Mont.": "MT", "Neb.": "NE", "Nebr.": "NE",
    "Nev.": "NV", "N.H.": "NH", "N.J.": "NJ", "N.M.": "NM", "N.Mex.": "NM", "N. Mex.": "NM",
    "N.Y.": "NY", "N.C.": "NC", "N.D.": "ND", "N.Dak.": "ND", "N. Dak.": "ND",
    "Okla.": "OK", "Ore.": "OR", "Oreg.": "OR",
    "Pa.": "PA", "Penn.": "PA", "Penna.": "PA", "R.I.": "RI", "S.C.": "SC",
    "S.D.": "SD", "S.Dak.": "SD", "S. Dak.": "SD", "Tenn.": "TN", "Tex.": "TX",
    "Vt.": "VT", "Va.": "VA", "Wash.": "WA", "W.Va.": "WV", "W. Va.": "WV",
    "Wis.": "WI", "Wisc.": "WI", "Wyo.": "WY",
    "D.C.": "DC", "Wash. D.C.": "DC", "Wash., D.C.": "DC",
    "P.R.": "PR", "V.I.": "VI",
};
const STATE_NAME_TO_USPS: Map<string, string> = (() => {
    const m = new Map<string, string>();
    for (const [code, name] of US_STATE_PAIRS) m.set(normalizeName(name), code);
    // A couple of common alternates Intl/CLDR or users write differently.
    m.set(normalizeName("Washington DC"), "DC");
    m.set(normalizeName("Washington D.C."), "DC");
    m.set(normalizeName("US Virgin Islands"), "VI");
    // Common/traditional abbreviations (Calif., Fla., N.Y., …).
    for (const [alias, code] of Object.entries(US_STATE_ALIAS_OVERLAY)) {
        const key = normalizeName(alias);
        if (key && !m.has(key)) m.set(key, code);
    }
    return m;
})();

// Valid 2-digit state FIPS prefixes (50 states + DC + 5 territories). A 5-digit
// numeric is a plausible county FIPS only when its first two digits are in here;
// otherwise it's a ZIP (e.g. "90210" → prefix "90" ∉ set → not a county).
const STATE_FIPS_SET: Set<string> = new Set([
    "01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15", "16",
    "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
    "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42",
    "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56",
    "60", "66", "69", "72", "78",
]);

// ── Normalizers ────────────────────────────────────────────────────────────
// Codes: uppercase + trim, so "us" / " US " / "Us" all compare as "US".
function normalizeCode(s: string): string {
    return s.trim().toUpperCase();
}
// Names: lowercase, strip diacritics, drop punctuation (keep letters/digits of
// ANY script + spaces so CJK / Arabic / Cyrillic names survive), collapse
// whitespace. "Côte d'Ivoire" → "cote d ivoire"; "日本" stays "日本".
// ONE implementation with geoPoint's normalizePlaceName, not a copy: isKnownCity's
// contract is "already normalized, do not re-normalize" — detectGeo passes THIS
// function's output into the city table, so the two normalizers diverging would make
// city detection silently miss with no test catching it. (2026-07-25 sweep.)
// Declared `function` (hoisted) — module-init tables above/below call it during load.
function normalizeName(s: string): string {
    return normalizePlaceName(s);
}


// ── Column-name tokens (tiebreaker / guard, never a substitute) ─────────────
const COUNTRY_NAME_TOKENS = new Set(["country", "countries", "nation", "nationality", "iso", "geo"]);
const STATE_NAME_TOKENS = new Set(["state", "province", "st"]);
export const ZIP_NAME_TOKENS = new Set(["zip", "zipcode", "postal", "postcode", "plz"]);
const COUNTY_NAME_TOKENS = new Set(["county", "fips", "borough", "parish"]);
const CITY_NAME_TOKENS = new Set(["city", "cities", "town", "municipality", "metro", "location", "place"]);

function tokenizeName(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-./]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0);
}
export function hasAnyToken(columnName: string | undefined, tokens: Set<string>): boolean {
    if (!columnName) return false;
    for (const t of tokenizeName(columnName)) if (tokens.has(t)) return true;
    return false;
}

// ── Public API ──────────────────────────────────────────────────────────────
export type GeoKind =
    | "country-iso3"
    | "country-iso2"
    | "country-name"
    | "us-state-code"
    | "us-state-name"
    | "us-zip5"
    | "us-county-fips"
    // NOT a choropleth join key — no bundled geometry is keyed by city. It marks a column
    // whose values geoPoint can turn into a COORDINATE, which is what makes a point map
    // (North America Bubbles) offerable on data that has no lat/lon columns.
    | "city-name";

export type GeoDetectionResult = {
    geoKind: GeoKind;
    geoMatchPct: number;      // 0..100, one decimal
    geoAmbiguous?: boolean;   // known single-column code collision
};

// Emit the signal only above this match rate. The client REPORTS the measured
// pct; the server gate re-checks against sysparm LLMGeoMinMatchPct (Phase 1).
// Shared with every other role-identification decision - see ROLE_MATCH_PCT.
const THRESHOLD_PCT = ROLE_MATCH_PCT;
// Dictionary-word kinds (country/state NAMES) collide with person/place names
// (Chad, Georgia, Jordan). Require either a decent number of matched distinct
// values OR a geo-ish column name, so a 3-name roster doesn't read as countries.
const NAME_KIND_MIN_DISTINCT = 5;
// Cap the work on pathological high-cardinality free-text columns. Real geo
// columns are far below this (≤ ~250 countries, 56 states, ~42k ZIPs). ZIP/FIPS
// are cheap regex either way; this only bounds the dictionary path.
const MAX_DISTINCT_CONSIDERED = 60000;

type Candidate = { kind: GeoKind; pct: number; matched: number; spec: number };

/**
 * Detect whether a column's values are a geographic dimension.
 * @param rawValues DISTINCT raw cell values (order irrelevant; duplicates are
 *   harmless but the caller usually passes the distinct set).
 * @param columnName the source column name (tiebreaker/guard for ambiguous codes).
 * @param _locale reserved (country names already union all 27 languages; the
 *   report locale is not needed to match). Kept for signature symmetry.
 */
export function detectGeo(
    rawValues: string[],
    columnName?: string,
    _locale?: string,
): GeoDetectionResult | null {
    if (!rawValues || rawValues.length === 0) return null;

    // Distinct (CASE-INSENSITIVE — regions are the same place regardless of case,
    // so "USA"/"usa" is one region, not two), non-empty, string-ified. The first
    // spelling seen represents the region for matching.
    const distinct: string[] = [];
    const seen = new Set<string>();
    for (const v of rawValues) {
        if (v === null || v === undefined) continue;
        const s = String(v).trim();
        if (s.length === 0) continue;
        // A TYPED PLACEHOLDER IS A BLANK, and a blank leaves the denominator rather than
        // voting against the column (Joel 2026-08-02: "my 97% is for non-blanks... '-' and
        // 'N/A' could be interpreted as blank, as well"). That instruction was applied to the
        // point-role classifier and not to this one, which is the half that decides whether a
        // CHOROPLETH is offered at all — so a clean 20-country column with one "Unknown" in it
        // scored 95% against a 96 bar and was refused a map, while the same column on a point
        // map scored 100. Same doctrine, same helper, both classifiers.
        if (isBlankLike(normalizeName(s))) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        distinct.push(s);
        if (distinct.length > MAX_DISTINCT_CONSIDERED) return null;
    }
    const total = distinct.length;
    if (total < 2) return null; // a 1-region "map" is degenerate

    const upper = distinct.map(normalizeCode);
    const names = distinct.map(normalizeName);
    const cnMap = countryNameMap();

    let iso3 = 0, iso2 = 0, usps = 0, cName = 0, sName = 0, zip = 0, county = 0, cityHits = 0;
    // A country in ANY form (ISO-3, ISO-2, a name in 27 languages, an alias) — the union
    // the three per-form counters cannot see between them. See the mixed-form note below.
    let anyCountry = 0;
    // 4-digit values, held aside: a ZIP whose leading zero integer storage ate, or just a year.
    let zip4 = 0;
    let iso2AndUsps = 0;      // values valid as BOTH an ISO-2 and a USPS code
    let cNameAndSName = 0;    // values matching BOTH a country and a US-state name
    let stateBoth = 0;        // values valid as BOTH a USPS code and a state name/abbrev
    // A column named zip/postal whose values Power BI coerced to a NUMBER lost its
    // leading zero(s): a whole New-England/NJ/PR (0xxxx) column becomes bare 3-4 digit
    // integers. Count those as ZIPs ONLY under a zip name token, so the column still
    // resolves as us-zip5 instead of failing detection outright (toGeoIso then pads
    // them back). Gated by the token so a generic small-integer column never misfires.
    const zipHint = hasAnyToken(columnName, ZIP_NAME_TOKENS);
    for (let i = 0; i < total; ++i) {
        const u = upper[i];
        const nm = names[i];
        const raw = distinct[i];
        const isIso2 = ISO2_SET.has(u);
        const isUsps = USPS_SET.has(u);
        if (ISO3_SET.has(u)) iso3++;
        if (isIso2) iso2++;
        if (isUsps) usps++;
        if (isIso2 && isUsps) iso2AndUsps++;
        const isCName = cnMap.has(nm);
        const isSName = STATE_NAME_TO_USPS.has(nm);
        if (isCName) cName++;
        if (isSName) sName++;
        if (isCName && isSName) cNameAndSName++;
        if (countryIso3(raw)) anyCountry++;
        if (isUsps && isSName) stateBoth++;
        if (/^\d{5}(-\d{4})?$/.test(raw) || (zipHint && /^\d{3,4}$/.test(raw))) zip++;
        // A bare 4-digit value is a ZIP whose LEADING ZERO integer storage ate - 02108
        // becomes 2108, which happens to every New England ZIP the moment the column is
        // typed as a number. Held aside and redeemed below ONLY beside genuine 5-digit
        // ZIPs, because a column of nothing but 4-digit numbers is years or counts.
        else if (/^\d{4}$/.test(raw)) zip4++;
        if (/^\d{5}$/.test(raw) && STATE_FIPS_SET.has(raw.slice(0, 2))) county++;
        if (isKnownCity(nm)) cityHits++;
    }

    // Redeem stripped-leading-zero ZIPs only in the company of real ones.
    if (!zipHint && zip > 0) zip += zip4;

    const pct = (n: number) => (n / total) * 100;
    const cands: Candidate[] = [];
    const add = (kind: GeoKind, matched: number, spec: number, guardNameKind = false) => {
        const p = pct(matched);
        // city-name is open free text and takes the looser bar; every other kind is a
        // closed vocabulary held to ROLE_MATCH_PCT. See CITY_ROLE_MATCH_PCT.
        const bar = kind === "city-name" ? CITY_ROLE_MATCH_PCT : THRESHOLD_PCT;
        if (p < bar || matched < 2) return;
        if (guardNameKind && matched < NAME_KIND_MIN_DISTINCT) {
            const tokens = kind === "country-name" ? COUNTRY_NAME_TOKENS
                : kind === "city-name" ? CITY_NAME_TOKENS
                : STATE_NAME_TOKENS;
            if (!hasAnyToken(columnName, tokens)) return; // likely a person/place roster
        }
        cands.push({ kind, matched, spec, pct: p });
    };
    // spec = specificity rank for tie-breaking (higher = more certain / less
    // collision-prone). ISO-3 and full names beat 2-letter codes and numerics.
    add("country-iso3", iso3, 6);
    add("country-name", cName, 5, true);
    add("us-state-name", sName, 5, true);
    add("us-zip5", zip, 4);
    add("us-county-fips", county, 4);
    add("country-iso2", iso2, 3);
    add("us-state-code", usps, 3);
    // CITY sits at the BOTTOM of the specificity order on purpose. Several city names are
    // also state or country names ("New York", "Washington", "Mexico", "Quebec"), and a
    // column of those is far likelier to be the region than the city — so any region kind
    // that clears threshold outranks city. Guarded like the other dictionary kinds: a short
    // roster of proper nouns needs a city-ish column name before it reads as cities.
    add("city-name", cityHits, 2, true);
    // A column that MIXES USPS codes with state names/abbreviations ("TX", "California",
    // "Fla.") splits between us-state-code and us-state-name, so neither kind alone clears
    // threshold. They are the SAME concept (a state) and toGeoIso resolves either form for
    // either kind, so score the UNION as one us-state candidate — but only when the column
    // genuinely mixes both forms (a pure-code column keeps its us-state-code candidate so
    // the ISO-2/USPS collision handling below is untouched).
    const uspsOnly = usps - stateBoth, sNameOnly = sName - stateBoth;
    if (uspsOnly > 0 && sNameOnly > 0) add("us-state-name", usps + sName - stateBoth, 5, true);
    // COUNTRIES NEEDED THE SAME UNION and never got it. "USA", "United Kingdom", "FR" is one
    // concept written three ways — a perfectly ordinary hand-maintained column — and it split
    // across country-iso3 / country-name / country-iso2 at a third each, so NO kind cleared
    // threshold and the column detected as nothing at all. No map, no message. The state
    // version of this bug was found and fixed; the country version sat beside it because
    // three counters look like three different things.
    //
    // Only fires when the column genuinely mixes forms (the union beats every single form),
    // so a pure ISO-2 column keeps its own candidate and the ISO-2/USPS collision handling
    // below is untouched. The kind reported is the DOMINANT form, which is what the column
    // mostly is; toGeoIso resolves all three identically now, so the outliers still join.
    const domSingle = Math.max(iso3, iso2, cName);
    if (anyCountry > domSingle) {
        const dom: GeoKind = iso3 === domSingle ? "country-iso3"
            : cName === domSingle ? "country-name" : "country-iso2";
        add(dom, anyCountry, dom === "country-iso3" ? 6 : dom === "country-name" ? 5 : 3,
            dom === "country-name");
    }

    if (cands.length === 0) return null;
    cands.sort((a, b) => (b.pct - a.pct) || (b.spec - a.spec));

    const winner = cands[0];
    let ambiguous = false;

    // Resolve the three known collisions when the runner-up is the colliding
    // partner and the two are close (within 15 pts): let a decisive column name
    // pick; otherwise keep the default winner and FLAG ambiguity.
    const partnerOf: Partial<Record<GeoKind, GeoKind>> = {
        "country-iso2": "us-state-code", "us-state-code": "country-iso2",
        "us-zip5": "us-county-fips", "us-county-fips": "us-zip5",
        "country-name": "us-state-name", "us-state-name": "country-name",
    };
    const partnerKind = partnerOf[winner.kind];
    const runnerUp = cands[1];
    const collides = partnerKind && runnerUp && runnerUp.kind === partnerKind
        && Math.abs(winner.pct - runnerUp.pct) <= 15;

    if (winner.kind === "country-iso2" || winner.kind === "us-state-code") {
        // How much of the matched set is valid under BOTH interpretations.
        const overlapShare = winner.matched > 0 ? iso2AndUsps / winner.matched : 0;
        const countryHint = hasAnyToken(columnName, COUNTRY_NAME_TOKENS);
        const stateHint = hasAnyToken(columnName, STATE_NAME_TOKENS);
        if (collides || overlapShare >= 0.5) {
            if (countryHint && !stateHint) return finalize("country-iso2", iso2, false);
            if (stateHint && !countryHint) return finalize("us-state-code", usps, false);
            ambiguous = true; // undecidable from this column alone
        }
    } else if (winner.kind === "us-zip5" || winner.kind === "us-county-fips") {
        // Numeric 5-digit: ZIP and county-FIPS share the pattern. If any value's
        // prefix is not a valid state FIPS, it CAN'T be county → ZIP wins clean.
        const allCountyPlausible = county === zip && zip === total;
        const zipHint = hasAnyToken(columnName, ZIP_NAME_TOKENS);
        const countyHint = hasAnyToken(columnName, COUNTY_NAME_TOKENS);
        if (countyHint && !zipHint) return finalize("us-county-fips", county, false);
        if (zipHint && !countyHint) return finalize("us-zip5", zip, false);
        // No decisive name: default to ZIP (far more common in BI data); flag
        // ambiguous only when every value is ALSO a plausible county code.
        if (allCountyPlausible) return finalize("us-zip5", zip, true);
        return finalize("us-zip5", zip, false);
    } else if (collides && (winner.kind === "country-name" || winner.kind === "us-state-name")) {
        const overlapShare = winner.matched > 0 ? cNameAndSName / winner.matched : 0;
        const countryHint = hasAnyToken(columnName, COUNTRY_NAME_TOKENS);
        const stateHint = hasAnyToken(columnName, STATE_NAME_TOKENS);
        if (countryHint && !stateHint) return finalize("country-name", cName, false);
        if (stateHint && !countryHint) return finalize("us-state-name", sName, false);
        if (overlapShare >= 0.5) ambiguous = true;
    }

    return finalize(winner.kind, winner.matched, ambiguous);

    function finalize(kind: GeoKind, matched: number, amb: boolean): GeoDetectionResult {
        const r: GeoDetectionResult = { geoKind: kind, geoMatchPct: Math.round(pct(matched) * 10) / 10 };
        if (amb) r.geoAmbiguous = true;
        return r;
    }
}

// ── __geoIso__ normalization (Phase 1 §3a foundation) ────────────────────────
// Deterministic value → NORMAL FORM for a known geoKind. This is the join key the
// generated chart uses (Plotly locations / D3 path bind); the LLM never builds a
// name→code mapping in code — the client precomputes it here (single source, shared
// by the visual's __geoIso__ builder and the MCP). Normal forms:
//   country-*        → ISO 3166-1 alpha-3
//   us-state-*       → USPS 2-letter
//   us-zip5          → 5-digit ZIP (─4 extension stripped)
//   us-county-fips   → 5-digit FIPS
// Returns null when the value doesn't resolve → the caller null-fills __geoIso__ and
// counts it as unmatched (the classic silent-drop failure, handled deterministically).
export function toGeoIso(value: string | null | undefined, geoKind: GeoKind): string | null {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (raw.length === 0) return null;
    switch (geoKind) {
        // ONE COUNTRY READER for all three country kinds, exactly as us-state-code and
        // us-state-name already share one and for the identical reason stated below them:
        // the KIND describes what the column mostly is, not what every cell is. These three
        // branches each accepted one form and nulled the others, so a country column with a
        // stray "UK" beside its ISO-3 codes, or a stray "DEU" beside its names, dropped that
        // region off the map and counted it unmatched — with the tolerant resolver
        // (countryIso3: ISO-3, then ISO-2, then names in 27 languages, then the alias
        // overlay) sitting right there, already used by the POINT cascade over the very same
        // values. That is the same drift the ZIP reader had: two matchers, one column, two
        // answers. Detection still picks the kind; resolution no longer punishes the outliers.
        case "country-iso3":
        case "country-iso2":
        case "country-name":
            return countryIso3(raw);
        case "us-state-code":
        case "us-state-name": {
            // Tolerant regardless of the detected kind: try USPS code first, then the
            // name/common-abbreviation map ("California", "Calif.", "N.Y."). So a code
            // column with a stray "Calif." — or a name column with a stray "CA" — both
            // resolve rather than dropping to unmatched.
            const u = normalizeCode(raw);
            if (USPS_SET.has(u)) return u;
            return STATE_NAME_TO_USPS.get(normalizeName(raw)) ?? null;
        }
        case "us-zip5": {
            // ONE reader, shared with the point cascade (geoPoint.normalizeZip5). These two
            // had drifted: this branch padded stripped leading zeros but not a float round
            // trip, so "60614.0" resolved on a point map and came back unmatched on a
            // choropleth over the very same column.
            return normalizeZip5(raw);
        }
        case "us-county-fips": {
            return /^\d{5}$/.test(raw) && STATE_FIPS_SET.has(raw.slice(0, 2)) ? raw : null;
        }
        // "city-name" deliberately falls through: no bundled geometry is keyed by city,
        // so it is NOT a join kind — it feeds the geoPoint COORDINATE cascade instead.
        // Callers building a join column must gate on isJoinGeoKind first; asking this
        // function to join on city-name would null every row (a silent blank map).
        default:
            return null;
    }
}

/** True for kinds that resolve to a polygon join key (__geoIso__ against feature.id).
 *  "city-name" is a GeoKind but NOT a join kind — it marks a column the geoPoint
 *  cascade can turn into a coordinate. Building a join column from a non-join kind
 *  produces an all-null __geoIso__ = a blank choropleth with no error. */
export function isJoinGeoKind(kind: string | null | undefined): boolean {
    switch (kind) {
        case "country-iso3":
        case "country-iso2":
        case "country-name":
        case "us-state-code":
        case "us-state-name":
        case "us-zip5":
        case "us-county-fips":
            return true;
        default:
            return false;
    }
}

export type GeoIsoColumn = {
    // Per-row normal form, aligned 1:1 with the input values; null where a value
    // didn't resolve (→ the synthetic __geoIso__ cell is null / not drawn).
    iso: (string | null)[];
    // Distinct raw values that failed to resolve — feeds options.geoUnmatched so
    // the chart can annotate "N regions unmatched" instead of silently dropping.
    unmatched: string[];
    // Convenience counts for the annotation + gate.
    matchedRows: number;
    totalRows: number;
};

/**
 * Build the aligned __geoIso__ column for a full column of values under a known
 * geoKind. Pure — the visual appends `iso` beside __rowIdx__ and surfaces
 * `unmatched` via options.geoUnmatched (Phase 1 §3a).
 */
export function buildGeoIsoColumn(values: (string | null | undefined)[], geoKind: GeoKind): GeoIsoColumn {
    const iso: (string | null)[] = new Array(values.length);
    const unmatchedSeen = new Set<string>();
    const unmatched: string[] = [];
    let matchedRows = 0;
    for (let i = 0; i < values.length; ++i) {
        const norm = toGeoIso(values[i], geoKind);
        iso[i] = norm;
        if (norm !== null) {
            matchedRows++;
        } else {
            const v = values[i];
            if (v !== null && v !== undefined) {
                const s = String(v).trim();
                if (s.length > 0) {
                    const key = s.toLowerCase();
                    if (!unmatchedSeen.has(key)) { unmatchedSeen.add(key); unmatched.push(s); }
                }
            }
        }
    }
    return { iso, unmatched, matchedRows, totalRows: values.length };
}
