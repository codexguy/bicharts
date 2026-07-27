import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import { detectGeo } from "../src/geoDetector";
import type { LLMColumnWithValue } from "../src/models";

// A MEASURE MUST NEVER CARRY A geoKind.
//
// detectGeo answers "do these values look geographic?" and a 5-digit integer looks exactly
// like a US ZIP — because it is indistinguishable from one. Fed a column of order counts or
// monthly revenue, it says us-zip5 at 100% confidence, and it is not wrong to: nothing in
// the values themselves says otherwise. What makes a ZIP a ZIP is the ROLE, and role is the
// caller's knowledge.
//
// So the profiler only asks about NON-MEASURE columns, and that guard is load-bearing well
// outside this package. The server's ResolvePointColumn deliberately does NOT re-check
// IsMeasure — re-checking there caused its own bug, because the eligibility gate runs over a
// transformed column list while the response population reads the raw shape, and the two
// disagreed (chart offered, point columns all null, blank map). Its comment resolves that by
// depending on us: "The client only emits GeoKind for non-measure columns, so nothing
// widens."
//
// This test is that dependency written down. If the guard is ever lifted here, a column of
// revenue figures becomes an eligible point-map geography and rows get placed at ZIP
// centroids — a confidently wrong map, drawn from a measure, with nothing in the pipeline
// left to object.
//
// Found by the 2.1 geo false-positive sweep: three harness datasets
// (monthly_active_users_platform.ActiveUsers, saas_subscription_metrics."Sum of MRR",
// server_response_times."Sum of RequestCount") are classified us-zip5 at 90-100% when the
// detector is called directly. All three are unreachable in production for exactly this
// reason, and for no other.

function profile(cols: Array<Partial<LLMColumnWithValue>>, rows: any[][]): LLMColumnWithValue[] {
    const it = new IndexedText();
    it.setColumns(cols as LLMColumnWithValue[]);
    for (const r of rows) it.addRow(r);
    return it.getColumnsWithStats("40");
}

// Values that ARE valid ZIPs, so the detector has every reason to say so.
const ZIPPY = [90210, 10001, 60606, 33101, 94105, 75201, 30301, 98101, 19104, 2108,
               73301, 80202, 15201, 37201, 55401, 63101, 85001, 43215, 46201, 48201];

describe("a measure never receives a geoKind", () => {
    it("the detector DOES claim these values — this is not a weak test case", () => {
        // If this ever stops being true the rest of the file proves nothing, because the
        // guard would be untested: absence of a geoKind would no longer mean it was withheld.
        const raw = detectGeo(ZIPPY.map(String), "Sum of MRR");
        expect(raw?.geoKind, "detectGeo no longer classifies 5-digit integers as ZIPs")
            .toBe("us-zip5");
    });

    it("withholds it when the column is bound as a MEASURE", () => {
        const [measure] = profile(
            [{ name: "Sum of MRR", dataType: "Integer", isMeasure: true }],
            ZIPPY.map(v => [v]),
        );
        expect(measure.geoKind, "a measure was handed a geoKind; ResolvePointColumn trusts that this cannot happen")
            .toBeUndefined();
        expect(measure.geoMatchPct).toBeUndefined();
    });

    it("still emits it for the SAME values bound as a dimension", () => {
        // The guard must be about ROLE, not about the values — otherwise a genuine ZIP
        // column stops being mappable and the fix has broken the feature it protects.
        const [dim] = profile(
            [{ name: "ZipCode", dataType: "Integer", isMeasure: false }],
            ZIPPY.map(v => [v]),
        );
        expect(dim.geoKind).toBe("us-zip5");
    });

    it("holds for a measure whose name gives no hint at all", () => {
        // "ActiveUsers" — no zip/postal token to key off. The role is the only signal.
        const [measure] = profile(
            [{ name: "ActiveUsers", dataType: "Integer", isMeasure: true }],
            ZIPPY.map(v => [v]),
        );
        expect(measure.geoKind).toBeUndefined();
    });

    it("holds across every column of a mixed shape", () => {
        const cols = profile(
            [
                { name: "State", dataType: "String", isMeasure: false },
                { name: "Sum of RequestCount", dataType: "Integer", isMeasure: true },
                { name: "Sum of Revenue", dataType: "Decimal", isMeasure: true },
            ],
            ZIPPY.map((v, i) => [["CA", "TX", "NY", "FL", "IL"][i % 5], v, v * 1.5]),
        );
        const geoish = cols.filter(c => c.geoKind);
        expect(geoish.map(c => c.name), "only the dimension may be geographic").toEqual(["State"]);
        expect(cols.every(c => !(c.isMeasure && c.geoKind))).toBe(true);
    });
});
