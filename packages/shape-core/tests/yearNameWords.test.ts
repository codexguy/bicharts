import { describe, it, expect } from "vitest";
import { classifyTemporal, isIdentifierName, nameWords } from "../src";
import { isOrdinalFriendlyName } from "../src/ordinalDetector";

// CAMELCASED YEAR NAMES (2026-09-04). An olympic-medals table bound as Country + OlympicYear +
// a measure or two was refused every chart type that requires a date, with "needs a date or time
// field, and this data has none". OlympicYear is an integer of Olympic years, and the year-NAME
// test was a /\b(year|yr|fy)\b/ against the raw name. `\b` needs a non-word character on one
// side and camelCase has none - so "OlympicYear" was not a year and isTemporal shipped false.
//
// The consecutive-fill fallback could not save it either: the Games are every four years, so
// 2008..2024 is 5 distinct over a span of 17 and the "every integer present" test fails. The
// name was the only path, and it was shut.

const YEARS = { dataType: "Integer", isMeasure: false, distinctCount: 5, minNum: 2008, maxNum: 2024 };

describe("nameWords - one reading of a column name", () => {
    it("splits camelCase, which is what the year-name miss was", () => {
        expect(nameWords("OlympicYear")).toEqual(["olympic", "year"]);
    });

    it("splits the separators too - an underscore is a word character, so `\\b` missed these as well", () => {
        expect(nameWords("fiscal_year")).toEqual(["fiscal", "year"]);
        expect(nameWords("calendar-year")).toEqual(["calendar", "year"]);
        expect(nameWords("dim.date/year")).toEqual(["dim", "date", "year"]);
    });

    it("leaves an already-spaced name alone, and survives an empty one", () => {
        expect(nameWords("Fiscal Year")).toEqual(["fiscal", "year"]);
        expect(nameWords("")).toEqual([]);
    });
});

describe("classifyTemporal - a year-named integer, however the name is cased", () => {
    it("flags OlympicYear - the olympic-medals shape", () => {
        expect(classifyTemporal({ ...YEARS, name: "OlympicYear" })).toBe(true);
    });

    it("flags the separator spellings", () => {
        for (const name of ["fiscal_year", "Calendar-Year", "FiscalYr", "ReportingFY"]) {
            expect(classifyTemporal({ ...YEARS, name }), name).toBe(true);
        }
    });

    it("still flags the plain spellings it always did", () => {
        for (const name of ["Year", "year", "Fiscal Year", "FY", "yr"]) {
            expect(classifyTemporal({ ...YEARS, name }), name).toBe(true);
        }
    });

    // WHOLE WORDS. A naive fix - dropping the `\b` for a substring test - would take every one
    // of these, and they are not year columns.
    it("does not flag a name that merely CONTAINS the letters", () => {
        for (const name of ["Yearbook", "yearning", "Multiyear", "YearlyGrowth", "Fyre"]) {
            expect(classifyTemporal({ ...YEARS, name }), name).toBe(false);
        }
    });

    // Deliberately still out, and the server agrees: no letter-to-digit boundary.
    it("does not flag FY2024 - the two lanes have to keep matching, so neither widens alone", () => {
        expect(classifyTemporal({ ...YEARS, name: "FY2024" })).toBe(false);
    });

    it("keeps the value-range and measure guards", () => {
        expect(classifyTemporal({ ...YEARS, name: "OlympicYear", minNum: 1, maxNum: 5 }),
            "5 seasons is not a calendar window").toBe(false);
        expect(classifyTemporal({ ...YEARS, name: "OlympicYear", isMeasure: true }),
            "a measure is never a time axis").toBe(false);
    });

    it("still flags the fully-consecutive integers that need no name at all", () => {
        expect(classifyTemporal({
            dataType: "Integer", name: "Jahr", isMeasure: false,
            distinctCount: 5, minNum: 2020, maxNum: 2024,
        })).toBe(true);
    });
});

// The tokenizer was four byte-identical copies, now collapsed onto nameWords. These
// two readers must behave exactly as before - the collapse is a de-duplication, not a change.
describe("the other name readers are unchanged by the collapse", () => {
    it("isIdentifierName still reads the LAST token", () => {
        expect(isIdentifierName("LoanID")).toBe(true);
        expect(isIdentifierName("store_code")).toBe(true);
        expect(isIdentifierName("IDVerified")).toBe(false);
        expect(isIdentifierName("Revenue")).toBe(false);
    });

    it("isOrdinalFriendlyName still reads ANY token", () => {
        expect(isOrdinalFriendlyName("SatisfactionRating")).toBe(true);
        expect(isOrdinalFriendlyName("severity_level")).toBe(true);
        expect(isOrdinalFriendlyName("Revenue")).toBe(false);
    });
});
