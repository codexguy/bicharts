import { describe, it, expect, beforeEach } from "vitest";
import { resolveGeoPoint } from "../src/geoPoint";
import { resolvePointRoles } from "../src/geoPointRoles";
import { registerAdmin1Lookup, clearAdmin1LookupForTests, provinceCenter, resolveProvinceValue, type Admin1LookupDoc } from "../src/admin1Lookup";

// The hosted lookup with its province CENTERS: where a bubble map places a row that names a province and no city.
const DOC: Admin1LookupDoc = {
    version: 1,
    cities: [
        "munich|DE|02|1505|48.14|11.58|munchen|DE-BY",
        "zzytown|DE|02|21|49.60|11.00||DE-BY",
        "amritsar|IN|23|1132|31.63|74.87||IN-PB",
        "lahore|PK|04|6310|31.55|74.34||PK-PB",
        "maastricht|NL|05|122|50.85|5.69||NL-LI",
        "hasselt|BE|VLG|77|50.93|5.34||BE-VLI",
        "tbilisi|GE|51|1049|41.69|44.83||GE-TB",
    ].join("\n"),
    admin1: [
        "DE.02|bavaria|bayern", "IN.23|punjab|", "PK.04|punjab|", "NL.05|limburg|", "BE.VLG|limburg|",
        "GE.51|tbilisi|georgia", "US.GA|georgia|",
    ].join("\n"),
    crosswalk: ["DE.02|DE-BY", "IN.23|IN-PB", "PK.04|PK-PB", "NL.05|NL-LI", "BE.VLG|BE-VLI", "GE.51|GE-TB", "US.GA|US-GA"].join("\n"),
    centers: ["DE-BY|11.40|48.60", "IN-PB|75.10|31.00", "PK-PB|73.20|31.20", "NL-LI|5.90|51.20", "BE-VLI|5.40|51.00", "GE-TB|44.80|41.70", "US-GA|-83.60|32.90"].join("\n"),
};

describe("province centers worldwide (hosted lookup)", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); registerAdmin1Lookup(DOC); });

    it("reads the centers and resolves a province by code, GeoNames code or name", () => {
        expect(provinceCenter("de-by")).toEqual([11.4, 48.6]);
        expect(resolveProvinceValue("DE-BY")).toEqual({ status: "resolved", provinceId: "DE-BY" });
        expect(resolveProvinceValue("DE.02")).toEqual({ status: "resolved", provinceId: "DE-BY" });
        expect(resolveProvinceValue("Bayern")).toEqual({ status: "resolved", provinceId: "DE-BY" });
    });

    it("places a row that names a province and no city at the province's center", () => {
        expect(resolveGeoPoint({ state: "Bavaria", mapKind: "world" })).toEqual({ lat: 48.6, lon: 11.4, precision: "state" });
    });

    it("narrows a shared name by the row's country, then by the map's continent, and otherwise refuses it", () => {
        expect(resolveGeoPoint({ state: "Punjab", mapKind: "world" })).toMatchObject({ ambiguous: true, matches: 2 });
        expect(resolveGeoPoint({ state: "Punjab", country: "India", mapKind: "world" })).toMatchObject({ lon: 75.1, precision: "state" });
        expect(resolveGeoPoint({ state: "Georgia", mapKind: "world", region: "asia" })).toMatchObject({ lon: 44.8 });
        // Limburg is in two European countries: the continent cannot decide it.
        expect(resolveGeoPoint({ state: "Limburg", mapKind: "world", region: "europe" })).toMatchObject({ ambiguous: true });
    });

    it("drops a province its row's country contradicts, and keeps North America's map to its own countries", () => {
        expect(resolveGeoPoint({ state: "Bavaria", country: "France", mapKind: "world" })).toMatchObject({ precision: "country" });
        expect(resolveGeoPoint({ state: "Bavaria", mapKind: "north-america" })).toBeNull();
    });

    it("leaves the bundled US / Canada / Mexico states exactly where they were", () => {
        clearAdmin1LookupForTests();
        const before = resolveGeoPoint({ state: "Ontario", mapKind: "world" });
        registerAdmin1Lookup(DOC);
        expect(resolveGeoPoint({ state: "Ontario", mapKind: "world" })).toEqual(before);
    });
});

describe("cities through the hosted lookup", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); registerAdmin1Lookup(DOC); });

    it("places a town the bundled gazetteer does not know, at city precision", () => {
        clearAdmin1LookupForTests();
        expect(resolveGeoPoint({ city: "Zzytown", mapKind: "world" })).toBeNull();
        registerAdmin1Lookup(DOC);
        expect(resolveGeoPoint({ city: "Zzytown", mapKind: "world" })).toEqual({ lat: 49.6, lon: 11, precision: "city" });
    });

    it("falls to the province tier when the row's province contradicts the town's", () => {
        expect(resolveGeoPoint({ city: "Zzytown", state: "Punjab", country: "India", mapKind: "world" })).toMatchObject({ lon: 75.1, precision: "state" });
    });

    it("keeps North America's map to its own countries", () => {
        expect(resolveGeoPoint({ city: "Zzytown", mapKind: "north-america" })).toBeNull();
    });
});

describe("a province column is a state role worldwide, and the traps hold", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); registerAdmin1Lookup(DOC); });
    const rows = (pairs: Array<[string, string]>) => pairs.map(([p, c]) => ({ Province: p, Country: c }));

    it("binds a column of provinces from any country to the state role", () => {
        const r = resolvePointRoles(["Province", "Country"], rows([["Bayern", "Germany"], ["Punjab", "India"], ["Tbilisi", "Georgia"]]), { state: "Province" }, "world");
        expect(r.bind?.state).toBe("Province");
    });

    it("binds a column of ISO 3166-2 codes to the state role", () => {
        const r = resolvePointRoles(["Code"], [{ Code: "DE-BY" }, { Code: "IN-PB" }, { Code: "NL-LI" }], { state: "Code" }, "world");
        expect(r.bind?.state).toBe("Code");
    });

    it("still refuses a country column parked in the state slot (the CA trap)", () => {
        const r = resolvePointRoles(["Province"], rows([["Germany", "Germany"], ["India", "India"], ["France", "France"]]).map(x => ({ Province: x.Province })), { state: "Province" }, "world");
        expect(r.bind?.state).toBeUndefined();
    });
});
