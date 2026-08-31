// ONE THRESHOLD, ONE PLACE.
//
// 2026-08-02: "I would prefer one constant, so maybe we make that 95 and apply to all."
// This replaced three numbers that had drifted apart — 85 for the name roles, 100 for ZIP,
// and an implicit 100 for country — each with its own rationale written at a different time.
//
// The test reads the SOURCE, because the failure it guards against is textual: someone adds
// a role, wants it a little stricter, and writes a fresh literal. That is how the three
// became three. Tuning must stay a one-line edit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROLE_MATCH_PCT, CITY_ROLE_MATCH_PCT } from "../src/matchQuality";

const src = (f: string) => readFileSync(resolve(process.cwd(), "packages/shape-core/src", f), "utf8");

describe("the role-identification threshold has a single source", () => {
    it("is the value the contract sets", () => {
        // 95 (2026-08-02, after a day at 96). This assertion is the KNOB'S CONTRACT, not
        // a behavioural guard — it exists so the number cannot drift without someone changing
        // it here on purpose. Editing it is the intended way to move the bar; editing anything
        // else in this file to make a failure go away is not.
        //
        // 96 was settled downward on evidence: world_country_metrics is 42 clean countries and
        // two deliberate junk rows = 95.5%, so a curated reference dataset fell off its own
        // cliff. See ROLE_MATCH_PCT's own note.
        expect(ROLE_MATCH_PCT).toBe(95);
    });

    it("CITY is deliberately looser, because city names are not a closed vocabulary", () => {
        // 2026-08-02: "maybe city is a good one to make lower - 80% even". Two numbers,
        // still ONE file - the point was never a single value, it was a single place to tune.
        expect(CITY_ROLE_MATCH_PCT).toBe(80);
        expect(CITY_ROLE_MATCH_PCT).toBeLessThan(ROLE_MATCH_PCT);
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
        expect(doc).toMatch(/There is no ratio and no nearly/i);
        // And the other half, which is just as easy to lose: refusing a partial match is NOT
        // refusing normalization. Case, diacritics and recorded alternates all still resolve
        // (the field report: "the match to the gazette can still use normalized strings").
        expect(doc).toMatch(/NORMALIZED/);
        expect(doc).toMatch(/diacritic/i);
    });
});
