import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// The extent signal AS THE SCANNER PRODUCES IT — the unit tests next door prove the maths, this
// proves the wiring: that a country column gets its region fields, that a coordinate pair gets an
// extent, and above all that a shape with neither pays nothing and reports nothing.

const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue =>
    ({ name, dataType, isMeasure } as LLMColumnWithValue);

// Privacy level 20 ("Detailed Stats") is the product default and the tier the geo signals
// actually ship at — see the note on the detection block, and the finding recorded with it:
// below 20 no geoKind is emitted at all, so no map is ever offered.
function scan(cols: LLMColumnWithValue[], rows: any[][], pl = "20") {
    const it = new IndexedText();
    it.setColumns(cols);
    for (const r of rows) it.addRow(r);
    return { it, stats: it.getColumnsWithStats(pl) };
}

describe("country column -> region fields", () => {
    it("flags a country column confined to one region — the grey-world case", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 12; i++) rows.push([["US", "CA", "MX"][i % 3], 100 + i]);
        const { stats } = scan([col("Country", "String"), col("Revenue", "Decimal", true)], rows);
        const c = stats.find(s => s.name === "Country")!;
        expect(c.geoKind).toMatch(/^country/);
        expect(c.dominantGeoRegion).toBe("north-america");
        expect(c.dominantGeoRegionPct).toBe(100);
        expect(c.geoRegionCount).toBe(1);
    });

    it("reports a genuinely global country column as spread across regions", () => {
        const names = ["United States", "Brazil", "Germany", "Japan", "Australia", "Kenya"];
        const rows = names.map((n, i) => [n, 10 + i]);
        const { stats } = scan([col("Country", "String"), col("Revenue", "Decimal", true)], rows);
        const c = stats.find(s => s.name === "Country")!;
        expect(c.geoRegionCount).toBeGreaterThanOrEqual(5);
        expect(c.dominantGeoRegionPct).toBeLessThan(40);
    });

    // THE REASON THE WEIGHTING IS BY ROWS.
    it("weights by rows, not by distinct values", () => {
        // Twenty US rows and one Japanese row is a US dataset. Counting distinct values would
        // call it 50/50 and frame it as a world map with a single bubble in Asia.
        const rows: any[][] = [];
        for (let i = 0; i < 20; i++) rows.push(["US", i]);
        rows.push(["JP", 99]);
        const { stats } = scan([col("Country", "String"), col("Sales", "Decimal", true)], rows);
        const c = stats.find(s => s.name === "Country")!;
        expect(c.dominantGeoRegion).toBe("north-america");
        expect(c.dominantGeoRegionPct).toBeGreaterThan(90);
    });

    it("leaves a non-country column alone", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 10; i++) rows.push([["North", "South", "East"][i % 3], i]);
        const { stats } = scan([col("Region", "String"), col("Sales", "Decimal", true)], rows);
        const c = stats.find(s => s.name === "Region")!;
        expect(c.dominantGeoRegion).toBeUndefined();
        expect(c.geoRegionCount).toBeUndefined();
    });
});

describe("getGeoExtent", () => {
    const LAT_LON = [col("City", "String"), col("Latitude", "Decimal"), col("Longitude", "Decimal"), col("Sales", "Decimal", true)];

    it("measures an all-US coordinate set", () => {
        const { it } = scan(LAT_LON, [
            ["New York", 40.71, -74.01, 10], ["Los Angeles", 34.05, -118.24, 20],
            ["Chicago", 41.88, -87.63, 30], ["Houston", 29.76, -95.37, 40],
        ]);
        const e = it.getGeoExtent()!;
        expect(e.pctUsa).toBe(100);
        expect(e.n).toBe(4);
    });

    // THE CASE THE WHOLE SIGNAL EXISTS FOR.
    it("measures a European coordinate set as neither US nor North American", () => {
        const { it } = scan(LAT_LON, [
            ["London", 51.51, -0.13, 10], ["Paris", 48.86, 2.35, 20],
            ["Berlin", 52.52, 13.40, 30], ["Madrid", 40.42, -3.70, 40],
        ]);
        const e = it.getGeoExtent()!;
        expect(e.pctUsa).toBe(0);
        expect(e.pctNa).toBe(0);
    });

    it("uses a country column to get the US/Canada border right", () => {
        // Toronto and Montreal sit inside any box drawn around the contiguous US, so without
        // the country column this would read as a mostly-American dataset.
        const cols = [col("City", "String"), col("Country", "String"),
                      col("Latitude", "Decimal"), col("Longitude", "Decimal")];
        const { it } = scan(cols, [
            ["Toronto", "CA", 43.65, -79.38], ["Montreal", "CA", 45.50, -73.57],
            ["Vancouver", "CA", 49.28, -123.12], ["New York", "US", 40.71, -74.01],
        ]);
        const e = it.getGeoExtent()!;
        expect(e.pctNa).toBe(100);
        expect(e.pctUsa).toBe(25);
    });

    it("never counts a blank coordinate as a point at (0,0)", () => {
        const { it } = scan(LAT_LON, [
            ["New York", 40.71, -74.01, 10], ["Nowhere", null, null, 20],
            ["Chicago", 41.88, -87.63, 30], ["Blank", "", "", 40],
            ["Houston", 29.76, -95.37, 50],
        ]);
        const e = it.getGeoExtent()!;
        expect(e.n).toBe(3);
        expect(e.pctUsa).toBe(100);
        expect(e.latP5).toBeGreaterThan(20);   // a phantom (0,0) would drag this to the equator
    });

    it("is null when the shape has no coordinate pair — every non-map chart pays nothing", () => {
        const { it } = scan([col("Product", "String"), col("Sales", "Decimal", true)],
            [["A", 1], ["B", 2], ["C", 3]]);
        expect(it.getGeoExtent()).toBeNull();
    });

    it("is null on a lone latitude — half a coordinate is not a location", () => {
        const { it } = scan([col("Latitude", "Decimal"), col("Sales", "Decimal", true)],
            [[40.71, 1], [34.05, 2], [41.88, 3]]);
        expect(it.getGeoExtent()).toBeNull();
    });

    it("does not mistake a decoy name for a coordinate", () => {
        // 'Long Description' tokenises to a 'long' that looks exactly like a longitude; it is a
        // String column, so it must never be adopted as one.
        const { it } = scan([col("Latitude", "Decimal"), col("Long Description", "String"), col("Sales", "Decimal", true)],
            [[40.71, "x", 1], [34.05, "y", 2], [41.88, "z", 3]]);
        expect(it.getGeoExtent()).toBeNull();
    });

    it("caches — the second call cannot disagree with the first", () => {
        const { it } = scan(LAT_LON, [
            ["New York", 40.71, -74.01, 10], ["Los Angeles", 34.05, -118.24, 20],
            ["Chicago", 41.88, -87.63, 30],
        ]);
        expect(it.getGeoExtent()).toEqual(it.getGeoExtent());
    });
});
