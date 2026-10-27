import { describe, it, expect, beforeEach } from "vitest";
import {
    registerAdmin1Lookup, admin1LookupRegistered, clearAdmin1LookupForTests, resolveCityAdmin1, admin1CodesForName,
    countryIso2, CITY_TIE_RATIO, type Admin1LookupDoc,
} from "../src/admin1Lookup";

// A small lookup in the hosted document's own format: the rows are real GeoNames
// values for the cases that matter - two Parises, two Londons a factor of 21 apart, three Springfields close in
// size, a city reached by its alternate name, and a province name two countries share.
const DOC: Admin1LookupDoc = {
    version: 1,
    cities: [
        "london|GB|ENG|8961|51.51|-0.13|londres;londra",
        "paris|FR|11|2138|48.85|2.35|parigi",
        "munich|DE|02|1505|48.14|11.58|munchen;monaco di baviera",
        "london|CA|08|422|42.98|-81.23|",
        "springfield|US|MO|170|37.22|-93.30|",
        "springfield|US|MA|154|42.10|-72.59|",
        "springfield|US|IL|114|39.80|-89.64|",
        "paris|US|TX|24|33.66|-95.56|",
        "tbilisi|GE|51|1049|41.69|44.83|",
    ].join("\n"),
    admin1: [
        "DE.02|bavaria|bayern",
        "FR.11|ile de france|",
        "GB.ENG|england|angleterre",
        "GE.51|tbilisi|",
        "US.GA|georgia|",
        "GE.00|georgia|",
    ].join("\n"),
};

describe("admin-1 lookup", () => {
    beforeEach(() => { clearAdmin1LookupForTests(); });

    it("resolves nothing until a host registers the lookup - the fail-closed state", () => {
        expect(admin1LookupRegistered()).toBe(false);
        expect(resolveCityAdmin1("Paris")).toEqual({ status: "unmatched" });
        expect(admin1CodesForName("Bavaria")).toEqual([]);
    });

    it("registers once per version and counts its rows", () => {
        expect(registerAdmin1Lookup(DOC)).toEqual({ cities: 9, admin1: 6 });
        expect(admin1LookupRegistered()).toBe(true);
        expect(registerAdmin1Lookup(DOC)).toEqual({ cities: 9, admin1: 6 });
        expect(() => registerAdmin1Lookup({} as any)).toThrow();
    });

    it("places a unique city, and narrows a shared name by the row's country in any form", () => {
        registerAdmin1Lookup(DOC);
        expect(resolveCityAdmin1("Munich")).toMatchObject({ status: "resolved", code: "DE.02" });
        expect(resolveCityAdmin1("Paris", { country: "FR" })).toMatchObject({ status: "resolved", code: "FR.11" });
        expect(resolveCityAdmin1("Paris", { country: "United States" })).toMatchObject({ status: "resolved", code: "US.TX" });
        expect(resolveCityAdmin1("Paris", { country: "USA" })).toMatchObject({ status: "resolved", code: "US.TX" });
    });

    it("applies the tie-break: the largest wins only at CITY_TIE_RATIO x the next, otherwise it is ambiguous", () => {
        registerAdmin1Lookup(DOC);
        expect(CITY_TIE_RATIO).toBe(10);
        // London, England (8,961k) is 21x London, Ontario (422k).
        expect(resolveCityAdmin1("London")).toMatchObject({ status: "resolved", code: "GB.ENG" });
        // Paris FR (2,138k) is 89x Paris TX (24k).
        expect(resolveCityAdmin1("Paris")).toMatchObject({ status: "resolved", code: "FR.11" });
        // Three Springfields within a factor of 1.5: never guessed.
        expect(resolveCityAdmin1("Springfield")).toEqual({ status: "ambiguous", candidates: 3 });
    });

    it("narrows by the map's continent when the row names no country", () => {
        registerAdmin1Lookup(DOC);
        expect(resolveCityAdmin1("London", { region: "north-america" })).toMatchObject({ status: "resolved", code: "CA.08" });
        expect(resolveCityAdmin1("Paris", { region: "north-america" })).toMatchObject({ status: "resolved", code: "US.TX" });
        expect(resolveCityAdmin1("Munich", { region: "asia" })).toEqual({ status: "unmatched" });
    });

    it("reads alternate names and folds accents and case, the way the builder keyed them", () => {
        registerAdmin1Lookup(DOC);
        expect(resolveCityAdmin1("München")).toMatchObject({ status: "resolved", code: "DE.02" });
        expect(resolveCityAdmin1("MONACO DI BAVIERA")).toMatchObject({ status: "resolved", code: "DE.02" });
        expect(resolveCityAdmin1("Londres")).toMatchObject({ status: "resolved", code: "GB.ENG" });
    });

    it("names every first-level division a province name can mean, and narrows by country", () => {
        registerAdmin1Lookup(DOC);
        expect(admin1CodesForName("Bayern")).toEqual(["DE.02"]);
        expect(admin1CodesForName("Georgia").sort()).toEqual(["GE.00", "US.GA"]);
        expect(admin1CodesForName("Georgia", "US")).toEqual(["US.GA"]);
    });

    it("reads a country column's value as ISO-2 whatever form it takes", () => {
        expect(countryIso2("France")).toBe("FR");
        expect(countryIso2("DEU")).toBe("DE");
        expect(countryIso2("gb")).toBe("GB");
        expect(countryIso2("Atlantis")).toBeNull();
    });
});

describe("one registry per page", () => {
    it("a lookup registered through one copy of the module is seen by another (chart-host bundles its own copy)", async () => {
        const { vi } = await import("vitest");
        vi.resetModules();
        const a = await import("../src/admin1Lookup");
        vi.resetModules();
        const b = await import("../src/admin1Lookup");
        expect(a).not.toBe(b);
        a.clearAdmin1LookupForTests();
        a.registerAdmin1Lookup({ version: 1, cities: "lyon|FR|84|520|45.75|4.85||FR-ARA", admin1: "FR.84|auvergne rhone alpes|" });
        expect(b.admin1LookupRegistered()).toBe(true);
        expect(b.resolveCityAdmin1("Lyon")).toMatchObject({ status: "resolved", code: "FR.84" });
        b.clearAdmin1LookupForTests();
        expect(a.admin1LookupRegistered()).toBe(false);
    });
});
