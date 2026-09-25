// CALENDAR WORDS IN A COLUMN NAME - the year and the cycles, in every language a model is written in
// (2026-09-25).
//
// WHAT READS THEM. A column name that says "year" lets an integer column of years be a time axis even
// when its values are gappy (a year every four years); a name that says hour, weekday, month,
// quarter, week or season marks an integer column as an ordered axis and a cyclical one - the
// question a circular heatmap, a polar chart or a rose asks when the values alone cannot answer it
// (an integer `Monat` 1-12 looks like any other small integer). The English words stay where they
// were (`TEMPORAL_YEAR_WORDS`, `ORDINAL_NAME_TOKENS`, and the server's cycle table) and are read
// first; these are the other languages', read only where the English words find nothing.
//
// ONE SOURCE, TWO READERS. The server reads the same words for its cycle and year tests; its copy is
// GENERATED from the block between the parity markers below, and a parity test fails when the two
// differ. Edit here, then regenerate.
//
// HOW A WORD IS READ (`calendarWordIn`). Through the name reader's views for the WORD's language: a
// whole word, folded; the end of a compound in the compounding languages (`Geschäftsjahr`,
// `Kalenderwoche`); the end of a Hangul compound (`회계연도`); a glued article in Arabic and Hebrew
// (`السنة`); a substring of a Han/Kana/Thai run of two characters or more. A word listed under
// `UNFOLDED` is matched as written, never folded: its fold is an English abbreviation (`år` -> `ar`,
// accounts receivable; `év` -> `ev`, electric vehicle).
//
// WHAT IS LEFT OUT, AND WHY - each is a word whose false reading costs more than the miss:
//   * words that are English words or common column abbreviations: da/nb `time` (hour), id `jam`
//     (hour), hr `sat` (hour; SAT scores), tr `ay` (month; AY = academic year), ro `an` (year),
//     ro `luna` (month; a name, and "moon" in half the list); and nl `week`, which IS English;
//   * nl `uur` (hour): three letters in a compounding language, so every Dutch word ending in it
//     reads as an hour - a temperature column (`Temperatuur`) did;
//   * words common in another listed language with another meaning: tr `saat` (hour) is
//     Indonesian "moment" (`Saat Ini`, "current"); hr `sati` (hours) is a duration more often than a
//     time of day;
//   * a word whose fold ends many English words, in a compounding language, is matched unfolded:
//     hu `óra` (hour) - `Aurora`, `Pandora`, `Fedora`;
//   * the words for DAY: `tag`, `dag`, `dia`, `dan`, `den`, `nap` collide with English and with each
//     other, and a day count is not a cycle;
//   * words that mean something else as often: es/pt `estación`/`estação` (season AND station), es
//     `ejercicio`/fr `exercice` (fiscal year AND exercise), ar `عام` (year AND public/general), ja/ko
//     `時間`/`시간` (an hour AND a duration);
//   * single characters in Han, Kana and Thai (`年`, `月`, `週`, `ปี` - one Han character is a
//     morpheme, and `ปี` sits inside unrelated Thai words), and single Hangul syllables (`월`, `주`).

import { matchNameToken, readName, wordEndsWith, COMPOUND_MIN_STEM, type NameTokenView } from "../nameReader";
import { vocabularyLanguage, type VocabularyLanguageCode } from "../languages";

/** The cycles a calendar name can name, each with its natural number of members. */
export type CycleConcept = "hour" | "weekday" | "month" | "quarter" | "week" | "season";

/** Members of each cycle - the ceiling a cyclical axis of that kind cannot exceed. */
export const CYCLE_MEMBERS: Readonly<Record<CycleConcept, number>> = Object.freeze({
    hour: 24, weekday: 7, month: 12, quarter: 4, week: 53, season: 4,
});

type Vocab = Partial<Record<VocabularyLanguageCode, readonly string[]>>;

/* parity:calendar-words:begin */
export const YEAR_WORDS: Vocab = {
    nl: ["jaar"], de: ["jahr"], fr: ["année"], es: ["año"], pt: ["ano"], it: ["anno"],
    pl: ["rok"], cs: ["rok"], sk: ["rok"], sv: ["år"], da: ["år"], nb: ["år"], fi: ["vuosi"],
    hu: ["év"], tr: ["yıl"], ro: ["anul"], hr: ["godina"], id: ["tahun"], vi: ["năm"],
    ru: ["год"], uk: ["рік"], el: ["έτος"], zh: ["年份", "年度"], ja: ["年度"], ko: ["연도", "년도"],
    ar: ["سنة"], he: ["שנה"], hi: ["वर्ष", "साल"], th: ["ปีงบประมาณ"], fa: ["سال"],
};

export const CYCLE_WORDS: Readonly<Record<CycleConcept, Vocab>> = {
    hour: {
        de: ["stunde"], fr: ["heure"], es: ["hora"], pt: ["hora"], it: ["ora"],
        pl: ["godzina"], cs: ["hodina"], sk: ["hodina"], sv: ["timme"], fi: ["tunti"], hu: ["óra"],
        ro: ["ora"], vi: ["giờ"], ru: ["час"], uk: ["година"], el: ["ώρα"],
        zh: ["小时"], ar: ["ساعة"], he: ["שעה"], hi: ["घंटा"], th: ["ชั่วโมง"], fa: ["ساعت"],
    },
    weekday: {
        nl: ["weekdag"], de: ["wochentag"], sv: ["veckodag"], da: ["ugedag"], nb: ["ukedag"],
        fi: ["viikonpäivä"], zh: ["星期"], ja: ["曜日"], ko: ["요일"],
    },
    month: {
        nl: ["maand"], de: ["monat"], fr: ["mois"], es: ["mes"], pt: ["mês"], it: ["mese"],
        pl: ["miesiąc"], cs: ["měsíc"], sk: ["mesiac"], sv: ["månad"], da: ["måned"], nb: ["måned"],
        fi: ["kuukausi"], hu: ["hónap"], hr: ["mjesec"], id: ["bulan"], vi: ["tháng"],
        ru: ["месяц"], uk: ["місяць"], el: ["μήνας"], zh: ["月份"], ar: ["شهر"], he: ["חודש"],
        hi: ["महीना", "माह"], th: ["เดือน"], fa: ["ماه"],
    },
    quarter: {
        nl: ["kwartaal"], de: ["quartal"], fr: ["trimestre"], es: ["trimestre"], pt: ["trimestre"],
        it: ["trimestre"], pl: ["kwartał"], cs: ["čtvrtletí"], sk: ["štvrťrok"], sv: ["kvartal"],
        da: ["kvartal"], nb: ["kvartal"], fi: ["vuosineljännes"], hu: ["negyedév"], tr: ["çeyrek"],
        ro: ["trimestru"], hr: ["tromjesečje"], id: ["kuartal", "triwulan"], vi: ["quý"],
        ru: ["квартал"], uk: ["квартал"], el: ["τρίμηνο"], zh: ["季度"], ja: ["四半期"], ko: ["분기"],
        ar: ["ربع"], he: ["רבעון"], hi: ["तिमाही"], th: ["ไตรมาส"],
    },
    week: {
        de: ["woche"], fr: ["semaine"], es: ["semana"], pt: ["semana"], it: ["settimana"],
        pl: ["tydzień"], cs: ["týden"], sk: ["týždeň"], sv: ["vecka"], da: ["uge"], nb: ["uke"],
        fi: ["viikko"], hu: ["hét"], tr: ["hafta"], ro: ["săptămână"], hr: ["tjedan"], id: ["minggu"],
        vi: ["tuần"], ru: ["неделя"], uk: ["тиждень"], el: ["εβδομάδα"], ar: ["أسبوع"], he: ["שבוע"],
        hi: ["सप्ताह"], th: ["สัปดาห์"], fa: ["هفته"],
    },
    season: {
        nl: ["seizoen"], de: ["jahreszeit"], fr: ["saison"], es: ["temporada"], it: ["stagione"],
        pl: ["sezon"], cs: ["sezóna"], sk: ["sezóna"], sv: ["säsong", "årstid"], da: ["sæson", "årstid"],
        nb: ["sesong", "årstid"], fi: ["vuodenaika"], hu: ["évszak"], tr: ["mevsim"], ro: ["anotimp"],
        vi: ["mùa"], ru: ["сезон"], uk: ["сезон"], el: ["εποχή"], zh: ["季节"], ja: ["季節"], ko: ["계절"],
        ar: ["موسم"], he: ["עונה"], hi: ["मौसम"], th: ["ฤดู"], fa: ["فصل"],
    },
};

/** Words matched as written, never folded: the fold of `år` and `év` is an English abbreviation
 *  (AR, EV), of `hét` the Dutch "the", and `óra` without its accent ends `Aurora` and `Pandora`. */
export const UNFOLDED: readonly string[] = ["år", "év", "hét", "óra"];
/* parity:calendar-words:end */

/** Where a calendar word was found. */
export interface CalendarWordHit {
    lang: VocabularyLanguageCode;
    word: string;
    view: NameTokenView;
}

function unfoldedMatch(name: string, word: string, lang: VocabularyLanguageCode): NameTokenView | null {
    const l = vocabularyLanguage(lang);
    if (!l) return null;
    const w = word.normalize("NFC").toLowerCase();
    const words = readName(name).words;
    if (words.includes(w)) return "word";
    if (l.compounds && words.some(x => wordEndsWith(x, w, COMPOUND_MIN_STEM))) return "suffix";
    return null;
}

/** The first word of `vocab` the name carries, in list order (language, then word), or null. */
export function calendarWordIn(name: string | null | undefined, vocab: Vocab): CalendarWordHit | null {
    const n = String(name ?? "");
    if (!n.trim()) return null;
    for (const [lang, words] of Object.entries(vocab) as Array<[VocabularyLanguageCode, readonly string[]]>) {
        for (const word of words) {
            const view = UNFOLDED.includes(word) ? unfoldedMatch(n, word, lang) : matchNameToken(n, word, lang);
            if (view) return { lang, word, view };
        }
    }
    return null;
}

/** Does the name carry another language's word for YEAR? English is the caller's own test, first. */
export function localizedYearWordIn(name: string | null | undefined): CalendarWordHit | null {
    return calendarWordIn(name, YEAR_WORDS);
}

/** Which cycle the name names in another language, or null. English is the caller's own test. When
 *  a name carries words of two cycles (a quarter-hour bucket), the answer is null - no opinion,
 *  exactly as for English. */
export function localizedCycleIn(name: string | null | undefined): { concept: CycleConcept; hit: CalendarWordHit } | null {
    let found: { concept: CycleConcept; hit: CalendarWordHit } | null = null;
    for (const concept of Object.keys(CYCLE_WORDS) as CycleConcept[]) {
        const hit = calendarWordIn(name, CYCLE_WORDS[concept]);
        if (!hit) continue;
        if (found && found.concept !== concept) return null;
        found = { concept, hit };
    }
    return found;
}
