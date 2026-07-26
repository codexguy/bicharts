import { describe, it, expect } from "vitest";
import {
    resolveGeoPoint, buildGeoPointColumns, resolveAdmin1, zipToPrefix3, zipPrefixCandidates,
    normalizePlaceName, cityMatchPct,
} from "../src/geoPoint";

// POINT GEOCODING (2026-07-25): "allow someone to drop in ONLY city NAMES",
// resolved through the cascade City+State -> Zip5/Zip3 -> State, with "state"
// explicitly including non-US provinces.
//
// The load-bearing behaviours here are the ones a naive implementation gets wrong:
// ambiguous city names (9% of North American names collide), a state that CONTRADICTS
// the city, and reporting the honest PRECISION rather than implying a street address.

// Rough proximity in degrees — coordinates are 2 dp and these assertions are about
// "did it land in the right place", not exact values.
const near = (got: number, want: number, tol = 0.75) => Math.abs(got - want) <= tol;

describe("resolveGeoPoint — tier 1, explicit coordinates win", () => {
    it("uses real coordinates over any lookup, and says precision=latlon", () => {
        const r = resolveGeoPoint({ lat: 47.61, lon: -122.33, city: "Miami", state: "FL" })!;
        expect(r.precision).toBe("latlon");
        expect(r.lat).toBe(47.61);
        expect(r.lon).toBe(-122.33);
    });

    it("string coordinates coerce", () => {
        const r = resolveGeoPoint({ lat: "39.7", lon: "-104.9" })!;
        expect(r.precision).toBe("latlon");
        expect(near(r.lat, 39.7)).toBe(true);
    });

    it("out-of-range coordinates are rejected, not clamped — falls through to the city tier", () => {
        const r = resolveGeoPoint({ lat: 999, lon: -122.33, city: "Plano", state: "TX" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 33.02)).toBe(true);
    });

    it("whitespace-only coordinate strings are ABSENT, not (0,0) — the null-as-zero trap", () => {
        // `+" "` coerces to 0, and 0/0 is a valid coordinate (Null Island, off Africa).
        // An untrimmed emptiness check silently fabricated a point there. (2026-07-25 sweep.)
        const r = resolveGeoPoint({ lat: " ", lon: "\t", city: "Plano", state: "TX" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 33.02)).toBe(true);
        expect(resolveGeoPoint({ lat: " ", lon: " " })).toBeNull();
    });

    it("real (0,0) coordinates ARE honored — the fix rejects blanks, not zeros", () => {
        const r = resolveGeoPoint({ lat: 0, lon: 0 })!;
        expect(r.precision).toBe("latlon");
        expect(r.lat).toBe(0);
        expect(r.lon).toBe(0);
    });

    it("exact (0,0) DEFERS to a resolvable place name — the missing-as-zero convention", () => {
        // A lat/lon pair stored as 0 for unknown rows would put every such row on Null
        // Island while its city says Texas. The name wins; bare (0,0) still resolves.
        const r = resolveGeoPoint({ lat: 0, lon: 0, city: "Plano", state: "TX" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 33.02)).toBe(true);
        // A near-zero but non-zero coordinate is genuine data and still wins.
        expect(resolveGeoPoint({ lat: 0.1, lon: 0, city: "Plano" })!.precision).toBe("latlon");
    });
});

describe("resolveGeoPoint — tier 2, city (+state)", () => {
    it("an unambiguous city resolves with no state at all — the headline case", () => {
        const r = resolveGeoPoint({ city: "Plano" })!;
        expect(r.precision).toBe("city");
        expect(r.ambiguous).toBeUndefined();
        expect(near(r.lat, 33.02)).toBe(true);
        expect(near(r.lon, -96.70)).toBe(true);
    });

    it("City+State disambiguates a colliding name — the reason state matters", () => {
        // 6 Springfields in the table; MO is the largest, so IL/MA must be reached
        // via the state and must NOT return the Missouri coordinates.
        const mo = resolveGeoPoint({ city: "Springfield", state: "MO" })!;
        const il = resolveGeoPoint({ city: "Springfield", state: "IL" })!;
        const ma = resolveGeoPoint({ city: "Springfield", state: "MA" })!;
        expect(mo.precision).toBe("city");
        expect(near(mo.lat, 37.22)).toBe(true);
        expect(near(il.lat, 39.80)).toBe(true);
        expect(near(ma.lat, 42.10)).toBe(true);
        // All three genuinely distinct.
        expect(new Set([mo.lat, il.lat, ma.lat]).size).toBe(3);
        expect(mo.ambiguous).toBeUndefined();
    });

    it("an ambiguous BARE city name takes the largest and FLAGS it", () => {
        const r = resolveGeoPoint({ city: "Springfield" })!;
        expect(r.precision).toBe("city");
        expect(r.ambiguous).toBe(true);
        expect(near(r.lat, 37.22)).toBe(true);   // Springfield MO, the largest
    });

    it("full state NAMES work as well as codes", () => {
        const byCode = resolveGeoPoint({ city: "Springfield", state: "IL" })!;
        const byName = resolveGeoPoint({ city: "Springfield", state: "Illinois" })!;
        expect(byName.lat).toBe(byCode.lat);
        expect(byName.lon).toBe(byCode.lon);
    });

    it("a state that CONTRADICTS the city does not silently mis-place it", () => {
        // "Plano, ON" is not a place. Rather than returning Plano TX (wrong state) or
        // Ontario's centroid dressed up as a city, it falls to the state tier.
        const r = resolveGeoPoint({ city: "Plano", state: "ON" })!;
        expect(r.precision).toBe("state");
        expect(near(r.lat, 43.94)).toBe(true);
    });

    it("case, diacritics and punctuation all fold", () => {
        const a = resolveGeoPoint({ city: "montreal" })!;
        const b = resolveGeoPoint({ city: "Montréal" })!;
        const c = resolveGeoPoint({ city: "  MONTREAL  " })!;
        expect(b.lat).toBe(a.lat);
        expect(c.lat).toBe(a.lat);
        expect(near(a.lat, 45.51)).toBe(true);
    });
});

describe("resolveGeoPoint — non-US provinces (\"include non-US provinces\")", () => {
    it("Canadian cities resolve, by province code and name", () => {
        const r = resolveGeoPoint({ city: "Mississauga", state: "ON" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 43.58)).toBe(true);
        expect(resolveGeoPoint({ city: "Laval", state: "Quebec" })!.precision).toBe("city");
    });

    it("Mexican cities and states resolve", () => {
        const r = resolveGeoPoint({ city: "Monterrey" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 25.67)).toBe(true);
        const j = resolveGeoPoint({ state: "Jalisco" })!;
        expect(j.precision).toBe("state");
        expect(near(j.lat, 20.64)).toBe(true);
    });

    it("bare 'Mexico' is a COUNTRY, not the State of México (2026-07-25 sweep)", () => {
        // City+Country data where the LLM bound Country into the state slot must not
        // read "Mexico" as the state MX15 — that contradicts every Mexican city and
        // demotes those rows to the state tier. The state keeps its unambiguous forms.
        expect(resolveAdmin1("Mexico")).toBeNull();
        expect(resolveAdmin1("Estado de México")).toBeTruthy();
        const r = resolveGeoPoint({ city: "Mexico City", state: "Mexico" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 19.43)).toBe(true);   // CDMX, not the Toluca-side centroid
    });

    it("province centroids are POPULATION-weighted, not geometric", () => {
        // Ontario's population centroid sits near Toronto (~43.9N), NOT the geometric
        // middle of the province (~50N, subarctic). Same reasoning as Alaska.
        const on = resolveGeoPoint({ state: "Ontario" })!;
        expect(on.lat).toBeLessThan(46);
        const qc = resolveGeoPoint({ state: "QC" })!;
        expect(qc.lat).toBeLessThan(48);   // near Montreal, not northern Quebec
    });
});

describe("resolveGeoPoint — tier 3, ZIP", () => {
    it("a ZIP-5 resolves through its 3-digit prefix", () => {
        const r = resolveGeoPoint({ zip: "90210" })!;
        expect(r.precision).toBe("zip3");
        expect(near(r.lat, 34.0, 1.5)).toBe(true);
        expect(near(r.lon, -118.3, 1.5)).toBe(true);
    });

    it("ZIP+4 and Excel-stripped leading zeros both work", () => {
        expect(zipToPrefix3("90210-1234")).toBe("902");
        expect(zipToPrefix3("1001")).toBe("010");    // Excel ate ONE leading zero
        expect(zipToPrefix3("not a zip")).toBeNull();
    });

    it("a ZIP that took a round trip through a float is recovered", () => {
        // CSV exports and DAX FORMAT can render a numeric ZIP as "60614.0". A real ZIP
        // never contains a dot, so stripping the float tail is safe. (2026-07-25 sweep.)
        expect(zipToPrefix3("60614.0")).toBe("606");
        expect(zipToPrefix3("1001.0")).toBe("010");
        expect(zipToPrefix3("60614.5")).toBeNull();   // a genuine non-ZIP stays rejected
    });

    it("a bare 3-digit value is a PREFIX, not a zero-stripped ZIP", () => {
        // Caught by the shipped test dataset: reading "606" as zero-stripped gives
        // "006" — a REAL prefix, in Puerto Rico — so Chicago data silently rendered
        // 2,000 miles away. Only 006-009 exist as "00x" prefixes, and a literal
        // 3-digit value in a column is overwhelmingly already a prefix.
        expect(zipToPrefix3("606")).toBe("606");     // Chicago, NOT "006"
        expect(zipToPrefix3("331")).toBe("331");     // Miami
        expect(resolveGeoPoint({ zip: "606" })!.lat).toBeGreaterThan(40);   // Chicago-ish
        expect(resolveGeoPoint({ zip: "331" })!.lat).toBeLessThan(28);      // Miami-ish
    });

    it("the zero-stripped reading survives as a FALLBACK when the direct one misses", () => {
        // Direct prefix ALWAYS leads; the zero-stripped reading trails it. A trailing
        // candidate that isn't a real prefix (here "000") is harmless — it just misses
        // the table — so the list is ordered, not filtered.
        expect(zipPrefixCandidates("331")).toEqual(["331", "003"]);
        expect(zipPrefixCandidates("006")[0]).toBe("006");
        expect(zipPrefixCandidates("90210")).toEqual(["902"]);   // 5-digit: no ambiguity
        expect(zipPrefixCandidates("1001")).toEqual(["010"]);    // 4-digit: no ambiguity
        expect(zipPrefixCandidates("")).toEqual([]);
        // 006 is a real (Puerto Rico) prefix, so the dead "000" alternate never wins.
        expect(resolveGeoPoint({ zip: "006" })!.precision).toBe("zip3");
    });

    it("every ZIP-5 sharing a prefix collapses to ONE point — the documented limit", () => {
        const a = resolveGeoPoint({ zip: "90210" })!;
        const b = resolveGeoPoint({ zip: "90291" })!;
        expect(b.lat).toBe(a.lat);
        expect(b.lon).toBe(a.lon);
        expect(a.precision).toBe("zip3");
    });

    it("city beats ZIP when both are present (a city is a point, a prefix is a region)", () => {
        const r = resolveGeoPoint({ city: "Plano", state: "TX", zip: "90210" })!;
        expect(r.precision).toBe("city");
    });
});

describe("resolveGeoPoint — tier 4, state alone, and misses", () => {
    it("a bare state resolves coarsely and says so", () => {
        const r = resolveGeoPoint({ state: "TX" })!;
        expect(r.precision).toBe("state");
    });

    it("ZIP beats a bare state", () => {
        expect(resolveGeoPoint({ state: "CA", zip: "10001" })!.precision).toBe("zip3");
    });

    it("nothing resolvable returns null rather than a guess", () => {
        expect(resolveGeoPoint({})).toBeNull();
        expect(resolveGeoPoint({ city: "Nowherecityville" })).toBeNull();
        expect(resolveGeoPoint({ city: null, state: null, zip: null })).toBeNull();
        expect(resolveGeoPoint({ state: "Atlantis" })).toBeNull();
    });
});

describe("resolveAdmin1", () => {
    it("accepts codes and names across all three countries", () => {
        expect(resolveAdmin1("TX")).toBe("TX");
        expect(resolveAdmin1("texas")).toBe("TX");
        expect(resolveAdmin1("Ontario")).toBe("ON");
        expect(resolveAdmin1("ON")).toBe("ON");
        expect(resolveAdmin1("Jalisco")).toBeTruthy();
        expect(resolveAdmin1("Nowhere")).toBeNull();
        expect(resolveAdmin1(null)).toBeNull();
    });
});

describe("buildGeoPointColumns", () => {
    it("aligns 1:1, counts matches, and reports the COARSEST precision used", () => {
        const out = buildGeoPointColumns([
            { city: "Plano", state: "TX" },      // city
            { city: "Seattle", state: "WA" },    // city
            { state: "NY" },                     // state  <- coarsest
        ]);
        expect(out.totalRows).toBe(3);
        expect(out.matchedRows).toBe(3);
        expect(out.lat.length).toBe(3);
        expect(out.lon.length).toBe(3);
        // One coarse row means the map is not uniformly city-accurate — say the worst.
        expect(out.precision).toBe("state");
    });

    it("all-city rows report city precision", () => {
        const out = buildGeoPointColumns([
            { city: "Plano", state: "TX" }, { city: "Irvine", state: "CA" },
        ]);
        expect(out.precision).toBe("city");
        expect(out.ambiguousRows).toBe(0);
    });

    it("unresolved rows are null and collected for the off-map annotation", () => {
        const out = buildGeoPointColumns([
            { city: "Plano", state: "TX" },
            { city: "Nowherecityville" },
            { city: "Nowherecityville" },      // same label, counted once
        ]);
        expect(out.matchedRows).toBe(1);
        expect(out.lat[1]).toBeNull();
        expect(out.lon[1]).toBeNull();
        expect(out.unmatched).toEqual(["Nowherecityville"]);
    });

    it("counts ambiguous placements so the chart can annotate them", () => {
        const out = buildGeoPointColumns([
            { city: "Springfield" },             // ambiguous -> largest
            { city: "Springfield", state: "IL" },// disambiguated -> not ambiguous
            { city: "Plano", state: "TX" },
        ]);
        expect(out.ambiguousRows).toBe(1);
        expect(out.matchedRows).toBe(3);
    });

    it("an empty table is not an error", () => {
        const out = buildGeoPointColumns([]);
        expect(out.totalRows).toBe(0);
        expect(out.matchedRows).toBe(0);
        expect(out.precision).toBeNull();
    });
});

describe("cityMatchPct — the offerability signal", () => {
    it("a real city column scores high; a person roster scores ~0", () => {
        expect(cityMatchPct(["Plano", "Irvine", "Seattle", "Boulder", "Mississauga"])).toBe(100);
        expect(cityMatchPct(["Alice", "Bob", "Carol", "Dave", "Erin"])).toBeLessThan(25);
    });

    it("is distinct-based, so repeats don't inflate it", () => {
        expect(cityMatchPct(["Plano", "Plano", "Plano", "Nowherecityville"])).toBe(50);
    });

    it("empty input is 0, not NaN", () => {
        expect(cityMatchPct([])).toBe(0);
        expect(cityMatchPct([null, undefined])).toBe(0);
    });
});

describe("normalizePlaceName", () => {
    it("matches the generator's normalizer (diacritics, punctuation, whitespace)", () => {
        expect(normalizePlaceName("Montréal")).toBe("montreal");
        expect(normalizePlaceName("  ST. LOUIS  ")).toBe("st louis");
        expect(normalizePlaceName("Winston-Salem")).toBe("winston salem");
    });
});
