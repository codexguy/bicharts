// EVERY ROLE THE RESOLVER CAN PLACE FROM MUST OPEN THE GATE.
//
// buildRenderPayload decides whether a point binding is worth resolving before it calls the
// resolver. That gate listed city / state / zip / lat+lon — the roles that could place a row
// on the day it was written. shape-core later gained a COUNTRY precision tier ("the coarsest
// honest answer": every row in a country lands on one centroid), which made country-alone
// placeable too, and the gate was not updated with it.
//
// The failure was silent and complete: a World point map over country-only data — the exact
// shape of the world_country_metrics dataset — produced no __geoLat__/__geoLon__ at all, and
// the generated chart drew its own "No coordinate data available" while the resolver could
// place all 44 rows. Dev LLMLogID 38905, 2026-08-02.
//
// The lesson generalises past `country`: a capability added to the resolver is invisible
// until the gate that guards the resolver knows about it. The last test here is the guard
// against the NEXT tier landing the same way.
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";

const COLS = [
    { name: "Country", isMeasure: false },
    { name: "Region", isMeasure: false },
    { name: "Orders", isMeasure: true },
];

const ROWS = [
    { Country: "France", Region: "Europe", Orders: 120 },
    { Country: "Japan", Region: "Asia", Orders: 300 },
    { Country: "Brazil", Region: "South America", Orders: 90 },
];

const colNames = (p: { columns: any[] }) => p.columns.map(c => c.name);

describe("a country-only point binding places rows", () => {
    it("appends __geoLat__/__geoLon__", () => {
        const p = buildRenderPayload(COLS as any, ROWS as any, null, { country: "Country" });
        expect(colNames(p)).toContain("__geoLat__");
        expect(colNames(p)).toContain("__geoLon__");
    });

    it("every row gets a real coordinate, at country precision", () => {
        const p = buildRenderPayload(COLS as any, ROWS as any, null, { country: "Country" });
        const lat = colNames(p).indexOf("__geoLat__");
        const lon = colNames(p).indexOf("__geoLon__");

        for (const row of p.rows) {
            expect(typeof row[lat]).toBe("number");
            expect(typeof row[lon]).toBe("number");
        }
        // France is the first row; a country centroid, not a null and not 0/0.
        expect(row0(p, lat)).toBeCloseTo(47.3, 0);
        expect(row0(p, lon)).toBeCloseTo(2.9, 0);

        expect(p.geoPoint?.precision).toBe("country");
        expect(p.geoPoint?.precisionCounts.country).toBe(3);
        expect(p.geoPoint?.unplaced).toBe(0);
    });

    it("works the same on the world map scope", () => {
        const p = buildRenderPayload(COLS as any, ROWS as any, null, { country: "Country", mapKind: "world" });
        expect(colNames(p)).toContain("__geoLat__");
        expect(p.geoPoint?.precisionCounts.country).toBe(3);
    });

    it("a refusal that kills the map SAYS SO, which is the case that used to be silent", () => {
        // Every geo diagnostic hung off the geoPoint object — which a total refusal prevents
        // from existing — so the one outcome worth explaining explained nothing. The chart
        // draws "no coordinate data available" and the reason has to survive alongside it.
        const rows = [{ Ctry: "Freedonia" }, { Ctry: "Sylvania" }, { Ctry: "Ruritania" }];
        const p = buildRenderPayload([{ name: "Ctry", isMeasure: false }] as any, rows as any,
            null, { country: "Ctry", mapKind: "world" });
        expect(p.geoPoint).toBeUndefined();          // nothing placed, as it should be
        expect(p.geoPointRefused?.join(" ")).toMatch(/Ctry/);
    });

    it("a binding with NO placeable role still resolves nothing", () => {
        // The gate must stay a gate. An empty binding means "this is a point map, recover the
        // roles from the data" — with no place-like column present there is nothing to find,
        // and appending null coordinate columns would tell the chart it has a map when it has
        // none.
        const flat = [{ Widget: "A", Orders: 1 }, { Widget: "B", Orders: 2 }];
        const p = buildRenderPayload(
            [{ name: "Widget", isMeasure: false }, { name: "Orders", isMeasure: true }] as any,
            flat as any, null, {});
        expect(colNames(p)).not.toContain("__geoLat__");
    });

    it("GUARD: every placeable role opens the gate", () => {
        // If a new placeable role is added to GeoPointBinding, this fails until the gate
        // knows about it — precisely what did not happen for `country`. Each role is given a
        // column whose VALUES genuinely suit it, because role resolution verifies the hint
        // and will refuse a mismatched one (a country column offered as `state` is refused on
        // purpose — that is the "CA" trap, and it is correct).
        const cases: Array<{ role: string; bind: any }> = [
            { role: "city", bind: { city: "City", state: "State" } },
            { role: "state", bind: { state: "State" } },
            { role: "zip", bind: { zip: "Zip" } },
            { role: "country", bind: { country: "Country" } },
            { role: "lat+lon", bind: { lat: "Lat", lon: "Lon" } },
        ];
        const cols = ["City", "State", "Zip", "Country", "Lat", "Lon"].map(n => ({ name: n, isMeasure: false }));
        const rows = [{ City: "Dallas", State: "TX", Zip: "75201", Country: "United States", Lat: 32.78, Lon: -96.8 }];

        for (const c of cases) {
            const p = buildRenderPayload(cols as any, rows as any, null, c.bind);
            expect(colNames(p), `role '${c.role}' must open the point-binding gate`).toContain("__geoLat__");
        }
    });
});

describe("world_country_metrics, end to end", () => {
    // The gate above was fixed and the map was STILL empty, because the fix was one layer
    // short. The server names `Country` (full names), and the two deliberate junk rows put
    // that column at 95.5% — just under the identification bar — so the hint failed
    // verification and then OWNED the role anyway, blocking `CountryCode` beside it, which is
    // clean ISO-3 at 100% (both junk rows leave it blank, and a blank is not a failed match).
    // Naming a column did WORSE than naming nothing, which is the tell.
    //
    // These are the literal 44 rows of testharness/datasets/world_country_metrics.csv. The
    // row COUNT is load-bearing, not decoration: at 42 of 44 the name column sits half a point
    // under the bar, which is the whole reason this shape found the bug. A trimmed sample
    // moves the ratio and stops testing anything.
    const cols = [
        { name: "Country", isMeasure: false }, { name: "CountryCode", isMeasure: false },
        { name: "Region", isMeasure: false }, { name: "Revenue", isMeasure: true },
    ];
    const pairs: Array<[string, string]> = [
        ["United States", "USA"], ["Brazil", "BRA"], ["Canada", "CAN"], ["Mexico", "MEX"],
        ["France", "FRA"], ["Germany", "DEU"], ["United Kingdom", "GBR"], ["Spain", "ESP"],
        ["Italy", "ITA"], ["Netherlands", "NLD"], ["Poland", "POL"], ["Sweden", "SWE"],
        ["Japan", "JPN"], ["China", "CHN"], ["India", "IND"], ["Australia", "AUS"],
        ["Indonesia", "IDN"], ["Singapore", "SGP"], ["South Korea", "KOR"], ["Viet Nam", "VNM"],
        ["South Africa", "ZAF"], ["Nigeria", "NGA"], ["Kenya", "KEN"], ["Egypt", "EGY"],
        ["United Arab Emirates", "ARE"], ["Saudi Arabia", "SAU"], ["Israel", "ISR"],
        ["Türkiye", "TUR"], ["Chile", "CHL"], ["Argentina", "ARG"], ["Colombia", "COL"],
        ["Norway", "NOR"], ["Switzerland", "CHE"], ["Ireland", "IRL"], ["New Zealand", "NZL"],
        ["Philippines", "PHL"], ["Thailand", "THA"], ["Malaysia", "MYS"], ["Portugal", "PRT"],
        ["Denmark", "DNK"], ["Freedonia", ""], ["Global (unassigned)", ""],
        ["Greece", "GRC"], ["Iceland", "ISL"],
    ];
    const rows = pairs.map(([Country, CountryCode], i) =>
        ({ Country, CountryCode, Region: "Americas", Revenue: 100 + i }));

    it("draws, with the server's own binding", () => {
        const p = buildRenderPayload(cols as any, rows as any, null,
            { country: "Country", mapKind: "world" });
        expect(colNames(p)).toContain("__geoLat__");
        expect(p.geoPoint?.precision).toBe("country");
        // Everything but the two junk rows, which come back UNPLACED and named — the honest
        // outcome, and the one the chart already reports.
        expect(p.geoPoint?.precisionCounts.country).toBe(pairs.length - 2);
        expect(p.geoPoint?.unplaced).toBe(2);
    });

    it("names the rows it could not place", () => {
        // Counting them and not naming them is the silent drop the unplaced report exists to
        // end. The trap is one layer up from where that was written: the winning column
        // (CountryCode) is BLANK on exactly the two rows that fail, so every bound value is
        // empty and the row has no name — while "Freedonia" sits in the column the resolver
        // passed over. That column is carried as a label source only, matched against nothing.
        const p = buildRenderPayload(cols as any, rows as any, null,
            { country: "Country", mapKind: "world" });
        expect(p.geoPoint?.unplaced).toBe(2);
        expect(p.geoPoint?.unplacedExamples).toContain("Freedonia");
        expect(p.geoPoint?.unplacedExamples).toContain("Global (unassigned)");
    });

    it("naming the column is never worse than naming nothing", () => {
        const hinted = buildRenderPayload(cols as any, rows as any, null,
            { country: "Country", mapKind: "world" });
        const blank = buildRenderPayload(cols as any, rows as any, null, { mapKind: "world" });
        expect(hinted.geoPoint?.precisionCounts).toEqual(blank.geoPoint?.precisionCounts);
    });
});

function row0(p: { rows: any[][] }, idx: number): number {
    return p.rows[0][idx] as number;
}
