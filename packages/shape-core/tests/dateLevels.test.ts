// The date-level lexicon: every name the table shipped with still reads the same, the languages it
// gained read as intended, and the Gregorian-year guard keeps a Solar Hijri hierarchy shredded.
import { describe, it, expect } from "vitest";
import {
    DATE_LEVEL_NAMES, DATE_LEVEL_LANGUAGES, DATE_LEVEL_NON_GREGORIAN_LANGUAGES,
    dateLevelPart, dateLevelYearAdmits, type DateLevelPart,
} from "../src/vocab/dateLevels";
import { SUPPORTED_LANGUAGE_CODES, VOCABULARY_LANGUAGE_CODES } from "../src/languages";

// THE TABLE AS IT SHIPPED (23 languages), copied here as a characterization: a host that reads the
// shared lexicon must decide every one of these exactly as it did when the table was its own.
const SHIPPED: Record<string, { part: DateLevelPart; langs: string[] }> = {
    "jaar": { part: "year", langs: ["nl"] }, "kwartaal": { part: "quarter", langs: ["nl"] },
    "maand": { part: "month", langs: ["nl"] }, "dag": { part: "day", langs: ["nl", "sv", "da", "nb"] },
    "jahr": { part: "year", langs: ["de"] }, "quartal": { part: "quarter", langs: ["de"] },
    "monat": { part: "month", langs: ["de"] }, "tag": { part: "day", langs: ["de"] },
    "année": { part: "year", langs: ["fr"] }, "mois": { part: "month", langs: ["fr"] }, "jour": { part: "day", langs: ["fr"] },
    "trimestre": { part: "quarter", langs: ["fr", "es", "pt", "it"] },
    "año": { part: "year", langs: ["es"] }, "mes": { part: "month", langs: ["es"] }, "día": { part: "day", langs: ["es"] },
    "ano": { part: "year", langs: ["pt"] }, "mês": { part: "month", langs: ["pt"] }, "dia": { part: "day", langs: ["pt"] },
    "anno": { part: "year", langs: ["it"] }, "mese": { part: "month", langs: ["it"] }, "giorno": { part: "day", langs: ["it"] },
    "год": { part: "year", langs: ["ru"] }, "месяц": { part: "month", langs: ["ru"] },
    "рік": { part: "year", langs: ["uk"] }, "місяць": { part: "month", langs: ["uk"] },
    "квартал": { part: "quarter", langs: ["ru", "uk"] }, "день": { part: "day", langs: ["ru", "uk"] },
    "rok": { part: "year", langs: ["pl", "cs", "sk"] }, "kwartał": { part: "quarter", langs: ["pl"] },
    "miesiąc": { part: "month", langs: ["pl"] }, "dzień": { part: "day", langs: ["pl"] },
    "čtvrtletí": { part: "quarter", langs: ["cs"] }, "měsíc": { part: "month", langs: ["cs"] }, "den": { part: "day", langs: ["cs"] },
    "štvrťrok": { part: "quarter", langs: ["sk"] }, "mesiac": { part: "month", langs: ["sk"] }, "deň": { part: "day", langs: ["sk"] },
    "år": { part: "year", langs: ["sv", "da", "nb"] }, "kvartal": { part: "quarter", langs: ["sv", "da", "nb"] },
    "månad": { part: "month", langs: ["sv"] }, "måned": { part: "month", langs: ["da", "nb"] },
    "vuosi": { part: "year", langs: ["fi"] }, "vuosineljännes": { part: "quarter", langs: ["fi"] },
    "kuukausi": { part: "month", langs: ["fi"] }, "päivä": { part: "day", langs: ["fi"] },
    "év": { part: "year", langs: ["hu"] }, "negyedév": { part: "quarter", langs: ["hu"] },
    "hónap": { part: "month", langs: ["hu"] }, "nap": { part: "day", langs: ["hu"] },
    "yıl": { part: "year", langs: ["tr"] }, "çeyrek": { part: "quarter", langs: ["tr"] },
    "ay": { part: "month", langs: ["tr"] }, "gün": { part: "day", langs: ["tr"] },
    "έτος": { part: "year", langs: ["el"] }, "τρίμηνο": { part: "quarter", langs: ["el"] },
    "μήνας": { part: "month", langs: ["el"] }, "ημέρα": { part: "day", langs: ["el"] },
    "an": { part: "year", langs: ["ro"] }, "trimestru": { part: "quarter", langs: ["ro"] },
    "lună": { part: "month", langs: ["ro"] }, "zi": { part: "day", langs: ["ro"] },
    "godina": { part: "year", langs: ["hr"] }, "tromjesečje": { part: "quarter", langs: ["hr"] },
    "mjesec": { part: "month", langs: ["hr"] }, "dan": { part: "day", langs: ["hr"] },
    "年": { part: "year", langs: ["ja", "zh"] }, "四半期": { part: "quarter", langs: ["ja"] }, "季度": { part: "quarter", langs: ["zh"] },
    "月": { part: "month", langs: ["ja", "zh"] }, "日": { part: "day", langs: ["ja", "zh"] },
    "연도": { part: "year", langs: ["ko"] }, "분기": { part: "quarter", langs: ["ko"] },
    "월": { part: "month", langs: ["ko"] }, "일": { part: "day", langs: ["ko"] },
};
const SHIPPED_LANGS = Array.from(new Set(Object.values(SHIPPED).flatMap(e => e.langs)));

describe("the date-level lexicon keeps every decision the shipped table made", () => {
    it("every shipped (name, language) reads the same part, and no shipped entry gained a language", () => {
        for (const [name, e] of Object.entries(SHIPPED)) {
            expect(DATE_LEVEL_NAMES[name]?.part, name).toBe(e.part);
            expect([...DATE_LEVEL_NAMES[name].langs], name).toEqual(e.langs);
            for (const lang of e.langs) expect(dateLevelPart(name, lang as any), `${name}/${lang}`).toBe(e.part);
        }
    });

    it("tries the shipped languages first, in the shipped order, so their hierarchies are decided as before", () => {
        expect(DATE_LEVEL_LANGUAGES.slice(0, SHIPPED_LANGS.length)).toEqual(SHIPPED_LANGS);
    });

    it("is read the way the host read it: whole name, trimmed, case-insensitive", () => {
        expect(dateLevelPart("  Jahr ", "de")).toBe("year");
        expect(dateLevelPart("MONAT", "de")).toBe("month");
        expect(dateLevelPart("Jahr", "nl")).toBeNull();          // one language at a time
        expect(dateLevelPart("Jahresumsatz", "de")).toBeNull();  // a level name is the whole name
        expect(dateLevelPart("", "de")).toBeNull();
        expect(dateLevelPart(null, "de")).toBeNull();
    });
});

describe("what the lexicon gained", () => {
    it("every Tier 1 language, and Persian, can name a Year, a Month and a Day", () => {
        const byLang = (lang: string, part: DateLevelPart) =>
            Object.entries(DATE_LEVEL_NAMES).some(([, e]) => e.part === part && e.langs.includes(lang as any));
        for (const lang of VOCABULARY_LANGUAGE_CODES.filter(c => c !== "en")) {
            for (const part of ["year", "month", "day"] as DateLevelPart[]) expect(byLang(lang, part), `${lang} ${part}`).toBe(true);
        }
    });

    it("carries no language the language list does not", () => {
        for (const lang of DATE_LEVEL_LANGUAGES) expect(VOCABULARY_LANGUAGE_CODES as readonly string[]).toContain(lang);
        expect(DATE_LEVEL_LANGUAGES).not.toContain("en");   // English is the host's own test, first
        for (const lang of DATE_LEVEL_NON_GREGORIAN_LANGUAGES) expect(DATE_LEVEL_LANGUAGES).toContain(lang);
    });

    it("stores every key NFC and lower-case, so a lookup can find it", () => {
        for (const k of Object.keys(DATE_LEVEL_NAMES)) {
            expect(k, k).toBe(k.normalize("NFC"));
            expect(k, k).toBe(k.toLowerCase());
        }
    });

    it.each([
        ["Tahun", "id", "year"], ["Bulan", "id", "month"], ["Hari", "id", "day"], ["Kuartal", "id", "quarter"],
        ["Năm", "vi", "year"], ["Tháng", "vi", "month"], ["Ngày", "vi", "day"], ["Quý", "vi", "quarter"],
        ["ปี", "th", "year"], ["เดือน", "th", "month"], ["วัน", "th", "day"], ["ไตรมาส", "th", "quarter"],
        ["السنة", "ar", "year"], ["الشهر", "ar", "month"], ["اليوم", "ar", "day"], ["ربع السنة", "ar", "quarter"],
        ["שנה", "he", "year"], ["חודש", "he", "month"], ["יום", "he", "day"], ["רבעון", "he", "quarter"],
        ["वर्ष", "hi", "year"], ["महीना", "hi", "month"], ["दिन", "hi", "day"], ["तिमाही", "hi", "quarter"],
        ["سال", "fa", "year"], ["ماه", "fa", "month"], ["روز ", "fa", "day"],
    ])("%s is %s's %s", (name, lang, part) => {
        expect(dateLevelPart(name, lang as any)).toBe(part);
    });

    it("lower-cases by the language's own rules: Turkish YIL is yıl, not yil", () => {
        expect(dateLevelPart("YIL", "tr")).toBe("year");
        expect(dateLevelPart("Yıl", "tr")).toBe("year");
        expect(dateLevelPart("GÜN", "tr")).toBe("day");
        // ...and only for Turkish: `yil` is no level name in any language.
        expect(dateLevelPart("yil", "tr")).toBeNull();
    });

    it("Vietnamese is matched unfolded: `thang` (ladder) is not `tháng` (month)", () => {
        expect(dateLevelPart("thang", "vi")).toBeNull();
        expect(dateLevelPart("nam", "vi")).toBeNull();
    });
});

describe("a Gregorian year for the languages whose everyday calendar is not", () => {
    it("admits a Gregorian year and refuses a Solar Hijri, Hijri, Hebrew or Buddhist one", () => {
        for (const lang of ["fa", "ar", "he", "th"]) {
            expect(dateLevelYearAdmits(lang, 2024), lang).toBe(true);
            expect(dateLevelYearAdmits(lang, 1900), lang).toBe(true);
            expect(dateLevelYearAdmits(lang, 2100), lang).toBe(true);
        }
        expect(dateLevelYearAdmits("fa", 1405)).toBe(false);   // the production Persian model
        expect(dateLevelYearAdmits("ar", 1447)).toBe(false);
        expect(dateLevelYearAdmits("he", 5786)).toBe(false);
        expect(dateLevelYearAdmits("th", 2568)).toBe(false);
        expect(dateLevelYearAdmits("fa", null)).toBe(false);
        expect(dateLevelYearAdmits("fa", NaN)).toBe(false);
    });

    it("never restricts a language whose data counts Gregorian years, however old", () => {
        for (const lang of SUPPORTED_LANGUAGE_CODES.filter(c => !["ar", "he", "th"].includes(c))) {
            expect(dateLevelYearAdmits(lang, 1405), lang).toBe(true);
            expect(dateLevelYearAdmits(lang, null), lang).toBe(true);
        }
    });
});
