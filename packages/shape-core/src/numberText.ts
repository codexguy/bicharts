// NUMBERS WRITTEN AS TEXT - which character is the decimal point, decided per COLUMN (2026-09-24).
//
// A decimal comma is data, not language, and reading it wrong is a wrong NUMBER rather than a
// wrong word. The shared parser read every text number the English way: `12,5` (German twelve and
// a half) failed the pattern and turned its whole column into text, and `1.234` (German one
// thousand two hundred and thirty-four) read as one point two three four - off by a thousand,
// silently, with a chart drawn from it.
//
// THE RULE. The separator is decided once per column, from the values, because one value can be
// ambiguous where its column is not:
//   - `1,234.5`, `3.25`, `1,234,567` are only possible with a DOT decimal;
//   - `1.234,5`, `3,25`, `1.234.567`, `1 234,5` are only possible with a COMMA decimal;
//   - `12,500` and `12.500` (one group of exactly three digits) and plain integers could be
//     either, and prove nothing.
// A column with evidence one way and none the other takes that way. A column with evidence both
// ways keeps the dot, which leaves the values that do not fit it as text - exactly what happened
// before. A column with NO evidence (all ambiguous or integers) takes the culture's separator,
// and with no culture, the dot: an English reader's `12,500` is still twelve thousand five hundred.

export type DecimalSeparator = "." | ",";

// NUMERALS OF OTHER SCRIPTS (2026-10-08). A spreadsheet in an Arabic, Persian, Hindi or Thai locale
// writes its digits in that script (`١٢٫٥`, `۱۲٫۵`, `१२.५`, `๑๒.๕`), and a Japanese one often in the
// full-width forms (`１２．５`). They are the same numbers as `12.5`, and the parser read none of them:
// the digit class of a pattern is ASCII only, so every such column was text. Folding them to ASCII digits first makes the one
// reader below read all of them, and nothing else changes: a column in ASCII digits is returned
// untouched (the fast path is one test for a non-ASCII character).
//
// The Arabic decimal separator `٫` (U+066B) is a dot and the Arabic thousands separator `٬` (U+066C) a
// comma, which is what they ARE, so the separator rules in the header are unchanged. The full-width dot
// and comma ride with the full-width digits. Only the decimal digit sets of the major scripts are
// folded; a character this table does not know is left alone, and the value stays text.
const NUMERAL_ZEROS = [
    0x0660,   // Arabic-Indic
    0x06F0,   // Extended Arabic-Indic (Persian, Urdu)
    0x0966,   // Devanagari
    0x09E6,   // Bengali
    0x0A66,   // Gurmukhi
    0x0AE6,   // Gujarati
    0x0B66,   // Odia
    0x0BE6,   // Tamil
    0x0C66,   // Telugu
    0x0CE6,   // Kannada
    0x0D66,   // Malayalam
    0x0E50,   // Thai
    0x0ED0,   // Lao
    0x0F20,   // Tibetan
    0x1040,   // Myanmar
    0x17E0,   // Khmer
    0xFF10,   // Full-width
];
const NUMERAL_RE = new RegExp(
    "[" + NUMERAL_ZEROS.map(z => String.fromCharCode(z) + "-" + String.fromCharCode(z + 9)).join("") + "\\u066B\\u066C\\uFF0C\\uFF0E]", "g");
const NON_ASCII = /[^\x00-\x7F]/;

/** The text with every digit of another script written as an ASCII digit, and the Arabic and
 *  full-width decimal and thousands marks as `.` and `,`. ASCII text is returned as it came. */
export function foldNumerals(text: string): string {
    if (!NON_ASCII.test(text)) return text;
    return text.replace(NUMERAL_RE, ch => {
        const cp = ch.charCodeAt(0);
        if (cp === 0x066B || cp === 0xFF0E) return ".";
        if (cp === 0x066C || cp === 0xFF0C) return ",";
        for (const z of NUMERAL_ZEROS) if (cp >= z && cp <= z + 9) return String(cp - z);
        return ch;
    });
}

/** The runtime's decimal separator for a culture, reduced to the two this parser reads. Anything
 *  unparseable, or a separator that is neither (the Arabic `٫`), reads as the dot. */
export function decimalSeparatorOf(locale: string | null | undefined): DecimalSeparator {
    if (!locale) return ".";
    try {
        const part = new Intl.NumberFormat(locale).formatToParts(1.5).find(p => p.type === "decimal");
        return part?.value === "," ? "," : ".";
    } catch {
        return ".";
    }
}

const SPACE_GROUP = "[ \\u00A0\\u202F]";
const EXP = "(?:[eE][+-]?\\d+)?";

/** Parseable with a DOT decimal: optional comma thousands, optional fraction. */
const DOT_NUMBER = new RegExp(`^[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?${EXP}$`);
/** Parseable with a COMMA decimal: optional dot or space thousands, optional fraction. */
const COMMA_NUMBER = new RegExp(`^[+-]?(?:\\d{1,3}(?:\\.\\d{3})+|\\d{1,3}(?:${SPACE_GROUP}\\d{3})+|\\d+)(?:,\\d+)?${EXP}$`);

/** One group of exactly three digits after the only separator - `12,500`, `1.234`: either reading. */
const AMBIGUOUS = /^[+-]?\d{1,3}[.,]\d{3}$/;
const DOT_EVIDENCE = [
    /^[+-]?\d{1,3}(?:,\d{3}){2,}$/,                              // 1,234,567
    new RegExp(`^[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d+${EXP}$`), // 1,234.5 | 3.25
];
const COMMA_EVIDENCE = [
    /^[+-]?\d{1,3}(?:\.\d{3}){2,}$/,                             // 1.234.567
    new RegExp(`^[+-]?(?:\\d{1,3}(?:\\.\\d{3})+|\\d{1,3}(?:${SPACE_GROUP}\\d{3})+|\\d+),\\d+${EXP}$`), // 1.234,5 | 1 234,5 | 3,25
];

/**
 * THE COLUMN'S DECIMAL SEPARATOR, from its text values (non-strings are ignored - an already-typed
 * number needs no reading). See the header for the rule; `locale` is the tiebreak for a column
 * with no evidence either way.
 */
export function detectDecimalSeparator(samples: ReadonlyArray<unknown>, locale?: string | null): DecimalSeparator {
    let dot = 0, comma = 0;
    for (const raw of samples) {
        if (typeof raw !== "string") continue;
        const v = foldNumerals(raw.trim());
        if (v === "" || AMBIGUOUS.test(v)) continue;
        if (DOT_EVIDENCE.some(re => re.test(v))) dot++;
        else if (COMMA_EVIDENCE.some(re => re.test(v))) comma++;
    }
    if (comma > 0 && dot === 0) return ",";
    if (dot > 0) return ".";
    return decimalSeparatorOf(locale);
}

/** The number a text value spells under the column's separator, or null when it spells none. */
export function parseNumberText(text: string, decimal: DecimalSeparator): number | null {
    const s = foldNumerals(String(text ?? "").trim());
    if (s === "") return null;
    if (decimal === ",") {
        if (!COMMA_NUMBER.test(s)) return null;
        return parseFloat(s.replace(/[.   ]/g, "").replace(",", "."));
    }
    // Byte-for-byte the reading this parser always gave a dot-decimal column.
    if (!DOT_NUMBER.test(s)) return null;
    return parseFloat(s.replace(/,/g, ""));
}

/** TRUE when the text is a number under the column's separator. */
export function isNumberText(text: string, decimal: DecimalSeparator): boolean {
    return parseNumberText(text, decimal) !== null;
}
