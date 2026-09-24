// A text column's decimal point is the COLUMN's, decided from its values. Before, every text number
// was read the English way: a German export's `12,5` turned its column into text, and `1.234`
// (one thousand two hundred and thirty-four) read as 1.234.
import { describe, it, expect } from "vitest";
import { detectDecimalSeparator, parseNumberText, decimalSeparatorOf } from "../src/numberText";
import { ingest } from "../src/ingest";

describe("detectDecimalSeparator", () => {
    it("reads the evidence a column's values give", () => {
        expect(detectDecimalSeparator(["12,5", "3,25", "100"])).toBe(",");
        expect(detectDecimalSeparator(["1.234,56", "7,5"])).toBe(",");
        expect(detectDecimalSeparator(["1.234.567"])).toBe(",");
        expect(detectDecimalSeparator(["1 234,5"])).toBe(",");
        expect(detectDecimalSeparator(["12.5", "3.25"])).toBe(".");
        expect(detectDecimalSeparator(["1,234.56"])).toBe(".");
        expect(detectDecimalSeparator(["1,234,567"])).toBe(".");
    });

    it("an ambiguous or integer column takes the culture, and with none, the dot", () => {
        expect(detectDecimalSeparator(["12,500", "1.234", "7"])).toBe(".");
        expect(detectDecimalSeparator(["12,500", "1.234", "7"], "en-US")).toBe(".");
        expect(detectDecimalSeparator(["12,500", "1.234", "7"], "de-DE")).toBe(",");
        expect(detectDecimalSeparator(["12,500"], "fr-FR")).toBe(",");
    });

    it("evidence both ways keeps the dot - the reading this parser always gave", () => {
        expect(detectDecimalSeparator(["12.5", "12,5"])).toBe(".");
        expect(detectDecimalSeparator(["12.5", "12,5"], "de-DE")).toBe(".");
    });

    it("ignores values that are already numbers", () => {
        expect(detectDecimalSeparator([12.5, 3, "7,5"])).toBe(",");
    });

    it("knows the runtime's separator for a culture", () => {
        expect(decimalSeparatorOf("de-DE")).toBe(",");
        expect(decimalSeparatorOf("en-US")).toBe(".");
        expect(decimalSeparatorOf("not a tag!")).toBe(".");
        expect(decimalSeparatorOf(undefined)).toBe(".");
    });
});

describe("parseNumberText", () => {
    it("reads a comma-decimal value under a comma column", () => {
        expect(parseNumberText("12,5", ",")).toBe(12.5);
        expect(parseNumberText("1.234,56", ",")).toBeCloseTo(1234.56, 10);
        expect(parseNumberText("12,500", ",")).toBe(12.5);
        expect(parseNumberText("1.234", ",")).toBe(1234);
        expect(parseNumberText("-3,75", ",")).toBe(-3.75);
        expect(parseNumberText("1 234,5", ",")).toBe(1234.5);
        expect(parseNumberText("1,234.5", ",")).toBeNull();
    });

    it("reads a dot column exactly as before", () => {
        expect(parseNumberText("1,234.5", ".")).toBe(1234.5);
        expect(parseNumberText("12,500", ".")).toBe(12500);
        expect(parseNumberText("1.234", ".")).toBe(1.234);
        expect(parseNumberText("12,5", ".")).toBeNull();
        expect(parseNumberText("abc", ".")).toBeNull();
    });
});

describe("ingest reads text numbers the way they were written", () => {
    // A grid of text cells - what a host hands over when numbers arrive as strings.
    const values = (cells: string[], locale?: string) => {
        const r = ingest({ kind: "grid", header: ["Value"], rows: cells.map(c => [c]) }, { locale, dedup: false });
        return { type: r.columns[0].dataType, vals: r.rows.map(x => x.Value) };
    };

    it("a comma-decimal column is a number column, with the right numbers", () => {
        const r = values(["12,5", "1.234,5", "3,25", "12,500"]);
        expect(r.type).toBe("Decimal");
        expect(r.vals).toEqual([12.5, 1234.5, 3.25, 12.5]);
    });

    it("a dot-thousands column in a German report reads as thousands", () => {
        const r = values(["1.234", "12.500", "7"], "de-DE");
        expect(r.type).toBe("Decimal");
        expect(r.vals).toEqual([1234, 12500, 7]);
    });

    it("an English reader's numbers are untouched - ambiguous values read the English way", () => {
        expect(values(["12,500", "1,234", "7"]).vals).toEqual([12500, 1234, 7]);
        expect(values(["1.234", "2.5"]).vals).toEqual([1.234, 2.5]);
        expect(values(["1,234.5", "3.25"]).vals).toEqual([1234.5, 3.25]);
        expect(values(["12,500", "1,234", "7"], "en-US").vals).toEqual([12500, 1234, 7]);
    });

    it("a column mixing both conventions stays text, as it always did", () => {
        expect(values(["12.5", "12,5"]).type).toBe("String");
    });

    it("a semicolon-delimited German CSV profiles its numbers", () => {
        const r = ingest({ kind: "csv", text: "Region;Umsatz\nNord;12,5\nSüd;1.234,5\nOst;3,25" }, { dedup: false });
        const col = r.columns.find(c => c.name === "Umsatz")!;
        expect(col.dataType).toBe("Decimal");
        expect(r.rows.map(x => x.Umsatz)).toEqual([12.5, 1234.5, 3.25]);
    });
});
