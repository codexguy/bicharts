// CROSS-FILTER STABILITY — the rule role resolution broke and must never break again.
//
// Roles are re-resolved against whatever rows survive a filter, so a classification that
// reads well on the full table can flip on a subset. It did: filtering a real point map to
// one Californian row left StateCode = {"CA"}, which is trivially "all country
// identifiers", so that column was adopted as the COUNTRY role, every city was narrowed to
// Canada, nothing matched, and the map went BLANK on a single click.
//
// The invariant is not "roles stay identical" — losing the state role on a one-row subset is
// fine and only costs precision. It is the stronger, simpler thing: A ROW THAT PLACED IN THE
// FULL TABLE MUST STILL PLACE IN ANY SUBSET CONTAINING IT. Cross-filtering may never empty a
// chart that had marks.
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";

const COLS = [
    { name: "City", isMeasure: false },
    { name: "StateCode", isMeasure: false },
    { name: "Country", isMeasure: false },
    { name: "Revenue", isMeasure: true },
];

// Deliberately spans the traps: California (the "CA" collision), a Canadian province, a
// Mexican state, a blank state, and an ambiguous bare city name.
const ROWS = [
    { City: "Irvine", StateCode: "CA", Country: "US", Revenue: 226700 },
    { City: "Plano", StateCode: "TX", Country: "US", Revenue: 184200 },
    { City: "Montréal", StateCode: "QC", Country: "CA", Revenue: 211400 },
    { City: "Guadalajara", StateCode: "", Country: "MX", Revenue: 129300 },
    { City: "Springfield", StateCode: "IL", Country: "US", Revenue: 48900 },
    { City: "Burnaby", StateCode: "BC", Country: "CA", Revenue: 76200 },
];

function placedFlags(rows: typeof ROWS) {
    const p = buildRenderPayload(COLS, rows, null, { city: "City" });
    const la = p.columns.findIndex((c: any) => c.name === "__geoLat__");
    if (la < 0) return rows.map(() => false);
    return p.rows.map((r: any[]) => r[la] !== null && r[la] !== undefined);
}

describe("cross-filter may never empty a point map", () => {
    const full = placedFlags(ROWS);

    it("places every row in the full table", () => {
        expect(full.every(Boolean)).toBe(true);
    });

    it("every SINGLE-row subset still places its row", () => {
        const blanked: string[] = [];
        ROWS.forEach((row, i) => {
            if (!full[i]) return;                       // never placed; not a regression
            if (!placedFlags([row])[0]) blanked.push(`${row.City}/${row.StateCode}`);
        });
        expect(blanked).toEqual([]);
    });

    it("every ADJACENT-PAIR subset still places both rows", () => {
        const blanked: string[] = [];
        for (let i = 0; i < ROWS.length - 1; i++) {
            const sub = [ROWS[i], ROWS[i + 1]];
            placedFlags(sub).forEach((ok, k) => {
                const src = i + k;
                if (full[src] && !ok) blanked.push(`${ROWS[src].City} (in pair ${i})`);
            });
        }
        expect(blanked).toEqual([]);
    });

    it("every SINGLE-COUNTRY subset still places its rows", () => {
        for (const cc of ["US", "CA", "MX"]) {
            const idx = ROWS.map((r, i) => [r, i] as const).filter(([r]) => r.Country === cc);
            const sub = idx.map(([r]) => r);
            const got = placedFlags(sub);
            idx.forEach(([r, src], k) => {
                if (full[src]) expect(got[k], `${r.City} in the ${cc}-only subset`).toBe(true);
            });
        }
    });

    it("the exact reported case: filtering to one Californian city", () => {
        // StateCode collapses to {"CA"} here — the shape that emptied the real map.
        const p = buildRenderPayload(COLS, [ROWS[0]], null, { city: "City" });
        const la = p.columns.findIndex((c: any) => c.name === "__geoLat__");
        expect(p.rows[0][la]).not.toBeNull();
        expect(p.rows[0][la]).toBeCloseTo(33.67, 1);        // Irvine, California
        // …and StateCode must not have been mistaken for the country column.
        expect(p.geoPoint!.rolesBackfilled ?? []).not.toContainEqual(
            expect.stringMatching(/^country=StateCode/));
    });
});
