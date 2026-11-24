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
// may also pass a source of its own (a different wording, a language the package does not carry). The catalogs
// and chartHostStrings live in their own entry, "@bicharts/chart-host/strings" (strings.ts).
//
// A VALUE INSIDE A RIGHT-TO-LEFT SENTENCE IS ISOLATED. A filled value (a column name, a number) is often Latin text, and
// inside an Arabic or Hebrew sentence the bidirectional algorithm lets it pull the words around it out of order. So when
// the sentence came from a source whose language is right to left, each FILLED value is wrapped in FIRST STRONG ISOLATE
// ... POP DIRECTIONAL ISOLATE (U+2068 ... U+2069), the same isolation the server's catalog applies. English (no source,
// or the English given here because the source does not word the key), a left-to-right language and a placeholder left
// unfilled are unchanged, byte for byte. renderText inherits it.

import { isRightToLeft } from "./numberCulture";

const FSI = "⁨";
const PDI = "⁩";

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
 * absent or does not word the key. A placeholder with no value is left as written. In a right-to-left source's sentence
 * each filled value is isolated (FSI ... PDI); see the header.
 */
export function hostText(src: StringSource | null | undefined, key: string, english: CatalogValue,
                         vars?: TextVars, count?: number): string {
    const own = src?.get(key);
    const fromSource = own != null ? pluralForm(own, src!.lang, count) : undefined;
    const template = fromSource ?? pluralForm(english, "en", count) ?? "";
    if (!vars) return template;
    const isolate = fromSource != null && isRightToLeft(src!.lang);
    return template.replace(PLACEHOLDER, (m, name: string) => {
        if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
        const value = String(vars[name]);
        return isolate ? FSI + value + PDI : value;
    });
}

/** A text source as a plain function, the form RenderOptions.text carries into a chart's own code: the key's sentence
 *  in the source's language, or the English given, its {placeholders} filled (`count` picks a plural form). */
export type RenderTextFn = (key: string, english: string, vars?: TextVars, count?: number) => string;

/** RenderOptions.text for a source (a host passes renderText(chartHostStrings(culture))); English with none. */
export function renderText(src: StringSource | null | undefined): RenderTextFn {
    return (key, english, vars, count) => hostText(src, key, english, vars, count);
}

/** True when `src` will word text in a language other than English (numbers are then grouped in that language). */
export function isLocalized(src: StringSource | null | undefined): src is StringSource {
    return !!src && !/^en(?:-|$)/i.test(src.lang);
}
