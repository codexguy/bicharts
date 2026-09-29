// ───────────────────────────────────────────────────────────────────────
// COUNTRY VOCABULARY — the shared place-name layer
// ───────────────────────────────────────────────────────────────────────
//
// EXTRACTED from geoDetector.ts (2026-08-02) because TWO modules need it and they sit
// on opposite sides of an import rule:
//
//   geoDetector  "what REGION is this value?"  -> a polygon join key (__geoIso__)
//   geoPoint     "WHERE is this row?"          -> a coordinate; since World (Bubbles)
//                the COARSEST tier of that cascade is a COUNTRY centroid
//
// geoDetector already imports FROM geoPoint (isKnownCity), so geoPoint importing back
// would be a cycle. This module imports NOTHING and both depend on it, which keeps the
// graph a DAG and — the real point — keeps ONE country-name table and ONE normalizer.
// A second copy of either is a silent-drift bug rather than a loud one: the packed
// tables are keyed by NORMALIZED names, so a normalizer that disagrees by a single
// character misses every lookup and reports "not a country" instead of throwing.
// (It imports only the two leaf modules below, which import nothing.)
//
// normalizePlaceName lives here for exactly that reason (it was geoPoint's; geoPoint
// re-exports it, so the published API is unchanged).
//
// TWO KEYS, ASKED IN ORDER. `normalizePlaceName` is the EXACT key: accents and case folded,
// punctuation turned into a space, so "St. Louis" is "st louis". `placeLooseKey` is the LOOSE key
// (knownNameKey.ts): the same letters with every space and punctuation mark squeezed out and "&"
// read as "and", so "NewZealand", "Cote dIvoire" and "Trinidad and Tobago" reach the names the
// tables hold. Every lookup asks the exact key first and the loose key only on a miss, so nothing
// that resolved before resolves differently; a loose key that names two different places is
// AMBIGUOUS and resolves to nothing. A typed blank ("N/A") is judged on the exact key BEFORE
// anything is loosened - squeezed, it would be "na", which is Namibia.

import { foldLatin, looseNameKey, LooseIndex } from "./knownNameKey";
import { isBlankLike } from "./matchQuality";

// ── Normalizer ────────────────────────────────────────────────────────
// MUST match tools/geo_build_points.py norm() or lookups silently miss (a parity test there
// runs both over the same strings): strip diacritics, lowercase, fold the fused Latin letters,
// non-alphanumerics to space, collapse whitespace.
// Folding diacritics on BOTH sides is why no alternate-spelling table is needed —
// "Montréal" and "Montreal" land on the same key.
// NFD + combining-mark stripping folds every letter whose accent is a SEPARATE code point
// (é, ñ, å, ü). It does nothing for Latin letters whose mark is fused into the character
// itself — ø, ł, đ, ı, æ, ß, þ, ð have no decomposition at all, so they survive into the
// key and leave "København" unreachable from "Kobenhavn". Those are exactly the letters
// Danish, Norwegian, Polish, Turkish, Vietnamese and Icelandic place names are full of.
// (2026-08-02: "convert accented 'o' into just utf-8 'o' ... and that's it" — the fold
// map in knownNameKey.ts is the rest of that instruction, the part NFD can't do.)
//
// THE FOLD NOW REACHES EVERY LETTER IN THE MAP. It used to run through a hand-typed character
// class that left out ǝ (U+01DD), ĳ, ŀ and ſ, so those four map entries never ran here while the
// Python generator folded them - "Gǝncǝ" keyed as "gǝncǝ" in the package and "gence" in the
// table it had written. The class is now built from the map's own keys.

export function normalizePlaceName(s: string): string {
    return foldLatin(s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase())
        // \p{Nd} (decimal digits) rather than \p{N}: the wider class keeps superscripts and
        // fractions, and a footnote marker riding a place name ("Ottawa²") then becomes part
        // of its key. Letters stay unrestricted — country names arrive in every script.
        .replace(/[^\p{L}\p{Nd}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * The LOOSE key of a place name - the shared known-name key (knownNameKey.ts), named here because
 * every place table indexes under it. "New Zealand", "NewZealand" and "new-zealand" are one key;
 * "Trinidad & Tobago" and "Trinidad and Tobago" are one key. Never the first question: see the
 * TWO KEYS note at the top of this file.
 */
export function placeLooseKey(s: string): string {
    return looseNameKey(s);
}

/**
 * Is this value a typed BLANK ("N/A", "unknown", "-")? Judged on the EXACT key, and always before
 * a loose lookup: squeezing "N/A" gives "na", which is Namibia.
 */
export function isPlaceBlank(value: string): boolean {
    return isBlankLike(normalizePlaceName(value));
}


// languages) is derived at runtime from Intl. Packed as "A2 A3" pairs to keep
// the source compact and the structure typo-resistant.
export const ISO_3166_PAIRS =
    "AD AND,AE ARE,AF AFG,AG ATG,AI AIA,AL ALB,AM ARM,AO AGO,AQ ATA,AR ARG,AS ASM,AT AUT,AU AUS,AW ABW,AX ALA,AZ AZE," +
    "BA BIH,BB BRB,BD BGD,BE BEL,BF BFA,BG BGR,BH BHR,BI BDI,BJ BEN,BL BLM,BM BMU,BN BRN,BO BOL,BQ BES,BR BRA,BS BHS,BT BTN,BV BVT,BW BWA,BY BLR,BZ BLZ," +
    "CA CAN,CC CCK,CD COD,CF CAF,CG COG,CH CHE,CI CIV,CK COK,CL CHL,CM CMR,CN CHN,CO COL,CR CRI,CU CUB,CV CPV,CW CUW,CX CXR,CY CYP,CZ CZE," +
    "DE DEU,DJ DJI,DK DNK,DM DMA,DO DOM,DZ DZA," +
    "EC ECU,EE EST,EG EGY,EH ESH,ER ERI,ES ESP,ET ETH," +
    "FI FIN,FJ FJI,FK FLK,FM FSM,FO FRO,FR FRA," +
    "GA GAB,GB GBR,GD GRD,GE GEO,GF GUF,GG GGY,GH GHA,GI GIB,GL GRL,GM GMB,GN GIN,GP GLP,GQ GNQ,GR GRC,GS SGS,GT GTM,GU GUM,GW GNB,GY GUY," +
    "HK HKG,HM HMD,HN HND,HR HRV,HT HTI,HU HUN," +
    "ID IDN,IE IRL,IL ISR,IM IMN,IN IND,IO IOT,IQ IRQ,IR IRN,IS ISL,IT ITA," +
    "JE JEY,JM JAM,JO JOR,JP JPN," +
    "KE KEN,KG KGZ,KH KHM,KI KIR,KM COM,KN KNA,KP PRK,KR KOR,KW KWT,KY CYM,KZ KAZ," +
    "LA LAO,LB LBN,LC LCA,LI LIE,LK LKA,LR LBR,LS LSO,LT LTU,LU LUX,LV LVA,LY LBY," +
    "MA MAR,MC MCO,MD MDA,ME MNE,MF MAF,MG MDG,MH MHL,MK MKD,ML MLI,MM MMR,MN MNG,MO MAC,MP MNP,MQ MTQ,MR MRT,MS MSR,MT MLT,MU MUS,MV MDV,MW MWI,MX MEX,MY MYS,MZ MOZ," +
    "NA NAM,NC NCL,NE NER,NF NFK,NG NGA,NI NIC,NL NLD,NO NOR,NP NPL,NR NRU,NU NIU,NZ NZL," +
    "OM OMN," +
    "PA PAN,PE PER,PF PYF,PG PNG,PH PHL,PK PAK,PL POL,PM SPM,PN PCN,PR PRI,PS PSE,PT PRT,PW PLW,PY PRY," +
    "QA QAT," +
    "RE REU,RO ROU,RS SRB,RU RUS,RW RWA," +
    "SA SAU,SB SLB,SC SYC,SD SDN,SE SWE,SG SGP,SH SHN,SI SVN,SJ SJM,SK SVK,SL SLE,SM SMR,SN SEN,SO SOM,SR SUR,SS SSD,ST STP,SV SLV,SX SXM,SY SYR,SZ SWZ," +
    "TC TCA,TD TCD,TF ATF,TG TGO,TH THA,TJ TJK,TK TKL,TL TLS,TM TKM,TN TUN,TO TON,TR TUR,TT TTO,TV TUV,TW TWN,TZ TZA," +
    "UA UKR,UG UGA,UM UMI,US USA,UY URY,UZ UZB," +
    "VA VAT,VC VCT,VE VEN,VG VGB,VI VIR,VN VNM,VU VUT," +
    "WF WLF,WS WSM," +
    "YE YEM,YT MYT," +
    "ZA ZAF,ZM ZMB,ZW ZWE";

export const ISO2_TO_ISO3: Map<string, string> = (() => {
    const m = new Map<string, string>();
    for (const pair of ISO_3166_PAIRS.split(",")) {
        const [a2, a3] = pair.split(" ");
        if (a2 && a3) m.set(a2, a3);
    }
    return m;
})();
export const ISO2_SET: Set<string> = new Set(ISO2_TO_ISO3.keys());
export const ISO3_SET: Set<string> = new Set(ISO2_TO_ISO3.values());


// The languages country names are recognized in, via Intl: every Tier 1 language in
// languages.ts, and a test holds the two sets equal. (2026-09-24: this was its own list of 27,
// copied from the visual's phrase table - so it wrote Norwegian as `no` where every host sends
// `nb`, and lacked Slovak, Hungarian and Croatian, whose readers' country columns went
// unrecognised.)
//
// ORDER IS BEHAVIOUR: the first language to produce a normalized key keeps it (English first,
// always). The original 27 keep their original order and the three added languages come last,
// which was measured to leave every one of the 4,436 existing keys on the same country; the
// three add 317 keys and `no` -> `nb` adds none (the runtime's names are identical).
export const SUPPORTED_LANGS: readonly string[] = [
    "en", "fr", "es", "de", "it", "pt", "ru", "ja", "zh", "ko", "ar", "hi", "tr",
    "pl", "he", "nl", "sv", "fi", "nb", "da", "cs", "el", "uk", "ro", "id", "vi", "th",
    "sk", "hu", "hr",
];

// Flat alias overlay for country-name forms Intl.DisplayNames does NOT emit —
// colloquial abbreviations, common short forms, and historical names. Keys are
// pre-normalize() spellings (they get normalized at build); values are ISO3.
// Extend freely (this is the "trivial for an LLM to generate" map).
export const COUNTRY_ALIAS_OVERLAY: Record<string, string> = {
    "usa": "USA", "u.s.": "USA", "u.s.a.": "USA", "us": "USA", "america": "USA",
    "united states of america": "USA", "the united states": "USA",
    "uk": "GBR", "u.k.": "GBR", "great britain": "GBR", "britain": "GBR", "england": "GBR",
    "south korea": "KOR", "north korea": "PRK", "korea": "KOR",
    "ivory coast": "CIV", "cote d ivoire": "CIV",
    "vietnam": "VNM", "laos": "LAO", "syria": "SYR", "iran": "IRN", "russia": "RUS",
    "moldova": "MDA", "tanzania": "TZA", "bolivia": "BOL", "venezuela": "VEN",
    "brunei": "BRN", "czech republic": "CZE", "czechia": "CZE", "slovakia": "SVK",
    "uae": "ARE", "united arab emirates": "ARE",
    "drc": "COD", "dr congo": "COD", "democratic republic of the congo": "COD",
    "republic of the congo": "COG", "congo": "COG",
    "swaziland": "SWZ", "eswatini": "SWZ", "cape verde": "CPV", "cabo verde": "CPV",
    "burma": "MMR", "myanmar": "MMR", "holland": "NLD", "the netherlands": "NLD",
    "netherlands": "NLD", "vatican": "VAT", "vatican city": "VAT", "palestine": "PSE",
    "macau": "MAC", "macao": "MAC", "hong kong": "HKG", "taiwan": "TWN",
    "turkey": "TUR", "turkiye": "TUR", "macedonia": "MKD", "north macedonia": "MKD",
    "gambia": "GMB", "the gambia": "GMB", "bahamas": "BHS", "the bahamas": "BHS",
    "east timor": "TLS", "timor leste": "TLS",
};

/**
 * THE FORMS A COUNTRY IS WRITTEN IN THAT NO RUNTIME PROMISES, as a table this package ships.
 *
 * Two families, both common in real data and both missed before this table existed:
 *
 *  - "X AND Y". The runtime's English names write these with "&" ("Trinidad & Tobago", "Bosnia &
 *    Herzegovina"), so every export that spells out "and" - which is most of them, and the UN's
 *    and ISO's own spelling - resolved to nothing. The loose key reads "&" as "and" and would reach
 *    most of these through the runtime's names, but WHICH names a runtime carries is its own
 *    business: the answer must not depend on it.
 *  - The ISO 3166 / UN official forms, which is what a column exported from a reference dataset
 *    holds: "Korea, Republic of", "Russian Federation", "Iran (Islamic Republic of)".
 *
 * Applied only where the runtime produced no answer for the same exact key, so it can add
 * spellings and never move one; a test holds every entry to its intended code.
 */
export const COUNTRY_FORMAL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    // "X and Y" - the English short names as ISO and the UN write them.
    "Antigua and Barbuda": "ATG",
    "Bosnia and Herzegovina": "BIH",
    "Heard Island and McDonald Islands": "HMD",
    "Saint Kitts and Nevis": "KNA", "St Kitts and Nevis": "KNA",
    "Saint Pierre and Miquelon": "SPM", "St Pierre and Miquelon": "SPM",
    "Saint Vincent and the Grenadines": "VCT", "St Vincent and the Grenadines": "VCT",
    "Sao Tome and Principe": "STP",
    "South Georgia and the South Sandwich Islands": "SGS",
    "Svalbard and Jan Mayen": "SJM",
    "Trinidad and Tobago": "TTO",
    "Turks and Caicos Islands": "TCA", "Turks and Caicos": "TCA",
    "Wallis and Futuna": "WLF",
    "Saint Helena, Ascension and Tristan da Cunha": "SHN",
    "Bonaire, Sint Eustatius and Saba": "BES",
    "United Kingdom of Great Britain and Northern Ireland": "GBR",
    // ISO 3166-1 / UN official forms.
    "Bolivia, Plurinational State of": "BOL", "Bolivia (Plurinational State of)": "BOL",
    "Brunei Darussalam": "BRN",
    "Congo, The Democratic Republic of the": "COD", "Congo, Democratic Republic of the": "COD",
    "Democratic Republic of Congo": "COD",
    "Falkland Islands (Malvinas)": "FLK",
    "Holy See (Vatican City State)": "VAT", "Holy See": "VAT",
    "Iran, Islamic Republic of": "IRN", "Iran (Islamic Republic of)": "IRN", "Islamic Republic of Iran": "IRN",
    "Korea, Republic of": "KOR", "Republic of Korea": "KOR", "Korea (the Republic of)": "KOR",
    "Korea, Democratic People's Republic of": "PRK", "Democratic People's Republic of Korea": "PRK",
    "Korea (the Democratic People's Republic of)": "PRK",
    "Lao People's Democratic Republic": "LAO",
    "Micronesia, Federated States of": "FSM", "Micronesia (Federated States of)": "FSM",
    "Moldova, Republic of": "MDA", "Republic of Moldova": "MDA",
    "Palestine, State of": "PSE", "State of Palestine": "PSE",
    "Russian Federation": "RUS",
    "Syrian Arab Republic": "SYR",
    "Taiwan, Province of China": "TWN",
    "Tanzania, United Republic of": "TZA", "United Republic of Tanzania": "TZA",
    "Venezuela, Bolivarian Republic of": "VEN", "Venezuela (Bolivarian Republic of)": "VEN",
    "Viet Nam": "VNM",
    "Virgin Islands, British": "VGB", "Virgin Islands, U.S.": "VIR",
    "Saint Martin (French part)": "MAF", "Sint Maarten (Dutch part)": "SXM",
    "Netherlands (Kingdom of the)": "NLD",
    "Macedonia, the former Yugoslav Republic of": "MKD",
});

// Country-name → ISO3 lookup, built once (lazily) from Intl across all supported
// languages UNION the alias overlay. English is added first so it wins any
// cross-language normalized-key collision; the overlay is applied last so an
// explicit alias always resolves. Cached module-wide (monthNames.ts pattern).
let _countryNameMap: Map<string, string> | null = null;
let _countryLoose: LooseIndex<string> | null = null;
export function countryNameMap(): Map<string, string> {
    if (_countryNameMap) return _countryNameMap;
    const m = new Map<string, string>();
    // Every spelling that was offered, with the country it was offered for: the loose index is
    // built from these once the exact map has settled every precedence question.
    const offered: Array<[string, string]> = [];
    // English first (authoritative on collisions), then the rest.
    const langs = ["en", ...SUPPORTED_LANGS.filter(l => l !== "en")];
    for (const lang of langs) {
        let dn: Intl.DisplayNames | null = null;
        try {
            dn = new Intl.DisplayNames([lang], { type: "region" });
        } catch {
            continue; // runtime without this locale's data — skip it
        }
        for (const [a2, a3] of ISO2_TO_ISO3) {
            let name: string | undefined;
            try {
                name = dn.of(a2);
            } catch {
                name = undefined;
            }
            // Intl returns the input code when it has no localized name.
            if (!name || name === a2) continue;
            const key = normalizePlaceName(name);
            if (key && !m.has(key)) m.set(key, a3);
            offered.push([name, a3]);
        }
    }
    // The formal forms fill gaps only - a spelling the runtime already answers keeps its answer.
    for (const [alias, a3] of Object.entries(COUNTRY_FORMAL_ALIASES)) {
        const key = normalizePlaceName(alias);
        if (key && !m.has(key)) m.set(key, a3);
        offered.push([alias, a3]);
    }
    for (const [alias, a3] of Object.entries(COUNTRY_ALIAS_OVERLAY)) {
        const key = normalizePlaceName(alias);
        if (key) m.set(key, a3); // overlay wins — explicit intent
        offered.push([alias, a3]);
    }
    // THE LOOSE INDEX FOLLOWS THE EXACT MAP'S VERDICTS. A spelling is indexed loosely only for the
    // country its exact key settled on, so the precedence rules above (English first, the overlay
    // last) decide the loose answer too, and a spelling that lost its exact key to another country
    // cannot come back through the loose one. Two surviving spellings that squeeze to one key but
    // name different countries leave that key AMBIGUOUS, which resolves to nothing.
    const loose = new LooseIndex<string>();
    for (const [name, a3] of offered) {
        const key = normalizePlaceName(name);
        if (m.get(key) !== a3) continue;
        loose.add(name, a3);
        // The exact key as a spelling of its own: "Trinidad & Tobago" keys as "trinidad tobago",
        // so a reader's "TrinidadTobago" reaches it as well as "TrinidadandTobago".
        loose.add(key, a3);
    }
    _countryNameMap = m;
    _countryLoose = loose;
    return m;
}

/** The loose country index (see countryNameMap). Exposed for the collision tests. */
export function countryLooseIndex(): LooseIndex<string> {
    if (!_countryLoose) countryNameMap();
    return _countryLoose!;
}

/**
 * A country NAME (never a code) to ISO-3: the exact key first, then the loose key, never for a
 * typed blank. Null when it names no country or when its loose key names more than one.
 */
export function countryNameIso3(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const exact = normalizePlaceName(raw);
    const hit = countryNameMap().get(exact);
    if (hit) return hit;
    if (isBlankLike(exact)) return null;
    return countryLooseIndex().get(placeLooseKey(raw)) ?? null;
}

/** ISO-2 -> ISO-3 ("CA" -> "CAN"). Null when the code is not assigned. */
export function iso2ToIso3(a2: string): string | null {
    return ISO2_TO_ISO3.get(String(a2 || "").trim().toUpperCase()) ?? null;
}

/**
 * Resolve ANY country identifier to ISO-3: a name in any of the 30 supported
 * languages, an ISO-2 code, an ISO-3 code, an overlay alias ("USA", "UK",
 * "Holland") or a formal form ("Korea, Republic of"). Names match on the exact key first
 * and then the loose one ("NewZealand", "Trinidad and Tobago"); codes match as codes only.
 * Null when it is not a country, and when a loose key names more than one.
 *
 * This is the WORLD-wide resolver, and it is deliberately NOT the same thing as
 * geoPoint.normalizeCountry — that one stays narrow (US/CA/MX, 2-letter) because it
 * feeds city-tier narrowing and its published contract is depended on. See the note
 * beside it.
 */
export function countryIso3(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const up = raw.toUpperCase();
    if (up.length === 3 && ISO3_SET.has(up)) return up;
    if (up.length === 2 && ISO2_SET.has(up)) return ISO2_TO_ISO3.get(up) ?? null;
    return countryNameIso3(raw);
}
