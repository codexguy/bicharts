import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";
import { isSpreadsheetErrorText, NOT_AVAILABLE } from "../src/vocab/spreadsheetErrors";

/**
 * A FORMULA ERROR SAVED AS TEXT IS NOT DATA, IN ANY LANGUAGE.
 *
 * A CSV saved from Excel keeps a formula error as its text, in the language Excel ran in: `#N/A`, a German `#NV`, a
 * Spanish `#¡VALOR!`. shape-core's ingest had no rule for any of them, so ONE such cell made a revenue column text (a
 * measure became a category) and stopped a date column being dated. The Excel add-in reads Excel's own cell type
 * (`range.valueTypes`); a CSV - the MCP server, the React demo - has only the text.
 */
const csv = (lines: string[]) => ingest({ kind: "csv", text: lines.join("\n") });
const col = (r: ReturnType<typeof ingest>, name: string) => r.columns.find(c => c.name === name)!;

describe("an error cell is a blank, so the column keeps its type", () => {
    for (const [lang, err] of [["en", "#N/A"], ["en", "#DIV/0!"], ["de", "#NV"], ["de", "#WERT!"], ["es", "#¡VALOR!"],
                                ["fr", "#VALEUR!"], ["nl", "#N/B"], ["ru", "#ДЕЛ/0!"], ["ru", "#Н/Д"], ["sv", "#SAKNAS!"]] as const) {
        it(`${lang} ${err} in a revenue column: still a numeric measure`, () => {
            const r = csv(["Region,Revenue", "North,120", `South,${err}`, "East,95", "West,80"]);
            const c = col(r, "Revenue");
            expect(c.dataType).toBe("Integer");
            expect(c.isMeasure).toBe(true);
        });
    }

    it("a German #NV in a date column: still a date column", () => {
        const r = csv(["Day,Sales", "2025-01-31,1", "2025-02-28,2", "#NV,3", "2025-04-30,4"]);
        expect(col(r, "Day").dataType).toBe("DateTime");
    });

    it("the column reads the same as its twin with an empty cell", () => {
        const withErr = csv(["Region,Revenue", "North,120", "South,#WERT!", "East,95", "West,80"]);
        const withBlank = csv(["Region,Revenue", "North,120", "South,", "East,95", "West,80"]);
        expect(col(withErr, "Revenue")).toEqual(col(withBlank, "Revenue"));
    });
});

describe("only a whole cell that IS an error", () => {
    it("labels that start with # stay labels", () => {
        for (const s of ["#1", "#1 Seller", "#winning!", "#N/A in Q3", "# Sold", "#", "#Top10", "N/A", "#n/a?x"])
            expect(isSpreadsheetErrorText(s)).toBe(false);
    });

    it("every not-available spelling, any case, any surrounding space", () => {
        for (const s of NOT_AVAILABLE) {
            expect(isSpreadsheetErrorText(s)).toBe(true);
            expect(isSpreadsheetErrorText(` ${s.toLowerCase()} `)).toBe(true);
        }
    });

    it("the error shape catches errors Excel names later", () => {
        for (const s of ["#SPILL!", "#CALC!", "#PYTHON!", "#ÜBERLAUF!", "#¿NOMBRE?", "#ИМЯ?", "#BEZUG!", "#ZAHL!"])
            expect(isSpreadsheetErrorText(s)).toBe(true);
    });

    it("a column of hashtags stays a text column with its values", () => {
        const r = csv(["Tag,Count", "#1,5", "#Top10,3", "#winning!,2"]);
        expect(col(r, "Tag").dataType).toBe("String");
        expect(r.columns.find(c => c.name === "Count")!.isMeasure).toBe(true);
    });

    it("a source that DECLARES its types is untouched: a declared String column keeps its text", () => {
        const r = ingest({ kind: "table", columns: [{ name: "Code", dataType: "String" }, { name: "N", dataType: "Integer" }],
                           rows: [["#N/A", 1], ["B", 2], ["C", 3]] } as any);
        expect(col(r, "Code").dataType).toBe("String");
    });
});
