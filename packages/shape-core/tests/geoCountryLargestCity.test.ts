// A COUNTRY'S POINT IS ITS LARGEST CITY.
//
// 2026-08-03, on seeing Canada's bubble sitting on the US border: "switch to use largest
// city if it's known in the gazette, otherwise augment the gazette. we will document it as
// 'largest city'."
//
// What it replaced was a population-weighted centroid that SNAPPED to the largest city
// whenever the weighted mean fell outside the country's own polygons. Each half was
// defensible; the combination was not STATEABLE. It produced a centre for 140 countries and a
// city for 13, with nothing on the chart to say which you were looking at — while the caption
// claimed "country centres" for both.
//
// Canada is the case that exposed it, and it is worth keeping the numbers: its population is a
// ~4,800 km ribbon along the southern border, so the weighted mean lands at 46.5N -88.7W — the
// middle of Lake Superior, off Michigan — and the snap then moved it to Toronto. The rule's
// two branches disagreed by ~500 km on the country most likely to show the seam.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, registerCityTable } from "../src/geoPoint";
import { CITY_PACKED } from "../src/geoPointCities.generated";

const at = (country: string) => resolveGeoPoint({ country }) as any;

describe("the country point is the largest city, and can be checked by hand", () => {
    it.each([
        ["Canada", "Toronto", 43.71, -79.40],
        ["United States", "New York City", 40.71, -74.01],
        ["France", "Paris", 48.85, 2.35],
        ["Japan", "Tokyo", 35.69, 139.69],
        ["Australia", "Sydney", -33.87, 151.21],
        ["Brazil", "Sao Paulo", -23.55, -46.64],
        ["China", "Shanghai", 31.22, 121.46],
        ["Nigeria", "Lagos", 6.45, 3.39],
    ])("%s -> %s", (country, _city, lat, lon) => {
        const r = at(country);
        expect(r.precision).toBe("country");
        expect(r.lat).toBeCloseTo(lat, 1);
        expect(r.lon).toBeCloseTo(lon, 1);
    });

    it("Canada is Toronto, NOT the population mean that used to land in Lake Superior", () => {
        // The specific regression this file exists for. 46.5N -88.7W is the old answer and it
        // is not on Canadian land at all.
        const r = at("Canada");
        expect(r.lat).toBeCloseTo(43.71, 1);
        expect(Math.abs(r.lat - 46.49)).toBeGreaterThan(1);
        expect(Math.abs(r.lon - -88.67)).toBeGreaterThan(1);
    });

    it("LARGEST, not capital — the distinction the rule turns on", () => {
        // The field report: "it could also have been the capital city." For a political map it could; this
        // one is read as where the activity is, and these four are exactly where the two rules
        // disagree. If someone ever switches to capitals, this test is what tells them the
        // choice was deliberate rather than incidental.
        expect(at("United States").lat).toBeCloseTo(40.71, 1);   // New York, not Washington
        expect(at("Canada").lat).toBeCloseTo(43.71, 1);          // Toronto, not Ottawa
        expect(at("Australia").lat).toBeCloseTo(-33.87, 1);      // Sydney, not Canberra
        expect(at("Brazil").lat).toBeCloseTo(-23.55, 1);         // Sao Paulo, not Brasilia
    });

    it("ONE gazetteer: the country point IS a city row, not a parallel table", () => {
        // Derived from the city table rather than stored beside it, so "the city tier's
        // Toronto" and "Canada's point" cannot become two different Torontos. Same coordinate,
        // reached down two different paths.
        const asCountry = at("Canada");
        const asCity = resolveGeoPoint({ city: "Toronto", country: "Canada", mapKind: "world" }) as any;
        expect(asCity.precision).toBe("city");
        expect(asCountry.lat).toBe(asCity.lat);
        expect(asCountry.lon).toBe(asCity.lon);
    });

    it("a country the gazetteer does not reach still places, from the stored fallback", () => {
        // ~96 entries have no city row - small island states and territories. Their stored
        // point is already at or beside their largest city (Greenland is Nuuk, the Bahamas is
        // Nassau), so the fallback is the same ANSWER by a different route; augmenting the
        // gazetteer upgrades them automatically.
        for (const [country, lat, lon] of [["Greenland", 64.18, -51.72], ["Bahamas", 25.06, -77.34],
                                           ["Suriname", 5.84, -55.18], ["Iceland", 64.22, -21.70]] as const) {
            const r = at(country);
            expect(r, country).not.toBeNull();
            expect(r.precision).toBe("country");
            expect(r.lat, country).toBeCloseTo(lat, 1);
            expect(r.lon, country).toBeCloseTo(lon, 1);
        }
    });

    it("swapping the gazetteer re-derives the country points instead of serving stale ones", () => {
        // The cache hazard the derivation introduces: the country tier is now DOWNSTREAM of
        // the city table, so a host that replaces the gazetteer must not keep answering with
        // the old one's cities - silently, since both return a plausible coordinate.
        const tiny = "Testville|ON|CA|-1.5|2.5|9000|NW";
        registerCityTable(tiny);
        try {
            const r = at("Canada");
            expect(r.lat).toBeCloseTo(2.5, 1);
            expect(r.lon).toBeCloseTo(-1.5, 1);
        } finally {
            registerCityTable(CITY_PACKED);
        }
        expect(at("Canada").lat).toBeCloseTo(43.71, 1);   // and restored
    });
});
