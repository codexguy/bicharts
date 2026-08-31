import { describe, it, expect } from "vitest";
import { resolveGeoPoint, buildGeoPointColumns } from "../src/geoPoint";

// A WORLD MAP MAY DRAW EVERY CITY WE HAVE (2026-08-04: "every single city in the gazette
// should be accessible by the world map - I mean, why not?").
//
// The row flags exist to keep a REGIONAL map's candidate set tight, which is real for North
// America — its canvas cannot show Oslo. A world canvas has no such limit, so refusing a row
// because it was generated for the regional table was an artefact of the build, not a property
// of the map. The thresholds are asymmetric by 10x (N = US/CA/MX pop >= 25k, W = worldwide
// pop >= 250k), so a world map refused Boise, Asheville and Kelowna while carrying all three
// in its own bundle — then stacked them on New York and Toronto via the country tier.
describe("the world map reaches the whole gazetteer", () => {
    it("places cities that carry only the North America flag", () => {
        for (const [city, country] of [["Boise", "United States"], ["Asheville", "United States"],
                                       ["Kelowna", "Canada"]] as const) {
            const hit = resolveGeoPoint({ city, country, mapKind: "world" }) as any;
            expect(hit, `${city} must resolve`).toBeTruthy();
            expect(hit.precision, `${city} must land at CITY tier, not the country fallback`).toBe("city");
        }
    });

    it("no longer stacks those cities on the country's largest city", () => {
        const boise = resolveGeoPoint({ city: "Boise", country: "United States", mapKind: "world" }) as any;
        const nyc = resolveGeoPoint({ city: "New York", country: "United States", mapKind: "world" }) as any;
        expect(boise.lat === nyc.lat && boise.lon === nyc.lon).toBe(false);
    });

    // SCOPE IS A PREFERENCE, NOT A FILTER. Widening outright made bare "Sydney" ambiguous
    // (NSW vs Nova Scotia) and refused to plot a name that had always resolved — trading a
    // correct placement for a refusal is not an improvement.
    it("still prefers an in-scope row when one exists, so Sydney keeps Australia", () => {
        const world = resolveGeoPoint({ city: "Sydney", mapKind: "world" }) as any;
        expect(world.precision).toBe("city");
        expect(world.lon).toBeGreaterThan(100);
    });

    it("does NOT widen the North America map — its canvas cannot draw Oslo", () => {
        const hit = resolveGeoPoint({ city: "Oslo", country: "Norway", mapKind: "north-america" }) as any;
        expect(hit === null || hit.precision !== "city").toBe(true);
    });
});

// PER-ROW PRECISION. Without it a chart can only say "N of M positions approximated" — true,
// but never WHICH, so every mark draws as though it were exact. A reader hovering Inverness got
// "Inverness, United Kingdom" over LONDON's coordinates with nothing to distinguish it from the
// London row stacked underneath.
describe("buildGeoPointColumns reports the tier per row", () => {
    const rows = [
        { city: "Oslo", country: "Norway" },       // in the gazetteer -> city
        { city: "Tromso", country: "Norway" },     // not in it        -> country (Oslo's point)
        { city: "Nowhereville", country: "Norway" }, // resolves to nothing at all
    ];

    it("is aligned 1:1 with the input rows", () => {
        const out = buildGeoPointColumns(rows, "world");
        expect(out.precisions).toHaveLength(rows.length);
        expect(out.precisions[0]).toBe("city");
        expect(out.precisions[1]).toBe("country");
    });

    it("marks an unplaced row null rather than guessing a tier", () => {
        const out = buildGeoPointColumns(rows, "world");
        // Nowhereville has a country, so it still places at the country tier — what must never
        // happen is a precision reported for a row with no coordinates.
        for (let i = 0; i < rows.length; i++) {
            if (out.lat[i] === null) expect(out.precisions[i]).toBeNull();
            else expect(out.precisions[i]).not.toBeNull();
        }
    });

    it("the summary counts agree with the per-row array", () => {
        const out = buildGeoPointColumns(rows, "world");
        const tally: Record<string, number> = {};
        for (const p of out.precisions) if (p) tally[p] = (tally[p] || 0) + 1;
        for (const [tier, n] of Object.entries(tally)) {
            expect(out.precisionCounts[tier as keyof typeof out.precisionCounts],
                `precisionCounts.${tier} must equal what the rows actually say`).toBe(n);
        }
    });

    it("the two Norwegian rows land on the SAME point, and the array is what reveals it", () => {
        const out = buildGeoPointColumns(rows, "world");
        expect(out.lat[0]).toBe(out.lat[1]);
        expect(out.lon[0]).toBe(out.lon[1]);
        // Identical coordinates, different tiers — this is the whole point: the chart can now
        // tell that the second one is not where it claims to be.
        expect(out.precisions[0]).not.toBe(out.precisions[1]);
    });
});
