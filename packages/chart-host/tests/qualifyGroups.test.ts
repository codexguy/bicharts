import { describe, it, expect } from "vitest";
import { qualifyGroupHeadingFor, newQualifyGroupState, type QualifyGroupRow } from "../src/qualifyGroups";

// THE PREVIEW BLOCK IS A POSITION, NOT A BADGE. The server floats preview TYPES (unscorable) to
// the top of the ranked list; a preview LANE sits on a scorable type that ranks on its own merits
// and is deliberately left where it ranks, carrying only its badge. Before rankedSeen existed, one
// badged lane at rank 13 opened "New - in preview" above row 13 and closed it with "Best fit for
// your data" above row 14 - two headings asserting a grouping the list did not have. Seen in the
// Excel host: "'best fit for your data' as a heading only shows up at position #14.. why?"

const headings = (rows: QualifyGroupRow[]) => {
    const state = newQualifyGroupState();
    return rows.map(r => qualifyGroupHeadingFor(r, state));
};

describe("the preview block lives at the top, or not at all", () => {
    it("floated preview types open the block and the first ranked row closes it", () => {
        expect(headings([{ isPreview: true }, { isPreview: true }, {}, {}]))
            .toEqual(["preview", null, "main", null]);
    });

    it("a badged lane mid-list is a badge, not a block: no heading before it and none after it", () => {
        const rows: QualifyGroupRow[] = [{}, {}, { isPreview: true }, {}, {}];
        expect(headings(rows)).toEqual([null, null, null, null, null]);
    });

    it("a plain ranked list carries no headings at all", () => {
        expect(headings([{}, {}, {}])).toEqual([null, null, null]);
    });

    it("the projected and not-recommended boundaries are untouched", () => {
        expect(headings([{}, { viaProjection: "Pivot|Region|" }, { recommended: false }]))
            .toEqual([null, "projected", "notRecommended"]);
    });

    it("a badged lane after a ranked row does not open a block even before the not-recommended tail", () => {
        expect(headings([{}, { isPreview: true }, { recommended: false, isPreview: true }]))
            .toEqual([null, null, "notRecommended"]);
    });
});
