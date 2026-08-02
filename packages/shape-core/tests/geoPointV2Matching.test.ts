// GAZETTEER V2 (Joel 2026-08-02) — the unified City+State+Country table and the COMMON
// matching rules every point-map type shares:
//
//   • one list, per-row MAP-KIND flags (N = North America map, W = World map); each map
//     queries its own scope, so the same bare name can resolve DIFFERENTLY per map —
//     correct, because the candidate set IS different;
//   • any NON-BLANK source attribute must match the SAME value or a BLANK in the lookup
//     row ("blank passes, contradiction excludes");
//   • rows matching MORE source attributes explicitly are preferred;
//   • multiple survivors = AMBIGUOUS -> not plotted, reported as info. No population
//     tie-break, anywhere, any more.
//
// The W set is EVERY city with pop >= 250k, worldwide and uncapped (Joel 2026-08-02 — the
// original 1000-row cap bit at 576k and could not place Lisbon, Antwerp or Nuremberg by
// name). Assertions here follow the BUILT table, not the aspiration; re-capping will move
// some. Uncapping made exactly 16 world names newly ambiguous while making 2,708 newly
// reachable, and the 16 are all real collisions between two cities of the same name.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, buildGeoPointColumns, isGeoPointAmbiguity, cityMatchPct } from "../src/geoPoint";

const place = (args: any) => resolveGeoPoint(args) as any;

describe("map-kind scope — the same name against two different candidate sets", () => {
    it("bare 'London' is Ontario on the NA map, and a CALL-OUT on the world map", () => {
        // NA scope: only London ON carries the N flag -> single candidate, city tier.
        // World scope changed when the 250k set was uncapped (2026-08-02): London ON (422k)
        // now clears the bar too, so the world map has TWO real Londons and refuses rather
        // than guessing — the same answer it already gave for Barcelona and Hyderabad. The
        // scope still matters, it just no longer decides this one by accident of a cap.
        const na = place({ city: "London" });
        expect(na.precision).toBe("city");
        expect(na.lon).toBeCloseTo(-81.2, 0);                              // Ontario
        expect(isGeoPointAmbiguity(resolveGeoPoint({ city: "London", mapKind: "world" }))).toBe(true);
        // ...and a country column resolves it, which is what the call-out asks for.
        const gb = place({ city: "London", country: "United Kingdom", mapKind: "world" });
        expect(gb.precision).toBe("city");
        expect(gb.lon).toBeCloseTo(-0.13, 0);                              // the Thames one
    });

    it("places the cities the old 1000-row cap could not reach", () => {
        // The point of uncapping: these are ordinary Western BI rows, and every one of them
        // used to fall through to a country centroid.
        for (const [city, lon] of [["Lisbon", -9.1], ["Antwerp", 4.4], ["Nuremberg", 11.1],
                                   ["Bristol", -2.6], ["Florence", 11.3], ["Bordeaux", -0.6]] as Array<[string, number]>) {
            const r = place({ city, mapKind: "world" });
            expect(r.precision, city).toBe("city");
            expect(r.lon, city).toBeCloseTo(lon, 0);
        }
    });

    it("a real cross-country collision is REFUSED bare and resolved by country", () => {
        // Barcelona: Catalonia and Anzoátegui both clear the W bar. Bare = call-out.
        expect(isGeoPointAmbiguity(resolveGeoPoint({ city: "Barcelona", mapKind: "world" }))).toBe(true);
        const es = place({ city: "Barcelona", country: "Spain", mapKind: "world" });
        expect(es.precision).toBe("city");
        expect(es.lon).toBeCloseTo(2.2, 0);
        const ve = place({ city: "Barcelona", country: "Venezuela", mapKind: "world" });
        expect(ve.precision).toBe("city");
        expect(ve.lon).toBeCloseTo(-64.7, 0);
        // Hyderabad: India and Pakistan. Same rule, different continent pair.
        expect(isGeoPointAmbiguity(resolveGeoPoint({ city: "Hyderabad", mapKind: "world" }))).toBe(true);
        expect(place({ city: "Hyderabad", country: "PK", mapKind: "world" }).lon).toBeCloseTo(68.4, 0);
    });

    it("world cities place at CITY precision on the world map — Tokyo, Mumbai, Berlin", () => {
        for (const [city, lon] of [["Tokyo", 139.7], ["Mumbai", 72.9], ["Berlin", 13.4]] as const) {
            const r = place({ city, mapKind: "world" });
            expect(r.precision, city).toBe("city");
            expect(r.lon).toBeCloseTo(lon, 0);
        }
    });

    it("world cities do NOT leak into the NA map's candidate set", () => {
        // Tokyo carries only the W flag: on the NA map nothing matches at the city tier
        // and nothing coarser is derivable from a bare city -> unplaced, honest.
        expect(resolveGeoPoint({ city: "Tokyo" })).toBeNull();
    });
});

describe("multilingual variants — exonyms are doors onto ONE row, never a second place", () => {
    it("matches shipped exonym forms", () => {
        // What the ranked, capped alt selection actually shipped (see geo_build_points):
        // near-forms of the primary, native-diacritic candidates boosted. Regenerating
        // the table can change WHICH doors ship; the invariant is that a door that ships
        // resolves onto the primary's coordinate.
        for (const [variant, lon] of [["Prag", 14.4], ["Praga", 14.4], ["Londen", -0.13]] as const) {
            const r = place({ city: variant, mapKind: "world" });
            expect(r.precision, variant).toBe("city");
            expect(r.lon).toBeCloseTo(lon, 0);
        }
    });

    it("two doors land on the SAME coordinate (one row, never a second place)", () => {
        const a = place({ city: "Prag", mapKind: "world" });
        const b = place({ city: "Prague", mapKind: "world" });
        expect(a.lat).toBe(b.lat);
        expect(a.lon).toBe(b.lon);
    });
});

describe("the constraint rule — non-blank source must match same-or-blank in the lookup", () => {
    it("a contradicting state EXCLUDES the row rather than being ignored", () => {
        // "New York, CA" must not become NYC — the state says otherwise.
        const r = resolveGeoPoint({ city: "New York", state: "CA" });
        expect((r as any)?.lon ?? -999).not.toBeCloseTo(-74, 0);
    });

    it("world rows match their admin1 by NORMALIZED NAME (no code system exists)", () => {
        const r = place({ city: "Munich", state: "Bavaria", mapKind: "world" });
        expect(r.precision).toBe("city");
        expect(r.lon).toBeCloseTo(11.6, 0);
        // …and a state that contradicts every candidate refuses the city tier.
        const wrong = resolveGeoPoint({ city: "Munich", state: "Saxony", mapKind: "world" });
        expect(wrong === null || (wrong as any).precision !== "city").toBe(true);
    });

    it("a blank lookup attribute passes any source constraint", () => {
        // Singapore's row carries no admin1. A source state must not exclude it when the
        // lookup has nothing to compare — blank passes, by rule.
        const r = place({ city: "Singapore", state: "Central Region", mapKind: "world" });
        expect(r.precision).toBe("city");
        expect(r.lon).toBeCloseTo(103.9, 0);
    });
});

describe("aggregate accounting — the info call-out the visual shows", () => {
    it("separates ambiguous (found several) from unplaced (found none)", () => {
        const out = buildGeoPointColumns([
            { city: "Barcelona" },                     // world scope: ES + VE -> refused
            { city: "Zzyzzx Falls" },                  // none
            { city: "Tokyo" },                         // exactly one
        ], "world");
        expect(out.ambiguousRows).toBe(1);
        expect(out.ambiguousExamples).toEqual(["Barcelona"]);
        expect(out.unmatched).toEqual(["Zzyzzx Falls"]);
        expect(out.matchedRows).toBe(1);
        expect(out.lat[0]).toBeNull();                 // refused -> not plotted
    });
});

describe("scope-aware helpers stay back-compatible", () => {
    it("cityMatchPct default is NA-scoped (detection unchanged); world opt-in widens it", () => {
        const worldCities = ["Tokyo", "Mumbai", "Berlin", "Madrid"];
        expect(cityMatchPct(worldCities)).toBe(0);                 // NA default: none known
        expect(cityMatchPct(worldCities, "world")).toBe(100);      // world scope: all known
    });
});
