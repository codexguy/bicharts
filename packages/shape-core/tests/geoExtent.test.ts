import { describe, it, expect } from "vitest";
import {
    summarizeGeoExtent, summarizeCountryRegions, countryRegion, registerIso3Regions,
} from "../src/geoExtent";
import { ISO2_TO_ISO3 } from "../src/geoCountryNames";

// WHICH MAP FITS THE DATA — the measurement half.
//
// The failures this signal exists to prevent are not crashes, they are confident wrong frames:
// European cities offered a North America basemap (every point off the map), an all-US table
// offered a world map (a smudge in one corner), and a US/Canada/Mexico country column drawing a
// world that is gray everywhere but one continent. Each test below is one of those.

const US_CITIES = [
    { lat: 40.71, lon: -74.01 },   // New York
    { lat: 34.05, lon: -118.24 },  // Los Angeles
    { lat: 41.88, lon: -87.63 },   // Chicago
    { lat: 29.76, lon: -95.37 },   // Houston
    { lat: 47.61, lon: -122.33 },  // Seattle
    { lat: 25.76, lon: -80.19 },   // Miami
];
const EU_CITIES = [
    { lat: 51.51, lon: -0.13 },    // London
    { lat: 48.86, lon: 2.35 },     // Paris
    { lat: 52.52, lon: 13.40 },    // Berlin
    { lat: 41.90, lon: 12.50 },    // Rome
    { lat: 40.42, lon: -3.70 },    // Madrid
    { lat: 59.33, lon: 18.07 },    // Stockholm
];

describe("summarizeGeoExtent", () => {
    it("recognises an all-US dataset — the smudge-on-a-world-map case", () => {
        const e = summarizeGeoExtent(US_CITIES)!;
        expect(e.pctUsa).toBe(100);
        expect(e.pctNa).toBe(100);
        expect(e.n).toBe(6);
    });

    it("recognises a European dataset as neither US nor North American", () => {
        const e = summarizeGeoExtent(EU_CITIES)!;
        expect(e.pctUsa).toBe(0);
        expect(e.pctNa).toBe(0);
    });

    it("counts Alaska and Hawaii as the United States", () => {
        // A single hull around the US would swallow half the Pacific; separate boxes are what
        // make "inside the US" mean inside the US.
        const e = summarizeGeoExtent([
            { lat: 61.22, lon: -149.90 },  // Anchorage
            { lat: 21.31, lon: -157.86 },  // Honolulu
            { lat: 40.71, lon: -74.01 },   // New York
        ])!;
        expect(e.pctUsa).toBe(100);
    });

    it("does not call mid-Pacific or mid-Atlantic points American", () => {
        const e = summarizeGeoExtent([
            { lat: 30.0, lon: -150.0 },   // open Pacific, between Hawaii and the mainland
            { lat: 30.0, lon: -40.0 },    // open Atlantic
            { lat: 40.71, lon: -74.01 },  // New York
        ])!;
        expect(e.pctUsa).toBeCloseTo(33.3, 0);
    });

    it("separates a North American set from a US one when the country is known", () => {
        const e = summarizeGeoExtent([
            { lat: 43.65, lon: -79.38, country: "CA" },   // Toronto
            { lat: 19.43, lon: -99.13, country: "MX" },   // Mexico City
            { lat: 40.71, lon: -74.01, country: "US" },   // New York
            { lat: 45.50, lon: -73.57, country: "CA" },   // Montreal
        ])!;
        expect(e.pctNa).toBe(100);
        expect(e.pctUsa).toBe(25);
    });

    // THE LIMIT, PINNED DELIBERATELY. Without a country, Toronto and Montreal fall inside any
    // rectangle drawn around the contiguous US — southern Ontario reaches below Boston, so no
    // box can hold the border. This test exists so the weakness is a documented property rather
    // than a surprise, and so anyone tempted to drop the country channel sees what it costs.
    it("cannot resolve the US/Canada border from coordinates alone — hence the country channel", () => {
        const boxOnly = summarizeGeoExtent([
            { lat: 43.65, lon: -79.38 },   // Toronto, no country
            { lat: 45.50, lon: -73.57 },   // Montreal, no country
            { lat: 40.71, lon: -74.01 },   // New York
            { lat: 19.43, lon: -99.13 },   // Mexico City
        ])!;
        expect(boxOnly.pctNa).toBe(100);         // the coarse question is still answered correctly
        expect(boxOnly.pctUsa).toBe(75);         // ...and the fine one is not
        const withCountry = summarizeGeoExtent([
            { lat: 43.65, lon: -79.38, country: "CA" },
            { lat: 45.50, lon: -73.57, country: "CA" },
            { lat: 40.71, lon: -74.01, country: "US" },
            { lat: 19.43, lon: -99.13, country: "MX" },
        ])!;
        expect(withCountry.pctUsa).toBe(25);
    });

    it("falls back to the boxes per-point, so a partial country column still helps", () => {
        const e = summarizeGeoExtent([
            { lat: 43.65, lon: -79.38, country: "CA" },   // named: correctly not US
            { lat: 40.71, lon: -74.01 },                  // unnamed: box says US, and it is
            { lat: 34.05, lon: -118.24 },                 // unnamed: box says US, and it is
            { lat: 51.51, lon: -0.13 },                   // unnamed: box says not US, correct
        ])!;
        expect(e.pctUsa).toBe(50);
        expect(e.pctNa).toBe(75);
    });

    // THE ONE THE QUANTILES EXIST FOR.
    it("shrugs off a single null-island row instead of describing a dataset that isn't there", () => {
        const withGarbage = [...US_CITIES, ...US_CITIES, ...US_CITIES, { lat: 0, lon: 0 }];
        const e = summarizeGeoExtent(withGarbage)!;
        // min/max would report a longitude envelope reaching 0; p5/p95 stays over the US.
        expect(e.lonP95).toBeLessThan(-60);
        expect(e.latP5).toBeGreaterThan(20);
        // It is still counted as a placed point outside the US, so the percentage moves a little.
        expect(e.pctUsa).toBeGreaterThan(90);
        expect(e.pctUsa).toBeLessThan(100);
    });

    it("skips unplaced rows rather than counting them as 'outside'", () => {
        // Folding unplaced rows into the denominator would drag a clean US dataset toward zero
        // and make it look global — the opposite of what the signal is for.
        const e = summarizeGeoExtent([
            ...US_CITIES,
            { lat: null, lon: null }, { lat: undefined, lon: undefined },
            { lat: NaN, lon: 0 }, { lat: 999, lon: 999 },
        ])!;
        expect(e.n).toBe(6);
        expect(e.pctUsa).toBe(100);
    });

    it("refuses to make a claim from too little data", () => {
        expect(summarizeGeoExtent([{ lat: 40.7, lon: -74 }])).toBeNull();
        expect(summarizeGeoExtent([])).toBeNull();
        expect(summarizeGeoExtent([{ lat: null, lon: null }])).toBeNull();
    });

    it("reports an envelope a frame could actually be fitted to", () => {
        const e = summarizeGeoExtent(EU_CITIES)!;
        expect(e.latP5).toBeLessThan(e.latP95);
        expect(e.lonP5).toBeLessThan(e.lonP95);
        expect(e.latP95).toBeLessThan(90);
        expect(e.lonP5).toBeGreaterThan(-180);
    });
});

describe("countryRegion", () => {
    it("maps ISO-2 codes", () => {
        expect(countryRegion("US")).toBe("north-america");
        expect(countryRegion("MX")).toBe("north-america");
        expect(countryRegion("BR")).toBe("south-america");
        expect(countryRegion("DE")).toBe("europe");
        expect(countryRegion("KE")).toBe("africa");
        expect(countryRegion("JP")).toBe("asia");
        expect(countryRegion("AU")).toBe("oceania");
    });

    it("maps ISO-3 once the alias table is registered, and the two never disagree", () => {
        registerIso3Regions(ISO2_TO_ISO3);
        expect(countryRegion("USA")).toBe("north-america");
        expect(countryRegion("DEU")).toBe("europe");
        expect(countryRegion("JPN")).toBe("asia");
        // Every ISO-3 must agree with its own ISO-2 — a divergence is a table typo.
        for (const [a2, a3] of ISO2_TO_ISO3) {
            const r2 = countryRegion(a2);
            if (r2) expect(countryRegion(a3), `${a2}/${a3}`).toBe(r2);
        }
    });

    it("is case- and whitespace-insensitive, and null on anything unknown", () => {
        expect(countryRegion(" us ")).toBe("north-america");
        expect(countryRegion("zz")).toBeNull();
        expect(countryRegion("")).toBeNull();
        expect(countryRegion(null)).toBeNull();
    });

    it("covers every country in the ISO table — a gap is a country with no frame", () => {
        const missing: string[] = [];
        for (const a2 of ISO2_TO_ISO3.keys()) if (!countryRegion(a2)) missing.push(a2);
        expect(missing, `unassigned: ${missing.join(", ")}`).toEqual([]);
    });
});

describe("summarizeCountryRegions", () => {
    it("recognises the gray-world case — a country column that is entirely North American", () => {
        const s = summarizeCountryRegions(["US", "CA", "MX", "US", "CA"])!;
        expect(s.dominantGeoRegion).toBe("north-america");
        expect(s.dominantGeoRegionPct).toBe(100);
        expect(s.regionCount).toBe(1);
    });

    it("recognises a genuinely global set", () => {
        const s = summarizeCountryRegions(["US", "BR", "DE", "JP", "AU", "KE"])!;
        expect(s.regionCount).toBe(6);
        expect(s.dominantGeoRegionPct).toBeLessThan(30);
    });

    it("reports the dominant region when one clearly leads", () => {
        const s = summarizeCountryRegions(["DE", "FR", "IT", "ES", "NL", "US"])!;
        expect(s.dominantGeoRegion).toBe("europe");
        expect(s.dominantGeoRegionPct).toBeCloseTo(83.3, 0);
    });

    it("excludes unresolvable values from the denominator", () => {
        // A misspelling is a data-quality fact, not evidence about where the data sits.
        const s = summarizeCountryRegions(["US", "CA", "Atlantis", "", null, "ZZ"])!;
        expect(s.n).toBe(2);
        expect(s.dominantGeoRegionPct).toBe(100);
    });

    it("refuses to make a claim from too little data", () => {
        expect(summarizeCountryRegions(["US"])).toBeNull();
        expect(summarizeCountryRegions(["Atlantis", "Narnia"])).toBeNull();
        expect(summarizeCountryRegions([])).toBeNull();
    });

    it("is deterministic on a tie", () => {
        const a = summarizeCountryRegions(["US", "DE"])!;
        const b = summarizeCountryRegions(["DE", "US"])!;
        expect(a.dominantGeoRegion).toBe(b.dominantGeoRegion);
    });
});
