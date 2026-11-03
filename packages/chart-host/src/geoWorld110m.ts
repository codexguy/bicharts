// THE WORLD GEOMETRY, AS EVERY ROUTE SERVES IT: the generated asset with its join keys made whole.
//
// Natural Earth keys three features by name because it gives them no ISO code: "Kosovo", "N. Cyprus" and "Somaliland".
// Kosovo has a code a row can carry, the user-assigned XKX (the one the EU, the IMF and the World Bank use), and
// shape-core resolves a row naming Kosovo to it. A polygon still keyed "Kosovo" would then take no row: a choropleth
// would count the row matched and color nothing, where it used to say the region was unmatched. So its feature is keyed
// XKX here. The other two have no code a row could carry and keep their names. A new collection, the generated one
// untouched, so a rebuilt asset that already carries XKX passes through unchanged.
//
// A TERRITORY WITH ITS OWN ISO CODE GETS ITS OWN POLYGON. Natural Earth's admin-0 countries draw a sovereign state with
// everything it governs, so France's feature carries French Guiana and Norway's carries Svalbard. Both have ISO 3166-1
// codes of their own (GUF, SJM) that a row can carry and shape-core resolves. Folded in, a row keyed France painted a
// patch of South America in France's color, under a tooltip reading "France", and a row keyed French Guiana matched no
// polygon at all. So each such part leaves its sovereign's feature and becomes a feature keyed by its own code. The
// code is the discriminator, not the politics: Corsica has no code and stays France. A part moves only when its whole
// outer ring lies inside the territory's window, and only while the asset has no polygon of that code already, so a
// rebuilt asset that splits them itself passes through unchanged.
import { WORLD_110M as GENERATED } from "./geoWorld110m.generated";

const JOIN_KEY_FOR_NAME: Readonly<Record<string, string>> = { Kosovo: "XKX" };

/** [minLon, minLat, maxLon, maxLat], in degrees: wide enough for the territory, clear of its sovereign's other parts. */
type Window = readonly [number, number, number, number];

export const TERRITORY_PARTS: ReadonlyArray<{ from: string; to: string; name: string; window: Window }> = [
    { from: "FRA", to: "GUF", name: "French Guiana", window: [-56, 1, -50, 7] },
    { from: "NOR", to: "SJM", name: "Svalbard and Jan Mayen", window: [-10, 74, 40, 82] },
];

const ringInside = (ring: number[][], [x0, y0, x1, y1]: Window) =>
    ring.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

const isPolygonal = (f: any) => f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon";

function splitTerritories(features: any[]): any[] {
    const hasPolygon = new Set(features.filter(isPolygonal).map(f => f.id));
    const out: any[] = [];
    for (const f of features) {
        const rules = f?.geometry?.type === "MultiPolygon"
            ? TERRITORY_PARTS.filter(r => r.from === f.id && !hasPolygon.has(r.to))
            : [];
        if (!rules.length) { out.push(f); continue; }
        let kept: number[][][][] = f.geometry.coordinates;
        const split: any[] = [];
        for (const r of rules) {
            const moved = kept.filter(p => ringInside(p[0], r.window));
            if (!moved.length || moved.length === kept.length) continue;    // never empty the sovereign
            kept = kept.filter(p => !moved.includes(p));
            split.push({
                type: "Feature", id: r.to, properties: { ...f.properties, name: r.name },
                geometry: moved.length === 1 ? { type: "Polygon", coordinates: moved[0] } : { type: "MultiPolygon", coordinates: moved },
            });
        }
        out.push(split.length ? { ...f, geometry: { ...f.geometry, coordinates: kept } } : f, ...split);
    }
    return out;
}

export const WORLD_110M: any = {
    ...GENERATED,
    features: splitTerritories((GENERATED.features as any[]).map(f => {
        const to = JOIN_KEY_FOR_NAME[f?.id];
        return to ? { ...f, id: to } : f;
    })),
};
