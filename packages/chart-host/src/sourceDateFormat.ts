// A DATE, PRINTED THE WAY ITS SOURCE PRINTS IT (2026-09-09).
//
// THE LEAK. `buildRenderPayload` coerces every Date cell to `toISOString()` on the way out, and
// it is right to: that is the WIRE, the contract the prompt preamble states, and the one form
// that means the same thing on every machine. But the selection card reads its header and its
// dimension lines straight off those same rows with `String(raw)` - so a click on a weekly point
// answered with `2025-08-31T00:00:00.000Z`. The card's own stated job is to say what the reader
// clicked "in their own data's words", and an ISO instant is the machine's words: it carries a
// time nobody entered, a `Z` that means nothing to a reader, and a shape their worksheet never
// showed them.
//
// WHY NOT JUST A LOCALE DATE. A locale date is a large improvement and would have been the whole
// fix, but it is still not the SOURCE. The reader's sheet renders that column `8/31/2025` or
// `31-Aug-25` because they chose so, and Excel hands us that choice in `range.numberFormat` -
// which the add-in was already reading to detect date columns and then throwing away. The card
// sits on top of the cells; it should agree with them. So the host states its format, and this
// file renders it.
//
// TWO DIALECTS, STATED, NEVER GUESSED. Excel number formats and .NET/Power BI format strings share
// most of their vocabulary and disagree exactly where it hurts: Excel is case-INSENSITIVE and
// decides `m` between month and minute from CONTEXT (a minute only next to an hour or a second),
// while .NET is case-SENSITIVE and `M` is month, `m` is minute, always. `dd/mm/yyyy` is therefore
// a perfectly ordinary day/month/year format in Excel and a day/MINUTE/year nonsense in .NET, and
// no amount of sniffing tells the two apart from the string alone. The host that owns the format
// says which vocabulary it wrote it in; there is no default, because a wrong default here prints
// a wrong date rather than failing.
//
// FAIL SOFT, ALWAYS. Every step degrades rather than throwing: an unparseable value, a format
// with no date token in it, a bad culture code, a format this file does not understand - each
// falls back one rung, and the last rung is a locale date, which is still better than the ISO
// string this replaced. A card is a courtesy; it must never be the reason a click does nothing.

import { parseDateStable, wholeDayFrame } from "@bicharts/shape-core";

/** Which vocabulary a source format string is written in. See the header note - this is stated
 *  by the host that owns the format, never inferred from the string. */
export type SourceFormatDialect = "excel" | "dotnet";

/** A host's per-column source formats. The dialect is carried WITH the map rather than passed
 *  beside it, so a caller cannot supply one without the other. */
export interface SourceFormats {
    dialect: SourceFormatDialect;
    /** Keyed by column name, which is the key the payload's columns already carry. Absent or
     *  blank for a column with no source format - a computed column, a CSV, a text date whose
     *  own text IS its formatting. */
    byColumn: Record<string, string>;
}

export interface SourceDateOptions {
    /** The source's own format string for this column, if it has one. */
    format?: string | null;
    /** Which vocabulary `format` is written in. Ignored when `format` is absent. */
    dialect?: SourceFormatDialect;
    /** BCP-47 tag, for month and weekday names and for the locale fallback. */
    culture?: string;
}

/**
 * Render a temporal payload value for a reader, or NULL when the value is not a date at all.
 *
 * Null rather than a best-effort string, so a caller can fall through to whatever it did before
 * without this file having an opinion about non-dates. Accepts a `Date` (what a host holds before
 * the payload is built) and an ISO string (what the payload carries after it).
 */
export function formatSourceDate(raw: any, opts: SourceDateOptions = {}): string | null {
    const d = toDate(raw);
    if (!d) return null;

    // WHICH CLOCK. `wholeDayFrame` is shape-core's - the same rule the profiler uses to decide
    // whether a column carries a time of day, and the reason a UTC-built Excel serial does not
    // print as 17:00 the previous day west of Greenwich. A value with a real time has no such
    // tell, so the dialect answers: an Excel serial is UTC-anchored by construction
    // (`Date.UTC(1899,11,30) + days`), and so is any wall clock `parseDateStable` re-anchored,
    // while a Power BI host hands over local Dates.
    const dayFrame = wholeDayFrame(d);
    const frame = dayFrame ?? (opts.dialect === "dotnet" ? "local" : "utc");
    const p = partsIn(d, frame);

    const format = cleanFormat(opts.format, opts.dialect);
    if (format && opts.dialect) {
        const rendered = renderFormat(format, p, opts.dialect, opts.culture);
        if (rendered) return rendered;
    }
    return localeDate(p, !!dayFrame, opts.culture);
}

/** Convenience for a caller holding a `SourceFormats` map and a column name. */
export function formatSourceDateFor(
    raw: any, columnName: string, formats: SourceFormats | null | undefined, culture?: string,
): string | null {
    return formatSourceDate(raw, {
        format: formats?.byColumn?.[columnName] ?? null,
        dialect: formats?.dialect,
        culture,
    });
}

// ---------------------------------------------------------------------------------------------
// Getting to a Date
// ---------------------------------------------------------------------------------------------

/** ISO instants and ISO days - the two shapes `buildRenderPayload` and a host's own text can
 *  present. Deliberately NARROW: anything looser would start reformatting strings that are not
 *  dates, and `Date.parse` accepts a startling amount of prose. */
const ISO_LIKE_RE = /^\s*\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\s*$/;

function toDate(raw: any): Date | null {
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    if (typeof raw !== "string" || !ISO_LIKE_RE.test(raw)) return null;
    const d = parseDateStable(raw.trim());
    return d && !isNaN(d.getTime()) ? d : null;
}

interface Parts {
    year: number; month: number; day: number;    // month 1-12
    hours: number; minutes: number; seconds: number; ms: number;
    weekday: number;                             // 0 = Sunday
}

function partsIn(d: Date, frame: "utc" | "local"): Parts {
    return frame === "utc"
        ? {
            year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
            hours: d.getUTCHours(), minutes: d.getUTCMinutes(), seconds: d.getUTCSeconds(),
            ms: d.getUTCMilliseconds(), weekday: d.getUTCDay(),
        }
        : {
            year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
            hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds(),
            ms: d.getMilliseconds(), weekday: d.getDay(),
        };
}

/** The parts re-anchored to a UTC instant, so `Intl` can be asked for names and a locale date
 *  with `timeZone: "UTC"` and hand back exactly the wall clock we chose - never the machine's. */
function utcAnchor(p: Parts): Date {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hours, p.minutes, p.seconds, p.ms));
    // Date.UTC maps years 0-99 onto 1900-1999; setUTCFullYear does not. Same guard
    // parseDateStable carries, and for the same reason.
    if (p.year >= 0 && p.year < 100) d.setUTCFullYear(p.year);
    return d;
}

// ---------------------------------------------------------------------------------------------
// The locale fallback - the last rung, and the one every host without a source format lands on
// ---------------------------------------------------------------------------------------------

function localeDate(p: Parts, wholeDay: boolean, culture?: string): string {
    const anchor = utcAnchor(p);
    try {
        const o: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeZone: "UTC" };
        if (!wholeDay) o.timeStyle = p.seconds || p.ms ? "medium" : "short";
        return new Intl.DateTimeFormat(culture || undefined, o).format(anchor);
    } catch {
        // A bad culture code, or a runtime without the full ICU data, must not cost the reader
        // the date. ISO minus the noise: still a day they can read, never a `Z`.
        const iso = anchor.toISOString();
        return wholeDay ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
    }
}

// ---------------------------------------------------------------------------------------------
// Format strings
// ---------------------------------------------------------------------------------------------

/**
 * Reduce a raw source format to the part that describes a date, or null when it describes none.
 *
 * Both dialects section a format with `;` (positive;negative;zero;text in Excel, the same idea in
 * VB) and only the first section can apply to a date. Excel additionally decorates with square
 * brackets - `[$-en-US]` states a locale, `[Red]` a colour, `[>=100]` a condition - none of which
 * this file renders; the ELAPSED forms `[h] [m] [s]` are kept, unbracketed, because a column
 * formatted that way still wants its hours printed.
 */
function cleanFormat(raw: string | null | undefined, dialect: SourceFormatDialect | undefined): string | null {
    if (!raw || !dialect) return null;
    let s = firstSection(String(raw), dialect);
    if (dialect === "excel") {
        s = s.replace(/\[(h{1,2}|m{1,2}|s{1,2})\]/gi, "$1")   // elapsed - keep the token
             .replace(/\[[^\]]*\]/g, "");                      // locale, colour, condition - drop
    }
    if (!s.trim() || /^general$/i.test(s.trim())) return null;
    // A format with no date or time token in it is a NUMBER format on a column that happens to
    // hold a date, and rendering a date through it would invent something. Fall through instead.
    return hasDateToken(s, dialect) ? s : null;
}

/** Split on the first `;` that is not inside a quoted literal. */
function firstSection(s: string, dialect: SourceFormatDialect): string {
    let out = "";
    let quote = "";
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
            out += ch;
            if (ch === quote) quote = "";
            continue;
        }
        if (ch === '"' || (dialect === "dotnet" && ch === "'")) { quote = ch; out += ch; continue; }
        if (ch === "\\") { out += ch + (s[i + 1] ?? ""); i++; continue; }
        if (ch === ";") break;
        out += ch;
    }
    return out;
}

function hasDateToken(s: string, dialect: SourceFormatDialect): boolean {
    const stripped = stripLiterals(s, dialect);
    return dialect === "excel"
        ? /[ymdhs]/i.test(stripped)
        : /[yMdHhmsft]/.test(stripped);
}

function stripLiterals(s: string, dialect: SourceFormatDialect): string {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "\\" || (dialect === "dotnet" && ch === "%")) { i++; continue; }
        if (ch === '"' || (dialect === "dotnet" && ch === "'")) {
            const end = s.indexOf(ch, i + 1);
            i = end < 0 ? s.length : end;
            continue;
        }
        out += ch;
    }
    return out;
}

/** What a scanned run of the format means. `mAmbiguous*` is the Excel-only case the resolve pass
 *  settles; every other kind renders directly. */
type TokenKind =
    | "literal" | "year4" | "year2" | "monthLong" | "monthShort" | "monthNarrow" | "month2" | "month1"
    | "weekdayLong" | "weekdayShort" | "day2" | "day1" | "hour2" | "hour1" | "minute2" | "minute1"
    | "second2" | "second1" | "fraction" | "meridiemLong" | "meridiemShort"
    | "mAmbiguous2" | "mAmbiguous1";

interface Token { kind: TokenKind; text?: string; }

/** Longest-first, because `mmmm` must win over `mmm` over `mm`. */
const EXCEL_TOKENS: Array<[RegExp, TokenKind]> = [
    [/^am\/pm/i, "meridiemLong"],
    [/^a\/p/i, "meridiemShort"],
    [/^y{3,}/i, "year4"],
    [/^y{1,2}/i, "year2"],
    [/^m{5,}/i, "monthNarrow"],
    [/^m{4}/i, "monthLong"],
    [/^m{3}/i, "monthShort"],
    [/^m{2}/i, "mAmbiguous2"],
    [/^m/i, "mAmbiguous1"],
    [/^d{4,}/i, "weekdayLong"],
    [/^d{3}/i, "weekdayShort"],
    [/^d{2}/i, "day2"],
    [/^d/i, "day1"],
    [/^h{2,}/i, "hour2"],
    [/^h/i, "hour1"],
    [/^s{2,}/i, "second2"],
    [/^s/i, "second1"],
];

const DOTNET_TOKENS: Array<[RegExp, TokenKind]> = [
    [/^y{3,}/, "year4"],
    [/^y{1,2}/, "year2"],
    [/^M{4,}/, "monthLong"],
    [/^M{3}/, "monthShort"],
    [/^M{2}/, "month2"],
    [/^M/, "month1"],
    [/^d{4,}/, "weekdayLong"],
    [/^d{3}/, "weekdayShort"],
    [/^d{2}/, "day2"],
    [/^d/, "day1"],
    [/^H{2,}/, "hour2"],
    [/^H/, "hour1"],
    [/^h{2,}/, "hour2"],
    [/^h/, "hour1"],
    [/^m{2,}/, "minute2"],
    [/^m/, "minute1"],
    [/^s{2,}/, "second2"],
    [/^s/, "second1"],
    [/^f+/, "fraction"],
    [/^tt/, "meridiemLong"],
    [/^t/, "meridiemShort"],
];

function tokenize(s: string, dialect: SourceFormatDialect): Token[] {
    const table = dialect === "excel" ? EXCEL_TOKENS : DOTNET_TOKENS;
    const out: Token[] = [];
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (ch === "\\" || (dialect === "dotnet" && ch === "%")) {
            if (i + 1 < s.length) out.push({ kind: "literal", text: s[i + 1] });
            i += 2;
            continue;
        }
        if (ch === '"' || (dialect === "dotnet" && ch === "'")) {
            const end = s.indexOf(ch, i + 1);
            out.push({ kind: "literal", text: end < 0 ? s.slice(i + 1) : s.slice(i + 1, end) });
            i = end < 0 ? s.length : end + 1;
            continue;
        }
        const rest = s.slice(i);
        let matched = false;
        for (const [re, kind] of table) {
            const m = re.exec(rest);
            if (m) { out.push({ kind }); i += m[0].length; matched = true; break; }
        }
        if (!matched) { out.push({ kind: "literal", text: ch }); i++; }
    }
    return out;
}

/**
 * EXCEL'S `m` RULE, which is the whole reason the two dialects cannot share a table.
 *
 * `m` is a month everywhere except immediately after an hour or immediately before a second -
 * `h:mm` is minutes, `mm:ss` is minutes, `mm/dd` is a month. "Immediately" skips the separator
 * between them, because the separator is what a reader writes there: in `h:mm` the `:` sits
 * between the two tokens and the rule still has to fire.
 */
function resolveAmbiguousM(tokens: Token[]): void {
    const isHour = (t: Token) => t.kind === "hour1" || t.kind === "hour2";
    const isSecond = (t: Token) => t.kind === "second1" || t.kind === "second2";
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind !== "mAmbiguous1" && t.kind !== "mAmbiguous2") continue;
        const two = t.kind === "mAmbiguous2";
        let minute = false;
        for (let j = i - 1; j >= 0; j--) {
            if (tokens[j].kind === "literal") continue;
            minute = isHour(tokens[j]);
            break;
        }
        if (!minute) {
            for (let j = i + 1; j < tokens.length; j++) {
                if (tokens[j].kind === "literal") continue;
                minute = isSecond(tokens[j]);
                break;
            }
        }
        t.kind = minute ? (two ? "minute2" : "minute1") : (two ? "month2" : "month1");
    }
}

const EN_MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
const EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EN_DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Month and weekday NAMES come from Intl so they follow the reader's culture, with English as
 *  the fallback when the runtime has no data for it - a named month in the wrong language still
 *  beats no card. */
function name(p: Parts, kind: "month" | "weekday", width: "long" | "short" | "narrow", culture?: string): string {
    try {
        const opts: Intl.DateTimeFormatOptions = kind === "month"
            ? { month: width, timeZone: "UTC" }
            : { weekday: width === "narrow" ? "short" : width, timeZone: "UTC" };
        return new Intl.DateTimeFormat(culture || undefined, opts).format(utcAnchor(p));
    } catch {
        if (kind === "month") {
            const long = EN_MONTHS_LONG[p.month - 1] ?? "";
            if (width === "long") return long;
            return width === "narrow" ? long.slice(0, 1) : (EN_MONTHS_SHORT[p.month - 1] ?? "");
        }
        return (width === "long" ? EN_DAYS_LONG[p.weekday] : EN_DAYS_SHORT[p.weekday]) ?? "";
    }
}

const p2 = (n: number) => (n < 10 ? "0" : "") + n;

function renderFormat(format: string, p: Parts, dialect: SourceFormatDialect, culture?: string): string | null {
    const tokens = tokenize(format, dialect);
    if (dialect === "excel") resolveAmbiguousM(tokens);
    // A 12-hour clock is declared by the presence of a meridiem token in Excel; .NET declares it
    // per hour token (`h` vs `H`), which this table has already flattened, so the same test
    // serves both and a `.NET` format with `hh` and no `tt` prints a 24-hour hour. That is the
    // rarer wrong answer than assuming 12-hour and dropping the distinction entirely.
    const twelve = tokens.some(t => t.kind === "meridiemLong" || t.kind === "meridiemShort");
    const hour12 = () => {
        const h = p.hours % 12;
        return h === 0 ? 12 : h;
    };

    let out = "";
    let sawField = false;
    for (const t of tokens) {
        switch (t.kind) {
            case "literal": out += t.text ?? ""; break;
            case "year4": out += String(p.year); sawField = true; break;
            case "year2": out += p2(((p.year % 100) + 100) % 100); sawField = true; break;
            case "monthLong": out += name(p, "month", "long", culture); sawField = true; break;
            case "monthShort": out += name(p, "month", "short", culture); sawField = true; break;
            case "monthNarrow": out += name(p, "month", "long", culture).slice(0, 1); sawField = true; break;
            case "month2": out += p2(p.month); sawField = true; break;
            case "month1": out += String(p.month); sawField = true; break;
            case "weekdayLong": out += name(p, "weekday", "long", culture); sawField = true; break;
            case "weekdayShort": out += name(p, "weekday", "short", culture); sawField = true; break;
            case "day2": out += p2(p.day); sawField = true; break;
            case "day1": out += String(p.day); sawField = true; break;
            case "hour2": out += p2(twelve ? hour12() : p.hours); sawField = true; break;
            case "hour1": out += String(twelve ? hour12() : p.hours); sawField = true; break;
            case "minute2": out += p2(p.minutes); sawField = true; break;
            case "minute1": out += String(p.minutes); sawField = true; break;
            case "second2": out += p2(p.seconds); sawField = true; break;
            case "second1": out += String(p.seconds); sawField = true; break;
            case "fraction": out += String(p.ms).padStart(3, "0"); sawField = true; break;
            case "meridiemLong": out += p.hours < 12 ? "AM" : "PM"; sawField = true; break;
            case "meridiemShort": out += p.hours < 12 ? "A" : "P"; sawField = true; break;
        }
    }
    // Nothing recognised means this file did not understand the format, whatever `hasDateToken`
    // thought. Returning null hands the value to the locale fallback rather than to a string of
    // punctuation with no numbers in it.
    return sawField && out.trim() ? out : null;
}
