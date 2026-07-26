// What DEFINES the North America basemap: which regions belong on it, how far north it
// extends, and the pure geometry op that enforces that. No asset imports — geo.ts statically
// pulls ~1.3 MB of generated geometry, so anything that only needs these decisions (tests,
// tooling, future callers) shouldn't have to load the world to read them.

// GREENLAND ("GRL") IS DELIBERATELY ABSENT (2026-07-25). It is geographically North
// American, but it is an enormous and almost always data-less slab, and the NA point-map
// archetype fitExtent()s to this basemap's FULL extent — so including it stretched the fit
// ~40 degrees further east (basemap lon max -12.2 with it, -52.6 without) and squeezed the
// actual continent. This affects ONLY the basemap: WORLD_110M is untouched, so GRL remains
// a perfectly good joinable region on the world choropleths, which is where a Greenland
// data point belongs. Do not "fix" this by adding GRL back.
export const NA_ISO3 = new Set([
    "USA", "CAN", "MEX",                                                 // continental
    "GTM", "BLZ", "SLV", "HND", "NIC", "CRI", "PAN",                     // Central America
    "CUB", "JAM", "HTI", "DOM", "BHS", "PRI", "TTO",                     // Greater Antilles + Bahamas
]);

// NORTHERN CUTOFF (2026-07-25). Dropping Greenland reclaimed the eastern half of the
// frame but barely moved the TOP edge — Canada's Ellesmere/Axel Heiberg islands already reach
// ~83°N, so the map still spent its height on empty Arctic. 75°N keeps every populated region
// (Alaska's north coast ~71°N, Canadian mainland ~72°N) and cuts the uninhabited island bulk.
// Safe against geoNaturalEarth1 specifically: it is PSEUDOCYLINDRICAL, so parallels project to
// straight horizontal lines and a constant-latitude cut renders as an exactly straight edge —
// no densification needed along the seam.
export const NA_LAT_MAX = 75;

// Sutherland–Hodgman against the single half-plane lat <= latMax. Exact in lon/lat space
// (the boundary is a parallel, i.e. a straight line there), so the only approximation is the
// projection's own, which for this projection family is none along a parallel.
function clipRingToLat(ring: number[][], latMax: number): number[][] {
    const out: number[][] = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
        const cur = ring[i];
        const prev = ring[(i + n - 1) % n];
        const curIn = cur[1] <= latMax;
        const prevIn = prev[1] <= latMax;
        if (curIn !== prevIn) {
            // Crossing: emit the point exactly on the parallel.
            const dy = cur[1] - prev[1];
            const t = dy === 0 ? 0 : (latMax - prev[1]) / dy;
            out.push([prev[0] + t * (cur[0] - prev[0]), latMax]);
        }
        if (curIn) out.push(cur);
    }
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
        out.push(out[0]);   // keep the ring closed
    }
    return out;
}

// Returns the feature clipped to lat <= latMax, or null when nothing survives (a region
// entirely above the cutoff simply leaves the basemap). Non-polygon geometry passes through
// untouched — the NA basemap is polygons only, but this must not silently mangle anything else.
export function clipFeatureToLat(feature: any, latMax: number): any | null {
    const g = feature && feature.geometry;
    if (!g) return null;

    const clipPolygon = (rings: number[][][]): number[][][] | null => {
        const kept = rings
            .map(r => clipRingToLat(r, latMax))
            .filter(r => r.length >= 4);   // a closed ring needs 3 distinct points + the repeat
        // If the OUTER ring is gone the whole polygon is gone, holes included.
        return kept.length && kept[0].length >= 4 ? kept : null;
    };

    if (g.type === "Polygon") {
        const c = clipPolygon(g.coordinates as number[][][]);
        return c ? { ...feature, geometry: { type: "Polygon", coordinates: c } } : null;
    }
    if (g.type === "MultiPolygon") {
        const polys = (g.coordinates as number[][][][])
            .map(clipPolygon)
            .filter((p): p is number[][][] => p !== null);
        return polys.length ? { ...feature, geometry: { type: "MultiPolygon", coordinates: polys } } : null;
    }
    return feature;
}
