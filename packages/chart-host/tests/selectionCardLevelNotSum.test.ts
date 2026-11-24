import { describe, it, expect } from "vitest";
import { computeSelectionCard } from "../src/selectionCard";

// THE CARD DOES NOT ADD UP A PRICE, A TEMPERATURE OR A PER-CASE DURATION.
//
// Its blank "Auto" resolves per column through shape-core's defaultAggregation; a unit price,
// a temperature and a days-to-resolve are values read at a point, so Auto averages them and
// offers no share of a total beside them. A total price and a revenue are still sums.

function payload() {
    const columns: any[] = [
        { name: "Ticket", dataType: "String", isMeasure: false, valueNature: "Categorical" },
        { name: "UnitPrice", dataType: "Double", isMeasure: true },
        { name: "temp_f", dataType: "Double", isMeasure: true },
        { name: "DaysToResolve", dataType: "Double", isMeasure: true },
        { name: "Revenue", dataType: "Double", isMeasure: true },
        { name: "TotalPrice", dataType: "Double", isMeasure: true },
        { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
    ];
    const rows = [
        ["A", 10, 70, 2, 100, 30, 0],
        ["B", 20, 80, 4, 300, 50, 1],
        ["C", 30, 90, 6, 600, 20, 2],
    ];
    return { columns, rows } as any;
}

describe("Auto on a level", () => {
    const by = (card: any, n: string) => card.lines.find((l: any) => l.column === n)!;

    it("averages a price, a temperature and a per-case duration, and sums the amounts", () => {
        const card = computeSelectionCard(payload(), [0, 1], { maxMeasures: 10 })!;
        expect(by(card, "UnitPrice").label).toBe("Average of UnitPrice");
        expect(by(card, "UnitPrice").value).toBeCloseTo(15, 9);
        expect(by(card, "temp_f").label).toBe("Average of temp_f");
        expect(by(card, "temp_f").value).toBeCloseTo(75, 9);
        expect(by(card, "DaysToResolve").label).toBe("Average of DaysToResolve");
        expect(by(card, "DaysToResolve").value).toBeCloseTo(3, 9);
        expect(by(card, "Revenue").label).toBe("Sum of Revenue");
        expect(by(card, "Revenue").value).toBe(400);
        expect(by(card, "TotalPrice").label).toBe("Sum of TotalPrice");
        expect(by(card, "TotalPrice").value).toBe(80);
    });

    it("prints no share of a total beside a level", () => {
        const card = computeSelectionCard(payload(), [0, 1], { maxMeasures: 10 })!;
        for (const n of ["UnitPrice", "temp_f", "DaysToResolve"]) expect(by(card, n).sharePct, n).toBeNull();
        for (const n of ["Revenue", "TotalPrice"]) expect(by(card, n).sharePct, n).not.toBeNull();
    });

    it("an explicit sum is substituted on a level, as on a rate", () => {
        const card = computeSelectionCard(payload(), [0, 1], { aggregation: "sum", maxMeasures: 10 })!;
        expect(by(card, "UnitPrice").label).not.toBe("Sum of UnitPrice");
        expect(by(card, "Revenue").label).toBe("Sum of Revenue");
    });
});
