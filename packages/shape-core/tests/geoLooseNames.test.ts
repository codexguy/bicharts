import { describe, it, expect } from "vitest";
import {
    countryIso3, countryLooseIndex, normalizePlaceName, placeLooseKey, isPlaceBlank,
    COUNTRY_FORMAL_ALIASES, countryNameMap,
} from "../src/geoCountryNames";
import { detectGeo, toGeoIso, buildGeoIsoColumn } from "../src/geoDetector";
import { resolveAdmin1, isKnownCity, resolveGeoPoint, normalizeCountry, cityMatchPct, buildGeoPointColumns } from "../src/geoPoint";
import { looseNameKey, LooseIndex, LOOSE_KEY_MIN_LENGTH } from "../src/knownNameKey";
import { isBlankLike } from "../src/matchQuality";
import { CITY_PACKED } from "../src/geoPointCities.generated";

// KNOWN PLACE NAMES MATCH LOOSELY: diacritic-neutral and case-, whitespace- and punctuation-
// insensitive, on the exact key first and the loose key only on a miss. Every case in the first
// block resolved to NOTHING before the loose key existed - a whole column of glued country names
// detected as no geography at all, so no map was offered for it.

describe("glued, apostrophe-dropped and 'and'-spelled names resolve", () => {
    it.each([
        ["NewZealand", "NZL"],
        ["Cote dIvoire", "CIV"],
        ["GuineaBissau", "GNB"],
        ["São Tomé and Príncipe", "STP"],
        ["SaoTomeandPrincipe", "STP"],
        ["Trinidad and Tobago", "TTO"],
        ["TrinidadandTobago", "TTO"],
        ["TrinidadTobago", "TTO"],
        ["Bosnia and Herzegovina", "BIH"],
        ["Antigua and Barbuda", "ATG"],
        ["Saint Kitts and Nevis", "KNA"],
        ["Turks and Caicos Islands", "TCA"],
        ["Saint Vincent and the Grenadines", "VCT"],
        ["Wallis and Futuna", "WLF"],
        ["Korea, Republic of", "KOR"],
        ["Russian Federation", "RUS"],
        ["Iran (Islamic Republic of)", "IRN"],
        ["Viet Nam", "VNM"],
    ])("countryIso3(%j) -> %s", (value, iso3) => {
        expect(countryIso3(value)).toBe(iso3);
    });

    it("a glued US state resolves on both the choropleth and the point side", () => {
        expect(toGeoIso("NorthCarolina", "us-state-name")).toBe("NC");
        expect(resolveAdmin1("NorthCarolina")).toBe("NC");
        expect(resolveAdmin1("north_carolina")).toBe("NC");
        expect(resolveAdmin1("BritishColumbia")).toBe("BC");
    });

    it("a glued city is a known city on the world scope and places at city precision", () => {
        expect(isKnownCity(normalizePlaceName("SaoPaulo"), "world")).toBe(true);
        expect(resolveGeoPoint({ city: "SaoPaulo", mapKind: "world" })).toMatchObject({ precision: "city" });
    });

    it("a glued country column detects as country-name and joins every row", () => {
        const values = ["NewZealand", "SouthAfrica", "UnitedKingdom", "UnitedStates", "SaudiArabia", "CostaRica"];
        const r = detectGeo(values, "Country");
        expect(r?.geoKind).toBe("country-name");
        expect(r?.geoMatchPct).toBe(100);
        const col = buildGeoIsoColumn(values, "country-name");
        expect(col.iso).toEqual(["NZL", "ZAF", "GBR", "USA", "SAU", "CRI"]);
        expect(col.unmatched).toEqual([]);
    });

    it("a glued country column places on a world point map at country precision", () => {
        const pts = buildGeoPointColumns([{ country: "NewZealand" }, { country: "SouthAfrica" }], "world");
        expect(pts.matchedRows).toBe(2);
        expect(pts.precisionCounts.country).toBe(2);
    });

    it("the narrow US/CA/MX country reader takes the glued forms too", () => {
        expect(normalizeCountry("UnitedStates")).toBe("US");
        expect(normalizeCountry("united-states-of-america")).toBe("US");
    });

    it("cityMatchPct counts a glued city it can place", () => {
        expect(cityMatchPct(["SaoPaulo", "Tokyo"], "world")).toBe(100);
    });
});

describe("the exact key answers first and is unchanged", () => {
    it("normalizePlaceName is still the spaced exact key", () => {
        expect(normalizePlaceName("  ST. LOUIS  ")).toBe("st louis");
        expect(normalizePlaceName("Côte d'Ivoire")).toBe("cote d ivoire");
    });

    it("every fused letter in the fold map now folds in the exact key (it matched the generator only for some)", () => {
        expect(normalizePlaceName("Gǝncǝ")).toBe("gence");      // U+01DD turned e
        expect(normalizePlaceName("Gəncə")).toBe("gence");      // U+0259 schwa
        expect(normalizePlaceName("Ĳmuiden")).toBe("ijmuiden");
        expect(normalizePlaceName("ŀa")).toBe("la");
        expect(normalizePlaceName("ſt")).toBe("st");
    });

    it("an exact hit is never overruled by a loose one", () => {
        // "RioVerde" is exactly "rioverde" = Rioverde, Mexico; the loose key it shares with Rio
        // Verde, Brazil is never asked.
        expect(resolveGeoPoint({ city: "RioVerde", mapKind: "world" })).toMatchObject({ precision: "city", lat: 21.93 });
        expect(resolveGeoPoint({ city: "Rio Verde", mapKind: "world" })).toMatchObject({ precision: "city", lat: -17.8 });
    });

    it("the formal aliases fill gaps and never move a spelling the runtime answers", () => {
        for (const [alias, iso3] of Object.entries(COUNTRY_FORMAL_ALIASES)) {
            expect([alias, countryIso3(alias)]).toEqual([alias, iso3]);
        }
    });
});

describe("blanks are judged before anything is loosened", () => {
    it("N/A is a blank, never Namibia", () => {
        expect(countryIso3("N/A")).toBeNull();
        expect(countryIso3("n/a")).toBeNull();
        expect(resolveAdmin1("N/A")).toBeNull();
        expect(isPlaceBlank("N/A")).toBe(true);
        // ...and the bare code is still Namibia, read as a code.
        expect(countryIso3("NA")).toBe("NAM");
    });

    it("a multi-word placeholder typed without its spaces is still a blank", () => {
        expect(isBlankLike(normalizePlaceName("NotApplicable"))).toBe(true);
        expect(isBlankLike(normalizePlaceName("not_specified"))).toBe(true);
        expect(isBlankLike(normalizePlaceName("ToBeDetermined"))).toBe(true);
        expect(isBlankLike("na")).toBe(false);
    });

    it("a short squeeze is a code, and the loose key never reads it", () => {
        // "N.C." squeezes to "nc"; the state-NAME reader must not start claiming USPS codes.
        expect(looseNameKey("N.C.").length).toBeLessThan(LOOSE_KEY_MIN_LENGTH);
        const r = detectGeo(["NC", "SC", "TX", "FL", "GA", "OH"], "st");
        expect(r?.geoKind).toBe("us-state-code");
    });
});

describe("ambiguity refuses", () => {
    it("a glued name two cities share is refused without a disambiguating column", () => {
        // "StJohns" squeezes to St. John's (Newfoundland) AND St. Johns (Florida).
        expect(resolveGeoPoint({ city: "StJohns", mapKind: "world" })).toEqual({ ambiguous: true, matches: 2 });
        expect(resolveGeoPoint({ city: "StJohns", state: "NL", mapKind: "north-america" })).toMatchObject({ precision: "city", lat: 47.56 });
    });

    it("LooseIndex answers undefined for a key two values share", () => {
        const ix = new LooseIndex<string>();
        ix.add("Foo Bar", "A");
        ix.add("FooBar", "A");
        ix.add("foo-baz", "B");
        ix.add("Foob Az", "C");
        expect(ix.get("foobar")).toBe("A");
        expect(ix.get("foobaz")).toBeUndefined();
        expect(ix.isAmbiguous("foobaz")).toBe(true);
    });
});

describe("collisions under the loose key, pinned", () => {
    it("no country loose key names two countries", () => {
        const amb = countryLooseIndex().entries().filter(([, v]) => v.ambiguous).map(([k]) => k);
        expect(amb).toEqual([]);
        expect(countryNameMap().size).toBeGreaterThan(4000);
    });

    it("only the listed city keys merge two different exact keys' places", () => {
        // A loose key that pools DIFFERENT places from two exact spellings. Each is refused as
        // ambiguous when reached ONLY loosely (every spaced or glued spelling below is still an
        // exact hit). A regenerated gazetteer that adds one fails here, loudly, for review.
        const rowsByExact = new Map<string, Set<string>>();
        for (const rec of CITY_PACKED.split(",")) {
            const p = rec.split("|");
            if (p.length < 7) continue;
            const id = `${p[0]}|${p[2]}|${p[3]}|${p[4]}`;
            const keys = [normalizePlaceName(p[0]), ...(p[7] ? p[7].split(";").map(normalizePlaceName) : [])];
            for (const k of keys) if (k) (rowsByExact.get(k) ?? rowsByExact.set(k, new Set()).get(k)!).add(id);
        }
        const byLoose = new Map<string, string[]>();
        for (const k of rowsByExact.keys()) {
            const lk = placeLooseKey(k);
            if (lk.length < LOOSE_KEY_MIN_LENGTH) continue;
            (byLoose.get(lk) ?? byLoose.set(lk, []).get(lk)!).push(k);
        }
        const merged: string[] = [];
        for (const [lk, ks] of byLoose) {
            if (ks.length < 2) continue;
            const sets = new Set(ks.map(k => Array.from(rowsByExact.get(k)!).sort().join(";")));
            if (sets.size > 1) merged.push(lk);
        }
        expect(merged.sort()).toEqual([
            "ansan", "arifwala", "changhua", "cholon", "desmoines", "ezhou", "georgetown", "hongkong",
            "latkrabang", "nasimshahr", "rioverde", "saida", "southgate", "stjohns", "tama",
        ]);
    });
});
