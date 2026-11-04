// A province map bound on a LOCALIZED latitude column still finds its longitude partner, and a province fallback names a
// localized pair - both only as a fallback under a column the server already range-checked, never from one word alone.
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";
import { provinceBinding } from "../src/provinceHost";

const cols = (...names: string[]) => names.map(name => ({ name, isMeasure: true, dataType: "Decimal" }));

// A join that only records what it is handed.
function seen(colNames: string[], latName: string) {
    let rows: any[] = [];
    const join = (r: any[]) => { rows = r; return { iso: r.map(() => null), source: r.map(() => null), unmatched: [], totalRows: r.length,
        matchedRows: 0, ambiguousRows: 0, ambiguousExamples: [], unplacedPoints: 0 } as any; };
    const data = [{ [latName]: -13.5, Sismo: 1 } as any];
    for (const n of colNames) if (!(n in data[0])) data[0][n] = 0;
    const lonName = colNames.find(n => n !== latName && !/magn|sismo/i.test(n))!;
    data[0][lonName] = -72;
    buildRenderPayload(cols(...colNames), data, { column: latName, kind: "latlon", grain: "admin1", join } as any);
    return rows[0];
}

describe("longitude beside a resolved latitude", () => {
    it("reads Spanish `longitud (º)` beside `latitud (º)`", () => {
        const r = seen(["latitud (º)", "longitud (º)", "Magnitud"], "latitud (º)");
        expect(r.lat).toBe(-13.5);
        expect(r.lon).toBe(-72);
    });
    it("reads German `Längengrad` beside `Breitengrad`", () => {
        const r = seen(["Breitengrad", "Längengrad", "Magnitud"], "Breitengrad");
        expect(r.lon).toBe(-72);
    });
    it("still reads an English longitude first", () => {
        const r = seen(["Lat", "Lng", "Longitud"], "Lat");
        expect(r.lon).toBe(-72);
    });
    it("does not take a bare German `Länge`", () => {
        const r = seen(["Breitengrad", "Länge"], "Breitengrad");
        expect(r.lon).toBeUndefined();
    });
});

describe("province fallback columns", () => {
    const res = { geoColumn: "Ort", geoKind: "city-name-world", geoRegion: "europe", geoGrain: "admin1" };
    it("names a localized pair when English finds none", () => {
        const b = provinceBinding(res, [{ name: "Ort", geoKind: "city-name-world" }, { name: "Breitengrad" }, { name: "Längengrad" }],
            { deriveProvinces: true })!;
        expect(b.fallback).toMatchObject({ lat: "Breitengrad", lon: "Längengrad" });
    });
    it("takes a localized axis only as half of a pair", () => {
        const b = provinceBinding(res, [{ name: "Ort", geoKind: "city-name-world" }, { name: "Longitud" }], { deriveProvinces: true })!;
        expect(b.fallback).toMatchObject({ lat: null, lon: null });
    });
    it("keeps the English names", () => {
        const b = provinceBinding(res, [{ name: "Ort", geoKind: "city-name-world" }, { name: "Lat" }, { name: "Long" }], { deriveProvinces: true })!;
        expect(b.fallback).toMatchObject({ lat: "Lat", lon: "Long" });
    });
});
