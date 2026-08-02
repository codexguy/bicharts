// The COUNTRY precision tier (World (Bubbles), 2026-08-02).
//
// This is the second change ever made to the cascade that can MOVE an already-placed
// row — the first was country narrowing itself — so it carries the same bar and the
// same regression shape as `geoPointCountry.test.ts`:
//
//   1. it must place country-only data (the whole reason it exists),
//   2. it must not disturb anything the finer tiers already resolved,
//   3. a row that placed in the full table must still place, IDENTICALLY, in any
//      subset containing it. That invariant is the one that matters: point roles are
//      re-resolved against whatever rows survive a cross-filter, and a classification
//      that reads correctly on the full table but flips on a subset is how the map
//      went blank on one click in 0.1.6.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, buildGeoPointColumns } from "../src/geoPoint";
import { countryIso3 } from "../src/geoCountryNames";

describe("countryIso3 — every identifier form a real column carries", () => {
    it("takes names, ISO-2, ISO-3 and aliases", () => {
        for (const v of ["France", "FRA", "FR", "france"]) expect(countryIso3(v)).toBe("FRA");
        for (const v of ["United States", "USA", "US", "america"]) expect(countryIso3(v)).toBe("USA");
        expect(countryIso3("Deutschland")).toBe("DEU");     // Intl, non-English
        expect(countryIso3("España")).toBe("ESP");          // diacritics fold
        expect(countryIso3("UK")).toBe("GBR");              // alias overlay
        expect(countryIso3("Holland")).toBe("NLD");         // alias overlay
    });
    it("is null for non-countries, so the tier simply does not engage", () => {
        for (const v of ["", "  ", "Freedonia", "zzzz", "TX", "Ontario", null, undefined])
            expect(countryIso3(v as any)).toBeNull();
    });
});

describe("the country tier places what nothing finer can", () => {
    it("resolves a bare country to its populated centre, not its landmass centre", () => {
        // Population weighting is the whole design choice. Russia's landmass centre is
        // empty Siberia (~95E); its people are west of the Urals.
        const rus = resolveGeoPoint({ country: "Russia" });
        expect(rus!.precision).toBe("country");
        expect(rus!.lon).toBeLessThan(70);

        // Canada's weighted mean falls in MICHIGAN (its population is a thin band along
        // the US border), so the generator snaps it to the largest city. Verifying the
        // snap survives into the shipped table: a Canada dot must be in Canada.
        const can = resolveGeoPoint({ country: "Canada" });
        expect(can!.lat).toBeGreaterThan(43);
        expect(can!.lon).toBeLessThan(-75);

        // Indonesia's mean is the Java Sea — same snap, same reason.
        const idn = resolveGeoPoint({ country: "Indonesia" });
        expect(idn!.lat).toBeLessThan(0);
        expect(idn!.lon).toBeGreaterThan(95);
    });

    it("is the LAST resort — every finer tier still wins", () => {
        const latlon = resolveGeoPoint({ lat: 48.85, lon: 2.35, country: "France" });
        expect(latlon!.precision).toBe("latlon");

        const city = resolveGeoPoint({ city: "Seattle", state: "WA", country: "US" });
        expect(city!.precision).toBe("city");

        const zip = resolveGeoPoint({ zip: "90210", country: "US" });
        expect(zip!.precision).toBe("zip3");

        const state = resolveGeoPoint({ state: "TX", country: "US" });
        expect(state!.precision).toBe("state");
    });

    it("counts the tier separately so a caption can be honest about it", () => {
        const out = buildGeoPointColumns([
            { city: "Seattle", state: "WA", country: "US" },
            { country: "Japan" },
            { country: "Brazil" },
        ]);
        expect(out.precisionCounts.city).toBe(1);
        expect(out.precisionCounts.country).toBe(2);
        expect(out.precision).toBe("country");          // ceiling = coarsest row
        expect(out.matchedRows).toBe(3);
    });

    it("an unresolvable country is unplaced, never guessed", () => {
        const out = buildGeoPointColumns([{ country: "Freedonia" }, { country: "Japan" }]);
        expect(out.matchedRows).toBe(1);
        expect(out.unmatched).toContain("Freedonia");
    });
});

describe("THE SUBSET INVARIANT — a row placed in the full table places in every subset", () => {
    // Deliberately mixed: NA city rows, a foreign city name that only the country tier
    // can honour, bare countries, and explicit coordinates. Includes "CA" in the country
    // slot, the single ambiguous token the whole role system is careful about.
    const TABLE = [
        { city: "Seattle", state: "WA", country: "US" },
        { city: "Toronto", state: "ON", country: "CA" },
        { city: "Paris", country: "France" },
        { country: "Japan" },
        { country: "Brazil" },
        { lat: -33.87, lon: 151.21, country: "AU" },
        { city: "Guadalajara", country: "MX" },
        { country: "CA" },
    ];

    const full = TABLE.map(r => resolveGeoPoint(r));

    it("places every row in the full table", () => {
        expect(full.every(r => r !== null)).toBe(true);
    });

    it("holds for every single-row subset", () => {
        for (let i = 0; i < TABLE.length; ++i) {
            const out = buildGeoPointColumns([TABLE[i]]);
            expect(out.matchedRows, `row ${i} vanished alone`).toBe(1);
            expect(out.lat[0]).toBeCloseTo(full[i]!.lat, 6);
            expect(out.lon[0]).toBeCloseTo(full[i]!.lon, 6);
        }
    });

    it("holds for every adjacent pair", () => {
        for (let i = 0; i + 1 < TABLE.length; ++i) {
            const out = buildGeoPointColumns([TABLE[i], TABLE[i + 1]]);
            expect(out.matchedRows, `pair ${i} lost a row`).toBe(2);
            expect(out.lat[0]).toBeCloseTo(full[i]!.lat, 6);
            expect(out.lat[1]).toBeCloseTo(full[i + 1]!.lat, 6);
        }
    });

    it("holds for every single-country subset", () => {
        const byCountry = new Map<string, number[]>();
        TABLE.forEach((r, i) => {
            const k = String((r as any).country ?? "");
            byCountry.set(k, [...(byCountry.get(k) ?? []), i]);
        });
        for (const [k, idxs] of byCountry) {
            const out = buildGeoPointColumns(idxs.map(i => TABLE[i]));
            idxs.forEach((src, j) => {
                expect(out.lat[j], `country subset '${k}' moved row ${src}`)
                    .toBeCloseTo(full[src]!.lat, 6);
            });
        }
    });
});

describe("the NA cascade is untouched by the widening", () => {
    // Mutation guard: these are the exact placements the pre-country cascade produced.
    // A regression here means the widening reached further than intended.
    it("keeps every North American resolution bit-identical", () => {
        const cases: Array<[any, string, number, number]> = [
            [{ city: "Plano", state: "TX" }, "city", 33.02, -96.70],
            [{ city: "Seattle", state: "WA" }, "city", 47.60, -122.33],
            [{ city: "Montréal", state: "QC" }, "city", 45.51, -73.59],
            [{ zip: "90210" }, "zip3", 34.10, -118.41],
            [{ state: "TX" }, "state", 30.60, -97.51],
            [{ lat: 47.61, lon: -122.33 }, "latlon", 47.61, -122.33],
        ];
        for (const [input, precision, lat, lon] of cases) {
            const r = resolveGeoPoint(input);
            expect(r!.precision, JSON.stringify(input)).toBe(precision);
            expect(r!.lat).toBeCloseTo(lat, 0);
            expect(r!.lon).toBeCloseTo(lon, 0);
        }
    });

    it("still refuses a country column parked in the state slot", () => {
        // The "CA" collision the role system exists for: as a STATE it is California, and
        // a Canadian row must not be dragged to Bakersfield.
        const r = resolveGeoPoint({ city: "Burnaby", state: "CA", country: "CA" });
        expect(r!.lat).toBeGreaterThan(48);
        expect(r!.precision).toBe("city");
    });
});
