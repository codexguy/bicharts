// The calendar words of the other languages: the year and the cycles, read where the English words find
// nothing. Positives in every script, the left-out words staying out, and the two readers that use them.
import { describe, it, expect } from "vitest";
import {
    YEAR_WORDS, CYCLE_WORDS, CYCLE_MEMBERS, UNFOLDED, localizedYearWordIn, localizedCycleIn,
} from "../src/vocab/calendarWords";
import { VOCABULARY_LANGUAGE_CODES } from "../src/languages";
import { isOrdinalFriendlyName } from "../src/ordinalDetector";
import { classifyTemporal } from "../src/indexedText";

describe("the year words", () => {
    it.each([
        ["Jahr"], ["Geschäftsjahr"], ["Año"], ["Ano fiscal"], ["Anno"], ["Rok"], ["Räkenskapsår"], ["Vuosi"],
        ["Év"], ["Yıl"], ["Godina"], ["Tahun"], ["Năm"], ["Год"], ["Рік"], ["Έτος"], ["年度"], ["年份"],
        ["회계연도"], ["السنة"], ["שנה"], ["वर्ष"], ["سال"],
    ])("%s names a year", (name) => {
        expect(localizedYearWordIn(name), name).not.toBeNull();
    });

    it("an English year name is the English test's, never this one's", () => {
        expect(localizedYearWordIn("Year")).toBeNull();
        expect(localizedYearWordIn("FiscalYear")).toBeNull();
    });

    it("matches the fold-colliding words only as written", () => {
        expect(localizedYearWordIn("AR")).toBeNull();          // accounts receivable, not Swedish `år`
        expect(localizedYearWordIn("EV Count")).toBeNull();    // electric vehicles, not Hungarian `év`
        expect(localizedYearWordIn("År")).not.toBeNull();
    });

    it("leaves out the words the screen and the replay found", () => {
        expect(localizedYearWordIn("An")).toBeNull();          // ro: English article
        expect(localizedYearWordIn("年")).toBeNull();           // one Han character is a morpheme
        expect(localizedYearWordIn("Ejercicio")).toBeNull();   // fiscal year AND exercise
    });
});

describe("the cycle words", () => {
    it.each([
        ["Stunde", "hour"], ["Heure", "hour"], ["Hora", "hour"], ["Godzina", "hour"], ["Час", "hour"],
        ["小时", "hour"], ["ساعة", "hour"], ["Wochentag", "weekday"], ["曜日", "weekday"], ["요일", "weekday"],
        ["Monat", "month"], ["Mes", "month"], ["Mês", "month"], ["Miesiąc", "month"], ["Tháng", "month"],
        ["Месяц", "month"], ["月份", "month"], ["الشهر", "month"], ["ماه", "month"],
        ["Quartal", "quarter"], ["Trimestre", "quarter"], ["Kwartał", "quarter"], ["四半期", "quarter"],
        ["분기", "quarter"], ["Kalenderwoche", "week"], ["Semana", "week"], ["Неделя", "week"], ["สัปดาห์", "week"],
        ["Jahreszeit", "season"], ["Temporada", "season"], ["季節", "season"],
    ])("%s names the %s", (name, concept) => {
        expect(localizedCycleIn(name)?.concept, name).toBe(concept);
    });

    it("no opinion when a name carries two different cycles", () => {
        expect(localizedCycleIn("Stunde der Woche")).toBeNull();
    });

    it("leaves out the words the screen and the replay found", () => {
        expect(localizedCycleIn("Temperatuur")).toBeNull();   // nl `uur` read every Dutch word ending in it
        expect(localizedCycleIn("Aurora")).toBeNull();        // hu `óra`, folded, ends English words
        expect(localizedCycleIn("Saat Ini")).toBeNull();      // tr `saat` is Indonesian "moment"
        expect(localizedCycleIn("Luna")).toBeNull();          // ro month, and a name
        expect(localizedCycleIn("Time")).toBeNull();          // da/nb hour is English "time"
        expect(localizedCycleIn("AY")).toBeNull();            // tr month, English "academic year"
        expect(localizedCycleIn("시간")).toBeNull();           // an hour AND a duration
        expect(localizedCycleIn("월")).toBeNull();             // one Hangul syllable
    });

    it("every concept has its natural number of members", () => {
        expect(Object.keys(CYCLE_WORDS).sort()).toEqual(Object.keys(CYCLE_MEMBERS).sort());
        expect(CYCLE_MEMBERS).toEqual({ hour: 24, weekday: 7, month: 12, quarter: 4, week: 53, season: 4 });
    });
});

describe("the tables", () => {
    const all = [YEAR_WORDS, ...Object.values(CYCLE_WORDS)];

    it("carry only languages the language list does, and never English", () => {
        for (const t of all) for (const lang of Object.keys(t)) {
            expect(VOCABULARY_LANGUAGE_CODES as readonly string[], lang).toContain(lang);
            expect(lang).not.toBe("en");
        }
    });

    it("store every word NFC and lower-case, and every UNFOLDED word is in a table", () => {
        const words = all.flatMap(t => Object.values(t).flatMap(w => w ?? []));
        for (const w of words) {
            expect(w, w).toBe(w.normalize("NFC"));
            expect(w, w).toBe(w.toLowerCase());
        }
        for (const u of UNFOLDED) expect(words, u).toContain(u);
    });
});

describe("the readers that use them", () => {
    it("an integer Monat or Stunde is an ordered axis, as Month and Hour are", () => {
        for (const n of ["Monat", "Stunde", "Mes", "Quartal", "Kalenderwoche", "Año"]) expect(isOrdinalFriendlyName(n), n).toBe(true);
        expect(isOrdinalFriendlyName("Umsatz")).toBe(false);
        expect(isOrdinalFriendlyName("Temperatuur")).toBe(false);
    });

    it("a gappy integer year column named in another language is a time axis", () => {
        const base = { dataType: "Integer", isMeasure: false, distinctCount: 4, minNum: 2000, maxNum: 2012, sampleValues: [2000, 2004, 2008, 2012] as any };
        expect(classifyTemporal({ ...base, name: "Jahr" })).toBe(true);
        expect(classifyTemporal({ ...base, name: "Año" })).toBe(true);
        expect(classifyTemporal({ ...base, name: "Umsatz" })).toBe(false);
    });
});
