// PROVINCE GEOMETRY. A province map draws one continent's first-level divisions, served beside the admin-1 lookup as
// one file per continent - far too big to bundle (30-330 KB compressed each), so a host fetches the one a chart needs
// and registers it, the way it fetches the lookup. The file is a GeoJSON FeatureCollection: provinces carry their id
// (an ISO 3166-2 code where one exists) and properties.name; national borders are LineString features tagged
// properties.kind "border", drawn over the provinces and never joined.
//
// The same geometry places a coordinate in its province (`provinceLocator`), so a lat/lon table needs no other source.

import { registerGeo, geoFromCache } from "./geoLazy";

/** The continents a province map is drawn for. */
export const PROVINCE_REGIONS = ["europe", "asia", "africa", "south-america", "north-america", "oceania"] as const;
export type ProvinceRegion = typeof PROVINCE_REGIONS[number];

/** Where a continent's provinces are served, relative to the site origin. Versioned in the name, like the lookup. */
export function provinceGeoPath(region: string): string {
    return `/geo/admin1-${String(region).toLowerCase()}.v1.json`;
}

/** The geometry key a province map renders against: pass it as the host's geoKind. */
export function provinceGeoKey(region: string): string {
    return `admin1:${String(region).toLowerCase()}`;
}

/**
 * The geometry key for a generation's geo fields: a province map (grain "admin1") renders against its continent's
 * provinces, every other geo chart against its geoKind as before.
 */
export function geoKeyFor(res: { geoKind?: string | null; geoRegion?: string | null; geoGrain?: string | null }): string | null {
    if (res.geoGrain && res.geoGrain.toLowerCase() === "admin1" && res.geoRegion) return provinceGeoKey(res.geoRegion);
    return res.geoKind ?? null;
}

const inflight = new Map<string, Promise<any | undefined>>();

/**
 * Fetch and register a continent's provinces. Resolves the FeatureCollection once registered (immediately when it
 * already is), undefined on a failed fetch or a body that is not one - and never throws. One fetch per continent is in
 * flight at a time. The file is fetched from `origin` (default: the page's own) at its served path, or from `url`.
 */
export async function loadProvinceGeo(
    region: string,
    opts: { origin?: string; url?: string; fetchJson?: (url: string) => Promise<any>; log?: (tag: string, data?: any) => void } = {},
): Promise<any | undefined> {
    const key = provinceGeoKey(region);
    const cached = geoFromCache(key);
    if (cached) return cached;
    if (!(PROVINCE_REGIONS as readonly string[]).includes(String(region).toLowerCase())) return undefined;
    const url = opts.url ?? (opts.origin ? opts.origin.replace(/\/+$/, "") : "") + provinceGeoPath(region);
    let p = inflight.get(key);
    if (!p) {
        const started = Date.now();
        p = (async () => {
            try {
                const doc = opts.fetchJson ? await opts.fetchJson(url) : await (await fetch(url, { credentials: "omit" })).json();
                if (!doc || doc.type !== "FeatureCollection" || !Array.isArray(doc.features) || doc.features.length === 0)
                    throw new Error("not a FeatureCollection");
                registerGeo(key, doc);
                opts.log?.("province-geo-loaded", { region, ms: Date.now() - started, features: doc.features.length });
                return doc;
            } catch (e) {
                opts.log?.("province-geo-failed", { region, url, error: String(e).slice(0, 200) });
                return undefined;
            } finally {
                inflight.delete(key);
            }
        })();
        inflight.set(key, p);
    }
    return p;
}

/** How far outside every province a point may sit and still be placed in the nearest one, in degrees (about 5 km at
 *  the equator, less toward the poles): simplification moves coastlines, and a harbour city must not fall in the sea. */
export const PROVINCE_SNAP_DEG = 0.05;

type Ring = number[][];
interface Shape { id: string; polys: Ring[][]; box: [number, number, number, number] }

function shapesOf(geo: any): Shape[] {
    const out: Shape[] = [];
    for (const f of (geo?.features ?? []) as any[]) {
        const g = f?.geometry;
        if (!g || f?.properties?.kind === "border" || f.id === null || f.id === undefined) continue;
        const polys: Ring[][] = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
        if (!polys.length) continue;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const poly of polys) for (const [x, y] of poly[0] ?? []) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        out.push({ id: String(f.id), polys, box: [x0, y0, x1, y1] });
    }
    return out;
}

function inRing(x: number, y: number, ring: Ring): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function inShape(x: number, y: number, s: Shape): boolean {
    if (x < s.box[0] || x > s.box[2] || y < s.box[1] || y > s.box[3]) return false;
    // A polygon's first ring is its outline and the rest are holes, so a point in a hole is outside.
    return s.polys.some(poly => poly.length > 0 && inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h)));
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return ex * ex + ey * ey;
}

const locators = new WeakMap<object, (lat: number, lon: number) => string | null>();

/**
 * A function placing a coordinate in its province: the province that contains it, else the nearest one within
 * PROVINCE_SNAP_DEG (east-west distance scaled to the latitude), else null. Border lines are never a province. Built once
 * per geometry object and reused.
 */
export function provinceLocator(geo: any, snapDeg: number = PROVINCE_SNAP_DEG): (lat: number, lon: number) => string | null {
    if (geo && typeof geo === "object" && snapDeg === PROVINCE_SNAP_DEG) {
        const hit = locators.get(geo);
        if (hit) return hit;
    }
    const shapes = shapesOf(geo);
    const locate = (lat: number, lon: number): string | null => {
        if (!isFinite(lat) || !isFinite(lon)) return null;
        // A province that spans the antimeridian is split at it, so a point is tried at its own longitude and wrapped.
        for (const x of [lon, lon + 360, lon - 360]) {
            for (const s of shapes) if (inShape(x, lat, s)) return s.id;
        }
        const k = Math.cos((lat * Math.PI) / 180) || 1e-6;
        let best: string | null = null, bestD = (snapDeg) * (snapDeg);
        for (const s of shapes) {
            if (lon < s.box[0] - snapDeg / k || lon > s.box[2] + snapDeg / k || lat < s.box[1] - snapDeg || lat > s.box[3] + snapDeg) continue;
            for (const poly of s.polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
                const d = segDist2(lon * k, lat, ring[i - 1][0] * k, ring[i - 1][1], ring[i][0] * k, ring[i][1]);
                if (d <= bestD) { bestD = d; best = s.id; }
            }
        }
        return best;
    };
    if (geo && typeof geo === "object" && snapDeg === PROVINCE_SNAP_DEG) locators.set(geo, locate);
    return locate;
}

/** Forget in-flight loads. Tests only. */
export function resetProvinceGeoForTests(): void {
    inflight.clear();
}
