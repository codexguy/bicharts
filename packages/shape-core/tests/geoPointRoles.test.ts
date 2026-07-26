// Role resolution for point geocoding: verify what the codegen response named, backfill
// what it left out, and refuse a country column in the state slot.
//
// The anchor case is a real production point map, reproduced verbatim below: the
// model saw City, StateCode and Country and answered {"city":"City"}. The rest exists to
// keep that fix from arriving with a worse bug attached.
import { describe, it, expect } from "vitest";
import {
    resolvePointRoles, looksLikeCountryColumn, admin1MatchPct, zipMatchPct,
} from "../src/geoPointRoles";
import { resolveGeoPoint } from "../src/geoPoint";

// The distinct (City, StateCode, Country) groups that map's visual actually sent.
const REAL_POINT_MAP = [
    { City: "Plano", StateCode: "TX", Country: "US" },
    { City: "Irvine", StateCode: "CA", Country: "US" },
    { City: "Scottsdale", StateCode: "AZ", Country: "US" },
    { City: "Naperville", StateCode: "IL", Country: "US" },
    { City: "Bellevue", StateCode: "WA", Country: "US" },
    { City: "Alpharetta", StateCode: "GA", Country: "US" },
    { City: "Sugar Land", StateCode: "TX", Country: "US" },
    { City: "Overland Park", StateCode: "KS", Country: "US" },
    { City: "Springfield", StateCode: "MO", Country: "US" },
    { City: "Springfield", StateCode: "IL", Country: "US" },
    { City: "Springfield", StateCode: "MA", Country: "US" },
    { City: "Springfield", StateCode: "OR", Country: "US" },
    { City: "Springfield", StateCode: "", Country: "US" },
    { City: "Burlington", StateCode: "", Country: "US" },
    { City: "Mississauga", StateCode: "ON", Country: "CA" },
    { City: "Laval", StateCode: "", Country: "CA" },
    { City: "Burnaby", StateCode: "BC", Country: "CA" },
    { City: "Montréal", StateCode: "QC", Country: "CA" },
    { City: "Plano", StateCode: "ON", Country: "CA" },
    { City: "Guadalajara", StateCode: "", Country: "MX" },
];
const DIMS = ["City", "StateCode", "Country"];

describe("the model named only the city", () => {
    it("backfills the state column the response left out", () => {
        const r = resolvePointRoles(DIMS, REAL_POINT_MAP, { city: "City" });
        expect(r.bind?.city).toBe("City");
        expect(r.bind?.state).toBe("StateCode");
        expect(r.backfilled.join()).toMatch(/^state=StateCode/);
        expect(r.refused).toEqual([]);
    });

    it("never adopts Country as the state", () => {
        const r = resolvePointRoles(DIMS, REAL_POINT_MAP, { city: "City" });
        expect(r.bind?.state).not.toBe("Country");
    });

    it("places Plano/ON in Ontario once the state is bound, not in Texas", () => {
        // The whole point of the backfill. Without a state, "Plano" is unique in the city
        // table and resolves CONFIDENTLY to Plano, Texas — a Canadian row drawn in the US,
        // and not even flagged ambiguous, because the NAME was never ambiguous.
        const noState = resolveGeoPoint({ city: "Plano" });
        expect(noState).toMatchObject({ precision: "city" });
        expect(noState!.lat).toBeCloseTo(33.02, 1);   // Plano, TX
        expect(noState!.ambiguous).toBeFalsy();

        const withState = resolveGeoPoint({ city: "Plano", state: "ON" });
        expect(withState!.lat).toBeGreaterThan(42);   // Ontario
        expect(withState!.precision).toBe("state");   // contradiction guard fell through
    });

    it("disambiguates the Springfields instead of stacking them on Missouri", () => {
        const bare = resolveGeoPoint({ city: "Springfield" });
        expect(bare!.ambiguous).toBe(true);
        const il = resolveGeoPoint({ city: "Springfield", state: "IL" });
        expect(il!.ambiguous).toBeFalsy();
        expect(il!.lat).not.toBeCloseTo(bare!.lat, 1);
    });
});

describe("the \"CA\" trap — a country column in the state slot", () => {
    const rows = [
        { City: "Mississauga", Country: "CA" },
        { City: "Montreal", Country: "CA" },
        { City: "Burnaby", Country: "CA" },
        { City: "Laval", Country: "CA" },
    ];

    it("refuses an all-country column hinted as the state", () => {
        const r = resolvePointRoles(["City", "Country"], rows, { city: "City", state: "Country" });
        expect(r.bind?.state).toBeUndefined();
        expect(r.refused.join()).toMatch(/state=Country/);
        expect(r.bind?.city).toBe("City");        // the rest of the binding survives
    });

    it("would otherwise pile every Canadian city into California", () => {
        // Documents the damage the refusal prevents: "CA" is the ONE country identifier
        // that collides with an admin1, and it is California.
        const wrong = rows.map(x => resolveGeoPoint({ city: x.City, state: x.Country }));
        for (const w of wrong) {
            expect(w!.precision).toBe("state");
            expect(w!.lat).toBeCloseTo(35.2, 1);   // central California, ~2000km off
        }
    });

    it("still refuses when Canada is the only value present", () => {
        // The narrow, catastrophic case: a single-value country column resolves to a real
        // admin1 at 100%, so a match-rate test alone would wave it through.
        const only = [{ City: "Burnaby", Country: "CA" }];
        const r = resolvePointRoles(["City", "Country"], only, { city: "City", state: "Country" });
        expect(r.bind?.state).toBeUndefined();
    });

    it("does NOT refuse a real state column that contains California", () => {
        const us = [
            { City: "Irvine", State: "CA" }, { City: "Plano", State: "TX" },
            { City: "Naperville", State: "IL" },
        ];
        const r = resolvePointRoles(["City", "State"], us, { city: "City", state: "State" });
        expect(r.bind?.state).toBe("State");
        expect(r.refused).toEqual([]);
    });
});

describe("classifiers", () => {
    it("looksLikeCountryColumn wants EVERY value to be a country", () => {
        expect(looksLikeCountryColumn(["US", "CA", "MX"])).toBe(true);
        expect(looksLikeCountryColumn(["Canada", "Mexico", "United States"])).toBe(true);
        expect(looksLikeCountryColumn(["CA"])).toBe(true);
        expect(looksLikeCountryColumn(["CA", "TX"])).toBe(false);   // a US state column
        expect(looksLikeCountryColumn([])).toBe(false);
        expect(looksLikeCountryColumn([null, "", "  "])).toBe(false);
    });

    it("admin1MatchPct separates a state column from a country column", () => {
        expect(admin1MatchPct(["TX", "CA", "IL", "ON", "QC"])).toBe(100);
        expect(admin1MatchPct(["US", "CA", "MX"])).toBeCloseTo(33.3, 0);
        expect(admin1MatchPct(["Texas", "Ontario", "Jalisco"])).toBe(100);
    });

    it("zipMatchPct reads ZIP+4 and Excel-stripped ZIPs", () => {
        expect(zipMatchPct(["90210", "10001", "60614"])).toBe(100);
        expect(zipMatchPct(["90210-1234"])).toBe(100);   // punctuation survives
        expect(zipMatchPct(["1001"])).toBe(100);         // lost leading zero
        expect(zipMatchPct(["ABCDE"])).toBe(0);
    });
});

describe("what must NOT be adopted", () => {
    it("does not backfill a ZIP role from a measure-shaped run of 5-digit numbers", () => {
        // Callers exclude measures, but the classifier must not depend on that: revenue
        // figures are digits, and a 5-digit run is a syntactically perfect ZIP column.
        const rows = [
            { City: "Plano", Revenue: 54300 }, { City: "Irvine", Revenue: 48900 },
            { City: "Bellevue", Revenue: 33700 }, { City: "Alpharetta", Revenue: 184200 },
        ];
        const r = resolvePointRoles(["City", "Revenue"], rows, { city: "City" });
        expect(r.bind?.zip).toBeUndefined();
    });

    it("does not claim a role from a single coincidental match", () => {
        const rows = [{ City: "Plano", Tag: "CA" }, { City: "Irvine", Tag: "premium" }];
        const r = resolvePointRoles(["City", "Tag"], rows, { city: "City" });
        expect(r.bind?.state).toBeUndefined();
    });

    it("ignores host metadata columns", () => {
        const rows = [{ City: "Plano", __geoLat__: 33.02 }, { City: "Irvine", __geoLat__: 33.67 }];
        const r = resolvePointRoles(["City", "__geoLat__"], rows, { city: "City" });
        expect(Object.values(r.bind ?? {})).not.toContain("__geoLat__");
    });

    it("drops a hinted column that is no longer present", () => {
        const r = resolvePointRoles(["City"], [{ City: "Plano" }], { city: "City", state: "Gone" });
        expect(r.bind?.state).toBeUndefined();
        expect(r.bind?.city).toBe("City");
    });

    it("returns a null bind when nothing resolves", () => {
        const rows = [{ Widget: "sprocket" }, { Widget: "flange" }];
        const r = resolvePointRoles(["Widget"], rows, {});
        expect(r.bind).toBeNull();
    });
});

describe("backfill beyond the state", () => {
    it("finds the city when the hint had only a state", () => {
        const rows = [
            { Town: "Plano", ST: "TX" }, { Town: "Irvine", ST: "CA" },
            { Town: "Naperville", ST: "IL" },
        ];
        const r = resolvePointRoles(["Town", "ST"], rows, { state: "ST" });
        expect(r.bind?.city).toBe("Town");
        expect(r.backfilled.join()).toMatch(/city=Town/);
    });

    it("finds a real ZIP column", () => {
        const rows = [{ Z: "90210" }, { Z: "10001" }, { Z: "60614" }];
        const r = resolvePointRoles(["Z"], rows, {});
        expect(r.bind?.zip).toBe("Z");
    });

    it("leaves an explicit lat/lon binding alone", () => {
        const rows = [{ La: 47.61, Lo: -122.33, City: "seattle" }];
        const r = resolvePointRoles(["La", "Lo", "City"], rows, { lat: "La", lon: "Lo" });
        expect(r.bind?.lat).toBe("La");
        expect(r.bind?.lon).toBe("Lo");
    });
});
