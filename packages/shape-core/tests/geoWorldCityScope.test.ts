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

describe("THE SCOPE IS THE FLOOR — no second threshold needed", () => {
    // Joel, 2026-08-02, asked whether a basemap should need a minimum placeable share before
    // it is offered at all: "no floor, but we should also be attentive to the chart type since
    // it NAMES the scope... you have a column with city names from all over the world and
    // evenly distributed over countries: that's not going to look like a city column to the
    // North America map, is it? So it's not considered a city, so that could end up
    // disqualifying some map chart types."
    //
    // That is the whole mechanism, and it costs nothing new: the role-identification bar
    // ALREADY behaves as the floor once the classifier answers per scope. These tests are here
    // because that is a claim about emergent behaviour, and a claim about emergent behaviour
    // that nobody pinned is a claim that quietly stops being true.
    const worldSpread = ["Abidjan", "Aachen", "Abeokuta", "Mumbai", "Osaka", "Lyon",
                         "Bogota", "Nairobi", "Dhaka", "Naples"];

    it("a world-spread city column is not a city column TO NORTH AMERICA", () => {
        // Not "a city column with 90% unplaced" — not a city column for that map at all, so
        // North America is never offered and the user never pays a generation to find out.
        expect(detectGeo(worldSpread, "City")!.geoKind).toBe("city-name-world");
    });

    it("a couple of world cities among North American ones does NOT disqualify North America", () => {
        // The floor has to be a share, not a veto: 8 of 10 placeable is a real North American
        // map with two honestly-reported misses, and the two must not cost the other eight.
        const mostlyNA = ["Boston", "Denver", "Chicago", "Austin", "Seattle", "Portland",
                          "Toronto", "Calgary", "Mumbai", "Osaka"];
        expect(detectGeo(mostlyNA, "City")!.geoKind).toBe("city-name");
    });

    it("the switchover is CITY_ROLE_MATCH_PCT, the same knob every other role reads", () => {
        // Nine of ten NA (90%) clears the 80 bar; four of ten (40%) does not. One number,
        // already tuned in matchQuality, doing the work a separate eligibility floor would
        // have duplicated.
        const nineOfTen = ["Boston", "Denver", "Chicago", "Austin", "Seattle", "Portland",
                           "Toronto", "Calgary", "Phoenix", "Osaka"];
        const fourOfTen = ["Boston", "Denver", "Chicago", "Austin",
                           "Mumbai", "Osaka", "Lyon", "Bogota", "Nairobi", "Dhaka"];
        expect(detectGeo(nineOfTen, "City")!.geoKind).toBe("city-name");
        expect(detectGeo(fourOfTen, "City")!.geoKind).toBe("city-name-world");
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
