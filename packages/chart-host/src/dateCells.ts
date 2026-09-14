// WHICH CLOCK A CHART READS ITS DATES IN - and so whether a host may re-anchor a local-midnight date cell.
//
// The render contract says a date with no time of day is the UTC midnight of its day, and generated
// code reads it with UTC accessors. A host whose source hands dates over at the reader's LOCAL midnight
// (a Power BI plain date field) breaks that east of Greenwich, where the serialised instant falls on the
// previous UTC day. The fix is to re-anchor the cell before serialising (shape-core
// normalizeLocalMidnightDates) - but ONLY for a chart that reads no date in local time. Code written
// against local time (getMonth, d3.timeFormat, d3.scaleTime, a formatter with no timeZone) reads a
// local-midnight date correctly in every zone today; handed UTC midnight instead, it would print the
// day BEFORE the cell west of Greenwich. So the rule is "never worse": re-anchor only when the artifact
// shows no local read at all.
//
// Textual on purpose, and biased to the safe side: a local-time token anywhere - a comment, a string -
// counts as a local read and leaves the data exactly as the host has always sent it. The server applies
// the same rule to the code it generates, from a real parse; a scan here that says "local" where the
// parse would not costs a fix, never a regression.

const LOCAL_DATE_METHOD = /\.(?:getFullYear|getMonth|getDate|getDay|getHours|getMinutes|setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds|setMilliseconds)\s*\(/;
const D3_LOCAL_TIME = /\bd3\s*\.\s*(?:scaleTime|time[A-Z]\w*)\b/;
// `new Date(y, m, d)` is built from LOCAL components; `new Date(Date.UTC(y, m, d))` is not, and the
// character class stops at the inner parenthesis so it never matches.
const DATE_FROM_LOCAL_COMPONENTS = /\bnew\s+Date\s*\(\s*[^(),]+,/;
const FORMATTER = /\bIntl\s*\.\s*DateTimeFormat\b|\.toLocaleDateString\s*\(|\.toLocaleTimeString\s*\(/;

/** True when generated JavaScript (a D3 render function) reads or builds a date in LOCAL time anywhere,
 *  or formats one with no `timeZone`. A host must not re-anchor date cells for such code. */
export function codeReadsDatesInLocalTime(code: string | null | undefined): boolean {
    if (!code) return false;
    if (LOCAL_DATE_METHOD.test(code) || D3_LOCAL_TIME.test(code) || DATE_FROM_LOCAL_COMPONENTS.test(code)) return true;
    return FORMATTER.test(code) && !/timeZone/.test(code);
}

// Vega's expression language has LOCAL date functions (month(), timeFormat() ...) beside utc twins; a
// Vega scale of type "time" and a Vega-Lite timeUnit without the utc prefix are local, and a Vega-Lite
// temporal field formats in local time unless its scale is "utc".
const VEGA_LOCAL_FN = /\b(?:year|quarter|month|date|day|dayofyear|week|hours|minutes|seconds|milliseconds|datetime|time|timeFormat|timeParse|timeOffset|timeSequence|timeUnitSpecifier)\s*\(/;
const VEGA_LOCAL_TIMEUNIT = /"timeUnit"\s*:\s*"(?!utc)[a-z]/i;
const VEGA_LOCAL_UNIT = /"unit"\s*:\s*"(?!utc)(?:year|quarter|month|week|day|date|dayofyear|hours|minutes|seconds|milliseconds)/i;
const VEGA_TIME_SCALE = /"type"\s*:\s*"time"/;
const VEGA_TEMPORAL = /"type"\s*:\s*"temporal"/;
const VEGA_UTC_SCALE = /"type"\s*:\s*"utc"/;

/** True when a Vega or Vega-Lite spec reads dates in LOCAL time anywhere. Same "never worse" rule. */
export function vegaSpecReadsDatesInLocalTime(spec: string | null | undefined): boolean {
    if (!spec) return false;
    if (VEGA_LOCAL_FN.test(spec) || VEGA_LOCAL_TIMEUNIT.test(spec) || VEGA_LOCAL_UNIT.test(spec) || VEGA_TIME_SCALE.test(spec)) return true;
    return VEGA_TEMPORAL.test(spec) && !VEGA_UTC_SCALE.test(spec);
}
