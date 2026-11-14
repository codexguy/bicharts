import { describe, it, expect } from "vitest";
import {
    valuesWithheldWholeField, dataCompletenessFields, VALUES_WITHHELD_SENT_CAP, VALUES_WITHHELD_PRIVACY_FLOOR,
    type LLMClientHints, type WithheldValues,
} from "../src/index";

// a row cap that erases a group whole names the group, not only the count.
describe("valuesWithheldWholeField - the values a cut erased whole, as the request states them", () => {
    const weekday: WithheldValues = { column: "Dia da Semana", count: 1, values: ["Terça-feira"] };

    it("at privacy 20 and above the values travel with the column and the count", () => {
        expect(VALUES_WITHHELD_PRIVACY_FLOOR).toBe(20);
        expect(valuesWithheldWholeField([weekday], 20)).toEqual({ valuesWithheldWhole: [weekday] });
        expect(valuesWithheldWholeField([weekday], 30)).toEqual({ valuesWithheldWhole: [weekday] });
    });

    it("below privacy 20 only the column and the count travel, never a value", () => {
        expect(valuesWithheldWholeField([weekday], 10)).toEqual({ valuesWithheldWhole: [{ column: "Dia da Semana", count: 1 }] });
        expect(JSON.stringify(valuesWithheldWholeField([weekday], 0))).not.toContain("Terça");
    });

    it("at most 10 values are sent, and the count stays the true count", () => {
        const many = Array.from({ length: 14 }, (_, i) => `v${i}`);
        const out = valuesWithheldWholeField([{ column: "Store", count: 14, values: many }], 20).valuesWithheldWhole!;
        expect(VALUES_WITHHELD_SENT_CAP).toBe(10);
        expect(out[0].values).toEqual(many.slice(0, 10));
        expect(out[0].count).toBe(14);
    });

    it("an entry with no count is dropped; nothing left means no field at all (absent = none known)", () => {
        expect(valuesWithheldWholeField([{ column: "A", count: 0, values: [] }], 20)).toEqual({});
        expect(valuesWithheldWholeField([{ column: "A", count: -1 }, { column: "B", count: 2.5 }], 20)).toEqual({});
        expect(valuesWithheldWholeField([], 20)).toEqual({});
        expect(valuesWithheldWholeField(null, 20)).toEqual({});
        expect(valuesWithheldWholeField(undefined, 20)).toEqual({});
        expect(JSON.stringify({ a: 1, ...valuesWithheldWholeField(null, 20), b: 2 })).toBe('{"a":1,"b":2}');
    });

    it("a nameless column is dropped, and an empty value list is not sent", () => {
        expect(valuesWithheldWholeField([{ column: "", count: 1, values: ["x"] }], 20)).toEqual({});
        expect(valuesWithheldWholeField([{ column: "A", count: 3, values: [] }], 20))
            .toEqual({ valuesWithheldWhole: [{ column: "A", count: 3 }] });
    });

    it("the caller's arrays are never mutated", () => {
        const values = Array.from({ length: 12 }, (_, i) => `v${i}`);
        const entry = { column: "A", count: 12, values };
        valuesWithheldWholeField([entry], 20);
        valuesWithheldWholeField([entry], 10);
        expect(entry.values).toHaveLength(12);
    });

    it("the request's client hints carry it beside the completeness fields", () => {
        const hints: LLMClientHints = {
            ...dataCompletenessFields(false, 73414),
            ...valuesWithheldWholeField([weekday], 20),
        } as LLMClientHints;
        expect(hints.valuesWithheldWhole).toEqual([weekday]);
        expect(hints.rowsWithheld).toBe(73414);
    });
});
