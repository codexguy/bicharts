// THE LANGUAGE LIST - one list, and every other list is checked against it (2026-09-24).
//
// WHY ONE LIST. Three language lists grew up independently, each fixing its own gap: the country
// names the geo detector recognises, the localized date-hierarchy level names a host
// reassembles, and the localized intensive-quantity tokens the additivity reader matches. They
// disagreed - one wrote Norwegian as `no` while hosts send `nb`, one lacked Slovak, Hungarian and
// Croatian, one was Latin script only - and nothing noticed, because nothing compared them. This
// is the list they are compared against, and a test fails when a vocabulary claims a language
// this list does not carry.
//
// TIER 1 IS WHAT WE AUTHOR AND VET: vocabulary matched against a reader's data, and text a reader
// sees. Tier 2 is what the runtime gives for nothing - `Intl` number, date, plural and region
// formatting - for ANY language the runtime knows, whether or not it is here. `resolveLanguage`
// says which tier a request lands in.
//
// DATA LANGUAGE IS NOT UI LANGUAGE. A host's culture says what the reader's UI is in, not what
// their model is written in - an English UI routinely holds a Spanish model. So vocabulary matched
// against data is the UNION of every language here, never keyed on the resolved culture; only
// text the reader sees follows `resolveLanguage`.

/** ISO 15924 script of a language's everyday writing. `Jpan` is Han + Hiragana + Katakana. */
export type LanguageScript =
    "Latn" | "Cyrl" | "Grek" | "Hani" | "Jpan" | "Hang" | "Arab" | "Hebr" | "Deva" | "Thai";

export type SupportedLanguageCode =
    | "en" | "nl" | "de" | "fr" | "es" | "pt" | "it" | "pl" | "cs" | "sk"
    | "sv" | "da" | "nb" | "fi" | "hu" | "tr" | "ro" | "hr" | "id" | "vi"
    | "ru" | "uk" | "el" | "zh" | "ja" | "ko" | "ar" | "he" | "hi" | "th";

export interface SupportedLanguage {
    /** The one code this language is known by everywhere in the product. */
    code: SupportedLanguageCode;
    /** English name, for diagnostics and tests - never shown to a reader as a label. */
    name: string;
    script: LanguageScript;
    dir: "ltr" | "rtl";
    /** The tag handed to `Intl` when a request names only the language. */
    intl: string;
    /** Other primary language subtags a host sends for this language. A region is never needed
     *  here: `pt-BR`, `nb-NO` and `zh-SG` resolve by their primary subtag. */
    aliases: readonly string[];
    /** FALSE where words are written without spaces between them (Chinese, Japanese, Thai): a
     *  word test cannot find anything there, and matching is by substring over the run. */
    wordBreaks: boolean;
    /** TRUE where a concept is routinely glued onto the END of another word
     *  (`Durchschnittstemperatur`): matching needs the compound-suffix view as well. */
    compounds: boolean;
    /** Particles glued onto the FRONT of a word (the Arabic article, Hebrew one-letter
     *  prefixes): matching needs the glued-prefix view, longest prefix first. */
    gluedPrefixes: readonly string[];
    /** TRUE where diacritics carry meaning, so folding merges different words (Vietnamese
     *  `tháng` month / `thang` ladder). Vocabulary in such a language is matched unfolded. */
    foldSensitive: boolean;
}

const L = (code: SupportedLanguageCode, name: string, script: LanguageScript, extra: Partial<SupportedLanguage> = {}): SupportedLanguage => ({
    code, name, script,
    dir: "ltr",
    intl: code,
    aliases: [],
    wordBreaks: true,
    compounds: false,
    gluedPrefixes: [],
    foldSensitive: false,
    ...extra,
});

/**
 * The thirty Tier 1 languages, English first. The union of the two broadest lists the product
 * already carried (the UI phrase list and the date-level list), so nothing a host already handled
 * is dropped. Traditional Chinese is deliberately NOT here: it resolves to Tier 2 (formatting in
 * Traditional, text from the Simplified entry).
 */
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = Object.freeze([
    L("en", "English", "Latn"),
    L("nl", "Dutch", "Latn", { compounds: true }),
    L("de", "German", "Latn", { compounds: true }),
    L("fr", "French", "Latn"),
    L("es", "Spanish", "Latn"),
    L("pt", "Portuguese", "Latn"),
    L("it", "Italian", "Latn"),
    L("pl", "Polish", "Latn"),
    L("cs", "Czech", "Latn"),
    L("sk", "Slovak", "Latn"),
    L("sv", "Swedish", "Latn", { compounds: true }),
    L("da", "Danish", "Latn", { compounds: true }),
    // Hosts send `no` as often as `nb`; one code, so a table can never hold rows under a code
    // no host resolves to.
    L("nb", "Norwegian Bokmal", "Latn", { compounds: true, aliases: ["no"] }),
    L("fi", "Finnish", "Latn", { compounds: true }),
    L("hu", "Hungarian", "Latn", { compounds: true }),
    L("tr", "Turkish", "Latn"),
    L("ro", "Romanian", "Latn"),
    L("hr", "Croatian", "Latn"),
    // `in` is the pre-1989 code some runtimes still emit.
    L("id", "Indonesian", "Latn", { aliases: ["in"] }),
    L("vi", "Vietnamese", "Latn", { foldSensitive: true }),
    L("ru", "Russian", "Cyrl"),
    L("uk", "Ukrainian", "Cyrl"),
    L("el", "Greek", "Grek"),
    L("zh", "Chinese (Simplified)", "Hani", { intl: "zh-Hans", wordBreaks: false }),
    L("ja", "Japanese", "Jpan", { wordBreaks: false }),
    L("ko", "Korean", "Hang"),
    // The article and the one-letter conjunction/preposition proclitics, alone and combined
    // (`لل` is `ل` + `ال` with the alif dropped). Longest first is the reader's job, not the list's.
    L("ar", "Arabic", "Arab", {
        dir: "rtl",
        gluedPrefixes: ["ال", "وال", "بال", "فال", "كال", "لل", "و", "ف", "ب", "ك", "ل"],
    }),
    // `iw` is the pre-1989 code some runtimes still emit.
    L("he", "Hebrew", "Hebr", {
        dir: "rtl",
        aliases: ["iw"],
        gluedPrefixes: ["ה", "ו", "ב", "ל", "מ", "ש", "כ", "וה", "שה", "מה", "וב", "ול", "ומ", "בה", "לה"],
    }),
    L("hi", "Hindi", "Deva"),
    L("th", "Thai", "Thai", { wordBreaks: false }),
]);

/** The thirty codes, in list order. */
export const SUPPORTED_LANGUAGE_CODES: readonly SupportedLanguageCode[] =
    Object.freeze(SUPPORTED_LANGUAGES.map(l => l.code));

const BY_CODE: ReadonlyMap<string, SupportedLanguage> = new Map(SUPPORTED_LANGUAGES.map(l => [l.code, l]));
const BY_ALIAS: ReadonlyMap<string, SupportedLanguage> = new Map(
    SUPPORTED_LANGUAGES.flatMap(l => l.aliases.map(a => [a, l] as [string, SupportedLanguage])));

/** Languages outside Tier 1 whose TEXT is best served by a Tier 1 neighbour rather than by English.
 *  Formatting still follows the request (Tier 2). */
const TIER2_TEXT_NEIGHBOUR: Readonly<Record<string, SupportedLanguageCode>> = {
    nn: "nb",   // Nynorsk reader: Bokmal text, Nynorsk formatting
};

/** The Tier 1 entry for a code or alias, or undefined. */
export function supportedLanguage(code: string | null | undefined): SupportedLanguage | undefined {
    const k = String(code ?? "").trim().toLowerCase();
    return BY_CODE.get(k) ?? BY_ALIAS.get(k);
}

export interface ResolvedLanguage {
    /** The Tier 1 language whose vetted text this reader gets - always one of the thirty. */
    code: SupportedLanguageCode;
    language: SupportedLanguage;
    /** 1 when the request IS that language; 2 when only `Intl` formatting follows the request and
     *  the text comes from `code` (a neighbour, or English). */
    tier: 1 | 2;
    /** What to hand `Intl` for numbers, dates, plurals and lists: the request in canonical form
     *  when the runtime knows it, otherwise the fallback language's own tag. */
    intl: string;
}

function canonicalTag(tag: string): string | null {
    try {
        const c = Intl.getCanonicalLocales(tag);
        return c.length ? c[0] : null;
    } catch {
        return null;
    }
}

/** Traditional script, by the runtime's likely-subtags data when it has them and by the regions
 *  that write Traditional when it does not. An explicit script subtag always wins. */
function isTraditionalChinese(tag: string): boolean {
    const parts = tag.split("-");
    const script = parts.find((p, i) => i > 0 && p.length === 4);
    if (script) return script.toLowerCase() === "hant";
    try {
        const Loc: any = (Intl as any).Locale;
        if (typeof Loc === "function") {
            const max = new Loc(tag).maximize();
            if (max && typeof max.script === "string") return max.script === "Hant";
        }
    } catch { /* fall through to the region rule */ }
    const region = parts.find((p, i) => i > 0 && p.length === 2);
    return !!region && ["TW", "HK", "MO"].includes(region.toUpperCase());
}

function runtimeKnows(tag: string): boolean {
    try {
        return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0;
    } catch {
        return false;
    }
}

/**
 * THE ONE READING OF A HOST'S CULTURE. Every host resolves its culture here and nowhere else - the
 * 2-letter cut each host used to make on its own sent `nb` into a table keyed `no`, read `zh-TW`
 * as Simplified, and ignored every tag it did not expect.
 *
 *   resolveLanguage("en-US")   -> { code: "en", tier: 1, intl: "en-US" }
 *   resolveLanguage("nb-NO")   -> { code: "nb", tier: 1, intl: "nb-NO" }
 *   resolveLanguage("no")      -> { code: "nb", tier: 1, intl: "no" }
 *   resolveLanguage("zh-CN")   -> { code: "zh", tier: 1, intl: "zh-CN" }
 *   resolveLanguage("zh-TW")   -> { code: "zh", tier: 2, intl: "zh-TW" }   Traditional: Tier 2
 *   resolveLanguage("sw-KE")   -> { code: "en", tier: 2, intl: "sw-KE" }   Intl formats Swahili
 *   resolveLanguage("")        -> { code: "en", tier: 1, intl: "en" }      no culture sent
 *
 * Never throws. An unparseable tag is treated as absent.
 */
export function resolveLanguage(tag: string | null | undefined): ResolvedLanguage {
    const en = BY_CODE.get("en")!;
    const raw = String(tag ?? "").trim().replace(/_/g, "-");
    const canon = raw ? canonicalTag(raw) : null;
    if (!canon) return { code: "en", language: en, tier: 1, intl: "en" };

    const primary = canon.split("-")[0].toLowerCase();
    const hit = BY_CODE.get(primary) ?? BY_ALIAS.get(primary);
    if (hit) {
        const tier: 1 | 2 = hit.code === "zh" && isTraditionalChinese(canon) ? 2 : 1;
        return { code: hit.code, language: hit, tier, intl: canon };
    }

    const neighbour = TIER2_TEXT_NEIGHBOUR[primary];
    const text = neighbour ? BY_CODE.get(neighbour)! : en;
    return { code: text.code, language: text, tier: 2, intl: runtimeKnows(canon) ? canon : text.intl };
}
