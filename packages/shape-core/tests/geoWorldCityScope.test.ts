// THE GAZETTE IS TRUE NO MATTER THE CHART; THE MAP DECIDES WHICH SUBSET IT CAN DRAW.
//
// Joel, 2026-08-02: "I would expect the gazette entries name cities from across the world.
// The NA map cities have a 'map uses' tag of NA. World map is a superset so they would be
// tagged 'world'. Makes it easy to tell what subset is right to use, depending on the map."
//
// That is exactly what the gazetteer already stores — every row carries kind flags (N = the
// North America basemap can draw it, W = the world one can, 200 rows carry both) — and the
// point cascade has always honoured them. detectGeo was the one place that never asked the
// world question, so 2,213 world-only rows were invisible to it: a column of Abidjan / Aachen
// / Abeokuta classified as NOTHING, and no point map was offered for data made entirely of
// cities.
//
// The scoping is not a coverage compromise. It is what RESOLVES ambiguity, which is why the
// fix is a second KIND rather than a widened default: "Sydney" is Sydney NSW (5.6M, world) and
// Sydney NS (105k, North America), and each map sees exactly one of them.
import { describe, it, expect } from "vitest";
import { detectGeo, isJoinGeoKind } from "../src/geoDetector";
import { isKnownCity, resolveGeoPoint } from "../src/geoPoint";

const WORLD_CITIES = ["Abidjan", "Aachen", "Abeokuta", "Abbottabad", "Aba", "A Coruna"];
const NA_CITIES = ["Boston", "Denver", "Chicago", "Austin", "Seattle", "Portland"];

describe("a column of world cities is recognised as cities", () => {
    it("classified as nothing before; now it names its scope", () => {
        const r = detectGeo(WORLD_CITIES, "City");
        expect(r).not.toBeNull();
        expect(r!.geoKind).toBe("city-name-world");
    });

    it("NORTH AMERICA still gets first refusal, so nothing existing moves", () => {
        // The load-bearing half. "city-name" makes EVERY point map offerable, so a column the
        // NA rows already explain must keep that kind or charts silently change.
        expect(detectGeo(NA_CITIES, "City")!.geoKind).toBe("city-name");
    });

    it("neither city kind is a polygon join key", () => {
        // No bundled geometry is keyed by city; joining on one would null every row and draw a
        // blank choropleth with no error.
        expect(isJoinGeoKind("city-name")).toBe(false);
        expect(isJoinGeoKind("city-name-world")).toBe(false);
    });

    it("a region kind still outranks either, as it always did", () => {
        // "Mexico", "Washington", "New York" are cities AND regions; the region reading wins.
        const r = detectGeo(["France", "Germany", "Italy", "Spain", "Japan", "Brazil"], "Country");
        expect(r!.geoKind).toBe("country-name");
    });

    it("a roster of proper nouns is still not a city column", () => {
        expect(detectGeo(["Alice", "Bob", "Carol"], "Owner")).toBeNull();
    });
});

describe("the scope is what settles an ambiguous name", () => {
    it("Sydney means Australia on a world map and Nova Scotia on a North America one", () => {
        const world = resolveGeoPoint({ city: "Sydney", mapKind: "world" }) as any;
        const na = resolveGeoPoint({ city: "Sydney", mapKind: "north-america" }) as any;
        expect(world.precision).toBe("city");
        expect(na.precision).toBe("city");
        expect(world.lon).toBeGreaterThan(100);      // NSW, ~151E
        expect(na.lon).toBeLessThan(-50);            // Cape Breton, ~60W
    });

    it("the same row-level tags detectGeo now reads", () => {
        expect(isKnownCity("abidjan")).toBe(false);              // not on the NA basemap
        expect(isKnownCity("abidjan", "world")).toBe(true);
        expect(isKnownCity("boston")).toBe(true);                // tagged for both
        expect(isKnownCity("boston", "world")).toBe(true);
    });
});
