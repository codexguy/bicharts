import { describe, it, expect } from "vitest";
import { geoContains } from "d3-geo";
import { geoForKind } from "../src/geo";
import { WORLD_110M } from "../src/geo-world";
import { loadGeo, clearGeoCache } from "../src/geoLazy";
import { buildRenderPayload } from "../src/payload";
import { WORLD_110M as RAW } from "../src/geoWorld110m.generated";

// A KOSOVO ROW DRAWS ON KOSOVO. shape-core resolves a row naming Kosovo to its user-assigned code, XKX, where it used to
// resolve to nothing and be counted unmatched ("1 region unmatched"). The world geometry keyed Kosovo's polygon by its
// name, "Kosovo", because Natural Earth gives it no ISO code, so a choropleth joining on XKX would have colored nothing
// there and said nothing either. The polygon is keyed XKX on every route a host takes to the world geometry.

const PRISTINA: [number, number] = [21.17, 42.67];
const COLS = [{ name: "Country", dataType: "String" }, { name: "Revenue", dataType: "Decimal", isMeasure: true }];

describe("a Kosovo row joins Kosovo's polygon on a world choropleth", () => {
    it("the payload keys it XKX and counts it matched", () => {
        const p = buildRenderPayload(COLS, [{ Country: "Serbia", Revenue: 1 }, { Country: "Kosovo", Revenue: 2 }],
            { column: "Country", kind: "country-name" });
        const at = p.columns.findIndex((c: any) => c.name === "__geoIso__");
        expect(p.rows.map(r => r[at])).toEqual(["SRB", "XKX"]);
        expect(p.geoUnmatched?.count).toBe(0);
    });

    it("every route to the world geometry keys Kosovo's polygon XKX", async () => {
        clearGeoCache();
        const routes = { geoForKind: geoForKind("country-name"), geoWorldEntry: WORLD_110M, loadGeo: await loadGeo("country-iso3") };
        for (const [route, g] of Object.entries(routes)) {
            const f = (g.features as any[]).find(x => x.id === "XKX");
            expect(f, route).toBeTruthy();
            expect(geoContains(f, PRISTINA), route).toBe(true);
            expect((g.features as any[]).some(x => x.id === "Kosovo"), route).toBe(false);
        }
    });

    it("and nothing else moved: every other feature keeps its id, in order", () => {
        const before = (RAW.features as any[]).map(f => f.id);
        const after = (WORLD_110M.features as any[]).map(f => f.id);
        expect(after).toEqual(before.map(id => (id === "Kosovo" ? "XKX" : id)));
        expect(after).toContain("N. Cyprus");
        expect(after).toContain("Somaliland");
    });
});
