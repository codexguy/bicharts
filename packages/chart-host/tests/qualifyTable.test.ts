import { describe, it, expect } from "vitest";
import { qualifyTableRows } from "../src/qualifyTable";

describe("qualifyTableRows: the what-fits answer as table rows", () => {
    const rows = [
        { name: "Line chart", description: "A line.", rank: 1, language: "JavaScript", renderer: "D3", recommended: true, isPreview: false },
        { name: "Horizon chart", rank: 6, isPreview: true, recommended: true, alsoWorthALook: true },
        { name: "Pie chart", rank: 9, recommended: false },
        { name: "Unranked", description: null },
    ];

    it("keeps the server's order and carries rank, preview, verdict and the extra-pick flag", () => {
        expect(qualifyTableRows(rows)).toEqual([
            { rank: 1, name: "Line chart", preview: false, fit: "fits", description: "A line.", language: "JavaScript", renderer: "D3", alsoWorthALook: false },
            { rank: 6, name: "Horizon chart", preview: true, fit: "fits", description: "", language: null, renderer: null, alsoWorthALook: true },
            { rank: 9, name: "Pie chart", preview: false, fit: "can-also-render", description: "", language: null, renderer: null, alsoWorthALook: false },
            { rank: null, name: "Unranked", preview: false, fit: "fits", description: "", language: null, renderer: null, alsoWorthALook: false },
        ]);
    });

    it("never carries the selection weight", () => {
        const out = qualifyTableRows([{ name: "A", rank: 1, score: 61.9 } as never]);
        expect(Object.keys(out[0])).not.toContain("score");
    });
});
