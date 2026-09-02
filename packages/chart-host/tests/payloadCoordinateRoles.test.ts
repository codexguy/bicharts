// EXPLICIT COORDINATES MUST ACTUALLY BE USED (2026-09-02).
//
// buildRenderPayload built its point-role candidate list as `cols.filter(c => !c.isMeasure)`,
// and shape-core carried a hinted role over only if the name was in that list. Coordinates are
// ALWAYS measures, so the `lat` and `lon` roles were unreachable by construction: every point
// map fell through to geocoding place NAMES from the gazetteer instead.
//
// It failed silently — the carry-over loop had no `else`, so nothing landed in `rolesRefused` —
// and it was invisible on real data because a city's gazetteer coordinate and its own coordinate
// agree to about a pixel. What gave it away was rows going MISSING: a row whose place name is
// ambiguous ("Vancouver" is BC and WA) is refused by the name tier while carrying an exact
// coordinate that needed no lookup at all.
//
// The archetype prompts say the opposite in as many words — "read coordinates from the data rows
// ... NEVER geocode place names" — so this was the host contradicting the contract it hands the
// model.
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";

const COLS = [
    { name: "City", isMeasure: false, dataType: "String" },
    { name: "Latitude", isMeasure: true, dataType: "Decimal" },
    { name: "Longitude", isMeasure: true, dataType: "Decimal" },
    { name: "Revenue", isMeasure: true, dataType: "Integer" },
];

// Vancouver is the case that exposed it: the name is ambiguous (BC and WA), the coordinate is
// not. Nowhereville has no gazetteer entry at all and is placeable only from its coordinates.
const ROWS = [
    { City: "Boston", Latitude: 42.3601, Longitude: -71.0589, Revenue: 477000 },
    { City: "Vancouver", Latitude: 49.2827, Longitude: -123.1207, Revenue: 338000 },
    { City: "Nowhereville", Latitude: 44.1234, Longitude: -95.4321, Revenue: 12000 },
];

const at = (p: any, i: number) => {
    const la = p.columns.findIndex((c: any) => c.name === "__geoLat__");
    const lo = p.columns.findIndex((c: any) => c.name === "__geoLon__");
    return [p.rows[i][la], p.rows[i][lo]] as [number, number];
};

describe("coordinates that arrive as measures", () => {
    it("are used, and every row places at the latlon tier", () => {
        const p = buildRenderPayload(COLS, ROWS, null,
            { lat: "Latitude", lon: "Longitude", city: "City" } as any);
        expect(p.geoPoint!.precisionCounts.latlon).toBe(3);
        expect(p.geoPoint!.precisionCounts.city).toBe(0);
        expect(p.geoPoint!.precision).toBe("latlon");
    });

    it("place at the DATA's coordinate, not the gazetteer's", () => {
        // The whole point, and the half that is invisible on a real city: a chart drawn from
        // the lookup table does not move when the user edits a Latitude cell.
        const p = buildRenderPayload(COLS, ROWS, null,
            { lat: "Latitude", lon: "Longitude", city: "City" } as any);
        expect(at(p, 0)).toEqual([42.3601, -71.0589]);

        const edited = ROWS.map((r, i) => (i === 0 ? { ...r, Latitude: 10.5, Longitude: 20.25 } : r));
        const q = buildRenderPayload(COLS, edited, null,
            { lat: "Latitude", lon: "Longitude", city: "City" } as any);
        expect(at(q, 0)).toEqual([10.5, 20.25]);
    });

    it("do not lose a row whose NAME is ambiguous", () => {
        // "Vancouver" matches BC and WA, so the city tier refuses it — while the row carries a
        // coordinate that needs no lookup. It was reported honestly ("1 row not shown: place
        // name matches several cities") and the reason was absurd.
        const p = buildRenderPayload(COLS, ROWS, null,
            { lat: "Latitude", lon: "Longitude", city: "City" } as any);
        expect(p.geoPoint!.ambiguousRows).toBe(0);
        expect(p.geoPoint!.unplaced).toBe(0);
        expect(at(p, 1)).toEqual([49.2827, -123.1207]);
    });

    it("place a row the gazetteer has never heard of", () => {
        const p = buildRenderPayload(COLS, ROWS, null,
            { lat: "Latitude", lon: "Longitude", city: "City" } as any);
        expect(at(p, 2)).toEqual([44.1234, -95.4321]);
    });
});

describe("what the measure exclusion was actually protecting, still protected", () => {
    it("a MEASURE of five-digit numbers is not adopted as the ZIP column", () => {
        // The reason `columns` excludes measures: a store number or a revenue figure is a
        // syntactically perfect ZIP and adopting one relocates every point. Backfill still
        // draws from the dimension list alone; only the two hinted coordinate roles were
        // widened.
        const cols = [
            { name: "City", isMeasure: false, dataType: "String" },
            { name: "Revenue", isMeasure: true, dataType: "Integer" },
        ];
        const rows = [
            { City: "Boston", Revenue: 90210 },
            { City: "Denver", Revenue: 60614 },
            { City: "Miami", Revenue: 10001 },
        ];
        const p = buildRenderPayload(cols, rows, null, { city: "City" } as any);
        expect((p.geoPoint!.rolesBackfilled ?? []).join(" ")).not.toMatch(/zip/i);
        expect(p.geoPoint!.precisionCounts.zip3).toBe(0);
    });

    it("a coordinate pair that holds no usable value is still refused", () => {
        // The one-row bar at the bottom of resolvePointRoles, unchanged: reachable roles do not
        // mean unverified ones.
        const rows = [
            { City: "Boston", Latitude: "", Longitude: "", Revenue: 1 },
            { City: "Denver", Latitude: null, Longitude: null, Revenue: 2 },
        ];
        const p = buildRenderPayload(COLS, rows, null,
            { lat: "Latitude", lon: "Longitude", city: "City" } as any);
        // City still places them; the coordinate roles simply carried nothing.
        expect(p.geoPoint!.precisionCounts.latlon).toBe(0);
    });
});
