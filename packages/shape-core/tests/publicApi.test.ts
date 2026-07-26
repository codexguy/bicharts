import { describe, it, expect } from "vitest";
// Import through the PUBLIC BARREL (index.ts) — the exact surface the MCP client
// (and the visual, via its adapter) consumes. This guards that the package's entry
// point stays wired: a missing/renamed export breaks here before it breaks a host.
import {
    IndexedText,
    classifyNumericValueNature,
    classifyTemporal,
    classifyAdditivity,
    hostAggHint,
    isIdentifierName,
    detectOrdinalDomain,
    detectFormatSignature,
    detectGeo,
    toGeoIso,
    buildGeoIsoColumn,
    monthLookupFor,
    normalizeMonthKey,
    STR,
    SIMPLE_STRING_HASH,
    GET_RANDOM,
} from "../src/index";

describe("@bicharts/shape-core public API", () => {
    it("re-exports the engine + classifiers + helpers from the barrel", () => {
        expect(typeof IndexedText).toBe("function"); // the class
        for (const fn of [classifyNumericValueNature, classifyTemporal, classifyAdditivity,
            hostAggHint, isIdentifierName, detectOrdinalDomain, detectFormatSignature,
            detectGeo, toGeoIso, buildGeoIsoColumn, monthLookupFor, normalizeMonthKey,
            STR, SIMPLE_STRING_HASH, GET_RANDOM]) {
            expect(typeof fn).toBe("function");
        }
    });

    it("the classifier is functional through the barrel (AnnualIncome → Continuous)", () => {
        // Same anchor case as the 16805 regression: wide-range non-measure integer.
        expect(classifyNumericValueNature({
            name: "AnnualIncome", dataType: "Integer", isMeasure: false, prec: 0,
            distinct: 850, nonblank: 1000, minval: 12000, maxval: 240000,
        })).toBe("Continuous");
    });

    it("package-owned utils are pure + deterministic", () => {
        expect(STR(null)).toBe("");
        expect(STR(42)).toBe("42");
        // FNV-1a: stable across calls (this is what makes the shape payload's keys
        // reproducible across the visual and the MCP client).
        expect(SIMPLE_STRING_HASH("Division")).toBe(SIMPLE_STRING_HASH("Division"));
        expect(normalizeMonthKey("Sept.")).toBe("sept");
        expect(monthLookupFor("en")["january"]).toBe(0);
    });
});
