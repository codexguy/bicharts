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
        const v = raw.trim();
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
    const s = String(text ?? "").trim();
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
