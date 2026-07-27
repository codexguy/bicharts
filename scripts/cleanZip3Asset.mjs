// Clean the ZIP-3 asset: drop entries carrying no geometry, and dissolve empty interior
// rings.
//
// THE GEOMETRY-LESS ENTRIES FIRST, because that half changes an answer rather than a look.
// The source asset ships at least one feature with `"coordinates": []` — ZIP-3 111, Long
// Island City NY, very much populated. A row binding to it joins a feature id that EXISTS,
// so the unmatched counter stays quiet, and then nothing draws: that revenue is simply gone
// from the map with nothing admitting it. Dropping the empty shell turns the silence into
// the "N regions unmatched" annotation the choropleth archetype already renders. A stated
// gap beats a hidden one. (The real repair is geometry for 111 in the upstream ZCTA3
// source; until then this is the honest handling.)
//
// THE HOLES. ZCTA3 boundaries are drawn around populated areas, so a region with an
// unpopulated interior (the Big Island's volcanic centre is the clearest case) comes out as
// a polygon with a hole in it. On a choropleth that hole reads as missing data or a
// rendering fault; it is neither. Nobody asking "revenue by ZIP-3" cares that the caldera
// has no postal route, so the honest outline is the region's outer extent.
//
// THE PART THAT IS NOT COSMETIC: 14 of the 364 holes are real ENCLAVES — a hole in one
// ZIP-3 that another ZIP-3 sits inside (175/176, 200/203, 290/292, 310/312, 467/468,
// 484/485, 488/489, 506/507 …). Fill one of those and the enclave gets painted with its
// neighbour's colour, which is a WRONG VALUE wearing the costume of a styling choice. So
// this keeps any ring that contains another feature's geometry and drops only the rest.
//
// Idempotent: re-running finds nothing left to remove. Run with `node scripts/cleanZip3Asset.mjs`
// after regenerating the asset, then rebuild the package.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "packages", "chart-host", "src", "geoUsZip3.generated.ts");

const text = readFileSync(SRC, "utf-8");
const MARK = "export const US_ZIP3: any = ";
const at = text.indexOf(MARK);
if (at < 0) throw new Error("US_ZIP3 export not found — did the generator's shape change?");
const head = text.slice(0, at + MARK.length);
const jsonStart = at + MARK.length;
const jsonEnd = text.lastIndexOf(";");
const geo = JSON.parse(text.slice(jsonStart, jsonEnd));

/** Point-in-ring, ray casting. Rings here are plain [lon, lat] arrays. */
function inside([x, y], ring) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-15) + xi) hit = !hit;
    }
    return hit;
}
const bbox = (ring) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return [x0, y0, x1, y1];
};

// One representative point per feature: the first vertex of its largest exterior ring.
// Enough to decide containment, because ZIP-3 regions do not interleave at vertex level.
const reps = [];
for (const f of geo.features) {
    const g = f.geometry, co = g?.coordinates;
    const exts = g?.type === "Polygon" ? (co?.[0] ? [co[0]] : [])
        : g?.type === "MultiPolygon" ? co.map((p) => p[0]).filter(Boolean) : [];
    if (exts.length) reps.push([f.id, exts.reduce((a, b) => (b.length > a.length ? b : a))[0]]);
}

let kept = 0, dropped = 0, coordsDropped = 0;
const keptIds = [];
function strip(poly, ownId) {
    const out = [poly[0]];
    for (const ring of poly.slice(1)) {
        const [x0, y0, x1, y1] = bbox(ring);
        const enclave = reps.some(([id, p]) =>
            id !== ownId && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && inside(p, ring));
        if (enclave) { out.push(ring); kept++; keptIds.push(ownId); }
        else { dropped++; coordsDropped += ring.length; }
    }
    return out;
}
for (const f of geo.features) {
    const g = f.geometry;
    if (g?.type === "Polygon" && g.coordinates?.length) g.coordinates = strip(g.coordinates, f.id);
    else if (g?.type === "MultiPolygon") g.coordinates = g.coordinates.map((p) => (p?.length ? strip(p, f.id) : p));
}

// Geometry-less entries: nothing to draw, and their mere presence in the id space is what
// makes the loss silent. Removed so the join reports them as unmatched instead.
const empty = geo.features.filter((f) => {
    const co = f?.geometry?.coordinates ?? [];
    return f?.geometry?.type === "Polygon" ? co.length === 0
         : f?.geometry?.type === "MultiPolygon" ? !co.some((p) => p?.length) : true;
});
if (empty.length) geo.features = geo.features.filter((f) => !empty.includes(f));

const body = JSON.stringify(geo);
writeFileSync(SRC, head + body + ";\n", "utf-8");
const before = text.length, after = head.length + body.length + 2;
console.log(`geometry-less entries ... ${empty.length}  -> ${empty.map((f) => f.id).join(", ") || "(none)"}`);
console.log(`features ................ ${geo.features.length}`);
console.log(`holes dropped (empty) ... ${dropped}  (${coordsDropped.toLocaleString()} coords)`);
console.log(`holes KEPT (enclaves) ... ${kept}  -> ${[...new Set(keptIds)].sort().join(", ")}`);
console.log(`source ${before.toLocaleString()} -> ${after.toLocaleString()} bytes (${((1 - after / before) * 100).toFixed(2)}% smaller)`);
