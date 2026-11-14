// THE TEXT CHART-HOST SHOWS A READER, IN THE READER'S LANGUAGE.
//
// Every sentence chart-host draws for a reader (the selection card first) is a KEY with its English beside it at the call
// site, never a fragment glued in English word order: "{agg} of {column}" cannot be translated, "Sum of {column}" can.
// A key may be counted: its value is then the language's plural forms ({ one, other, few, ... }), chosen by
// Intl.PluralRules for the count.
//
// The text is a HOST SERVICE (HostServices.strings). A host that passes none reads the English at the call site, byte
// for byte as before - the capability layer working as designed. `chartHostStrings(cultureCode)` is the package's own
// catalog for a language, so a host that wants the reader's language passes that and writes no strings of its own; a host
// may also pass a source of its own (a different wording, a language the package does not carry).

/** One catalog value: a sentence, or a counted key's plural forms (Intl.PluralRules categories). */
export type CatalogValue = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;

/** The values a sentence fills, by name: "{column}" takes vars.column. */
export type TextVars = Readonly<Record<string, string | number>>;

/** A language's text. `get` answers the key's value, or undefined when this source does not word it (English is read). */
export interface StringSource {
    /** The BCP 47 language the values are in; it chooses the plural rules and the number format. */
    readonly lang: string;
    get(key: string): CatalogValue | undefined;
}

/** A source over a plain catalog object, the shape the package's own catalogs ship in. */
export function catalogSource(lang: string, catalog: Readonly<Record<string, CatalogValue>>): StringSource {
    return { lang, get: key => (Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] : undefined) };
}

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

function pluralForm(value: CatalogValue, lang: string, count: number | undefined): string | undefined {
    if (typeof value === "string") return value;
    let cat: Intl.LDMLPluralRule = "other";
    try { cat = new Intl.PluralRules(lang).select(count ?? 0); } catch { /* an unknown tag reads "other" */ }
    return value[cat] ?? value.other;
}

/**
 * The sentence for `key` in the source's language, its {placeholders} filled; the English given here when the source is
 * absent or does not word the key. A placeholder with no value is left as written.
 */
export function hostText(src: StringSource | null | undefined, key: string, english: CatalogValue,
                         vars?: TextVars, count?: number): string {
    const own = src?.get(key);
    const template = (own != null ? pluralForm(own, src!.lang, count) : undefined) ?? pluralForm(english, "en", count) ?? "";
    if (!vars) return template;
    return template.replace(PLACEHOLDER, (m, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m);
}

/** True when `src` will word text in a language other than English (numbers are then grouped in that language). */
export function isLocalized(src: StringSource | null | undefined): src is StringSource {
    return !!src && !/^en(?:-|$)/i.test(src.lang);
}

const CATALOGS: Readonly<Record<string, Readonly<Record<string, CatalogValue>>>> = {};

/**
 * chart-host's own catalog for the reader's culture ("es-MX" reads "es"), or null when the package carries none for it -
 * the host then reads English. English itself is null: the English is at each call site.
 */
export function chartHostStrings(cultureCode: string | null | undefined): StringSource | null {
    const tag = String(cultureCode ?? "").trim();
    if (!tag) return null;
    const lang = tag.split(/[-_]/)[0].toLowerCase();
    if (lang === "en") return null;
    const catalog = CATALOGS[tag.toLowerCase()] ?? CATALOGS[lang];
    return catalog ? catalogSource(lang, catalog) : null;
}
