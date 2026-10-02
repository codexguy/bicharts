import { describe, it, expect } from "vitest";
import { treatAs, calculateTable, daxLiteral } from "../src/dax";
import { createFilter } from "../src/filterScope";

// A PAGE FILTER INTO DAX, the way Microsoft's data app skills build it (CALCULATETABLE + TREATAS),
// with the escaping done once. One agent-built app spliced a clicked value into a query unescaped.

describe("daxLiteral", () => {
    it("quotes text with embedded quotes doubled, and writes numbers, booleans, dates and blanks", () => {
        expect(daxLiteral("AUS")).toBe("\"AUS\"");
        expect(daxLiteral("Côte d'Ivoire \"CI\"")).toBe("\"Côte d'Ivoire \"\"CI\"\"\"");
        expect(daxLiteral(12.5)).toBe("12.5");
        expect(daxLiteral(true)).toBe("TRUE()");
        expect(daxLiteral(null)).toBe("BLANK()");
        expect(daxLiteral(new Date(2026, 9, 2))).toBe("DATE(2026, 10, 2)");
        expect(() => daxLiteral(NaN)).toThrow();
    });
});

describe("treatAs", () => {
    it("is null with nothing selected, so the query stays unfiltered", () => {
        const f = createFilter("CountryCode");
        expect(treatAs(f, "'DimCountry'[CountryCode]")).toBeNull();
        expect(calculateTable("SUMMARIZECOLUMNS(DimDate[Year])", treatAs(f, "'DimCountry'[CountryCode]")))
            .toBe("SUMMARIZECOLUMNS(DimDate[Year])");
    });

    it("filters a one-column key", () => {
        const f = createFilter("CountryCode");
        f.set(["AUS", "CHL"]);
        expect(treatAs(f, "'DimCountry'[CountryCode]")).toBe("TREATAS({\"AUS\", \"CHL\"}, 'DimCountry'[CountryCode])");
        expect(calculateTable("SUMMARIZECOLUMNS(DimDate[Year])", treatAs(f, "DimCountry[CountryCode]")))
            .toBe("CALCULATETABLE(\nSUMMARIZECOLUMNS(DimDate[Year]),\nTREATAS({\"AUS\", \"CHL\"}, DimCountry[CountryCode])\n)");
    });

    it("filters a route by both ends", () => {
        const f = createFilter(["OriginCountryCode", "DestinationCountryCode"]);
        f.set(["IND", "CHL"]);
        expect(treatAs(f, "Lanes[Origin]", "Lanes[Destination]")).toBe("TREATAS({(\"IND\", \"CHL\")}, Lanes[Origin], Lanes[Destination])");
    });

    it("takes keys directly, and refuses what isn't a column reference", () => {
        expect(treatAs(["USA"], "Geo[Code]")).toBe("TREATAS({\"USA\"}, Geo[Code])");
        expect(() => treatAs(["USA"], "Geo.Code")).toThrow(/column reference/);
        expect(() => treatAs(["USA"])).toThrow();
    });
});
