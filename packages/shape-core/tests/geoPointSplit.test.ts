// THE BUNDLED/FETCHED SPLIT (Joel 2026-08-02: "let's just do this now").
//
// The gazetteer left the package. It now ships as two pieces with different jobs, and the
// whole design rests on one claim: DETECTION does not depend on the fetched half.
//
//   Why that claim is load-bearing — isKnownCity feeds detectGeo, detectGeo runs
//   SYNCHRONOUSLY inside the profiler for every column of every dataset, and its answer
//   decides which chart types are OFFERED. If detection quietly degraded while a fetch was
//   in flight, a user would get a different chart menu depending on network timing, on data
//   that has nothing to do with maps. That is the failure this file exists to prevent.
//
// So: with the placement table UNREGISTERED, detection must be byte-identical, placement
// must degrade to the coarser tiers (never guess, never throw), and registering must
// restore full behaviour.
import { describe, it, expect, afterEach } from "vitest";
import {
    resolveGeoPoint, buildGeoPointColumns, isKnownCity, cityMatchPct,
    registerCityTable, isCityTableLoaded,
} from "../src/geoPoint";
import { CITY_PACKED } from "../src/geoPointCities.generated";

/** Run `fn` with the placement table absent, then put it back. */
function withoutPlacementTable<T>(fn: () => T): T {
    registerCityTable("");
    try {
        return fn();
    } finally {
        registerCityTable(CITY_PACKED);
    }
}

afterEach(() => registerCityTable(CITY_PACKED));

describe("detection does NOT depend on the fetched table", () => {
    it("isKnownCity answers identically with and without it", () => {
        const probes = ["dallas", "london", "munchen", "nueva york", "toronto", "bombay",
                        "mexico city", "not a city at all", "revenue", "q1 2026"];
        const withTable = probes.map(p => isKnownCity(p));
        const withoutTable = withoutPlacementTable(() => probes.map(p => isKnownCity(p)));
        expect(withoutTable).toEqual(withTable);
        // ...and it is actually answering, not just returning false for everything.
        expect(withTable.filter(Boolean).length).toBeGreaterThan(4);
    });

    it("keeps the map-kind scope distinction without it", () => {
        // Scope is what makes the same word mean different things per map; the detection
        // index carries the flags, so this survives the split too.
        withoutPlacementTable(() => {
            expect(isKnownCity("lisbon")).toBe(false);                    // NA scope
            expect(isKnownCity("lisbon", "world")).toBe(true);
            expect(isKnownCity("des moines")).toBe(true);                 // NA-only city
        });
    });

    it("cityMatchPct — the column-level measure — is unchanged", () => {
        const vals = ["Dallas", "Austin", "Houston", "San Antonio", "Sprocket Division"];
        const before = cityMatchPct(vals);
        expect(withoutPlacementTable(() => cityMatchPct(vals))).toBe(before);
        expect(before).toBeGreaterThan(50);
    });
});

describe("placement degrades honestly when the table has not arrived", () => {
    it("falls through to the STATE tier instead of guessing or throwing", () => {
        const hit = withoutPlacementTable(() => resolveGeoPoint({ city: "Dallas", state: "TX" }) as any);
        expect(hit).not.toBeNull();
        expect(hit.precision).toBe("state");        // not "city", and not an exception
        const full = resolveGeoPoint({ city: "Dallas", state: "TX" }) as any;
        expect(full.precision).toBe("city");        // registered: the finer tier is back
    });

    it("a city-only row simply does not resolve, rather than landing somewhere wrong", () => {
        expect(withoutPlacementTable(() => resolveGeoPoint({ city: "Dallas" }))).toBeNull();
    });

    it("says so in the summary, so a coarse map is explainable", () => {
        const rows = [{ city: "Dallas", state: "TX" }, { city: "Austin", state: "TX" }];
        const out = withoutPlacementTable(() => buildGeoPointColumns(rows));
        expect(out.cityTableMissing).toBe(true);
        expect(out.precision).toBe("state");
        expect(out.matchedRows).toBe(2);            // still placed — just coarser
        expect(buildGeoPointColumns(rows).cityTableMissing).toBeUndefined();
    });

    it("rows with real coordinates are untouched by any of this", () => {
        // The latlon tier never consulted the gazetteer, and a fetch failure must not
        // disturb the one input that was already exact.
        const hit = withoutPlacementTable(() => resolveGeoPoint({ lat: 32.78, lon: -96.8 }) as any);
        expect(hit.precision).toBe("latlon");
        expect(hit.lat).toBeCloseTo(32.78, 2);
    });
});

describe("registration", () => {
    it("reports whether the table is loaded", () => {
        expect(isCityTableLoaded()).toBe(true);
        withoutPlacementTable(() => expect(isCityTableLoaded()).toBe(false));
        expect(isCityTableLoaded()).toBe(true);
    });

    it("is idempotent and rebuilds on a genuine change", () => {
        registerCityTable(CITY_PACKED);
        registerCityTable(CITY_PACKED);
        expect((resolveGeoPoint({ city: "Dallas", state: "TX" }) as any).precision).toBe("city");
        // A different table takes effect immediately (no stale index).
        registerCityTable("Sprocketville|TX|US|-100|31|50|N|");
        expect((resolveGeoPoint({ city: "Sprocketville" }) as any).precision).toBe("city");
        expect(resolveGeoPoint({ city: "Dallas" })).toBeNull();
    });
});
