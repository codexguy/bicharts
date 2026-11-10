import { describe, it, expect } from "vitest";
import {
    serializeGenerationColumns, parseGenerationColumns, generationColumnsAnswerInLocale, columnsNeverGeneratedOn,
    GENERATION_COLUMNS_MAX_CHARS,
} from "../src/index";

// The columns a chart was generated on, kept by the host beside the saved code. Two columns of a Spanish session - a plain
// column and an automatic sum - the shape a chart generated in one Power BI language carries into a viewer's other one.
const COLS = [
    { n: "Riesgo", q: "Sheet1.Riesgo" },
    { n: "Suma de Actividades", q: "Sum(Sheet1.Actividades)" },
];

describe("serializeGenerationColumns / parseGenerationColumns", () => {
    it("round-trips the columns and the locale", () => {
        const text = serializeGenerationColumns(COLS, "es-ES");
        expect(text).toBe('{"v":1,"l":"es-ES","c":[{"n":"Riesgo","q":"Sheet1.Riesgo"},{"n":"Suma de Actividades","q":"Sum(Sheet1.Actividades)"}]}');
        expect(parseGenerationColumns(text)).toEqual({ v: 1, l: "es-ES", c: COLS });
    });

    it("a column without a query name keeps \"\"; one without a name is left out", () => {
        const text = serializeGenerationColumns([{ n: "A" }, { n: "", q: "T.B" }, { n: 5 as any, q: "T.C" }], null);
        expect(parseGenerationColumns(text)).toEqual({ v: 1, l: "", c: [{ n: "A", q: "" }] });
    });

    it("nothing to store stores \"\"", () => {
        expect(serializeGenerationColumns([], "en-US")).toBe("");
        expect(serializeGenerationColumns(null, "en-US")).toBe("");
        expect(serializeGenerationColumns({ length: 1 } as any, "en-US")).toBe("");
    });

    it("a list over the cap stores \"\"", () => {
        const many = Array.from({ length: 400 }, (_, i) => ({ n: `Column number ${i} with a long name`, q: `Sum(Table.Column number ${i})` }));
        expect(JSON.stringify({ v: 1, l: "en-US", c: many }).length).toBeGreaterThan(GENERATION_COLUMNS_MAX_CHARS);
        expect(serializeGenerationColumns(many, "en-US")).toBe("");
    });

    it("anything unusable reads as unknown (null), never as an empty list", () => {
        for (const raw of ["", "x", "[]", "{}", '{"v":2,"l":"en-US","c":[{"n":"A","q":""}]}', '{"v":1,"l":"en-US","c":[]}',
            '{"v":1,"l":"en-US","c":[{"q":"T.A"}]}', "x".repeat(GENERATION_COLUMNS_MAX_CHARS + 1), null, undefined, 7]) {
            expect(parseGenerationColumns(raw as any), String(raw).slice(0, 40)).toBeNull();
        }
    });
});

describe("generationColumnsAnswerInLocale - stored names stand in only in another locale", () => {
    const gen = (l: string) => ({ v: 1 as const, l, c: COLS });
    it("the same locale, in any case, withholds them", () => {
        expect(generationColumnsAnswerInLocale(gen("es-ES"), "ES-es")).toBe(false);
        expect(generationColumnsAnswerInLocale(gen("es-ES"), " es-ES ")).toBe(false);
    });
    it("another locale allows them", () => {
        expect(generationColumnsAnswerInLocale(gen("es-ES"), "en-US")).toBe(true);
    });
    it("an unknown locale on either side allows them", () => {
        expect(generationColumnsAnswerInLocale(gen(""), "en-US")).toBe(true);
        expect(generationColumnsAnswerInLocale(gen("es-ES"), "")).toBe(true);
        expect(generationColumnsAnswerInLocale(gen("es-ES"), undefined)).toBe(true);
    });
    it("no stored columns allows nothing", () => {
        expect(generationColumnsAnswerInLocale(null, "en-US")).toBe(false);
    });
});

describe("columnsNeverGeneratedOn", () => {
    it("names the gone columns the chart was never generated on", () => {
        const gen = parseGenerationColumns(serializeGenerationColumns(COLS, "es-ES"));
        expect(columnsNeverGeneratedOn(["Extra", "Riesgo"], gen)).toEqual(["Extra"]);
        expect(columnsNeverGeneratedOn([], gen)).toEqual([]);
    });
    it("unknown generation columns withhold nothing", () => {
        expect(columnsNeverGeneratedOn(["Extra", "Riesgo"], null)).toEqual([]);
    });
});
