// THE SWEEP (Joel, 2026-08-02: "scrub the resolver, the classifier - all of it for defects
// like the one you just found").
//
// The defect that prompted it — an unproven country HINT owning the role slot and blocking a
// clean column beside it — was one instance of a shape that recurs across these two modules:
//
//   an unverified input, or a table narrower than the data, silently owns a decision.
//
// Each block below is one place that was true. They are grouped by that shape rather than by
// module, because the module is not what they have in common.
import { describe, it, expect } from "vitest";
import { resolveGeoPoint, cityMatchPct, zipPrefixCandidates } from "../src/geoPoint";
import { resolvePointRoles } from "../src/geoPointRoles";
import { detectGeo, toGeoIso } from "../src/geoDetector";

describe("a table narrower than the data must not answer for it", () => {
    it("a FRENCH postal code does not land in Texas", () => {
        // The ZIP-3 table is USPS-only, and five digits is not a US idea: 75001 is Paris to
        // the user and Dallas to this table. The ZIP tier ran before the country tier and
        // ignored the country entirely, so a world map built from a PostalCode column
        // scattered Europe across the American South — at zip3 precision, which is a MORE
        // confident claim than the country centroid it should have fallen through to.
        expect(zipPrefixCandidates("75001")).toEqual(["750"]);   // it really does hit the table
        const fr = resolveGeoPoint({ zip: "75001", country: "France", mapKind: "world" });
        expect(fr).not.toBeNull();
        expect((fr as any).precision).toBe("country");
        // ...and Paris is nowhere near Dallas, which is the whole point.
        expect((fr as any).lon).toBeGreaterThan(-10);
    });

    it("the same guard for Germany, Spain, Brazil and Japan", () => {
        for (const [zip, country] of [["10115", "Germany"], ["28013", "Spain"],
                                      ["01310", "Brazil"], ["1000001", "Japan"]]) {
            const r = resolveGeoPoint({ zip, country, mapKind: "world" });
            expect(r && (r as any).precision, `${country} ${zip}`).not.toBe("zip3");
        }
    });

    it("US ZIPs are untouched, with or without a country column", () => {
        expect((resolveGeoPoint({ zip: "60614" }) as any).precision).toBe("zip3");
        expect((resolveGeoPoint({ zip: "60614", country: "USA" }) as any).precision).toBe("zip3");
        expect((resolveGeoPoint({ zip: "02108", country: "United States" }) as any).precision).toBe("zip3");
    });

    it("and the US territories keep theirs, because their ZIPs are genuine", () => {
        // 00901 San Juan resolves to PRI, not USA — keying the guard on "USA" alone would
        // have refused a real ZIP.
        expect((resolveGeoPoint({ zip: "00901", country: "Puerto Rico" }) as any).precision).toBe("zip3");
    });
});

describe("one reader per concept, not one per caller", () => {
    it("a country column resolves whatever FORM a stray value arrives in", () => {
        // toGeoIso had three country branches, each accepting exactly one form and nulling the
        // others — while countryIso3, which accepts all of them, was already resolving the SAME
        // values on the point side. us-state-code/us-state-name were deliberately tolerant of
        // each other's forms; countries never were, so a stray "UK" beside ISO-3 codes fell off
        // the choropleth and was counted unmatched.
        expect(toGeoIso("UK", "country-iso3")).toBe("GBR");
        expect(toGeoIso("United Kingdom", "country-iso3")).toBe("GBR");
        expect(toGeoIso("DEU", "country-name")).toBe("DEU");
        expect(toGeoIso("DE", "country-name")).toBe("DEU");
        expect(toGeoIso("FRA", "country-iso2")).toBe("FRA");
        // Still refuses what is not a country at all.
        expect(toGeoIso("Widget", "country-name")).toBeNull();
    });

    it("a MIXED-form country column is detected at all", () => {
        // "USA", "United Kingdom", "FR" is one concept written three ways — an ordinary
        // hand-maintained column. It split across three kinds at a third each, none cleared
        // threshold, and the column detected as NOTHING: no map, no message. The identical bug
        // for us-state-code vs us-state-name was found and fixed; this one sat beside it,
        // because three counters look like three different things.
        const mixed = ["USA", "United Kingdom", "FR", "Germany", "JPN", "IT", "Brazil", "CAN"];
        const r = detectGeo(mixed, "Country");
        expect(r).not.toBeNull();
        expect(r!.geoKind.startsWith("country")).toBe(true);
        expect(r!.geoMatchPct).toBe(100);
        // Every value joins, which is the half toGeoIso now delivers.
        expect(mixed.every(v => toGeoIso(v, r!.geoKind) !== null)).toBe(true);
    });

    it("the union does not fire on a single-form column, so the ISO-2/USPS collision is untouched", () => {
        expect(detectGeo(["CA", "TX", "FL", "NY", "WA", "OR"], "State")!.geoKind).toBe("us-state-code");
        expect(detectGeo(["USA", "CAN", "MEX", "FRA", "DEU"], "Country")!.geoKind).toBe("country-iso3");
    });

    it("a typed placeholder is a blank in BOTH classifiers, not just the one", () => {
        // Joel: "my 97% is for non-blanks... '-' and 'N/A' could be interpreted as blank."
        // That was applied to the point-role classifier and not to detectGeo — the half that
        // decides whether a CHOROPLETH is offered — so the same column scored 100 on one path
        // and under the bar on the other.
        const withHole = ["USA", "CAN", "MEX", "FRA", "DEU", "ITA", "ESP", "JPN",
                          "BRA", "IND", "CHN", "AUS", "NLD", "SWE", "POL", "N/A"];
        const r = detectGeo(withHole, "Country");
        expect(r).not.toBeNull();
        expect(r!.geoMatchPct).toBe(100);
    });

    it("cityMatchPct counts the same way the gate it mirrors does", () => {
        // A standalone measure that disagrees with the gate is worse than no measure.
        expect(cityMatchPct(["Boston", "Denver", "Chicago", "N/A"])).toBe(100);
        expect(cityMatchPct(["Boston", "Denver", "Chicago", "-"])).toBe(100);
        expect(cityMatchPct(["Boston", "Denver", "Chicago", "Nowhereville"])).toBeLessThan(100);
    });
});

describe("a hint is evidence, never a verdict", () => {
    const ROWS = Array.from({ length: 12 }, (_, i) => ({
        StoreNo: String(2101 + i),          // 4-digit codes: a perfect 100% "ZIP" on shape alone
        City: ["Boston", "Denver", "Chicago", "Austin", "Seattle", "Portland",
               "Phoenix", "Atlanta", "Detroit", "Memphis", "Nashville", "Baltimore"][i],
    }));

    it("a column of short numeric codes is not adopted as the ZIP column", () => {
        // ZIP is the one role identified on digit SHAPE rather than a gazetteer, so a store
        // number, a route or a plan code scores 100%. Adopting one placed the whole table on
        // real American centroids and reported "zip3" precision, which is a claim.
        const r = resolvePointRoles(["StoreNo", "City"], ROWS, {});
        expect(r.bind!.zip).toBeUndefined();
        expect(r.bind!.city).toBe("City");
    });

    it("and is refused just as firmly when the hint NAMES it", () => {
        const r = resolvePointRoles(["StoreNo", "City"], ROWS, { zip: "StoreNo" });
        expect(r.bind!.zip).toBeUndefined();
        expect(r.refused.join(" ")).toMatch(/zip=StoreNo/);
    });

    it("but a stripped leading zero beside a real ZIP still counts - that was never the problem", () => {
        const rows = [{ Zip: "2108" }, { Zip: "90210" }, { Zip: "1001" }, { Zip: "60614" }];
        expect(resolvePointRoles(["Zip"], rows, {}).bind!.zip).toBe("Zip");
    });

    it("...as does an all-short column that SAYS it is postal", () => {
        const rows = ["2108", "1001", "1002", "2109"].map(PostalCode => ({ PostalCode }));
        expect(resolvePointRoles(["PostalCode"], rows, {}).bind!.zip).toBe("PostalCode");
    });

    it("lat/lon must actually hold coordinates before the binding is called geocodable", () => {
        // Two column NAMES were enough to declare the map placeable. A wrong pair — or the
        // right pair arriving as text, or as the blank a join left behind — appended a full
        // set of null coordinates and told the chart it had a map. Same empty state as the
        // bug that started this sweep, minus even a refusal line.
        const rows = [{ Lat: "", Lon: "" }, { Lat: null, Lon: null }];
        const r = resolvePointRoles(["Lat", "Lon"], rows as any, { lat: "Lat", lon: "Lon" });
        expect(r.bind).toBeNull();
        expect(r.refused.join(" ")).toMatch(/lat\/lon/);
    });

    it("one usable row is enough - a partly-populated coordinate column is ordinary data", () => {
        const rows = [{ Lat: "", Lon: "" }, { Lat: "42.36", Lon: "-71.06" }];
        expect(resolvePointRoles(["Lat", "Lon"], rows, { lat: "Lat", lon: "Lon" }).bind).not.toBeNull();
    });

    it("out-of-range values are not coordinates", () => {
        const rows = [{ Lat: "1200", Lon: "9900" }];
        expect(resolvePointRoles(["Lat", "Lon"], rows, { lat: "Lat", lon: "Lon" }).bind).toBeNull();
    });

    it("the country role takes the BEST column, not the first one that qualifies", () => {
        // Source order decided it before, which is arbitrary exactly where one column is
        // measurably cleaner than the other.
        const rows = [
            { A: "Widget", B: "USA", C: "FRA" }, { A: "USA", B: "CAN", C: "DEU" },
            { A: "FRA", B: "MEX", C: "ITA" }, { A: "DEU", B: "BRA", C: "ESP" },
        ];
        // A is 75% (below the bar), B and C are both 100% — B comes first and wins the tie.
        expect(resolvePointRoles(["A", "B", "C"], rows, {}, "world").bind!.country).toBe("B");
    });
});
