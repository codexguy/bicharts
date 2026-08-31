// CITY-LEVEL TAGS (2026-08-03: "having tags that can apply at the city level makes
// sense and can be leveraged in follow-on prompt requests", after asking how "largest city"
// is stored and whether capitals could be flagged).
//
// The layer generalizes something the gazetteer already had in embryo: `kinds` is a per-row
// "which maps can use me" tag (N/W). Tags are field 9 of the packed record plus, until the
// generator emits the field natively, the CAPITAL_BY_CC overlay - applied at parse by
// (country, normalized name), so a wrong overlay entry can mistag NOTHING; it can only fail
// to tag a city that is not in the table under that name.
import { describe, it, expect } from "vitest";
import { cityTagsFor, registerCityTable } from "../src/geoPoint";
import { CITY_PACKED } from "../src/geoPointCities.generated";

describe("capital tags from the overlay", () => {
    it.each([
        ["Ottawa", "Canada"], ["Paris", "France"], ["Tokyo", "Japan"], ["Berlin", "Germany"],
        ["Canberra", "Australia"], ["Cairo", "Egypt"], ["Bangkok", "Thailand"],
    ])("%s (%s) is tagged capital", (city, country) => {
        expect(cityTagsFor(city, country)).toContain("capital");
    });

    it("the LARGEST city and the CAPITAL are different questions", () => {
        // The distinction the tag layer exists to make queryable: Canada's country-tier POINT
        // is Toronto (largest), and Toronto is not the capital - Ottawa is.
        expect(cityTagsFor("Toronto", "Canada")).not.toContain("capital");
        expect(cityTagsFor("Sydney", "Australia")).not.toContain("capital");
        expect(cityTagsFor("New York City", "United States")).not.toContain("capital");
    });

    it("a shared name is settled by the country, and honest without one", () => {
        // London GB is a capital; London ON is not. Bare "London" returns the UNION of what
        // the name could mean - a bare name cannot claim more precision than it has.
        expect(cityTagsFor("London", "United Kingdom")).toContain("capital");
        expect(cityTagsFor("London", "Canada")).not.toContain("capital");
        expect(cityTagsFor("London")).toContain("capital");
    });

    it("unknown cities and junk return empty, never throw", () => {
        expect(cityTagsFor("Nowhereville")).toEqual([]);
        expect(cityTagsFor("")).toEqual([]);
        expect(cityTagsFor(null as any)).toEqual([]);
    });
});

describe("field-9 tags in the packed format", () => {
    it("a packed record can carry its own tags, and they merge with the overlay", () => {
        registerCityTable("Testopolis|ON|CA|-80|43|500|NW|;|port;unesco");
        try {
            const tags = cityTagsFor("Testopolis", "Canada");
            expect(tags).toContain("port");
            expect(tags).toContain("unesco");
        } finally {
            registerCityTable(CITY_PACKED);
        }
    });

    it("existing 8-field records parse exactly as before (no ninth field, no tags)", () => {
        expect(cityTagsFor("Denver", "United States")).toEqual([]);
    });
});
