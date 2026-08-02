// The COUNTRY tier: narrow a city name to the row's own country.
//
// This is the only part of the cascade that changes where an already-resolving row is
// placed, so the bar is: it must fix the cross-border cases and leave everything else
// bit-identical. The "unchanged when absent" block below is the load-bearing half.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, normalizeCountry, isGeoPointAmbiguity } from "../src/geoPoint";
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
    it("keeps a US Burlington out of Ontario — by REFUSING, not by picking (v2)", () => {
        // Pre-v2, bare "Burlington" placed at the larger Ontario one with a flag, and
        // country:"US" narrowed to… still SEVERAL US Burlingtons, silently resolved by
        // population. v2 refuses both: multiple possible matches are a call-out, not a
        // guess. Only a genuinely disambiguating attribute places the row.
        expect(isGeoPointAmbiguity(resolveGeoPoint({ city: "Burlington" }))).toBe(true);
        expect(isGeoPointAmbiguity(resolveGeoPoint({ city: "Burlington", country: "US" }))).toBe(true);

        const vt = resolveGeoPoint({ city: "Burlington", state: "VT", country: "US" }) as any;
        expect(vt.precision).toBe("city");
        expect(vt.lat).toBeCloseTo(44.48, 1);          // Vermont, exactly
        const on = resolveGeoPoint({ city: "Burlington", country: "CA" }) as any;
        expect(on.precision).toBe("city");             // only ONE Canadian Burlington
        expect(on.lat).toBeCloseTo(43.39, 1);
    });

    it("refuses to place a city in a country that has no such city", () => {
        // "Plano" exists only in Texas. On a Canadian row the honest answer is to fall
        // through to a coarser tier, NOT to draw a Canadian point in the US.
        const wrong = resolveGeoPoint({ city: "Plano" });
        expect(wrong!.lat).toBeCloseTo(33.02, 1);      // Plano, TX — confidently wrong

        // Falls through to the coarsest tier the cascade CAN support — which since the
        // World point map (2026-08-02) is the country centroid rather than nothing at all.
        // The contract this test exists for is unchanged and better served: the row is not
        // drawn in Texas, and `precision` states exactly how coarse the answer is.
        const right = resolveGeoPoint({ city: "Plano", country: "CA" });
        expect(right!.precision).toBe("country");
        expect(right!.lat).toBeGreaterThan(41);         // in Canada, not Plano TX (33.0)
        const withState = resolveGeoPoint({ city: "Plano", state: "ON", country: "CA" });
        expect(withState!.precision).toBe("state");
        expect(withState!.lat).toBeGreaterThan(42);     // Ontario centroid
    });

    it("distrusts a state that belongs to a different country than the row (v2: strict)", () => {
        // "CA" in the state slot on a Canadian row is California. Pre-v2 the resolver
        // DROPPED the suspicious state and placed the city; v2's rule is stricter — a
        // non-blank source attribute that matches nothing EXCLUDES the row at the city
        // tier, and the row falls to the country centroid, labelled as such. Coarser and
        // honest. The row-level guarantee that matters is unchanged: never Bakersfield.
        // (The CITY-precise recovery lives in resolvePointRoles, which refuses a country
        // column in the state slot at COLUMN level before the resolver ever runs — the
        // production path for exactly this data shape, tested below and in geoPointRoles.)
        const r = resolveGeoPoint({ city: "Burnaby", state: "CA", country: "CA" }) as any;
        expect(r.precision).toBe("country");
        expect(r.lat).toBeGreaterThan(41);              // in Canada, never Bakersfield
        // With the bad slot refused (what roles do), the city places exactly:
        const clean = resolveGeoPoint({ city: "Burnaby", country: "CA" }) as any;
        expect(clean.precision).toBe("city");
        expect(clean.lat).toBeGreaterThan(48);
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
            // A value that is not a country at all must NOT filter every candidate away.
            // (This used to say "France" — a fine stand-in while the resolver only knew
            // US/CA/MX, and wrong the moment it learned every nation. The CONTRACT is
            // unchanged; only an example that stopped being unrecognized was replaced.)
            expect(resolveGeoPoint({ ...c, country: "Freedonia" })).toEqual(base);
            expect(resolveGeoPoint({ ...c, country: "zzzz" })).toEqual(base);
        }
    });

    it("a REAL foreign country is recognized and refuses the NA match", () => {
        // The behaviour the widening exists to produce, and the one case where an
        // already-resolving row deliberately MOVES. "Paris, France" used to match Paris,
        // ONTARIO at city precision because FRA was unrecognized and narrowed nothing.
        const paris = resolveGeoPoint({ city: "Paris", country: "France" });
        expect(paris!.precision).toBe("country");
        expect(paris!.lon).toBeGreaterThan(0);          // Europe, not Ontario (-80)
        expect(paris!.lat).toBeCloseTo(47.3, 0);

        // …and a country that names no NA city at all still places, which is the whole
        // point of the tier for a world map.
        for (const [name, lonSign] of [["Japan", 1], ["Brazil", -1], ["ZAF", 1]] as const) {
            const r = resolveGeoPoint({ country: name });
            expect(r!.precision).toBe("country");
            expect(Math.sign(r!.lon)).toBe(lonSign);
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
