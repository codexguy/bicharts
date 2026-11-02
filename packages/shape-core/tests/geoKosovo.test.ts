import { describe, it, expect } from "vitest";
import { countryIso3, iso2ToIso3, ISO3_SET, ISO2_TO_ISO3 } from "../src/geoCountryNames";
import { detectGeo, toGeoIso } from "../src/geoDetector";
import { countryRegion } from "../src/geoExtent";
import { resolveGeoPoint } from "../src/geoPoint";

// KOSOVO IS A COUNTRY TO EVERY GEO READER. Its code, XKX (XK in two letters), is a user-assigned one that ISO 3166-1
// leaves for exactly this, and it is what the EU, the IMF and the World Bank write. The country table didn't hold it, so a
// row naming Kosovo resolved to nothing: a world tile grid had no tile to color, a choropleth counted it unmatched, and a
// world bubble map dropped it, each without a word.

describe("Kosovo resolves as a country", () => {
    it("by its codes and by its name, in the reader's language too", () => {
        for (const v of ["XKX", "xkx", " XKX ", "XK", "Kosovo", "kosovo", "KOSOVO", "Republic of Kosovo", "Kosova", "Косово", "Kosowo"])
            expect(countryIso3(v), v).toBe("XKX");
        expect(iso2ToIso3("XK")).toBe("XKX");
    });

    it("as the join key a choropleth or a tile grid draws by", () => {
        expect(toGeoIso("Kosovo", "country-name")).toBe("XKX");
        expect(toGeoIso("XKX", "country-iso3")).toBe("XKX");
        expect(toGeoIso("XK", "country-iso2")).toBe("XKX");
        const r = detectGeo(["SRB", "ALB", "MKD", "MNE", "XKX"]);
        expect(r?.geoKind).toBe("country-iso3");
        expect(r?.geoMatchPct).toBe(100);
        const n = detectGeo(["Serbia", "Albania", "North Macedonia", "Montenegro", "Kosovo"]);
        expect(n?.geoKind).toBe("country-name");
        expect(n?.geoMatchPct).toBe(100);
    });

    it("in Europe, so a map of it frames Europe", () => {
        expect(countryRegion("XKX")).toBe("europe");
        expect(countryRegion("XK")).toBe("europe");
        expect(countryRegion("Kosovo")).toBe("europe");
    });

    it("at a point on a world bubble map: its largest city, Pristina", () => {
        const p = resolveGeoPoint({ country: "Kosovo", mapKind: "world" }) as any;
        expect(p?.precision).toBe("country");
        expect(p.lat).toBeCloseTo(42.67, 1);
        expect(p.lon).toBeCloseTo(21.17, 1);
        expect((resolveGeoPoint({ country: "XKX", mapKind: "world" }) as any)?.precision).toBe("country");
    });

    it("and no other country came or went", () => {
        expect(ISO3_SET.size).toBe(250);
        expect(ISO2_TO_ISO3.size).toBe(250);
        expect(countryIso3("SRB")).toBe("SRB");
        expect(countryIso3("Serbia")).toBe("SRB");
    });
});
