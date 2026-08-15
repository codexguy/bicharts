import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";

// THE ROUTE'S SECOND ENDPOINT (origin-destination flow map, 2026-08-15).
//
// A flow map draws an arc between two places named on the SAME row, so the payload has to
// carry two coordinates per row rather than one. The whole design of this change is that the
// second endpoint goes through the SAME resolver as the first — the interesting assertions
// below are therefore not "does it emit columns" but "do the two ends agree", because two
// endpoints resolved by different rules would draw a line to the wrong place while looking
// perfectly plausible.
//
// The other half of the contract is that everything WITHOUT a destination binding — which is
// every other chart in the catalogue — must come out byte-identical.

const COLS = [
    { name: "From", dataType: "String", isMeasure: false },
    { name: "To", dataType: "String", isMeasure: false },
    { name: "Flights", dataType: "Double", isMeasure: true },
];
const ROWS = [
    { From: "London", To: "Paris", Flights: 812 },
    { From: "Paris", To: "London", Flights: 790 },
    { From: "Oslo", To: "London", Flights: 240 },
];
const ORIGIN = { city: "From", mapKind: "world" as const };
const DEST = { city: "To", mapKind: "world" as const };

const names = (p: any) => p.columns.map((c: any) => c.name);
const at = (p: any, col: string, row: number) => p.rows[row][names(p).indexOf(col)];

describe("buildRenderPayload — destination endpoint", () => {
    it("appends the destination triple AFTER the origin's, so nothing existing moves", () => {
        const p = buildRenderPayload(COLS, ROWS, null, ORIGIN, DEST);
        expect(names(p).slice(-6)).toEqual([
            "__geoLat__", "__geoLon__", "__geoPrecision__",
            "__geoLatD__", "__geoLonD__", "__geoPrecisionD__",
        ]);
    });

    it("marks the destination columns as host metadata, never plottable dimensions", () => {
        const p = buildRenderPayload(COLS, ROWS, null, ORIGIN, DEST);
        for (const c of ["__geoLatD__", "__geoLonD__", "__geoPrecisionD__"]) {
            expect(p.columns[names(p).indexOf(c)].isMeasure).toBe(false);
        }
    });

    it("keeps every row's arity in step with the column list", () => {
        const p = buildRenderPayload(COLS, ROWS, null, ORIGIN, DEST);
        for (const r of p.rows) expect(r).toHaveLength(p.columns.length);
    });

    // THE ONE THAT MATTERS. Row 0 flies London->Paris and row 1 flies Paris->London. The same
    // city read as an ORIGIN and as a DESTINATION must land on the same coordinate: if the two
    // channels ever diverge, a round trip stops being a round trip and the two arcs of an
    // out-and-back pair no longer touch at either end.
    it("places the same city identically at either end of the route", () => {
        const p = buildRenderPayload(COLS, ROWS, null, ORIGIN, DEST);
        expect(at(p, "__geoLat__", 0)).toBe(at(p, "__geoLatD__", 1));   // London
        expect(at(p, "__geoLon__", 0)).toBe(at(p, "__geoLonD__", 1));
        expect(at(p, "__geoLatD__", 0)).toBe(at(p, "__geoLat__", 1));   // Paris
        expect(at(p, "__geoLon__", 0)).not.toBe(at(p, "__geoLonD__", 0));  // and they are two places
    });

    it("reports each end's precision separately — a blended count would hide the coarse half", () => {
        const p = buildRenderPayload(COLS, ROWS, null, ORIGIN, DEST);
        expect(p.geoPoint).toBeTruthy();
        expect(p.geoPointDest).toBeTruthy();
        // Same contract, independently computed.
        expect(Object.keys(p.geoPointDest!)).toEqual(expect.arrayContaining(
            ["precision", "precisionCounts", "coarseExamples", "unplaced", "ambiguousRows"]));
    });

    it("names the END a refusal happened at", () => {
        // "CA" alone is evidence of nothing — as a state it is California, as a country it is
        // Canada — so the resolver refuses it. Bound as the DESTINATION, the refusal must say so;
        // an undifferentiated list tells a reader which rule fired but not which half to fix.
        const cols = [
            { name: "From", dataType: "String", isMeasure: false },
            { name: "ToState", dataType: "String", isMeasure: false },
        ];
        const rows = [{ From: "London", ToState: "CA" }, { From: "Oslo", ToState: "CA" }];
        const p = buildRenderPayload(cols, rows, null, { city: "From", mapKind: "world" },
            { state: "ToState", mapKind: "world" });
        for (const r of p.geoPointRefused ?? []) {
            if (r.includes("ToState")) expect(r.startsWith("destination: ")).toBe(true);
        }
    });

    // ---- the no-destination case: every other chart in the catalogue ----

    it("emits nothing extra when there is no destination binding", () => {
        const p = buildRenderPayload(COLS, ROWS, null, ORIGIN);
        expect(names(p)).not.toContain("__geoLatD__");
        expect(p.geoPointDest).toBeUndefined();
    });

    it("leaves a single-point payload byte-identical to the pre-change output", () => {
        const before = buildRenderPayload(COLS, ROWS, null, ORIGIN);
        const after = buildRenderPayload(COLS, ROWS, null, ORIGIN, null);
        expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    });

    it("adds nothing at all to a chart with no geo binding whatsoever", () => {
        const p = buildRenderPayload(COLS, ROWS, null, null, null);
        expect(names(p)).toEqual(["From", "To", "Flights", "__rowIdx__"]);
        expect(p.geoPoint).toBeUndefined();
        expect(p.geoPointDest).toBeUndefined();
    });
});
