// EXPORT A CHART'S ROWS TO A FILE (contract 1.19.0): a CSV and a real Excel workbook, written here with no dependency.
//
// A chart that can hand its rows out (the interactive table first) describes them as an ExportTable - the columns the
// reader sees, in the order shown, each with its kind of value, and the rows as DATA (a number is a number, a date is a
// date, never the text the chart printed) - and calls options.exportTable(table, format). This module turns the table
// into the file's bytes and gives them to the host's own file service (options.saveFile): a browser page downloads
// them, a sandboxed visual hands them to its host's download service. A host with no file service gets no
// exportTable, so a chart never offers an export that cannot happen.
//
// The workbook is the smallest valid SpreadsheetML package: one worksheet, inline strings (no shared-string table),
// one style sheet, stored (uncompressed) in a ZIP built here. What it carries is what a spreadsheet reader wants back:
// typed numbers with the chart's number format where Excel can say the same thing, real dates, TRUE/FALSE, a bold
// frozen header row with filter buttons, and column widths fitted to the values. Text is always text: a cell is never
// written as a formula, in the workbook or (guarded) in the CSV.

/** The kind of value one exported column holds. Anything that is not a number, a date or a yes/no is text. */
export type ExportColumnType = "text" | "number" | "date" | "boolean";

/** One exported column, in the order the reader sees it. */
export interface ExportColumn {
    /** The header, as the reader sees it. */
    name: string;
    type: ExportColumnType;
    /** The d3-format specifier the chart prints this number with (a number column only). Wins over modelFormat. */
    d3Format?: string | null;
    /** The data model's own number format (an Excel / Power BI format string), used when there is no d3Format. */
    modelFormat?: string | null;
}

/** One cell's value. A blank (null, undefined, "" or a value its column's type cannot read) is an empty cell. */
export type ExportCell = string | number | boolean | Date | null | undefined;

/** What a chart hands out: the visible columns in display order, and the rows in display order. */
export interface ExportTable {
    /** Names the file and the worksheet. Absent: "table". */
    title?: string | null;
    columns: ExportColumn[];
    rows: ExportCell[][];
}

export type ExportFormat = "csv" | "xlsx";

/** The formats a chart may offer, best first. */
export const EXPORT_FORMATS: readonly ExportFormat[] = Object.freeze(["xlsx", "csv"]);

/** A finished file, as a host's file service receives it. */
export interface ExportFile {
    /** A file name with its extension, safe on every file system. */
    name: string;
    format: ExportFormat;
    mime: string;
    bytes: Uint8Array;
    /** The same content as text, for a text format (the CSV); absent for a binary one. */
    text?: string;
    /**
     * The table the file was written from, for a host that keeps it its own way (a spreadsheet add-in that must give
     * the new sheet a name the open workbook does not already use, and so writes the workbook again under that name).
     */
    table: ExportTable;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME = "text/csv";

const XLSX_MAX_ROWS = 1048576;
const XLSX_MAX_COLS = 16384;
const XLSX_MAX_CELL_CHARS = 32767;

// ---------------------------------------------------------------- reading a cell ------------------------------------

function isBlank(v: unknown): boolean {
    return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function asNumber(v: ExportCell): number | null {
    if (isBlank(v) || typeof v === "boolean") return null;
    if (v instanceof Date) return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
}

/** A date cell as a time, read as UTC (the payload carries a calendar day as its UTC midnight). */
function asTime(v: ExportCell): number | null {
    if (isBlank(v) || typeof v === "boolean") return null;
    if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    // a bare calendar day is that day's UTC midnight, never the reader's local midnight
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (day) return Date.UTC(+day[1], +day[2] - 1, +day[3]);
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
}

function asBoolean(v: ExportCell): boolean | null {
    if (v === true || v === false) return v;
    if (isBlank(v)) return null;
    const s = String(v).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return null;
}

function asText(v: ExportCell): string {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : "";
    return String(v);
}

const DAY_MS = 86400000;
function hasTimeOfDay(t: number): boolean { return ((t % DAY_MS) + DAY_MS) % DAY_MS !== 0; }

function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }
function isoDay(t: number): string {
    const d = new Date(t);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function isoDayTime(t: number): string {
    const d = new Date(t);
    return isoDay(t) + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds());
}

/**
 * Excel's day number for a UTC time: days since 1899-12-30, the fraction being the time of day. Excel counts a
 * 29 February 1900 that never was (day 60), so a day before 1 March 1900 is one lower to read back as itself.
 */
export function excelSerial(t: number): number {
    const s = t / DAY_MS + 25569;
    return s < 61 ? s - 1 : s;
}

// The first day a workbook can hold as a date (1900-01-01, Excel's day 1); an earlier one is written as its ISO text.
const EXCEL_FIRST_DAY = Date.UTC(1900, 0, 1);

/** Decimal places a number shows when written plainly, to at most 15. */
function fractionDigits(n: number): number {
    const s = String(Math.abs(n));
    if (/e/i.test(s)) return 0;
    const dot = s.indexOf(".");
    return dot < 0 ? 0 : Math.min(15, s.length - dot - 1);
}

// ---------------------------------------------------------------- number formats ------------------------------------

interface NumberShape {
    prefix: string;
    suffix: string;
    group: boolean;
    minD: number;
    maxD: number;
    percent: boolean;
    plus: boolean;
    parens: boolean;
    scientific: boolean;
}

// d3-format's specifier: [[fill]align][sign][symbol][0][width][,][.precision][~][type]
const D3_SPEC_RE = /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;

function shapeFromD3(spec: string): NumberShape | null {
    const m = D3_SPEC_RE.exec(spec.trim());
    if (!m) return null;
    const sign = m[3] || "", symbol = m[4] || "", group = !!m[7], trim = !!m[9], type = m[10] || "";
    const p = m[8] ? parseInt(m[8].slice(1), 10) : null;
    const base: NumberShape = { prefix: symbol === "$" ? "$" : "", suffix: "", group, minD: 0, maxD: 0, percent: false, plus: sign === "+", parens: sign === "(", scientific: false };
    if (type === "f") { const d = p === null ? 6 : p; return { ...base, maxD: d, minD: trim ? 0 : d }; }
    if (type === "%") { const d = p === null ? 6 : p; return { ...base, percent: true, maxD: d, minD: trim ? 0 : d }; }
    if (type === "d") return base;
    if (type === "e") { const d = p === null ? 6 : p; return { ...base, scientific: true, maxD: d, minD: d }; }
    // no type (or 'n' / 'g' / 'r', which count significant digits Excel cannot) with grouping: the digits as they come, grouped
    if ((type === "" || type === "n" || type === "g" || type === "r") && (group || type === "n")) return { ...base, group: true, maxD: 15, minD: 0 };
    // 's' (SI prefixes), 'x', 'o', 'b', 'c' and the rest have no Excel equivalent: General
    return null;
}

// An Excel / Power BI format string, read the way the chart reads it: its first section's currency symbol (before or
// after the digits), percent, decimals (a 0 is a decimal always shown, a # one shown when there is one), its thousands
// separator, a leading '+', and a negative section in parentheses. The workbook is then given a format WE build from
// that reading, never the model's string itself: a token Excel does not know (a locale tag it cannot read) would make
// it repair the whole file on open.
function shapeFromModel(fmt: string): NumberShape | null {
    const sections = fmt.split(";");
    const sec = sections[0];
    const bracketSym = (/\[\$([^\-\]]+)/.exec(sec) || [])[1] || "";
    const noTok = sec.replace(/\[[^\]]*\]/g, "");
    const bare = noTok.replace(/"[^"]*"/g, "").replace(/\\./g, "");
    const pct = bare.indexOf("%") >= 0;
    if (!pct && !/[0#]/.test(bare)) return null;   // a date or text format: no number format
    let sym = bracketSym;
    let symAfter = false;
    if (!sym) {
        const lit = /"([^"]*[$\u20AC\u00A3\u00A5][^"]*)"/.exec(noTok);
        const cur = lit ? null : /\\?([$\u20AC\u00A3\u00A5])/.exec(noTok);
        if (lit) sym = lit[1].trim();
        else if (cur) sym = cur[1];
    }
    if (sym) {
        const firstDigit = noTok.search(/[0#]/);
        const at = noTok.indexOf(sym);
        symAfter = at >= 0 && firstDigit >= 0 && at > firstDigit;
    }
    const dm = /\.([0#]+)/.exec(bare);
    const maxD = dm ? dm[1].length : 0, minD = dm ? dm[1].replace(/#/g, "").length : 0;
    return {
        prefix: sym && !symAfter ? sym : "",
        suffix: sym && symAfter ? sym : "",
        group: bare.indexOf(",") >= 0,
        minD, maxD: Math.min(15, maxD), percent: pct,
        plus: /^\s*\+/.test(bare),
        parens: sections.length > 1 && /\(/.test(sections[1]) && /\)/.test(sections[1]),
        scientific: false,
    };
}

function quoteLiteral(s: string): string {
    return s ? '"' + s.replace(/"/g, "") + '"' : "";
}

function codeFromShape(sh: NumberShape, dataFrac: number): string | null {
    // Decimals: those always shown, plus those the data actually has, up to the most the format allows. A '#' decimal
    // would leave Excel printing "12." for a whole number, so the workbook's decimals are always fixed zeros.
    const d = Math.max(sh.minD, Math.min(sh.maxD, dataFrac));
    if (sh.scientific) return "0" + (d > 0 ? "." + "0".repeat(d) : "") + "E+00";
    const core = (sh.group ? "#,##0" : "0") + (d > 0 ? "." + "0".repeat(d) : "") + (sh.percent ? "%" : "");
    const body = quoteLiteral(sh.prefix) + core + quoteLiteral(sh.suffix);
    if (!sh.plus && !sh.parens) {
        // a plain whole number in General already reads as itself: say nothing rather than "0"
        return body === "0" ? null : body;
    }
    const pos = (sh.plus ? "+" : "") + body;
    const neg = sh.parens ? "(" + body + ")" : "-" + body;
    return pos + ";" + neg + ";" + body;
}

/**
 * The Excel number format for an exported number column, or null for General. `values` are the column's numbers, so a
 * format that shows "up to" some decimals shows as many as the data has.
 */
export function excelNumberFormat(col: Pick<ExportColumn, "d3Format" | "modelFormat">, values: readonly number[] = []): string | null {
    let sh: NumberShape | null = null;
    if (typeof col.d3Format === "string" && col.d3Format.trim()) sh = shapeFromD3(col.d3Format);
    else if (typeof col.modelFormat === "string" && col.modelFormat.trim()) sh = shapeFromModel(col.modelFormat);
    if (!sh) return null;
    let frac = 0;
    for (const v of values) {
        const f = fractionDigits(sh.percent ? Math.round(v * 100 * 1e9) / 1e9 : v);
        if (f > frac) frac = f;
    }
    return codeFromShape(sh, frac);
}

// ---------------------------------------------------------------- CSV ------------------------------------------------

// A text cell that starts like a formula would RUN in a spreadsheet that opens the file; it is written with a leading
// apostrophe, so it reads as the text it is. Numbers are written as numbers and are never touched.
const FORMULA_START_RE = /^[=+\-@\t\r]/;

function csvField(s: string): string {
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function columnUsesTime(table: ExportTable, ci: number): boolean {
    for (const r of table.rows) { const t = asTime(r[ci]); if (t !== null && hasTimeOfDay(t)) return true; }
    return false;
}

/**
 * The table as CSV text: a header row, then one line per row, CRLF between lines, RFC 4180 quoting. A number is its
 * plain value (a point for the decimal, no grouping), a date its ISO day (and time, when the column has one), a yes/no
 * TRUE or FALSE. The text starts with a byte-order mark so a spreadsheet reads it as UTF-8.
 */
export function tableToCsv(table: ExportTable): string {
    const cols = table.columns;
    const withTime = cols.map((c, ci) => c.type === "date" && columnUsesTime(table, ci));
    const lines: string[] = [cols.map(c => csvField(guardText(c.name))).join(",")];
    for (const row of table.rows) {
        const out: string[] = [];
        for (let ci = 0; ci < cols.length; ci++) {
            const c = cols[ci], v = row[ci];
            if (c.type === "number") { const n = asNumber(v); out.push(n === null ? "" : String(n)); continue; }
            if (c.type === "date") {
                const t = asTime(v);
                out.push(t === null ? csvField(guardText(asText(v))) : (withTime[ci] ? isoDayTime(t) : isoDay(t)));
                continue;
            }
            if (c.type === "boolean") { const b = asBoolean(v); out.push(b === null ? csvField(guardText(asText(v))) : (b ? "TRUE" : "FALSE")); continue; }
            out.push(csvField(guardText(asText(v))));
        }
        lines.push(out.join(","));
    }
    return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function guardText(s: string): string {
    return FORMULA_START_RE.test(s) ? "'" + s : s;
}

// ---------------------------------------------------------------- XLSX -----------------------------------------------

// XML 1.0 refuses these characters anywhere, escaped or not; a cell holding one would make the whole sheet unreadable.
// eslint-disable-next-line no-control-regex
const XML_BAD_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xmlText(s: string): string {
    return s.replace(XML_BAD_RE, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A1-style column letters for a 0-based column index. */
export function columnLetters(ci: number): string {
    let s = "", n = ci + 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

/** A worksheet name Excel accepts: at most 31 characters, none of []:*?/\, not blank, not starting or ending with '. */
export function sheetName(title: string | null | undefined): string {
    let s = String(title ?? "").replace(/[\[\]:*?/\\]/g, " ").replace(XML_BAD_RE, "").replace(/\s+/g, " ").trim();
    s = s.replace(/^'+|'+$/g, "").trim();
    if (s.length > 31) s = s.slice(0, 31).trim();
    if (!s || s.toLowerCase() === "history") s = "Data";
    return s;
}

/** A file name safe on every file system, from a title: no reserved characters, at most 80 characters. */
export function exportFileName(title: string | null | undefined, format: ExportFormat): string {
    let s = String(title ?? "").replace(XML_BAD_RE, "").replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/[. ]+$/, "");
    if (s.length > 80) s = s.slice(0, 80).trim();
    if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = "table";
    return s + "." + format;
}

interface CellOut { xml: string; width: number }

/**
 * The table as an .xlsx workbook's bytes. One worksheet named after the title: a bold header row, frozen, with filter
 * buttons; typed cells (numbers with their format where Excel can carry it, dates as dates, TRUE/FALSE); each column as
 * wide as its widest value, within limits. Rows past Excel's limit are left out (a sheet holds 1,048,576 rows).
 */
export function tableToXlsx(table: ExportTable): Uint8Array {
    const cols = table.columns.slice(0, XLSX_MAX_COLS);
    const rows = table.rows.slice(0, XLSX_MAX_ROWS - 1);
    const nC = cols.length;

    // styles: 0 default, 1 header (bold), 2 date, 3 date and time, then one per distinct number format
    const numFmtIds: Record<string, number> = {};
    const numFmtList: string[] = [];
    const xfFor: Record<string, number> = {};
    const XF_DATE = 2, XF_DATETIME = 3;
    let nextXf = 4;
    const colXf: number[] = [];
    const colTime: boolean[] = [];
    for (let ci = 0; ci < nC; ci++) {
        const c = cols[ci];
        colTime.push(c.type === "date" && columnUsesTime({ columns: cols, rows }, ci));
        if (c.type === "number") {
            const vals: number[] = [];
            for (const r of rows) { const n = asNumber(r[ci]); if (n !== null) vals.push(n); }
            const code = excelNumberFormat(c, vals);
            if (code) {
                if (numFmtIds[code] === undefined) { numFmtIds[code] = 164 + numFmtList.length; numFmtList.push(code); }
                if (xfFor[code] === undefined) xfFor[code] = nextXf++;
                colXf.push(xfFor[code]);
            } else colXf.push(0);
        } else if (c.type === "date") colXf.push(colTime[ci] ? XF_DATETIME : XF_DATE);
        else colXf.push(0);
    }

    // widths, in characters: the header, then the widest value as written (a date as its ISO form)
    const widths = cols.map(c => Math.min(60, String(c.name).length + 3));
    const sheetRows: string[] = [];
    const ref = (ci: number, ri: number) => columnLetters(ci) + (ri + 1);

    const head: string[] = [];
    for (let ci = 0; ci < nC; ci++) head.push(inlineStr(ref(ci, 0), cols[ci].name, 1));
    sheetRows.push('<row r="1">' + head.join("") + "</row>");

    for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri], cells: string[] = [];
        for (let ci = 0; ci < nC; ci++) {
            const out = cellXml(cols[ci], row[ci], ref(ci, ri + 1), colXf[ci], colTime[ci]);
            if (!out) continue;
            cells.push(out.xml);
            if (out.width > widths[ci]) widths[ci] = Math.min(60, out.width);
        }
        sheetRows.push('<row r="' + (ri + 2) + '">' + cells.join("") + "</row>");
    }

    const lastRef = nC ? columnLetters(nC - 1) + (rows.length + 1) : "A1";
    const colsXml = nC ? "<cols>" + widths.map((w, ci) =>
        '<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' + Math.max(8, Math.round(w + 1)) + '" customWidth="1"/>').join("") + "</cols>" : "";
    const name = sheetName(table.title);
    const sheetXml = XML_HEAD +
        '<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
        '<dimension ref="A1:' + lastRef + '"/>' +
        '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
        (nC ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : "") +
        "</sheetView></sheetViews>" +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        colsXml +
        "<sheetData>" + sheetRows.join("") + "</sheetData>" +
        (nC ? '<autoFilter ref="A1:' + lastRef + '"/>' : "") +
        "</worksheet>";

    const workbookXml = XML_HEAD +
        '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
        '<bookViews><workbookView/></bookViews>' +
        '<sheets><sheet name="' + xmlText(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
        (nC ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
            xmlText("'" + name.replace(/'/g, "''") + "'!$A$1:$" + columnLetters(nC - 1) + "$" + (rows.length + 1)) + "</definedName></definedNames>" : "") +
        "</workbook>";

    const numFmtsXml = numFmtList.length
        ? '<numFmts count="' + numFmtList.length + '">' + numFmtList.map(code => '<numFmt numFmtId="' + numFmtIds[code] + '" formatCode="' + xmlText(code) + '"/>').join("") + "</numFmts>"
        : "";
    const xfs = [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
        '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
        '<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
    ];
    for (const code of numFmtList) xfs[xfFor[code]] = '<xf numFmtId="' + numFmtIds[code] + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>';
    const stylesXml = XML_HEAD +
        '<styleSheet xmlns="' + NS_MAIN + '">' + numFmtsXml +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + xfs.length + '">' + xfs.join("") + "</cellXfs>" +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>";

    const contentTypes = XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>";
    const rootRels = XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>";
    const workbookRels = XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>";

    return zipStored([
        ["[Content_Types].xml", contentTypes],
        ["_rels/.rels", rootRels],
        ["xl/workbook.xml", workbookXml],
        ["xl/_rels/workbook.xml.rels", workbookRels],
        ["xl/styles.xml", stylesXml],
        ["xl/worksheets/sheet1.xml", sheetXml],
    ]);
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function inlineStr(r: string, text: string, style: number): string {
    let s = String(text);
    if (s.length > XLSX_MAX_CELL_CHARS) s = s.slice(0, XLSX_MAX_CELL_CHARS);
    return '<c r="' + r + '"' + (style ? ' s="' + style + '"' : "") + ' t="inlineStr"><is><t xml:space="preserve">' + xmlText(s) + "</t></is></c>";
}

function cellXml(c: ExportColumn, v: ExportCell, r: string, xf: number, withTime: boolean): CellOut | null {
    if (isBlank(v)) return null;
    if (c.type === "number") {
        const n = asNumber(v);
        if (n !== null) return { xml: '<c r="' + r + '"' + (xf ? ' s="' + xf + '"' : "") + "><v>" + String(n) + "</v></c>", width: String(n).length + (Math.abs(n) >= 1000 ? Math.floor(Math.log10(Math.abs(n)) / 3) : 0) + 2 };
    } else if (c.type === "date") {
        const t = asTime(v);
        if (t !== null && t >= EXCEL_FIRST_DAY) return { xml: '<c r="' + r + '" s="' + xf + '"><v>' + String(excelSerial(t)) + "</v></c>", width: withTime ? 18 : 12 };
        if (t !== null) { const s = withTime ? isoDayTime(t) : isoDay(t); return { xml: inlineStr(r, s, 0), width: s.length + 1 }; }
    } else if (c.type === "boolean") {
        const b = asBoolean(v);
        if (b !== null) return { xml: '<c r="' + r + '" t="b"><v>' + (b ? 1 : 0) + "</v></c>", width: 7 };
    }
    // text, or a value its column's type cannot read: written as the text it is
    const s = asText(v);
    return { xml: inlineStr(r, s, 0), width: Math.min(60, longestLine(s) + 1) };
}

function longestLine(s: string): number {
    let mx = 0;
    for (const line of s.split(/\r?\n/)) if (line.length > mx) mx = line.length;
    return mx;
}

// ---------------------------------------------------------------- ZIP (stored) ----------------------------------------

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function utf8(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

/**
 * A ZIP archive of the given files, stored without compression (method 0) - every reader of a workbook accepts it. The
 * entries carry a fixed timestamp, so the same table always gives the same bytes.
 */
export function zipStored(files: Array<[string, string | Uint8Array]>): Uint8Array {
    const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;   // 1980-01-01 00:00
    const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
    let offset = 0;
    for (const [name, content] of files) {
        const nameBytes = utf8(name);
        const data = typeof content === "string" ? utf8(content) : content;
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true);          // names are UTF-8
        lv.setUint16(8, 0, true);               // stored
        lv.setUint16(10, DOS_TIME, true);
        lv.setUint16(12, DOS_DATE, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, DOS_TIME, true);
        cv.setUint16(14, DOS_DATE, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        locals.push(local, data);
        centrals.push(central);
        offset += local.length + data.length;
    }
    const centralSize = centrals.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    const total = offset + centralSize + end.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of locals) { out.set(part, at); at += part.length; }
    for (const part of centrals) { out.set(part, at); at += part.length; }
    out.set(end, at);
    return out;
}

// ---------------------------------------------------------------- the file a host saves -------------------------------

/** Builds the finished file for a table in one of the export formats. */
export function buildExportFile(table: ExportTable, format: ExportFormat): ExportFile {
    const name = exportFileName(table.title, format);
    if (format === "csv") {
        const text = tableToCsv(table);
        return { name, format, mime: CSV_MIME + ";charset=utf-8", bytes: utf8(text), text, table };
    }
    return { name, format, mime: XLSX_MIME, bytes: tableToXlsx(table), table };
}

/** Base64 of a file's bytes, for a host whose file service takes binary content as base64 text. */
export function bytesToBase64(bytes: Uint8Array): string {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
    }
    const rest = bytes.length - i;
    if (rest === 1) { const n = bytes[i] << 16; out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + "=="; }
    else if (rest === 2) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8); out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + "="; }
    return out;
}

/** A host's file service: saves a finished file the host's own way. False, a throw or a rejection means it did not. */
export type SaveFileService = (file: ExportFile) => boolean | void | Promise<boolean | void>;

/** The chart-facing export: what options.exportTable is. Resolves true when the host saved the file. */
export type ExportTableService = (table: ExportTable, format: ExportFormat) => Promise<boolean>;

/**
 * The formats a host's file service takes, best first: the host's own list (when it names one) kept to the formats
 * this module writes, in EXPORT_FORMATS order, without repeats. Absent or not a list: every format. An empty result
 * means the host can save none of them, so it gets no export.
 */
export function exportFormatsFor(hostFormats?: readonly unknown[] | null): ExportFormat[] {
    if (!Array.isArray(hostFormats)) return EXPORT_FORMATS.slice();
    return EXPORT_FORMATS.filter(f => hostFormats.indexOf(f) >= 0);
}

/**
 * Builds the chart-facing exportTable from a host's file service. Never throws and never rejects: a table that cannot
 * be written, a format the host does not take, or a host that refuses, resolves false, and the chart says the export
 * did not happen.
 */
export function exportTableService(save: SaveFileService, formats: readonly ExportFormat[] = EXPORT_FORMATS): ExportTableService {
    const allowed = formats.slice();
    return async (table: ExportTable, format: ExportFormat): Promise<boolean> => {
        try {
            if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return false;
            if (allowed.indexOf(format) < 0) return false;
            const file = buildExportFile(table, format);
            const res = await save(file);
            return res !== false;
        } catch {
            return false;
        }
    };
}

/**
 * A file service for a page in a browser: the file downloads through a link the page never shows. For a React or
 * Blazor page, a Fabric App, or any page whose browser allows downloads; a sandboxed frame without the
 * "allow-downloads" permission silently drops it, so a host in one passes its own service (or none) instead.
 */
export function browserSaveFile(doc?: Document): SaveFileService {
    return (file: ExportFile): boolean => {
        const d = doc ?? (typeof document !== "undefined" ? document : undefined);
        const view = d?.defaultView as (Window & typeof globalThis) | null | undefined;
        const U = view?.URL ?? (typeof URL !== "undefined" ? URL : undefined);
        const B = view?.Blob ?? (typeof Blob !== "undefined" ? Blob : undefined);
        if (!d || !d.body || !U || typeof U.createObjectURL !== "function" || !B) return false;
        // a copy, so the Blob owns an ArrayBuffer of exactly the file's length
        const blob = new B([file.bytes.slice()], { type: file.mime });
        const href = U.createObjectURL(blob);
        const a = d.createElement("a");
        a.href = href;
        a.download = file.name;
        a.rel = "noopener";
        a.style.display = "none";
        d.body.appendChild(a);
        try { a.click(); } finally {
            a.remove();
            // the download has its own reference by now; the address is released once the click has been handled
            setTimeout(() => { try { U.revokeObjectURL(href); } catch { /* gone */ } }, 30000);
        }
        return true;
    };
}
