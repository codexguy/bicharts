// A FAILED HINT IS NOT AN ANSWER — IT IS A REASON TO LOOK AT THE DATA.
//
// The module's doctrine is that the codegen response NAMES the point roles and the host
// VERIFIES them (see the header of geoPointRoles.ts). The state role has always finished that
// sentence: refuse what fails, then resolve the role from the values. Country only did the
// first half — a hinted column owned the slot whether or not it verified, so the backfill that
// would have found a good column never ran.
//
// Found on a real world_country_metrics dataset, 2026-08-02, on the build that was supposed to
// have fixed exactly this: the server named `Country` (full names; 42 of 44 distinct resolve,
// which is 95.5% — the two misses are the deliberate "Freedonia" and "Global (unassigned)"
// rows) while `CountryCode` sat beside it, clean ISO-3 at 100% because those two rows leave
// the code blank. The World map placed NOTHING. An empty hint on the same table placed 42.
import { describe, it, expect } from "vitest";
import { resolvePointRoles, looksLikeCountryColumn } from "../src/geoPointRoles";

// The real dataset, trimmed to the columns that matter and to the shape that broke: a run of
// clean countries plus the two junk rows that put the NAME column just under the bar.
const ROWS = [
    ["United States", "USA"], ["Brazil", "BRA"], ["Canada", "CAN"], ["Mexico", "MEX"],
    ["France", "FRA"], ["Germany", "DEU"], ["United Kingdom", "GBR"], ["Spain", "ESP"],
    ["Italy", "ITA"], ["Netherlands", "NLD"], ["Poland", "POL"], ["Sweden", "SWE"],
    ["Japan", "JPN"], ["China", "CHN"], ["India", "IND"], ["Australia", "AUS"],
    ["Indonesia", "IDN"], ["Singapore", "SGP"], ["South Korea", "KOR"], ["Viet Nam", "VNM"],
    ["South Africa", "ZAF"], ["Nigeria", "NGA"], ["Kenya", "KEN"], ["Egypt", "EGY"],
    ["Freedonia", ""], ["Global (unassigned)", ""],
].map(([Country, CountryCode]) => ({ Country, CountryCode, Region: "Americas" }));

const COLS = ["Country", "CountryCode", "Region"];

describe("an unproven country hint falls through to a column that verifies", () => {
    it("the setup: the hinted column is just under the bar, its neighbour is over it", () => {
        expect(looksLikeCountryColumn(ROWS.map(r => r.Country))).toBe(false);
        expect(looksLikeCountryColumn(ROWS.map(r => r.CountryCode))).toBe(true);
    });

    it("places from the proven column instead of refusing the map", () => {
        const r = resolvePointRoles(COLS, ROWS, { country: "Country" }, "world");
        expect(r.bind).not.toBeNull();
        expect(r.bind!.country).toBe("CountryCode");
        expect(r.backfilled).toContain("country=CountryCode");
    });

    it("says what it did, naming both columns", () => {
        // The swap is invisible on the chart, so it has to be legible in the log — this is the
        // line that would have made the original diagnosis a minute's work instead of an hour's.
        const r = resolvePointRoles(COLS, ROWS, { country: "Country" }, "world");
        const why = r.refused.join(" ");
        expect(why).toMatch(/country=Country/);
        expect(why).toMatch(/using CountryCode instead/);
    });

    it("an empty hint and a bad hint now reach the same place", () => {
        // The tell that something was wrong: naming a column did WORSE than naming nothing.
        const hinted = resolvePointRoles(COLS, ROWS, { country: "Country" }, "world");
        const blank = resolvePointRoles(COLS, ROWS, {}, "world");
        expect(hinted.bind).toEqual(blank.bind);
    });

    it("a hint that VERIFIES is still honored over its neighbours", () => {
        // The swap must be a fallback, not a preference — a good hint is the disambiguator the
        // header describes and it keeps winning.
        const r = resolvePointRoles(COLS, ROWS, { country: "CountryCode" }, "world");
        expect(r.bind!.country).toBe("CountryCode");
        expect(r.refused).toEqual([]);
        expect(r.backfilled).toEqual([]);
    });

    it("keeps a failed hint as a narrowing constraint when nothing else verifies", () => {
        // Unchanged behavior, and deliberately so: country also narrows city matching, where an
        // unrecognized value is a harmless no-op. With a city to place from, the map still draws.
        const rows = [{ City: "Boston", Ctry: "Freedonia" }, { City: "Denver", Ctry: "Sylvania" }];
        const r = resolvePointRoles(["City", "Ctry"], rows, { city: "City", country: "Ctry" }, "world");
        expect(r.bind!.country).toBe("Ctry");
        expect(r.bind!.city).toBe("City");
    });
});
