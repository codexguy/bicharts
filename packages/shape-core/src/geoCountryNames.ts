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
//
// normalizePlaceName lives here for exactly that reason (it was geoPoint's; geoPoint
// re-exports it, so the published API is unchanged).


// ── Normalizer ────────────────────────────────────────────────────────
// MUST match tools/geo_build_points.py norm() or lookups silently miss:
// strip diacritics, lowercase, non-alphanumerics to space, collapse whitespace.
// Folding diacritics on BOTH sides is why no alternate-spelling table is needed —
// "Montréal" and "Montreal" land on the same key.
// NFD + combining-mark stripping folds every letter whose accent is a SEPARATE code point
// (é, ñ, å, ü). It does nothing for Latin letters whose mark is fused into the character
// itself — ø, ł, đ, ı, æ, ß, þ, ð have no decomposition at all, so they survive into the
// key and leave "København" unreachable from "Kobenhavn". Those are exactly the letters
// Danish, Norwegian, Polish, Turkish, Vietnamese and Icelandic place names are full of.
// (Joel 2026-08-02: "convert accented 'o' into just utf-8 'o' ... and that's it" — this
// map is the rest of that instruction, the part NFD can't do.) The multi-letter
// expansions are the conventional transliterations, not inventions: ß→ss is how German
// writes it without the letter, æ→ae and œ→oe likewise.
const LATIN_FOLD: Record<string, string> = {
    "ø": "o", "œ": "oe", "æ": "ae", "ß": "ss", "ł": "l", "đ": "d", "ð": "d",
    "þ": "th", "ı": "i", "ħ": "h", "ŧ": "t", "ŋ": "n", "ə": "e", "ĸ": "k",
};

export function normalizePlaceName(s: string): string {
    return s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[øœæßłđðþıħŧŋəĸ]/g, ch => LATIN_FOLD[ch])
        // \p{Nd} (decimal digits) rather than \p{N}: the wider class keeps superscripts and
        // fractions, and a footnote marker riding a place name ("Ottawa²") then becomes part
        // of its key. Letters stay unrestricted — country names arrive in every script.
        .replace(/[^\p{L}\p{Nd}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
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


// The 27 languages the visual localizes to (mirrors lib/shared/Localizer.ts
// PHRASES — the definition of "languages the visual supports today"). Country
// names are recognized in every one of these via Intl. If Localizer's set
// changes, mirror it here.
export const SUPPORTED_LANGS = [
    "en", "fr", "es", "de", "it", "pt", "ru", "ja", "zh", "ko", "ar", "hi", "tr",
    "pl", "he", "nl", "sv", "fi", "no", "da", "cs", "el", "uk", "ro", "id", "vi", "th",
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

// Country-name → ISO3 lookup, built once (lazily) from Intl across all supported
// languages UNION the alias overlay. English is added first so it wins any
// cross-language normalized-key collision; the overlay is applied last so an
// explicit alias always resolves. Cached module-wide (monthNames.ts pattern).
let _countryNameMap: Map<string, string> | null = null;
export function countryNameMap(): Map<string, string> {
    if (_countryNameMap) return _countryNameMap;
    const m = new Map<string, string>();
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
        }
    }
    for (const [alias, a3] of Object.entries(COUNTRY_ALIAS_OVERLAY)) {
        const key = normalizePlaceName(alias);
        if (key) m.set(key, a3); // overlay wins — explicit intent
    }
    _countryNameMap = m;
    return m;
}

/** ISO-2 -> ISO-3 ("CA" -> "CAN"). Null when the code is not assigned. */
export function iso2ToIso3(a2: string): string | null {
    return ISO2_TO_ISO3.get(String(a2 || "").trim().toUpperCase()) ?? null;
}

/**
 * Resolve ANY country identifier to ISO-3: a name in any of the 27 supported
 * languages, an ISO-2 code, an ISO-3 code, or an overlay alias ("USA", "UK",
 * "Holland"). Null when it is not a country.
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
    return countryNameMap().get(normalizePlaceName(raw)) ?? null;
}
