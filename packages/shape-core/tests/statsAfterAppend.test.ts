import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// A host that streams rows in segments (the Power BI visual) may ask for the profile before the last segment
// arrives. Rows appended after that must be measured again, and a re-measure must start from the columns as the
// host set them, never from what the earlier pass wrote on fewer rows. Synthesized fixture.

const DAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
function table(): IndexedText {
    const t = new IndexedText();
    t.setColumns([
        { name: "Dia da Semana", dataType: "String", isMeasure: false },
        { name: "Dia Numero", dataType: "Integer", isMeasure: false },
        { name: "Hora Registro", dataType: "String", isMeasure: false },
        { name: "Total Coletas", dataType: "Integer", isMeasure: true },
    ] as LLMColumnWithValue[]);
    return t;
}
let k = 0;
function addDay(t: IndexedText, d: number) {
    for (let h = 0; h < 40; h++) t.addRow([DAYS[d], d, `${String(h % 24).padStart(2, "0")}:${String(h).padStart(2, "0")}`, (k++ * 7) % 13]);
}
const col = (t: IndexedText, n: string) => t.getColumnsWithStats("20", "pt-BR").find(c => c.name === n)!;

describe("a profile taken before the last rows arrived", () => {
    it("is measured again: distinct counts and leaf cardinality describe every row", () => {
        const t = table(); addDay(t, 0); addDay(t, 1);
        expect(col(t, "Dia da Semana").distinctCount).toBe(2);
        expect(t.getLeafCardinality()).toBe(80);
        for (let d = 2; d < 7; d++) addDay(t, d);
        expect(t.getRowCount()).toBe(280);
        expect(col(t, "Dia da Semana").distinctCount).toBe(7);
        expect(t.getLeafCardinality()).toBe(280);
    });
    it("drops a flag the earlier pass set on fewer rows", () => {
        const t = table(); addDay(t, 0); addDay(t, 1);
        expect(col(t, "Dia Numero").isBinaryFlag).toBe(true);      // 0 and 1 only: a binary flag, rightly, then
        for (let d = 2; d < 7; d++) addDay(t, d);
        expect(col(t, "Dia Numero").isBinaryFlag).toBeFalsy();     // 0..6 is not a flag
    });
    it("re-measured, it equals the profile of a fresh index over the same rows", () => {
        k = 0; const a = table(); addDay(a, 0); addDay(a, 1); a.getColumnsWithStats("20", "pt-BR");
        for (let d = 2; d < 7; d++) addDay(a, d);
        k = 0; const b = table(); for (let d = 0; d < 7; d++) addDay(b, d);
        const plain = (t: IndexedText) => JSON.parse(JSON.stringify(t.getColumnsWithStats("20", "pt-BR")));
        expect(plain(a)).toEqual(plain(b));
    });
    it("keeps a field the host set after measuring (ingest's modelFormat), across two re-measures", () => {
        const t = table(); addDay(t, 0);
        (col(t, "Total Coletas") as any).modelFormat = "#,0";
        addDay(t, 1);
        expect((col(t, "Total Coletas") as any).modelFormat).toBe("#,0");
        addDay(t, 2);
        expect((col(t, "Total Coletas") as any).modelFormat).toBe("#,0");
    });
    it("a repeated row (a re-delivery) does not drop the profile", () => {
        k = 0; const t = table(); addDay(t, 0);      // with k reset, the first row is exactly ["Domingo", 0, "00:00", 0]
        const first = t.getColumnsWithStats("20", "pt-BR");
        expect(t.addRow(["Domingo", 0, "00:00", 0])).toBe(false);
        expect(t.getColumnsWithStats("20", "pt-BR")).toBe(first);
    });
});
