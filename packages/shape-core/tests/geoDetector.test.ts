import { describe, it, expect } from "vitest";
import { detectGeo, toGeoIso, buildGeoIsoColumn } from "../src/geoDetector";

// Geo/choropleth Phase 0 — the detector is the enabling SIGNAL. These lock the
// per-kind happy paths, the three known code collisions (ISO-2 vs USPS, ZIP vs
// county-FIPS, country-name vs US-state-name), multi-language name recognition
// (the 27-locale Intl union), the person-name false-positive guard, and the
// threshold edges.

describe("detectGeo — country codes", () => {
    it("ISO-3 alpha-3 → country-iso3, 100%", () => {
        const r = detectGeo(["USA", "CAN", "MEX", "FRA", "DEU"]);
        expect(r?.geoKind).toBe("country-iso3");
        expect(r?.geoMatchPct).toBe(100);
        expect(r?.geoAmbiguous).toBeUndefined();
    });

    it("ISO-2 with no US-state overlap → country-iso2, unambiguous", () => {
        // FR/JP/BR/GB/AU are none of them USPS codes.
        const r = detectGeo(["FR", "JP", "BR", "GB", "AU"]);
        expect(r?.geoKind).toBe("country-iso2");
        expect(r?.geoAmbiguous).toBeUndefined();
    });

    it("mixed casing / whitespace still resolves", () => {
        const r = detectGeo([" usa ", "Can", "mEx", "fra"]);
        expect(r?.geoKind).toBe("country-iso3");
    });
});

describe("detectGeo — country names (multi-language, 27-locale Intl union)", () => {
    it("English names → country-name", () => {
        const r = detectGeo(["United States", "Canada", "Mexico", "France", "Germany"]);
        expect(r?.geoKind).toBe("country-name");
        expect(r?.geoMatchPct).toBe(100);
    });

    it("French exonyms → country-name (proves non-English recognition)", () => {
        const r = detectGeo(["Allemagne", "Espagne", "Italie", "France", "Japon"]);
        expect(r?.geoKind).toBe("country-name");
    });

    it("German exonyms → country-name", () => {
        const r = detectGeo(["Deutschland", "Frankreich", "Spanien", "Italien", "Japan"]);
        expect(r?.geoKind).toBe("country-name");
    });

    it("alias overlay resolves colloquial forms Intl omits", () => {
        const r = detectGeo(["USA", "UK", "Holland", "Czech Republic", "South Korea"]);
        // "UK"/"USA" also read as codes, but the whole set clears as names too;
        // either way it must register as a geographic country dimension.
        expect(r).not.toBeNull();
        expect(["country-name", "country-iso2", "country-iso3"]).toContain(r?.geoKind);
    });

    it("diacritics are folded (Côte d'Ivoire, Perú)", () => {
        const r = detectGeo(["Cote d'Ivoire", "Peru", "Brazil", "Mexico", "Canada"]);
        expect(r?.geoKind).toBe("country-name");
    });
});

describe("detectGeo — US states", () => {
    it("USPS codes with no ISO-2 overlap → us-state-code", () => {
        const r = detectGeo(["TX", "NY", "FL", "WA", "OH"]);
        expect(r?.geoKind).toBe("us-state-code");
        expect(r?.geoAmbiguous).toBeUndefined();
    });

    it("state names → us-state-name", () => {
        const r = detectGeo(["California", "Texas", "New York", "Florida", "Ohio"]);
        expect(r?.geoKind).toBe("us-state-name");
    });

    it("common/traditional abbreviations (Calif., Fla., N.Y., Wash.) → us-state-name, 100%", () => {
        const r = detectGeo(["Calif.", "Fla.", "Tex.", "N.Y.", "Mass.", "Wash.", "Tenn."], "State");
        expect(r?.geoKind).toBe("us-state-name");
        expect(r?.geoMatchPct).toBe(100);
        // each normalizes to its USPS code regardless of the abbreviation style
        expect(toGeoIso("Calif.", "us-state-name")).toBe("CA");
        expect(toGeoIso("N.Y.", "us-state-name")).toBe("NY");
        expect(toGeoIso("W.Va.", "us-state-name")).toBe("WV");
    });

    it("a column MIXING codes + names + abbreviations still detects as one state column", () => {
        // Codes score us-state-code, names/abbrevs score us-state-name; neither alone
        // clears threshold, but they are the same concept so the union wins.
        const vals = ["California", "TX", "Fla.", "New York", "Wash.", "Ohio"];
        const r = detectGeo(vals, "State");
        expect(r?.geoKind).toBe("us-state-name");
        expect(r?.geoMatchPct).toBe(100);
        const b = buildGeoIsoColumn(vals, r!.geoKind);
        expect(b.iso).toEqual(["CA", "TX", "FL", "NY", "WA", "OH"]);
        expect(b.unmatched).toEqual([]);
    });

    it("toGeoIso is tolerant of the other form regardless of the detected kind", () => {
        // a stray full name in a code-detected column, and a stray code in a name column
        expect(toGeoIso("California", "us-state-code")).toBe("CA");
        expect(toGeoIso("TX", "us-state-name")).toBe("TX");
        expect(toGeoIso("Calif.", "us-state-code")).toBe("CA");
    });

    it("the mixed-form union does NOT disturb the ISO-2/USPS collision (pure codes)", () => {
        // All-code, no name-only values → keeps us-state-code + ambiguity flag.
        const r = detectGeo(["CA", "DE", "IN", "AL", "OR"]);
        expect(r?.geoKind).toBe("us-state-code");
        expect(r?.geoAmbiguous).toBe(true);
    });
});

describe("detectGeo — ZIP leading-zero recovery (Power BI numeric coercion)", () => {
    // Power BI / Excel coerce a ZIP column to a NUMBER, dropping leading zeros:
    // "01001" -> 1001, "00501" -> 501. toGeoIso must recover them; detection must
    // still classify a zip-named column even when many values are zero-stripped.
    it("toGeoIso pads a zero-stripped 4-digit ZIP back to 5", () => {
        expect(toGeoIso("1001", "us-zip5")).toBe("01001");
        expect(toGeoIso("501", "us-zip5")).toBe("00501");
        expect(toGeoIso("90210", "us-zip5")).toBe("90210");
    });
    it("a mixed 5-digit + zero-stripped column detects as us-zip5 (zip name token)", () => {
        const r = detectGeo(["35004", "90210", "1001", "2139", "601"], "ZipCode");
        expect(r?.geoKind).toBe("us-zip5");
        const b = buildGeoIsoColumn(["35004", "90210", "1001", "2139", "601"], "us-zip5");
        expect(b.iso).toEqual(["35004", "90210", "01001", "02139", "00601"]);
        expect(b.unmatched).toEqual([]);
    });
    it("bare 3-4 digit integers WITHOUT a zip name token do NOT read as ZIPs", () => {
        // a generic small-integer column must not misfire as a ZIP map
        expect(detectGeo(["1001", "2139", "601", "990", "3400"], "Count")).toBeNull();
    });
});

describe("detectGeo — US ZIP / county FIPS (numeric 5-digit)", () => {
    it("ZIPs with out-of-range prefixes → us-zip5, unambiguous", () => {
        // 90210 → prefix 90 is not a valid state FIPS, so this CAN'T be a county.
        const r = detectGeo(["90210", "10001", "94103", "98101", "85001"]);
        expect(r?.geoKind).toBe("us-zip5");
        expect(r?.geoAmbiguous).toBeUndefined();
    });

    it("all-valid-prefix 5-digit + no name → defaults to us-zip5 but flags ambiguous", () => {
        const r = detectGeo(["06037", "17031", "48201", "04013", "36061"]);
        expect(r?.geoKind).toBe("us-zip5");
        expect(r?.geoAmbiguous).toBe(true);
    });

    it("a 'FIPS' column name resolves the ambiguity to county", () => {
        const r = detectGeo(["06037", "17031", "48201", "04013", "36061"], "County FIPS");
        expect(r?.geoKind).toBe("us-county-fips");
        expect(r?.geoAmbiguous).toBeUndefined();
    });

    it("a 'ZIP' column name pins to ZIP", () => {
        const r = detectGeo(["06037", "17031", "48201", "04013", "36061"], "Zip Code");
        expect(r?.geoKind).toBe("us-zip5");
        expect(r?.geoAmbiguous).toBeUndefined();
    });
});

describe("detectGeo — ISO-2 vs USPS collision", () => {
    const collide = ["CA", "DE", "IN", "GA"]; // each is BOTH a country and a state

    it("no column name → default country-iso2, flagged ambiguous", () => {
        const r = detectGeo(collide);
        expect(r?.geoKind).toBe("country-iso2");
        expect(r?.geoAmbiguous).toBe(true);
    });

    it("'State' column name → us-state-code, unambiguous", () => {
        const r = detectGeo(collide, "State");
        expect(r?.geoKind).toBe("us-state-code");
        expect(r?.geoAmbiguous).toBeUndefined();
    });

    it("'Country' column name → country-iso2, unambiguous", () => {
        const r = detectGeo(collide, "Country");
        expect(r?.geoKind).toBe("country-iso2");
        expect(r?.geoAmbiguous).toBeUndefined();
    });

    it("mostly-clean state codes outweigh a lone shared code", () => {
        // CA is shared, but TX/NY/FL are USPS-only → states win cleanly.
        const r = detectGeo(["CA", "TX", "NY", "FL"]);
        expect(r?.geoKind).toBe("us-state-code");
    });
});

describe("detectGeo — guards & thresholds", () => {
    it("plain non-geo words → null", () => {
        expect(detectGeo(["apple", "banana", "cherry", "date", "fig"])).toBeNull();
    });

    it("below-threshold match → null", () => {
        // 5 real countries + 1 junk = 83.3% < 85.
        expect(detectGeo(["USA", "CAN", "MEX", "FRA", "DEU", "ZZZ"])).toBeNull();
    });

    it("a short person-name roster does NOT read as countries", () => {
        // Chad / Georgia / Jordan are all country names, but 3 distinct with no
        // geo column name trips the name-kind guard.
        expect(detectGeo(["Chad", "Georgia", "Jordan"])).toBeNull();
    });

    it("...but a geo column name lets the same roster resolve", () => {
        const r = detectGeo(["Chad", "Georgia", "Jordan"], "Country");
        expect(r?.geoKind).toBe("country-name");
    });

    it("a single distinct value is too degenerate → null", () => {
        expect(detectGeo(["USA", "USA", "usa"])).toBeNull();
    });

    it("empty / null-ish input → null", () => {
        expect(detectGeo([])).toBeNull();
        expect(detectGeo([null as unknown as string, undefined as unknown as string, ""])).toBeNull();
    });
});

describe("toGeoIso — deterministic normal form (__geoIso__ join key)", () => {
    it("country codes/names → ISO-3", () => {
        expect(toGeoIso("us", "country-iso2")).toBe("USA");
        expect(toGeoIso("USA", "country-iso3")).toBe("USA");
        expect(toGeoIso("Germany", "country-name")).toBe("DEU");
        expect(toGeoIso("Allemagne", "country-name")).toBe("DEU"); // French exonym
        expect(toGeoIso("UK", "country-name")).toBe("GBR");        // alias overlay
    });

    it("US states → USPS", () => {
        expect(toGeoIso("ca", "us-state-code")).toBe("CA");
        expect(toGeoIso("California", "us-state-name")).toBe("CA");
        expect(toGeoIso("Washington D.C.", "us-state-name")).toBe("DC");
    });

    it("ZIP strips the +4 extension; county FIPS validated", () => {
        expect(toGeoIso("90210-1234", "us-zip5")).toBe("90210");
        expect(toGeoIso("06037", "us-county-fips")).toBe("06037");
        expect(toGeoIso("99037", "us-county-fips")).toBeNull(); // prefix 99 invalid
    });

    it("unresolved values → null", () => {
        expect(toGeoIso("Narnia", "country-name")).toBeNull();
        expect(toGeoIso("ZZ", "country-iso2")).toBeNull();
        expect(toGeoIso("", "country-iso3")).toBeNull();
        expect(toGeoIso(null, "country-iso3")).toBeNull();
    });
});

describe("buildGeoIsoColumn — aligned column + unmatched ledger", () => {
    it("aligns 1:1, null-fills misses, collects distinct unmatched", () => {
        const col = buildGeoIsoColumn(
            ["United States", "Canada", "Atlantis", "Mexico", "Atlantis", null],
            "country-name",
        );
        expect(col.iso).toEqual(["USA", "CAN", null, "MEX", null, null]);
        expect(col.unmatched).toEqual(["Atlantis"]); // distinct, case-folded
        expect(col.matchedRows).toBe(3);
        expect(col.totalRows).toBe(6);
    });
});

describe("detectGeo - city-name (the point-map enabler)", () => {
    it("a city column is detected as city-name", () => {
        const r = detectGeo(["Plano", "Irvine", "Naperville", "Bellevue", "Scottsdale"], "City");
        expect(r?.geoKind).toBe("city-name");
        expect(r?.geoMatchPct).toBe(100);
    });

    it("REGION kinds outrank city even when the values are also cities", () => {
        // "New York", "Washington", "Mexico" and "Quebec" are all city names AND region
        // names. A column of them is far likelier the region, so city must not win.
        const states = detectGeo(["New York", "Washington", "California", "Texas", "Florida"], "State");
        expect(states?.geoKind).toBe("us-state-name");
        const countries = detectGeo(["Mexico", "Canada", "France", "Germany", "Japan"], "Country");
        expect(countries?.geoKind).toBe("country-name");
    });

    it("a person roster is NOT cities", () => {
        expect(detectGeo(["Alice", "Bob", "Carol", "Dave", "Erin"], "Owner")?.geoKind)
            .not.toBe("city-name");
    });

    it("a SHORT list of cities needs a city-ish column name (the dictionary guard)", () => {
        // 3 matches is under NAME_KIND_MIN_DISTINCT, so the column name decides.
        expect(detectGeo(["Plano", "Irvine", "Boulder"], "City")?.geoKind).toBe("city-name");
        expect(detectGeo(["Plano", "Irvine", "Boulder"], "Segment")?.geoKind).toBeUndefined();
    });

    it("non-US cities count too", () => {
        const r = detectGeo(["Mississauga", "Burnaby", "Laval", "Monterrey", "Guadalajara"], "City");
        expect(r?.geoKind).toBe("city-name");
    });
});
