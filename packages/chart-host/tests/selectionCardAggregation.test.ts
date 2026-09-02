import { describe, it, expect } from "vitest";
import { computeSelectionCard } from "../src/selectionCard";

// WHAT THE CARD IS ALLOWED TO COMPUTE (2026-09-01).
//
// Reported 2026-09-01: the card offered `Sum of Latitude: 84 (12.3% of total)` on the
// shipped 21-city sample table. A total of coordinates, with a SHARE of that total beside it,
// on a surface whose own header comment says a wrong percentage is worse than a wrong total
// because nothing on screen can check it.
//
// Kept in its own file rather than appended to selectionCard.test.ts: that file is the ORIGINAL
// contract and every one of its 21 cases still passes untouched, which is a fact worth being
// able to see at a glance. This file is the new half.

/** The sample table's shape, coordinates FIRST — which is what made the cap bite. */
function geoPayload() {
    const columns: any[] = [
        { name: "City", dataType: "String", isMeasure: false, valueNature: "Categorical" },
        { name: "Segment", dataType: "String", isMeasure: false, valueNature: "Categorical" },
        { name: "Latitude", dataType: "Decimal", isMeasure: true, valueNature: "Continuous" },
        { name: "Longitude", dataType: "Decimal", isMeasure: true, valueNature: "Continuous" },
        { name: "Population", dataType: "Integer", isMeasure: true, valueNature: "Continuous" },
        { name: "Revenue", dataType: "Integer", isMeasure: true, valueNature: "Continuous" },
        { name: "Stores", dataType: "Integer", isMeasure: true, valueNature: "Continuous" },
        { name: "ChurnRate", dataType: "Decimal", isMeasure: true, valueNature: "Continuous" },
        { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
    ];
    const rows = [
        ["New York", "East", 40.7128, -74.006, 8400000, 952000, 62, 4.2, 0],
        ["Toronto", "Canada", 43.6532, -79.3832, 2930000, 608000, 37, 2.8, 1],
        ["Miami", "East", 25.7617, -80.1918, 460000, 509000, 31, 5.1, 2],
        ["Denver", "Central", 39.7392, -104.9903, 715000, 352000, 21, 3.4, 3],
    ];
    return { columns, rows } as any;
}

describe("a coordinate is not an amount", () => {
    it("makes NO line out of Latitude or Longitude, at any aggregation", () => {
        for (const aggregation of ["sum", "average", "median", "min", ""]) {
            const card = computeSelectionCard(geoPayload(), [0, 1], { aggregation, maxMeasures: 10 })!;
            const names = card.lines.map(l => l.column);
            expect(names, aggregation).not.toContain("Latitude");
            expect(names, aggregation).not.toContain("Longitude");
        }
    });

    it("reports them as SUPPRESSED rather than dropping them silently", () => {
        // A column vanishing from a card with no trace anywhere is what costs an afternoon
        // later. Not for display — for the host's diagnostics.
        const card = computeSelectionCard(geoPayload(), [0, 1], { maxMeasures: 10 })!;
        expect(card.suppressedColumns).toEqual(["Latitude", "Longitude"]);
    });

    it("suppresses BEFORE the cap, so the real measures are the ones on screen", () => {
        // THE USER-VISIBLE HALF. maxMeasures defaults to 4 and the coordinates are the first two
        // numeric columns, so the card showed Latitude, Longitude, Population, Revenue and hid
        // Stores and ChurnRate behind "+2 more". Two lines nobody could use crowding out two
        // they came for.
        const card = computeSelectionCard(geoPayload(), [0, 1])!;
        expect(card.lines.map(l => l.column)).toEqual(["Population", "Revenue", "Stores", "ChurnRate"]);
        expect(card.hiddenMeasures).toBe(0);
    });
});

describe("Auto means per COLUMN", () => {
    const by = (card: any, n: string) => card.lines.find((l: any) => l.column === n)!;

    it("a blank aggregation sums amounts and averages rates, as the settings label promises", () => {
        // "Auto — sum amounts, average rates" has been the shipped label since the control
        // existed; normaliseAggregation("") answered `sum` for every column alike.
        const card = computeSelectionCard(geoPayload(), [0, 1], {})!;
        expect(by(card, "Revenue").label).toBe("Sum of Revenue");
        expect(by(card, "Revenue").value).toBe(1560000);
        expect(by(card, "ChurnRate").label).toBe("Average of ChurnRate");
        expect(by(card, "ChurnRate").value).toBeCloseTo(3.5, 5);      // (4.2 + 2.8) / 2, not 7.0
    });

    it("an EXPLICIT sum is honoured where honest and substituted where it is not", () => {
        // Summing the rate to agree with a dropdown would be a wrong number rather than a
        // consistent one. The label is what tells the reader which they got.
        const card = computeSelectionCard(geoPayload(), [0, 1], { aggregation: "sum" })!;
        expect(by(card, "Revenue").aggregation).toBe("sum");
        expect(by(card, "ChurnRate").aggregation).toBe("average");
        expect(by(card, "ChurnRate").label).toBe("Average of ChurnRate");
    });

    it("an explicit AVERAGE is honest for every measure, so nothing is substituted", () => {
        const card = computeSelectionCard(geoPayload(), [0, 1], { aggregation: "average" })!;
        for (const l of card.lines) expect(l.aggregation, l.column).toBe("average");
    });

    it("omits the share for a rate under a sum — both halves of the rule, now", () => {
        const card = computeSelectionCard(geoPayload(), [0, 1], { aggregation: "sum" })!;
        expect(by(card, "ChurnRate").sharePct).toBeNull();
        expect(by(card, "Revenue").sharePct).not.toBeNull();
    });
});

describe("dimensions finally get a line", () => {
    it("one distinct value: the column NAME is the label", () => {
        // Two East rows. "First of Segment: East" says nothing "Segment: East" does not.
        const card = computeSelectionCard(geoPayload(), [0, 2])!;
        expect(card.dimensionLines).toHaveLength(1);
        expect(card.dimensionLines[0].label).toBe("Segment");
        expect(card.dimensionLines[0].valueText).toBe("East");
        expect(card.dimensionLines[0].aggregation).toBe("first");
    });

    it("several distinct values: a COUNT of them", () => {
        const card = computeSelectionCard(geoPayload(), [0, 1, 3])!;
        expect(card.dimensionLines[0].label).toBe("Distinct Segment");
        expect(card.dimensionLines[0].value).toBe(3);
        expect(card.dimensionLines[0].aggregation).toBe("distinctcount");
    });

    it("never repeats the column the header already shows", () => {
        const card = computeSelectionCard(geoPayload(), [0, 1])!;
        expect(card.header).toBe("New York, Toronto");
        expect(card.dimensionLines.map(l => l.column)).not.toContain("City");
    });

    it("keeps its own cap, so dimensions cannot crowd out the amounts", () => {
        const p = geoPayload();
        for (let i = 0; i < 5; i++) {
            p.columns.splice(p.columns.length - 1, 0,
                { name: "D" + i, dataType: "String", isMeasure: false, valueNature: "Categorical" });
            p.rows.forEach((r: any[]) => r.splice(r.length - 1, 0, "d" + i));
        }
        const card = computeSelectionCard(p, [0, 1], { maxDimensions: 2 })!;
        expect(card.dimensionLines).toHaveLength(2);
        expect(card.lines).toHaveLength(4);        // the measure side is untouched by dimensions
    });

    it("still says (blank) rather than dropping an empty value", () => {
        const p = geoPayload();
        p.rows[0][1] = "";
        const card = computeSelectionCard(p, [0])!;
        expect(card.dimensionLines[0].valueText).toBe("(blank)");
    });

    it("never makes a dimension line out of a synthetic column", () => {
        const card = computeSelectionCard(geoPayload(), [0, 1], { maxDimensions: 10 })!;
        expect(card.dimensionLines.map(l => l.column)).not.toContain("__rowIdx__");
    });
});
