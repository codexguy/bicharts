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
//   "country" the country's LARGEST CITY (coarsest; every row in a country lands on ONE
//            point — the tier a WORLD point map leans on when the data names nations
//            rather than places inside them). Stated that way because it is checkable by
//            whoever reads the map; see countryIndex for why it is not a centroid.
//
// AMBIGUITY is reported, never hidden. 9% of North American city names collide (8
// Springfields, 6 Burlingtons). With a state column they disambiguate exactly; without
// one, the largest city wins the name and `ambiguous` counts it, so the chart can
// annotate instead of silently asserting a location.
//
// Data: geoPointTables.generated.ts (GeoNames CC BY 4.0 — attribution ships in the EULA;
// ZIP-3 + admin1 centroids derive from geometry the visual already bundles).

import { ADMIN1_PACKED, ZIP3_PACKED, COUNTRY_PACKED } from "./geoPointTables.generated";
// The gazetteer is a separate module purely to keep the generated files readable; it is
// a STATIC import, so it ships in every bundle. That is the point — see the note below.
import { CITY_PACKED } from "./geoPointCities.generated";
import { countryIso3, iso2ToIso3 } from "./geoCountryNames";
// ONE notion of "this cell is empty", shared with the role classifier — see matchQuality.
import { isBlankLike } from "./matchQuality";

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

type CityRow = { a1: string; cc: string; lon: number; lat: number; pop: number; kinds: string;
    /** Free-form per-city tags ("capital", ...). See CITY TAGS below. */
    tags?: string[] };
/** One door onto a city row: `primary` marks the city's own name, false marks a
 *  multilingual variant. A primary match OUTRANKS an alt match at the same attribute
 *  rank, so "Santiago" means the city actually called Santiago even though another
 *  city carries it as a translated name — real ambiguity (two cities both NAMED it)
 *  still refuses. */
type CityHit = { row: CityRow; primary: boolean };
type Admin1Row = { key: string; cc: string; name: string; lon: number; lat: number };

// Lazily parsed once (the monthNames.ts / countryNameMap pattern) — the packed
// strings are module constants, so parsing is deferred until something geocodes.
// v2 record: name|a1|cc|lon|lat|popK|kinds|alt1;alt2 — ALT keys (Latin-script exonyms
// like "Munich"/"Londres" that diacritic folding cannot reach) index onto the SAME row,
// so a variant is just another door to one place, never a second place.
// ── WHY THIS TABLE IS BUNDLED, DELIBERATELY (Joel 2026-08-02) ───────────────
// It is ~93 KB gz, by far the largest thing shape-core ships, and it was briefly SPLIT so a
// host could fetch the coordinates and bundle only a name index (0.5.5, reverted here in
// 0.5.6). The split worked — 118 KB off the .pbiviz — and was still the wrong call, for a
// reason worth writing down so nobody re-derives it from the byte count alone:
//
//   AIR-GAPPED RENDER IS A PRODUCT PROPERTY. A licensed report renders its cached chart with
//   the service unreachable, and a PINNED report is meant to be handed to someone who never
//   talks to us at all. Serving this table means a point map that resolves places by NAME
//   quietly drops to state or country centroids in exactly those sessions.
//
//   "Fetch it once and cache it" does not rescue that, and the reason is specific: the
//   custom-visual sandbox iframe has no allow-same-origin, so localStorage / IndexedDB throw
//   SecurityError (visual.ts stubs them). The only cache available is the HTTP cache, which
//   is per-machine and evictable — and the case that matters is a report AUTHORED online and
//   OPENED somewhere else, where nothing was ever cached. The chart still draws and still
//   annotates honestly; it is just coarser than the author ever saw it, silently.
//
// The ZIP-3 GEOMETRY is fetched, and that is not an inconsistency: it serves ONE chart type,
// it is 941 KB rather than 93, and losing it offline was weighed and accepted for that lane
// alone. This table serves every point map. If package size forces the question again the
// split is in git history at v0.5.5 — but the durable answer is storageV2Service (2.2 item
// 1), which would move the GEOMETRY out first and could take this with it.
//
// A host that genuinely needs a different gazetteer can still supply one: registerCityTable
// REPLACES what is bundled here.
let _cityPacked = CITY_PACKED;

/** REPLACE the bundled gazetteer with another packed table (same record format). The
 *  bundled table is the default precisely so air-gapped rendering keeps working — read the
 *  note above before reaching for this. Idempotent. */
export function registerCityTable(packed: string): void {
    if (packed === _cityPacked) return;
    _cityPacked = packed || "";
    _cities = null;
    _cityAlias = null;
    // The COUNTRY tier is now DERIVED from this table (largest city), so it is downstream of
    // this swap. Leaving it cached would answer the new gazetteer's questions with the old
    // one's cities — and silently, since both return a plausible coordinate.
    _countries = null;
}

/** True when a gazetteer is available to the city tier. Always true with the bundled table;
 *  false only if a host deliberately cleared it with registerCityTable(""). */
export function isCityTableLoaded(): boolean {
    return _cityPacked.length > 0;
}

// CAPITALS, keyed by the gazetteer's own ISO-2 country code, values pre-normalized with
// normalizePlaceName. An OVERLAY (the COUNTRY_ALIAS_OVERLAY pattern - plain data, trivial
// for an LLM to extend), applied at parse time and inert wherever the named city is not in
// the gazetteer - so a wrong or renamed entry can mistag nothing, it can only fail to tag.
// Kept to the countries whose capitals are unambiguous one-liners; seats-of-government
// subtleties are recorded where they exist rather than silently picked.
const CAPITAL_BY_CC: Record<string, string> = {
    US: "washington", CA: "ottawa", MX: "mexico city", GB: "london", FR: "paris",
    DE: "berlin", IT: "rome", ES: "madrid", PT: "lisbon", NL: "amsterdam",   // (seat: The Hague)
    BE: "brussels", CH: "bern", AT: "vienna", IE: "dublin", PL: "warsaw",
    SE: "stockholm", NO: "oslo", DK: "copenhagen", FI: "helsinki", IS: "reykjavik",
    CZ: "prague", SK: "bratislava", HU: "budapest", RO: "bucharest", BG: "sofia",
    GR: "athens", TR: "ankara", UA: "kyiv", RU: "moscow", RS: "belgrade",
    HR: "zagreb", SI: "ljubljana", EE: "tallinn", LV: "riga", LT: "vilnius",
    JP: "tokyo", CN: "beijing", KR: "seoul", KP: "pyongyang", IN: "new delhi",
    PK: "islamabad", BD: "dhaka", LK: "colombo",                              // (legislative: Sri Jayawardenepura Kotte)
    TH: "bangkok", VN: "hanoi", PH: "manila", ID: "jakarta", MY: "kuala lumpur",
    SG: "singapore", MM: "naypyidaw", KH: "phnom penh", LA: "vientiane",
    NP: "kathmandu", AF: "kabul", IR: "tehran", IQ: "baghdad", SA: "riyadh",
    AE: "abu dhabi", QA: "doha", KW: "kuwait city", BH: "manama", OM: "muscat",
    JO: "amman", LB: "beirut", SY: "damascus", IL: "jerusalem", YE: "sanaa",
    EG: "cairo", LY: "tripoli", TN: "tunis", DZ: "algiers", MA: "rabat",
    SD: "khartoum", ET: "addis ababa", KE: "nairobi", TZ: "dodoma", UG: "kampala",
    NG: "abuja", GH: "accra", CI: "yamoussoukro",                             // (de facto: Abidjan)
    SN: "dakar", ML: "bamako", CM: "yaounde", CD: "kinshasa", CG: "brazzaville",
    AO: "luanda", ZM: "lusaka", ZW: "harare", MZ: "maputo", BW: "gaborone",
    NA: "windhoek", ZA: "pretoria",                                           // (executive; legislative Cape Town, judicial Bloemfontein)
    AU: "canberra", NZ: "wellington", PG: "port moresby", FJ: "suva",
    BR: "brasilia", AR: "buenos aires", CL: "santiago", PE: "lima", CO: "bogota",
    VE: "caracas", EC: "quito", BO: "la paz",                                 // (seat; constitutional Sucre)
    PY: "asuncion", UY: "montevideo", GY: "georgetown", SR: "paramaribo",
    CU: "havana", DO: "santo domingo", HT: "port au prince", JM: "kingston",
    TT: "port of spain", PA: "panama city", CR: "san jose", NI: "managua",
    HN: "tegucigalpa", SV: "san salvador", GT: "guatemala city", BZ: "belmopan",
    AZ: "baku", AM: "yerevan", GE: "tbilisi", KZ: "astana", UZ: "tashkent",
    TM: "ashgabat", KG: "bishkek", TJ: "dushanbe", MN: "ulaanbaatar",
    BY: "minsk", MD: "chisinau", AL: "tirana", MK: "skopje", BA: "sarajevo",
    ME: "podgorica", XK: "pristina", CY: "nicosia", MT: "valletta", LU: "luxembourg",
};

let _cities: Map<string, CityHit[]> | null = null;
function cityIndex(): Map<string, CityHit[]> {
    if (_cities) return _cities;
    const m = new Map<string, CityHit[]>();
    const CITY_PACKED = _cityPacked;
    const add = (key: string, row: CityRow, primary: boolean) => {
        if (!key) return;
        const cur = m.get(key);
        if (cur) { if (!cur.some(h => h.row === row)) cur.push({ row, primary }); }
        else m.set(key, [{ row, primary }]);
    };
    for (const rec of CITY_PACKED.split(",")) {
        const p = rec.split("|");
        if (p.length < 7) continue;
        const row: CityRow = { a1: p[1], cc: p[2], lon: +p[3], lat: +p[4], pop: +p[5], kinds: p[6] || "N" };
        // CITY TAGS — field 9, optional, semicolon list ("capital;port"). The `kinds` field
        // above is already a tag in everything but name — a per-row "which maps can use me"
        // marker (Joel's original design: "the NA map cities have a 'map uses' tag") — and
        // this generalizes the idea so follow-on prompt features can ask categorical
        // questions about a city ("is this the capital?") without a schema change each time.
        // Additive and backward compatible: every existing record has <= 8 fields.
        if (p.length > 8 && p[8]) row.tags = p[8].split(";").filter(Boolean);
        // ...and until the generator emits the field natively, CAPITAL comes from the
        // overlay below, resolved at parse time by (country, normalized name). Overlay
        // entries that match no gazetteer row simply do nothing - the tag can only ever
        // annotate a city that actually exists in the table.
        const capKey = CAPITAL_BY_CC[row.cc];
        if (capKey && normalizePlaceName(p[0]) === capKey) {
            if (!row.tags) row.tags = [];
            if (!row.tags.includes("capital")) row.tags.push("capital");
        }
        add(normalizePlaceName(p[0]), row, true);
        // Alt keys arrive already normalized (the generator stores the lookup key itself),
        // but normalizing again is free and keeps the table format forgiving.
        if (p.length > 7 && p[7]) for (const alt of p[7].split(";")) add(normalizePlaceName(alt), row, false);
    }
    // Population order is kept ONLY for stable diagnostics — it is NO LONGER a tie-break.
    // Since v2 (Joel 2026-08-02) an ambiguous name is REFUSED and reported, never guessed.
    for (const hits of m.values()) hits.sort((a, b) => b.row.pop - a.row.pop);
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

let _cityAlias: Map<string, CityHit[]> | null = null;
function cityAliasIndex(): Map<string, CityHit[]> {
    if (_cityAlias) return _cityAlias;
    const m = new Map<string, CityHit[]>();
    for (const [key, hits] of cityIndex()) {
        if (!key.endsWith(" city")) continue;
        const bare = key.slice(0, -5);
        // A bare form that is ALREADY a city NAME of its own keeps that meaning — and
        // "name" means a PRIMARY name, not merely a variant some other city answers to.
        // Found by the 0.5.0 -> 0.5.1 corpus replay: "salt lake" became a variant key of a
        // Honolulu-area row, which suppressed the Salt Lake City shorthand entirely and
        // moved bare "Salt Lake" 4,000 km. Richer variant data must not be able to delete
        // a shorthand; it can only compete with it, and it loses that competition to a
        // primary name below.
        if (!bare || cityIndex().get(bare)?.some(h => h.primary)) continue;
        if (hits[0].row.pop < CITY_SUFFIX_ALIAS_MIN_POP) continue;   // rows are pop-descending
        m.set(bare, hits);
    }
    _cityAlias = m;
    return m;
}

/** Candidate city rows for an already-normalized name: the direct gazetteer hit, else the
 *  "<name> City" shorthand when that city is dominant enough to be what was meant. */
function cityRowsFor(key: string): CityHit[] | undefined {
    if (!key) return undefined;
    const direct = cityIndex().get(key);
    // A direct PRIMARY hit is the meaning of the word — no shorthand needed.
    if (direct?.some(h => h.primary)) return direct;
    const alias = cityAliasIndex().get(key);
    if (!alias) return direct;
    // Otherwise the shorthand competes with whatever variants answer to the same key. It
    // enters as a PRIMARY door (it IS the city's own name, minus a suffix people omit), so
    // the precedence rule in the city tier settles it: "Salt Lake" is Salt Lake City, not
    // the row that merely lists it as a variant.
    const asPrimary = alias.map(h => ({ row: h.row, primary: true }));
    return direct ? [...asPrimary, ...direct] : asPrimary;
}

// COUNTRY POINTS — THE LARGEST CITY (Joel 2026-08-03: "switch to use largest city if it's
// known in the gazette, otherwise augment the gazette. we will document it as 'largest city'").
//
// This replaced a population-weighted centroid that SNAPPED to the largest city whenever the
// weighted mean fell outside the country's own polygons. Both halves of that were defensible
// and the combination was not explainable: the rule produced a centre for 140 countries and a
// city for 13, with no way for a viewer to tell which they were looking at.
//
// CANADA is the case that surfaced it. Its population is a ~4,800 km ribbon along the southern
// border (Vancouver -135 to St. John's -52.7), so the weighted mean lands at 46.5N -88.7W —
// the middle of LAKE SUPERIOR, off Michigan. The snap then moved it to Toronto, ~500 km
// south-east of anything a viewer would call Canada's centre and sitting on the US border,
// while the chart's own caption still said "country centres". A rule you cannot state in one
// sentence is a rule that will surprise someone.
//
// "The country's largest city" is that sentence, and it is checkable by the person reading the
// map. It is also the better answer for THIS chart specifically: a bubble map is read as where
// the activity is, and for Canada, Australia, Brazil and the US the capital deliberately is not
// that. (Joel: "it could also have been the capital city" — true, and equally defensible for a
// political map; this one is not political.)
//
// DERIVED FROM THE CITY TABLE, not stored: the gazetteer already knows every city's population
// and country, so a second table saying which is biggest could only ever drift away from it.
// COUNTRY_PACKED survives as the FALLBACK for the ~96 entries with no city row — mostly small
// island states and territories, whose stored point is already at or beside their largest city
// (Greenland is Nuuk exactly, the Bahamas is Nassau exactly). Augmenting the gazetteer for
// those, which needs the GeoNames source the generator reads, upgrades them automatically.
let _countries: Map<string, { lon: number; lat: number }> | null = null;
function countryIndex(): Map<string, { lon: number; lat: number }> {
    if (_countries) return _countries;
    const m = new Map<string, { lon: number; lat: number }>();
    // Fallback first, so a country the gazetteer does not reach still places.
    for (const rec of COUNTRY_PACKED.split(",")) {
        const p = rec.split("|");
        if (p.length < 3) continue;
        m.set(p[0], { lon: +p[1], lat: +p[2] });
    }
    // ...then the largest city overrides it wherever the gazetteer has one. Read through
    // cityIndex rather than re-parsing CITY_PACKED: one parser, so "the city tier's Toronto"
    // and "Canada's point" cannot become two different Torontos. A row is reached under
    // several keys (its own name plus any exonyms), which costs a few redundant comparisons
    // and cannot change a maximum.
    const bestPop = new Map<string, number>();
    for (const hits of cityIndex().values()) {
        for (const h of hits) {
            const iso3 = iso2ToIso3(h.row.cc);
            if (!iso3) continue;
            const cur = bestPop.get(iso3);
            // Strict >, so an exact population tie keeps the first row in table order rather
            // than depending on which key happened to be visited first.
            if (cur === undefined || h.row.pop > cur) {
                bestPop.set(iso3, h.row.pop);
                m.set(iso3, { lon: h.row.lon, lat: h.row.lat });
            }
        }
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

/** The countries the bundled ZIP-3 table actually covers — the USPS delivery area. The
 *  territories are in it because they carry real ZIPs (Puerto Rico 006-009, Guam 969)
 *  while resolving to their own ISO-3, so keying on "USA" alone would refuse them. */
const ZIP_COUNTRIES = new Set(["USA", "PRI", "VIR", "GUM", "ASM", "MNP"]);

/**
 * The countries a NORTH AMERICA basemap can actually draw. Matches the admin1 table's own
 * coverage — US, Canada and Mexico are exactly the countries whose states/provinces resolve.
 *
 * Exported because geoPointRoles needs the identical set to decide when a two-letter token is
 * ambiguous, and two copies of a list like this drift into a bug nobody can see. (One
 * direction only: geoPointRoles imports geoPoint, never the reverse.)
 */
export const NORTH_AMERICA_COUNTRIES = new Set(["USA", "CAN", "MEX"]);

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

/**
 * THE ZIP READER. One function, because a ZIP arrives in whatever shape the pipeline left it
 * and both matchers — the point cascade here and the choropleth join key in geoDetector —
 * have to read it identically (Joel 2026-08-02: "the matcher to the gazette needs to do
 * proper zip matching: it should work for 02108 no matter how the source is interpreted").
 *
 * Everything it survives, and why each one is real:
 *
 *   "02108"       the honest case
 *   "02108-1234"  ZIP+4; the +4 is routing detail, not a place
 *   2108          Power BI and Excel silently coerce a ZIP column to a NUMBER and the
 *                 leading zero is gone. This is not an edge case: it takes out the entire
 *                 New England / New Jersey / Puerto Rico 0xxxx block (prod, 2026-07-23)
 *   501           the same thing to Holtsville NY 00501, the lowest ZIP there is
 *   "60614.0"     a round trip through a float — a CSV export, a DAX FORMAT
 *   " 02108 "     whitespace from a hand-maintained sheet
 *
 * USPS ZIPs run 00501..99950, so any value shorter than five digits is unambiguously a
 * stripped leading zero and padding recovers it rather than guessing.
 *
 * Returns the canonical 5-digit form, or null when the value simply is not a ZIP.
 */
export function normalizeZip5(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    // A real ZIP never contains a dot, so stripping a trailing ".0…" is safe.
    const raw = String(value).trim().replace(/\.0+$/, "");
    if (!raw) return null;
    const m = /^(\d{5})(-\d{4})?$/.exec(raw);
    if (m) return m[1];
    if (/^\d{3,4}$/.test(raw)) return raw.padStart(5, "0");
    return null;
}

/** Ordered prefix interpretations, most likely first. Callers with the lookup table
 *  available should try each and take the first that exists. */
export function zipPrefixCandidates(value: string | null | undefined): string[] {
    if (value === null || value === undefined) return [];
    const raw = String(value).trim().replace(/\.0+$/, "");
    if (!raw) return [];

    // A BARE 3-DIGIT value is the one genuinely ambiguous shape, and it is why this cannot
    // simply defer to normalizeZip5: "021" is either the ZIP-3 prefix itself (already what
    // this function returns) or 00021 with two zeros eaten. Offer both readings, the literal
    // one first, and let the caller take whichever the table actually holds.
    if (/^\d{3}$/.test(raw)) {
        const stripped = raw.padStart(5, "0").slice(0, 3);   // the 00xxx reading
        return stripped === raw ? [raw] : [raw, stripped];
    }

    const z = normalizeZip5(raw);
    return z ? [z.slice(0, 3)] : [];
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
    //
    // "the work" here means the STATE TIER only, and that reading is deliberate — I tried the
    // other one (2026-08-02) and backed it out. Letting the city tier also ignore a discredited
    // state would place {Burnaby, CA, Canada} at city precision instead of on Canada's
    // centroid, which is more precise and looks like an improvement, but it contradicts the v2
    // matching rule directly: a non-blank source attribute that matches nothing EXCLUDES the
    // row. Two tests pin that on purpose (geoPointCountry, geoPointWorldTier) and the reasoning
    // holds — when the state and the country disagree, ONE of them is wrong and nothing here
    // knows which, so the honest answer is the coarse one both agree on.
    //
    // Nothing is lost in production: a country column parked in the state slot is refused at
    // COLUMN level by resolvePointRoles before this ever runs, and the row then places at city
    // precision with the bad slot gone. Column-level evidence can tell which field is wrong;
    // a single row cannot.
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
            let best: CityHit[] = [];
            let bestRank = -1;
            for (const h of all) {
                const r = h.row;
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
                if (rank > bestRank) { bestRank = rank; best = [h]; }
                else if (rank === bestRank) best.push(h);
            }
            // NAME-KIND PRECEDENCE, applied only WITHIN the winning attribute rank: a city's
            // own name beats another city's translated name. Source attributes still decide
            // first — "Santiago, Spain" must reach Santiago de Compostela through its Spanish
            // variant rather than being dragged to Chile by primary-ness. What this removes is
            // the accidental ambiguity of a bare name that one city IS and another merely
            // ANSWERS TO; two cities genuinely named the same thing still refuse.
            if (best.some(h => h.primary)) best = best.filter(h => h.primary);
            // Two doors onto one place (a primary name and an exonym, or duplicate source
            // rows) are ONE match — dedupe by coordinate before judging ambiguity.
            const distinct = new Map<string, CityRow>();
            for (const h of best) distinct.set(h.row.lon.toFixed(2) + "," + h.row.lat.toFixed(2), h.row);
            if (distinct.size === 1) {
                const r = best[0].row;
                return { lat: r.lat, lon: r.lon, precision: "city" };
            }
            if (distinct.size > 1) return { ambiguous: true, matches: distinct.size };
            // zero candidates in scope → fall through to the coarser tiers
        }
    }

    // 3. ZIP-5 / ZIP-3 -> the 3-digit prefix centroid. Try each interpretation in
    //    likelihood order so a 3-digit value that ISN'T a real prefix can still fall
    //    back to the zero-stripped reading.
    //
    //    THE TABLE IS US-ONLY AND THE DATA MIGHT NOT BE. Five digits is not a US idea:
    //    France 75001, Germany 10115, Spain 28013, Brazil 01310, Japan 100-0001 all read
    //    as clean ZIPs here, and every one of them hits a real US ZIP-3 prefix — "75001"
    //    is Paris to the user and Dallas to this table. Without the guard a world map
    //    built from a PostalCode column scatters Europe across the American South at
    //    zip3 precision, which is *more* confident than the country centroid it should
    //    have fallen through to.
    //
    //    This is the same rule the state tier already applies two blocks up (a state
    //    belonging to another country is dropped); the ZIP tier simply never got it,
    //    because when it was written the only maps were North American. Territories are
    //    listed because their ZIPs are genuine (00901 San Juan, 96910 Hagatna) and their
    //    country identifiers are NOT "USA".
    if (!iso3 || ZIP_COUNTRIES.has(iso3)) {
        for (const z3 of zipPrefixCandidates(args.zip)) {
            const hit = zip3Index().get(z3);
            if (hit) return { lat: hit.lat, lon: hit.lon, precision: "zip3" };
        }
    }

    // 4. State / province alone — population-weighted centroid.
    if (a1) {
        const row = adminIndex().get(normalizePlaceName(a1));
        if (row) return { lat: row.lat, lon: row.lon, precision: "state" };
    }

    // 5. COUNTRY alone — the coarsest honest answer, and the point is the country's LARGEST
    //    CITY (see countryIndex). Every row in a country lands on ONE point, which is why the
    //    tier is reported: a world map of 40 countries is 40 dots that mean "somewhere in
    //    this country", not 40 places. Reached either because the data only
    //    ever named countries, or because a finer tier CONTRADICTED the country and was
    //    dropped above — in both cases this is the most precise claim the data supports.
    //
    //    SCOPED TO THE MAP, like every tier above it. This one was not, and the gap showed up
    //    on Joel's fourth scenario: "North America Bubbles ... would fail to place Tokyo,
    //    Japan." It did not fail — Tokyo is out of the NA city scope, so the row fell all the
    //    way through to here and was placed on JAPAN'S CENTROID, at 137E on a map of North
    //    America. Worse than the off-canvas dot is the bookkeeping: the row counted as PLACED,
    //    so `unplaced` read zero and the chart's "N rows not shown" annotation had nothing to
    //    say. A silent drop wearing a coordinate.
    //
    //    The rule is the one the city tier has always followed and the ZIP tier gained the
    //    same day — a tier may only place what the map on screen can draw. A country the
    //    basemap does not contain is not a coarser answer, it is no answer, and the honest
    //    outcome is an unplaced row the user can see and act on.
    //
    //    IT FILTERS ONLY WHEN A SCOPE IS DECLARED, and that asymmetry with the city tier is
    //    deliberate. `mapKind` means "the basemap on screen"; ABSENT means no basemap was
    //    declared, and inventing North America for a caller who never said so would quietly
    //    delete every non-NA country for the MCP client, the React host, and anyone else
    //    calling buildRenderPayload without a map in mind. The city tier defaults to NA for
    //    compatibility reasons documented at isKnownCity — a wart worth keeping there, not
    //    worth spreading here. The Power BI visual states its scope explicitly (ctxRender), so
    //    the map that has a basemap gets the filter and the caller that has none keeps the
    //    gazetteer whole.
    if (iso3 && (args.mapKind !== "north-america" || NORTH_AMERICA_COUNTRIES.has(iso3))) {
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
    /** True when rows carried a CITY but no placement table was registered, so those rows
     *  resolved at a coarser tier than they could have (see the bundled/fetched split).
     *  Diagnostic, not a failure: the coarser precision is already reported honestly. It
     *  exists so "why is my map suddenly state-level?" has an answer in the log instead of
     *  requiring someone to guess that a fetch failed. */
    cityTableMissing?: true;
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
    /** `label` is NEVER matched — it only names a row whose bound place values are all
     *  blank, so an unplaced row can be reported by name. See describeRow. */
    rows: Array<{ lat?: any; lon?: any; city?: any; state?: any; zip?: any; country?: any; label?: any }>,
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
    const cityTableMissing = !isCityTableLoaded()
        && rows.some(r => r.city !== null && r.city !== undefined && String(r.city).trim() !== "");
    return { lat, lon, precision: coarsest, precisionCounts, coarseExamples,
             unmatched, ambiguousRows, ambiguousExamples, matchedRows, totalRows: rows.length,
             ...(cityTableMissing ? { cityTableMissing: true as const } : {}) };
}

/** The most specific thing the row offered, so an annotation names something the user
 *  recognizes ("Nowhereville, TX" rather than "row 37"). */
function describeRow(r: { city?: any; state?: any; zip?: any; country?: any; label?: any }): string {
    // COUNTRY included since the World point map: on country-only data it is the row's
    // ONLY identifier, and without it an unplaced row is counted but never named — the
    // annotation would say "3 rows could not be placed" and be unable to say which,
    // which is precisely the silent-drop behaviour the unmatched report exists to end.
    const named = [r.city, r.state, r.zip, r.country]
        .filter(v => v !== null && v !== undefined && String(v).trim() !== "")
        .map(v => String(v).trim())
        .join(", ");
    if (named) return named;
    // ...and when every BOUND value is blank, the row still has a name somewhere — it is just
    // in the column the resolver passed over. That is not hypothetical: the rows that fail a
    // swapped country binding are usually the exact rows whose code cell is empty, so the
    // report could count them and never name them. `label` is matched against nothing; it
    // only answers "which row was this?". See PointRoleResolution.labelFallback.
    return r.label === null || r.label === undefined ? "" : String(r.label).trim();
}

/**
 * The TAGS on a known city ("capital", ...), empty when it carries none or is unknown.
 *
 * The query surface for the per-city tag layer (Joel 2026-08-03: "having tags that can apply
 * at the city level makes sense and can be leveraged in follow-on prompt requests"). `country`
 * narrows to one row when the name is shared ("London" GB vs ON); without it, a name that
 * matches several cities returns the union of their tags, which is honest about what a bare
 * name can claim. Tags come from the packed table's field 9 plus the CAPITAL_BY_CC overlay.
 */
export function cityTagsFor(name: string, country?: string | null): string[] {
    const key = normalizePlaceName(String(name ?? ""));
    if (!key) return [];
    const hits = cityRowsFor(key);
    if (!hits) return [];
    const iso3 = countryIso3(country ?? null);
    const out = new Set<string>();
    for (const h of hits) {
        if (iso3 && iso2ToIso3(h.row.cc) !== iso3) continue;
        for (const t of h.row.tags ?? []) out.add(t);
    }
    return Array.from(out);
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
    return rows.some(h => h.row.kinds.includes(flag));
}

/** Share of DISTINCT NON-BLANK values that are known city names, 0..100 (one decimal).
 *  Production offerability does NOT ride on this — detectGeo's "city-name" kind is the
 *  gate (CITY_ROLE_MATCH_PCT, >=2 matches, roster guard). This is the standalone measure
 *  for harness/MCP callers, so it has to AGREE with the gate: same notion of a match
 *  (isKnownCity, including the NA-scope default), and same notion of a blank. */
export function cityMatchPct(values: Array<string | null | undefined>, mapKind?: GeoMapKind | null): number {
    const seen = new Set<string>();
    let matched = 0;
    for (const v of values) {
        if (v === null || v === undefined) continue;
        const k = normalizePlaceName(String(v));
        // A typed placeholder is a HOLE, not a failed match, and it leaves the denominator
        // (Joel: "my 97% is for non-blanks... '-' and 'N/A' could be interpreted as blank").
        // This measure was written before that rule and kept counting them, so it reported a
        // lower number than the gate it is supposed to mirror — the drift that makes a
        // standalone measure worse than none.
        if (isBlankLike(k) || seen.has(k)) continue;
        seen.add(k);
        if (isKnownCity(k, mapKind)) matched++;
    }
    return seen.size === 0 ? 0 : Math.round((matched / seen.size) * 1000) / 10;
}
