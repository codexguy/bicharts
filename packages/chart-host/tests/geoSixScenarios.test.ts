// THE SIX FIELD SCENARIOS, 2026-08-02. Asked as "confirm these tests would pass", so they are tests.
//
// Each one walks the FULL host path for its map — detection of the column kind, then either
// the choropleth join key or the point cascade — rather than poking the classifier directly,
// because every bug in this area so far has lived in the seam between two layers that each
// worked. Where a scenario turned up something wrong, the comment says so.
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";
import { detectGeo, toGeoIso, buildGeoIsoColumn, resolveGeoPoint } from "@bicharts/shape-core";

const dim = (name: string) => ({ name, isMeasure: false });
const measure = (name: string) => ({ name, isMeasure: true });
const colNames = (p: { columns: any[] }) => p.columns.map(c => c.name);
const at = (p: { columns: any[]; rows: any[][] }, row: number, col: string) =>
    p.rows[row][colNames(p).indexOf(col)];

describe("1. World Choropleth colours Germany from a Country column", () => {
    const countries = ["Germany", "France", "Italy", "Spain", "Japan", "Brazil", "Kenya", "Chile"];

    it("the column is detected as countries", () => {
        expect(detectGeo(countries, "Country")!.geoKind).toBe("country-name");
    });

    it("Germany resolves to the ISO-3 the basemap is keyed by", () => {
        expect(toGeoIso("Germany", "country-name")).toBe("DEU");
        // ...and the join column is built for every row, which is what paints the polygon.
        const col = buildGeoIsoColumn(countries, "country-name");
        expect(col.iso[0]).toBe("DEU");
        expect(col.matchedRows).toBe(countries.length);
        expect(col.unmatched).toEqual([]);
    });

    it("__geoIso__ lands on the payload the chart binds to", () => {
        const rows = countries.map((Country, i) => ({ Country, Revenue: 100 + i }));
        const p = buildRenderPayload([dim("Country"), measure("Revenue")], rows,
            { column: "Country", kind: "country-name" }, null);
        expect(colNames(p)).toContain("__geoIso__");
        expect(at(p, 0, "__geoIso__")).toBe("DEU");
    });

    it("and it now survives a stray form in the same column", () => {
        // The three country kinds each used to accept one form and null the others; a mixed
        // column left holes in the map. One reader for all three since 0.5.12.
        const mixed = ["Germany", "FRA", "IT", "Spain", "JPN", "Brazil", "KE", "Chile"];
        const col = buildGeoIsoColumn(mixed, "country-name");
        expect(col.unmatched).toEqual([]);
        expect(col.iso).toContain("DEU");
        expect(col.iso).toContain("FRA");
    });
});

describe("2. World Bubbles places Tanzania from a Country column alone", () => {
    // No city, no state, no ZIP - the shape that drew "No coordinate data available".
    const countries = ["Tanzania", "Kenya", "Nigeria", "Egypt", "Ghana", "Morocco", "Zambia", "Angola"];
    const rows = countries.map((Country, i) => ({ Country, Orders: 10 + i }));

    it("the cascade places it at country precision", () => {
        const r = resolveGeoPoint({ country: "Tanzania", mapKind: "world" }) as any;
        expect(r.precision).toBe("country");
        expect(r.lat).toBeGreaterThan(-12); expect(r.lat).toBeLessThan(0);      // ~6S
        expect(r.lon).toBeGreaterThan(29);  expect(r.lon).toBeLessThan(41);     // ~35E
    });

    it("and the payload carries a real coordinate for every row", () => {
        const p = buildRenderPayload([dim("Country"), measure("Orders")], rows, null,
            { country: "Country", mapKind: "world" });
        expect(colNames(p)).toContain("__geoLat__");
        expect(typeof at(p, 0, "__geoLat__")).toBe("number");
        expect(p.geoPoint!.precisionCounts.country).toBe(countries.length);
        expect(p.geoPoint!.unplaced).toBe(0);
    });

    it("the tier is REPORTED, because one dot per country is a claim about scale", () => {
        const p = buildRenderPayload([dim("Country"), measure("Orders")], rows, null,
            { country: "Country", mapKind: "world" });
        expect(p.geoPoint!.precision).toBe("country");
    });
});

describe("3. World Bubbles places Vancouver BC from Country + City", () => {
    // The disambiguation case: Vancouver BC (662k) and Vancouver WA (196k) are both real, and
    // the country column is what separates them.
    const rows = [
        { City: "Vancouver", Country: "Canada", Orders: 5 },
        { City: "Toronto", Country: "Canada", Orders: 9 },
        { City: "Chicago", Country: "United States", Orders: 7 },
        { City: "London", Country: "United Kingdom", Orders: 4 },
        { City: "Paris", Country: "France", Orders: 6 },
        { City: "Tokyo", Country: "Japan", Orders: 8 },
    ];

    it("Canada picks British Columbia, not Washington State", () => {
        const r = resolveGeoPoint({ city: "Vancouver", country: "Canada", mapKind: "world" }) as any;
        expect(r.precision).toBe("city");
        expect(r.lat).toBeGreaterThan(49); expect(r.lat).toBeLessThan(49.6);   // 49.28N, BC
        // Vancouver WA is 45.6N; without the country narrowing this is the row that wins on
        // nothing but ordering, which is the class of bug the country role exists to close.
        expect(r.lat).toBeGreaterThan(48);
    });

    it("the whole table places at city precision", () => {
        const p = buildRenderPayload([dim("City"), dim("Country"), measure("Orders")], rows, null,
            { city: "City", country: "Country", mapKind: "world" });
        expect(p.geoPoint!.precisionCounts.city).toBe(rows.length);
        expect(p.geoPoint!.unplaced).toBe(0);
        expect(at(p, 0, "__geoLat__")).toBeGreaterThan(49);
    });
});

describe("4. North America Bubbles cannot place Tokyo, and says so", () => {
    const rows = [
        { City: "Boston", Country: "United States", Orders: 3 },
        { City: "Denver", Country: "United States", Orders: 4 },
        { City: "Toronto", Country: "Canada", Orders: 5 },
        { City: "Tokyo", Country: "Japan", Orders: 6 },
    ];

    it("Tokyo is not on this basemap, so it is refused - not approximated", () => {
        // THIS SCENARIO FOUND A BUG. It did not refuse: Tokyo is out of the NA city scope, so
        // the row fell through every tier to COUNTRY and was placed on Japan's centroid,
        // 137E, on a map of North America - and counted as placed, so nothing said so.
        //
        // The map must DECLARE itself for the cascade to refuse on its behalf, which is what
        // the visual now does (it passes "north-america" instead of nothing). An absent
        // mapKind still means "no basemap declared, do not filter", so MCP and React callers
        // that never had a map in mind keep the whole gazetteer.
        expect(resolveGeoPoint({ city: "Tokyo", country: "Japan", mapKind: "north-america" })).toBeNull();
        expect(resolveGeoPoint({ city: "Tokyo", country: "Japan" })).not.toBeNull();   // undeclared
    });

    it("the North American rows still place, and Tokyo is REPORTED unplaced by name", () => {
        // The half that matters: a row we cannot place must be counted AND named, never
        // dropped silently and never nudged onto a plausible-looking centroid.
        const p = buildRenderPayload([dim("City"), dim("Country"), measure("Orders")], rows, null,
            { city: "City", country: "Country", mapKind: "north-america" });
        expect(p.geoPoint!.precisionCounts.city).toBe(3);
        expect(p.geoPoint!.unplaced).toBe(1);
        expect(p.geoPoint!.unplacedExamples.join(" ")).toMatch(/Tokyo/);
        expect(at(p, 3, "__geoLat__")).toBeNull();
    });

    it("and the same column on a WORLD map places all four", () => {
        const p = buildRenderPayload([dim("City"), dim("Country"), measure("Orders")], rows, null,
            { city: "City", country: "Country", mapKind: "world" });
        expect(p.geoPoint!.unplaced).toBe(0);
    });
});

describe("5. USA Choropleth by state uses the STATE column and ignores the city", () => {
    const rows = [
        { State: "TX", City: "Austin", Revenue: 10 },
        { State: "CA", City: "Fresno", Revenue: 20 },
        { State: "NY", City: "Buffalo", Revenue: 30 },
        { State: "FL", City: "Orlando", Revenue: 40 },
        { State: "WA", City: "Spokane", Revenue: 50 },
    ];

    it("the state column joins; the city column is not the join key", () => {
        expect(detectGeo(rows.map(r => r.State), "State")!.geoKind).toBe("us-state-code");
        const p = buildRenderPayload([dim("State"), dim("City"), measure("Revenue")], rows,
            { column: "State", kind: "us-state-code" }, null);
        expect(at(p, 0, "__geoIso__")).toBe("TX");
        // A choropleth binds ONE column. The city is along for the ride and must not appear as
        // a second join - "city-name" is deliberately not a join kind, since no bundled
        // geometry is keyed by city and joining on it would null every row.
        expect(colNames(p).filter(n => n === "__geoIso__")).toHaveLength(1);
        expect(toGeoIso("Austin", "city-name")).toBeNull();
    });

    it("a state-only POINT binding lands on the state centre, and reports that tier", () => {
        // The other half of "only State matters here, so pick center of state".
        const r = resolveGeoPoint({ state: "TX" }) as any;
        expect(r.precision).toBe("state");
        expect(r.lat).toBeGreaterThan(28); expect(r.lat).toBeLessThan(34);
        expect(r.lon).toBeGreaterThan(-102); expect(r.lon).toBeLessThan(-94);
    });

    it("full state names and AP abbreviations join the same as codes", () => {
        expect(toGeoIso("California", "us-state-code")).toBe("CA");
        expect(toGeoIso("Calif.", "us-state-name")).toBe("CA");
    });
});

describe("6. USA by ZIP-3 colours 028 from 02813 AND from 2813", () => {
    it("both readings produce the same join key", () => {
        expect(toGeoIso("02813", "us-zip5")).toBe("02813");
        // 2813 is 02813 with the leading zero eaten by integer storage - the whole New England
        // block arrives this way the moment the column is typed as a number.
        expect(toGeoIso("2813", "us-zip5")).toBe("02813");
        expect(toGeoIso(2813 as any, "us-zip5")).toBe("02813");
        expect(toGeoIso("02813.0", "us-zip5")).toBe("02813");
        expect(toGeoIso("02813-1234", "us-zip5")).toBe("02813");
    });

    it("...which is what makes the ZIP-3 prefix 028", () => {
        for (const v of ["02813", "2813", "02813-1234", "02813.0"]) {
            expect(toGeoIso(v, "us-zip5")!.slice(0, 3), v).toBe("028");
        }
    });

    it("a mixed column detects as ZIP and joins on every row", () => {
        const mixed = ["02813", "2813", "90210", "60614", "10001", "1002"];
        const d = detectGeo(mixed, "ZipCode");
        expect(d!.geoKind).toBe("us-zip5");
        const col = buildGeoIsoColumn(mixed, "us-zip5");
        expect(col.unmatched).toEqual([]);
        expect(col.iso.map(z => z!.slice(0, 3))).toContain("028");
    });

    it("and the POINT cascade reads it identically - one reader, not two", () => {
        // The drift that shipped: this branch stripped a float round trip and the join key did
        // not, so a value plotted on a point map and came back unmatched on a choropleth over
        // the very same column.
        const a = resolveGeoPoint({ zip: "02813" }) as any;
        const b = resolveGeoPoint({ zip: "2813" }) as any;
        expect(a.precision).toBe("zip3");
        expect(b.lat).toBe(a.lat);
        expect(b.lon).toBe(a.lon);
    });
});
