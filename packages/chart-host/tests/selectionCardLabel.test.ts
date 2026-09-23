import { describe, it, expect } from "vitest";
import { computeSelectionCard, measureLineLabel } from "../src/selectionCard";

// A COLUMN ALREADY NAMED FOR ITS AGGREGATION IS NOT PREFIXED AGAIN.
//
// Reported on the Excel add-in: a click on an arrow of the order-fulfilment flowchart opened the
// card as "Sum of Sum of Orders: 330 (0.5% of total)". The table's measure column is named
// "Sum of Orders" - an Excel table copied from a pivot, or a Power BI implicit measure, arrives
// that way - and the label composed the aggregation onto it a second time.

function ordersPayload(measureName: string) {
    const columns: any[] = [
        { name: "FromStep", dataType: "String", isMeasure: false, valueNature: "Categorical" },
        { name: "ToStep", dataType: "String", isMeasure: false, valueNature: "Categorical" },
        { name: measureName, dataType: "Integer", isMeasure: true, valueNature: "Continuous" },
        { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
    ];
    const rows = [
        ["Rework", "Pack", 330, 0],
        ["Pick", "Pack", 8040, 1],
        ["Pack", "Quality check", 8390, 2],
    ];
    return { columns, rows } as any;
}

describe("the measure line's label", () => {
    it("reads 'Sum of Orders', not 'Sum of Sum of Orders', for a column already named for its sum", () => {
        const card = computeSelectionCard(ordersPayload("Sum of Orders"), [0], { aggregation: "sum", maxMeasures: 5 })!;
        const line = card.lines.find(l => l.column === "Sum of Orders")!;
        expect(line.label).toBe("Sum of Orders");
        expect(line.valueText).toBe("330");
    });

    it("still composes a plain column name", () => {
        const card = computeSelectionCard(ordersPayload("Orders"), [0], { aggregation: "sum", maxMeasures: 5 })!;
        expect(card.lines.find(l => l.column === "Orders")!.label).toBe("Sum of Orders");
    });

    it("keeps a DIFFERENT aggregation composed, because that is a true statement", () => {
        // the average of per-row sums is exactly what "Average of Sum of Orders" says
        expect(measureLineLabel("average" as any, "Sum of Orders")).toBe("Average of Sum of Orders");
        expect(measureLineLabel("count" as any, "Sum of Orders")).toBe("Count of Sum of Orders");
    });

    it("matches the aggregation's words regardless of case and surrounding space", () => {
        expect(measureLineLabel("sum" as any, "  sum of orders ")).toBe("sum of orders");
        expect(measureLineLabel("average" as any, "Average of Price")).toBe("Average of Price");
        // a name that merely starts with the word is not the aggregation's own phrase
        expect(measureLineLabel("sum" as any, "Summary score")).toBe("Sum of Summary score");
    });
});
