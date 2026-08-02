// IDENTIFYING A ROLE IS A JUDGEMENT. RESOLVING A VALUE IS NOT.
//
// Those are two different jobs and only the first one has a threshold, which is the whole
// reason this file exists as one place rather than a constant per classifier.
//
//   IDENTIFICATION — "is this column the city / the state / the ZIP / the country?" is
//   decided across ALL the column's values at once, and it has to tolerate the state of real
//   data: a typo, an abbreviation nobody standardised, a row someone typed by hand. So it
//   takes a ratio, and ROLE_MATCH_PCT is that ratio, for every role.
//
//   MATCHING — once a column HAS a role, a value either resolves against the gazetteer or it
//   does not. There is no ratio, no nearly, no fuzzy fallback. Joel, 2026-08-02: "after that,
//   what's a real country, state or city kind of *has to* match the gazette, based on the
//   established roles, period." A value that fails to resolve is reported as unplaced and
//   the chart says so; it is never approximated onto a coordinate, because a point on a map
//   is a claim about where something IS.
//
// Keeping the threshold here, named for identification, is what stops the two from bleeding
// into each other — a "95%" sitting next to a lookup would eventually be read as licence to
// accept a 95% match, which is exactly the mistake that puts a mark in the wrong country.

/**
 * THE KNOB. Minimum share of a column's NON-BLANK distinct values that must resolve, before
 * that column may claim a geographic role.
 *
 * One number for every role — city, state, ZIP, country, and the choropleth region detector
 * (Joel 2026-08-02: "I would prefer one constant, so maybe we make that 95 and apply to
 * all"). Tune here and they all move together.
 *
 * 95 is high enough that a column of something else cannot claim a role by accident, and
 * loose enough to survive the odd bad row. Below it the data needs cleaning, which is the
 * user's call and not something to guess through.
 *
 * It replaced three separate numbers: 85 for the name roles, 100 for ZIP, and an implicit
 * 100 for country. The ZIP one is the notable change — it was 100 because ZIP is classified
 * on digit shape alone and a 5-digit Revenue column reads as a perfectly good run of ZIPs.
 * That protection was always really the MEASURE EXCLUSION (callers pass dimensions only);
 * 100 vs 95 never distinguished a revenue column from a ZIP column, since both score 100.
 */
export const ROLE_MATCH_PCT = 95;

/**
 * Normalized tokens that mean "no value here".
 *
 * Blanks leave the DENOMINATOR — they are not failed matches (Joel: "my 97% is for
 * non-blanks, by the way"). Forty countries and one "N/A" is a clean country column with a
 * hole in it, not a 97.6%-quality one, and the difference decides whether the map draws.
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
 * For the same reason nothing two letters long belongs here: "no" is Norway, "ne" is Niger,
 * and a placeholder is never worth a country.
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
 * catches the ones a person typed.
 */
export function isBlankLike(normalized: string): boolean {
    if (!normalized) return true;
    return BLANK_LIKE.has(normalized);
}
