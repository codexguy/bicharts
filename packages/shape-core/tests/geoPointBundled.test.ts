// THE GAZETTEER IS BUNDLED, AND THAT IS THE FEATURE (Joel 2026-08-02).
//
// This file replaces geoPointSplit.test.ts, which locked the opposite arrangement for about
// an hour. The story is worth keeping, because the byte count argues for the split every
// time someone re-measures the package:
//
//   The coordinate table is ~93 KB gz. Serving it and bundling only a name index saved
//   118 KB of .pbiviz and passed every test — DETECTION was provably unaffected, so chart
//   offerability never depended on a request. What it DID change was placement in sessions
//   with no network. "Fetch once, then cache" does not fix that: the custom-visual sandbox
//   iframe has no allow-same-origin, so localStorage and IndexedDB throw, leaving only the
//   per-machine HTTP cache — and the case that matters is a report authored online and
//   OPENED somewhere else. A pinned, credential-stripped report handed to someone outside
//   the tenant is precisely that case, and it is a headline feature.
//
//   So the map would still draw, still annotate honestly, and still be coarser than the
//   author ever saw — silently, for the recipient only. That is the failure mode this file
//   exists to keep out.
//
// What it asserts: the city tier works with NOTHING registered, nothing fetched, and no
// host setup step. If a future change makes registration mandatory again, these go red.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, buildGeoPointColumns, isKnownCity, isCityTableLoaded } from "../src/geoPoint";

const place = (args: any) => resolveGeoPoint(args) as any;

describe("no registration, no fetch, no setup — the city tier just works", () => {
    it("is loaded on import", () => {
        // No setupFile, no registerCityTable call anywhere in this file: the table ships
        // inside the module. That IS the air-gap guarantee, stated as an assertion.
        expect(isCityTableLoaded()).toBe(true);
    });

    it("places a city by name at CITY precision", () => {
        const r = place({ city: "Dallas", state: "TX" });
        expect(r.precision).toBe("city");
        expect(r.lon).toBeCloseTo(-96.8, 0);
    });

    it("places a world city by name too", () => {
        const r = place({ city: "Lisbon", mapKind: "world" });
        expect(r.precision).toBe("city");
        expect(r.lon).toBeCloseTo(-9.1, 0);
    });

    it("detection and placement agree, because they read the same table", () => {
        // The split had them reading two artifacts kept in sync by the generator. One table
        // removes that whole class of drift: if isKnownCity says yes, placement can deliver.
        for (const name of ["dallas", "toronto", "monterrey"]) {
            expect(isKnownCity(name), name).toBe(true);
            expect(place({ city: name }).precision, name).toBe("city");
        }
    });

    it("a whole table of place names resolves with no host cooperation", () => {
        const out = buildGeoPointColumns([
            { city: "Dallas", state: "TX" },
            { city: "Toronto", state: "ON" },
            { city: "Monterrey", state: "Nuevo Leon" },
        ]);
        expect(out.precision).toBe("city");
        expect(out.matchedRows).toBe(3);
        expect(out.cityTableMissing).toBeUndefined();
    });
});
