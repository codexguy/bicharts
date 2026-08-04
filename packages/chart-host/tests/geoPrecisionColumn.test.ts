import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";

// __geoPrecision__ — the column that lets a MARK disclose its own precision.
//
// The aggregate counts can only ever say "19 of 117 positions approximated": true, and useless
// to the reader hovering one bubble. Inverness is not in the gazetteer, so it lands on the UK's
// anchor — London's coordinates — with a tooltip reading as exact, stacked invisibly under the
// real London row. Same for Tromso on Oslo. Without a per-row tier the chart cannot tell the
// two apart, so it draws both as though they were surveyed.
const COLS = [
    { name: "City", dataType: "String", isMeasure: false },
    { name: "Country", dataType: "String", isMeasure: false },
    { name: "Revenue", dataType: "Double", isMeasure: true },
];
const ROWS = [
    { City: "London", Country: "United Kingdom", Revenue: 912834 },
    { City: "Inverness", Country: "United Kingdom", Revenue: 28633 },   // not in the gazetteer
    { City: "Oslo", Country: "Norway", Revenue: 300000 },
    { City: "Tromso", Country: "Norway", Revenue: 40040 },              // not in the gazetteer
];
const BIND = { city: "City", country: "Country", mapKind: "world" as const };

describe("buildRenderPayload emits __geoPrecision__", () => {
    it("appends it after __geoLat__/__geoLon__ as host metadata", () => {
        const p = buildRenderPayload(COLS, ROWS, null, BIND);
        const names = p.columns.map((c: any) => c.name);
        expect(names.slice(-3)).toEqual(["__geoLat__", "__geoLon__", "__geoPrecision__"]);
        expect(p.columns[names.indexOf("__geoPrecision__")].isMeasure).toBe(false);
    });

    it("distinguishes a real city from one placed at its country's anchor", () => {
        const p = buildRenderPayload(COLS, ROWS, null, BIND);
        const names = p.columns.map((c: any) => c.name);
        const iPrec = names.indexOf("__geoPrecision__");
        const iLat = names.indexOf("__geoLat__");
        const iLon = names.indexOf("__geoLon__");

        expect(p.rows[0][iPrec]).toBe("city");        // London
        expect(p.rows[1][iPrec]).toBe("country");     // Inverness
        expect(p.rows[2][iPrec]).toBe("city");        // Oslo
        expect(p.rows[3][iPrec]).toBe("country");     // Tromso

        // ...and the pairs sit on IDENTICAL coordinates, which is the whole reason the tier
        // has to travel per row: nothing in the geometry reveals the difference.
        expect(p.rows[1][iLat]).toBe(p.rows[0][iLat]);
        expect(p.rows[1][iLon]).toBe(p.rows[0][iLon]);
        expect(p.rows[3][iLat]).toBe(p.rows[2][iLat]);
    });

    it("agrees with the aggregate counts it summarises", () => {
        const p = buildRenderPayload(COLS, ROWS, null, BIND);
        const iPrec = p.columns.map((c: any) => c.name).indexOf("__geoPrecision__");
        const tally: Record<string, number> = {};
        for (const r of p.rows) if (r[iPrec]) tally[r[iPrec] as string] = (tally[r[iPrec] as string] || 0) + 1;
        expect(tally).toEqual({ city: 2, country: 2 });
        expect(p.geoPoint!.precisionCounts.city).toBe(2);
        expect(p.geoPoint!.precisionCounts.country).toBe(2);
    });

    it("is absent for a non-point chart, so ordinary charts pay nothing", () => {
        const p = buildRenderPayload(COLS, ROWS, null, null);
        expect(p.columns.map((c: any) => c.name)).not.toContain("__geoPrecision__");
    });

    it("keeps every row's arity in step with the column list", () => {
        const p = buildRenderPayload(COLS, ROWS, null, BIND);
        for (const r of p.rows) expect(r).toHaveLength(p.columns.length);
    });
});
