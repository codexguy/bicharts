// MULTILINGUAL CITY VARIANTS, second cut (2026-08-02): "I'd lean on normalization
// rules ... and I'd avoid using distance — convert accented 'o' into just utf-8 'o', and
// that's it."
//
// The first cut ranked GeoNames' UNTAGGED alternatenames column by edit distance, because
// that column carries no language and no meaningful order. Distance is a guess about which
// string LOOKS like a translation, and it shipped bad doors ("Münegh" beating "München").
// The replacement uses alternateNamesV2, where every row carries an isolanguage: keep the
// names tagged with a supported UI language, store each one as its NORMALIZED KEY, and
// there is nothing left to rank — which is why there is also no cap (the whole set is
// 9.4 KB gz, LESS than the capped heuristic cost).
//
// These tests are about the DOORS, not the geometry: each asserts that a name a real
// foreign-language dataset would contain reaches the right city.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, isGeoPointAmbiguity } from "../src/geoPoint";
import { CITY_PACKED } from "../src/geoPointCities.generated";

const place = (args: any) => resolveGeoPoint(args) as any;

describe("language-tagged variants open the right door", () => {
    it("reaches cities by their local and translated names", () => {
        // [variant, expected lon, expected lat, what it is]
        const doors: Array<[string, number, number, string]> = [
            ["Wien", 16.37, 48.21, "German — the case a stem heuristic can NEVER reach (Wien/Vienna share nothing)"],
            ["Londres", -0.13, 51.51, "French/Spanish/Portuguese — alphabetically late, so first-K order missed it"],
            ["München", 11.58, 48.14, "the local form, and the exact miss that was reported"],
            ["Muenchen", 11.58, 48.14, "ASCII transliteration — a distinct key, not an accent fold"],
            ["Praha", 14.42, 50.09, "Czech"],
            ["Moskva", 37.62, 55.75, "Russian, romanized"],
            ["Varsavia", 21.01, 52.23, "Italian for Warsaw"],
        ];
        for (const [name, lon, lat, why] of doors) {
            const r = place({ city: name, mapKind: "world" });
            expect(r.precision, `${name} (${why})`).toBe("city");
            expect(r.lon, `${name} lon`).toBeCloseTo(lon, 0);
            expect(r.lat, `${name} lat`).toBeCloseTo(lat, 0);
        }
    });

    it("applies to the NORTH AMERICA map too — one rule, every map type", () => {
        // The field report: "the rules I just described for lookup should apply to all map-based types
        // (common logic)". A Spanish-language report saying "Nueva York" is the NA-map
        // equivalent of a German one saying "Wien", and it resolves in the NA scope with no
        // country column and no world rows involved.
        const ny = place({ city: "Nueva York" });
        expect(ny.precision).toBe("city");
        expect(ny.lon).toBeCloseTo(-74.0, 0);
        expect(ny.lat).toBeCloseTo(40.7, 0);
    });

    it("folds accents rather than storing them — an accented spelling needs no entry", () => {
        // The other half of the rule: "Montréal" and "Montreal" are ONE key because both
        // sides normalize, so the variant list never spends a row on a diacritic difference.
        const a = place({ city: "Montréal" });
        const b = place({ city: "MONTREAL" });
        expect(a.precision).toBe("city");
        expect(a.lon).toBeCloseTo(b.lon, 5);
        expect(a.lat).toBeCloseTo(b.lat, 5);
    });
});

describe("a city's own name outranks another city's translation of it", () => {
    it("resolves 'Hong Kong' instead of refusing it", () => {
        // "hong kong" is the PRIMARY name of Hong Kong and also a variant of the separate
        // row "Hong Kong Island". Both carry W, so without name-kind precedence this became
        // two survivors at different coordinates — i.e. the language data would have made a
        // previously-working lookup ambiguous. The primary wins; the island keeps its own name.
        const r = place({ city: "Hong Kong", mapKind: "world" });
        expect(isGeoPointAmbiguity(r)).toBe(false);
        expect(r.precision).toBe("city");
        expect(r.lon).toBeCloseTo(114.2, 0);
    });

    it("still refuses when two cities are genuinely NAMED the same", () => {
        // Precedence resolves primary-vs-variant. It must NOT resolve primary-vs-primary:
        // Victoria BC and Victoria TX are both really called Victoria, so the call-out
        // stands — that is the ambiguity the user has to answer with a state column.
        expect(isGeoPointAmbiguity(resolveGeoPoint({ city: "Victoria" }))).toBe(true);
        const bc = place({ city: "Victoria", state: "British Columbia" });
        expect(bc.precision).toBe("city");
        expect(bc.lon).toBeCloseTo(-123.4, 0);
    });

    it("lets an explicit source attribute beat name-kind precedence", () => {
        // Ordering matters: attributes decide FIRST, name-kind only breaks ties within the
        // winning attribute rank. A country column must therefore still be able to send a
        // name to the city that merely answers to it rather than the one that IS it.
        const es = place({ city: "Ciudad Victoria", country: "Mexico" });
        expect(es.precision).toBe("city");
        expect(es.lon).toBeCloseTo(-99.0, 0);
    });
});

describe("renamed cities keep their old name as a door", () => {
    it("places pre-rename spellings a warehouse full of old rows still uses", () => {
        // GeoNames marks these historic because the city renamed. Historic is exactly what
        // aging data contains, so they are kept — ranked below current names, so a current
        // name never loses a slot to one. (The 2026-08-02 probe found all of these dead.)
        for (const [old, lon] of [["Bombay", 72.9], ["Calcutta", 88.4], ["Madras", 80.3],
                                  ["Saigon", 106.6], ["Rangoon", 96.2]] as Array<[string, number]>) {
            const r = place({ city: old, mapKind: "world" });
            expect(r.precision, old).toBe("city");
            expect(r.lon, old).toBeCloseTo(lon, 0);
        }
    });
});

describe("a shorthand cannot be deleted by someone else's variant", () => {
    it("bare 'Salt Lake' is still Salt Lake City", () => {
        // REGRESSION, found by the 0.5.0 -> 0.5.1 corpus replay (the only "moved" result in
        // 8,038 names): "salt lake" arrived as a variant key on a Honolulu-area row, which
        // made the "<X> City" shorthand index skip Salt Lake City entirely — bare "Salt
        // Lake" jumped 4,000 km to Hawaii. The shorthand is now suppressed only by a
        // PRIMARY name, and it competes as a primary door, so precedence settles it.
        const r = place({ city: "Salt Lake" });
        expect(r.precision).toBe("city");
        expect(r.lon).toBeCloseTo(-111.9, 0);
        expect(r.lat).toBeCloseTo(40.8, 0);
    });

    it("still yields to a real city that IS called the bare name", () => {
        // The shorthand rule's own condition, unchanged: "New York" is New York City, but a
        // bare form that is some other city's actual name keeps that meaning.
        expect(place({ city: "New York" }).lon).toBeCloseTo(-74.0, 0);
    });
});

describe("the generated variant column", () => {
    it("stores normalized keys only — no accents, no case, no punctuation", () => {
        // The table's own invariant, and the reason it got SMALLER while gaining doors.
        // A stray accented byte here means the generator stopped normalizing and half the
        // variants became unreachable (they would only match a source value spelled with
        // the identical accent).
        const offenders: string[] = [];
        for (const rec of CITY_PACKED.split(",")) {
            const p = rec.split("|");
            if (p.length < 8 || !p[7]) continue;
            for (const alt of p[7].split(";")) {
                if (alt !== alt.toLowerCase() || /[^a-z0-9 ]/.test(alt)) offenders.push(`${p[0]} -> ${alt}`);
            }
        }
        expect(offenders.slice(0, 10)).toEqual([]);
    });
});
