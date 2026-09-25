// IDENTIFIER WORDS - the words that say a numeric column LABELS a row rather than measuring it, in the
// languages a model is written in (2026-09-25).
//
// WHAT READS THEM. `isIdentifierName`: a column named for an identifier is nominal whatever its values
// look like, so an integer `Kundennummer` or `Código Postal` is a category, never a quantity to sum or
// average. The English words stay where they were (`IDENTIFIER_NAME_TOKENS`, the name's LAST word) and are
// read first; these are the other languages', read only where the English words find nothing.
//
// WHERE THE WORD SITS DEPENDS ON THE LANGUAGE. A head-final language puts it LAST, as English does
// (`Kundennummer`, `Müşteri numarası`, `客户编号`, `고객번호`); a head-initial one puts it FIRST (`Código
// Cliente`, `Код товара`, `Numer zamówienia`, `رمز العميل`). A word counts only where its own language puts
// it, so an English `Code Coverage` is never read as French. In the head-initial languages the host's
// default aggregation prefix is set aside first (`Suma de Código Postal`).
//
// HOW A WORD IS READ. Folded, unless its language is fold-sensitive (vi) or it is listed in
// `IDENTIFIER_UNFOLDED`; the whole word, or in the compounding languages the END of the last word
// (`Artikelnummer`, `Kundennr`); in Korean the end of a Hangul compound; in Chinese and Japanese the end of
// the last run (`顧客番号`), in Thai its start (`รหัสลูกค้า`).
//
// WHAT IS LEFT OUT, AND WHY - each a word whose false reading makes a real measure a category:
//   * NUMBER where it is also the word for a COUNT: es/pt `número`, it `numero`, fr `nombre`, ro `număr`,
//     hr `broj`, el `αριθμός`, he `מספר`, hi `संख्या`, hu `szám` - `Número de clientes` is a count. English
//     leaves `number` out for the same reason. Where the language keeps the two apart (de `Nummer` /
//     `Anzahl`, ru `номер` / `количество`, tr `numarası` / `sayısı`, fr `numéro` / `nombre`), it is in;
//   * words that are English words or column abbreviations in first position: fr `code` (`Code Coverage`),
//     ro `cod` (COD, cash on delivery), it `cap` (`Cap Rate`), and every KEY word (es `clave`, de
//     `Schlüssel`: `Indicador clave`, `Verteilschlüssel`, an allocation ratio);
//   * fi `numero` (the Spanish and Italian count word, whole); vi words other than `mã`;
//   * `postcode`, which is also English: adding it would move an English verdict.

import { readName, wordEndsWith, hangulWordEndsWith, gluedPrefixStems, COMPOUND_MIN_STEM, SUBSTRING_MIN } from "../nameReader";
import { vocabularyLanguage, type VocabularyLanguageCode } from "../languages";
import { stripHostAggPrefix } from "../aggregation";

type Vocab = Partial<Record<VocabularyLanguageCode, readonly string[]>>;

/* parity:identifier-words:begin */
/** The words, per language, in the position the language puts them (see `IDENTIFIER_HEAD_INITIAL`). */
export const IDENTIFIER_WORDS: Vocab = {
    // head-final: the LAST word
    de: ["nr", "nummer", "kennung", "kennziffer", "plz", "postleitzahl"],
    nl: ["nr", "nummer"],
    sv: ["nr", "nummer"],
    da: ["nr", "nummer"],
    nb: ["nr", "nummer"],
    fi: ["tunnus", "koodi", "nro"],
    hu: ["azonosító", "kód"],
    tr: ["kod", "kodu", "numarası", "numarasi"],
    zh: ["编号", "代码", "编码", "号码", "邮编"],
    ja: ["番号", "コード"],
    ko: ["번호", "코드"],
    hi: ["कोड", "क्रमांक"],
    // head-initial: the FIRST word
    fr: ["numéro"],
    es: ["código"],
    pt: ["código", "cep"],
    it: ["codice"],
    pl: ["kod", "numer"],
    cs: ["kód", "číslo"],
    sk: ["kód", "číslo"],
    hr: ["šifra", "oznaka"],
    ru: ["код", "номер"],
    uk: ["код", "номер"],
    el: ["κωδικός"],
    ar: ["رمز", "كود", "رقم"],
    he: ["קוד"],
    id: ["kode", "nomor"],
    vi: ["mã"],
    th: ["รหัส"],
};

/** The languages that put the identifier word FIRST. */
export const IDENTIFIER_HEAD_INITIAL: readonly VocabularyLanguageCode[] =
    ["fr", "es", "pt", "it", "pl", "cs", "sk", "hr", "ru", "uk", "el", "ar", "he", "id", "vi", "th"];

/** Words matched as written, never folded: `numéro` folds to the Spanish and Italian count word. */
export const IDENTIFIER_UNFOLDED: readonly string[] = ["numéro"];
/* parity:identifier-words:end */

/** Where an identifier word was found. */
export interface IdentifierWordHit {
    lang: VocabularyLanguageCode;
    word: string;
    view: "word" | "suffix";
}

const lower = (s: string) => s.normalize("NFC").toLowerCase();

function readsAs(word: string, token: string, lang: VocabularyLanguageCode, first: boolean): "word" | "suffix" | null {
    const l = vocabularyLanguage(lang);
    if (!l || !word) return null;
    if (word === token) return "word";
    if (l.wordBreaks === false) {
        // Han / Kana: the end of the run; Thai: its start - never a one-character token
        if (Array.from(token).length < SUBSTRING_MIN) return null;
        return (first ? word.startsWith(token) : word.endsWith(token)) && word.length > token.length ? "suffix" : null;
    }
    if (first) return gluedPrefixStems(word, lang).includes(token) ? "word" : null;   // ar / he: `الرمز`
    if (l.script === "Hang") return hangulWordEndsWith(word, token) ? "suffix" : null;
    if (l.compounds && wordEndsWith(word, token, COMPOUND_MIN_STEM)) return "suffix";
    return null;
}

/** Another language's identifier word in the name, in the position its language puts it, or null. English
 *  is the caller's own test, first. */
export function localizedIdentifierWordIn(name: string | null | undefined): IdentifierWordHit | null {
    const n = String(name ?? "").trim();
    if (!n) return null;
    const whole = readName(n);
    const stripped = readName(stripHostAggPrefix(n));
    for (const [lang, tokens] of Object.entries(IDENTIFIER_WORDS) as Array<[VocabularyLanguageCode, readonly string[]]>) {
        const first = IDENTIFIER_HEAD_INITIAL.includes(lang);
        const reading = first ? stripped : whole;
        for (const token of tokens) {
            const plain = IDENTIFIER_UNFOLDED.includes(token) || !!vocabularyLanguage(lang)?.foldSensitive;
            const words = plain ? reading.words : reading.folded;
            if (words.length === 0) continue;
            const t = plain ? lower(token) : readName(token).folded.join(" ");
            const view = readsAs(first ? words[0] : words[words.length - 1], t, lang, first);
            if (view) return { lang, word: token, view };
        }
    }
    return null;
}
