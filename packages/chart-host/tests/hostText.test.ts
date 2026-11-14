import { describe, it, expect } from "vitest";
import { computeSelectionCard } from "../src/selectionCard";
import { hostText, catalogSource, chartHostStrings, type CatalogValue } from "../src/hostText";

// THE CARD IN THE READER'S LANGUAGE. Every sentence the card shows is a key with its English at the call site, so a
// host that passes no text source reads exactly what it read before, and a host that passes one reads whole sentences
// in its language - the column placed where the grammar puts it, the plural the language's rules choose, its own
// decimal mark - never English fragments glued in English word order.

function payload(rows: any[][] = [["Denver", "West", 100], ["Miami", "East", 200], ["Boston", "East", 300], ["Tulsa", "", 400]]) {
    const columns: any[] = [
        { name: "City", dataType: "String", isMeasure: false },
        { name: "Segment", dataType: "String", isMeasure: false },
        { name: "Revenue", dataType: "Double", isMeasure: true },
        { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
    ];
    return { columns, rows: rows.map((r, i) => [...r, i]) } as any;
}

const GERMAN: Record<string, CatalogValue> = {
    "card.blank": "(leer)",
    "card.marks": { one: "{n} Markierung", other: "{n} Markierungen" },
    "card.header.marks": { one: "{n} Markierung", other: "{n} Markierungen" },
    "card.measure.sum": "Summe von {column}",
    "card.share": "{pct} % der Gesamtsumme",
    "card.distinct": "Verschiedene {column}",
    "card.rows": "{selected} von {total} Zeilen",
};
const de = catalogSource("de", GERMAN);

describe("hostText", () => {
    it("reads the English at the call site when no source is passed, or the source does not word the key", () => {
        expect(hostText(null, "k", "Sum of {column}", { column: "Revenue" })).toBe("Sum of Revenue");
        expect(hostText(de, "no.such.key", "{n} rows", { n: 3 })).toBe("3 rows");
        expect(hostText(undefined, "k", { one: "{n} mark", other: "{n} marks" }, { n: 1 }, 1)).toBe("1 mark");
    });

    it("chooses the language's own plural form", () => {
        const ru = catalogSource("ru", { "card.marks": { one: "{n} отметка", few: "{n} отметки", many: "{n} отметок", other: "{n} отметки" } });
        expect(hostText(ru, "card.marks", "{n} marks", { n: 1 }, 1)).toBe("1 отметка");
        expect(hostText(ru, "card.marks", "{n} marks", { n: 3 }, 3)).toBe("3 отметки");
        expect(hostText(ru, "card.marks", "{n} marks", { n: 5 }, 5)).toBe("5 отметок");
    });

    it("leaves a placeholder with no value as written", () => {
        expect(hostText(null, "k", "{a} and {b}", { a: "x" })).toBe("x and {b}");
    });
});

describe("chartHostStrings", () => {
    it("is null for English and for a culture the package carries no catalog for, so the host reads English", () => {
        expect(chartHostStrings("en-US")).toBeNull();
        expect(chartHostStrings("")).toBeNull();
        expect(chartHostStrings(undefined)).toBeNull();
        expect(chartHostStrings("xx-YY")).toBeNull();
    });
});

describe("the selection card with a text source", () => {
    it("reads exactly as before when the host passes none", () => {
        const before = computeSelectionCard(payload(), [0, 1], {});
        const none = computeSelectionCard(payload(), [0, 1], { strings: null });
        expect(none).toEqual(before);
        expect(before!.rowsText).toBe("2 of 4 rows");
        expect(before!.lines[0].label).toBe("Sum of Revenue");
    });

    it("words every sentence in the source's language", () => {
        const card = computeSelectionCard(payload(), [0, 1], { strings: de, cultureCode: "de-DE" })!;
        expect(card.lines[0].label).toBe("Summe von Revenue");
        expect(card.lines[0].shareText).toBe("30,0 % der Gesamtsumme");
        expect(card.rowsText).toBe("2 von 4 Zeilen");
        expect(card.dimensionLines.find(l => l.column === "Segment")!.label).toBe("Verschiedene Segment");
    });

    it("says a blank in the reader's word", () => {
        const card = computeSelectionCard(payload([["", "West", 100]]), [0], { strings: de })!;
        expect(card.header).toBe("(leer)");
    });

    it("counts marks with the language's plural and its digit grouping", () => {
        const rows = Array.from({ length: 1500 }, (_, i) => [`C${i}`, "West", i + 1]);
        const card = computeSelectionCard(payload(rows), rows.map((_, i) => i), { strings: de })!;
        expect(card.header).toBe("1.500 Markierungen");
        expect(card.rowsText).toBe("1.500 von 1.500 Zeilen");
    });

    it("does not say the aggregation twice when the column's name already says it, in English or in the reader's words", () => {
        const named = (name: string) => ({
            columns: [{ name: "City", dataType: "String", isMeasure: false }, { name, dataType: "Double", isMeasure: true },
                      { name: "__rowIdx__", dataType: "Int64", isMeasure: false }],
            rows: [["Denver", 5, 0], ["Miami", 7, 1]],
        }) as any;
        expect(computeSelectionCard(named("Summe von Orders"), [0], { strings: de })!.lines[0].label).toBe("Summe von Orders");
        expect(computeSelectionCard(named("Sum of Orders"), [0], { strings: de })!.lines[0].label).toBe("Sum of Orders");
        expect(computeSelectionCard(named("Orders"), [0], { strings: de })!.lines[0].label).toBe("Summe von Orders");
    });
});
