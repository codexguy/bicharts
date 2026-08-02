import { describe, it, expect } from "vitest";
import {
    resolveGeoPoint, buildGeoPointColumns, isGeoPointAmbiguity, resolveAdmin1, zipToPrefix3,
    zipPrefixCandidates, normalizePlaceName, cityMatchPct,
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

    it("an ambiguous BARE city name is REFUSED and reported — never guessed (v2)", () => {
        // v2 matching (Joel 2026-08-02): "if multiple possible matches are found, that
        // should be a call-out … and it should not be plotted." This replaced the old
        // largest-city tie-break, which put every bare Springfield in Missouri with a
        // flag — a guess with a footnote is still a guess.
        const r = resolveGeoPoint({ city: "Springfield" });
        expect(isGeoPointAmbiguity(r)).toBe(true);
        expect((r as any).matches).toBeGreaterThan(1);
        // …and a disambiguating attribute still resolves it exactly.
        const il = resolveGeoPoint({ city: "Springfield", state: "IL" })!;
        expect(il.precision).toBe("city");
        expect(near((il as any).lat, 39.80)).toBe(true);
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
        // The admin1 carve-out is unchanged: "Mexico" never resolves as a state.
        expect(resolveAdmin1("Mexico")).toBeNull();
        expect(resolveAdmin1("Estado de México")).toBeTruthy();
        // v2 CHANGED the direct-resolve half. Under "non-blank source attributes must
        // match same-or-blank", a state slot holding 'Mexico' matches no lookup state,
        // so the row is excluded at the city tier instead of the bad state being
        // silently dropped. The PRODUCTION recovery for country-in-the-state-slot is
        // resolvePointRoles (column-level, tested in geoPointRoles) — it refuses the
        // binding before the resolver ever sees it, and the city then places clean:
        const viaRoles = resolveGeoPoint({ city: "Mexico City" })!;
        expect(viaRoles.precision).toBe("city");
        expect(near((viaRoles as any).lat, 19.43)).toBe(true);
        // Direct call with the bad slot left in: strict rule, nothing finer than the
        // (absent) country can honour it — unplaced, never a Toluca-side guess.
        expect(resolveGeoPoint({ city: "Mexico City", state: "Mexico" })).toBeNull();
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

describe("resolveGeoPoint — the bare \"<X> City\" shorthand (2026-08-01)", () => {
    it("bare 'New York' is New York City, not the New York STATE centroid", () => {
        // The bug this closes: nobody types "New York City" in a city column, the bare
        // form was in no gazetteer, so the single most-charted city in North America fell
        // to the state tier and was drawn ~25 km off — plausible enough to never look
        // broken, and it dragged the WHOLE map's reported precision to "state".
        const r = resolveGeoPoint({ city: "New York", state: "NY", country: "USA" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 40.71)).toBe(true);
        expect(near(r.lon, -74.01)).toBe(true);
        // ...and without a state column, which is how most city lists arrive.
        expect(resolveGeoPoint({ city: "New York" })!.precision).toBe("city");
    });

    it("bare 'Mexico' in the CITY role is Mexico City", () => {
        const r = resolveGeoPoint({ city: "Mexico", country: "MX" })!;
        expect(r.precision).toBe("city");
        expect(near(r.lat, 19.43)).toBe(true);
    });

    it("a bare STATE name is NOT dragged to its small '* City' namesake", () => {
        // This is why the rule is gated on population rather than being a blanket
        // "retry with ' city' appended": Missouri City TX (74k), Texas City TX (47k),
        // Iowa City IA (74k) and Oregon City OR (35k) all exist, and reading a bare
        // state name as one of them would be WORSE than the state centroid — it would
        // move Missouri data into Texas.
        for (const s of ["Missouri", "Texas", "Iowa", "Oregon"]) {
            // Alone in the city role: no placement at all, which is the honest answer.
            expect(resolveGeoPoint({ city: s })).toBeNull();
            // With the state column that such data actually carries: the state centroid,
            // exactly as before this change — never the namesake town.
            expect(resolveGeoPoint({ city: s, state: s })!.precision).toBe("state");
        }
    });

    it("the shorthand still refuses a contradicting state", () => {
        // Alias rows run the IDENTICAL narrowing path as a direct hit, so the existing
        // "state that disagrees with every match falls through" rule still governs.
        const r = resolveGeoPoint({ city: "New York", state: "CA" })!;
        expect(r.precision).not.toBe("city");
    });

    it("a bare form that is ALREADY a city keeps its own meaning", () => {
        // "Kansas City" exists, but so does the state; the shorthand only ever fills a
        // GAP — it never overrides a name the gazetteer already knows.
        const kc = resolveGeoPoint({ city: "Kansas City", state: "MO" })!;
        const bare = resolveGeoPoint({ city: "Kansas", state: "MO" })!;
        expect(kc.precision).toBe("city");
        expect(bare.precision).toBe("city");
        expect(bare.lat).toBe(kc.lat);
    });

    it("the shorthand counts as a known city for the offerability signal", () => {
        // isKnownCity / cityMatchPct gate whether a column is OFFERED as geographic at
        // all. If they disagreed with the resolver, a short NA city list containing
        // "New York" could fail the match threshold and never be offered as a map.
        expect(cityMatchPct(["New York", "Seattle", "Chicago", "Miami"])).toBe(100);
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

    it("ambiguous rows are NOT plotted, and are named for the info call-out (v2)", () => {
        const out = buildGeoPointColumns([
            { city: "Springfield" },             // multiple matches -> refused, reported
            { city: "Springfield", state: "IL" },// disambiguated -> placed
            { city: "Plano", state: "TX" },
        ]);
        expect(out.ambiguousRows).toBe(1);
        expect(out.ambiguousExamples).toEqual(["Springfield"]);
        expect(out.matchedRows).toBe(2);                 // the refused row is not "matched"
        expect(out.lat[0]).toBeNull();                   // …and carries no coordinates,
        expect(out.lat[1]).not.toBeNull();               // which is what keeps OLD generated
        // code honest: it counts null-coord rows into its own off-map annotation.
    });

    it("an empty table is not an error", () => {
        const out = buildGeoPointColumns([]);
        expect(out.totalRows).toBe(0);
        expect(out.matchedRows).toBe(0);
        expect(out.precision).toBeNull();
        expect(out.precisionCounts).toEqual({ latlon: 0, city: 0, zip3: 0, state: 0, country: 0 });
        expect(out.coarseExamples).toEqual([]);
    });

    it("precisionCounts says HOW MUCH of the map the coarse tier covers", () => {
        // The scalar `precision` is a ceiling and reads identically for 1-of-3 and
        // 3-of-3 state rows. A caption built on the scalar alone ("approximated to
        // state centres") is then false for the city rows — the counts are what make
        // an honest annotation possible.
        const out = buildGeoPointColumns([
            { city: "Plano", state: "TX" },
            { city: "Seattle", state: "WA" },
            { state: "NY" },
        ]);
        expect(out.precision).toBe("state");
        expect(out.precisionCounts).toEqual({ latlon: 0, city: 2, zip3: 0, state: 1, country: 0 });
    });

    it("names the rows the coarse tier is actually about, deduped and capped", () => {
        const out = buildGeoPointColumns([
            { city: "Plano", state: "TX" },
            { state: "NY" },
            { state: "NY" },                     // same label, named once
            { zip: "331" },
        ]);
        expect(out.coarseExamples).toEqual(["NY", "331"]);
        expect(out.precisionCounts.state).toBe(2);
        expect(out.precisionCounts.zip3).toBe(1);
    });

    it("explicit coordinates count as latlon, not as a coarse row", () => {
        const out = buildGeoPointColumns([
            { lat: 47.6, lon: -122.3 }, { city: "Plano", state: "TX" },
        ]);
        expect(out.precision).toBe("city");
        expect(out.precisionCounts).toEqual({ latlon: 1, city: 1, zip3: 0, state: 0, country: 0 });
        expect(out.coarseExamples).toEqual([]);
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
