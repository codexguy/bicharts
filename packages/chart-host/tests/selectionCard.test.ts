import { describe, it, expect } from "vitest";
import { computeSelectionCard, normaliseAggregation } from "../src/selectionCard";

// THE CARD IS ARITHMETIC THE READER CANNOT CHECK. It appears over the chart, states a number
// and a percentage, and there is nothing on screen to verify it against — which is exactly why
// these tests care more about what the card REFUSES to say than about the happy path. A wrong
// total is a bug; a confidently wrong "23% of total" beside an average is a lie.

/** A payload shaped the way buildRenderPayload emits one: real columns first, `__rowIdx__` last,
 *  rows as arrays in column order. */
function payload(opts: { rowIdx?: number[]; extraSynthetic?: boolean } = {}) {
    const columns: any[] = [
        { name: "City", dataType: "String", isMeasure: false },
        { name: "Segment", dataType: "String", isMeasure: false },
        { name: "Revenue", dataType: "Double", isMeasure: true },
        { name: "Population", dataType: "Int64", isMeasure: false },   // numeric but NOT bound
    ];
    const base = [
        ["Denver", "West", 100, 10],
        ["Miami", "East", 200, 20],
        ["Boston", "East", 300, 30],
        ["Tulsa", "Central", 400, 40],
    ];
    if (opts.extraSynthetic) {
        columns.push({ name: "__geoLat__", dataType: "Double", isMeasure: false });
        base.forEach((r, i) => r.push(40 + i as any));
    }
    columns.push({ name: "__rowIdx__", dataType: "Int64", isMeasure: false });
    const idx = opts.rowIdx ?? [0, 1, 2, 3];
    const rows = base.map((r, i) => [...r, idx[i]]);
    return { columns, rows } as any;
}

describe("computeSelectionCard - when there is nothing to say", () => {
    it("returns null for an empty selection, so the card DISMISSES rather than showing zeroes", () => {
        // "no selection" and "a selection that sums to nothing" are different states, and only
        // the first should take the card off screen.
        expect(computeSelectionCard(payload(), [])).toBeNull();
        expect(computeSelectionCard(payload(), null)).toBeNull();
        expect(computeSelectionCard(payload(), undefined)).toBeNull();
    });

    it("returns null for an empty or absent payload rather than throwing", () => {
        expect(computeSelectionCard(null, [0])).toBeNull();
        expect(computeSelectionCard({ columns: [], rows: [] } as any, [0])).toBeNull();
    });

    it("returns null when every index is out of range - a stale selection says nothing", () => {
        expect(computeSelectionCard(payload(), [99, 100])).toBeNull();
    });
});

describe("computeSelectionCard - the numbers", () => {
    it("sums the selection and states its share of the whole", () => {
        const card = computeSelectionCard(payload(), [0, 1], { aggregation: "sum" })!;
        const rev = card.lines.find(l => l.column === "Revenue")!;
        expect(rev.label).toBe("Sum of Revenue");
        expect(rev.value).toBe(300);                       // 100 + 200
        expect(rev.sharePct).toBeCloseTo(30, 5);           // of 1000
        expect(rev.shareText).toBe("30.0% of total");
        expect(card.rowsText).toBe("2 of 4 rows");
        expect(card.selectedRows).toBe(2);
        expect(card.totalRows).toBe(4);
    });

    it("counts DISTINCT indices - a mark listed twice is not two rows", () => {
        const card = computeSelectionCard(payload(), [1, 1, 1], { aggregation: "sum" })!;
        expect(card.selectedRows).toBe(1);
        expect(card.lines.find(l => l.column === "Revenue")!.value).toBe(200);
    });

    it("ignores out-of-range indices while honouring the rest", () => {
        const card = computeSelectionCard(payload(), [0, 999], { aggregation: "sum" })!;
        expect(card.selectedRows).toBe(1);
        expect(card.lines.find(l => l.column === "Revenue")!.value).toBe(100);
    });

    it("OMITS the share for a non-additive aggregate, because a mean is not a part of a whole", () => {
        // The rule this file exists to protect. The average of two rows is not a percentage of
        // the average of four, and printing one would be wrong exactly where nobody can check.
        const card = computeSelectionCard(payload(), [0, 1], { aggregation: "average" })!;
        const rev = card.lines.find(l => l.column === "Revenue")!;
        expect(rev.label).toBe("Average of Revenue");
        expect(rev.value).toBe(150);
        expect(rev.sharePct).toBeNull();
        expect(rev.shareText).toBe("");
    });

    it("omits the share for min, max and median too", () => {
        for (const agg of ["min", "max", "median"]) {
            const card = computeSelectionCard(payload(), [0, 1, 2], { aggregation: agg })!;
            expect(card.lines.find(l => l.column === "Revenue")!.sharePct, agg).toBeNull();
        }
    });

    it("keeps the share for count, which IS additive", () => {
        const card = computeSelectionCard(payload(), [0, 1], { aggregation: "count" })!;
        const rev = card.lines.find(l => l.column === "Revenue")!;
        expect(rev.value).toBe(2);
        expect(rev.sharePct).toBeCloseTo(50, 5);
    });

    it("skips null and non-numeric cells instead of treating them as zero", () => {
        const p = payload();
        p.rows[0][2] = null;
        p.rows[1][2] = "n/a";
        const card = computeSelectionCard(p, [0, 1, 2], { aggregation: "sum" })!;
        // Only Boston's 300 is a number; a coerced 0 would drag an average down silently.
        expect(card.lines.find(l => l.column === "Revenue")!.value).toBe(300);
        expect(card.selectedRows).toBe(3);      // the ROWS are still selected
    });

    it("omits the share when the total is zero, rather than dividing by it", () => {
        const p = payload();
        p.rows.forEach((r: any[]) => { r[2] = 0; });
        const card = computeSelectionCard(p, [0, 1], { aggregation: "sum" })!;
        expect(card.lines.find(l => l.column === "Revenue")!.sharePct).toBeNull();
    });
});

describe("computeSelectionCard - which columns become lines", () => {
    it("treats a NUMERIC column as a measure even when isMeasure is false - the Excel case", () => {
        // Power BI binds fields to wells and says isMeasure outright. Excel has no binding UI,
        // so shape-core infers it and often declines to commit. Trusting only isMeasure would
        // give an empty card on ordinary worksheet data, in the host this item exists for.
        const card = computeSelectionCard(payload(), [0, 1], { aggregation: "sum" })!;
        expect(card.lines.map(l => l.column)).toContain("Population");
    });

    it("NEVER makes a line out of a synthetic column - arithmetic on a coordinate is nonsense", () => {
        const card = computeSelectionCard(payload({ extraSynthetic: true }), [0, 1])!;
        const names = card.lines.map(l => l.column);
        expect(names).not.toContain("__rowIdx__");
        expect(names).not.toContain("__geoLat__");
    });

    it("caps the measure list and REPORTS what it left out", () => {
        const p = payload();
        for (let i = 0; i < 6; i++) {
            p.columns.splice(p.columns.length - 1, 0, { name: `M${i}`, dataType: "Double", isMeasure: true });
            p.rows.forEach((r: any[]) => r.splice(r.length - 1, 0, i + 1));
        }
        const card = computeSelectionCard(p, [0, 1], { maxMeasures: 3 })!;
        expect(card.lines).toHaveLength(3);
        expect(card.hiddenMeasures).toBeGreaterThan(0);   // never silently truncated
    });
});

describe("computeSelectionCard - the header", () => {
    it("names the selected dimension values", () => {
        const card = computeSelectionCard(payload(), [0, 1])!;
        expect(card.header).toBe("Denver, Miami");
    });

    it("collapses to a COUNT past the cap - twelve city names is not a header", () => {
        const card = computeSelectionCard(payload(), [0, 1, 2, 3], { maxHeaderValues: 2 })!;
        expect(card.header).toBe("4 marks");
    });

    it("says (blank) rather than dropping an empty dimension value", () => {
        const p = payload();
        p.rows[0][0] = "";
        const card = computeSelectionCard(p, [0])!;
        expect(card.header).toBe("(blank)");
    });
});

describe("computeSelectionCard - row-index mapping", () => {
    it("resolves through __rowIdx__ rather than assuming the position", () => {
        // data-row-idx carries the value written into __rowIdx__. Where those differ from array
        // positions, positional lookup silently reports the WRONG row's numbers.
        const p = payload({ rowIdx: [500, 501, 502, 503] });
        const card = computeSelectionCard(p, [502], { aggregation: "sum" })!;
        expect(card.header).toBe("Boston");
        expect(card.lines.find(l => l.column === "Revenue")!.value).toBe(300);
    });

    it("falls back to positional when the payload carries no __rowIdx__", () => {
        const p = payload();
        p.columns.pop();
        p.rows.forEach((r: any[]) => r.pop());
        const card = computeSelectionCard(p, [2], { aggregation: "sum" })!;
        expect(card.header).toBe("Boston");
    });
});

describe("normaliseAggregation", () => {
    it("maps the spellings the hosts actually send", () => {
        expect(normaliseAggregation("Avg")).toBe("average");
        expect(normaliseAggregation("MEAN")).toBe("average");
        expect(normaliseAggregation("Minimum")).toBe("min");
        expect(normaliseAggregation("countDistinct")).toBe("distinctcount");
    });

    it("falls back to sum for empty or unknown input rather than throwing", () => {
        // A card is a courtesy. Refusing to draw one because a host wrote "Total" is worse than
        // summing, which is what "Total" almost certainly meant.
        expect(normaliseAggregation(undefined)).toBe("sum");
        expect(normaliseAggregation("")).toBe("sum");
        expect(normaliseAggregation("Total")).toBe("sum");
    });
});
