// SPREADSHEET ERROR CELLS - the text a formula error leaves in a cell once it has been saved as text (a CSV, a pasted
// table), in the language the spreadsheet ran in.
//
// WHAT READS IT. `ingest()`: a cell that IS one of these is not data. It is read as a blank before any column is typed,
// so one `#N/A` in a revenue column does not make the column text, and one German `#NV` among dates does not stop it
// being a date column. The Excel add-in reads Excel's own cell type instead (`range.valueTypes`); a CSV has no such
// thing, so the text is all there is.
//
// HOW IT IS READ - THE WHOLE CELL, AND ONLY TWO SHAPES:
//   1. the error SHAPE every language's Excel uses for all but one error: `#`, then upper-case letters, digits and the
//      few marks error names carry (`/ _ . ¡ ¿`), ending in `!` or `?`. English `#DIV/0!` `#VALUE!` `#NAME?`, German
//      `#WERT!` `#BEZUG!`, French `#VALEUR!` `#NOM?`, Spanish `#¡VALOR!` `#¿NOMBRE?`, Russian `#ЗНАЧ!` `#ИМЯ?`, and the
//      errors Excel adds later (`#SPILL!`, `#CALC!`, `#PYTHON!`) without a release here. Upper case is what keeps a
//      hashtag label (`#winning!`) a label;
//   2. the one error that does not end that way, "no value available", listed per language (`NOT_AVAILABLE`), plus
//      `#GETTING_DATA`, which Excel writes while a cube function is still loading.
// A cell with anything else in it - `#1`, `#N/A in Q3`, `# Sold` - stays what it was.
//
// WHY A SHAPE AND NOT A LIST of every error in every language: the list cannot be complete (Excel adds errors, and a
// localized name is easy to get wrong), and getting one wrong leaves the error in the data, which is the defect. The
// shape cannot be wrong that way. The not-available list is short, and each entry is distinctive (`#` + a short code).

/** "No value available" (`#N/A`), as each language's Excel writes it. Matched whole, case-insensitively. */
export const NOT_AVAILABLE: readonly string[] = [
    "#N/A",          // en (and ja, zh, ko, which keep the English error names), fr, pt-PT
    "#NV",           // de
    "#N/D",          // es, it, pt-BR, pl (`#N/D!`)
    "#N/D!",         // pl
    "#N/B",          // nl
    "#Н/Д",          // ru, uk
    "#I/T",          // da, nb
    "#PUUTTUU!",     // fi
    "#SAKNAS!",      // sv
    "#HIÁNYZIK",     // hu
    "#NENÍ_K_DISPOZICI", // cs
    "#YOK",          // tr
    "#GETTING_DATA", // every language: a cube function still loading
];

const NA = new Set(NOT_AVAILABLE.map(s => s.toUpperCase()));
const ERROR_SHAPE = /^#[\p{Lu}\p{Nd}_/.¡¿]{1,24}[!?]$/u;

/** True when a cell's whole text is a spreadsheet formula error, in any language (see the header). */
export function isSpreadsheetErrorText(v: unknown): boolean {
    if (typeof v !== "string") return false;
    const t = v.trim();
    if (t.length < 2 || t[0] !== "#") return false;
    return NA.has(t.toUpperCase()) || ERROR_SHAPE.test(t);
}
