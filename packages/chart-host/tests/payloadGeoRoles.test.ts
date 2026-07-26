// buildRenderPayload treats the caller's point binding as a HINT and resolves the roles
// against the data. These tests sit at the integration seam: shape-core's resolver is
// unit-tested separately, what matters here is that the payload actually GEOCODES from
// the resolved binding and reports what it changed.
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";

const COLS = [
    { name: "City", isMeasure: false },
    { name: "StateCode", isMeasure: false },
    { name: "Country", isMeasure: false },
    { name: "Revenue", isMeasure: true },
];

// Two same-named cities in different states, plus a city that exists in BOTH countries.
const ROWS = [
    { City: "Springfield", StateCode: "IL", Country: "US", Revenue: 48900 },
    { City: "Springfield", StateCode: "MO", Country: "US", Revenue: 54300 },
    { City: "Plano", StateCode: "TX", Country: "US", Revenue: 184200 },
    { City: "Plano", StateCode: "ON", Country: "CA", Revenue: 22100 },
    { City: "Mississauga", StateCode: "ON", Country: "CA", Revenue: 143600 },
];

const latLon = (p: any, i: number) => {
    const la = p.columns.findIndex((c: any) => c.name === "__geoLat__");
    const lo = p.columns.findIndex((c: any) => c.name === "__geoLon__");
    return [p.rows[i][la], p.rows[i][lo]] as [number, number];
};

describe("point role resolution inside buildRenderPayload", () => {
    it("backfills the state the caller omitted and geocodes with it", () => {
        const p = buildRenderPayload(COLS, ROWS, null, { city: "City" });
        expect(p.geoPoint!.rolesBackfilled!.join()).toMatch(/^state=StateCode/);

        // The two Springfields must land on DIFFERENT points; city-only would stack both
        // on the largest namesake and flag them ambiguous.
        const [la0] = latLon(p, 0), [la1] = latLon(p, 1);
        expect(la0).not.toBeCloseTo(la1, 1);
        expect(p.geoPoint!.ambiguousRows).toBe(0);
    });

    it("keeps the Canadian Plano out of Texas", () => {
        const p = buildRenderPayload(COLS, ROWS, null, { city: "City" });
        const [latTX] = latLon(p, 2);
        const [latON] = latLon(p, 3);
        expect(latTX).toBeCloseTo(33.02, 1);   // Plano, Texas
        expect(latON).toBeGreaterThan(42);     // Ontario, ~1200km north
    });

    it("without resolution the same hint would put it in Texas", () => {
        // The regression this exists to prevent: hand it a binding whose state role is
        // already correct and confirm the SAME coordinate is reached, so the assertion
        // above is about the resolver and not about the data being unambiguous anyway.
        const explicit = buildRenderPayload(COLS, ROWS, null, { city: "City", state: "StateCode" });
        const implicit = buildRenderPayload(COLS, ROWS, null, { city: "City" });
        expect(latLon(implicit, 3)).toEqual(latLon(explicit, 3));
        expect(explicit.geoPoint!.rolesBackfilled).toBeUndefined();  // nothing to backfill
    });

    it("refuses a country column named as the state, and reports why", () => {
        const p = buildRenderPayload(COLS, ROWS, null, { city: "City", state: "Country" });
        expect(p.geoPoint!.rolesRefused!.join()).toMatch(/state=Country/);
        // …and having refused it, backfill still finds the real state column.
        expect(p.geoPoint!.rolesBackfilled!.join()).toMatch(/state=StateCode/);
        expect(latLon(p, 3)[0]).toBeGreaterThan(42);
    });

    it("never adopts a measure as the ZIP column", () => {
        // Revenue values are 5-digit numbers — syntactically perfect ZIPs.
        const rows = [
            { City: "Plano", Revenue: 54300 }, { City: "Irvine", Revenue: 48900 },
            { City: "Bellevue", Revenue: 33700 },
        ];
        const cols = [{ name: "City", isMeasure: false }, { name: "Revenue", isMeasure: true }];
        const p = buildRenderPayload(cols, rows, null, { city: "City" });
        expect(p.geoPoint!.rolesBackfilled ?? []).not.toContainEqual(expect.stringMatching(/^zip=/));
    });

    it("omits both role fields entirely when nothing was adjusted", () => {
        const p = buildRenderPayload(COLS, ROWS, null, { city: "City", state: "StateCode" });
        expect(p.geoPoint!.rolesBackfilled).toBeUndefined();
        expect(p.geoPoint!.rolesRefused).toBeUndefined();
    });

    it("recovers a fully-stale binding from an empty object", () => {
        // The visual passes {} (not null) when a persisted binding existed but every
        // column in it went stale — null still means "not a point map".
        const p = buildRenderPayload(COLS, ROWS, null, {});
        expect(p.geoPoint).toBeDefined();
        expect(p.geoPoint!.rolesBackfilled!.join()).toMatch(/city=City/);
        expect(latLon(p, 3)[0]).toBeGreaterThan(42);
    });

    it("does no point work at all for a non-point chart", () => {
        const p = buildRenderPayload(COLS, ROWS, null, null);
        expect(p.geoPoint).toBeUndefined();
        expect(p.columns.some((c: any) => c.name === "__geoLat__")).toBe(false);
    });
});
