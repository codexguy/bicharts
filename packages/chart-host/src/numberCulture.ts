// THE CULTURE A CHART FORMATS ITS NUMBERS WITH - not always the reader's culture tag as sent.
//
// A right-to-left language's default numbering system is not always Latin: `Intl.NumberFormat("ar-SA")` writes
// Arabic-Indic digits, while every number a chart's data or its d3 formats print is Latin. One chart then mixed two
// digit systems. So a chart formats numbers for a right-to-left reader with Latin digits (`-u-nu-latn`), and keeps the
// reader's LANGUAGE for everything else: its words, plural rules, month names and day periods still read the tag as
// sent, and `resolveLanguage("ar-SA-u-nu-latn")` still reads Arabic. Every other tag passes through unchanged, so a
// left-to-right reader - English above all - formats exactly as before.

import { isRightToLeft as languageIsRightToLeft } from "@bicharts/shape-core";

/** True when the culture tag names a language written right to left (Arabic, Hebrew, Persian): `he`, `iw`, `ar-SA`,
 *  `ar-SA-u-nu-arab`, any case. False for every other tag, and for an absent or unparseable one. */
export function isRightToLeft(tag: string | null | undefined): boolean {
    return languageIsRightToLeft(tag);
}

/** The tag with one Unicode extension key set (`nu` -> numbering system, `ca` -> calendar). */
function withUnicodeKey(tag: string, key: "nu" | "ca", value: string): string {
    try {
        const Loc: any = (Intl as any).Locale;
        if (typeof Loc === "function") return String(new Loc(tag, key === "nu" ? { numberingSystem: value } : { calendar: value }));
    } catch { /* fall through to the string merge */ }
    // A runtime without Intl.Locale: merge the key by hand. An existing value is replaced, an existing `-u-`
    // extension takes the key, and a private-use part stays last.
    const existing = new RegExp(`(-u(?:-[a-z0-9]{2,8})*?)-${key}-[a-z0-9]{3,8}(?=-|$)`, "i");
    if (existing.test(tag)) return tag.replace(existing, `$1-${key}-${value}`);
    const u = /-u(?=-|$)/i.exec(tag);
    if (u) return tag.slice(0, u.index + 2) + `-${key}-${value}` + tag.slice(u.index + 2);
    const x = /-x-/i.exec(tag);
    return x ? tag.slice(0, x.index) + `-u-${key}-${value}` + tag.slice(x.index) : tag + `-u-${key}-${value}`;
}

/** Arabic's default calendar in Intl is not always Gregorian (`ar-SA` reads Umm al-Qura), while a chart's dates come from
 *  Gregorian data; so an Arabic tag that names no calendar of its own formats dates in the Gregorian calendar. A tag that
 *  states one (`-u-ca-islamic`) keeps it: the reader asked for it. */
function withGregorianIfUnstated(tag: string): string {
    if (!/^ar(?:-|$)/i.test(tag) || /-u(?:-[a-z0-9]{2,8})*?-ca-/i.test(tag)) return tag;
    return withUnicodeKey(tag, "ca", "gregory");
}

/**
 * The culture tag a chart should FORMAT NUMBERS (and dates) with: for a right-to-left language, the tag with the Latin
 * numbering system (`he-IL` -> `he-IL-u-nu-latn`, `ar-u-nu-arab` -> `ar-u-ca-gregory-nu-latn`), and for Arabic the
 * Gregorian calendar when the tag names none (`ar-SA` -> `ar-SA-u-ca-gregory-nu-latn`; `ar-SA-u-ca-islamic` keeps its
 * calendar -> `ar-SA-u-ca-islamic-nu-latn`); every other tag, and an empty or absent one, exactly as given.
 */
export function chartNumberCulture(tag: string): string;
export function chartNumberCulture(tag: string | null | undefined): string | null | undefined;
export function chartNumberCulture(tag: string | null | undefined): string | null | undefined {
    if (typeof tag !== "string" || !isRightToLeft(tag)) return tag;
    let canon = tag.trim().replace(/_/g, "-");
    try { canon = Intl.getCanonicalLocales(canon)[0] ?? canon; } catch { return tag; }
    return withGregorianIfUnstated(withUnicodeKey(canon, "nu", "latn"));
}
