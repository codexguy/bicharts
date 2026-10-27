import { describe, it, expect, beforeEach } from "vitest";
import { summarizeGeoExtent, inRegionFrame, REGION_FRAME_WINDOWS } from "../src/geoExtent";
import { IndexedText } from "../src/indexedText";
import { registerAdmin1Lookup, clearAdmin1LookupForTests } from "../src/admin1Lookup";
import type { LLMColumnWithValue } from "../src/models";

// The continent frames' windows: where a point DRAWS on a continent map, so a coordinate table can be offered the
// continent (and, while the reader derives provinces, its province map) on where its points sit.
describe("continent frame windows", () => {
    it("places points by the window the continent map draws", () => {
        expect(inRegionFrame(48.85, 2.35, "europe")).toBe(true);       // Paris
        expect(inRegionFrame(55.75, 37.62, "europe")).toBe(true);      // Moscow, inside Europe's window
        expect(inRegionFrame(43.1, 131.9, "asia")).toBe(true);         // Vladivostok: Russia, but drawn on Asia's map
        expect(inRegionFrame(43.1, 131.9, "europe")).toBe(false);
        expect(inRegionFrame(-1.29, 36.82, "africa")).toBe(true);      // Nairobi
        expect(inRegionFrame(-23.55, -46.63, "south-america")).toBe(true);
        expect(inRegionFrame(43.65, -79.38, "north-america")).toBe(true);
    });

    it("wraps Oceania's window across the antimeridian", () => {
        expect(inRegionFrame(-18.14, 178.44, "oceania")).toBe(true);   // Suva, west of 180
        expect(inRegionFrame(-13.83, -171.76, "oceania")).toBe(true);  // Apia, east of 180 (188 on the window's scale)
        expect(inRegionFrame(-13.83, -171.76, "south-america")).toBe(false);
        expect(inRegionFrame(21.3, -157.86, "oceania")).toBe(false);   // Honolulu: north of the window (it is North America's)
        expect(inRegionFrame(21.3, -157.86, "north-america")).toBe(true);
    });

    it("summarizes the share in each frame and the one holding most points", () => {
        const pts = [
            { lat: 48.85, lon: 2.35 }, { lat: 52.52, lon: 13.4 }, { lat: 40.42, lon: -3.7 }, { lat: 41.9, lon: 12.5 },
            { lat: 35.68, lon: 139.69 },
        ];
        const s = summarizeGeoExtent(pts)!;
        expect(s.dominantFrame).toBe("europe");
        expect(s.dominantFramePct).toBe(80);
        expect(s.regionPct!.asia).toBe(20);
        expect(Object.keys(s.regionPct!).sort()).toEqual(Object.keys(REGION_FRAME_WINDOWS).sort());
        // The fields that were there before are unchanged.
        expect(s.n).toBe(5);
        expect(s.pctNa).toBe(0);
    });

    it("names no frame when no point sits in one", () => {
        // The open Pacific south of Hawaii: below North America's window, east of Oceania's.
        const s = summarizeGeoExtent([{ lat: 0, lon: -140 }, { lat: 1, lon: -141 }, { lat: -1, lon: -139 }])!;
        expect(s.dominantFrame).toBeUndefined();
        expect(s.regionPct!.oceania).toBe(0);
    });
});

describe("the latitude column carries the coordinates' frame", () => {
    beforeEach(() => clearAdmin1LookupForTests());

    const profile = (derive: boolean) => {
        const t = new IndexedText();
        t.deriveProvinces = derive;
        t.setColumns([{ name: "Store", dataType: "String", isMeasure: false } as LLMColumnWithValue,
                      { name: "Latitude", dataType: "Decimal", isMeasure: false } as LLMColumnWithValue,
                      { name: "Longitude", dataType: "Decimal", isMeasure: false } as LLMColumnWithValue,
                      { name: "Revenue", dataType: "Decimal", isMeasure: true } as LLMColumnWithValue]);
        const pts = [[48.85, 2.35], [52.52, 13.4], [40.42, -3.7], [41.9, 12.5], [50.85, 4.35], [59.33, 18.07]];
        pts.forEach(([la, lo], i) => t.addRow([`S${i}`, la, lo, 100 + i]));
        return t.getColumnsWithStats("10").find(c => c.name === "Latitude")!;
    };

    it("deriving provinces: the frame and the share a province map can place", () => {
        const lat = profile(true);
        expect(lat.dominantGeoRegion).toBe("europe");
        expect(lat.dominantGeoRegionPct).toBe(100);
        expect(lat.admin1RollupPct).toBe(100);
    });

    it("not deriving provinces: the frame still ships, the province share does not", () => {
        const lat = profile(false);
        expect(lat.dominantGeoRegion).toBe("europe");
        expect(lat.admin1RollupPct).toBeUndefined();
    });

    it("not deriving provinces: a city column is not measured for its rollup", () => {
        registerAdmin1Lookup({ version: 1, cities: "paris|FR|11|2138|48.85|2.35||FR-IDF\nlyon|FR|84|520|45.75|4.85||FR-ARA\nmarseille|FR|93|870|43.30|5.37||FR-PAC",
                               admin1: "FR.11|ile de france|\nFR.84|auvergne rhone alpes|\nFR.93|provence alpes cote d azur|",
                               crosswalk: "FR.11|FR-IDF\nFR.84|FR-ARA\nFR.93|FR-PAC" });
        const run = (derive: boolean) => {
            const t = new IndexedText();
            t.deriveProvinces = derive;
            t.setColumns([{ name: "City", dataType: "String", isMeasure: false } as LLMColumnWithValue,
                          { name: "Revenue", dataType: "Decimal", isMeasure: true } as LLMColumnWithValue]);
            for (const [c, v] of [["Paris", 1], ["Lyon", 2], ["Marseille", 3]] as const) t.addRow([c, v]);
            return t.getColumnsWithStats("10").find(c => c.name === "City")!;
        };
        const on = run(true), off = run(false);
        if (on.geoKind?.startsWith("city")) expect(on.admin1RollupPct).toBe(100);
        expect(off.admin1RollupPct).toBeUndefined();
    });
});

describe("the Middle East: an overlapping frame beside the partition", () => {
    it("knows its 17 members by code or by name, and they keep their continents", async () => {
        const { inMiddleEast, countryRegion, summarizeCountryRegions } = await import("../src/geoExtent");
        for (const c of ["Egypt", "IR", "IRN", "Saudi Arabia", "Turkey", "Cyprus", "UAE", "Palestine"]) expect(inMiddleEast(c), c).toBe(true);
        for (const c of ["Libya", "Pakistan", "Greece", "Afghanistan"]) expect(inMiddleEast(c), c).toBe(false);
        expect(countryRegion("Egypt")).toBe("africa");
        expect(countryRegion("Iran")).toBe("asia");
        // A Middle East table splits between Asia and Africa, and the share is what names it.
        const s = summarizeCountryRegions(["Egypt", "Saudi Arabia", "Iran", "Iraq", "Jordan", "Turkey", "Egypt", "Egypt"])!;
        expect(s.dominantGeoRegionPct).toBeLessThan(99);
        expect(s.middleEastPct).toBe(100);
        expect(summarizeCountryRegions(["Egypt", "Libya", "Sudan", "Kenya"])!.middleEastPct).toBe(25);
    });

    it("lands on a country column's profile", async () => {
        const { IndexedText } = await import("../src/indexedText");
        const t = new IndexedText();
        t.setColumns([{ name: "Country", dataType: "String", isMeasure: false } as any, { name: "Sales", dataType: "Decimal", isMeasure: true } as any]);
        for (const [c, v] of [["Egypt", 1], ["Saudi Arabia", 2], ["Iran", 3], ["Turkey", 4], ["Jordan", 5]] as const) t.addRow([c, v]);
        const col = t.getColumnsWithStats("10").find(c => c.name === "Country")!;
        expect(col.geoKind).toBe("country-name");
        expect(col.middleEastPct).toBe(100);
    });
});

describe("ingest carries the Derive Provinces setting", () => {
    it("off measures no coordinate rollup", async () => {
        const { ingest } = await import("../src/ingest");
        const rows = [[48.85, 2.35, 1], [52.52, 13.4, 2], [40.42, -3.7, 3], [41.9, 12.5, 4]];
        const on = ingest({ kind: "grid", header: ["Latitude", "Longitude", "Sales"], rows }, { measures: ["Sales"] });
        const off = ingest({ kind: "grid", header: ["Latitude", "Longitude", "Sales"], rows }, { measures: ["Sales"], deriveProvinces: false });
        expect(on.columns.find(c => c.name === "Latitude")!.admin1RollupPct).toBe(100);
        expect(off.columns.find(c => c.name === "Latitude")!.admin1RollupPct).toBeUndefined();
    });
});
