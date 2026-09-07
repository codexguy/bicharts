// A ZIP THAT PARSES IS NOT A ZIP WE CAN DRAW.
//
// A US ZIP used to be counted, and joined, on its FORMAT alone. So a five-digit string with no
// polygon behind it was reported as a match - and geoMatchPct is not decoration: the server
// refuses a choropleth whose column falls under LLMGeoMinMatchPct (85 on dev and prod), and the
// picker scales geo affinity by it. A column of unmappable ZIPs therefore cleared every geo gate
// on its way to a map that could not draw a single one of them, and the choropleth gate's own
// stated reason for existing is that "an unmatched region leaves a HOLE in the map".
//
// The bundled ZIP-3 basemap carries 896 of the 1000 prefixes the format allows. The missing 104
// are not an oversight - they are the prefixes USPS never assigned to a geographic area, plus the
// military APO/FPO ranges (090-099, 340, 962-966), which are REAL, deliverable ZIPs with no place
// on a map of the United States. That is the gap this file is about.
//
// THE DISTINCTION THAT MAKES THIS SAFE, and the first version of the change got it wrong:
//   toGeoIso            NORMALIZES. "00501" is Holtsville NY, the IRS ZIP - a real address that
//                       zero-pads correctly, and it must keep coming back "00501".
//   buildGeoIsoColumn   JOINS. `005` has no region, so as a join key it resolves to NOTHING and
//                       belongs in `unmatched`, or the row is reported matched and then vanishes.
//   detectGeo           still decides the KIND from the format count, so a military-ZIP column is
//                       still a ZIP column and still gets its POINT map (which reads no match
//                       percentage at all, deliberately - see the asymmetry note in ChartFilter);
//                       what it REPORTS is what can be painted.
// Collapsing those three into one test broke the padding case, which is how the split was found.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectGeo, toGeoIso, buildGeoIsoColumn } from "../src/geoDetector";
import { US_ZIP3_PREFIXES } from "../src/geoUsZip3Prefixes.generated";

// Drawable prefixes, verified present in the asset: Boston, Manhattan, Beverly Hills, Chicago.
const DRAWABLE = ["02108", "10001", "90210", "60601"];
// Undrawable but perfectly well-formed: an unassigned prefix, the lowest real ZIP there is, and
// two military ranges.
const UNDRAWABLE = ["00000", "00501", "09123", "96201"];

describe("the generated prefix set", () => {
    // TWO COPIES OF ONE TRUTH, so this is the guard. The set is generated from chart-host's
    // geometry asset (scripts/buildZip3PrefixSet.mjs) because shape-core cannot depend on
    // chart-host - the dependency runs the other way - and a stale copy would silently mark real
    // ZIPs undrawable, which is a wrong REFUSAL rather than a wrong drawing. Read off the asset's
    // text rather than imported, to avoid the reverse dependency in a test too.
    it("still equals the ids in chart-host's ZIP-3 asset", () => {
        const asset = join(__dirname, "..", "..", "chart-host", "src", "geoUsZip3.generated.ts");
        const src = readFileSync(asset, "utf8");
        const ids = new Set([...src.matchAll(/"id"\s*:\s*"(\d{3})"/g)].map(m => m[1]));

        expect(ids.size, "the asset's id format changed - regenerate the prefix set").toBeGreaterThan(800);
        const missingHere = [...ids].filter(id => !US_ZIP3_PREFIXES.has(id));
        const extraHere = [...US_ZIP3_PREFIXES].filter(id => !ids.has(id));
        expect(missingHere, "the asset has prefixes the generated set does not - run "
             + "scripts/buildZip3PrefixSet.mjs; until then these regions refuse to join").toEqual([]);
        expect(extraHere, "the generated set claims prefixes the asset cannot draw - these would "
             + "be reported matched and then drawn nowhere, which is the defect this fixes").toEqual([]);
    });

    it("is the asset's own size, and a strict subset of the format space", () => {
        expect(US_ZIP3_PREFIXES.size).toBe(896);
        expect(US_ZIP3_PREFIXES.size).toBeLessThan(1000);
        // The specific gaps this change exists for.
        for (const p of ["000", "005", "090", "099", "340", "962", "966"])
            expect(US_ZIP3_PREFIXES.has(p), `${p} should not be drawable`).toBe(false);
        for (const p of ["006", "021", "100", "902", "606"])
            expect(US_ZIP3_PREFIXES.has(p), `${p} should be drawable`).toBe(true);
    });
});

describe("toGeoIso still only NORMALIZES", () => {
    // The property that must not change. If these go red the drawability test has crept back
    // into the normalizer, and the zero-padding contract goes with it.
    it.each(UNDRAWABLE)("%s normalizes even though it cannot be drawn", z => {
        expect(toGeoIso(z, "us-zip5")).toBe(z);
    });

    it("still pads a zero-stripped ZIP whose prefix has no region", () => {
        // 00501 is Holtsville NY - a real address, and prefix 005 has no polygon. Both true.
        expect(toGeoIso("501", "us-zip5")).toBe("00501");
        expect(US_ZIP3_PREFIXES.has("005")).toBe(false);
    });
});

describe("buildGeoIsoColumn joins only what can be drawn", () => {
    it("nulls an undrawable ZIP and counts it unmatched", () => {
        const built = buildGeoIsoColumn([...DRAWABLE, ...UNDRAWABLE], "us-zip5");
        expect(built.matchedRows).toBe(DRAWABLE.length);
        expect(built.totalRows).toBe(DRAWABLE.length + UNDRAWABLE.length);
        expect(built.iso.slice(0, DRAWABLE.length)).toEqual(DRAWABLE);
        expect(built.iso.slice(DRAWABLE.length)).toEqual(UNDRAWABLE.map(() => null));
        // The examples reach the annotation, so the reader can see WHICH values went nowhere.
        expect(built.unmatched.sort()).toEqual([...UNDRAWABLE].sort());
    });

    it("leaves every other join kind alone", () => {
        // Only ZIP's asset is a strict subset of its format space; states and countries resolve
        // through a dictionary that IS the key set. A blanket membership test here would have
        // been a silent refusal machine for them.
        expect(buildGeoIsoColumn(["CA", "NY", "TX"], "us-state-code").matchedRows).toBe(3);
        expect(buildGeoIsoColumn(["Germany", "France"], "country-name").matchedRows).toBe(2);
    });

    it("was the silent drop: the case that vanished from a real chart", () => {
        // 45 five-digit ZIPs across 22 prefixes, one of them 00000. Before, the host reported
        // 0 unmatched and the chart drew 21 of 22 with nothing saying so.
        const built = buildGeoIsoColumn(["90210", "10001", "60601", "00000"], "us-zip5");
        expect(built.totalRows - built.matchedRows, "00000 must be counted, not dropped").toBe(1);
        expect(built.unmatched).toContain("00000");
    });
});

describe("detectGeo reports what can be painted, and keeps the KIND", () => {
    const col = "Zip";

    it("reports 100% for a column the basemap can draw entirely", () => {
        const r = detectGeo(DRAWABLE, col);
        expect(r?.geoKind).toBe("us-zip5");
        expect(r?.geoMatchPct).toBe(100);
    });

    it("reports the DRAWABLE share, not the format share", () => {
        // Six values, all well-formed ZIPs; two have no region. Format would say 100.
        const r = detectGeo([...DRAWABLE, "00000", "09123"], col);
        expect(r?.geoKind).toBe("us-zip5");
        expect(r?.geoMatchPct).toBeCloseTo(66.7, 1);
    });

    it("STILL CALLS A MILITARY-ZIP COLUMN A ZIP COLUMN - the point map depends on it", () => {
        // Every value here is a real APO/FPO ZIP with no region on the US basemap. The kind must
        // survive: the point cascade places a ZIP from its own centroid table and reads no match
        // percentage, so calling this "not a ZIP column" would take away a map that works. The
        // choropleth is refused by the percentage instead, which is the honest lever.
        const r = detectGeo(["09123", "09456", "09601", "96201", "96301"], col);
        expect(r?.geoKind, "the kind is decided on the format count, deliberately").toBe("us-zip5");
        expect(r?.geoMatchPct, "and the choropleth gate refuses it on this").toBe(0);
    });

    it("crosses the server's 85% gate exactly where drawability says it should", () => {
        // The measured case from the register: a fixture whose ZIP-3 column is 100% well-formed
        // and 73.3% drawable. Format-only kept it above the gate; drawability puts it under.
        const eleven = ["10001", "02108", "90210", "60601", "94105", "98101", "20001", "30301",
                        "19103", "80202", "85001"];
        const withGaps = [...eleven, "00000", "00100", "00300", "09000"];   // 11 of 15 drawable
        const r = detectGeo(withGaps, col);
        expect(r?.geoKind).toBe("us-zip5");
        expect(r?.geoMatchPct).toBeCloseTo(73.3, 1);
        expect(r!.geoMatchPct, "under LLMGeoMinMatchPct = 85, so the choropleth is refused")
            .toBeLessThan(85);
    });

    it("redeems a zero-stripped column through the same test, never by assumption", () => {
        // Integer coercion ate the leading zeros: 2108 is Boston (021, drawable), 501 is
        // Holtsville (005, not). A blind `zip += zip4` would have called both drawable.
        const r = detectGeo(["2108", "2139", "10001", "501"], col);
        expect(r?.geoKind).toBe("us-zip5");
        expect(r?.geoMatchPct, "3 of 4 draw").toBe(75);
    });
});
