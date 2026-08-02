// ONE THRESHOLD, ONE PLACE.
//
// Joel, 2026-08-02: "I would prefer one constant, so maybe we make that 95 and apply to all."
// This replaced three numbers that had drifted apart — 85 for the name roles, 100 for ZIP,
// and an implicit 100 for country — each with its own rationale written at a different time.
//
// The test reads the SOURCE, because the failure it guards against is textual: someone adds
// a role, wants it a little stricter, and writes a fresh literal. That is how the three
// became three. Tuning must stay a one-line edit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROLE_MATCH_PCT } from "../src/matchQuality";

const src = (f: string) => readFileSync(resolve(process.cwd(), "packages/shape-core/src", f), "utf8");

describe("the role-identification threshold has a single source", () => {
    it("is the value Joel set", () => {
        expect(ROLE_MATCH_PCT).toBe(95);
    });

    it("no classifier carries its own percentage literal", () => {
        for (const file of ["geoPointRoles.ts", "geoDetector.ts"]) {
            const text = src(file);
            // Strip comments first: the rationale prose legitimately mentions the old 85 and
            // 100, and this is about CODE, not about forgetting how we got here.
            const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
            const literals = code.match(/<\s*\d{2,3}\s*[;)]|[<>]=?\s*\d{2,3}\s*\)/g) ?? [];
            expect(literals, `${file} compares against a bare percentage literal: ${literals.join(", ")}`)
                .toEqual([]);
        }
    });

    it("every threshold constant resolves to it", () => {
        for (const file of ["geoPointRoles.ts", "geoDetector.ts"]) {
            const code = src(file);
            for (const m of code.matchAll(/const\s+(\w*THRESHOLD\w*|\w*_PCT)\s*=\s*([^;]+);/g)) {
                expect(m[2].trim(), `${file}: ${m[1]} must derive from ROLE_MATCH_PCT`)
                    .toContain("ROLE_MATCH_PCT");
            }
        }
    });

    it("identification and matching stay different ideas", () => {
        // The doctrine the constant's home file exists to hold: a ratio decides what a COLUMN
        // is; a value then either resolves or is reported unplaced. If this ever reads as
        // licence to accept a 95% VALUE match, marks land in the wrong country.
        const doc = src("matchQuality.ts");
        expect(doc).toMatch(/IDENTIFICATION/);
        expect(doc).toMatch(/MATCHING/);
        expect(doc).toMatch(/no ratio, no nearly, no fuzzy fallback/i);
    });
});
