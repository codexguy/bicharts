// PROPER BEHAVIOUR — the second set, same shape as Joel's six (2026-08-02).
//
// Written after scenario 4 turned out to be a bug rather than a bad expectation, on the view
// that the useful test is the one stating what SHOULD happen for a whole scenario, end to end,
// rather than what a function currently returns. Each block is a situation a real table gets
// into; the assertions are the outcome a user would call correct.
//
// The recurring principle, and the one every failure so far has violated: a map may only
// claim what it can support. Coarser is fine and is reported; wrong is not; and a row that
// cannot be placed must be COUNTED and NAMED rather than dropped, approximated, or guessed.
import { describe, it, expect } from "vitest";
import { buildRenderPayload } from "../src/payload";
import { buildGeoIsoColumn, resolveGeoPoint, isGeoPointAmbiguity } from "@bicharts/shape-core";

const dim = (name: string) => ({ name, isMeasure: false });
const measure = (name: string) => ({ name, isMeasure: true });
const colNames = (p: { columns: any[] }) => p.columns.map(c => c.name);
const at = (p: { columns: any[]; rows: any[][] }, row: number, col: string) =>
    p.rows[row][colNames(p).indexOf(col)];

describe("7. a cross-filter click must not move or lose a mark", () => {
    // Roles are re-resolved against whatever rows survive a filter, so a subset is a fresh
    // classification problem with less evidence. Marks that shift on click - or a map that
    // blanks entirely - is the failure this guards, and it is why looksLikeCountryColumn
    // refuses to read a lone "CA" as Canada.
    const rows = [
        { City: "Boston", State: "MA", Orders: 1 }, { City: "Denver", State: "CO", Orders: 2 },
        { City: "Austin", State: "TX", Orders: 3 }, { City: "Fresno", State: "CA", Orders: 4 },
    ];
    const cols = [dim("City"), dim("State"), measure("Orders")];
    const bind = { city: "City", state: "State", mapKind: "north-america" as const };

    it("every single-row subset places the mark exactly where the full table did", () => {
        const full = buildRenderPayload(cols, rows, null, bind);
        for (let i = 0; i < rows.length; ++i) {
            const one = buildRenderPayload(cols, [rows[i]], null, bind);
            expect(at(one, 0, "__geoLat__"), `row ${i} moved under cross-filter`)
                .toBe(at(full, i, "__geoLat__"));
        }
    });

    it("a subset whose only state value is CA does not become CANADA", () => {
        // One Californian row surviving a click must not turn its State column into a country
        // column and drag the city to Canada - or, failing to match there, blank the map.
        const one = buildRenderPayload(cols, [rows[3]], null, bind);
        expect(at(one, 0, "__geoLat__")).toBeGreaterThan(35);   // Fresno, 36.7N
        expect(at(one, 0, "__geoLat__")).toBeLessThan(38);
    });
});

describe("8. an ambiguous name is refused and named, never guessed", () => {
    // Five Richmonds, all North American, none dominant enough to be "the" Richmond. Before
    // v2 the largest won on population and the map asserted a location it had no basis for.
    it("Richmond alone is not plotted, and says how many places it could be", () => {
        const r = resolveGeoPoint({ city: "Richmond", mapKind: "north-america" });
        expect(isGeoPointAmbiguity(r)).toBe(true);
        expect((r as any).matches).toBeGreaterThan(1);
    });

    it("a state settles it, and then it places exactly", () => {
        const r = resolveGeoPoint({ city: "Richmond", state: "VA", mapKind: "north-america" }) as any;
        expect(r.precision).toBe("city");
        expect(r.lat).toBeGreaterThan(37); expect(r.lat).toBeLessThan(38);   // 37.5N
    });

    it("the chart is told WHICH rows to disambiguate, not just how many", () => {
        // Counted separately from `unplaced` on purpose: "we found nothing" and "we found
        // several" call for different user action - the second one is fixed by adding a column.
        const rows = [{ City: "Richmond" }, { City: "Boston" }, { City: "Denver" }];
        const p = buildRenderPayload([dim("City")], rows, null,
            { city: "City", mapKind: "north-america" });
        expect(p.geoPoint!.ambiguousRows).toBe(1);
        expect(p.geoPoint!.ambiguousExamples).toContain("Richmond");
        expect(at(p, 0, "__geoLat__")).toBeNull();          // not plotted, by rule
        expect(p.geoPoint!.precisionCounts.city).toBe(2);   // the other two are fine
    });
});

describe("9. a finer tier that CONTRADICTS the country is dropped, not obeyed", () => {
    it("Paris, France is France - not Paris, Ontario", () => {
        // The pre-country-tier behaviour: FRA was unrecognised, narrowed nothing, and the
        // North American Paris won on being the only candidate. Coarser and RIGHT beats finer
        // and wrong, and the precision tier says which it got.
        const r = resolveGeoPoint({ city: "Paris", country: "France", mapKind: "world" }) as any;
        expect(r.precision).toBe("city");
        expect(r.lon).toBeGreaterThan(1); expect(r.lon).toBeLessThan(3);    // 2.35E
    });

    it("a state that disagrees with the country buys the COARSE answer, not a guess", () => {
        // I expected city precision here and was wrong — worth recording, because the reasoning
        // is the interesting part. "CA" as a state is California; the row says Canada. One of
        // the two fields is wrong and a SINGLE ROW cannot tell which, so the honest placement
        // is the coarse one they agree on. Guessing "the country is right" would be a coin
        // flip dressed as precision. (v2 matching: a non-blank attribute that matches nothing
        // EXCLUDES the row.)
        const r = resolveGeoPoint({ city: "Toronto", state: "CA", country: "Canada", mapKind: "world" }) as any;
        expect(r.precision).toBe("country");
        expect(r.lat).toBeGreaterThan(41);              // in Canada, never Bakersfield
    });

    it("...but a whole COLUMN of countries in the state slot CAN be told apart, and then it places exactly", () => {
        // The distinction that makes the coarse answer above acceptable rather than a
        // limitation: what one row cannot decide, a column can. resolvePointRoles sees every
        // value at once, recognises the state slot as a country column, refuses it AS a state
        // and puts it to work as the country — so the production path recovers city precision
        // on the exact data shape the row-level call has to be coarse about.
        const rows = [
            { City: "Toronto", St: "Canada" }, { City: "Chicago", St: "United States" },
            { City: "Monterrey", St: "Mexico" }, { City: "Calgary", St: "Canada" },
        ];
        const p = buildRenderPayload([dim("City"), dim("St")], rows, null,
            { city: "City", state: "St", mapKind: "north-america" });
        expect(p.geoPoint!.rolesRefused!.join(" ")).toMatch(/state=St/);
        expect(p.geoPoint!.precisionCounts.city).toBe(4);
        expect(at(p, 0, "__geoLat__")).toBeGreaterThan(43);   // Toronto, 43.7N
    });

    it("a London row on a NORTH AMERICA map is Ontario, and a UK one is refused", () => {
        // London ON is tagged for both maps; London GB for the world only. So the bare name
        // resolves in Ontario - correct for this basemap - and an explicit United Kingdom
        // finds no in-scope candidate and must NOT fall through onto a British coordinate.
        const bare = resolveGeoPoint({ city: "London", mapKind: "north-america" }) as any;
        expect(bare.precision).toBe("city");
        expect(bare.lon).toBeLessThan(-70);                                  // 81W, Ontario
        expect(resolveGeoPoint({ city: "London", country: "United Kingdom", mapKind: "north-america" }))
            .toBeNull();
    });
});

describe("10. a measure is never adopted as a place column", () => {
    it("a 5-digit Revenue column does not become the ZIP role", () => {
        // ZIP is identified on digit shape, so a revenue column scores a clean 100%. The
        // protection is that only DIMENSIONS are offered to the resolver - if that ever
        // regresses, every mark on the map moves.
        const rows = [
            { Region: "North", Revenue: 90210 }, { Region: "South", Revenue: 60614 },
            { Region: "East", Revenue: 10001 }, { Region: "West", Revenue: 02108 },
        ];
        const p = buildRenderPayload([dim("Region"), measure("Revenue")], rows, null,
            { mapKind: "north-america" });
        expect(colNames(p)).not.toContain("__geoLat__");
    });
});

describe("11. real coordinates beat every lookup, and 0/0 is not a coordinate", () => {
    it("an explicit lat/lon wins over a resolvable name", () => {
        const r = resolveGeoPoint({ lat: 42.36, lon: -71.06, city: "Denver" }) as any;
        expect(r.precision).toBe("latlon");
        expect(r.lat).toBe(42.36);
    });

    it("(0,0) beside a resolvable name is the missing-value convention, not Null Island", () => {
        const r = resolveGeoPoint({ lat: 0, lon: 0, city: "Boston", mapKind: "north-america" }) as any;
        expect(r.precision).toBe("city");
        expect(r.lat).toBeGreaterThan(42);
    });

    it("but bare (0,0) with nothing else is honoured - refusing it would fabricate a miss", () => {
        const r = resolveGeoPoint({ lat: 0, lon: 0 }) as any;
        expect(r.precision).toBe("latlon");
        expect(r.lat).toBe(0);
    });

    it("blank and out-of-range coordinates fall through to the names", () => {
        expect((resolveGeoPoint({ lat: " ", lon: " ", city: "Boston" }) as any).precision).toBe("city");
        expect((resolveGeoPoint({ lat: 999, lon: 999, city: "Boston" }) as any).precision).toBe("city");
    });
});

describe("12. a state column that actually holds countries is put to work, not just refused", () => {
    it("refused as the state role, adopted as the country role", () => {
        const rows = [
            { City: "Toronto", Where: "Canada" }, { City: "Chicago", Where: "United States" },
            { City: "Monterrey", Where: "Mexico" }, { City: "Vancouver", Where: "Canada" },
        ];
        const p = buildRenderPayload([dim("City"), dim("Where")], rows, null,
            { city: "City", state: "Where", mapKind: "north-america" });
        expect(p.geoPoint!.rolesRefused!.join(" ")).toMatch(/state=Where/);
        // The value of identifying what it IS: Vancouver now means BC, not Washington.
        expect(p.geoPoint!.precisionCounts.city).toBe(4);
        expect(at(p, 3, "__geoLat__")).toBeGreaterThan(49);
    });
});

describe("13. placeholders are holes, not failures", () => {
    it("one N/A does not cost a clean country column its role", () => {
        const countries = ["United States", "Canada", "Mexico", "France", "Germany", "Japan",
                           "Brazil", "Kenya", "India", "N/A"];
        const rows = countries.map((Country, i) => ({ Country, Orders: i }));
        const p = buildRenderPayload([dim("Country"), measure("Orders")], rows, null,
            { country: "Country", mapKind: "world" });
        expect(colNames(p)).toContain("__geoLat__");
        expect(p.geoPoint!.precisionCounts.country).toBe(9);
        // The placeholder row is honestly unplaced - a hole in the data is still a hole.
        expect(p.geoPoint!.unplaced).toBe(1);
    });

    it("the choropleth half agrees, which it did not until 0.5.12", () => {
        const col = buildGeoIsoColumn(["USA", "CAN", "MEX", "FRA", "N/A"], "country-iso3");
        expect(col.matchedRows).toBe(4);
        expect(col.unmatched).toEqual(["N/A"]);
    });
});

describe("14. a stale binding degrades to what is left, never geocodes from undefined", () => {
    it("a renamed column is dropped and the role recovered from the data", () => {
        // The persisted binding crosses a save boundary and comes back untrusted: columns get
        // renamed. Reading `undefined` for every row would geocode nothing while reporting a
        // binding; the honest move is to re-resolve from the columns that DO exist.
        const rows = [
            { Town: "Boston", ST: "MA" }, { Town: "Denver", ST: "CO" },
            { Town: "Austin", ST: "TX" }, { Town: "Fresno", ST: "CA" },
        ];
        const p = buildRenderPayload([dim("Town"), dim("ST")], rows, null,
            { city: "City", state: "State", mapKind: "north-america" });   // both names are stale
        expect(colNames(p)).toContain("__geoLat__");
        expect(p.geoPoint!.precisionCounts.city).toBe(4);
        expect(p.geoPoint!.rolesBackfilled!.join(" ")).toMatch(/Town/);
    });
});

describe("15. precision is reported per tier, so a caption can be true", () => {
    it("one coarse row among many city rows is counted, not smeared over the whole map", () => {
        // `precision` alone is a CEILING and reads identically for 1-of-4 and 4-of-4 coarse
        // rows, so a caption built from it ("approximated to state centres") would be false
        // for three quarters of this map. The counts are what a caption must be written from.
        const rows = [
            { City: "Boston", State: "MA" }, { City: "Denver", State: "CO" },
            { City: "Austin", State: "TX" }, { City: "", State: "WY" },
        ];
        const p = buildRenderPayload([dim("City"), dim("State")], rows, null,
            { city: "City", state: "State", mapKind: "north-america" });
        expect(p.geoPoint!.precision).toBe("state");          // the ceiling
        expect(p.geoPoint!.precisionCounts.city).toBe(3);     // what it is actually about
        expect(p.geoPoint!.precisionCounts.state).toBe(1);
        expect(p.geoPoint!.coarseExamples.join(" ")).toMatch(/WY/);
    });
});

describe("16. a choropleth reports its holes rather than leaving them grey and unexplained", () => {
    it("an unmatched region is counted and named", () => {
        const values = ["USA", "CAN", "MEX", "FRA", "DEU", "Atlantis"];
        const rows = values.map((Country, i) => ({ Country, Revenue: i }));
        const p = buildRenderPayload([dim("Country"), measure("Revenue")], rows,
            { column: "Country", kind: "country-iso3" }, null);
        expect(p.geoUnmatched!.count).toBe(1);
        expect(p.geoUnmatched!.examples).toContain("Atlantis");
        expect(at(p, 5, "__geoIso__")).toBeNull();
    });
});

describe("17. a world map over ONE country refuses, and says which condition failed", () => {
    it("every row on the same centroid is not a map", () => {
        // "World types yes, North America, yes, USA - no" (Joel), gated on the structural
        // trait rather than a map-type allowlist: with one distinct country every row lands on
        // one dot, which is a picture of nothing regardless of which basemap is behind it.
        const rows = [
            { Country: "United States", Region: "West", Orders: 1 },
            { Country: "United States", Region: "East", Orders: 2 },
            { Country: "United States", Region: "South", Orders: 3 },
        ];
        const p = buildRenderPayload([dim("Country"), dim("Region"), measure("Orders")], rows,
            null, { country: "Country", mapKind: "world" });
        expect(colNames(p)).not.toContain("__geoLat__");
        expect(p.geoPointRefused!.join(" ")).toMatch(/nothing to place apart/);
    });

    it("two countries is enough, because now the dots mean something", () => {
        const rows = [
            { Country: "United States", Orders: 1 }, { Country: "Canada", Orders: 2 },
            { Country: "United States", Orders: 3 },
        ];
        const p = buildRenderPayload([dim("Country"), measure("Orders")], rows, null,
            { country: "Country", mapKind: "world" });
        expect(p.geoPoint!.precisionCounts.country).toBe(3);
    });
});
