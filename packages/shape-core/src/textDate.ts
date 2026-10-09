// A DATE WRITTEN AS TEXT, READ FIELD BY FIELD - never by `Date.parse`.
//
// WHY THIS EXISTS. `Date.parse` is not a date reader, it is a guess with a locale hard-wired into it:
// it reads `05.01.2024` as the 1st of May, whoever wrote the file and wherever it is read. Every
// German, Russian, French, Spanish and Dutch file whose days are all 12 or under became a date column
// with its days and months swapped, silently, and a column with a single day over 12 stopped being a
// date at all (the engine fell back to text with a pattern). The same engine did not know a year
// first with a trailing dot (`2024. 3. 15.`), a month in words in any language, or the Japanese and
// Korean year-month-day markers. This reader takes the fields apart itself and decides the ORDER once
// per column, from the column.
//
// THE ORDER OF `a/b/yyyy` IS A COLUMN'S, DECIDED IN THIS ORDER:
//   1. the VALUES, when any can: a first field over 12 is a day, a second field over 12 is a month;
//      values that claim both orders are not one date column at all;
//   2. the LOCALE the caller names, when the values cannot: month first for the United States family,
//      day first for the rest of the world (`monthFirstLocale`);
//   3. with no locale at all, DAY first here. `ingest` names its default locale (`en`, month first)
//      before it asks, so a caller that says nothing keeps the reading it always had.
// A year that comes first, a month written in words, and the CJK markers carry their own order.
//
// WHAT IT WILL NOT READ, on purpose:
//   - a two-digit year (`12/05/24` has too many readings to call a date);
//   - a date that does not exist (`31.02.2024`, `29 February 2023`): one such value and the column is
//     text, because a value read wrongly is worse than a value left alone;
//   - ISO `2024-03-15` (with or without a time or a zone): the engine's ISO reader owns that shape,
//     and this reader never claims it, so an ISO column reads exactly as before;
//   - a dotted year-first `2024.3.1` with nothing to say it is a date (a calendar-versioned release
//     number looks the same): it must be zero-padded (`2024.03.01`), spaced, or end in a dot;
//   - a column in two shapes: one pattern would silently misread half of it.
// EVERY non-blank value must read, or the column is not read at all. A straggler is a label, and a
// label is never deleted by being typed as a date.
//
// A TIME OF DAY (`10:30`, `10:30:15`, `1:05 PM`) after the date is read as a WALL CLOCK anchored to
// UTC, the reading `parseDateStable` gives every other zone-less text, so the same file is the same
// instants on every machine.

import { normalizeMonthKey, readMonthWords } from "./monthNames";

export type TextDateOrder = "ymd" | "dmy" | "mdy";
export type TextDateForm = "numeric" | "named" | "cjk";

export interface TextDateColumn {
    /** The family of shape the column is written in. */
    form: TextDateForm;
    /** The order the date's fields are written in. */
    order: TextDateOrder;
    /** How the order was settled: by the shape, by a value that decided it, or by the locale. */
    orderFrom: "shape" | "values" | "locale";
    /**
     * A strptime / d3.timeParse specifier for the column's shape (`%d.%m.%Y`, `%Y. %m. %d.`,
     * `%Y年%m月%d日`), the vocabulary `temporalTextPattern` speaks. Absent for a month in words (a
     * specifier cannot name another language's month) and for a 12-hour clock.
     */
    pattern?: string;
    /** True when some value carries a time of day. */
    hasTime: boolean;
    /** The instant a value of this column spells (UTC), or null when it is not one. */
    read(raw: unknown): Date | null;
}

/**
 * The month-first convention is, in practice, the United States (and a few neighbours that follow
 * its forms). Everything else - en-GB, en-AU, en-IN, every es, de, fr, pt - reads day first. A missing
 * locale is day first here because most of the world is.
 */
export function monthFirstLocale(locale?: string): boolean {
    const l = (locale || "").toLowerCase();
    return l === "en-us" || l === "en" || l.startsWith("en-us-") || l === "en-ph" || l === "en-bz";
}

// ── Scanning one value ────────────────────────────────────────────────────────────────────────

interface Clock { h: number; mi: number; s: number; seconds: boolean; meridiem: boolean }

interface Scan {
    form: TextDateForm;
    /** The shape the whole column must share. */
    key: string;
    clock: Clock | null;
    /** Numeric: the three fields in the order written. */
    a: number; b: number; c: number;
    yearFirst: boolean;
    /** Numeric and CJK: the literal text between the fields, for the pattern. */
    sep: string; trail: string;
    /** Named: the month word, the day, the year, and the order they were written in. */
    word: string; day: number; year: number; namedOrder: TextDateOrder;
    /** CJK: the pattern. */
    cjkPattern: string;
}

const EMPTY_SCAN = { a: 0, b: 0, c: 0, yearFirst: false, sep: "", trail: "", word: "", day: 0, year: 0, namedOrder: "dmy" as TextDateOrder, cjkPattern: "" };

const TIME_TAIL = /\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d{1,9})?)?(?:\s*([ap])\.?\s?m\.?)?$/i;
const NUMERIC = /^(\d{1,4})(\s*[./-]\s*)(\d{1,2})(\s*[./-]\s*)(\d{1,4})(\.?)$/;
const CJK = /^(\d{4})(\s*[年년]\s*)(\d{1,2})(\s*[月월]\s*)(\d{1,2})(\s*[日일号])$/;
const ORDINAL = /(\d)(?:st|nd|rd|th|er|º|ª)(?=[\s.,/-]|$)/gi;
const FILLERS = new Set(["de", "del", "of"]);
// What Russian, Ukrainian and Polish write after the year: `5 марта 2024 г.`, `5 березня 2024 р.`.
const YEAR_MARKERS = new Set(["г", "р", "r"]);
// Letters and marks, plus the Devanagari abbreviation sign (`जन॰`) and the Hebrew geresh (`בינו׳`),
// which are punctuation to Unicode and part of the word to its reader.
const WORD = /^[\p{L}\p{M}॰׳]+$/u;
const DIGITS = /^\d+$/;

function readClock(m: RegExpExecArray): Clock | null {
    let h = +m[1];
    const mi = +m[2], s = m[3] === undefined ? 0 : +m[3];
    const meridiem = m[4] !== undefined;
    if (mi > 59 || s > 59) return null;
    if (meridiem) {
        if (h < 1 || h > 12) return null;
        h = (h % 12) + (m[4].toLowerCase() === "p" ? 12 : 0);
    } else if (h > 23) return null;
    return { h, mi, s, seconds: m[3] !== undefined, meridiem };
}

/** One value taken apart, or null when it is no date this reader knows. `iso` marks the shape the
 *  engine's own ISO reader owns. */
function scan(raw: string): Scan | "iso" | null {
    // Bidi marks ride inside right-to-left locales' dates and mean nothing.
    let s = raw.replace(/[‎‏؜]/g, "").replace(/\s+/g, " ").trim();
    if (s === "") return null;

    let clock: Clock | null = null;
    const t = TIME_TAIL.exec(s);
    if (t) {
        clock = readClock(t);
        if (!clock) return null;
        s = s.slice(0, t.index);
    }

    let m: RegExpExecArray | null;
    if ((m = CJK.exec(s))) {
        const key = `cjk|${m[2]}|${m[4]}|${m[6]}`;
        return {
            ...EMPTY_SCAN, form: "cjk", key, clock, a: +m[1], b: +m[3], c: +m[5], yearFirst: true,
            cjkPattern: `%Y${m[2]}%m${m[4]}%d${m[6]}`,
        };
    }

    if ((m = NUMERIC.exec(s))) {
        const sep1 = m[2], sep2 = m[4];
        if (sep1 !== sep2) return null;
        const ch = sep1.trim();
        const trail = m[6];
        if (trail && ch !== ".") return null;
        const widths = [m[1].length, m[3].length, m[5].length];
        const yearFirst = widths[0] === 4;
        const yearLast = widths[2] === 4;
        if (yearFirst === yearLast) return null;                       // no year, or two
        if (yearFirst ? (widths[1] > 2 || widths[2] > 2) : (widths[0] > 2 || widths[1] > 2)) return null;
        if (yearFirst && ch === "-" && sep1 === "-" && widths[1] === 2 && widths[2] === 2) return "iso";
        // `2024.3.1` could be a release number; a date says so (zero-padded, spaced, or a closing dot).
        if (yearFirst && ch === "." && sep1 === "." && !trail && !(widths[1] === 2 && widths[2] === 2)) return null;
        return {
            ...EMPTY_SCAN, form: "numeric", key: `num|${yearFirst ? "y" : "x"}|${sep1}|${trail}`, clock,
            a: +m[1], b: +m[3], c: +m[5], yearFirst, sep: sep1, trail,
        };
    }

    // A month in words: a day, a word and a four-digit year, in one of three orders.
    const pieces = s.replace(ORDINAL, "$1").split(/[\s.,/-]+/).filter(p => p !== "" && !FILLERS.has(p.toLowerCase()));
    if (pieces.length === 4 && DIGITS.test(pieces[2]) && YEAR_MARKERS.has(pieces[3].toLowerCase())) pieces.pop();
    if (pieces.length !== 3) return null;
    const kinds = pieces.map(p => (DIGITS.test(p) ? "N" : WORD.test(p) ? "W" : "?")).join("");
    const nums = pieces.map(p => (DIGITS.test(p) ? p : ""));
    let day = 0, year = 0, word = "", order: TextDateOrder;
    if (kinds === "NWN" && nums[0].length <= 2 && nums[2].length === 4) { day = +nums[0]; word = pieces[1]; year = +nums[2]; order = "dmy"; }
    else if (kinds === "WNN" && nums[1].length <= 2 && nums[2].length === 4) { word = pieces[0]; day = +nums[1]; year = +nums[2]; order = "mdy"; }
    else if (kinds === "NWN" && nums[0].length === 4 && nums[2].length <= 2) { year = +nums[0]; word = pieces[1]; day = +nums[2]; order = "ymd"; }
    else return null;
    return { ...EMPTY_SCAN, form: "named", key: `named|${order}`, clock, day, year, word, namedOrder: order };
}

// ── The calendar ─────────────────────────────────────────────────────────────────────────────

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function validDay(y: number, mo: number, d: number): boolean {
    if (!(y >= 1 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1)) return false;
    return d <= (mo === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[mo - 1]);
}

/** The UTC instant of a wall clock. `Date.UTC` maps years 0-99 onto 1900-1999, so the year is set
 *  afterwards; the template year is a leap year so a 29 February survives the round trip. */
function utc(y: number, mo: number, d: number, clock: Clock | null): Date {
    const t = new Date(Date.UTC(2000, mo - 1, d, clock?.h ?? 0, clock?.mi ?? 0, clock?.s ?? 0));
    t.setUTCFullYear(y);
    return t;
}

// ── A column ─────────────────────────────────────────────────────────────────────────────────

/**
 * Read a column of text as dates, or null when it is not entirely dates in ONE shape this reader
 * knows. A value that is not text (a number, a Date) makes the column not this reader's: the engine
 * already knows what to do with a typed value. Blanks are skipped.
 *
 * `locale` is the tiebreak for a numeric `a/b/yyyy` column whose values do not say which field is
 * the day, and the tiebreak between two languages that read a month word differently.
 *
 * `floor` (default 1, every value) is the share of the non-blank values that must read, in the one
 * shape most of them share; the rest are stragglers and are left unread. A TYPE needs all of them,
 * because a typed straggler is a deleted value. A FLAG ("this column is a time axis") has always
 * tolerated a few labels, and asks for 0.8. A value that is not text counts as a straggler there.
 */
export function readTextDateColumn(values: Iterable<unknown>, opts: { locale?: string; floor?: number } = {}): TextDateColumn | null {
    const strict = (opts.floor ?? 1) >= 1;
    const seen = new Map<string, Scan | "iso" | null>();
    const perKey = new Map<string, number>();
    let nonblank = 0;
    let first: Scan | null = null;
    for (const raw of values) {
        if (raw === null || raw === undefined) continue;
        if (typeof raw !== "string") {
            if (strict) return null;
            nonblank++;
            continue;
        }
        const text = raw.trim();
        if (text === "") continue;
        nonblank++;
        let sc = seen.get(text);
        if (sc === undefined) { sc = scan(text); seen.set(text, sc); }
        if (sc === null || sc === "iso") {
            if (strict) return null;
            continue;
        }
        if (strict) {
            if (first === null) first = sc;
            else if (sc.key !== first.key) return null;
        } else {
            perKey.set(sc.key, (perKey.get(sc.key) ?? 0) + 1);
        }
    }
    if (!strict) {
        let best = 0, bestKey = "";
        for (const [k, n] of perKey) if (n > best) { best = n; bestKey = k; }
        if (best === 0 || best / nonblank < (opts.floor as number)) return null;
        first = [...seen.values()].find((sc): sc is Scan => sc !== null && sc !== "iso" && sc.key === bestKey) ?? null;
    }
    if (first === null) return null;
    const key = first.key;
    const scans = ([...seen.values()] as Array<Scan | "iso" | null>).filter((sc): sc is Scan => sc !== null && sc !== "iso" && sc.key === key);

    let order: TextDateOrder;
    let orderFrom: TextDateColumn["orderFrom"] = "shape";
    let months: Map<string, number> | null = null;

    if (first.form === "named") {
        order = first.namedOrder;
        months = readMonthWords(scans.map(sc => sc.word), opts.locale);
        if (!months) return null;
    } else if (first.form === "cjk" || first.yearFirst) {
        order = "ymd";
    } else {
        let firstOver12 = 0, secondOver12 = 0;
        for (const sc of scans) {
            if (sc.a > 12) firstOver12++;
            if (sc.b > 12) secondOver12++;
        }
        // Both directions claiming is a column that is not one consistent date shape at all.
        if (firstOver12 > 0 && secondOver12 > 0) return null;
        if (firstOver12 > 0) { order = "dmy"; orderFrom = "values"; }
        else if (secondOver12 > 0) { order = "mdy"; orderFrom = "values"; }
        else { order = monthFirstLocale(opts.locale) ? "mdy" : "dmy"; orderFrom = "locale"; }
    }

    const fields = (sc: Scan): [number, number, number] | null => {
        if (sc.form === "named") {
            const mo = months!.get(normalizeMonthKey(sc.word));
            return mo === undefined ? null : [sc.year, mo + 1, sc.day];
        }
        if (sc.yearFirst) return [sc.a, sc.b, sc.c];
        return order === "dmy" ? [sc.c, sc.b, sc.a] : [sc.c, sc.a, sc.b];
    };

    // Every distinct value must be a day that exists, or (strictly) the column is not read; with a
    // floor, a day that does not exist is one more straggler.
    let lowYear = Infinity, highYear = -Infinity;
    let impossible = 0;
    for (const sc of scans) {
        const f = fields(sc);
        if (!f || !validDay(f[0], f[1], f[2])) {
            if (strict) return null;
            impossible++;
            continue;
        }
        lowYear = Math.min(lowYear, f[0]);
        highYear = Math.max(highYear, f[0]);
    }
    if (!strict && (perKey.get(key)! - impossible) / nonblank < (opts.floor as number)) return null;
    // A column whose every year is 2400-2699 is the Thai Buddhist calendar (2567 is 2024), not the
    // year 2567. Read as Gregorian it would be a date 543 years off, drawn without a flaw; left as
    // text it is at least left alone. No ordinary business column lives wholly in those centuries.
    if (lowYear >= 2400 && highYear <= 2699) return null;

    const column: TextDateColumn = {
        form: first.form,
        order,
        orderFrom,
        hasTime: scans.some(sc => sc.clock !== null),
        read(raw: unknown): Date | null {
            if (typeof raw !== "string") return null;
            const text = raw.trim();
            if (text === "") return null;
            let sc = seen.get(text);
            if (sc === undefined) { sc = scan(text); seen.set(text, sc); }
            if (sc === null || sc === "iso" || sc.key !== key) return null;
            const f = fields(sc);
            if (!f || !validDay(f[0], f[1], f[2])) return null;
            return utc(f[0], f[1], f[2], sc.clock);
        },
    };

    // The specifier, where the shape can be named in one: not a month in words, not a 12-hour clock.
    if (first.form !== "named" && !scans.some(sc => sc.clock?.meridiem)) {
        let date: string;
        if (first.form === "cjk") date = first.cjkPattern;
        else if (first.yearFirst) date = `%Y${first.sep}%m${first.sep}%d${first.trail}`;
        else date = (order === "dmy" ? `%d${first.sep}%m${first.sep}%Y` : `%m${first.sep}%d${first.sep}%Y`) + first.trail;
        const withClock = scans.filter(sc => sc.clock !== null).length;
        if (withClock === 0) column.pattern = date;
        // Time of day is part of the pattern only when EVERY value carries it.
        else if (withClock === scans.length) {
            column.pattern = date + (scans.every(sc => sc.clock!.seconds) ? " %H:%M:%S" : " %H:%M");
        }
    }
    return column;
}
