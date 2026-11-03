// A TERRITORY WITH ITS OWN ISO CODE GETS ITS OWN POLYGON (geoWorld110m.ts).
//
// Natural Earth folds French Guiana into France and Svalbard into Norway. Folded, a row keyed France painted South
// America in France's color and a row keyed French Guiana matched nothing. The specific cases are pinned here, and the
// CLASS is guarded: no outlying part of any feature may contain the label point of a different ISO code, so a rebuilt
// asset that folds in another coded territory fails here instead of on a reader's map.
import { describe, it, expect } from "vitest";
import { WORLD_110M } from "../src/geoWorld110m";
import { COUNTRY_PACKED } from "../../shape-core/src/geoPointTables.generated";

const feature = (id: string) => (WORLD_110M.features as any[]).find(f => f.id === id && f.geometry.type !== "Point");
const parts = (f: any): number[][][][] => f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
const coords = (f: any) => parts(f).flatMap(p => p[0]);

function inRing([x, y]: number[], ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

describe("territories with their own code are their own polygons", () => {
    it("French Guiana is GUF, and France no longer reaches South America", () => {
        const guf = feature("GUF");
        expect(guf).toBeTruthy();
        expect(guf.properties.name).toBe("French Guiana");
        expect(coords(guf).every(([x, y]) => x > -56 && x < -50 && y > 1 && y < 7)).toBe(true);
        expect(coords(feature("FRA")).every(([x]) => x > -10)).toBe(true);
    });

    it("Corsica has no code of its own and stays France", () => {
        expect(parts(feature("FRA")).some(p => p[0].every(([x]) => x > 8))).toBe(true);
    });

    it("Svalbard is SJM, and Norway stops at the mainland", () => {
        const sjm = feature("SJM");
        expect(sjm).toBeTruthy();
        expect(parts(sjm).length).toBe(3);
        expect(coords(feature("NOR")).every(([, y]) => y < 72)).toBe(true);
    });

    it("every code keys at most one polygon", () => {
        const ids = (WORLD_110M.features as any[]).filter(f => f.geometry.type !== "Point").map(f => f.id);
        expect(ids.length).toBe(new Set(ids).size);
    });

    it("no outlying part of a feature holds another code's label point (the class guard)", () => {
        // A code the asset already draws as a centroid point (Singapore, inside peninsular Malaysia's 110m outline) is
        // sub-pixel by design and painted on top; only a code with no mark of its own is folded.
        const centroids = new Set((WORLD_110M.features as any[]).filter(f => f.geometry.type === "Point").map(f => f.id));
        const labels = COUNTRY_PACKED.split(",").map(s => s.split("|")).map(([id, x, y]) => ({ id, at: [+x, +y] }))
            .filter(l => !centroids.has(l.id));
        const folded: string[] = [];
        for (const f of WORLD_110M.features as any[]) {
            if (f.geometry.type !== "MultiPolygon") continue;
            const ps = parts(f);
            const main = ps.reduce((a, b) => (b[0].length > a[0].length ? b : a));
            for (const p of ps) {
                if (p === main) continue;
                for (const l of labels) if (l.id !== f.id && inRing(l.at, p[0])) folded.push(`${l.id} inside ${f.id}`);
            }
        }
        expect(folded).toEqual([]);
    });
});
