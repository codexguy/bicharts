// ONE READING OF A NAME, IN EVERY SCRIPT (2026-09-24).
//
// Every vocabulary check in this package reads a column name through here: the year-name test,
// the identifier test, the ordinal-friendly test, the geo column-name hints, the additivity
// reader's word form. They used to share `nameWords`, which was right about English and blind to
// everything else:
//
//   * camelCase was `[a-z][A-Z]`, so `СредняяЦена` and `ÄpfelÖl` stayed one word;
//   * only `_ - . /` and whitespace separated words, so an en dash, a degree sign, an ideographic
//     comma or a full-width bracket became part of a word (`Umsatz – Summe` had a word `–`);
//   * nothing folded `ł ı ø đ ð` (they have no Unicode decomposition), so tokens stored folded -
//     `udzial`, `sicaklik` - could never meet `Udział`, `Sıcaklık`.
//
// THE WORD. Letters, combining marks and digits in any script, `[\p{L}\p{M}\p{N}]`, separated by
// whitespace, `_ - . /`, and any NON-ASCII character that is none of those. The `\p{M}` is not
// optional - a Devanagari or Thai word is letters AND the vowel signs between them, and a
// letters-only class splits `मुंबई` at every sign. ASCII punctuation other than the four
// separators stays attached to its word, exactly as before, so every all-ASCII name reads as it
// did (see `nameWords` for the replay that decided it).
//
// THE CAMEL BOUNDARY. A lower-case letter or a digit followed by an upper-case one, in any cased
// script (`\p{Ll}` / `\p{Nd}` then `\p{Lu}`). Deliberately NOT upper-then-upper-lower (`XMLHttp` stays
// one word, as it always has) and NOT letter-to-digit (`FY2024` is still not a year name - the
// server pins the same boundary).
//
// THE FOLD. Length-preserving, one UTF-16 unit in and one out, because the additivity reader matches
// on the folded text and slices the ORIGINAL at the same offset:
//   * a letter whose decomposition is a base plus combining diacriticals (U+0300-U+036F) folds to
//     the base - `é` -> `e`, `Ś` -> `S`. Marks outside that block are kept: the Japanese voicing mark
//     changes the word (`が` is not `か`), and so do Hebrew and Arabic points;
//   * `ł ı ø đ ð` (and capitals) fold to `l i o d d` - they carry their stroke inside the letter
//     and no normalization form removes it;
//   * Arabic-Indic, extended Arabic-Indic, Devanagari, Thai and full-width digits read as `0-9`;
//   * full-width Latin letters read as ASCII (`Ｑ１` -> `Q1`).
// Expansions (`ß` -> `ss`, `æ` -> `ae`) are NOT here: they change the length. `normalizePlaceName`
// makes them, because a place-name KEY has no offset to preserve.
//
// FOLDING IS A VIEW, NOT A REPLACEMENT. Vietnamese diacritics carry meaning (`tháng` month,
// `thang` ladder), so a vocabulary in a fold-sensitive language matches the UNFOLDED words.
// `readName` returns both.
//
// THE VIEWS a vocabulary needs beyond whole words, each for a script or language property that
// makes a whole-word test blind:
//   * compound suffix - de, nl, sv, da, nb, fi, hu glue a concept onto the END of a word
//     (`Durchschnittstemperatur`), and so does Korean, whose compound nouns are written without
//     spaces with the head last (`매출실적`) - the same view for a Hangul token, with a stem of two
//     syllables;
//   * glued prefix    - ar and he glue the article and one-letter particles onto the FRONT
//     (`الإيرادات`, `והכנסות`);
//   * substring       - zh, ja, th write words with no spaces between them (`平均温度`).
// A caller picks the view by the TOKEN's language (`matchNameToken`); none of them is keyed on the
// reader's UI culture, because the data's language is not the UI's.
//
// A C# twin reads the SAME fixture file (tests/fixtures/name-reader.json) and must tokenise it
// identically; that file, not this comment, is the contract.

import { vocabularyLanguage, type VocabularyLanguageCode } from "./languages";

/** Letters that carry their mark inside the glyph, so no normalization form removes it. */
const STROKE_FOLD: Readonly<Record<string, string>> = {
    "ł": "l", "Ł": "L", "ı": "i", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ð": "d", "Ð": "D",
};

/** The zero of each decimal-digit run read as ASCII: Arabic-Indic, extended Arabic-Indic (the
 *  Persian forms that appear in Arabic data), Devanagari, Thai, full-width. */
const DIGIT_ZEROS: readonly number[] = [0x0660, 0x06F0, 0x0966, 0x0E50, 0xFF10];

const COMBINING_DIACRITICAL = /[\u0300-\u036F]/g;

function foldChar(ch: string): string {
    const stroke = STROKE_FOLD[ch];
    if (stroke) return stroke;
    const cp = ch.codePointAt(0)!;
    for (const z of DIGIT_ZEROS) if (cp >= z && cp <= z + 9) return String.fromCharCode(0x30 + cp - z);
    if ((cp >= 0xFF21 && cp <= 0xFF3A) || (cp >= 0xFF41 && cp <= 0xFF5A)) return String.fromCharCode(cp - 0xFEE0);
    const d = ch.normalize("NFD").replace(COMBINING_DIACRITICAL, "");
    return d.length === 1 ? d : ch;
}

/**
 * THE FOLD - see the header. `Température` -> `Temperature`, `Udział` -> `Udzial`,
 * `Sıcaklık` -> `Sicaklik`, `٢٠٢٤` -> `2024`. Length-preserving in UTF-16 units: a character is
 * replaced only by a single BMP character, and anything else - a surrogate pair, a Hangul
 * syllable, a letter with a mark outside the diacritical block - passes through untouched.
 */
export function foldName(s: string): string {
    if (!s) return s ?? "";
    let out = "";
    for (const ch of s) out += foldChar(ch);
    return out;
}

const CAMEL = /([\p{Ll}\p{Nd}])(\p{Lu})/gu;
const ASCII_SEPARATORS = /[_\-./]+/g;
const NON_ASCII_NON_WORD = /[^\p{L}\p{M}\p{N}\x00-\x7F]/gu;

/**
 * The WORDS in a column name, lower-cased and unfolded: "OlympicYear" -> ["olympic", "year"],
 * "fiscal_year" -> ["fiscal", "year"], "СредняяЦена" -> ["средняя", "цена"],
 * "Umsatz – Summe" -> ["umsatz", "summe"], "平均温度" -> ["平均温度"] (one run - see
 * `unsegmentedRuns`).
 *
 * WHAT SEPARATES, EXACTLY: whitespace, the four ASCII separators `_ - . /`, and every character
 * OUTSIDE ASCII that is not a letter, mark or number (an en dash, a degree sign, an ideographic
 * comma, full-width brackets). Other ASCII punctuation stays attached to its word, as it always
 * has: `Sales (USD)` still reads `sales` + `(usd)`. That is a measured choice, not an oversight -
 * splitting there too moved four English verdicts in a replay of every column name ever bound,
 * all of them a unit in brackets read as a word (`Permit Sub-Limit (t CO2e/yr)` became a year
 * name, `Net Sales (Wk)` an ordinal one). Widening it is a decision with its own replay.
 */
export function nameWords(name: string): string[] {
    if (!name) return [];
    return String(name)
        .normalize("NFC")
        .replace(CAMEL, "$1 $2")
        .replace(ASCII_SEPARATORS, " ")
        .replace(NON_ASCII_NON_WORD, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0);
}

/**
 * LETTER RUNS: a name cut at everything that is not a letter or a mark - digits and all punctuation
 * included - after an optional camelCase split, lower-cased. The boundary some older readers were
 * built on (`[^a-z]+` after lower-casing), in every script: `Längengrad` is one run where the ASCII
 * split made `l` + `ngengrad`, and `Широта` is a run where the ASCII split left nothing. An all-ASCII
 * name reads exactly as it did under the ASCII split. The server's twin is `NameReader.Tokens`
 * with digits out of words.
 */
export function nameLetterRuns(name: string, opts: { camel?: boolean } = {}): string[] {
    if (!name) return [];
    let s = String(name).normalize("NFC");
    if (opts.camel) s = s.replace(CAMEL, "$1 $2");
    return s.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(t => t.length > 0);
}

export interface NameReading {
    /** Lower-cased words, NFC, unfolded - for a fold-sensitive language's vocabulary. */
    words: string[];
    /** The same words folded (`foldName`) - what every other vocabulary matches. Same length and
     *  order as `words`. */
    folded: string[];
}

/** Both views of a name at once.
 *
 *  The folded view folds the NAME and then reads it, rather than folding each word: lower-casing
 *  first turns the Turkish `İ` into `i` plus a combining dot, which no per-letter fold can remove,
 *  while folding first gives a plain `I` that lower-cases to `i`. The fold keeps case, letters stay
 *  letters and digits stay digits, so both readings split at the same places. */
export function readName(name: string): NameReading {
    const words = nameWords(name);
    const folded = nameWords(foldName(String(name ?? "").normalize("NFC")));
    return { words, folded: folded.length === words.length ? folded : words.map(foldName) };
}

/** Scripts written without spaces between words. */
const UNSEGMENTED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\u30FC]/u;
const UNSEGMENTED_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\u30FC]+/gu;

/** TRUE when the text contains a character of a script written without word breaks. */
export function hasUnsegmentedScript(s: string): boolean {
    return !!s && UNSEGMENTED.test(s);
}

/** The runs of Han, Hiragana, Katakana and Thai text in a name - the only places a substring match
 *  is meaningful. `売上高_2024年` -> ["売上高", "年"]. */
export function unsegmentedRuns(name: string): string[] {
    if (!name) return [];
    return String(name).normalize("NFC").match(UNSEGMENTED_RUN) ?? [];
}

/** The minimum a compound's remaining stem must keep, in code points, before a suffix counts:
 *  `Temperatur` alone is a word match, `Durchschnittstemperatur` a suffix match, and a one- or
 *  two-letter "stem" is not a compound at all. */
export const COMPOUND_MIN_STEM = 3;

/** COMPOUND-SUFFIX VIEW: does this (folded) word end in the (folded) token, leaving a stem of at
 *  least `minStem` code points? A word EQUAL to the token is a whole-word match, not this. */
export function wordEndsWith(word: string, token: string, minStem: number = COMPOUND_MIN_STEM): boolean {
    if (!word || !token || word.length <= token.length || !word.endsWith(token)) return false;
    return Array.from(word.slice(0, word.length - token.length)).length >= minStem;
}

/** The minimum a word must keep after a glued prefix is removed, in code points. */
export const GLUED_STEM_MIN = 2;

/** GLUED-PREFIX VIEW: the stems left when each of the language's glued prefixes is removed from
 *  the front of the word, longest prefix first; only stems of at least `GLUED_STEM_MIN` code
 *  points. Empty for a language that glues nothing. `الإيرادات` (ar) -> ["إيرادات"];
 *  `והכנסות` (he) -> ["כנסות", "הכנסות"] - every candidate, because which letters are a prefix is
 *  the vocabulary's question, not the reader's. */
export function gluedPrefixStems(word: string, lang: VocabularyLanguageCode | string): string[] {
    const l = vocabularyLanguage(lang);
    if (!word || !l || l.gluedPrefixes.length === 0) return [];
    const out: string[] = [];
    for (const p of [...l.gluedPrefixes].sort((a, b) => b.length - a.length)) {
        if (word.length > p.length && word.startsWith(p)) {
            const stem = word.slice(p.length);
            if (Array.from(stem).length >= GLUED_STEM_MIN && !out.includes(stem)) out.push(stem);
        }
    }
    return out;
}

/** Which view found a token in a name. */
export type NameTokenView = "word" | "suffix" | "prefix" | "substring";

/** The minimum a Hangul compound's remaining stem must keep, in code points (a Hangul syllable is
 *  one). Two, not one: a single syllable glued in front is as often a NEGATION as a subject -
 *  `무계획` is "unplanned", `미달성` "not achieved" - and missing a one-syllable modifier (`총`,
 *  `월`) is the cheap direction. */
export const HANGUL_MIN_STEM = 2;

const HANGUL = /\p{Script=Hangul}/u;

/** HANGUL COMPOUND VIEW: does this word END in the Hangul token, leaving at least `HANGUL_MIN_STEM`
 *  code points before it? Korean writes compound nouns without spaces and puts the head - the
 *  thing the column IS - last: `매출실적` (sales actual), `매출목표` (sales target). A token at the
 *  START modifies something else and is never the head: `시가총액` (market capitalisation) is not
 *  a `시가` (opening price), and `목표매출` is sales, not a target. So the view is the end of the
 *  word, never a substring anywhere in it. */
export function hangulWordEndsWith(word: string, token: string): boolean {
    if (!word || !token || !HANGUL.test(token)) return false;
    return wordEndsWith(word, token, HANGUL_MIN_STEM);
}

/** The shortest token a substring match will look for, in code points. One Han character is a
 *  morpheme, not a word, and matches far too much (`日` is in every date column). */
export const SUBSTRING_MIN = 2;

/**
 * Does `token`, a vocabulary word of language `lang`, occur in the column name - and through which
 * view? The view is chosen by the TOKEN's language, never the reader's culture:
 *
 *   - a token written in Han, Kana or Thai: substring over the name's unsegmented runs, at least
 *     `SUBSTRING_MIN` code points;
 *   - otherwise a whole word - folded, or unfolded for a fold-sensitive language (vi);
 *   - then, for a compounding language, the end of a word (`wordEndsWith`);
 *   - then, for a token written in Hangul, the end of a word (`hangulWordEndsWith`) - "suffix" too;
 *   - then, for a glued-prefix language, a word whose stem after a prefix IS the token.
 *
 * Returns null when no view finds it. This is the reader only: a vocabulary still owns the
 * one-language rule for short tokens and the English-wins rule for collisions.
 */
export function matchNameToken(name: string, token: string, lang: VocabularyLanguageCode | string): NameTokenView | null {
    if (!name || !token) return null;
    const l = vocabularyLanguage(lang);
    if (!l) return null;
    const tok = token.normalize("NFC").toLowerCase();

    if (hasUnsegmentedScript(tok)) {
        if (Array.from(tok).length < SUBSTRING_MIN) return null;
        return unsegmentedRuns(name).some(r => r.includes(tok)) ? "substring" : null;
    }

    const reading = readName(name);
    const words = l.foldSensitive ? reading.words : reading.folded;
    const t = l.foldSensitive ? tok : foldName(token.normalize("NFC")).toLowerCase();
    if (words.includes(t)) return "word";
    if (l.compounds && words.some(w => wordEndsWith(w, t))) return "suffix";
    if (words.some(w => hangulWordEndsWith(w, t))) return "suffix";
    if (l.gluedPrefixes.length && words.some(w => gluedPrefixStems(w, l.code).includes(t))) return "prefix";
    return null;
}
