import { describe, it, expect, beforeEach } from "vitest";
import {
    loadProvinceGeo, provinceGeoPath, provinceGeoKey, geoKeyFor, provinceLocator, PROVINCE_SNAP_DEG, resetProvinceGeoForTests,
} from "../src/provinceGeo";
import { clearGeoCache, geoFromCache, registerGeo } from "../src/geoLazy";
import { buildRenderPayload } from "../src/payload";
import { registerAdmin1Lookup, clearAdmin1LookupForTests, buildProvinceIsoColumn } from "@bicharts/shape-core";
import { readFileSync } from "node:fs";
import { join as pjoin } from "node:path";

const sq = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];

// Two provinces side by side, one with a hole (an enclave), an island province across the antimeridian, and a border line.
const GEO = {
    type: "FeatureCollection",
    features: [
        { type: "Feature", id: "AA-1", properties: { name: "West" }, geometry: { type: "Polygon", coordinates: [sq(0, 0, 10, 10), sq(4, 4, 6, 6)] } },
        { type: "Feature", id: "AA-2", properties: { name: "East" }, geometry: { type: "Polygon", coordinates: [sq(10, 0, 20, 10)] } },
        { type: "Feature", id: "AA-3", properties: { name: "Enclave" }, geometry: { type: "Polygon", coordinates: [sq(4, 4, 6, 6)] } },
        { type: "Feature", id: "FJ-W", properties: { name: "Islands" }, geometry: { type: "MultiPolygon", coordinates: [[sq(178, -19, 180, -16)], [sq(-180, -19, -179, -16)]] } },
        { type: "Feature", id: null, properties: { kind: "border" }, geometry: { type: "LineString", coordinates: [[10, -5], [10, 15]] } },
    ],
};

describe("province locator", () => {
    const at = provinceLocator(GEO);

    it("places a point in the province that contains it, and a hole is not its province", () => {
        expect(at(5, 2)).toBe("AA-1");
        expect(at(5, 15)).toBe("AA-2");
        expect(at(5, 5)).toBe("AA-3");
    });

    it("snaps a point just off the coast into the nearest province, and leaves the open sea unplaced", () => {
        expect(at(5, -PROVINCE_SNAP_DEG / 2)).toBe("AA-1");
        expect(at(5, -1)).toBeNull();
        expect(at(12, 15)).toBeNull();
    });

    it("never treats a border line as a province", () => {
        expect(at(14, 10)).toBeNull();
    });

    it("places an island on either side of the antimeridian", () => {
        expect(at(-17, 179)).toBe("FJ-W");
        expect(at(-17, -179.5)).toBe("FJ-W");
    });

    it("is built once per geometry", () => {
        expect(provinceLocator(GEO)).toBe(at);
    });
});

describe("province geometry loading", () => {
    beforeEach(() => { clearGeoCache(); resetProvinceGeoForTests(); });

    it("serves one versioned file per continent and renders against admin1:<continent>", () => {
        expect(provinceGeoPath("Europe")).toBe("/geo/admin1-europe.v1.json");
        expect(provinceGeoKey("north-america")).toBe("admin1:north-america");
        expect(geoKeyFor({ geoKind: "admin1-name", geoRegion: "europe", geoGrain: "admin1" })).toBe("admin1:europe");
        expect(geoKeyFor({ geoKind: "country-name", geoRegion: "europe" })).toBe("country-name");
    });

    it("fetches once, registers the geometry under its key, and shares an in-flight fetch", async () => {
        let fetches = 0; const urls: string[] = [];
        const fetchJson = (u: string) => new Promise<any>(r => setTimeout(() => { fetches++; urls.push(u); r(GEO); }, 10));
        const [a, b] = await Promise.all([loadProvinceGeo("europe", { fetchJson }), loadProvinceGeo("europe", { fetchJson })]);
        expect(a).toBe(GEO); expect(b).toBe(GEO);
        expect(fetches).toBe(1);
        expect(urls).toEqual(["/geo/admin1-europe.v1.json"]);
        expect(geoFromCache("admin1:europe")).toBe(GEO);
        expect(await loadProvinceGeo("europe", { fetchJson })).toBe(GEO);
        expect(fetches).toBe(1);
    });

    it("fetches from a host's own origin at the served path", async () => {
        const urls: string[] = [];
        await loadProvinceGeo("oceania", { origin: "https://example.test/", fetchJson: async (u: string) => { urls.push(u); return GEO; } });
        expect(urls).toEqual(["https://example.test/geo/admin1-oceania.v1.json"]);
    });

    it("refuses a body that is not geometry, and an unknown continent, without throwing", async () => {
        const logs: string[] = [];
        expect(await loadProvinceGeo("asia", { fetchJson: async () => ({ nope: 1 }), log: t => logs.push(t) })).toBeUndefined();
        expect(logs).toEqual(["province-geo-failed"]);
        expect(await loadProvinceGeo("atlantis", { fetchJson: async () => GEO })).toBeUndefined();
        expect(await loadProvinceGeo("africa", { fetchJson: async () => { throw new Error("offline"); } })).toBeUndefined();
    });
});

describe("the province join in the render payload", () => {
    beforeEach(() => {
        clearGeoCache(); clearAdmin1LookupForTests();
        registerAdmin1Lookup({ version: 1, cities: "westtown|AA|01|500|5|2||AA-1\neastville|AA|02|300|5|15||AA-2",
                               admin1: "AA.01|west|\nAA.02|east|", crosswalk: "AA.01|AA-1\nAA.02|AA-2" });
        registerGeo(provinceGeoKey("europe"), GEO);
    });
    const cols = (...names: string[]) => names.map(name => ({ name }));
    const iso = (p: ReturnType<typeof buildRenderPayload>) => p.rows.map(r => r[p.columns.findIndex(c => c.name === "__geoIso__")]);

    it("joins a province column, and a blank province falls to the city named beside it", () => {
        const p = buildRenderPayload(cols("Province", "City", "Sales"), [
            { Province: "West", City: "Eastville", Sales: 1 }, { Province: "", City: "Eastville", Sales: 2 }, { Province: "Nowhere", City: "Westtown", Sales: 3 },
        ], { column: "Province", kind: "admin1-name", grain: "admin1", region: "europe", fallback: { city: "City" }, join: buildProvinceIsoColumn, locate: provinceLocator(GEO) });
        expect(iso(p)).toEqual(["AA-1", "AA-2", null]);
        expect(p.geoProvince!.sources).toEqual({ province: 1, coordinates: 0, city: 1 });
        expect(p.geoUnmatched).toEqual({ count: 1, examples: ["Nowhere"] });
    });

    it("places a coordinate table through the registered geometry, finding the longitude by name", () => {
        const p = buildRenderPayload(cols("Store", "Lat", "Long", "Sales"), [
            { Store: "a", Lat: 5, Long: 2, Sales: 1 }, { Store: "b", Lat: 5, Long: 15, Sales: 2 }, { Store: "c", Lat: 50, Long: 50, Sales: 3 },
        ], { column: "Lat", kind: "latlon", grain: "admin1", region: "europe", join: buildProvinceIsoColumn, locate: provinceLocator(GEO) });
        expect(iso(p)).toEqual(["AA-1", "AA-2", null]);
        expect(p.geoProvince!.sources.coordinates).toBe(2);
        expect(p.geoProvince!.unplacedPoints).toBe(1);
    });

    it("rolls a city column up to its provinces, and stops deriving when the reader turns it off", () => {
        const rows = [{ City: "Westtown", Sales: 1 }, { City: "Eastville", Sales: 2 }];
        const on = buildRenderPayload(cols("City", "Sales"), rows, { column: "City", kind: "city-name-world", grain: "admin1", region: "europe", join: buildProvinceIsoColumn, locate: provinceLocator(GEO) });
        expect(iso(on)).toEqual(["AA-1", "AA-2"]);
        const off = buildRenderPayload(cols("City", "Sales"), rows, { column: "City", kind: "city-name-world", grain: "admin1", region: "europe", deriveProvinces: false, join: buildProvinceIsoColumn, locate: provinceLocator(GEO) });
        expect(iso(off)).toEqual([null, null]);
    });

    it("leaves a country map's join exactly as it was", () => {
        const p = buildRenderPayload(cols("Country", "Sales"), [{ Country: "France", Sales: 1 }], { column: "Country", kind: "country-name" });
        expect(iso(p)).toEqual(["FRA"]);
        expect(p.geoProvince).toBeUndefined();
    });
});

describe("bubble maps place a province with no city at its center", () => {
    beforeEach(() => {
        clearAdmin1LookupForTests();
        registerAdmin1Lookup({ version: 1, cities: "", admin1: "IN.23|punjab|\nPK.04|punjab|\nGE.51|tbilisi|georgia",
                               crosswalk: "IN.23|IN-PB\nPK.04|PK-PB\nGE.51|GE-TB", centers: "IN-PB|75.10|31.00\nPK-PB|73.20|31.20\nGE-TB|44.80|41.70" });
    });
    const lonOf = (p: ReturnType<typeof buildRenderPayload>) => p.rows.map(r => r[p.columns.findIndex(c => c.name === "__geoLon__")]);

    it("places by the province, narrowing a shared name by the row's country", () => {
        const p = buildRenderPayload([{ name: "Province" }, { name: "Country" }, { name: "Sales" }],
            [{ Province: "Punjab", Country: "India", Sales: 1 }, { Province: "Punjab", Country: "Pakistan", Sales: 2 }],
            null, { state: "Province", country: "Country", mapKind: "world" });
        expect(lonOf(p)).toEqual([75.1, 73.2]);
    });

    it("narrows by the map's continent when the row has no country", () => {
        const p = buildRenderPayload([{ name: "Province" }, { name: "Sales" }], [{ Province: "Georgia", Sales: 1 }, { Province: "Tbilisi", Sales: 1 }],
            null, { state: "Province", mapKind: "world", region: "asia" });
        expect(lonOf(p)).toEqual([44.8, 44.8]);
    });
});

describe("the provinces entry", () => {
    it("is its own entry: package.json exports ./provinces and build.mjs builds it", () => {
        const pkg = JSON.parse(readFileSync(pjoin(__dirname, "..", "package.json"), "utf8"));
        expect(pkg.exports["./provinces"]).toEqual({ types: "./dist/types/provinces.d.ts", import: "./dist/provinces.mjs", default: "./dist/provinces.mjs" });
        expect(readFileSync(pjoin(__dirname, "..", "build.mjs"), "utf8")).toMatch(/provinces:\s*join\(here,\s*"src\/provinces\.ts"\)/);
    });

    it("carries the province API, and the main entry does not", async () => {
        const entry = await import("../src/provinces");
        for (const k of ["loadProvinceGeo", "geoKeyFor", "provinceLocator", "loadAdmin1Lookup", "needsAdmin1Lookup"]) expect(typeof (entry as any)[k], k).not.toBe("undefined");
        const main = readFileSync(pjoin(__dirname, "..", "src", "index.ts"), "utf8");
        expect(main).not.toMatch(/from "\.\/provinceGeo"|from "\.\/admin1LookupLoader"/);
    });

    it("builds no join column for a province binding without a join", () => {
        const p = buildRenderPayload([{ name: "Province" }], [{ Province: "West" }], { column: "Province", kind: "admin1-name", grain: "admin1", region: "europe" });
        expect(p.columns.some(c => c.name === "__geoIso__")).toBe(false);
    });
});
