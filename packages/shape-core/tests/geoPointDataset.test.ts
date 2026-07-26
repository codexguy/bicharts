import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { buildGeoPointColumns, resolveGeoPoint } from "../src/geoPoint";

// Pins the shipped test dataset (testharness/datasets/geo_point_resolution_test.csv)
// to the resolutions it is DOCUMENTED to produce. Two jobs:
//   1. it's the regression guard on the generated tables themselves — regenerating
//      geoPointTables.generated.ts from a newer GeoNames dump must not silently move
//      a city or drop a tier;
//   2. it's the source of the expected-results table handed over for sign-off, so the numbers in
//      the docs are measured, never asserted from memory.
//
// Set DUMP_GEO_POINTS=1 to print the full resolution table.

type Row = Record<string, string>;

function loadCsv(): Row[] {
    // The fixture lives WITH the test. It used to be read out of the visual repo's
    // testharness/, which the package split turned into a dangling path — a test that
    // depends on a sibling repo cannot travel with the package it verifies.
    const path = resolve(__dirname, "fixtures/geo_point_resolution_test.csv");
    const text = readFileSync(path, "utf8").replace(/^﻿/, "");
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    // The file has no embedded commas or quotes by construction; keep the split simple
    // and assert that, so a future edit that adds one fails loudly instead of skewing.
    expect(text.includes('"')).toBe(false);
    const hdr = lines[0].split(",");
    return lines.slice(1).map(l => {
        const c = l.split(",");
        const r: Row = {};
        hdr.forEach((h, i) => { r[h] = (c[i] ?? "").trim(); });
        return r;
    });
}

const rows = loadCsv();
const asArgs = (r: Row) => ({
    lat: r.Latitude || null, lon: r.Longitude || null,
    city: r.City || null, state: r.StateCode || r.StateName || null,
    zip: r.Zip5 || r.Zip3 || null,
});

describe("geo_point_resolution_test.csv — the shipped test dataset", () => {
    it("loads with every column the scenarios need", () => {
        expect(rows.length).toBe(41);
        for (const k of ["Scenario", "City", "StateCode", "StateName", "Country",
                         "Zip5", "Zip3", "Latitude", "Longitude", "Revenue", "Units"])
            expect(Object.keys(rows[0])).toContain(k);
    });

    it("every row resolves to the tier its Scenario claims", () => {
        const expected: Record<string, string | null> = {
            "city unambiguous": "city",
            "ambiguous city + state": "city",
            "ambiguous city NO state": "city",
            "canada city + code": "city",
            "canada city + name": "city",
            "canada diacritics": "city",
            "mexico city + state name": "city",
            "mexico city no state": "city",
            "mexico diacritics": "city",
            "city CONTRADICTS state": "state",   // falls through rather than mis-placing
            "zip5 only": "zip3",
            "zip5 leading zero (kept)": "zip3",
            "zip5 Excel-stripped": "zip3",
            "zip+4": "zip3",
            "zip3 only": "zip3",
            "state code only": "state",
            "state name only": "state",
            "province name only": "state",
            "mexican state only": "state",
            "latlon wins over city": "latlon",
            "latlon only": "latlon",
            "unresolvable city": null,
            "unresolvable everything": null,
            "bad zip": null,
            "lowercase city": "city",
            "padded whitespace": "city",
        };
        const miss: string[] = [];
        for (const r of rows) {
            const want = expected[r.Scenario];
            const got = resolveGeoPoint(asArgs(r));
            const gotP = got ? got.precision : null;
            if (gotP !== want) miss.push(`${r.Scenario} [${r.City}|${r.StateCode}${r.StateName}|${r.Zip5}${r.Zip3}] want=${want} got=${gotP}`);
        }
        expect(miss).toEqual([]);
    });

    it("the ambiguous-no-state rows are FLAGGED, the disambiguated ones are not", () => {
        for (const r of rows.filter(r => r.Scenario === "ambiguous city NO state"))
            expect(resolveGeoPoint(asArgs(r))!.ambiguous).toBe(true);
        for (const r of rows.filter(r => r.Scenario === "ambiguous city + state"))
            expect(resolveGeoPoint(asArgs(r))!.ambiguous).toBeUndefined();
    });

    it("the four Springfields land in four DIFFERENT places", () => {
        const pts = rows.filter(r => r.Scenario === "ambiguous city + state")
            .map(r => { const p = resolveGeoPoint(asArgs(r))!; return `${p.lat},${p.lon}`; });
        expect(new Set(pts).size).toBe(pts.length);
    });

    it("the Excel-stripped ZIP resolves identically to the zero-padded one", () => {
        const kept = rows.find(r => r.Scenario === "zip5 leading zero (kept)")!;
        const stripped = rows.find(r => r.Scenario === "zip5 Excel-stripped")!;
        expect(resolveGeoPoint(asArgs(stripped))).toEqual(resolveGeoPoint(asArgs(kept)));
    });

    it("coordinates beat the city lookup (Miami row carries Seattle coordinates)", () => {
        const r = rows.find(r => r.Scenario === "latlon wins over city")!;
        const p = resolveGeoPoint(asArgs(r))!;
        expect(p.precision).toBe("latlon");
        expect(p.lat).toBeCloseTo(47.61, 2);   // NOT Miami's ~25.8
    });

    it("whole-table build reports the coarsest tier, the unmatched rows, and ambiguity", () => {
        const out = buildGeoPointColumns(rows.map(asArgs));
        expect(out.totalRows).toBe(41);
        expect(out.matchedRows).toBe(38);          // 3 rows resolve to nothing
        expect(out.ambiguousRows).toBe(3);         // the bare Springfield/Burlington/Lakewood
        expect(out.precision).toBe("state");       // the state-only rows are the coarsest
        // Only TWO labels though: the all-blank row has no city/state/zip to name, so it
        // is unmatched but contributes nothing an annotation could usefully print.
        expect(out.unmatched.length).toBe(2);
        expect(out.unmatched).toContain("Nowherecityville");
        expect(out.unmatched).toContain("ABCDE");
    });

    it("dumps the resolution table when DUMP_GEO_POINTS=1", () => {
        if (!process.env.DUMP_GEO_POINTS) return;
        const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
        console.log("\n" + w("Scenario", 26) + w("City", 18) + w("St", 6) + w("Zip", 12)
            + w("precision", 10) + w("lat", 9) + w("lon", 10) + "amb");
        for (const r of rows) {
            const p = resolveGeoPoint(asArgs(r));
            console.log(w(r.Scenario, 26) + w(r.City, 18) + w(r.StateCode || r.StateName, 6)
                + w(r.Zip5 || r.Zip3, 12) + w(p ? p.precision : "(none)", 10)
                + w(p ? p.lat.toFixed(2) : "-", 9) + w(p ? p.lon.toFixed(2) : "-", 10)
                + (p?.ambiguous ? "AMBIGUOUS" : ""));
        }
    });
});
