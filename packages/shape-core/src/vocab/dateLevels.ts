// THE DATE-LEVEL LEXICON - what a date hierarchy's levels are called, in every language a model is
// written in (2026-09-25; the table itself dates from 2026-09-11, when it lived in one host).
//
// WHY IT EXISTS. Power BI names the levels of an automatic date hierarchy in the language the MODEL
// was created in, not the reader's UI language: a Dutch model in a Russian report sends
// `...Variation.Datumhiërarchie.{Jaar,Kwartaal,Maand,Dag}`. A host that reassembles a shredded
// hierarchy into one date has to recognise those names, and on production eleven of eleven
// non-English hierarchies never reassembled while every English one did.
//
// WHAT IT IS NOT. It is never read by anything that feeds a saved identity (a schema hash, a stored
// key): a host's English-only level test decides that, on purpose, so a saved chart's identity
// does not move when this table grows. This table is read only by the step that BUILDS a date for a
// fresh generation.
//
// HOW IT IS READ. A level name belongs to one or more languages, and a hierarchy counts only when
// its Year, Month and Day are all names of ONE language - the one-language rule, which is what lets
// short names (`dag`, `ay`, `an`, `dan`, `den`) ship: an English `Year` beside a `Tag` column is not a
// hierarchy. That language is also where the Month level's VALUES are looked up.
//
// A GREGORIAN YEAR, FOR THE LANGUAGES WHOSE EVERYDAY CALENDAR IS NOT. Persian, Arabic, Hebrew and
// Thai data routinely counts years in its own calendar - a production Persian model held year 1405
// (Solar Hijri) beside month numbers 1-6 - and reading those as Gregorian builds dates six centuries
// in the past. A Power BI automatic hierarchy is always Gregorian, so for these languages a
// hierarchy is admitted only when its year is a plausible Gregorian one (`dateLevelYearAdmits`).
// Anything else stays exactly as it was: shredded.
//
// A wrong or missing entry costs nothing: the group stays shredded, as it always did.

import { vocabularyLanguage, type VocabularyLanguageCode } from "../languages";

export type DateLevelPart = "year" | "quarter" | "month" | "day";

export interface DateLevelEntry {
    part: DateLevelPart;
    langs: readonly VocabularyLanguageCode[];
}

const E = (part: DateLevelPart, ...langs: VocabularyLanguageCode[]): DateLevelEntry => ({ part, langs: Object.freeze(langs) });

/**
 * Level name (lower-cased, NFC) -> the part it names and the languages that spell it so. The first
 * block is the table as it shipped for 23 languages; the second block adds the rest of the Tier 1
 * list and the vocabulary-only Persian. Order matters only through `DATE_LEVEL_LANGUAGES`, which
 * keeps the first block's languages first so a hierarchy those already read is decided exactly as
 * before.
 */
export const DATE_LEVEL_NAMES: Readonly<Record<string, DateLevelEntry>> = Object.freeze({
    // Dutch
    "jaar": E("year", "nl"), "kwartaal": E("quarter", "nl"),
    "maand": E("month", "nl"), "dag": E("day", "nl", "sv", "da", "nb"),
    // German
    "jahr": E("year", "de"), "quartal": E("quarter", "de"),
    "monat": E("month", "de"), "tag": E("day", "de"),
    // French
    "année": E("year", "fr"), "mois": E("month", "fr"), "jour": E("day", "fr"),
    "trimestre": E("quarter", "fr", "es", "pt", "it"),
    // Spanish
    "año": E("year", "es"), "mes": E("month", "es"), "día": E("day", "es"),
    // Portuguese
    "ano": E("year", "pt"), "mês": E("month", "pt"), "dia": E("day", "pt"),
    // Italian
    "anno": E("year", "it"), "mese": E("month", "it"), "giorno": E("day", "it"),
    // Russian / Ukrainian
    "год": E("year", "ru"), "месяц": E("month", "ru"),
    "рік": E("year", "uk"), "місяць": E("month", "uk"),
    "квартал": E("quarter", "ru", "uk"), "день": E("day", "ru", "uk"),
    // Polish / Czech / Slovak
    "rok": E("year", "pl", "cs", "sk"), "kwartał": E("quarter", "pl"),
    "miesiąc": E("month", "pl"), "dzień": E("day", "pl"),
    "čtvrtletí": E("quarter", "cs"), "měsíc": E("month", "cs"), "den": E("day", "cs"),
    "štvrťrok": E("quarter", "sk"), "mesiac": E("month", "sk"), "deň": E("day", "sk"),
    // Swedish / Danish / Norwegian
    "år": E("year", "sv", "da", "nb"), "kvartal": E("quarter", "sv", "da", "nb"),
    "månad": E("month", "sv"), "måned": E("month", "da", "nb"),
    // Finnish / Hungarian / Turkish / Greek / Romanian / Croatian
    "vuosi": E("year", "fi"), "vuosineljännes": E("quarter", "fi"),
    "kuukausi": E("month", "fi"), "päivä": E("day", "fi"),
    "év": E("year", "hu"), "negyedév": E("quarter", "hu"),
    "hónap": E("month", "hu"), "nap": E("day", "hu"),
    "yıl": E("year", "tr"), "çeyrek": E("quarter", "tr"),
    "ay": E("month", "tr"), "gün": E("day", "tr"),
    "έτος": E("year", "el"), "τρίμηνο": E("quarter", "el"),
    "μήνας": E("month", "el"), "ημέρα": E("day", "el"),
    "an": E("year", "ro"), "trimestru": E("quarter", "ro"),
    "lună": E("month", "ro"), "zi": E("day", "ro"),
    "godina": E("year", "hr"), "tromjesečje": E("quarter", "hr"),
    "mjesec": E("month", "hr"), "dan": E("day", "hr"),
    // Japanese / Chinese / Korean
    "年": E("year", "ja", "zh"), "四半期": E("quarter", "ja"), "季度": E("quarter", "zh"),
    "月": E("month", "ja", "zh"), "日": E("day", "ja", "zh"),
    "연도": E("year", "ko"), "분기": E("quarter", "ko"),
    "월": E("month", "ko"), "일": E("day", "ko"),

    // ── The rest of the Tier 1 list, and Persian ──
    // Indonesian
    "tahun": E("year", "id"), "kuartal": E("quarter", "id"), "triwulan": E("quarter", "id"),
    "bulan": E("month", "id"), "hari": E("day", "id"),
    // Vietnamese - stored unfolded: its diacritics carry meaning (`tháng` month, `thang` ladder)
    "năm": E("year", "vi"), "quý": E("quarter", "vi"), "tháng": E("month", "vi"), "ngày": E("day", "vi"),
    // Thai
    "ปี": E("year", "th"), "ไตรมาส": E("quarter", "th"), "เดือน": E("month", "th"), "วัน": E("day", "th"),
    // Arabic - with and without the article, since a model may name a level either way
    "السنة": E("year", "ar"), "سنة": E("year", "ar"), "العام": E("year", "ar"), "عام": E("year", "ar"),
    "الربع": E("quarter", "ar"), "ربع": E("quarter", "ar"), "ربع السنة": E("quarter", "ar"),
    "الشهر": E("month", "ar"), "شهر": E("month", "ar"),
    "اليوم": E("day", "ar"), "يوم": E("day", "ar"),
    // Hebrew
    "שנה": E("year", "he"), "רבעון": E("quarter", "he"), "חודש": E("month", "he"), "יום": E("day", "he"),
    // Hindi
    "वर्ष": E("year", "hi"), "साल": E("year", "hi"), "तिमाही": E("quarter", "hi"),
    "महीना": E("month", "hi"), "माह": E("month", "hi"), "दिन": E("day", "hi"),
    // Persian (vocabulary-only). No quarter: the corpus shows none, and a wrong one would fold an
    // unrelated column into the date.
    "سال": E("year", "fa"), "ماه": E("month", "fa"), "روز": E("day", "fa"),
});

/** Every language the lexicon knows, in the order a host tries a hierarchy's candidates. */
export const DATE_LEVEL_LANGUAGES: readonly VocabularyLanguageCode[] = Object.freeze(
    Array.from(new Set(Object.values(DATE_LEVEL_NAMES).flatMap(e => e.langs))));

/** Languages whose data often counts years in a non-Gregorian calendar: Solar Hijri (fa), Hijri
 *  (ar), Hebrew (he), Buddhist Era (th). */
export const DATE_LEVEL_NON_GREGORIAN_LANGUAGES: readonly VocabularyLanguageCode[] = Object.freeze(["fa", "ar", "he", "th"]);

/** The Gregorian years a guarded language's hierarchy may carry. Every one of the four calendars
 *  above is outside this range today (Solar Hijri ~1404, Hijri ~1447, Hebrew ~5786, Buddhist ~2568). */
export const DATE_LEVEL_GREGORIAN_YEAR_MIN = 1900;
export const DATE_LEVEL_GREGORIAN_YEAR_MAX = 2100;

function lowerFor(s: string, lang: VocabularyLanguageCode): string[] {
    const out: string[] = [];
    const l = vocabularyLanguage(lang);
    try {
        // Turkish `YIL` lower-cases to `yıl` only under Turkish rules; everywhere else it is `yil`.
        if (l) out.push(s.toLocaleLowerCase(l.intl));
    } catch { /* an unknown tag - the plain mapping below */ }
    const plain = s.toLowerCase();
    if (!out.includes(plain)) out.push(plain);
    return out;
}

/**
 * The part a level NAME spells in `lang`, or null. The name is trimmed, NFC-normalised and
 * lower-cased by the language's own rules (`YIL` is Turkish `yıl`), then looked up whole: a level
 * name is the whole name, never a word inside one.
 */
export function dateLevelPart(name: string | null | undefined, lang: VocabularyLanguageCode): DateLevelPart | null {
    const s = String(name ?? "").trim().normalize("NFC");
    if (!s) return null;
    for (const k of lowerFor(s, lang)) {
        const e = DATE_LEVEL_NAMES[k];
        if (e && e.langs.includes(lang)) return e.part;
    }
    return null;
}

/**
 * May a hierarchy recognised in `lang` carry this year? True for every language except the four whose
 * data often counts years in another calendar; for those, only a plausible Gregorian year. A host
 * applies this to the year of the row it tests for viability, so a Solar Hijri 1405 leaves the
 * hierarchy shredded instead of building a date in 1405 CE.
 */
export function dateLevelYearAdmits(lang: VocabularyLanguageCode | string, year: number | null | undefined): boolean {
    if (!DATE_LEVEL_NON_GREGORIAN_LANGUAGES.includes(lang as VocabularyLanguageCode)) return true;
    return typeof year === "number" && Number.isFinite(year)
        && year >= DATE_LEVEL_GREGORIAN_YEAR_MIN && year <= DATE_LEVEL_GREGORIAN_YEAR_MAX;
}
