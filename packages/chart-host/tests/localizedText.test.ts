// Three readers of model- or catalogue-written text that knew only English typography.
//
// - A tick-like label in another locale: "1,2 Mio.", "3 Mrd. €", "4,5 тыс.", "12万", "₹1,20,000",
//   "1 234 zł", "٣٫٥". The axis/colorbar thinning passes skip a row they cannot read as numeric,
//   so colliding labels stayed on screen.
// - The summary's sentence end: a Japanese or Chinese description ends in "。" and got ". Warning:"
//   glued after it.
// - A word start in a chart name: a name whose letters are not ASCII counted every letter as a
//   word break, so a term inside a word ranked as a name match.

import { describe, it, expect } from "vitest";
import { isNumericLabelText } from "../src/legendFit/legendReconcile";
import { composeSummaryText } from "../src/summaryText";
import { filterQualifyRows } from "../src/qualifyFilter";

describe("isNumericLabelText reads a number formatted in any locale", () => {
    it("accepts locale digits, currency signs, group separators and scale words", () => {
        for (const s of [
            "1,2 Mio.", "3 Mrd. €", "12 Mrd", "4,5 тыс.", "7 млн", "2 млрд ₽", "12万", "3,5億", "1.2亿", "5천", "₹1,20,000",
            "1 234 zł", "1 234", "1 234 €", "1'234", "٣٫٥", "२०", "45 kr", "3 Bn", "2 mln",
            "1,5 Md", "10 Tsd.", "300 Kč", "1.000 Ft", "R$ 12",
        ]) {
            expect(isNumericLabelText(s), s).toBe(true);
        }
    });
    it("still rejects words, dates and captions in any language", () => {
        for (const s of [
            "Jan 2026", "1 region unmatched", "Mio.", "万", "Ventas 2024", "12 Regionen", "Q1", "3 Mio. Kunden", "2024年3月",
            "1 234 clientes", "", "+", "€",
        ]) {
            expect(isNumericLabelText(s), s).toBe(false);
        }
    });
});

describe("composeSummaryText ends a sentence in any script's punctuation", () => {
    it("a description ending in a full-width or non-Latin terminal gets a space, not a second full stop", () => {
        for (const [desc, end] of [["売上の推移。", "。"], ["销售额趋势！", "！"], ["هل ارتفعت المبيعات؟", "؟"], ["बिक्री का रुझान।", "।"], ["Ventas…", "…"]]) {
            const out = composeSummaryText(desc, "W");
            expect(out, desc).toBe(desc + " Warning: W");
            expect(out.includes(end + "."), desc).toBe(false);
        }
    });
    it("an unterminated description still gets its full stop", () => {
        expect(composeSummaryText("売上の推移", "W")).toBe("売上の推移. Warning: W");
    });
});

describe("a word start in a chart name is a word start in any script", () => {
    const rows = [
        { name: "Диаграмма Ганта", description: "" },
        { name: "Органиграмма", description: "" },
    ];
    const read = (r: { name: string; description: string }) => r;
    it("a term inside a Cyrillic word is not a word start, so the name that STARTS with it wins alone", () => {
        const res = filterQualifyRows(rows, "ган", read);
        expect(res.tier).toBe("name");
        expect(res.rows.map(r => r.name)).toEqual(["Диаграмма Ганта"]);
    });
    it("a term at a real word start after a space still matches", () => {
        expect(filterQualifyRows(rows, "диаг", read).rows.map(r => r.name)).toEqual(["Диаграмма Ганта"]);
    });
});
