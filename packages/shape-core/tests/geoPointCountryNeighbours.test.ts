// AN AMBIGUOUS TOKEN IS SETTLED BY THE COMPANY IT KEEPS.
//
// Joel, 2026-08-02: "CA" should be read as "Canada" when there are other countries that
// identify in the same column (e.g. US, DE, IT), and as "California" when there are other
// states that identify in the same column (e.g. CO, FL, WA). Plus "a minimum ratio of
// successful matches against the gazette (e.g. 97% - if data quality is worse, it's the
// user's responsibility to clean it)".
//
// This became load-bearing when country detection went global. Against a US/CA/MX-only
// vocabulary "CA" was the ONLY token that could be read both ways; against all 195 countries
// there are around seventeen (IL Israel/Illinois, IN India/Indiana, DE Germany/Delaware,
// CO Colombia/Colorado, LA Laos/Louisiana, PA Panama/Pennsylvania...). A rule that resolves
// them one at a time would be a growing list of special cases; deciding by the column's
// unambiguous members is one rule that covers all of them and any added later.
import { describe, it, expect } from "vitest";
import { looksLikeCountryColumn, admin1MatchPct, countryMatchPct, resolvePointRoles } from "../src/geoPointRoles";

describe("an ambiguous code is decided by its neighbours", () => {
    it("CA reads as CANADA beside other countries", () => {
        expect(looksLikeCountryColumn(["US", "CA", "DE", "IT"])).toBe(true);
    });

    it("CA reads as CALIFORNIA beside other states", () => {
        expect(looksLikeCountryColumn(["CA", "CO", "FL", "WA"])).toBe(false);
        expect(admin1MatchPct(["CA", "CO", "FL", "WA"])).toBe(100);
    });

    it("the same rule settles CO, which is Colorado here and Colombia there", () => {
        expect(looksLikeCountryColumn(["CO", "TX", "FL"])).toBe(false);        // US states
        expect(looksLikeCountryColumn(["CO", "BR", "AR", "PE"])).toBe(true);   // South America
    });

    it("and DE, which is Delaware here and Germany there", () => {
        expect(looksLikeCountryColumn(["DE", "MD", "NJ", "PA"])).toBe(false);  // mid-Atlantic
        expect(looksLikeCountryColumn(["DE", "FR", "NL", "BE"])).toBe(true);   // western Europe
    });

    it("decides NOTHING from an ambiguous token alone", () => {
        // The cross-filter case, and the reason this cannot simply prefer one reading: one
        // Californian row surviving a click must not turn its StateCode column into "Canada"
        // and blank the map.
        expect(looksLikeCountryColumn(["CA"])).toBe(false);
        expect(resolvePointRoles(["Col"], [{ Col: "CA" }], {}).bind).toBeNull();
    });
});

describe("the gazetteer match ratio", () => {
    const MANY = ["US", "DE", "IT", "JP", "FR", "BR", "IN", "CN", "AU", "MX", "ES", "PT", "NL",
        "BE", "SE", "NO", "FI", "DK", "PL", "AT", "CH", "IE", "NZ", "ZA", "EG", "NG", "KE",
        "AR", "CL", "PE", "TH", "VN", "PH", "ID", "MY", "SG", "KR", "TR", "GR", "HU"];

    it("a clean country column scores 100", () => {
        expect(countryMatchPct(MANY)).toBe(100);
        expect(looksLikeCountryColumn(MANY)).toBe(true);
    });

    it("one sentinel in a large clean column stays above the bar", () => {
        // 40 of 41 = 97.6%. The old all-or-nothing rule failed this outright, so a single
        // "N/A" cost the column its country role and the map its placement.
        const withJunk = [...MANY, "N/A"];
        expect(countryMatchPct(withJunk)).toBeGreaterThanOrEqual(97);
        expect(looksLikeCountryColumn(withJunk)).toBe(true);
    });

    it("genuinely dirty data is refused - that is the user's to clean", () => {
        expect(countryMatchPct(["US", "DE", "IT", "JP", "N/A"])).toBeLessThan(97);
        expect(looksLikeCountryColumn(["US", "DE", "IT", "JP", "N/A"])).toBe(false);
    });

    it("a column of something else never claims the role", () => {
        expect(looksLikeCountryColumn(["Widget", "Gadget", "Sprocket"])).toBe(false);
    });
});
