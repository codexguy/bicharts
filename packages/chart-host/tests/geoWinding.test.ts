import { describe, it, expect } from "vitest";
import { geoArea } from "d3-geo";
import { WORLD_110M } from "../src/geoWorld110m.generated";
import { US_STATES } from "../src/geoUsStates.generated";
import { US_ZIP3 } from "../src/geoUsZip3.generated";

// AN INVERTED RING IS INVISIBLE UNTIL IT DESTROYS THE WHOLE MAP.
//
// d3-geo follows the TopoJSON winding convention, NOT RFC 7946: an exterior ring winds
// CLOCKWISE (negative planar shoelace in lon/lat) and a hole winds counter-clockwise —
// the opposite of the GeoJSON spec, and the opposite of what "counter-clockwise exteriors"
// intuition says. Reverse an exterior and d3 reads it as the whole sphere MINUS the region.
//
// Nothing throws. The feature still has plausible coordinates, still joins to its id, still
// carries the right value. What breaks is every consumer that fits a projection to the
// collection's extent: geoBounds returns [[-180,-90],[180,90]], fitExtent/fitSize scales the
// globe into the container, and the map shears into nonsense — with the failure attributed
// to the projection, the container, or the data, because the geometry "looks fine" in JSON.
//
// This shipped. ZIP-3 asset v3 recovered five regions (111 Long Island City, 202/204/205
// Washington DC, 753 Dallas) from the source shapefile and helpfully "fixed" their winding
// to counter-clockwise on the way in. Five inverted polygons out of 896 were enough to
// wreck the entire US map. The recovery script had a guard — it checked the SOURCE rings —
// and the guard passed, because the bug was in the correction applied afterwards.
//
// So this asserts the OUTPUT, over every bundled asset, using the same function d3.geoPath
// integrates: no feature may enclose more than a hemisphere. Nothing real does — Russia,
// the largest country here, is ~0.42 sr against a 12.57 sr sphere — so the threshold has
// enormous headroom and only inversion can trip it.

const ASSETS: Array<[string, any]> = [
    ["world-110m", WORLD_110M],
    ["us-states", US_STATES],
    ["us-zip3", US_ZIP3],
];

const HEMISPHERE = 2 * Math.PI;

describe("no bundled geometry is wound inside-out", () => {
    for (const [name, asset] of ASSETS) {
        it(`${name}: every feature encloses less than a hemisphere`, () => {
            const inverted = (asset.features as any[])
                .filter(f => f.geometry && geoArea(f) > HEMISPHERE)
                .map(f => f.id);
            expect(inverted, `${name} features are inside-out; a projection fitted to this ` +
                `collection will fit the globe`).toEqual([]);
        });

        it(`${name}: the collection as a whole is smaller than the sphere`, () => {
            // A single inverted ring can hide inside a large collection if the per-feature
            // check is ever loosened. The total is the backstop: real coverage is a few
            // percent of the sphere, and one inversion alone exceeds it.
            expect(geoArea(asset)).toBeLessThan(HEMISPHERE);
        });
    }

    it("us-zip3 covers the area ZCTA3 actually describes, not more", () => {
        // A regression fence with a real number behind it. ZCTA3 bounds POPULATED delivery
        // areas, so it deliberately does NOT tile the country — most of Alaska and Nevada
        // have no ZIP at all. ~0.186 sr ≈ 7.5M km²; the US is 9.83M km². If this ever jumps
        // toward the full landmass, someone has expanded coverage into unpopulated land and
        // the map is now asserting data where none exists.
        const sr = geoArea(US_ZIP3);
        expect(sr).toBeGreaterThan(0.15);
        expect(sr).toBeLessThan(0.25);
    });
});
