// Package-owned pure utilities. These were previously reached via the visual's
// `lib/shared/Shared` (a large, PBI/DOM-coupled grab-bag); shape-core copies only
// the three pure functions the profiler needs so the package has NO dependency
// back into the visual. Keep these byte-equivalent to Shared's versions — the
// visual and the MCP client must profile identically. (If Shared's versions ever
// change, mirror the change here; a divergence would make the two hosts disagree.)

/** The WORDS in a column name, lowercased — "OlympicYear" → ["olympic", "year"], "fiscal_year"
 *  → ["fiscal", "year"]. NOT a Shared mirror: package-owned, and the ONE reading of a name.
 *
 *  Collapsed from FOUR copies (2026-09-04) — geoDetector, ordinalDetector, isIdentifierName, and
 *  in raw-regex form the temporal year-name test. The fourth is why this moved: it matched
 *  /\b(year|yr|fy)\b/ against the RAW name, and `\b` cannot fire between two word characters, so
 *  neither "OlympicYear" (camelCase) nor "fiscal_year" (an underscore IS a word character) ever
 *  matched. On an integer column of Olympic years the name path was the only one open — the
 *  consecutive-fill fallback wants every integer in the range and the Games are every four years —
 *  so isTemporal came back false and every chart type that requires a date was refused on that
 *  shape. Three name tests already read names as words; the fourth did not, and nothing made them
 *  agree.
 *
 *  Two boundaries and no others — camelCase, then the `_ - . /` separators. A consumer that
 *  re-derives this rule for itself has to match it exactly: this flag is read first and such a
 *  consumer only falls back to its own copy, so widening one side alone decides the same column
 *  two different ways depending on which side sees it. */
export function nameWords(name: string): string[] {
    if (!name) return [];
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase → words
        .replace(/[_\-./]+/g, " ")                 // separators → space
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0);
}

/** Null/undefined-safe stringify. Mirrors Shared.STR. */
export function STR(v: any): string {
    if (v !== undefined && v !== null) {
        return v.toString();
    }
    return "";
}

/** FNV-1a string hash masked to a JS-safe 53-bit integer. Mirrors
 *  Shared.SIMPLE_STRING_HASH. Deterministic — safe for stable keys. */
export function SIMPLE_STRING_HASH(str: string): number {
    if (!str) return 0;

    const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
    const FNV_PRIME = 0x100000001b3n;

    let hash = FNV_OFFSET_BASIS;

    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = (hash * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn; // Keep it within 64 bits
    }

    return Number(hash & 0x1FFFFFFFFFFFFFn); // Mask to JS safe integer (53 bits)
}

/** Uniform [0,1). Mirrors Shared.GET_RANDOM. Used ONLY by the sample-obfuscation
 *  path, never by stat/shape derivation — so the emitted SHAPE stats stay
 *  deterministic across runs and across hosts even though the obfuscated sample
 *  text does not. Prefers Web Crypto (browser + Node >=19 expose globalThis.crypto);
 *  falls back so the package never throws in a bare runtime. */
export function GET_RANDOM(): number {
    const g: any = (typeof globalThis !== "undefined") ? globalThis : {};
    if (g.crypto && typeof g.crypto.getRandomValues === "function") {
        const array = new Uint32Array(1);
        g.crypto.getRandomValues(array);
        return array[0] / (0xFFFFFFFF + 1);
    }
    // Last-resort fallback (no Web Crypto present). Obfuscation-only, so a weaker
    // source is acceptable here; stat derivation never reaches this.
    return Math.floor(Date.now() % 0xFFFFFFFF) / (0xFFFFFFFF + 1);
}

/**
 * Is this generate answer a VERDICT the server reached before any model ran - so that asking
 * again returns the same answer at the same price of nothing?
 *
 * The one rule, in one place, for every host with a retry loop. The Power BI visual used to
 * treat every non-empty errorMessage as a transient server error and re-send one refused
 * explicit pick three times per click; the MCP client refused to retry such an answer only by
 * omission (isServiceError was false). The server now says it on the wire as `isRefusal`, and
 * this predicate is the only thing a host needs to consult. Strict: only an explicit `true`
 * counts, so an older server (no field) and a transient failure both read as "not a verdict".
 */
export function isDeterministicRefusal(r: { isRefusal?: boolean | null } | null | undefined): boolean {
    return !!r && r.isRefusal === true;
}

/**
 * Parse a date STRING to a Date that means the same thing on every machine.
 *
 * `Date.parse` is not one rule, it is three, and only the first is portable:
 *   - an ISO DATE (`2024-03-15`, `2024-03`, `2024`) is UTC, by spec;
 *   - an ISO DATE-TIME with no zone (`2024-03-15T10:30:00`) is LOCAL, by spec;
 *   - anything else (`3/15/2024`, `March 15, 2024 10:30 AM`) is implementation-defined, and
 *     every engine that matters reads it as LOCAL.
 *
 * So a CSV column of `3/15/2024 10:30 AM` became 17:30Z in Los Angeles and 01:30Z in Tokyo, and
 * the profile that shipped differed by machine. The whole-day cases were rescued
 * downstream by `wholeDayIso`, which accepts midnight in EITHER frame - but a value carrying a
 * TIME has no such tell, and no read-side rule can recover an instant that was already wrong.
 *
 * THE RULE: when the text states a zone, believe it. When it does not, the text states a WALL
 * CLOCK, and the only stable reading of a wall clock is to anchor it to UTC - the same reading
 * everywhere, and the one the author wrote. An ISO date-only string is already UTC and is left
 * exactly alone, because re-anchoring it would drag it a day backwards west of Greenwich, which
 * is the very bug this file is closing.
 */
export function parseDateStable(s: string): Date | null {
    const t = Date.parse(s);
    if (isNaN(t)) return null;
    const d = new Date(t);
    // Already unambiguous: an ISO date (UTC by spec), or a stated offset / zone name.
    if (ISO_DATE_ONLY_RE.test(s) || EXPLICIT_OFFSET_RE.test(s.trim()) || NAMED_ZONE_RE.test(s)) return d;
    const utc = new Date(Date.UTC(
        d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()));
    // Date.UTC maps years 0-99 onto 1900-1999; setUTCFullYear does not.
    const y = d.getFullYear();
    if (y >= 0 && y < 100) utc.setUTCFullYear(y);
    return utc;
}

/**
 * WHICH CLOCK IS THIS DATE MIDNIGHT ON - "utc", "local", or null when it carries a time of day.
 *
 * THIS IS THE ONE PLACE A DATE IS ALLOWED TO BECOME A DAY, and it exists because the code that
 * came before asked `getHours()` - LOCAL time - of Dates that had been built in UTC. The Excel
 * add-in converts a serial with `Date.UTC(1899,11,30)+days`; an ISO text date parses to UTC
 * midnight; the visual's date-unshredder builds `Date.UTC(y,m,d)`. On any machine west of
 * Greenwich every one of those read as 16:00 or 17:00 the PREVIOUS day, so `dateWithTime` was
 * true for every date column, `valueNature` flipped from Ordinal to Continuous - a picker input -
 * and the day printed one earlier than the cell showed.
 *
 * WHY BOTH FRAMES. A Date is whole-day if it is midnight in EITHER UTC or local time, because
 * both kinds exist in the wild: the sources above build UTC midnight, while a Date parsed from a
 * timezone-less ISO datetime (Power BI's host hands those over) is LOCAL midnight. Reading only
 * UTC would have fixed Excel by breaking the visual. The day is then taken from the frame the
 * Date is midnight in, which is the day the author meant.
 *
 * THE RESIDUAL EDGE, stated rather than hidden: a genuine timestamp that happens to fall exactly
 * on the local-vs-UTC offset (17:00 PDT is 00:00Z) reads as a whole day. Every column-level flag
 * built on this is an OR over every value, so a column is only misread if EVERY value sits on
 * that exact minute - a dataset that is, for every practical purpose, a date column.
 *
 * EXPORTED because two packages need the same answer and must not each keep their own. The
 * profiler asks it to decide what a column IS; chart-host's selection card asks it to decide
 * which clock to PRINT. Two copies of a rule this subtle disagree the first time either is
 * touched, and the disagreement surfaces as a day-off date in one host only.
 */
export function wholeDayFrame(date: any): "utc" | "local" | null {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0
        && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0) return "utc";
    if (date.getHours() === 0 && date.getMinutes() === 0
        && date.getSeconds() === 0 && date.getMilliseconds() === 0) return "local";
    return null;
}

/** The calendar day a WHOLE-DAY Date stands for, as "YYYY-MM-DD" - or null when it carries a
 *  real time of day. The day is read from the frame `wholeDayFrame` names, which is the whole
 *  point: the same Date has to print the same day on every machine. */
export function wholeDayIso(date: any): string | null {
    const frame = wholeDayFrame(date);
    if (!frame) return null;
    const d = date as Date;
    if (frame === "utc") return d.toISOString().slice(0, 10);
    const p2 = (n: number) => (n < 10 ? "0" : "") + n;
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** ISO calendar dates, which Date.parse already reads as UTC: YYYY, YYYY-MM, YYYY-MM-DD. */
const ISO_DATE_ONLY_RE = /^\s*\d{4}(-\d{2}(-\d{2})?)?\s*$/;
/** A trailing `Z` or `+HH:MM` / `-HHMM` - an offset the author actually stated. */
const EXPLICIT_OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
/** A named zone anywhere in the text ("... GMT-0700 (Pacific Daylight Time)", "10:30 UTC"). */
const NAMED_ZONE_RE = /\b(?:GMT|UTC)\b/i;
