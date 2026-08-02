// ──────────────────────────────────────────────────────────────────────────
// POINT GEOCODING — resolve a lat/lon for a row that has no coordinates
// ──────────────────────────────────────────────────────────────────────────
//
// Genesis (2026-07-25): "add city names to lat/long mappings ... allow someone to
// drop in ONLY city NAMES (no need for lat/long)", then the cascade:
//     City+State -> Lat/Long  OR  Zip5 or Zip3 -> Lat/Long  OR  Just State -> Lat/Long
// and "when I say 'state' - include non-US provinces."
//
// Sibling of geoDetector.ts, deliberately separate:
//   geoDetector  answers "what REGION is this value?" -> a polygon join key (__geoIso__),
//                strictly SINGLE-column.
//   geoPoint     answers "WHERE is this row?"         -> a coordinate  (__geoLat__/__geoLon__),
//                inherently CROSS-column (City needs State to disambiguate).
// Keeping them apart means the choropleth join path is untouched by any of this.
//
// PRECISION is part of the contract, not an afterthought. Each tier resolves to a
// genuinely different scale, and callers must be able to say so rather than implying
// a street address:
//   "latlon" real coordinates from the data           (exact)
//   "city"   the city's point                         (~city scale)
//   "zip3"   centroid of the 3-digit ZIP prefix       (~metro/sub-state; ZIP-5 reduces
//            to its prefix — the honest limit of the geometry we bundle)
//   "state"  population-weighted centroid of the state/province (very coarse; every row
//            in a state lands on ONE point)
//   "country" population-weighted centroid of the country (coarsest; every row in a
//            country lands on ONE point — the tier a WORLD point map leans on when the
//            data names nations rather than places inside them)
//
// AMBIGUITY is reported, never hidden. 9% of North American city names collide (8
// Springfields, 6 Burlingtons). With a state column they disambiguate exactly; without
// one, the largest city wins the name and `ambiguous` counts it, so the chart can
// annotate instead of silently asserting a location.
//
// Data: geoPointTables.generated.ts (GeoNames CC BY 4.0 — attribution ships in the EULA;
// ZIP-3 + admin1 centroids derive from geometry the visual already bundles).

import { CITY_PACKED, ADMIN1_PACKED, ZIP3_PACKED, COUNTRY_PACKED } from "./geoPointTables.generated";
import { countryIso3, iso2ToIso3 } from "./geoCountryNames";

export type GeoPointPrecision = "latlon" | "city" | "zip3" | "state" | "country";

export type GeoPointResult = {
    lat: number;
    lon: number;
    precision: GeoPointPrecision;
    /** NO LONGER PRODUCED (v2 matching, 2026-08-02): an ambiguous name is refused and
     *  reported (see GeoPointAmbiguity), never placed by a tie-break. The field stays so
     *  older compiled consumers reading it keep type-checking; it is always absent. */
    ambiguous?: boolean;
};

// ── Normalizer ── re-exported, defined once in geoCountryNames (see the note there:
// the packed tables are keyed by normalized names, so a second copy that disagrees by
// one character misses every lookup silently). Kept on geoPoint's public surface
// because callers have always imported it from here.
export { normalizePlaceName } from "./geoCountryNames";
import { normalizePlaceName } from "./geoCountryNames";

/** Which point-map's candidate set a lookup runs against. Rows carry kind flags
 *  (N = North America map, W = World map; a row may carry both), so ONE table serves
 *  every map type with the map deciding its own scope — Joel 2026-08-02: "one row can
 *  apply to 1 or more map types", and the matching rules are COMMON logic. */
export type GeoMapKind = "north-america" | "world";
const KIND_FLAG: Record<GeoMapKind, string> = { "north-america": "N", world: "W" };

type CityRow = { a1: string; cc: string; lon: number; lat: number; pop: number; kinds: string };
type Admin1Row = { key: string; cc: string; name: string; lon: number; lat: number };

// Lazily parsed once (the monthNames.ts / countryNameMap pattern) — the packed
// strings are module constants, so parsing is deferred until something geocodes.
// v2 record: name|a1|cc|lon|lat|popK|kinds|alt1;alt2 — ALT keys (Latin-script exonyms
// like "Munich"/"Londres" that diacritic folding cannot reach) index onto the SAME row,
// so a variant is just another door to one place, never a second place.
let _cities: Map<string, CityRow[]> | null = null;
function cityIndex(): Map<string, CityRow[]> {
    if (_cities) return _cities;
    const m = new Map<string, CityRow[]>();
    const add = (key: string, row: CityRow) => {
        if (!key) return;
        const cur = m.get(key);
        if (cur) { if (!cur.includes(row)) cur.push(row); } else m.set(key, [row]);
    };
    for (const rec of CITY_PACKED.split(",")) {
        const p = rec.split("|");
        if (p.length < 7) continue;
        const row: CityRow = { a1: p[1], cc: p[2], lon: +p[3], lat: +p[4], pop: +p[5], kinds: p[6] || "N" };
        add(normalizePlaceName(p[0]), row);
        if (p.length > 7 && p[7]) for (const alt of p[7].split(";")) add(normalizePlaceName(alt), row);
    }
    // Population order is kept ONLY for stable diagnostics — it is NO LONGER a tie-break.
    // Since v2 (Joel 2026-08-02) an ambiguous name is REFUSED and reported, never guessed.
    for (const rows of m.values()) rows.sort((a, b) => b.pop - a.pop);
    _cities = m;
    return m;
}

// "<X> City" written as bare "<X>". Nobody types "New York City" or "Mexico City" in a
// city column — they type "New York" and "Mexico" — and the bare form is in NO gazetteer,
// so the row fell straight through to the STATE tier and landed on a state centroid. NYC
// was ~25 km off (the NY centroid sits near the city that dominates its population), which
// is precisely why it never looked broken: silently wrong, geographically plausible.
//
// A blanket "retry with ' city' appended" is NOT safe — it is actively worse than the
// status quo for bare STATE names, which also collide with small "* City" towns:
//   "Missouri" -> Missouri City, TX (pop 74k)   "Texas" -> Texas City, TX (47k)
//   "Iowa"     -> Iowa City, IA     (74k)       "Oregon" -> Oregon City, OR (35k)
// The discriminator is POPULATION, and it separates the two sets cleanly with nothing in
// between: every correct shorthand is >= 200k (Mexico 12.3M, New York 8.8M, Oklahoma 681k,
// Kansas 475k, Jersey 264k, Salt Lake 215k) and every harmful one is <= 136k. So the rule
// is stated as what it actually is — a bare name is shorthand for "<X> City" only when
// that city is big enough that the shorthand is what people mean.
//
// The alias rows go through the IDENTICAL narrowing/disambiguation path as a direct hit,
// so a contradicting state still refuses it ("New York, CA" does not become NYC).
const CITY_SUFFIX_ALIAS_MIN_POP = 200;   // thousands, matching the packed table's units

let _cityAlias: Map<string, CityRow[]> | null = null;
function cityAliasIndex(): Map<string, CityRow[]> {
    if (_cityAlias) return _cityAlias;
    const m = new Map<string, CityRow[]>();
    for (const [key, rows] of cityIndex()) {
        if (!key.endsWith(" city")) continue;
        const bare = key.slice(0, -5);
        // A bare form that is ALREADY a city name of its own keeps that meaning.
        if (!bare || cityIndex().has(bare)) continue;
        if (rows[0].pop < CITY_SUFFIX_ALIAS_MIN_POP) continue;   // rows are pop-descending
        m.set(bare, rows);
    }
    _cityAlias = m;
    return m;
}

/** Candidate city rows for an already-normalized name: the direct gazetteer hit, else the
 *  "<name> City" shorthand when that city is dominant enough to be what was meant. */
function cityRowsFor(key: string): CityRow[] | undefined {
    if (!key) return undefined;
    return cityIndex().get(key) ?? cityAliasIndex().get(key);
}

// COUNTRY centroids, ISO-3 keyed. Coarsest tier of the cascade and the one a WORLD point
// map leans on: data that names nations has nothing finer to resolve. Population-weighted
// for the same reason ADMIN1 is, and it matters more at this scale — a landmass centre
// puts Russia in empty Siberia and Canada in Nunavut. (The generator additionally SNAPS to
// the largest city whenever the weighted mean falls outside the country's own polygons,
// which is what keeps Indonesia out of the Java Sea and Canada out of Michigan.)
let _countries: Map<string, { lon: number; lat: number }> | null = null;
function countryIndex(): Map<string, { lon: number; lat: number }> {
    if (_countries) return _countries;
    const m = new Map<string, { lon: number; lat: number }>();
    for (const rec of COUNTRY_PACKED.split(",")) {
        const p = rec.split("|");
        if (p.length < 3) continue;
        m.set(p[0], { lon: +p[1], lat: +p[2] });
    }
    _countries = m;
    return m;
}

let _admins: Map<string, Admin1Row> | null = null;   // BOTH code and name -> row
function adminIndex(): Map<string, Admin1Row> {
    if (_admins) return _admins;
    const m = new Map<string, Admin1Row>();
    for (const rec of ADMIN1_PACKED.split(",")) {
        const p = rec.split("|");
        if (p.length < 5) continue;
        const row: Admin1Row = { key: p[0], cc: p[1], name: p[2], lon: +p[3], lat: +p[4] };
        // Users type either form: "ON" or "Ontario", "TX" or "Texas", "Jalisco".
        m.set(normalizePlaceName(row.key), row);
        const nk = normalizePlaceName(row.name);
        if (nk === "mexico" && row.cc === "MX") {
            // The one state whose name IS a country name in our scope. A "state" column
            // that actually holds COUNTRIES would otherwise resolve "Mexico" to the State
            // of México — contradicting every city in the rest of the country, knocking
            // those rows down to the state tier, and degrading the whole map's reported
            // precision. The state stays reachable by its code and unambiguous long forms;
            // bare "Mexico" now reads as "not an admin1", so city rows resolve cleanly.
            m.set("estado de mexico", row);
            m.set("edomex", row);
        } else {
            m.set(nk, row);
        }
    }
    _admins = m;
    return m;
}

let _zip3: Map<string, { lon: number; lat: number }> | null = null;
function zip3Index(): Map<string, { lon: number; lat: number }> {
    if (_zip3) return _zip3;
    const m = new Map<string, { lon: number; lat: number }>();
    for (const rec of ZIP3_PACKED.split(",")) {
        const p = rec.split("|");
        if (p.length < 3) continue;
        m.set(p[0], { lon: +p[1], lat: +p[2] });
    }
    _zip3 = m;
    return m;
}

/** Resolve a state/province token ("TX", "Texas", "ON", "Ontario", "Jalisco") to its
 *  canonical admin1 key. Null when unrecognized. */
export function resolveAdmin1(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const k = normalizePlaceName(String(value));
    if (!k) return null;
    return adminIndex().get(k)?.key ?? null;
}

// Country identifiers -> the 2-letter code the tables are keyed by. Scope is US/CA/MX
// because that is what the CITY/ADMIN1 tables cover; anything else resolves to null and
// the country tier simply does not engage, which is the correct no-op.
//
// NOTE the asymmetry this exists to survive: "CA" is BOTH Canada and California, and it
// is the only such collision across every identifier here. Country is therefore never
// inferred from a lone value — it must arrive in the COUNTRY role, and geoPointRoles
// refuses to let a country column occupy the state role in the first place.
const COUNTRY_CODE_BY_NAME: Record<string, string> = {
    "us": "US", "usa": "US", "u s": "US", "u s a": "US", "america": "US",
    "united states": "US", "united states of america": "US",
    "ca": "CA", "can": "CA", "canada": "CA",
    "mx": "MX", "mex": "MX", "mexico": "MX", "estados unidos mexicanos": "MX",
};

/** "Canada"/"CAN"/"CA" -> "CA". Null when it is not a country this data covers. */
export function normalizeCountry(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const k = normalizePlaceName(String(value));
    if (!k) return null;
    return COUNTRY_CODE_BY_NAME[k] ?? null;
}

/** Which country an admin1 key belongs to ("ON" -> "CA", "TX" -> "US"). The CITY table
 *  stores only the admin1, so this is how a city row's country is recovered without
 *  adding a byte to the bundled tables. */
function countryOfAdmin1(a1: string): string | null {
    return adminIndex().get(normalizePlaceName(a1))?.cc ?? null;
}

/** The same answer as ISO-3, so it can be compared against a WORLD country identifier.
 *  The ADMIN1 table stores 2-letter codes (its scope is US/CA/MX); the cascade compares
 *  in ISO-3 now that a row's country may be any nation on earth. */
function admin1Iso3(a1: string): string | null {
    const cc = countryOfAdmin1(a1);
    return cc ? iso2ToIso3(cc) : null;
}

/**
 * Normalize a ZIP to its 3-digit prefix.
 *
 *   5 digits (or ZIP+4)  -> first 3.
 *   4 digits             -> Excel/Power BI ate ONE leading zero ("1001" -> "01001" -> "010").
 *   3 digits             -> ALREADY a prefix ("331" = Miami, "606" = Chicago).
 *
 * The 3-digit case is genuinely ambiguous — it could also be a 5-digit ZIP that lost TWO
 * leading zeros — and reading it as zero-stripped is actively wrong: only 006-009 exist as
 * "00x" prefixes (all Puerto Rico / USVI), so "606" would land Chicago data in Puerto Rico.
 * A literal 3-digit value in a data column is overwhelmingly a prefix (it is exactly what
 * our own ZIP-3 choropleth joins on), so the direct reading wins. `zipPrefixCandidates`
 * keeps the zero-stripped reading as a documented fallback for the rare 00xxx originals.
 */
export function zipToPrefix3(value: string | null | undefined): string | null {
    return zipPrefixCandidates(value)[0] ?? null;
}

/** Ordered prefix interpretations, most likely first. Callers with the lookup table
 *  available should try each and take the first that exists. */
export function zipPrefixCandidates(value: string | null | undefined): string[] {
    if (value === null || value === undefined) return [];
    // "60614.0" — a ZIP that took a round trip through a float (CSV export, a DAX
    // FORMAT, etc.). A real ZIP never contains a dot, so stripping ".0…" is safe and
    // recovers the value instead of dropping the row to a coarser tier.
    const raw = String(value).trim().replace(/\.0+$/, "");
    if (!raw) return [];
    const m = /^(\d{5})(-\d{4})?$/.exec(raw);
    if (m) return [m[1].slice(0, 3)];
    if (/^\d{4}$/.test(raw)) return [raw.padStart(5, "0").slice(0, 3)];
    if (/^\d{3}$/.test(raw)) {
        const stripped = raw.padStart(5, "0").slice(0, 3);   // the 00xxx reading
        return stripped === raw ? [raw] : [raw, stripped];
    }
    return [];
}

/**
 * The cascade, most precise tier first. Every argument is optional — pass whatever the
 * row actually has and the best available tier wins.
 *
 * Order is deliberate: an explicit coordinate always beats a lookup; a city beats a ZIP
 * prefix (a city is a point, a ZIP-3 is a region); a ZIP prefix beats a whole state.
 */
/** The city tier found MORE THAN ONE place the source row could mean, after every
 *  non-blank source attribute was honoured. The row is NOT plotted and the caller
 *  reports it as info — since v2 (Joel 2026-08-02) a guess is never made: "if multiple
 *  possible matches are found, that should be a call-out … and it should not be
 *  plotted." Distinct from `null` (nothing matched at all): coarser tiers must NOT
 *  rescue an ambiguity, because the coarser placement would silently pick a side. */
export type GeoPointAmbiguity = { ambiguous: true; matches: number };

export function isGeoPointAmbiguity(r: GeoPointResult | GeoPointAmbiguity | null | undefined): r is GeoPointAmbiguity {
    return !!r && (r as any).ambiguous === true && !("precision" in (r as any));
}

export function resolveGeoPoint(args: {
    lat?: number | string | null;
    lon?: number | string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    /** COUNTRY: a matching constraint like state, and — since the country tier — also a
     *  placement of last resort. Absent = unconstrained. */
    country?: string | null;
    /** Which map's candidate rows the CITY tier may use (default "north-america", which
     *  is byte-identical to the pre-v2 candidate set). The WORLD map passes "world". */
    mapKind?: GeoMapKind | null;
}): GeoPointResult | GeoPointAmbiguity | null {
    // 1. Explicit coordinates — trust the data over any table. TRIMMED first: a
    // whitespace-only string is "no value", but `+" "` coerces to 0, and an untrimmed
    // check would fabricate a point at (0,0) — the null-as-zero trap wearing a
    // coordinate costume. Blank/junk coords fall through to the name tiers instead.
    //
    // EXACT (0,0) is the one coordinate we don't take at face value when the row also
    // carries place NAMES: "missing = 0" is a common storage convention, and Null
    // Island contradicting a resolvable city/ZIP/state is overwhelmingly that
    // convention, not a data point in the Gulf of Guinea. Bare (0,0) with nothing
    // else to go on is still honored — rejecting it outright would fabricate a MISS.
    let zeroZero: GeoPointResult | null = null;
    const la0 = typeof args.lat === "string" ? args.lat.trim() : args.lat;
    const lo0 = typeof args.lon === "string" ? args.lon.trim() : args.lon;
    if (la0 !== undefined && la0 !== null && la0 !== ""
        && lo0 !== undefined && lo0 !== null && lo0 !== "") {
        const la = +la0, lo = +lo0;
        if (isFinite(la) && isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180) {
            if (la === 0 && lo === 0) zeroZero = { lat: 0, lon: 0, precision: "latlon" };
            else return { lat: la, lon: lo, precision: "latlon" };
        }
    }

    // WORLD-wide country resolution (ISO-3). Was US/CA/MX-only, because until the World
    // point map the country could only ever NARROW a city match — an unrecognized country
    // was a correct no-op. Now it can also PLACE a row, so it has to know every country.
    //
    // The widening changes one pre-existing behaviour, and the change is the fix: "Paris,
    // France" used to narrow nothing (FRA unrecognized) and matched Paris, ONTARIO at city
    // precision. It now narrows to zero NA candidates, falls through, and lands on the
    // France centroid at country precision — coarser, and *right*, with the tier saying so.
    const iso3 = countryIso3(args.country);
    let a1 = resolveAdmin1(args.state);
    // A state belonging to a DIFFERENT country than the row claims is not a state we can
    // trust. The common cause is a country value sitting in the state slot: "CA" resolves
    // to California, so a Canadian row would otherwise be dragged into the US. Dropping
    // the state here leaves the country narrowing below to do the work.
    if (a1 && iso3 && admin1Iso3(a1) !== iso3) a1 = null;

    // 2. City — the v2 COMMON matching rules (Joel 2026-08-02), identical for every
    //    point-map type; only the candidate SCOPE differs (row kind flags):
    //      • every NON-BLANK source attribute must match the SAME value or a BLANK in
    //        the lookup row — a blank lookup attribute passes, a contradicting one
    //        EXCLUDES the row;
    //      • among the survivors, rows matching MORE source attributes EXPLICITLY win
    //        ("match as many properties as you can");
    //      • more than one survivor at distinct coordinates = AMBIGUOUS: the row is NOT
    //        plotted and is reported as info. Population is no longer a tie-break, and
    //        an ambiguity is TERMINAL — a coarser tier "rescue" would silently pick a
    //        side of the very question the refusal exists to surface.
    if (args.city !== undefined && args.city !== null) {
        const key = normalizePlaceName(String(args.city));
        const scope = KIND_FLAG[(args.mapKind as GeoMapKind) || "north-america"] ?? "N";
        const all = cityRowsFor(key);
        if (all) {
            const stateRaw = args.state === undefined || args.state === null ? "" : String(args.state).trim();
            const stateKey = stateRaw ? normalizePlaceName(stateRaw) : "";
            const stateCode = stateRaw ? resolveAdmin1(stateRaw) : null;   // "Texas"/"Ontario" → code
            let best: CityRow[] = [];
            let bestRank = -1;
            for (const r of all) {
                if (!r.kinds.includes(scope)) continue;
                let rank = 0;
                if (stateRaw) {
                    if (r.a1 === "") { /* blank lookup attribute passes, not explicit */ }
                    else if ((stateCode && r.a1 === stateCode) || normalizePlaceName(r.a1) === stateKey) rank++;
                    else continue;                                   // non-blank vs non-blank mismatch
                }
                if (iso3) {
                    // Lookup rows always carry a country, so this constraint is match-or-exclude.
                    if (iso2ToIso3(r.cc) === iso3) rank++;
                    else continue;
                }
                if (rank > bestRank) { bestRank = rank; best = [r]; }
                else if (rank === bestRank) best.push(r);
            }
            // Two doors onto one place (a primary name and an exonym, or duplicate source
            // rows) are ONE match — dedupe by coordinate before judging ambiguity.
            const distinct = new Map<string, CityRow>();
            for (const r of best) distinct.set(r.lon.toFixed(2) + "," + r.lat.toFixed(2), r);
            if (distinct.size === 1) {
                const r = best[0];
                return { lat: r.lat, lon: r.lon, precision: "city" };
            }
            if (distinct.size > 1) return { ambiguous: true, matches: distinct.size };
            // zero candidates in scope → fall through to the coarser tiers
        }
    }

    // 3. ZIP-5 / ZIP-3 -> the 3-digit prefix centroid. Try each interpretation in
    //    likelihood order so a 3-digit value that ISN'T a real prefix can still fall
    //    back to the zero-stripped reading.
    for (const z3 of zipPrefixCandidates(args.zip)) {
        const hit = zip3Index().get(z3);
        if (hit) return { lat: hit.lat, lon: hit.lon, precision: "zip3" };
    }

    // 4. State / province alone — population-weighted centroid.
    if (a1) {
        const row = adminIndex().get(normalizePlaceName(a1));
        if (row) return { lat: row.lat, lon: row.lon, precision: "state" };
    }

    // 5. COUNTRY alone — the coarsest honest answer. Every row in a country lands on ONE
    //    point, which is why the tier is reported: a world map of 40 countries is 40 dots
    //    that mean "somewhere in here", not 40 places. Reached either because the data only
    //    ever named countries, or because a finer tier CONTRADICTED the country and was
    //    dropped above — in both cases this is the most precise claim the data supports.
    if (iso3) {
        const row = countryIndex().get(iso3);
        if (row) return { lat: row.lat, lon: row.lon, precision: "country" };
    }

    // No name tier resolved — a literal (0,0) is all the row claims, so report it.
    return zeroZero;
}

export type GeoPointColumns = {
    /** Per-row coordinates, aligned 1:1 with the input; null where unresolved. */
    lat: (number | null)[];
    lon: (number | null)[];
    /** COARSEST precision actually used, so the caller can annotate honestly. */
    precision: GeoPointPrecision | null;
    /** HOW MANY rows landed on each tier. The scalar above is a WORST CASE and says
     *  nothing about how much of the map it describes: one state-centroid row among 41
     *  city rows reports identically to an all-state map, so a caption written off the
     *  scalar alone ("approximated to state centres") is FALSE for 41 of the 42 rows.
     *  Count what is actually there, so the annotation can be specific — or stay silent
     *  when the coarse tail is a rounding error. */
    precisionCounts: Record<GeoPointPrecision, number>;
    /** Distinct inputs that landed COARSER than a city point — exactly the rows a
     *  state/ZIP-centroid caption is about, and the ones a diagnostic should name.
     *  Capped; `precisionCounts` carries the true totals. */
    coarseExamples: string[];
    /** Distinct inputs that resolved to nothing (feeds the off-map annotation). */
    unmatched: string[];
    /** Rows whose name matched MORE THAN ONE place after every non-blank source
     *  attribute was honoured. NOT PLOTTED (null coordinates), by rule — v2 matching
     *  (2026-08-02) refuses instead of guessing; before that this counted rows placed by
     *  a largest-city tie-break, which is the behaviour the rule replaced. */
    ambiguousRows: number;
    /** Distinct inputs behind ambiguousRows — the info call-out a chart shows so the
     *  user can add the disambiguating column (a state, a country). Capped. */
    ambiguousExamples: string[];
    matchedRows: number;
    totalRows: number;
};

const PRECISION_RANK: Record<GeoPointPrecision, number> = { latlon: 0, city: 1, zip3: 2, state: 3, country: 4 };

/** Enough to name the offenders in a caption or a log line without unbounded growth. */
const COARSE_EXAMPLE_CAP = 8;

/**
 * Build aligned __geoLat__ / __geoLon__ columns for a full table. Pure.
 *
 * `precision` reports the COARSEST tier any row needed, because that is what bounds
 * what the chart may claim: one state-centroid row among a thousand city rows still
 * means the map is not uniformly city-accurate. It is a CEILING, not a description —
 * `precisionCounts` says how many rows each tier actually covers, and anything written
 * for the user should be built from the counts.
 */
export function buildGeoPointColumns(
    rows: Array<{ lat?: any; lon?: any; city?: any; state?: any; zip?: any; country?: any }>,
    mapKind?: GeoMapKind | null,
): GeoPointColumns {
    const lat: (number | null)[] = new Array(rows.length);
    const lon: (number | null)[] = new Array(rows.length);
    const unmatchedSeen = new Set<string>();
    const unmatched: string[] = [];
    const coarseSeen = new Set<string>();
    const coarseExamples: string[] = [];
    const ambiguousSeen = new Set<string>();
    const ambiguousExamples: string[] = [];
    const precisionCounts: Record<GeoPointPrecision, number> =
        { latlon: 0, city: 0, zip3: 0, state: 0, country: 0 };
    let matchedRows = 0, ambiguousRows = 0;
    let coarsest: GeoPointPrecision | null = null;

    for (let i = 0; i < rows.length; ++i) {
        const r = rows[i];
        const hit = resolveGeoPoint({ ...r, mapKind });
        if (isGeoPointAmbiguity(hit)) {
            // v2 rule: multiple possible matches → NOT plotted, reported as info. Null
            // coordinates on purpose — that is also what keeps OLDER generated chart code
            // honest on a newer host: it counts null-coord rows into its existing off-map
            // annotation, so an ambiguous row reads as "not shown" there too, just without
            // the richer why. Deliberately NOT folded into `unmatched`: "we found nothing"
            // and "we found several" call for different user action.
            lat[i] = null; lon[i] = null;
            ambiguousRows++;
            const label = describeRow(r);
            if (label && !ambiguousSeen.has(label.toLowerCase())) {
                ambiguousSeen.add(label.toLowerCase());
                if (ambiguousExamples.length < COARSE_EXAMPLE_CAP) ambiguousExamples.push(label);
            }
        } else if (hit) {
            lat[i] = hit.lat; lon[i] = hit.lon;
            matchedRows++;
            precisionCounts[hit.precision]++;
            if (coarsest === null || PRECISION_RANK[hit.precision] > PRECISION_RANK[coarsest])
                coarsest = hit.precision;
            if (PRECISION_RANK[hit.precision] > PRECISION_RANK.city) {
                const label = describeRow(r);
                if (label && !coarseSeen.has(label.toLowerCase())) {
                    coarseSeen.add(label.toLowerCase());
                    if (coarseExamples.length < COARSE_EXAMPLE_CAP) coarseExamples.push(label);
                }
            }
        } else {
            lat[i] = null; lon[i] = null;
            const label = describeRow(r);
            if (label && !unmatchedSeen.has(label.toLowerCase())) {
                unmatchedSeen.add(label.toLowerCase());
                unmatched.push(label);
            }
        }
    }
    return { lat, lon, precision: coarsest, precisionCounts, coarseExamples,
             unmatched, ambiguousRows, ambiguousExamples, matchedRows, totalRows: rows.length };
}

/** The most specific thing the row offered, so an annotation names something the user
 *  recognizes ("Nowhereville, TX" rather than "row 37"). */
function describeRow(r: { city?: any; state?: any; zip?: any; country?: any }): string {
    // COUNTRY included since the World point map: on country-only data it is the row's
    // ONLY identifier, and without it an unplaced row is counted but never named — the
    // annotation would say "3 rows could not be placed" and be unable to say which,
    // which is precisely the silent-drop behaviour the unmatched report exists to end.
    return [r.city, r.state, r.zip, r.country]
        .filter(v => v !== null && v !== undefined && String(v).trim() !== "")
        .map(v => String(v).trim())
        .join(", ");
}

/** Is this an ALREADY-NORMALIZED name (normalizePlaceName applied) of a known city?
 *  geoDetector calls this per distinct value to emit the "city-name" kind — it passes
 *  its own normalized form, so this must NOT re-normalize. */
export function isKnownCity(normalizedName: string, mapKind?: GeoMapKind | null): boolean {
    // SCOPE DEFAULTS TO NORTH AMERICA on purpose, and this default is compatibility
    // load-bearing: this predicate feeds detectGeo's "city-name" kind and the role
    // verifier, so widening its default to the world rows would silently change which
    // COLUMNS classify as cities — and with it, which charts old data shapes are offered.
    // World callers opt in with mapKind="world".
    if (!normalizedName) return false;
    const rows = cityRowsFor(normalizedName);
    if (!rows) return false;
    const flag = KIND_FLAG[(mapKind as GeoMapKind) || "north-america"] ?? "N";
    return rows.some(r => r.kinds.includes(flag));
}

/** Share of DISTINCT values that are known city names, 0..100 (one decimal). NOTE:
 *  production offerability does NOT ride on this — detectGeo's "city-name" kind is the
 *  gate (THRESHOLD_PCT 85, ≥2 matches, roster guard). This is the standalone measure
 *  for harness/MCP callers; keep its notion of "match" aligned with isKnownCity
 *  (including the NA-scope default — see the note there). */
export function cityMatchPct(values: Array<string | null | undefined>, mapKind?: GeoMapKind | null): number {
    const seen = new Set<string>();
    let matched = 0;
    for (const v of values) {
        if (v === null || v === undefined) continue;
        const k = normalizePlaceName(String(v));
        if (!k || seen.has(k)) continue;
        seen.add(k);
        if (isKnownCity(k, mapKind)) matched++;
    }
    return seen.size === 0 ? 0 : Math.round((matched / seen.size) * 1000) / 10;
}
