import { describe, expect, it } from "vitest";
import { classifyTemporal } from "../src/indexedText";
import { measureCadence, parseTemporalPoint } from "../src/cadence";
import { splitMonthPeriod } from "../src/monthNames";
import { ingest } from "../src/ingest";

// A MONTH AXIS IN ANOTHER LANGUAGE IS A MONTH AXIS, WITH NO LOCALE NAMED.
//
// `Januar 2024`, `enero de 2024`, `janvier 2024`, `январь 2024 г.`, `2024年1月`, `2024년 1월` were a time
// axis only when the caller named the locale (and for Spanish `enero de 2024`, Japanese, Korean and
// Russian never). The month words of every supported language are one table now, read in ONE language
// per column; what must not move is every column English (or the named locale) already decided.

const isTemporal = (values: string[], locale?: string) =>
    classifyTemporal({ dataType: "String", name: "Period", isMeasure: false, distinctCount: values.length, sampleValues: values, locale });

/** The twelve months of 2024 as the runtime writes them in a language. */
function months(lang: string, options: Intl.DateTimeFormatOptions): string[] {
    const f = new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, { timeZone: "UTC", year: "numeric", ...options });
    return Array.from({ length: 12 }, (_, m) => f.format(new Date(Date.UTC(2024, m, 1))));
}

describe("splitMonthPeriod reads the shape and leaves the word to the month table", () => {
    const cases: Array<[string, unknown]> = [
        ["Januar 2024", { year: 2024, word: "Januar" }],
        ["2024 janvier", { year: 2024, word: "janvier" }],
        ["janv. 2024", { year: 2024, word: "janv" }],
        ["Ene-2024", { year: 2024, word: "Ene" }],
        ["enero de 2024", { year: 2024, word: "enero" }],
        ["janeiro de 2024", { year: 2024, word: "janeiro" }],
        ["январь 2024 г.", { year: 2024, word: "январь" }],
        ["styczeń 2024 r.", { year: 2024, word: "styczeń" }],
        ["2024年1月", { year: 2024, month: 1 }],
        ["2024年01月", { year: 2024, month: 1 }],
        ["2024년 12월", { year: 2024, month: 12 }],
        ["٢٠٢٤ يناير", { year: 2024, word: "يناير" }],
    ];
    for (const [text, expected] of cases) {
        it(JSON.stringify(text), () => expect(splitMonthPeriod(text)).toEqual(expected));
    }

    it("refuses what is not a year and a word", () => {
        for (const text of ["Ene 24", "enero", "2024", "2024 2025", "5 enero 2024", "Widgets Pro 2024", "2024年13月", "2024年1月5日", "", "  "]) {
            expect(splitMonthPeriod(text), text).toBeNull();
        }
    });
});

describe("a column of twelve months in a language is a time axis with no locale", () => {
    const languages = ["de", "fr", "es", "pt", "it", "nl", "pl", "cs", "sv", "da", "nb", "fi", "hu", "tr", "ro", "hr", "id", "ru", "uk", "el", "ar", "hi"];
    for (const lang of languages) {
        for (const style of ["long", "short"] as const) {
            it(`${lang} ${style}`, () => {
                const values = months(lang, { month: style });
                expect(isTemporal(values), values[0]).toBe(true);
                // And measurable: the cadence reader finds twelve months without being told the language.
                const cadence = measureCadence(values);
                expect(cadence?.grain, values.join(" | ")).toBe("month");
                expect(cadence?.points).toBe(12);
            });
        }
    }

    it("the Spanish and Portuguese `de`, and the Russian year marker", () => {
        expect(isTemporal(["enero de 2024", "febrero de 2024", "marzo de 2024", "abril de 2024"])).toBe(true);
        expect(isTemporal(["janeiro de 2024", "fevereiro de 2024", "março de 2024", "abril de 2024"])).toBe(true);
        expect(isTemporal(["январь 2024 г.", "февраль 2024 г.", "март 2024 г.", "апрель 2024 г."])).toBe(true);
        expect(parseTemporalPoint("enero de 2024")!.iso).toBe("2024-01-01");
        expect(parseTemporalPoint("январь 2024 г.")!.iso).toBe("2024-01-01");
        expect(parseTemporalPoint("март 2024 г.")!.iso).toBe("2024-03-01");
    });

    it("the CJK month marker", () => {
        const ja = Array.from({ length: 12 }, (_, m) => `2024年${m + 1}月`);
        const ko = Array.from({ length: 12 }, (_, m) => `2024년 ${m + 1}월`);
        for (const values of [ja, ko, ["2024年1月", "2024年2月"]]) {
            expect(isTemporal(values), values[0]).toBe(true);
        }
        expect(measureCadence(ja)?.grain).toBe("month");
        expect(parseTemporalPoint("2024년 3월")!.iso).toBe("2024-03-01");
    });

    it("a straggler row does not sink it (the same 80% floor)", () => {
        const values = months("de", { month: "long" }).concat(["Gesamt"]);
        expect(isTemporal(values)).toBe(true);
        expect(isTemporal(months("de", { month: "long" }).slice(0, 3).concat(["Gesamt", "Summe", "Plan"]))).toBe(false);
    });
});

describe("what stays as it was", () => {
    it("English month periods are decided exactly as before, dotted ones included", () => {
        expect(isTemporal(["Jan 2024", "Feb 2024", "Mar 2024"])).toBe(true);
        expect(isTemporal(["January 2024", "February 2024", "March 2024"])).toBe(true);
        // The English pattern has never taken a dot after the abbreviation; an English-only column is
        // not made temporal by the other languages' tables.
        expect(isTemporal(["Jan. 2024", "Feb. 2024", "Mar. 2024", "Apr. 2024"])).toBe(false);
    });

    it("two labels that happen to be another language's month abbreviation are not a month axis", () => {
        // `pro` is a Croatian month, `set` a Portuguese and Italian one, `out` a Portuguese one.
        expect(isTemporal(["Pro 2024", "Pro 2025"])).toBe(false);
        expect(isTemporal(["Set 2024", "Out 2024"])).toBe(false);
        expect(isTemporal(["Set 2024", "Set 2025", "Set 2026"])).toBe(false);
        expect(isTemporal(["Widgets 2024", "Gadgets 2024", "Gizmos 2024"])).toBe(false);
    });

    it("a two-digit year is still not a year", () => {
        expect(isTemporal(["Ene 24", "Feb 24", "Mar 24", "Abr 24"])).toBe(false);
    });

    it("a named locale reads exactly what it always read", () => {
        expect(isTemporal(["Ene 2024", "Feb 2024", "Mar 2024"], "es-ES")).toBe(true);
        expect(isTemporal(["Januar 2024", "Februar 2024"], "de-DE")).toBe(true);
        // A locale outside the supported list keeps its own Intl names.
        expect(isTemporal(["януари 2024", "февруари 2024"], "bg-BG")).toBe(true);
    });

    it("the quarter and week labels are unaffected", () => {
        expect(isTemporal(["T1 2024", "T2 2024", "T3 2024"])).toBe(true);
        expect(isTemporal(["KW 12/2024", "KW 13/2024", "KW 14/2024"])).toBe(true);
    });
});

describe("through ingest, a German month column is a time axis with a cadence", () => {
    it("reads the column as a monthly axis", () => {
        const names = months("de", { month: "long" });
        const csv = "Monat,Umsatz\n" + names.map((n, i) => `${n},${100 + i}`).join("\n");
        const got = ingest({ kind: "csv", text: csv }, { dedup: false });
        const period = got.columns.find(c => c.name === "Monat")!;
        expect(period.dataType).toBe("String");
        expect(period.isTemporal).toBe(true);
        expect(period.temporalCadence?.grain).toBe("month");
        expect(period.temporalCadence?.points).toBe(12);
    });
});
