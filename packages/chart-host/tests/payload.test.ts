import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";
import { buildGeoIsoColumn } from "../../shape-core/src/geoDetector";

// BYTE-COMPARE lock (Phase B remainder): buildRenderPayload must reproduce EXACTLY
// the visual's original buildD3DataPayload loop,
// which is copied below VERBATIM as the oracle. Any divergence in the wire shape —
// column order, Date→ISO, null coalescing, the trailing __rowIdx__/__geoIso__ cells,
// the geoUnmatched counts — fails here before it can reach the data wire.

// ---- ORACLE: the original visual loop, verbatim (ctx bits parameterized) ----
function oracle(cols: any[], rows: any[], geoColumn?: string, geoKind?: string) {
    const colNames = cols.map(c => c.name);
    let geoIso: (string | null)[] | null = null;
    let geoUnmatched: any = null;
    if (geoColumn && geoKind) {
        const built = buildGeoIsoColumn(rows.map(r => (r as any)[geoColumn]), geoKind as any);
        geoIso = built.iso;
        geoUnmatched = { count: built.totalRows - built.matchedRows, examples: built.unmatched.slice(0, 8) };
    }
    const extra = geoIso ? 2 : 1;
    const out: any[][] = new Array(rows.length);
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const a = new Array(cols.length + extra);
        for (let c = 0; c < cols.length; c++) {
            const v = (row as any)[colNames[c]];
            if (v instanceof Date) {
                a[c] = v.toISOString();
            } else {
                a[c] = v ?? null;
            }
        }
        a[cols.length] = r;
        if (geoIso) a[cols.length + 1] = geoIso[r];
        out[r] = a;
    }
    const colsOut = [...cols, { name: "__rowIdx__", dataType: "Integer", isMeasure: false, modelDesc: "" }];
    if (geoIso) colsOut.push({ name: "__geoIso__", dataType: "String", isMeasure: false, modelDesc: "" });
    return { columns: colsOut as any[], rows: out, geoUnmatched };
}

const COLS = [
    { name: "Country", dataType: "String", isMeasure: false, modelDesc: "" },
    { name: "When", dataType: "DateTime", isMeasure: false, modelDesc: "" },
    { name: "Revenue", dataType: "Decimal", isMeasure: true, modelDesc: "" },
];
// Edge mix: Date object, null, undefined, 0, "", alias country, unmatched country.
const ROWS = [
    { Country: "USA", When: new Date(Date.UTC(2024, 0, 15)), Revenue: 100 },
    { Country: "Britain", When: null, Revenue: 0 },
    { Country: "Atlantis", When: undefined, Revenue: null },
    { Country: "Wakanda", When: new Date(Date.UTC(2023, 11, 31, 23, 59, 59)), Revenue: "" },
    { Country: "Canada", When: undefined, Revenue: undefined },
];

describe("buildRenderPayload — byte-compare vs the visual's original loop", () => {
    it("non-geo payload is JSON-identical to the oracle", () => {
        const got = buildRenderPayload(COLS, ROWS);
        const exp = oracle(COLS, ROWS);
        expect(JSON.stringify({ columns: got.columns, rows: got.rows }))
            .toBe(JSON.stringify({ columns: exp.columns, rows: exp.rows }));
        expect(got.geoUnmatched).toBeUndefined();
    });

    it("geo payload (join column + unmatched) is JSON-identical to the oracle", () => {
        const got = buildRenderPayload(COLS, ROWS, { column: "Country", kind: "country-name" });
        const exp = oracle(COLS, ROWS, "Country", "country-name");
        expect(JSON.stringify({ columns: got.columns, rows: got.rows }))
            .toBe(JSON.stringify({ columns: exp.columns, rows: exp.rows }));
        expect(JSON.stringify(got.geoUnmatched)).toBe(JSON.stringify(exp.geoUnmatched));
        // Spot semantics: aliases resolved, unmatched null, trailing cells ordered rowIdx-then-iso.
        const isoIdx = got.columns.length - 1;
        expect(got.rows[0][isoIdx]).toBe("USA");
        expect(got.rows[1][isoIdx]).toBe("GBR");
        expect(got.rows[2][isoIdx]).toBeNull();
        expect(got.rows[0][isoIdx - 1]).toBe(0);   // __rowIdx__
        // Date→ISO, null/undefined→null, 0/"" preserved.
        expect(got.rows[0][1]).toBe("2024-01-15T00:00:00.000Z");
        expect(got.rows[1][1]).toBeNull();
        expect(got.rows[1][2]).toBe(0);
        expect(got.rows[3][2]).toBe("");
    });

    it("examples cap at 8 distinct; geoUnmatchedDistinct carries the uncapped count", () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ Country: `Nowhere${i}`, When: null, Revenue: i }));
        const got = buildRenderPayload(COLS, many, { column: "Country", kind: "country-name" });
        expect(got.geoUnmatched!.count).toBe(12);
        expect(got.geoUnmatched!.examples.length).toBe(8);
        expect(got.geoUnmatchedDistinct).toBe(12);
    });

    it("empty geo binding fields behave as no binding", () => {
        const got = buildRenderPayload(COLS, ROWS, { column: "", kind: "country-name" });
        expect(got.columns.some(c => c.name === "__geoIso__")).toBe(false);
        expect(got.geoUnmatched).toBeUndefined();
    });
});
