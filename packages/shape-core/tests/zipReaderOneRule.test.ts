// 02108 IS 02108 HOWEVER IT ARRIVES.
//
// 2026-08-02: "the matcher to the gazette needs to do proper zip matching: it should
// work for 02108 no matter how the source is interpreted (e.g. integer 2108)."
//
// A ZIP reaches us in whatever shape the pipeline left it, and none of these are exotic:
// Power BI and Excel coerce a ZIP column to a NUMBER and the leading zero is gone, taking
// the whole New England / New Jersey / Puerto Rico 0xxxx block with it (seen in prod
// 2026-07-23); a CSV export or a DAX FORMAT can round-trip it through a float; a
// hand-maintained sheet carries whitespace.
//
// The second half of this file is the part that actually bit: the POINT cascade and the
// CHOROPLETH join key are two different matchers over the same column, and they had drifted.
// Both now read through normalizeZip5, so a value cannot resolve on one map and come back
// unmatched on the other.
import { describe, it, expect } from "vitest";
import { normalizeZip5, zipPrefixCandidates } from "../src/geoPoint";
import { toGeoIso } from "../src/geoDetector";

describe("every shape a ZIP arrives in", () => {
    const cases: Array<[unknown, string, string]> = [
        ["02108", "02108", "the honest case"],
        [2108, "02108", "integer coercion ate the leading zero"],
        ["2108", "02108", "same, as text"],
        [501, "00501", "Holtsville NY, the lowest ZIP there is - two zeros eaten"],
        ["02108-1234", "02108", "ZIP+4; the +4 is routing detail, not a place"],
        ["60614.0", "60614", "round trip through a float"],
        [60614.0, "60614", "the same, arriving as a number"],
        ["  02108  ", "02108", "whitespace from a hand-maintained sheet"],
        ["90210", "90210", "a ZIP with no leading zero is untouched"],
    ];

    it.each(cases)("%s -> %s (%s)", (input, expected) => {
        expect(normalizeZip5(input as any)).toBe(expected);
    });

    it("refuses what is not a ZIP", () => {
        for (const junk of ["", "   ", null, undefined, "abcde", "123456", "12", "Chicago", "N/A"]) {
            expect(normalizeZip5(junk as any), String(junk)).toBeNull();
        }
    });
});

describe("the two matchers agree", () => {
    // If these ever diverge again, the symptom is a column that plots on a point map and
    // goes unmatched on a choropleth - or the reverse - with nothing to explain why.
    const shapes: unknown[] = ["02108", 2108, "2108", "02108-1234", "60614.0", "  90210 "];

    it.each(shapes)("%s reads the same in the choropleth join key as in the point reader", (v) => {
        expect(toGeoIso(String(v), "us-zip5")).toBe(normalizeZip5(v as any));
    });

    it("the point cascade derives its ZIP-3 prefix from the same reading", () => {
        expect(zipPrefixCandidates(2108)).toEqual(["021"]);
        expect(zipPrefixCandidates("02108")).toEqual(["021"]);
        expect(zipPrefixCandidates("60614.0")).toEqual(["606"]);
        // 501 is only THREE digits, so it lands in the ambiguous branch below rather than
        // resolving straight to Holtsville's 005 — both readings, literal first, and the
        // caller keeps whichever the ZIP-3 table actually holds. normalizeZip5 is the one
        // that commits to 00501, because a join key has to be a single answer.
        expect(normalizeZip5(501)).toBe("00501");
        expect(zipPrefixCandidates(501)).toEqual(["501", "005"]);
    });

    it("a BARE 3-digit value keeps both readings, most literal first", () => {
        // The one genuinely ambiguous shape: "021" is either the ZIP-3 prefix itself or
        // 00021 with two zeros eaten. Offer both and let the table decide.
        expect(zipPrefixCandidates("021")).toEqual(["021", "000"]);
        // ...and when the two readings coincide there is only one candidate.
        expect(zipPrefixCandidates("000")).toEqual(["000"]);
    });
});
