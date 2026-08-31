import { describe, it, expect } from "vitest";
import { US_ZIP3 } from "../src/geoUsZip3.generated";

// ZIP-3 INTERIOR RINGS. ZCTA3 boundaries follow populated areas, so a region with an
// unpopulated middle (the Big Island's volcanic centre being the obvious one) arrives as a
// polygon with a hole. On a choropleth that hole reads as missing data or a broken render,
// and it is neither — so scripts/dissolveZip3Holes.mjs removes the empty ones.
//
// It does NOT remove all of them, and that distinction is the whole reason this file exists.
// 14 holes contain another ZIP-3: fill one of those and the enclave is painted with its
// neighbour's colour, which is a WRONG VALUE disguised as a styling choice. Nothing about
// that failure is visible in a screenshot — the map looks fine and reports the wrong number.

const ENCLAVE_HOSTS = ["175", "200", "290", "310", "467", "484", "488", "506",
                       "615", "766", "786", "836", "870", "956"];

function rings(f: any): { ext: number[][][]; inner: number[][][] } {
    const g = f?.geometry, co = g?.coordinates ?? [];
    const ext: number[][][] = [], inner: number[][][] = [];
    if (g?.type === "Polygon") { if (co.length) { ext.push(co[0]); inner.push(...co.slice(1)); } }
    else if (g?.type === "MultiPolygon") for (const p of co) if (p?.length) { ext.push(p[0]); inner.push(...p.slice(1)); }
    return { ext, inner };
}
const inside = ([x, y]: number[], ring: number[][]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-15) + xi) hit = !hit;
    }
    return hit;
};
const reps: [string, number[]][] = US_ZIP3.features
    .map((f: any) => {
        const { ext } = rings(f);
        return ext.length ? [f.id, ext.reduce((a, b) => (b.length > a.length ? b : a))[0]] : null;
    })
    .filter(Boolean) as [string, number[]][];

const holesOf = (id: string) => rings(US_ZIP3.features.find((f: any) => f.id === id)).inner;

describe("ZIP-3 interior rings", () => {
    it("keeps a hole for every ZIP-3 that encloses another one", () => {
        for (const id of ENCLAVE_HOSTS) {
            expect(holesOf(id).length, `${id} lost the ring holding its enclave`).toBeGreaterThan(0);
        }
    });

    it("EVERY surviving hole still contains another ZIP-3 — none is merely decorative", () => {
        const orphans: string[] = [];
        for (const f of US_ZIP3.features as any[]) {
            for (const h of rings(f).inner) {
                const holds = reps.some(([id, p]) => id !== f.id && inside(p, h));
                if (!holds) orphans.push(f.id);
            }
        }
        expect(orphans, `these holes are empty and should have been dissolved: ${orphans.join(", ")}`)
            .toEqual([]);
    });

    it("dissolved the empty ones — the asset is not simply untouched", () => {
        // Before the pass: 364 holes across 193 features. If someone regenerates the asset
        // from source and forgets to re-run the script, this catches it.
        const total = (US_ZIP3.features as any[]).reduce((n, f) => n + rings(f).inner.length, 0);
        expect(total).toBe(14);
    });

    it("carries no geometry-less entry — a silent hole in the id space", () => {
        // The source shipped ZIP-3 111 (Long Island City NY) as an empty MultiPolygon. A row
        // binding to it joined an id that EXISTS, so the unmatched counter stayed quiet and
        // the value simply never drew. Removing the shell makes the join report it instead.
        const empty = (US_ZIP3.features as any[]).filter(f => rings(f).ext.length === 0);
        expect(empty.map(f => f.id), "an entry with no drawable geometry loses data silently")
            .toEqual([]);
    });

    it("covers every ZIP-3 in the source shapefile", () => {
        // The national build ran Visvalingam 5% + precision=0.01, and 0.01 degrees is about
        // 1.1 km — so five small urban regions rounded to degenerate rings and were dropped:
        // 111 (Long Island City NY), 202/204/205 (Washington DC federal) and 753 (Dallas TX).
        // Four vanished outright and one survived as an empty shell, which is why only the
        // shell was noticed. All five are recovered from the source at 3 dp.
        expect(US_ZIP3.features.length).toBe(896);
        for (const id of ["111", "202", "204", "205", "753"]) {
            const f = US_ZIP3.features.find((x: any) => x.id === id);
            expect(f, `ZIP-3 ${id} is missing — the simplification pass dropped it again`).toBeTruthy();
            expect(rings(f).ext.length, `${id} has no drawable ring`).toBeGreaterThan(0);
        }
    });

    it("puts the recovered regions where they actually are", () => {
        // A polygon that draws but sits in the wrong place is worse than one that is absent,
        // so the recovered five are checked against their real locations, not merely for
        // existence. Winding matters here too: a ring reversed the wrong way reads as
        // >2*pi steradians to d3.geoPath and floods the whole canvas.
        const centroid = (id: string) => {
            const r = rings(US_ZIP3.features.find((f: any) => f.id === id)).ext[0];
            return [r.reduce((s, c) => s + c[0], 0) / r.length, r.reduce((s, c) => s + c[1], 0) / r.length];
        };
        const near = (id: string, lon: number, lat: number, tol = 0.5) => {
            const [x, y] = centroid(id);
            expect(Math.abs(x - lon), `${id} longitude`).toBeLessThan(tol);
            expect(Math.abs(y - lat), `${id} latitude`).toBeLessThan(tol);
        };
        near("111", -73.92, 40.75);    // Long Island City, western Queens
        near("202", -77.02, 38.88);    // Washington DC
        near("204", -77.05, 38.89);
        near("205", -77.01, 38.87);
        near("753", -96.84, 32.81);    // Dallas
    });

    it("left the exterior boundaries alone", () => {
        for (const f of US_ZIP3.features as any[]) {
            const { ext } = rings(f);
            expect(ext.length, `${f.id} lost its exterior ring`).toBeGreaterThan(0);
            for (const r of ext) {
                expect(r.length).toBeGreaterThanOrEqual(4);
                expect(r[0]).toEqual(r[r.length - 1]);   // closed
            }
        }
    });

    it("the Big Island keeps its outline and loses its crater", () => {
        // The reported example. 967 is Hawaii county; its interior is volcano with no ZCTA.
        const hi = US_ZIP3.features.find((f: any) => f.id === "967");
        expect(hi, "ZIP-3 967 is missing from the asset").toBeTruthy();
        expect(rings(hi).inner.length).toBe(0);
        expect(rings(hi).ext.length).toBeGreaterThan(0);
    });
});
