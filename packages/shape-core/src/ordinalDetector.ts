// ──────────────────────────────────────────────────────────────────────────
// Client-side ordinal-scale detector
// ──────────────────────────────────────────────────────────────────────────
//
// Server-side detection is impossible: by the time the request reaches the
// server, the actual category values have been obfuscated for privacy in
// IndexedText.obfuscateString. The LLM sees random-looking strings instead
// of "Strongly Disagree" / "Agree" / "Neutral".
//
// Detection MUST happen client-side, before obfuscation. We then ship two
// new column-level fields to the server (orderedDomain + ordinalPattern)
// that name a KNOWN ordinal scale (Likert, frequency, intensity, severity,
// quality, etc.) and provide the canonical order using the USER'S OWN
// value strings — preserving their capitalization / spacing / pluralization
// so the LLM can pass the array directly into a `domain(...)` call at
// render time without a re-mapping step.
//
// Privacy posture (2026-05-26): Likert-class category names are
// public-domain terminology and not user secrets — they're the same in
// every survey-research textbook on Earth. Shipping the matched values is
// equivalent to shipping the chart's eventual axis tick labels (which the
// LLM-emitted code reads from data.rows at render time anyway). We only
// ship values when they MATCH a known ordinal catalog pattern; non-matches
// pass through to the existing obfuscation flow unchanged.
//
// The detector is conservative — it requires enough anchors of a known
// pattern to be confident (default ≥3 distinct matched values for 5+ pt
// scales, ≥2 for 3-4 pt scales) AND the user's set must be a subset of the
// pattern (so a column with "Strongly Disagree, Disagree, Pineapple" won't
// trip — Pineapple isn't in the Likert catalog).
//
// Returns null when no pattern matches → caller falls through to the
// existing obfuscation pipeline (orderedDomain stays undefined on the
// shipped column).

type OrdinalPattern = {
    name: string;
    // Canonical pattern values in their inherent order, lowercased + space-
    // normalized for matching. The user's actual values may use different
    // capitalization / hyphens / extra whitespace; we normalize before
    // comparing.
    canonical: string[];
    // Minimum distinct user values that must match a pattern entry.
    // Higher for shorter patterns to avoid false-positive on coincidences
    // (e.g. a 3-pt pattern needs 2 of 3 matched to fire, not just 1).
    minMatches: number;
};

// Catalog ordered most-specific → most-generic. First match wins, so 5/7-pt
// scales beat 3-pt scales when both could match a user's value set.
const PATTERNS: OrdinalPattern[] = [
    // Likert agreement — the case that motivated this whole feature
    { name: "likert7_agreement", minMatches: 5,
      canonical: ["strongly disagree", "disagree", "slightly disagree", "neutral", "slightly agree", "agree", "strongly agree"] },
    { name: "likert5_agreement", minMatches: 3,
      canonical: ["strongly disagree", "disagree", "neutral", "agree", "strongly agree"] },
    { name: "likert3_agreement", minMatches: 2,
      canonical: ["disagree", "neutral", "agree"] },

    // Satisfaction
    { name: "likert5_satisfaction", minMatches: 3,
      canonical: ["very dissatisfied", "dissatisfied", "neutral", "satisfied", "very satisfied"] },
    { name: "likert3_satisfaction", minMatches: 2,
      canonical: ["dissatisfied", "neutral", "satisfied"] },

    // Quality
    { name: "likert5_quality", minMatches: 3,
      canonical: ["poor", "fair", "good", "very good", "excellent"] },
    { name: "likert3_quality", minMatches: 2,
      canonical: ["poor", "fair", "good"] },

    // Frequency
    { name: "frequency5", minMatches: 3,
      canonical: ["never", "rarely", "sometimes", "often", "always"] },

    // Intensity — common in psychology / wellness surveys
    { name: "intensity5", minMatches: 3,
      canonical: ["not at all", "slightly", "moderately", "very", "extremely"] },

    // Importance
    { name: "importance5", minMatches: 3,
      canonical: ["not important", "slightly important", "moderately important", "very important", "extremely important"] },

    // Severity / priority / urgency — common in IT / clinical / ops data
    { name: "severity_low_critical", minMatches: 3,
      canonical: ["low", "medium", "high", "critical"] },
    // Support/ops priority where the top band is "Urgent" (not "Critical").
    // Distinct catalog entry so the subset check passes for {Low,Medium,High,
    // Urgent} (the city_311 case where the LLM otherwise invented a generic
    // Critical/High/Normal/Low taxonomy because no orderedDomain shipped).
    { name: "severity_low_urgent", minMatches: 3,
      canonical: ["low", "medium", "high", "urgent"] },
    { name: "severity_none_critical", minMatches: 3,
      canonical: ["none", "mild", "moderate", "severe", "critical"] },
    { name: "priority_p4_p1", minMatches: 3,
      canonical: ["p4", "p3", "p2", "p1", "p0"] },
    // Jira-style issue priority (Blocker highest).
    { name: "severity_trivial_blocker", minMatches: 3,
      canonical: ["trivial", "minor", "major", "critical", "blocker"] },
    { name: "severity_minor_severe", minMatches: 3,
      canonical: ["minor", "moderate", "major", "severe"] },

    // Generic magnitude / confidence bands (two spellings of the mid value:
    // 'medium' vs 'moderate' — separate patterns so the subset check is exact).
    { name: "magnitude5_medium", minMatches: 3,
      canonical: ["very low", "low", "medium", "high", "very high"] },
    { name: "magnitude5_moderate", minMatches: 3,
      canonical: ["very low", "low", "moderate", "high", "very high"] },

    // Speed
    { name: "speed5", minMatches: 3,
      canonical: ["very slow", "slow", "moderate", "fast", "very fast"] },

    // Temperature (qualitative)
    { name: "temperature6", minMatches: 3,
      canonical: ["freezing", "cold", "cool", "mild", "warm", "hot"] },

    // Skill / experience ladder
    { name: "experience6", minMatches: 3,
      canonical: ["novice", "beginner", "intermediate", "advanced", "expert", "master"] },

    // Membership / loyalty tiers (metal ladder)
    { name: "tier_metal", minMatches: 3,
      canonical: ["bronze", "silver", "gold", "platinum", "diamond"] },

    // T-shirt sizes — letter form. Single letters are short/ambiguous, so
    // require 4 anchors to fire (keeps {M,F} gender / {A,B} groups from
    // tripping it).
    { name: "tshirt_letter_sizes", minMatches: 4,
      canonical: ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl"] },
    // T-shirt sizes — word form.
    { name: "tshirt_word_sizes", minMatches: 3,
      canonical: ["extra small", "small", "medium", "large", "extra large"] },

    // NPS respondent bands
    { name: "nps_bands", minMatches: 2,
      canonical: ["detractor", "passive", "promoter"] },

    // Likelihood / probability bands
    { name: "likelihood5", minMatches: 3,
      canonical: ["very unlikely", "unlikely", "neutral", "likely", "very likely"] },

    // Educational levels (one common ladder)
    { name: "education", minMatches: 3,
      canonical: ["none", "primary", "secondary", "bachelors", "masters", "doctoral"] },

    // Grade letters — A best → F worst. Single letters are short; we require
    // 3 of 5 to fire to keep false-positive risk low.
    { name: "grades_a_to_f", minMatches: 3,
      canonical: ["a", "b", "c", "d", "f"] },

    { name: "grades_a_to_f_plusminus", minMatches: 4,
      canonical: ["a+", "a", "a-", "b+", "b", "b-", "c+", "c", "c-", "d+", "d", "d-", "f"] },
    ];

// ──────────────────────────────────────────────────────────────────────────
// Synonym dictionary (2026-06-22)
// ──────────────────────────────────────────────────────────────────────────
// PATTERNS above is the CATALOG (scales + canonical order). This maps the many
// ways a rung is SPELLED in real data → the canonical term used in PATTERNS, so a
// column of "Frequently / Occasionally / Always" still resolves to the frequency
// scale. KEY = the lookup word as it might appear in data; VALUE = the exact
// PATTERNS canonical. Both are compared after normalize() (lowercase, -/_ → space).
// A key that IS already a canonical is ignored (never shadow a real rung). The
// orderedDomain still ships the USER'S actual strings — only the MATCH is
// synonym-aware — and subset + minMatches discipline is unchanged, so this widens
// recall WITHOUT widening false positives. Extend freely; values must be exact
// PATTERNS canonicals.
const SYNONYMS: Record<string, string> = {
    // frequency5: never / rarely / sometimes / often / always
    "seldom": "rarely", "infrequently": "rarely", "hardly ever": "rarely",
    "occasionally": "sometimes", "periodically": "sometimes", "now and then": "sometimes",
    "frequently": "often", "frequent": "often", "regularly": "often", "commonly": "often", "usually": "often",
    "constantly": "always", "every time": "always", "all the time": "always", "consistently": "always", "continually": "always",
    // likert5_quality: poor / fair / good / very good / excellent
    "bad": "poor", "weak": "poor", "subpar": "poor",
    "mediocre": "fair", "passable": "fair", "so so": "fair",
    "decent": "good", "solid": "good",
    "outstanding": "excellent", "superb": "excellent", "exceptional": "excellent", "stellar": "excellent",
    // likert5_satisfaction
    "unsatisfied": "dissatisfied", "unhappy": "dissatisfied", "displeased": "dissatisfied",
    "happy": "satisfied", "content": "satisfied", "pleased": "satisfied",
    "delighted": "very satisfied", "highly satisfied": "very satisfied", "extremely satisfied": "very satisfied",
    "highly dissatisfied": "very dissatisfied", "extremely dissatisfied": "very dissatisfied",
    // agreement
    "neither": "neutral", "undecided": "neutral", "no opinion": "neutral", "neither agree nor disagree": "neutral",
    "completely agree": "strongly agree", "totally agree": "strongly agree",
    "completely disagree": "strongly disagree", "totally disagree": "strongly disagree",
    // likelihood5
    "highly unlikely": "very unlikely", "extremely unlikely": "very unlikely",
    "highly likely": "very likely", "extremely likely": "very likely", "almost certain": "very likely",
    // education ladder
    "bachelor": "bachelors", "bachelor's": "bachelors", "undergraduate": "bachelors", "bachelor degree": "bachelors",
    // bare "master" is intentionally OMITTED — it is the experience6 canonical
    // (skill level), so it must not be remapped to the education "masters".
    "master's": "masters", "graduate": "masters", "master degree": "masters",
    "doctorate": "doctoral", "phd": "doctoral",
};

// Normalized synonym → canonical map, built once at load. Skips any key that is
// itself a canonical (a real rung never resolves to something else) and first-wins
// on duplicate keys.
const CANONICAL_SET: Set<string> = (() => {
    const s = new Set<string>();
    for (const p of PATTERNS) for (const c of p.canonical) s.add(normalize(c));
    return s;
})();
const SYNONYM_TO_CANON: Map<string, string> = (() => {
    const m = new Map<string, string>();
    for (const [syn, canon] of Object.entries(SYNONYMS)) {
        const ns = normalize(syn);
        if (CANONICAL_SET.has(ns) || m.has(ns)) continue;   // never shadow a canonical; first wins
        m.set(ns, normalize(canon));
    }
    return m;
})();
// Resolve a normalized user value to its canonical term (or itself when it is
// already a canonical / has no synonym entry).
function resolveCanon(norm: string): string {
    return SYNONYM_TO_CANON.get(norm) ?? norm;
}

// ──────────────────────────────────────────────────────────────────────────
// Numeric-ordinal NAME test (2026-05-31)
// ──────────────────────────────────────────────────────────────────────────
// A low-card, CONTIGUOUS, non-measure integer (Hour 0-23, day-of-month 1-31,
// rating 1-5) is a discrete AXIS dimension, not a continuous measure. We only
// promote it to ORDINAL (an ordered numeric axis, usable by line/scatter as
// well as heatmap) when its column NAME reads like a temporal or rank/level
// dimension — 'Hour' yes, 'Sales' no. Non-matching (or gappy) low-card
// integers fall back to Categorical (still a valid discrete axis). Matching is
// WHOLE-TOKEN (camelCase + separators split) so 'threshold' doesn't match 'hr'
// and 'average' doesn't match 'age'.
const ORDINAL_NAME_TOKENS: Set<string> = new Set([
    // temporal
    "hour", "hr", "day", "dow", "dom", "weekday", "week", "wk", "woy",
    "month", "mth", "quarter", "qtr", "year", "yr", "semester", "trimester",
    "decade", "period", "fiscal", "fy",
    // rank / level / scale
    "rank", "level", "lvl", "tier", "grade", "band", "decile", "percentile",
    "quartile", "quintile", "score", "rating", "stars", "step", "stage",
    "phase", "round", "wave", "episode", "chapter", "age", "cohort",
    "generation", "seniority", "position", "sequence", "seq", "priority",
]);

function tokenizeName(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase → words
        .replace(/[_\-./]+/g, " ")                  // separators → space
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0);
}

export function isOrdinalFriendlyName(name: string): boolean {
    if (!name) return false;
    for (const tok of tokenizeName(name)) {
        if (ORDINAL_NAME_TOKENS.has(tok)) return true;
    }
    return false;
}

// Normalize one value string for matching: lowercase, replace -/_ with
// spaces, collapse multiple whitespace runs into one, trim.
function normalize(s: string): string {
    return s.toLowerCase()
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// ──────────────────────────────────────────────────────────────────────────
// Calendar / cyclic ordinals (2026-05-31)
// ──────────────────────────────────────────────────────────────────────────
// Days, months, and quarters have MANY surface forms (Jan/January,
// Thu/Thr/Thurs/Thursday, Q1/Qtr 1/Quarter 1). Unlike the fixed Likert phrases
// above, we match via a synonym DICTIONARY: each known surface form (normalized)
// maps to its ordinal POSITION. A column qualifies only when EVERY distinct
// value is in the family's dictionary (so one 'Pineapple' outlier disqualifies
// it — same subset discipline as the scale patterns) AND at least `minMatches`
// distinct positions are present. We then ship the user's ACTUAL strings
// (whichever form they used — 'Mon' or 'Monday') ordered by position.
//
// Privacy posture is identical to the scales above: public-domain calendar
// terminology, safe to send unobfuscated. Genesis (a production incident): a freemium
// Weekday heatmap had its category values stripped; the LLM guessed FULL names
// 'Monday'..'Sunday' while the data was 'Mon'..'Sun', hardcoded that list, and
// filtered the data to empty → "INVALID: no data after filtering".
type CalendarFamily = { name: string; minMatches: number; dict: Map<string, number> };

function buildCalendarDict(entries: [string[], number][]): Map<string, number> {
    const m = new Map<string, number>();
    for (const [forms, pos] of entries) {
        for (const f of forms) m.set(normalize(f), pos);
    }
    return m;
}

const CALENDAR_FAMILIES: CalendarFamily[] = [
    // Weekday, Mon→Sun (ISO order, matches the server's DataShapeAdvisor R9).
    { name: "weekday_mon_sun", minMatches: 4, dict: buildCalendarDict([
        [["monday", "mon"], 0],
        [["tuesday", "tue", "tues"], 1],
        [["wednesday", "wed", "weds"], 2],
        [["thursday", "thu", "thur", "thurs", "thr"], 3],
        [["friday", "fri"], 4],
        [["saturday", "sat"], 5],
        [["sunday", "sun"], 6],
    ]) },
    // Month, Jan→Dec.
    { name: "month_jan_dec", minMatches: 4, dict: buildCalendarDict([
        [["january", "jan"], 0],
        [["february", "feb"], 1],
        [["march", "mar"], 2],
        [["april", "apr"], 3],
        [["may"], 4],
        [["june", "jun"], 5],
        [["july", "jul"], 6],
        [["august", "aug"], 7],
        [["september", "sep", "sept"], 8],
        [["october", "oct"], 9],
        [["november", "nov"], 10],
        [["december", "dec"], 11],
    ]) },
    // Quarter, Q1→Q4. Power BI emits 'Qtr 1'/'Qtr 2'/... (the Marimekko genesis).
    { name: "quarter_q1_q4", minMatches: 3, dict: buildCalendarDict([
        [["q1", "qtr 1", "qtr1", "quarter 1", "q 1"], 0],
        [["q2", "qtr 2", "qtr2", "quarter 2", "q 2"], 1],
        [["q3", "qtr 3", "qtr3", "quarter 3", "q 3"], 2],
        [["q4", "qtr 4", "qtr4", "quarter 4", "q 4"], 3],
    ]) },
];

// LOCALE-AWARE calendar surface forms (2026-07-18, Phase 7). The static
// CALENDAR_FAMILIES above carry ENGLISH forms only, so a non-English STANDALONE weekday /
// month TEXT column ("Montag", "Janvier", "Monat"-valued) was missed → OrdinalPattern unset
// → the server's Phase-6 cyclicality gate over-rejected Circular heatmap / Polar for that
// data. We build the locale's weekday + month names via Intl (the SAME mechanism dateUnshred
// uses for date-hierarchy month parsing), keyed with THIS module's normalize(), and UNION
// them with the English dicts at match time — so an English column in a non-English report
// STILL resolves (English wins on any collision). Cached per locale.
const _localeCalCache: Record<string, { weekday: Map<string, number>; month: Map<string, number> }> = {};

function localeCalendarDicts(locale?: string): { weekday: Map<string, number>; month: Map<string, number> } {
    const key = locale || "";
    if (!key) return { weekday: new Map(), month: new Map() };
    const cached = _localeCalCache[key];
    if (cached) return cached;
    const weekday = new Map<string, number>();
    const month = new Map<string, number>();
    // Add both the raw normalized form and a dot-stripped variant (some locales' short forms
    // carry a trailing '.', e.g. "lun." — normalize() keeps dots, so index both spellings).
    const add = (map: Map<string, number>, s: string, pos: number) => {
        const n = normalize(s); if (n) map.set(n, pos);
        const nd = normalize(s.replace(/\./g, "")); if (nd && nd !== n) map.set(nd, pos);
    };
    try {
        const wLong = new Intl.DateTimeFormat(key, { weekday: "long" });
        const wShort = new Intl.DateTimeFormat(key, { weekday: "short" });
        for (let i = 0; i < 7; ++i) {                       // 2024-01-01 is Monday → ISO Mon..Sun = 0..6
            const d = new Date(Date.UTC(2024, 0, 1 + i));
            add(weekday, wLong.format(d), i);
            add(weekday, wShort.format(d), i);
        }
        const mLong = new Intl.DateTimeFormat(key, { month: "long" });
        const mShort = new Intl.DateTimeFormat(key, { month: "short" });
        for (let m = 0; m < 12; ++m) {                       // mid-month → no tz day-shift
            const d = new Date(Date.UTC(2020, m, 15));
            add(month, mLong.format(d), m);
            add(month, mShort.format(d), m);
        }
    } catch {
        // Unknown locale tag — leave the maps empty (English-only fallback).
    }
    const result = { weekday, month };
    _localeCalCache[key] = result;
    return result;
}

// English base UNION locale extras; the English base wins on any key collision.
function mergeDicts(base: Map<string, number>, extra: Map<string, number>): Map<string, number> {
    if (extra.size === 0) return base;
    const m = new Map(base);
    for (const [k, v] of extra) if (!m.has(k)) m.set(k, v);
    return m;
}

// Try each calendar family against the user's normalized→original value index.
// Returns the user's actual strings in calendar order, or null when no family
// fully contains the value set. `locale` augments the weekday/month families with the
// report locale's own surface forms (see localeCalendarDicts).
function detectCalendarOrdinal(normIndex: Map<string, string>, locale?: string): OrdinalDetectionResult | null {
    const loc = localeCalendarDicts(locale);
    for (const fam of CALENDAR_FAMILIES) {
        const dict =
            fam.name === "weekday_mon_sun" ? mergeDicts(fam.dict, loc.weekday) :
            fam.name === "month_jan_dec"   ? mergeDicts(fam.dict, loc.month)   :
            fam.dict;                                        // quarter stays English (Q1..Q4 near-universal)
        let allInDict = true;
        const byPos = new Map<number, string>();   // position → first original at that position
        for (const [norm, original] of normIndex) {
            const pos = dict.get(norm);
            if (pos === undefined) { allInDict = false; break; }
            if (!byPos.has(pos)) byPos.set(pos, original);
        }
        if (!allInDict) continue;
        if (byPos.size < fam.minMatches) continue;
        const orderedDomain = [...byPos.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
        return { pattern: fam.name, orderedDomain };
    }
    return null;
}

// Build a lookup: normalized form → original user string. When two raw
// values normalize to the same key (e.g. "Strongly Disagree" and
// "STRONGLY DISAGREE"), the first one wins — that's fine for ordering
// purposes since they'd render as the same axis category anyway after
// the LLM's downstream `groupby`.
function buildNormalizedIndex(rawValues: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const v of rawValues) {
        if (v === null || v === undefined) continue;
        const s = String(v);
        if (s.length === 0) continue;
        const n = normalize(s);
        if (!out.has(n)) out.set(n, s);
    }
    return out;
}

// Result of a successful detection.
export type OrdinalDetectionResult = {
    // Catalog pattern name (debug + telemetry).
    pattern: string;
    // The USER'S original value strings in canonical pattern order. May be
    // a SUBSET of the pattern's canonical list (when the user's data is
    // missing some pattern entries — e.g., a 4-pt subset of 5-pt Likert).
    // Ordering is always the pattern's ordering.
    orderedDomain: string[];
};

// ──────────────────────────────────────────────────────────────────────────
// Safe short-code values (Tier B, 2026-05-31)
// ──────────────────────────────────────────────────────────────────────────
// For categoricals that are NOT a recognized ordinal but are clearly NON-PII
// short codes, ship the ACTUAL distinct values (unobfuscated) so the LLM can
// derive the axis domain from real data instead of guessing labels it can't
// see (the freemium failure mode). This is a PRIVACY decision (expose the
// values), NOT an ordering one — no order is asserted; the server tells the
// LLM "derive the domain from these, order not significant."
//
// A column ships only when EVERY distinct value is "safe" AND there are ≤ 15
// distinct values. A value is safe if EITHER:
//   (1) ALLOWLIST — it's a known generic, non-PII token (sizes, days, months,
//       quarters, common flags like yes/no/true/false/na). Always OK; these
//       carry no user-specific information by construction.
//   (2) CODE STRUCTURE — at most ONE letter, at least ONE digit, length ≤ 10
//       (J-01, Q1, '2024-3', pure-numeric '01'). The digit requirement is what
//       excludes 2-letter INITIALS (JC, MB) — the residual PII risk we
//       flagged — since alpha-only tokens must instead come from the allowlist.
const MAX_SAFE_DISTINCT = 15;
const MAX_CODE_LEN = 10;

// Generic, non-PII category tokens that are always safe to ship verbatim.
// Calendar tokens are folded in from CALENDAR_FAMILIES so a column with FEWER
// values than Tier A's minMatches (e.g. just {Sat, Sun}) is still covered.
const ALWAYS_SAFE_TOKENS: Set<string> = (() => {
    const literal = [
        // sizes
        "xxs", "xs", "s", "sm", "small", "m", "med", "medium", "l", "lg", "large",
        "xl", "xlarge", "xxl", "xxxl", "2xl", "3xl", "4xl",
        // boolean / flags / fillers
        "y", "n", "yes", "no", "t", "f", "true", "false",
        "na", "n/a", "n a", "none", "null", "unknown", "other", "all", "both",
        // magnitude / severity words (safe standalone even when Tier A doesn't fire)
        "low", "medium", "med", "high", "very low", "very high", "minimal", "critical", "urgent",
    ];
    const set = new Set<string>(literal.map(normalize));
    for (const fam of CALENDAR_FAMILIES) {
        for (const k of fam.dict.keys()) set.add(k);   // already normalized
    }
    return set;
})();

function isCodeStructured(raw: string): boolean {
    const s = raw.trim();
    if (s.length === 0 || s.length > MAX_CODE_LEN) return false;
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (letters > 1) return false;                 // ≤ 1 letter
    return /\p{Nd}/u.test(s);                       // ≥ 1 digit
}

export function safeDistinctValuesToShip(rawDistinct: string[]): string[] | null {
    if (!rawDistinct || rawDistinct.length === 0) return null;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of rawDistinct) {
        if (v === null || v === undefined) continue;
        const s = String(v);
        if (seen.has(s)) continue;
        const norm = normalize(s);
        const safe = norm === "" || ALWAYS_SAFE_TOKENS.has(norm) || isCodeStructured(s);
        if (!safe) return null;                     // one unsafe value disqualifies the whole column
        seen.add(s);
        out.push(s);
        if (out.length > MAX_SAFE_DISTINCT) return null;   // too high cardinality → not a bounded code set
    }
    return out.length > 0 ? out : null;
}

// Run all patterns against the user's distinct values; return the
// highest-scoring match, or null if none qualify.
export function detectOrdinalDomain(rawValues: string[], locale?: string): OrdinalDetectionResult | null {
    if (!rawValues || rawValues.length < 2) return null;
    const normIndex = buildNormalizedIndex(rawValues);
    if (normIndex.size < 2) return null;

    // Resolve each user value to its canonical term (synonym-aware). canonIndex
    // maps canonical → the user's ORIGINAL string, so orderedDomain preserves the
    // user's own spelling while matching tolerates synonyms.
    const canonIndex = new Map<string, string>();
    for (const [norm, original] of normIndex) {
        const canon = resolveCanon(norm);
        if (!canonIndex.has(canon)) canonIndex.set(canon, original);
    }

    let best: { pattern: OrdinalPattern; matched: number; orderedDomain: string[] } | null = null;
    for (const pattern of PATTERNS) {
        const orderedDomain: string[] = [];
        for (const canonForm of pattern.canonical) {
            const raw = canonIndex.get(canonForm);
            if (raw !== undefined) orderedDomain.push(raw);
        }
        if (orderedDomain.length < pattern.minMatches) continue;

        // Subset check: every user value must RESOLVE (directly or via synonym)
        // to a canonical in the pattern. Reject patterns where the user has extra
        // values outside the catalog (e.g. "Strongly Disagree, Disagree, Refused").
        const patternSet = new Set(pattern.canonical);
        let allUserValuesInPattern = true;
        for (const normUserValue of normIndex.keys()) {
            if (!patternSet.has(resolveCanon(normUserValue))) { allUserValuesInPattern = false; break; }
        }
        if (!allUserValuesInPattern) continue;

        // Score preference (best first):
        //   1. Higher matched count wins.
        //   2. On ties, the SHORTER canonical pattern wins — represents a
        //      tighter / more-specific fit. Example: a column with exactly
        //      {strongly disagree, disagree, neutral, agree, strongly agree}
        //      matches BOTH likert5_agreement (5 matched / 5 canonical) AND
        //      likert7_agreement (5 matched / 7 canonical). The 5pt pattern
        //      is the right call — the user's data IS a 5pt Likert, not a
        //      7pt scale that happens to have 2 categories empty.
        let isBetter: boolean;
        if (best === null) isBetter = true;
        else if (orderedDomain.length > best.matched) isBetter = true;
        else if (orderedDomain.length === best.matched
                 && pattern.canonical.length < best.pattern.canonical.length) isBetter = true;
        else isBetter = false;
        if (isBetter) {
            best = { pattern, matched: orderedDomain.length, orderedDomain };
        }
    }
    if (best) return { pattern: best.pattern.name, orderedDomain: best.orderedDomain };
    // No survey/scale pattern — try the calendar dictionaries (weekday / month /
    // quarter), augmented with the report locale's own surface forms. Disjoint
    // vocabularies, so a column matches at most one family.
    return detectCalendarOrdinal(normIndex, locale);
}
