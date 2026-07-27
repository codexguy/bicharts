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

    it("left the exterior boundaries alone", () => {
        // The clean must not touch outlines: 892 source features minus the one empty shell.
        expect(US_ZIP3.features.length).toBe(891);
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
        // Joel's example. 967 is Hawaii county; its interior is volcano with no ZCTA.
        const hi = US_ZIP3.features.find((f: any) => f.id === "967");
        expect(hi, "ZIP-3 967 is missing from the asset").toBeTruthy();
        expect(rings(hi).inner.length).toBe(0);
        expect(rings(hi).ext.length).toBeGreaterThan(0);
    });
});
