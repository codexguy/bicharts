import { describe, it, expect } from "vitest";
import { US_ZIP3 } from "../src/geoUsZip3.generated";
import { resolveGeoPoint } from "@bicharts/shape-core";
import { ZIP3_PACKED } from "../../shape-core/src/geoPointTables.generated";

// THE TWO ZIP-3 TABLES HAVE TO AGREE.
//
// There are two of them and they serve different lanes:
//   • the POLYGONS here, which the ZIP-3 choropleth joins __geoIso__ against;
//   • the POINT CENTROIDS in shape-core, which the geoPoint cascade
//     (City+State -> ZIP5/ZIP3 -> State) uses to place a bubble.
//
// The second is DERIVED from the first — area centroids of these very polygons — so they
// can only ever disagree by someone regenerating one and not the other. That is exactly
// what happened: recovering the five regions the simplifier destroyed (111 Long Island
// City, 202/204/205 Washington DC, 753 Dallas) fixed the choropleth and left the point
// table at 891 rows, so those ZIPs had a shape but still could not be geocoded to a dot.
//
// The failure is quiet in both directions. A polygon with no centroid means a point map
// silently drops the row; a centroid with no polygon means a choropleth reports a region
// it cannot draw. Neither throws, and neither looks wrong on screen.
//
// This test is deliberately in chart-host rather than shape-core: it is the only place
// that can see both sides, since chart-host holds the geometry and depends on shape-core.

const pointIds = new Set(ZIP3_PACKED.split(",").map(r => r.split("|")[0]));
const polyIds = new Set((US_ZIP3.features as any[]).map(f => f.id));

describe("the ZIP-3 polygon and point tables cover the same regions", () => {
    it("every polygon has a centroid the point cascade can place", () => {
        const orphans = [...polyIds].filter(id => !pointIds.has(id)).sort();
        expect(orphans, "these ZIP-3s draw on the choropleth but cannot be geocoded to a point")
            .toEqual([]);
    });

    it("every centroid has a polygon the choropleth can draw", () => {
        const orphans = [...pointIds].filter(id => !polyIds.has(id)).sort();
        expect(orphans, "these ZIP-3s resolve to a point but have no region to fill")
            .toEqual([]);
    });

    it("both are the full 896 the source shapefile carries", () => {
        expect(polyIds.size).toBe(896);
        expect(pointIds.size).toBe(896);
    });
});

describe("the recovered regions resolve through the real cascade", () => {
    // Coverage on paper is not the same as a working lookup, so this drives the actual
    // public entry point rather than reading the table.
    const cases: Array<[string, string, number, number]> = [
        ["11101", "Long Island City NY", -73.93, 40.76],
        ["20202", "Washington DC federal", -77.03, 38.89],
        ["20405", "Washington DC federal", -77.05, 38.89],
        ["20500", "Washington DC federal", -77.01, 38.87],
        ["75301", "Dallas TX", -96.84, 32.81],
    ];

    for (const [zip, label, lon, lat] of cases) {
        it(`${zip} (${label}) places within a degree of where it belongs`, () => {
            const r = resolveGeoPoint({ zip } as any);
            expect(r, `${zip} did not resolve at all`).toBeTruthy();
            expect(r!.precision).toBe("zip3");
            expect(Math.abs(r!.lon - lon), `${zip} longitude`).toBeLessThan(1);
            expect(Math.abs(r!.lat - lat), `${zip} latitude`).toBeLessThan(1);
        });
    }
});
