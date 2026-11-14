// CHART-HOST'S OWN TEXT IN THE READER'S LANGUAGE. Published as "@bicharts/chart-host/strings".
//
// A host that wants its reader's language passes `chartHostStrings(cultureCode)` as HostServices.strings and to the
// selection card; a host that passes nothing reads English. Its own entry, not the main one, so the catalogs load only for
// a host that asks for them: the main entry's eager closure is budgeted (scripts/checkEagerSize.mjs).

import { catalogSource, type StringSource } from "./hostText";
import { HOST_TEXT_CATALOGS } from "./hostTextCatalog";

export { HOST_TEXT_CATALOGS };

/**
 * chart-host's own catalog for the reader's culture ("es-MX" reads "es"), or null when the package carries none for it -
 * the host then reads English. English itself is null: the English is at each call site.
 */
export function chartHostStrings(cultureCode: string | null | undefined): StringSource | null {
    const tag = String(cultureCode ?? "").trim();
    if (!tag) return null;
    const lang = tag.split(/[-_]/)[0].toLowerCase();
    if (lang === "en") return null;
    const catalog = HOST_TEXT_CATALOGS[tag.toLowerCase()] ?? HOST_TEXT_CATALOGS[lang];
    return catalog ? catalogSource(lang, catalog) : null;
}
