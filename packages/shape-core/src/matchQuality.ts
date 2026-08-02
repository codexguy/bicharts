// HOW GOOD A MATCH HAS TO BE, AND WHAT DOES NOT COUNT AS A VALUE.
//
// One place for both, because they are the same decision seen twice: a column earns a
// geographic role when nearly all of the values it ACTUALLY HAS resolve against the
// gazetteer. Blanks are not values, and a placeholder is a blank someone typed.
//
// Joel, 2026-08-02: "there probably needs to be a minimum ratio of successful matches
// against the gazette (e.g. 97% - if data quality is worse, it's the user's responsibility
// to clean it)" and "my 97% is for non-blanks, by the way. Similarly, '-' and 'N/A' could be
// interpreted as blank, as well. make sure the 97 is a constant that can be used more
// globally, tweakable in one place."

/**
 * THE KNOB. Minimum share of a column's non-blank DISTINCT values that must resolve against
 * the gazetteer before the column can claim a geographic role.
 *
 * Tune here and every classifier that opts in moves together. Higher is stricter about
 * claiming a role at all; lower risks a column of something else claiming one. 97 leaves
 * room for the odd typo in an otherwise clean column while staying far out of reach of a
 * column that is not really places.
 *
 * Deliberately NOT applied to the looser name roles (city/state at 85%), which tolerate
 * messier real-world text by design — raising those is a separate decision with its own
 * consequences, and belongs to Joel, not to this constant quietly widening its reach.
 */
export const GAZETTEER_MATCH_PCT = 97;

/**
 * Normalized tokens that mean "no value here".
 *
 * Only entries that CANNOT be a real place code. That constraint does most of the work:
 *
 *   • "-", "--", "?", "." and whitespace never reach this list — normalizePlaceName already
 *     reduces them to "", which every caller drops as blank.
 *   • "N/A", "n/a" and "N.A." normalize to "n a" WITH A SPACE, which is what makes them safe
 *     to list. Bare "NA" normalizes to "na" and is NAMIBIA's ISO-2 code. The two are
 *     genuinely different tokens after normalization, and treating them as one would erase a
 *     country from every world map to catch a placeholder.
 *
 * For the same reason nothing two letters long belongs here: "no" is Norway, "nd" is not a
 * country but "ne" is Niger, and a placeholder is never worth a country.
 */
const BLANK_LIKE = new Set([
    "n a",              // N/A, n/a, N.A. — see the Namibia note above
    "none",
    "null",
    "nil",
    "unknown",
    "not applicable",
    "not available",
    "not specified",
    "unspecified",
    "missing",
    "blank",
    "empty",
    "tbd",
    "to be determined",
]);

/**
 * Is this ALREADY-NORMALIZED token a blank in disguise?
 *
 * Callers pass the output of normalizePlaceName, so genuine blanks are "" by then; this
 * catches the ones a person typed. Excluded from the denominator, not counted as a failed
 * match — a column of 40 countries and one "N/A" is a clean country column with a hole in
 * it, not a 97.6%-quality one, and the difference decides whether the map draws.
 */
export function isBlankLike(normalized: string): boolean {
    if (!normalized) return true;
    return BLANK_LIKE.has(normalized);
}
