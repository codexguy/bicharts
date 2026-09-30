import { describe, it, expect } from "vitest";
import { createChartGroup, buildRenderPayload } from "../src/index";

// A ROUTE'S FAR END THROUGH THE GROUP. buildRenderPayload has taken a destination binding since the
// origin-destination flow map arrived, but the group - the path every page, React app and Blazor app
// takes to build a payload from its own rows - passed only the join and the origin. So a flow map
// hosted by the group had no destination coordinates at all, and an app re-querying live rows had
// to hand-build the columns the builder already knows how to make.
//
// The contract: a group given `destination` builds exactly what buildRenderPayload builds with it,
// on the whole table and on a filtered subset, and setSource keeps it (or drops it) like the others.

const COLS = [
    { name: "From", dataType: "String", isMeasure: false },
    { name: "To", dataType: "String", isMeasure: false },
    { name: "Flights", dataType: "Double", isMeasure: true },
];
const ROWS = [
    { From: "London", To: "Paris", Flights: 812 },
    { From: "Paris", To: "London", Flights: 790 },
    { From: "Oslo", To: "London", Flights: 240 },
];
const ORIGIN = { city: "From", mapKind: "world" as const };
const DEST = { city: "To", mapKind: "world" as const };
const names = (p: any) => p.columns.map((c: any) => c.name);

describe("createChartGroup - the destination binding", () => {
    it("builds the destination columns the builder makes, for the whole table", () => {
        const g = createChartGroup(COLS, ROWS, { point: ORIGIN, destination: DEST });
        const got = g.payloadFor(null).payload;
        const want = buildRenderPayload(COLS, ROWS, null, ORIGIN, DEST);
        expect(names(got)).toContain("__geoLatD__");
        expect(got).toEqual(want);
    });

    it("and for a filtered subset, row for row", () => {
        const g = createChartGroup(COLS, ROWS, { point: ORIGIN, destination: DEST });
        const got = g.payloadFor([2, 0]).payload;
        const want = buildRenderPayload(COLS, [ROWS[2], ROWS[0]], null, ORIGIN, DEST);
        expect(got).toEqual(want);
    });

    it("setSource carries it, and a source without one drops it", () => {
        const g = createChartGroup(COLS, ROWS, { point: ORIGIN });
        expect(names(g.payloadFor(null).payload)).not.toContain("__geoLatD__");
        g.setSource(COLS, ROWS, { point: ORIGIN, destination: DEST });
        expect(names(g.payloadFor(null).payload)).toContain("__geoLatD__");
        g.setSource(COLS, ROWS, { point: ORIGIN });
        expect(names(g.payloadFor(null).payload)).not.toContain("__geoLatD__");
    });

    it("a group with no destination is byte-identical to before", () => {
        const g = createChartGroup(COLS, ROWS, { point: ORIGIN });
        expect(g.payloadFor(null).payload).toEqual(buildRenderPayload(COLS, ROWS, null, ORIGIN));
    });
});
