// KNOWN-NAME KEYS - the one loose form every match against a table of names we KNOW goes through.
//
// Countries, states, provinces, cities, month and weekday names and chart-type names are all
// closed vocabularies that readers type in whatever form their data happens to hold: "NewZealand",
// "Cote dIvoire", "Trinidad and Tobago" against a table that says "Trinidad & Tobago", "fevrier"
// for "février", "barchart" for "Bar chart". The standing rule for all of them is the same: the
// match is diacritic-neutral and case-, whitespace- and punctuation-insensitive, on BOTH sides.
//
// ONE FUNCTION, because the form is only useful if the table and the input agree on it to the
// character. A second copy that differs by one step (keeps a hyphen, folds one letter fewer) misses
// silently and reports "not a known name" instead of failing loudly.
//
// THE LOOSE KEY IS NEVER THE FIRST QUESTION. Every caller looks up its EXACT key first and asks the
// loose key only on a miss, so nothing that matched before can match differently now; the loose key
// only adds matches. And a loose key that two different known names share is AMBIGUOUS: the caller
// refuses it rather than picking one (see `LooseIndex`).
//
// This module imports nothing, so every other module can depend on it without a cycle.

/**
 * Latin letters whose mark is FUSED into the character, so canonical decomposition cannot split
 * it off: ø, ł, đ, ı, æ, ß, þ, ð have no decomposition at all, and without this they survive into a
 * key and leave "København" unreachable from "Kobenhavn". The multi-letter expansions are the
 * conventional transliterations (ß -> ss is how German writes it without the letter).
 *
 * Schwa has TWO code points in real place data - U+0259 and U+01DD (turned e); Azerbaijani names
 * carry both ("Gəncə" / "Gǝncǝ"). ĳ, ŀ and ſ decompose only under COMPATIBILITY normalisation, so a
 * canonical (NFD) key needs them here too.
 */
export const LATIN_FOLD: Readonly<Record<string, string>> = Object.freeze({
    "ø": "o", "œ": "oe", "æ": "ae", "ß": "ss", "ł": "l", "đ": "d", "ð": "d",
    "þ": "th", "ı": "i", "ħ": "h", "ŧ": "t", "ŋ": "n", "ĸ": "k",
    "ə": "e", "ǝ": "e",
    "ĳ": "ij", "ŀ": "l", "ſ": "s",
});

// Built from the map's own keys, so a letter added to the map is a letter the fold applies. (The
// character class this replaces was typed by hand and left four of the map's entries unreachable.)
const LATIN_FOLD_RE = new RegExp(`[${Object.keys(LATIN_FOLD).join("")}]`, "gu");

/** Replace every fused Latin letter with its conventional plain spelling. Expects lower case. */
export function foldLatin(s: string): string {
    return s.replace(LATIN_FOLD_RE, ch => LATIN_FOLD[ch] ?? ch);
}

/**
 * The LOOSE key of a known name: compatibility-decomposed, marks stripped, lower-cased, fused
 * letters folded, "&" read as "and", and everything that is not a letter or a decimal digit
 * dropped. "Côte d'Ivoire", "Cote dIvoire" and "COTE-D'IVOIRE" are one key; so are "Trinidad &
 * Tobago" and "TrinidadandTobago", "Bar chart" and "bar-chart", "février" and "fevrier".
 *
 * - COMPATIBILITY decomposition (NFKD), not canonical: full-width letters, the ĳ digraph and the
 *   long s are the same letters a reader means.
 * - SUPERSCRIPTS AND FRACTIONS GO FIRST, before decomposition would turn "²" into a digit: a
 *   footnote marker riding a name ("Ottawa²") is not part of it.
 * - MARKS are stripped by the Unicode Diacritic property, the same class the place key strips, so
 *   for input with no "&" and no compatibility character the loose key is exactly the place key
 *   with its spaces removed.
 * - Letters of every script survive, so a Japanese or Arabic name keys as itself.
 *
 * Never throws; a null or non-string input keys as "".
 */
export function looseNameKey(s: string | null | undefined): string {
    if (s === null || s === undefined) return "";
    return foldLatin(String(s)
        .replace(/\p{No}/gu, " ")
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase())
        .replace(/&/g, "and")
        .replace(/[^\p{L}\p{Nd}]/gu, "");
}

/**
 * THE SHORTEST LOOSE KEY A LOOKUP MAY USE. Below it, a key is a CODE, and codes are matched as codes.
 *
 * Squeezing the punctuation out of an abbreviation turns it into somebody else's code: "N/A" becomes
 * "na" (Namibia), "N.C." becomes "nc" (a USPS code the state-NAME table would then claim), "U.K."
 * becomes "uk". Every real name that loosening exists to reach - "NewZealand", "NorthCarolina",
 * "SaoPaulo", "barchart", "fevrier" - is far longer, so the floor costs nothing and closes the
 * class. Month abbreviations never need the loose key: "Sept." is an exact match already.
 */
export const LOOSE_KEY_MIN_LENGTH = 4;

/** True when a loose key is long enough to be looked up (see LOOSE_KEY_MIN_LENGTH). */
export function isUsableLooseKey(key: string): boolean {
    return key.length >= LOOSE_KEY_MIN_LENGTH;
}

/**
 * A loose index over a table of known names: loose key -> the one value it names, or AMBIGUOUS.
 *
 * Built from (name, value) pairs; two pairs whose names share a loose key and whose values differ
 * (by `same`) make that key ambiguous, and `get` then answers undefined - a refusal, never a pick.
 * Keys shorter than LOOSE_KEY_MIN_LENGTH are never stored.
 */
export class LooseIndex<V> {
    private readonly map = new Map<string, { value: V; ambiguous: boolean }>();
    constructor(private readonly same: (a: V, b: V) => boolean = (a, b) => a === b) {}

    /** Index `value` under the loose key of `name`. */
    add(name: string, value: V): void {
        const key = looseNameKey(name);
        if (!isUsableLooseKey(key)) return;
        const cur = this.map.get(key);
        if (!cur) { this.map.set(key, { value, ambiguous: false }); return; }
        if (!cur.ambiguous && !this.same(cur.value, value)) cur.ambiguous = true;
    }

    /** The value a loose key names, or undefined when it names none or more than one. */
    get(looseKey: string): V | undefined {
        if (!isUsableLooseKey(looseKey)) return undefined;
        const hit = this.map.get(looseKey);
        return hit && !hit.ambiguous ? hit.value : undefined;
    }

    /** True when the key names more than one value. */
    isAmbiguous(looseKey: string): boolean {
        return this.map.get(looseKey)?.ambiguous === true;
    }

    /** Every stored key with its state - for the collision tests, which pin what is ambiguous. */
    entries(): Array<[string, { value: V; ambiguous: boolean }]> {
        return Array.from(this.map.entries());
    }
}
