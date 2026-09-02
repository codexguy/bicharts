// WHICH AGGREGATIONS ARE HONEST FOR THIS COLUMN — one classifier, two axes (2026-09-01).
//
// WHAT WENT WRONG WITHOUT IT. The selection card offered `Sum of Latitude: 84 (12.3% of total)`
// on the shipped sample table — a total of coordinates, and a SHARE of that total beside it. The
// server has known better since 2026-06: its own additivity resolver carries a name list with
// `latitude` and `longitude` on it, and every server-side behaviour built on it — the stacking
// gates, the stack and cumulative-total guards — is already correct. But the card is pure client
// arithmetic over a payload, deliberately, so that it works on a chart cached long before the
// feature existed with no round trip — which means the server's list is unreachable from it, by
// construction, forever.
//
// TWO AXES, NOT ONE. This is the distinction whose absence caused the bug:
//
//   * ValueNature   — what KIND of scale is this?      Categorical / Ordinal / Continuous
//   * additivity    — is SUM meaningful over it?       additive / part_of_whole /
//                                                      intensive_rate / positional
//
// Latitude is Continuous AND not summable. There is no single enum that says so, which is why
// the tempting fix — adding `latitude` to IDENTIFIER_NAME_TOKENS so it demotes to Categorical,
// four characters — is wrong: `MinContinuous` is a Layer-A gate, and scatter, bubble and both
// point maps would lose eligibility on coordinate data. Nature and additivity are separate
// questions and must stay separate.
//
// THE LISTS BELOW ARE THE CANONICAL COPY (2026-09-01). The server keeps
// its compiled regex — an old client that ships no `additivity` flag still needs a server-side
// fallback, so the second copy is unavoidable — and a server-side parity test
// asserts the two token sets are EQUAL, reading this file. That replaces the "no client-side
// copy to drift" rule the server-side resolver states: drift is now caught by a test rather
// than prevented by there being nowhere to drift to. Keep the sentinel comments intact; the
// parity test locates the arrays by them.
//
// SCOPE. This module decides what a PRESENTATION surface may offer. It moves no server verdict:
// `positional` is a client-side refinement of what the server calls `IntensiveRate`, and the
// union of the two arrays below is exactly the server's list.

/** Every aggregation any BIC surface offers. `first` is the one that only makes sense for a
 *  dimension — "which value is this?" — and it is why a categorical column can have a line at
 *  all. */
export type AggKind =
    "sum" | "average" | "median" | "min" | "max" | "count" | "distinctcount" | "first";

/** Does SUM mean anything over this column?
 *   - `additive`       revenue, counts — group sums vary with group size.
 *   - `part_of_whole`  a share: the parts sum to a CONSTANT whole, so it stacks to 100%.
 *   - `intensive_rate` margin, NPS, uptime%, latency — mean/median, never a total.
 *   - `positional`     a COORDINATE. Not a quantity at all; see `suppressed`.
 *   - `unknown`        no signal; callers treat it as additive and say so. */
export type AggAdditivity =
    "additive" | "part_of_whole" | "intensive_rate" | "positional" | "unknown";

/** WHICH signal decided, so a surface can explain itself and a test can pin the path rather
 *  than only the verdict. Ordered by strength: a measured verdict beats a name. */
export type AggBasis = "measured" | "host-flag" | "name" | "role" | "default";

export type AggNature = "Categorical" | "Ordinal" | "Continuous";

export interface AggregationClass {
    nature: AggNature;
    additivity: AggAdditivity;
    basis: AggBasis;
    /** TRUE when a presentation surface should offer NO arithmetic line for this column by
     *  default. Set only for `positional` today: a coordinate is not an amount, and the mark's
     *  own label already says which place it is. Distinct from `allowed` being empty on
     *  purpose — min/max over coordinates IS a bounding box and stays available to a caller
     *  that wants one, without re-deriving any of this. */
    suppressed: boolean;
}

/** The structural slice of a column this module reads. Deliberately not `LLMColumnWithValue`:
 *  chart-host calls this over `buildRenderPayload`'s columns, which are the same objects but
 *  reach it through a package boundary that does not ship shape-core's types. */
export interface AggregationColumn {
    name?: string | null;
    dataType?: string | null;
    isMeasure?: boolean;
    valueNature?: string | null;
    /** As measured by classifyAdditivity — often "unknown", and legitimately so: in a host with
     *  no field wells (Excel, MCP) there is no aggregation prefix to read. */
    additivity?: string | null;
    /** Power BI's DataViewMetadataColumn.discourageAggregationAcrossGroups. */
    discourageAggregationAcrossGroups?: boolean;
}

// ── the name lists — CANONICAL; see the header note about the parity test ────────────────────

/* parity:intensive-word:begin */
/** Tokens that mark an INTENSIVE / averaged / ratio measure — one a SUM would corrupt, because
 *  the total scales with row count rather than with the quantity. Matched as a WHOLE WORD
 *  anywhere in the name. `z[_-]?score` is a PATTERN, not a literal, and is carried verbatim
 *  from the server list. */
export const INTENSIVE_WORD_TOKENS: readonly string[] = [
    "rate", "ratio", "pct", "percent", "percentage", "rating", "share", "score",
    "index", "nps", "csat", "margin", "yield", "coverage", "utilization", "z[_-]?score",
    "average", "avg", "mean", "median", "stddev", "variance",
    "gpa", "percentile", "quantile", "efficiency", "accuracy", "probability",
    "multiplier", "coefficient", "correlation", "occupancy",
    "age", "bmi", "temperature", "density", "pressure", "humidity", "ph",
    "velocity", "speed", "elevation", "altitude",
    "latency", "throughput", "bandwidth", "iops",
];
/* parity:intensive-word:end */

/* parity:intensive-suffix:begin */
/** ALSO matched as a camelCase SUFFIX ("ProfitMargin", "CreditScore"). A token belongs here
 *  ONLY if no common ADDITIVE word ends in it — "age" is word-only because Usage / Storage /
 *  Coverage are summable and must not false-match. A false positive forbids a legitimate
 *  stack, so both arrays stay to names that are non-additive in nearly every business context. */
export const INTENSIVE_SUFFIX_TOKENS: readonly string[] = [
    "pct", "percent", "percentage", "rate", "ratio", "rating", "share", "score",
    "index", "nps", "csat", "margin", "yield", "coverage", "utilization",
    "gpa", "percentile", "quantile", "bmi", "density", "pressure", "humidity",
    "velocity", "efficiency", "occupancy",
    "latency", "throughput", "bandwidth", "iops",
];
/* parity:intensive-suffix:end */

/* parity:positional-word:begin */
/** COORDINATES, carved out of the intensive list rather than added to it. The server lumps
 *  these with intensive rates and is right to — it only ever asks "may this stack". A menu
 *  needs more: min/max over coordinates is a bounding box and is useful, the mean of latitudes
 *  is a rough centroid, and the mean of LONGITUDES is simply wrong near the antimeridian
 *  (mean(+179, -179) = 0, the Gulf of Guinea). So they get their own class and, by default, no
 *  line at all.
 *
 *  STRICT PARITY, and deliberately no aliases. `lat` / `lon` / `lng` are NOT here: adding them
 *  would make this set a superset of the server's and change what the parity test can assert,
 *  and adding them to BOTH would move a server verdict (a column named `Lat` would stop
 *  stacking), which is a corpus-replay question rather than a presentation one, and is
 *  recorded as a follow-up rather than done here. */
export const POSITIONAL_WORD_TOKENS: readonly string[] = ["latitude", "longitude"];
/* parity:positional-word:end */

/* parity:positional-suffix:begin */
export const POSITIONAL_SUFFIX_TOKENS: readonly string[] = ["latitude", "longitude"];
/* parity:positional-suffix:end */

// ── name tests — ported from the server-side resolver so the two agree on BEHAVIOUR, not
//    only on the token arrays. The parity test pins the arrays; these functions are pinned by
//    their own unit tests, using the same anchor cases the server side documents.

/** Host aggregation prefixes Power BI prepends by DEFAULT to any numeric column dropped in a
 *  measure well. Average/Min/Max are deliberately absent: those are CHOICES, and a choice is
 *  real evidence about the quantity where a default is evidence about the host. */
const DEFAULT_AGG_PREFIX = /^\s*(sum|count|count\s+distinct|distinct\s+count)\s+of\s+/i;

/** camelCase / PascalCase / unit-suffix boundaries. A measure is very often written with no
 *  spaces at all — "LatencyMs", "ProfitMargin" — and a \bword\b test cannot see inside those. */
const CAMEL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/g;

const INTENSIVE_RE = new RegExp(
    "\\b(" + INTENSIVE_WORD_TOKENS.join("|") + ")\\b|(" + INTENSIVE_SUFFIX_TOKENS.join("|") + ")$",
    "i");
const POSITIONAL_RE = new RegExp(
    "\\b(" + POSITIONAL_WORD_TOKENS.join("|") + ")\\b|(" + POSITIONAL_SUFFIX_TOKENS.join("|") + ")$",
    "i");

/** "Sum of Revenue" -> "Revenue", so the name tests judge the QUANTITY and not the host's
 *  aggregation choice. */
export function stripHostAggPrefix(name: string | null | undefined): string {
    if (!name) return "";
    return String(name).replace(DEFAULT_AGG_PREFIX, "").trim();
}

/** True when the name carries a DEFAULT aggregation prefix — the one Power BI applies without
 *  anyone choosing it, which is why a resulting "additive" verdict is not conclusive. */
export function hasDefaultAggPrefix(name: string | null | undefined): boolean {
    return !!name && DEFAULT_AGG_PREFIX.test(String(name));
}

function normalizeForNameTest(name: string | null | undefined): string {
    const base = stripHostAggPrefix(name);
    return base.length === 0 ? "" : base.replace(CAMEL_BOUNDARY, " ");
}

/** Both forms are tested, exactly as the server side does: the camel-split one catches
 *  "LatencyMs" / "ProfitMargin", the raw base name keeps every suffix match working. */
function matchesName(re: RegExp, name: string | null | undefined): boolean {
    if (!name) return false;
    return re.test(normalizeForNameTest(name)) || re.test(stripHostAggPrefix(name));
}

/** Does this column NAME read as a coordinate? */
export function nameLooksPositional(name: string | null | undefined): boolean {
    return matchesName(POSITIONAL_RE, name);
}

/** Does this column NAME read as an intensive rate — a quantity a SUM would corrupt?
 *  Coordinates answer TRUE here too, because on the server they are intensive; use
 *  `classifyForAggregation` when the two need telling apart. */
export function nameLooksIntensiveRate(name: string | null | undefined): boolean {
    return matchesName(INTENSIVE_RE, name) || nameLooksPositional(name);
}

// ── the classifier ───────────────────────────────────────────────────────────────────────────

const NUMERIC_DATATYPE = /int|double|decimal|single|float|number|currency|money/i;

function natureOf(col: AggregationColumn): AggNature {
    const declared = String(col?.valueNature ?? "").trim().toLowerCase();
    if (declared === "categorical") return "Categorical";
    if (declared === "ordinal") return "Ordinal";
    if (declared === "continuous") return "Continuous";
    // No measured nature (an older client, or a payload column a host assembled itself). Fall
    // back the same way the card's own isMeasureColumn does: role first, type as the backstop.
    if (col?.isMeasure === true) return "Continuous";
    return NUMERIC_DATATYPE.test(String(col?.dataType ?? "")) ? "Continuous" : "Categorical";
}

function isNumericLike(col: AggregationColumn): boolean {
    return col?.isMeasure === true || NUMERIC_DATATYPE.test(String(col?.dataType ?? ""));
}

/**
 * ONE verdict per column, both axes, from every signal in priority order.
 *
 * The additivity ladder mirrors the server-side resolver deliberately, including its one
 * subtlety: a MEASURED "additive" is NOT conclusive when it came from a default aggregation
 * prefix, because Power BI applies Sum to every numeric column dropped in a measure well —
 * "Sum of LatencyMs" is evidence about the host, not about the quantity. Every other measured
 * value is trusted outright: part_of_whole and intensive_rate are decided, not defaulted.
 */
export function classifyForAggregation(col: AggregationColumn | null | undefined): AggregationClass {
    const c = col ?? {};
    const nature = natureOf(c);

    // A dimension has no additivity question to answer.
    if (nature !== "Continuous") {
        return { nature, additivity: "unknown", basis: "role", suppressed: false };
    }

    // COORDINATES FIRST. A latitude is a coordinate whatever else is true of it, and the check
    // has to precede the measured flag: a host that summed it would report "additive".
    if (nameLooksPositional(c.name)) {
        return { nature, additivity: "positional", basis: "name", suppressed: true };
    }

    const measured = String(c.additivity ?? "").trim().toLowerCase();
    const additiveFromDefaultAgg = measured === "additive" && hasDefaultAggPrefix(c.name);
    if (!additiveFromDefaultAgg) {
        if (measured === "additive") return { nature, additivity: "additive", basis: "measured", suppressed: false };
        if (measured === "part_of_whole") return { nature, additivity: "part_of_whole", basis: "measured", suppressed: false };
        if (measured === "intensive_rate") return { nature, additivity: "intensive_rate", basis: "measured", suppressed: false };
    }

    if (c.discourageAggregationAcrossGroups === true) {
        return { nature, additivity: "intensive_rate", basis: "host-flag", suppressed: false };
    }
    if (nameLooksIntensiveRate(c.name)) {
        return { nature, additivity: "intensive_rate", basis: "name", suppressed: false };
    }
    return { nature, additivity: "additive", basis: "default", suppressed: false };
}

/**
 * The MENU: every aggregation that is honest for this column, best first — so `[0]` is also the
 * answer to "what does Auto mean here".
 *
 * `count` and `distinctcount` are legal for everything because they are questions about the
 * ROWS, not about the quantity. `first` likewise, and it is the only one that earns its place on
 * a dimension.
 */
export function allowedAggregations(col: AggregationColumn | null | undefined): AggKind[] {
    const k = classifyForAggregation(col);
    const c = col ?? {};

    if (k.nature === "Categorical") return ["first", "distinctcount", "count"];
    if (k.nature === "Ordinal") {
        // An ordinal STRING domain (Low / Medium / High) has an order we do not carry here, so
        // min/max would be alphabetical and wrong. Numeric ordinals (a 1-5 rating, a year, a
        // 0-100 score) do have one.
        //
        // MEDIAN LEADS, AVERAGE IS AVAILABLE. The mean of a rank is formally meaningless - the
        // distance between "Good" and "Very Good" is not defined - so the default must not be
        // the mean. But a numeric ordinal in practice is very often averaged on purpose ("4.2
        // stars"), and refusing it outright would substitute median for a user who deliberately
        // asked for average, which is a surprise rather than a protection. SUM stays off either
        // way, which is the part that would be wrong rather than merely arguable.
        return isNumericLike(c)
            ? ["median", "average", "min", "max", "first", "distinctcount", "count"]
            : ["first", "distinctcount", "count"];
    }

    switch (k.additivity) {
        case "positional":
            // Legal, and the reason `suppressed` is a separate flag: min/max IS the bounding
            // box of the selection. Sum and average are absent on purpose.
            return ["min", "max", "count", "distinctcount", "first"];
        case "intensive_rate":
            return ["average", "median", "min", "max", "count", "distinctcount", "first"];
        case "part_of_whole":
        case "additive":
        case "unknown":
        default:
            return ["sum", "average", "median", "min", "max", "count", "distinctcount", "first"];
    }
}

/** What "Auto — sum amounts, average rates" actually means for THIS column. The settings panel
 *  has promised exactly this since the aggregation control shipped; until 2026-09-01 the code
 *  resolved the blank to `sum` for every column alike. */
export function defaultAggregation(col: AggregationColumn | null | undefined): AggKind {
    return allowedAggregations(col)[0];
}

/** Is `agg` honest for this column? The one predicate a surface needs when the user has CHOSEN
 *  an aggregation globally and it has to be applied per column. */
export function isAggregationAllowed(
    col: AggregationColumn | null | undefined, agg: AggKind): boolean {
    return allowedAggregations(col).indexOf(agg) >= 0;
}

/** A SHARE-OF-TOTAL is honest only when the parts sum to the whole — which needs BOTH an
 *  additive aggregation AND an additive column. The card had the first half and printed
 *  "12.3% of total" beside a total of latitudes for want of the second. */
export function shareOfTotalIsHonest(
    col: AggregationColumn | null | undefined, agg: AggKind): boolean {
    if (agg !== "sum" && agg !== "count") return false;
    if (agg === "count") return true;             // a count of rows always composes
    const k = classifyForAggregation(col);
    return k.additivity === "additive" || k.additivity === "part_of_whole" || k.additivity === "unknown";
}
