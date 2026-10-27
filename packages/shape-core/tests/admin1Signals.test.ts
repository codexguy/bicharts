import { describe, it, expect, beforeEach } from "vitest";
import { registerAdmin1Lookup, clearAdmin1LookupForTests, type Admin1LookupDoc } from "../src/admin1Lookup";
import { measureAdmin1Columns, provinceIdForRow, buildProvinceIsoColumn } from "../src/admin1Signals";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// The hosted lookup's own format, with each city's province id and the code crosswalk the build stamps in.
const DOC: Admin1LookupDoc = {
    version: 1,
    cities: [
        "paris|FR|11|2138|48.85|2.35||FR-IDF",
        "lyon|FR|84|520|45.75|4.85||FR-ARA",
        "marseille|FR|93|870|43.30|5.37||FR-PAC",
        "munich|DE|02|1505|48.14|11.58|munchen|DE-BY",
        "nuremberg|DE|02|518|49.45|11.07|nurnberg|DE-BY",
        "berlin|DE|16|3426|52.52|13.41||DE-BE",
        "springfield|US|MO|170|37.22|-93.30||US-MO",
        "springfield|US|MA|154|42.10|-72.59||US-MA",
        "paris|US|TX|24|33.66|-95.56||US-TX",
    ].join("\n"),
    admin1: [
        "FR.11|ile de france|", "FR.84|auvergne rhone alpes|", "FR.93|provence alpes cote d azur|",
        "DE.02|bavaria|bayern", "DE.16|berlin|", "US.GA|georgia|", "GE.00|georgia|",
    ].join("\n"),
    crosswalk: ["FR.11|FR-IDF", "FR.84|FR-ARA", "FR.93|FR-PAC", "DE.02|DE-BY", "DE.16|DE-BE", "US.GA|US-GA", "GE.00|GE-TB"].join("\n"),
};

const col = (name: string, geoKind?: string, isMeasure = false) => ({ name, geoKind, isMeasure });

describe("province signals", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); });

    it("measures nothing until a host registers the lookup", () => {
        expect(measureAdmin1Columns([col("Province")], [["Bayern"], ["Berlin"], ["Ile de France"]]).size).toBe(0);
        expect(provinceIdForRow({ city: "Paris" })).toBeNull();
    });

    it("reads a column of ISO 3166-2 codes as admin1-code and says where its rows sit", () => {
        registerAdmin1Lookup(DOC);
        const s = measureAdmin1Columns([col("Code"), col("Revenue", undefined, true)],
            [["FR-IDF", 3], ["FR-ARA", 2], ["DE-BY", 1], ["DE-BE", 1], ["FR-PAC", 1]]).get(0)!;
        expect(s).toMatchObject({ kind: "admin1-code", matchPct: 100, regionCount: 5, countryCount: 2, dominantRegion: "europe", dominantRegionPct: 100 });
    });

    it("reads province names, narrowing a name two countries share by the row's country", () => {
        registerAdmin1Lookup(DOC);
        const named = measureAdmin1Columns([col("Province"), col("Country", "country-name")],
            [["Bayern", "Germany"], ["Berlin", "Germany"], ["Ile-de-France", "France"], ["Georgia", "United States"]]).get(0)!;
        expect(named).toMatchObject({ kind: "admin1-name", matchPct: 100, regionCount: 4, countryCount: 3 });
        // Without a country, Georgia means two provinces and is counted as ambiguous, never guessed.
        const bare = measureAdmin1Columns([col("State")], [["Bayern"], ["Berlin"], ["Georgia"]]).get(0)!;
        expect(bare.kind).toBe("admin1-name");
        expect(bare.matchPct).toBe(66.7);   // named like a province, so the lower floor admits it
        expect(bare.ambiguous).toBe(true);
    });

    it("leaves an unnamed column of mostly non-province values alone", () => {
        registerAdmin1Lookup(DOC);
        expect(measureAdmin1Columns([col("Product")], [["Bayern"], ["Widget"], ["Gadget"], ["Sprocket"]]).size).toBe(0);
    });

    it("measures how well a city column rolls up, by distinct (city, country) pair", () => {
        registerAdmin1Lookup(DOC);
        const s = measureAdmin1Columns([col("City", "city-name-world"), col("Sales", undefined, true)],
            [["Paris", 1], ["Lyon", 1], ["Munich", 1], ["Nürnberg", 1], ["Springfield", 1], ["Atlantis", 1]]).get(0)!;
        // 4 of 6 distinct cities place: Springfield is ambiguous and Atlantis unknown.
        expect(s).toMatchObject({ rollupPct: 66.7, regionCount: 3, countryCount: 2, dominantRegion: "europe" });
        expect(s.kind).toBeUndefined();
        // A country column settles Springfield.
        const withCountry = measureAdmin1Columns([col("City", "city-name"), col("Country", "country-iso2")],
            [["Springfield", "US"], ["Paris", "US"], ["Paris", "FR"]]).get(0)!;
        expect(withCountry.rollupPct).toBe(66.7);   // Springfield, US is still two states; both Parises place (2 of 3)
    });

    it("gives each row its province: the province value first, then the city", () => {
        registerAdmin1Lookup(DOC);
        expect(provinceIdForRow({ province: "fr-idf", provinceKind: "admin1-code" })).toBe("FR-IDF");
        expect(provinceIdForRow({ province: "Bayern", provinceKind: "admin1-name", city: "Paris" })).toBe("DE-BY");
        expect(provinceIdForRow({ city: "München" })).toBe("DE-BY");
        expect(provinceIdForRow({ city: "Paris", country: "US" })).toBe("US-TX");
        expect(provinceIdForRow({ city: "Springfield" })).toBeNull();
        expect(provinceIdForRow({ province: "Georgia", provinceKind: "admin1-name" })).toBeNull();
    });

    it("lands on the profile: a province column gains its kind through the real profiler", () => {
        registerAdmin1Lookup(DOC);
        const t = new IndexedText();
        t.setColumns([{ name: "Region", dataType: "String", isMeasure: false } as LLMColumnWithValue,
                      { name: "Revenue", dataType: "Decimal", isMeasure: true } as LLMColumnWithValue]);
        for (const [r, v] of [["Bayern", 10], ["Berlin", 20], ["Ile-de-France", 30], ["Auvergne-Rhone-Alpes", 15]] as const) t.addRow([r, v]);
        const region = t.getColumnsWithStats("10").find(c => c.name === "Region")!;
        expect(region.geoKind).toBe("admin1-name");
        expect(region.admin1RegionCount).toBe(4);
        expect(region.dominantGeoRegion).toBe("europe");
    });
});

describe("the province join column (province, then coordinates, then city)", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); registerAdmin1Lookup(DOC); });
    // A stand-in for the host's point-in-polygon: anything north of 47N is Bavaria, else no province.
    const locate = (lat: number, _lon: number) => (lat > 47 ? "DE-BY" : null);

    it("takes the province value first, and never overrides a filled one that names nothing", () => {
        const r = buildProvinceIsoColumn([
            { province: "Bayern", city: "Paris", lat: 48, lon: 11 },
            { province: "Atlantis", city: "Paris", lat: 48, lon: 11 },
        ], { provinceKind: "admin1-name", locate });
        expect(r.iso).toEqual(["DE-BY", null]);
        expect(r.source).toEqual(["province", null]);
        expect(r.unmatched).toEqual(["Atlantis"]);
    });

    it("fills a BLANK province from the coordinates, then from the city", () => {
        const r = buildProvinceIsoColumn([
            { province: "", city: "Paris", lat: 48.5, lon: 11 },      // coordinates win over the city
            { province: null, city: "Lyon", lat: 10, lon: 10 },       // the point places nowhere: the city
            { province: "", city: "Springfield" },                     // two states: ambiguous, counted
            { province: "", lat: 10, lon: 10 },                        // nothing else: an unplaced point
        ], { provinceKind: "admin1-name", locate });
        expect(r.iso).toEqual(["DE-BY", "FR-ARA", null, null]);
        expect(r.source).toEqual(["coordinates", "city", null, null]);
        expect(r.ambiguousRows).toBe(1);
        expect(r.ambiguousExamples).toEqual(["Springfield"]);
        expect(r.unplacedPoints).toBe(1);
        expect(r.matchedRows).toBe(2);
    });

    it("places by the province value alone when the reader does not derive provinces", () => {
        const r = buildProvinceIsoColumn([{ province: "Bayern" }, { province: "", city: "Paris", lat: 48.5, lon: 11 }],
            { provinceKind: "admin1-name", locate, deriveProvinces: false });
        expect(r.iso).toEqual(["DE-BY", null]);
        expect(r.unplacedPoints).toBe(0);
    });

    it("reads a US state column as US provinces with no lookup needed", () => {
        clearAdmin1LookupForTests();
        expect(buildProvinceIsoColumn([{ province: "California" }, { province: "TX" }], { provinceKind: "us-state-name" }).iso)
            .toEqual(["US-CA", "US-TX"]);
        expect(provinceIdForRow({ province: "ny", provinceKind: "us-state-code" })).toBe("US-NY");
    });

    it("places every row the same way in any subset that contains it", () => {
        const rows = [
            { province: "Bayern" }, { province: "", city: "Paris", country: "FR" }, { province: "", city: "Paris", country: "US" },
            { province: "", city: "Munchen" }, { province: "", lat: 48.2, lon: 11.6 }, { province: "", city: "Springfield" },
        ];
        const full = buildProvinceIsoColumn(rows, { provinceKind: "admin1-name", locate });
        rows.forEach((row, i) => {
            const one = buildProvinceIsoColumn([row], { provinceKind: "admin1-name", locate });
            expect(one.iso[0], `row ${i}`).toBe(full.iso[i]);
            expect(one.source[0], `row ${i}`).toBe(full.source[i]);
        });
    });
});

describe("towns the profile's gazetteer is too small to know", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); registerAdmin1Lookup(DOC); });

    it("an unclassified column of cities gains the rollup figures and no geo kind", () => {
        const s = measureAdmin1Columns([col("Branch City"), col("Sales", undefined, true)],
            [["Paris", 1], ["Lyon", 1], ["Marseille", 1], ["Munich", 1], ["Berlin", 1]]).get(0)!;
        expect(s.kind).toBeUndefined();
        expect(s).toMatchObject({ rollupPct: 100, regionCount: 5, countryCount: 2, dominantRegion: "europe" });
    });

    it("a short list needs a city-like name, so a roster that shares city names is left alone", () => {
        expect(measureAdmin1Columns([col("Agent")], [["Paris"], ["Lyon"], ["Berlin"]]).size).toBe(0);
        expect(measureAdmin1Columns([col("Town")], [["Paris"], ["Lyon"], ["Berlin"]]).get(0)?.rollupPct).toBe(100);
    });

    it("needs most values to be cities, and is skipped when the reader does not derive provinces", () => {
        expect(measureAdmin1Columns([col("City Code")], [["Paris"], ["Widget"], ["Gadget"], ["Lyon"], ["Sprocket"]]).size).toBe(0);
        expect(measureAdmin1Columns([col("Town")], [["Paris"], ["Lyon"], ["Berlin"]], { cities: false }).size).toBe(0);
    });
});

describe("a lookup that arrives after the first profile", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); });

    it("is measured once the host invalidates the stats", () => {
        const t = new IndexedText();
        t.setColumns([{ name: "Region", dataType: "String", isMeasure: false } as LLMColumnWithValue,
                      { name: "Revenue", dataType: "Decimal", isMeasure: true } as LLMColumnWithValue]);
        for (const [r, v] of [["Bayern", 10], ["Berlin", 20], ["Ile-de-France", 30]] as const) t.addRow([r, v]);
        expect(t.getColumnsWithStats("10").find(c => c.name === "Region")!.geoKind).toBeFalsy();
        registerAdmin1Lookup(DOC);
        expect(t.getColumnsWithStats("10").find(c => c.name === "Region")!.geoKind).toBeFalsy();   // cached
        t.invalidateStats();
        expect(t.getColumnsWithStats("10").find(c => c.name === "Region")!.geoKind).toBe("admin1-name");
    });
});
