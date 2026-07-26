// The COUNTRY tier: narrow a city name to the row's own country.
//
// This is the only part of the cascade that changes where an already-resolving row is
// placed, so the bar is: it must fix the cross-border cases and leave everything else
// bit-identical. The "unchanged when absent" block below is the load-bearing half.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, normalizeCountry } from "../src/geoPoint";
import { resolvePointRoles } from "../src/geoPointRoles";

describe("normalizeCountry", () => {
    it("maps the spellings that appear in real data", () => {
        for (const v of ["US", "usa", "U.S.", "United States", "america"])
            expect(normalizeCountry(v)).toBe("US");
        for (const v of ["CA", "can", "Canada"]) expect(normalizeCountry(v)).toBe("CA");
        for (const v of ["MX", "mex", "Mexico", "México"]) expect(normalizeCountry(v)).toBe("MX");
    });
    it("is null for anything outside the bundled tables", () => {
        expect(normalizeCountry("France")).toBeNull();
        expect(normalizeCountry("TX")).toBeNull();      // a state is not a country
        expect(normalizeCountry("")).toBeNull();
        expect(normalizeCountry(null)).toBeNull();
    });
});

describe("country narrowing fixes the cross-border placements", () => {
    it("keeps a US Burlington out of Ontario", () => {
        // The larger Burlington is in Ontario, so the bare name resolves there.
        const bare = resolveGeoPoint({ city: "Burlington" });
        expect(bare!.lat).toBeCloseTo(43.39, 1);
        expect(bare!.ambiguous).toBe(true);

        const us = resolveGeoPoint({ city: "Burlington", country: "US" });
        expect(us!.lat).toBeLessThan(43);              // Vermont/NC, not Ontario
        expect(us!.precision).toBe("city");
    });

    it("refuses to place a city in a country that has no such city", () => {
        // "Plano" exists only in Texas. On a Canadian row the honest answer is to fall
        // through to a coarser tier, NOT to draw a Canadian point in the US.
        const wrong = resolveGeoPoint({ city: "Plano" });
        expect(wrong!.lat).toBeCloseTo(33.02, 1);      // Plano, TX — confidently wrong

        const right = resolveGeoPoint({ city: "Plano", country: "CA" });
        expect(right).toBeNull();                       // nothing else to go on
        const withState = resolveGeoPoint({ city: "Plano", state: "ON", country: "CA" });
        expect(withState!.precision).toBe("state");
        expect(withState!.lat).toBeGreaterThan(42);     // Ontario centroid
    });

    it("distrusts a state that belongs to a different country than the row", () => {
        // "CA" in the state slot on a Canadian row is California. The country wins.
        const r = resolveGeoPoint({ city: "Burnaby", state: "CA", country: "CA" });
        expect(r!.lat).toBeGreaterThan(48);             // Burnaby BC, not Bakersfield
        expect(r!.precision).toBe("city");
    });

    it("resolves an ambiguous name unambiguously once the country is known", () => {
        const bare = resolveGeoPoint({ city: "Burlington" });
        const ca = resolveGeoPoint({ city: "Burlington", country: "CA" });
        expect(bare!.ambiguous).toBe(true);
        expect(ca!.ambiguous).toBeFalsy();              // only one Burlington in Canada
        expect(ca!.lat).toBeCloseTo(43.39, 1);
    });
});

describe("country changes NOTHING when absent or unrecognized", () => {
    const CASES = [
        { city: "Plano", state: "TX" },
        { city: "Springfield" },
        { city: "Springfield", state: "IL" },
        { city: "Montréal", state: "QC" },
        { city: "Guadalajara" },
        { city: "seattle", state: "wa" },
        { zip: "90210" },
        { state: "TX" },
        { lat: 47.61, lon: -122.33 },
        { city: "Nowherecityville" },
    ];
    it("is identical with country omitted vs country=null vs an unknown country", () => {
        for (const c of CASES) {
            const base = resolveGeoPoint(c);
            expect(resolveGeoPoint({ ...c, country: null })).toEqual(base);
            expect(resolveGeoPoint({ ...c, country: "" })).toEqual(base);
            // An unrecognized country must NOT filter every candidate away.
            expect(resolveGeoPoint({ ...c, country: "France" })).toEqual(base);
        }
    });

    it("a correct country agrees with the no-country answer", () => {
        // Where the data was already right, narrowing must be a no-op.
        for (const c of [
            { city: "Plano", state: "TX", country: "US" },
            { city: "Montréal", state: "QC", country: "CA" },
            { city: "Guadalajara", country: "MX" },
            { city: "Irvine", state: "CA", country: "US" },
        ]) {
            const { country, ...without } = c;
            expect(resolveGeoPoint(c)).toEqual(resolveGeoPoint(without));
        }
    });
});

describe("the country ROLE", () => {
    const rows = [
        { City: "Burlington", Country: "US" },
        { City: "Plano", Country: "US" },
        { City: "Mississauga", Country: "CA" },
    ];

    it("is backfilled from an all-country column", () => {
        const r = resolvePointRoles(["City", "Country"], rows, { city: "City" });
        expect(r.bind?.country).toBe("Country");
        expect(r.backfilled.join()).toMatch(/country=Country/);
    });

    it("promotes a country column that was wrongly hinted as the state", () => {
        // Refusing it is only half the job — as the COUNTRY role it still does real work.
        const r = resolvePointRoles(["City", "Country"], rows, { city: "City", state: "Country" });
        expect(r.bind?.state).toBeUndefined();
        expect(r.refused.join()).toMatch(/state=Country/);
        expect(r.bind?.country).toBe("Country");
    });

    it("does not treat a country column alone as a placeable binding", () => {
        const only = [{ Country: "US" }, { Country: "CA" }];
        const r = resolvePointRoles(["Country"], only, {});
        expect(r.bind).toBeNull();
    });

    it("never adopts a state column as the country", () => {
        const us = [{ City: "Plano", State: "TX" }, { City: "Irvine", State: "CA" }];
        const r = resolvePointRoles(["City", "State"], us, { city: "City" });
        expect(r.bind?.country).toBeUndefined();
        expect(r.bind?.state).toBe("State");
    });
});
