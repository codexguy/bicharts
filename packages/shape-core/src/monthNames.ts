// Localized month-name → 0-based-index lookup. Extracted from the visual's
// dateUnshred.ts so BOTH the profiler (classifyTemporal in indexedText) and the
// visual's date-hierarchy unshredder share ONE implementation — a period axis
// like "Ene 2024" / "Januar 2024" must classify identically to how the unshredder
// reassembles it. dateUnshred.ts now imports these from here (single source).
// Pure + host-agnostic (Intl only), so it lives in shape-core.

import { foldLatin } from "./knownNameKey";
import { SUPPORTED_LANGUAGES, supportedLanguage } from "./languages";

// Cached per locale: building one asks Intl for the 12 long + 12 short names.
const monthLookupCache: Record<string, Record<string, number>> = {};

/** Fold accents and case, and strip spaces / dots / bidi marks, so "Sept.", "sept" and the
 *  RTL-wrapped forms some locales emit all compare equal - and so do "février" and "fevrier",
 *  "août" and "aout": a month column exported without its accents is still that month.
 *
 *  FOLDING IS SAFE HERE BECAUSE IT WAS MEASURED to merge no two months: across the long and short
 *  month names of every supported language, no two months share a folded key, and no folded foreign
 *  name lands on an English key of another month (a test holds both). It is applied to BOTH sides -
 *  the lookup tables are keyed by this function - so every pair that compared equal before still
 *  does. (Weekdays are a different story: Slovak "st" and "št" are Wednesday and Thursday, which is
 *  why the ordinal detector folds only on a miss of its exact key.) */
export function normalizeMonthKey(s: string): string {
    return foldLatin(s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase())
        .replace(/[.‎‏\s]/g, "");
}

/** Build (and cache) a normalized month-name → index map for a locale tag using
 *  Intl. Returns an empty map for an unknown tag, so callers fall back. */
export function monthLookupFor(locale: string): Record<string, number> {
    const key = locale || "en";
    const cached = monthLookupCache[key];
    if (cached) return cached;
    const map: Record<string, number> = {};
    try {
        const long = new Intl.DateTimeFormat(key, { month: "long" });
        const short = new Intl.DateTimeFormat(key, { month: "short" });
        for (let m = 0; m < 12; ++m) {
            const d = new Date(Date.UTC(2020, m, 15)); // mid-month → no tz day-shift
            map[normalizeMonthKey(long.format(d))] = m;
            map[normalizeMonthKey(short.format(d))] = m;
        }
    } catch {
        // Unknown locale tag — leave the map empty.
    }
    monthLookupCache[key] = map;
    return map;
}

// ── EVERY LANGUAGE'S MONTH WORDS AT ONCE ──────────────────────────────────────────────────────
//
// A month written in words belongs to the data, not to the reader's UI: an English-UI workbook holds
// `15 de marzo de 2024` as readily as `March 15, 2024`. So the words a column is read with are the
// UNION of the supported languages' (the same rule every other vocabulary here follows), built from
// the runtime's own calendar data rather than typed in:
//   - the month's standalone long and short names (`März`, `Mär`), and
//   - the same names as they read beside a DAY (`15 марта`, `15 marca`, `15 Μαρτίου`), because a
//     language with a genitive writes the month differently once a number precedes it.
// Chinese, Japanese and Korean write a month as a number and a marker (`3月`, `3월`), Vietnamese as
// `tháng 3`; those are read by the shape that carries the number, not by a word table.
//
// TWO WORDS, TWO LANGUAGES, TWO MONTHS happens (Croatian `lip` is June, Polish `lip` is July), and
// the rule that settles it is the one-language rule: a COLUMN is read in one language, so the reading
// of every word in it comes from the same table. English goes first and wins: a column whose every
// word is an English month word is English. A language's words are accepted beside English ones
// (`Jan 2024`, `März 2024` in one column), because an English label in a non-English report is the
// commonest export there is.

export interface MonthWordReading {
    /** The language code whose table holds the word. */
    lang: string;
    /** 0 = January. */
    month: number;
}

/** Languages whose month is not a word: a number and a marker (zh, ja, ko) or `tháng 3` (vi). */
const NUMBERED_MONTH_LANGUAGES = new Set(["zh", "ja", "ko", "vi"]);

/** Spellings the runtime's data does not carry: English `Sept`, and Austrian German `Jänner`. */
const EXTRA_MONTH_WORDS: ReadonlyArray<readonly [string, string, number]> = [
    ["en", "sept", 8],
    ["de", "jänner", 0],
];

let monthWordTable: Map<string, MonthWordReading[]> | null = null;
let monthWordLanguages: string[] = [];

function buildMonthWordTable(): Map<string, MonthWordReading[]> {
    const table = new Map<string, MonthWordReading[]>();
    const languages: string[] = [];
    const add = (lang: string, word: string, month: number) => {
        const key = normalizeMonthKey(word);
        // A number is not a word (Finnish `3.` beside a day), and one letter names nothing.
        if (key.length < 2 || /^\d+$/.test(key)) return;
        let readings = table.get(key);
        if (!readings) table.set(key, readings = []);
        if (readings.some(r => r.lang === lang && r.month === month)) return;
        // English first, so a reading list starts with the language that wins a collision.
        if (lang === "en") readings.unshift({ lang, month }); else readings.push({ lang, month });
    };
    for (const language of SUPPORTED_LANGUAGES) {
        if (NUMBERED_MONTH_LANGUAGES.has(language.code)) continue;
        try {
            // The Gregorian calendar and Latin digits are named outright: Persian, Arabic and Thai
            // runtimes default to another calendar or digit system, and this table is for Gregorian
            // month NAMES.
            const tag = `${language.intl}-u-ca-gregory-nu-latn`;
            const formats = [
                { month: "long" }, { month: "short" },
                { day: "numeric", month: "long" }, { day: "numeric", month: "short" },
            ].map(o => new Intl.DateTimeFormat(tag, { timeZone: "UTC", ...o } as Intl.DateTimeFormatOptions));
            for (let m = 0; m < 12; ++m) {
                const day = new Date(Date.UTC(2020, m, 15));
                for (const f of formats) {
                    const part = f.formatToParts(day).filter(p => p.type === "month").map(p => p.value).join("");
                    add(language.code, part, m);
                }
            }
            languages.push(language.code);
        } catch {
            // A runtime that does not know the language contributes nothing for it.
        }
    }
    for (const [lang, word, month] of EXTRA_MONTH_WORDS) add(lang, word, month);
    monthWordLanguages = languages;
    return table;
}

/** Every (language, month) a word names, by the folded key `normalizeMonthKey` makes. Empty for a
 *  word no language's calendar uses for a month. */
export function monthWordReadings(word: string): readonly MonthWordReading[] {
    monthWordTable ??= buildMonthWordTable();
    return monthWordTable.get(normalizeMonthKey(word)) ?? [];
}

/** Hebrew writes `in January` as one word: a one-letter preposition glued onto the month (`בינואר`). */
const HEBREW_PREFIXES = "בלמהושכ";
function hebrewPrefixed(key: string, table: Map<string, MonthWordReading[]>): MonthWordReading[] | undefined {
    if (key.length < 3 || !HEBREW_PREFIXES.includes(key[0])) return undefined;
    const he = table.get(key.slice(1))?.filter(r => r.lang === "he");
    return he && he.length ? he : undefined;
}

/**
 * The month (0 = January) each word of ONE column names, keyed by the folded word, or null when no
 * single language reads them all. See the block above for the rule; `locale` breaks a tie between
 * languages that read the column differently (the language of the tag wins, and with none the
 * column stays unread - a guess here would put a date in the wrong month).
 */
export function readMonthWords(words: Iterable<string>, locale?: string): Map<string, number> | null {
    monthWordTable ??= buildMonthWordTable();
    const table = monthWordTable;
    const keys: string[] = [];
    for (const w of words) {
        const k = normalizeMonthKey(w);
        if (!k) return null;
        if (!keys.includes(k)) keys.push(k);
    }
    if (keys.length === 0) return null;
    const readings = keys.map(k => table.get(k) ?? hebrewPrefixed(k, table));
    if (readings.some(r => !r)) return null;

    const inLanguage = (lang: string): number[] | null => {
        const months: number[] = [];
        for (const r of readings) {
            const own = r!.find(x => x.lang === lang) ?? r!.find(x => x.lang === "en");
            if (!own) return null;
            months.push(own.month);
        }
        return months;
    };
    const finish = (months: number[]) => new Map(keys.map((k, i) => [k, months[i]] as const));

    // English first, and English wins: every word an English month word.
    if (readings.every(r => r!.some(x => x.lang === "en"))) return finish(inLanguage("en")!);

    const candidates = new Map<string, number[]>();
    for (const lang of monthWordLanguages) {
        if (lang === "en") continue;
        const months = inLanguage(lang);
        if (months) candidates.set(lang, months);
    }
    if (candidates.size === 0) return null;
    const all = [...candidates.values()];
    if (all.every(m => m.every((v, i) => v === all[0][i]))) return finish(all[0]);
    const own = supportedLanguage(String(locale ?? "").split(/[-_]/)[0])?.code;
    const chosen = own ? candidates.get(own) : undefined;
    return chosen ? finish(chosen) : null;
}
