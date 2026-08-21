import { describe, it, expect } from "vitest";
import { qualifyGroupHeadingFor, newQualifyGroupState, type QualifyGroupRow }
    from "../packages/chart-host/src/qualifyGroups";

// Run a whole list through the boundary rule the way a host's render loop does, and return the
// rendered sequence of headings and names. Asserting on the SEQUENCE is the point: every bug
// this module exists to prevent is a heading in the wrong place, not a thrown error.
function render(rows: QualifyGroupRow[]): string[] {
    const st = newQualifyGroupState();
    const out: string[] = [];
    rows.forEach((r, i) => {
        const h = qualifyGroupHeadingFor(r, st);
        if (h) out.push(`[${h}]`);
        out.push(`row${i}`);
    });
    return out;
}

const preview = (): QualifyGroupRow => ({ isPreview: true });
const plain = (): QualifyGroupRow => ({});
const notRec = (): QualifyGroupRow => ({ recommended: false });
const projected = (): QualifyGroupRow => ({ viaProjection: "aggregated by Region" });

describe("qualifyGroupHeadingFor", () => {
    it("opens the preview block and CLOSES it at the first ranked row", () => {
        expect(render([preview(), preview(), plain(), plain()]))
            .toEqual(["[preview]", "row0", "row1", "[main]", "row2", "row3"]);
    });

    // The closing heading is the half that is easy to forget, and forgetting it is worse than
    // having no grouping: every ranked chart below reads as preview.
    it("never leaves a preview block unclosed when ranked rows follow", () => {
        const seq = render([preview(), plain()]);
        expect(seq.indexOf("[main]")).toBeGreaterThan(seq.indexOf("[preview]"));
    });

    it("writes no headings at all for an ordinary all-ranked list", () => {
        expect(render([plain(), plain(), plain()])).toEqual(["row0", "row1", "row2"]);
    });

    it("writes no preview heading when nothing is preview", () => {
        expect(render([plain(), notRec()])).toEqual(["row0", "[notRecommended]", "row1"]);
    });

    // A preview type the ontology ruled out is NOT floated by the server, so it arrives inside
    // the not-recommended block. Opening a "new in preview" heading there would advertise the
    // one preview type we have just said would mislead on this data.
    it("does not open a preview block inside the not-recommended tail", () => {
        expect(render([plain(), notRec(), { isPreview: true, recommended: false }]))
            .toEqual(["row0", "[notRecommended]", "row1", "row2"]);
    });

    it("keeps the projected and not-recommended boundaries it already had", () => {
        expect(render([plain(), projected(), notRec()]))
            .toEqual(["row0", "[projected]", "row1", "[notRecommended]", "row2"]);
    });

    // Order of the checks is the contract: a preview block at the top, then the ranked
    // remainder, then projections, then the quiet tail.
    it("renders all four groups in the one order the server produces", () => {
        expect(render([preview(), plain(), projected(), notRec()])).toEqual([
            "[preview]", "row0", "[main]", "row1", "[projected]", "row2",
            "[notRecommended]", "row3",
        ]);
    });

    it("emits at most one heading per row", () => {
        const st = newQualifyGroupState();
        for (const r of [preview(), plain(), projected(), notRec(), notRec()]) {
            const h = qualifyGroupHeadingFor(r, st);
            expect(h === null || typeof h === "string").toBe(true);
        }
    });

    // An all-preview list is legal (a tiny shape where only a preview type qualifies) and must
    // not emit a "main" heading for a block that never starts.
    it("writes no main heading when the list is preview all the way down", () => {
        expect(render([preview(), preview()])).toEqual(["[preview]", "row0", "row1"]);
    });
});
