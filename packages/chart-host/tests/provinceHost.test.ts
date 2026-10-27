import { describe, it, expect, beforeEach } from "vitest";
import { prepareProvinceProfile, provinceBinding, geoKeyOfFields } from "../src/provinceHost";
import { resetAdmin1LookupLoaderForTests } from "../src/admin1LookupLoader";
import { clearAdmin1LookupForTests, admin1LookupRegistered, IndexedText } from "@bicharts/shape-core";

const LOOKUP = { version: 1, cities: "munich|DE|02|1505|48.14|11.58|munchen|DE-BY",
                 admin1: "DE.02|bavaria|bayern\nDE.16|berlin|\nDE.05|hesse|hessen", crosswalk: "DE.02|DE-BY\nDE.16|DE-BE\nDE.05|DE-HE" };

function profile(cols: Array<[string, string, boolean?]>, rows: any[][]) {
    const t = new IndexedText();
    t.setColumns(cols.map(([name, dataType, isMeasure]) => ({ name, dataType, isMeasure: !!isMeasure })) as any);
    for (const r of rows) t.addRow(r);
    return t;
}

describe("what every host does for a province map", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); resetAdmin1LookupLoaderForTests(); });

    it("waits for the lookup on a province-named table, then measures it again", async () => {
        const urls: string[] = [];
        const t = profile([["Bundesland", "String"], ["Sales", "Decimal", true]], [["Bayern", 1], ["Berlin", 2], ["Hessen", 3]]);
        await prepareProvinceProfile(t as any, { origin: "https://site.example/", deriveProvinces: true, privacyLevel: "10",
                                                 fetchJson: async (u: string) => { urls.push(u); return LOOKUP; } });
        expect(urls).toEqual(["https://site.example/geo/admin1-lookup.v1.json"]);
        expect(admin1LookupRegistered()).toBe(true);
        expect(t.getColumnsWithStats("10").find(c => c.name === "Bundesland")!.geoKind).toBe("admin1-name");
    });

    it("fetches nothing for a sales Region table, and hands the profile the reader's setting", async () => {
        let fetches = 0;
        const t = profile([["Region", "String"], ["Sales", "Decimal", true]], [["North", 1], ["South", 2], ["East", 3]]);
        await prepareProvinceProfile(t as any, { origin: "https://site.example", deriveProvinces: false, privacyLevel: "10",
                                                 fetchJson: async () => { fetches++; return LOOKUP; } });
        expect(fetches).toBe(0);
        expect((t as any).deriveProvinces).toBe(false);
    });

    it("binds a province map's join, locator and fallback columns, and leaves other geo charts alone", () => {
        const res = { geoColumn: "City", geoKind: "city-name-world", geoRegion: "europe", geoGrain: "admin1" };
        const cols = [{ name: "City", geoKind: "city-name-world" }, { name: "Country", geoKind: "country-name" },
                      { name: "Lat" }, { name: "Long" }, { name: "Sales", isMeasure: true }];
        const b = provinceBinding(res, cols, { deriveProvinces: true, geo: { type: "FeatureCollection", features: [] } })!;
        expect(b).toMatchObject({ column: "City", grain: "admin1", region: "europe", deriveProvinces: true,
                                  fallback: { city: null, country: "Country", lat: "Lat", lon: "Long" } });
        expect(typeof b.join).toBe("function");
        expect(typeof b.locate).toBe("function");
        expect(geoKeyOfFields(res)).toBe("admin1:europe");
        expect(provinceBinding({ geoColumn: "Country", geoKind: "country-name" }, [], { deriveProvinces: true })).toEqual({ column: "Country", kind: "country-name" });
        expect(provinceBinding({ geoKind: "world" }, [], { deriveProvinces: true })).toBeNull();
    });
});

describe("a host with no origin", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); resetAdmin1LookupLoaderForTests(); });
    it("profiles without the lookup instead of throwing", async () => {
        let fetches = 0;
        const t = profile([["Bundesland", "String"], ["Sales", "Decimal", true]], [["Bayern", 1], ["Berlin", 2], ["Hessen", 3]]);
        await prepareProvinceProfile(t as any, { origin: undefined as any, deriveProvinces: true, privacyLevel: "10",
                                                 fetchJson: async () => { fetches++; return LOOKUP; } });
        expect(fetches).toBe(0);
        expect(admin1LookupRegistered()).toBe(false);
    });
});
