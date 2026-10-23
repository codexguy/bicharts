import { describe, it, expect, vi } from "vitest";
import { crc32 as zlibCrc32 } from "node:zlib";
import { JSDOM } from "jsdom";
import {
    tableToCsv, tableToXlsx, buildExportFile, exportFileName, sheetName, excelNumberFormat, excelSerial,
    bytesToBase64, exportFormatsFor, exportTableService, browserSaveFile, columnLetters, zipStored,
    EXPORT_FORMATS, XLSX_MIME, type ExportTable, type ExportFile,
} from "../src/exportTable";
import { resolveOptions } from "../src/defaults";

/*
    chart-host contract 1.19.0: a chart hands out the rows it shows as an ExportTable and chart-host writes the file - a
    CSV, or a real .xlsx from its own SpreadsheetML writer - for the host's saveFile. These tests read the bytes back
    with a ZIP reader written here (not the writer's own code) and an XML parser, so a part that would make a
    spreadsheet program refuse or repair the workbook fails here first.
*/

// ------------------------------------------------------------------ an independent reader of the workbook's ZIP ------

interface ZipEntry { name: string; method: number; crc: number; data: Uint8Array }

function readZip(bytes: Uint8Array): ZipEntry[] {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("no end of central directory");
    const count = dv.getUint16(eocd + 10, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    if (cdOffset + cdSize !== eocd) throw new Error("central directory does not end where the end record starts");
    const out: ZipEntry[] = [];
    let p = cdOffset;
    const dec = new TextDecoder("utf-8", { fatal: true });
    for (let k = 0; k < count; k++) {
        if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad central header at " + p);
        const method = dv.getUint16(p + 10, true);
        const crc = dv.getUint32(p + 16, true);
        const csize = dv.getUint32(p + 20, true);
        const usize = dv.getUint32(p + 24, true);
        const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
        const local = dv.getUint32(p + 42, true);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
        if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("bad local header for " + name);
        const lnlen = dv.getUint16(local + 26, true), lxlen = dv.getUint16(local + 28, true);
        const lname = dec.decode(bytes.subarray(local + 30, local + 30 + lnlen));
        if (lname !== name) throw new Error("local and central names differ: " + name);
        if (dv.getUint32(local + 14, true) !== crc) throw new Error("local and central CRC differ: " + name);
        const start = local + 30 + lnlen + lxlen;
        if (csize !== usize && method === 0) throw new Error("stored entry with different sizes: " + name);
        out.push({ name, method, crc, data: bytes.subarray(start, start + csize) });
        p += 46 + nlen + xlen + clen;
    }
    return out;
}

function parts(bytes: Uint8Array): Record<string, string> {
    const o: Record<string, string> = {};
    for (const e of readZip(bytes)) o[e.name] = new TextDecoder("utf-8", { fatal: true }).decode(e.data);
    return o;
}

const parser = new new JSDOM("").window.DOMParser();
function parseXml(name: string, xml: string): Document {
    const doc = parser.parseFromString(xml, "application/xml");
    const err = doc.getElementsByTagName("parsererror");
    if (err.length) throw new Error(name + " is not well-formed XML: " + err[0].textContent);
    return doc;
}

interface Cell { r: string; t: string | null; s: string | null; v: string | null; text: string | null }
function sheetCells(bytes: Uint8Array): Cell[] {
    const doc = parseXml("sheet1", parts(bytes)["xl/worksheets/sheet1.xml"]);
    return Array.from(doc.getElementsByTagName("c")).map(c => ({
        r: c.getAttribute("r")!,
        t: c.getAttribute("t"),
        s: c.getAttribute("s"),
        v: c.getElementsByTagName("v")[0]?.textContent ?? null,
        text: c.getElementsByTagName("t")[0]?.textContent ?? null,
    }));
}
const cellAt = (cells: Cell[], r: string) => cells.find(c => c.r === r);

function numFmtOfStyle(bytes: Uint8Array, s: string | null): string {
    const doc = parseXml("styles", parts(bytes)["xl/styles.xml"]);
    const xf = doc.getElementsByTagName("cellXfs")[0].getElementsByTagName("xf")[Number(s ?? 0)];
    const id = xf.getAttribute("numFmtId")!;
    const custom = Array.from(doc.getElementsByTagName("numFmt")).find(n => n.getAttribute("numFmtId") === id);
    return custom ? custom.getAttribute("formatCode")! : "builtin:" + id;
}

const SALES: ExportTable = {
    title: "Sales by region",
    columns: [
        { name: "Region", type: "text" },
        { name: "Revenue", type: "number", d3Format: "$,.2f" },
        { name: "Share", type: "number", d3Format: ".1%" },
        { name: "Day", type: "date" },
        { name: "Active", type: "boolean" },
    ],
    rows: [
        ["West", 1234567.891, 0.4567, "2024-03-05", true],
        ["East, North", -12.5, 0.1, new Date(Date.UTC(2024, 0, 31)), false],
        ["Say \"hi\"", null, undefined, "", null],
    ],
};

// ------------------------------------------------------------------ CSV ----------------------------------------------

describe("tableToCsv", () => {
    it("writes a header and one CRLF-ended line per row, after a UTF-8 byte-order mark", () => {
        const csv = tableToCsv(SALES);
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        const lines = csv.slice(1).split("\r\n");
        expect(lines).toEqual([
            "Region,Revenue,Share,Day,Active",
            "West,1234567.891,0.4567,2024-03-05,TRUE",
            "\"East, North\",-12.5,0.1,2024-01-31,FALSE",
            "\"Say \"\"hi\"\"\",,,,",
            "",
        ]);
        expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    });

    it("chooses the byte-order mark: the CSV a host saves starts EF BB BF, so Excel reads it as UTF-8", () => {
        const f = buildExportFile({ columns: [{ name: "Ville", type: "text" }], rows: [["Montr\u00E9al"], ["\u6771\u4EAC"], ["\uD83D\uDE00"]] }, "csv");
        expect(Array.from(f.bytes.subarray(0, 3))).toEqual([0xEF, 0xBB, 0xBF]);
        expect(f.mime).toBe("text/csv;charset=utf-8");
        expect(new TextDecoder().decode(f.bytes)).toBe("Ville\r\nMontr\u00E9al\r\n\u6771\u4EAC\r\n\uD83D\uDE00\r\n");
        expect(f.text).toBe(tableToCsv({ columns: [{ name: "Ville", type: "text" }], rows: [["Montr\u00E9al"], ["\u6771\u4EAC"], ["\uD83D\uDE00"]] }));
    });

    it("quotes a field with a comma, a quote, a line feed or a carriage return, and only those", () => {
        const t: ExportTable = { columns: [{ name: "a", type: "text" }], rows: [["x,y"], ["q\"q"], ["l1\nl2"], ["c1\rc2"], ["plain text; semi"], [" padded "]] };
        expect(tableToCsv(t).slice(1).split("\r\n").slice(1, -1)).toEqual([
            "\"x,y\"", "\"q\"\"q\"", "\"l1\nl2\"", "\"c1\rc2\"", "plain text; semi", " padded ",
        ]);
    });

    it("never lets text start a formula: = + - @ tab and CR get a leading apostrophe; numbers are left alone", () => {
        const t: ExportTable = {
            columns: [{ name: "=HEADER()", type: "text" }, { name: "n", type: "number" }],
            rows: [["=SUM(A1:A9)", -5], ["+1", 3], ["-x", 0], ["@cmd", 1], ["\tTab", 2], ["\rcr", 2], ["a=b", 1]],
        };
        const lines = tableToCsv(t).slice(1).split("\r\n");
        expect(lines[0]).toBe("'=HEADER(),n");
        expect(lines.slice(1, -1)).toEqual(["'=SUM(A1:A9),-5", "'+1,3", "'-x,0", "'@cmd,1", "'\tTab,2", "\"'\rcr\",2", "a=b,1"]);
    });

    it("writes numbers plainly (a point, no grouping), reads numeric text, and blanks what is not a number", () => {
        const t: ExportTable = { columns: [{ name: "n", type: "number", d3Format: ",.2f" }], rows: [[1234567.5], [" 42 "], ["1e3"], ["n/a"], [NaN], [Infinity], [true], [0], [-0.001]] };
        expect(tableToCsv(t).slice(1).split("\r\n").slice(1, -1)).toEqual(["1234567.5", "42", "1000", "", "", "", "", "0", "-0.001"]);
    });

    it("writes a date column as ISO days, with the time only when the column has one; an unreadable date stays its text", () => {
        const days: ExportTable = { columns: [{ name: "d", type: "date" }], rows: [["2024-02-29"], [Date.UTC(2023, 11, 25)], ["not a date"], [null]] };
        expect(tableToCsv(days).slice(1).split("\r\n").slice(1, -1)).toEqual(["2024-02-29", "2023-12-25", "not a date", ""]);
        const times: ExportTable = { columns: [{ name: "d", type: "date" }], rows: [["2024-02-29"], [new Date(Date.UTC(2024, 1, 29, 13, 5, 9))]] };
        expect(tableToCsv(times).slice(1).split("\r\n").slice(1, -1)).toEqual(["2024-02-29 00:00:00", "2024-02-29 13:05:09"]);
    });

    it("writes a yes/no column as TRUE / FALSE, reading yes/no/1/0, and keeps text it cannot read", () => {
        const t: ExportTable = { columns: [{ name: "b", type: "boolean" }], rows: [[true], [false], ["Yes"], ["0"], ["maybe"], [""]] };
        expect(tableToCsv(t).slice(1).split("\r\n").slice(1, -1)).toEqual(["TRUE", "FALSE", "TRUE", "FALSE", "maybe", ""]);
    });

    it("keeps very long text whole (a CSV has no cell limit)", () => {
        const long = "x".repeat(40000);
        const csv = tableToCsv({ columns: [{ name: "t", type: "text" }], rows: [[long]] });
        expect(csv.slice(1).split("\r\n")[1]).toBe(long);
    });

    it("writes only the header when there are no rows", () => {
        expect(tableToCsv({ columns: [{ name: "a", type: "text" }, { name: "b", type: "number" }], rows: [] })).toBe("\uFEFFa,b\r\n");
    });
});

// ------------------------------------------------------------------ XLSX ---------------------------------------------

describe("tableToXlsx - the package", () => {
    const bytes = tableToXlsx(SALES);

    it("is a ZIP of exactly the six SpreadsheetML parts, stored, each with a correct CRC", () => {
        const entries = readZip(bytes);
        expect(entries.map(e => e.name)).toEqual([
            "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml",
        ]);
        for (const e of entries) {
            expect(e.method, e.name).toBe(0);
            expect(e.crc, e.name).toBe(zlibCrc32(e.data) >>> 0);
        }
    });

    it("every part is well-formed XML, and every relationship points at a part that exists with a declared content type", () => {
        const p = parts(bytes);
        for (const [name, xml] of Object.entries(p)) parseXml(name, xml);
        const types = parseXml("ct", p["[Content_Types].xml"]);
        const overrides = Array.from(types.getElementsByTagName("Override")).map(o => o.getAttribute("PartName")!);
        expect(overrides.sort()).toEqual(["/xl/styles.xml", "/xl/workbook.xml", "/xl/worksheets/sheet1.xml"]);
        const defaults = Array.from(types.getElementsByTagName("Default")).map(d => d.getAttribute("Extension"));
        expect(defaults).toContain("rels");
        const rootTarget = parseXml("rels", p["_rels/.rels"]).getElementsByTagName("Relationship")[0].getAttribute("Target");
        expect(p[rootTarget!]).toBeDefined();
        const wbRels = Array.from(parseXml("wbrels", p["xl/_rels/workbook.xml.rels"]).getElementsByTagName("Relationship"));
        for (const r of wbRels) expect(p["xl/" + r.getAttribute("Target")], r.getAttribute("Target")!).toBeDefined();
        const sheet = parseXml("wb", p["xl/workbook.xml"]).getElementsByTagName("sheet")[0];
        expect(sheet.getAttribute("name")).toBe("Sales by region");
        expect(wbRels.find(r => r.getAttribute("Id") === sheet.getAttribute("r:id"))!.getAttribute("Target")).toBe("worksheets/sheet1.xml");
    });

    it("the worksheet's children come in the schema's order (Excel repairs a sheet whose elements are out of order)", () => {
        const doc = parseXml("sheet1", parts(bytes)["xl/worksheets/sheet1.xml"]);
        const order = Array.from(doc.documentElement.children).map(e => e.localName);
        expect(order).toEqual(["dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "autoFilter"]);
        expect(doc.getElementsByTagName("dimension")[0].getAttribute("ref")).toBe("A1:E4");
        expect(doc.getElementsByTagName("autoFilter")[0].getAttribute("ref")).toBe("A1:E4");
        expect(doc.getElementsByTagName("pane")[0].getAttribute("state")).toBe("frozen");
        const styles = parseXml("styles", parts(bytes)["xl/styles.xml"]);
        expect(Array.from(styles.documentElement.children).map(e => e.localName))
            .toEqual(["numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles"]);
        const xfs = styles.getElementsByTagName("cellXfs")[0];
        expect(Number(xfs.getAttribute("count"))).toBe(xfs.getElementsByTagName("xf").length);
    });

    it("the same table always gives the same bytes", () => {
        expect(Buffer.from(tableToXlsx(SALES)).equals(Buffer.from(bytes))).toBe(true);
    });
});

describe("tableToXlsx - the cells", () => {
    const bytes = tableToXlsx(SALES);
    const cells = sheetCells(bytes);

    it("the header is bold inline text", () => {
        expect(cellAt(cells, "A1")).toMatchObject({ t: "inlineStr", s: "1", text: "Region" });
        expect(cellAt(cells, "E1")!.text).toBe("Active");
    });

    it("a number stays a number, with the chart's format", () => {
        const b2 = cellAt(cells, "B2")!;
        expect(b2.t).toBeNull();
        expect(Number(b2.v)).toBe(1234567.891);
        expect(numFmtOfStyle(bytes, b2.s)).toBe("\"$\"#,##0.00");
        expect(numFmtOfStyle(bytes, cellAt(cells, "C2")!.s)).toBe("0.0%");
        expect(Number(cellAt(cells, "B3")!.v)).toBe(-12.5);
    });

    it("a date stays a date: Excel's day number with a date format", () => {
        const d2 = cellAt(cells, "D2")!;
        expect(Number(d2.v)).toBe(45356);              // 2024-03-05
        expect(numFmtOfStyle(bytes, d2.s)).toBe("builtin:14");
        expect(Number(cellAt(cells, "D3")!.v)).toBe(45322);   // 2024-01-31
    });

    it("a yes/no is a boolean cell, text is inline text, and a blank is no cell at all", () => {
        expect(cellAt(cells, "E2")).toMatchObject({ t: "b", v: "1" });
        expect(cellAt(cells, "E3")).toMatchObject({ t: "b", v: "0" });
        expect(cellAt(cells, "A4")).toMatchObject({ t: "inlineStr", text: "Say \"hi\"" });
        for (const r of ["B4", "C4", "D4", "E4"]) expect(cellAt(cells, r), r).toBeUndefined();
    });

    it("a date with a time of day gets a date-and-time format", () => {
        const b = tableToXlsx({ columns: [{ name: "at", type: "date" }], rows: [[new Date(Date.UTC(2024, 0, 1, 18, 0, 0))]] });
        const c = cellAt(sheetCells(b), "A2")!;
        expect(Number(c.v)).toBeCloseTo(45292.75, 10);
        expect(numFmtOfStyle(b, c.s)).toBe("builtin:22");
    });

    it("a day before 1900 is written as its ISO text, and 1900's first two months read back as themselves", () => {
        const b = tableToXlsx({ columns: [{ name: "d", type: "date" }], rows: [["1899-07-04"], ["1900-01-01"], ["1900-02-28"], ["1900-03-01"]] });
        const cs = sheetCells(b);
        expect(cellAt(cs, "A2")).toMatchObject({ t: "inlineStr", text: "1899-07-04" });
        expect([cellAt(cs, "A3")!.v, cellAt(cs, "A4")!.v, cellAt(cs, "A5")!.v]).toEqual(["1", "59", "61"]);
    });

    it("text that looks like a formula, a number or a date stays text in a text column", () => {
        const b = tableToXlsx({ columns: [{ name: "t", type: "text" }], rows: [["=1+1"], ["00123"], ["2024-01-01"]] });
        const cs = sheetCells(b);
        expect(cs.filter(c => c.r !== "A1").map(c => [c.t, c.text])).toEqual([["inlineStr", "=1+1"], ["inlineStr", "00123"], ["inlineStr", "2024-01-01"]]);
        expect(parts(b)["xl/worksheets/sheet1.xml"]).not.toContain("<f>");
    });

    it("very long text is cut to Excel's 32,767-character cell limit; XML-illegal characters are dropped and markup escaped", () => {
        const b = tableToXlsx({ columns: [{ name: "t", type: "text" }], rows: [["y".repeat(40000)], ["a\u0001b\u0008c<&>\"d\ud800e"]] });
        const cs = sheetCells(b);
        expect(cellAt(cs, "A2")!.text!.length).toBe(32767);
        expect(cellAt(cs, "A3")!.text).toBe("abc<&>\"de");
    });

    it("a value its column cannot read is written as the text it is, never dropped", () => {
        const b = tableToXlsx({ columns: [{ name: "n", type: "number" }, { name: "d", type: "date" }], rows: [["n/a", "soon"]] });
        const cs = sheetCells(b);
        expect(cellAt(cs, "A2")).toMatchObject({ t: "inlineStr", text: "n/a" });
        expect(cellAt(cs, "B2")).toMatchObject({ t: "inlineStr", text: "soon" });
    });

    it("columns past Z are lettered as Excel letters them", () => {
        expect([0, 25, 26, 51, 52, 701, 702, 16383].map(columnLetters)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA", "XFD"]);
    });

    it("a table with no columns is still a valid workbook", () => {
        const p = parts(tableToXlsx({ columns: [], rows: [] }));
        for (const [name, xml] of Object.entries(p)) parseXml(name, xml);
        expect(p["xl/worksheets/sheet1.xml"]).toContain('<dimension ref="A1:A1"/>');
        expect(p["xl/worksheets/sheet1.xml"]).not.toContain("autoFilter");
    });
});

describe("excelNumberFormat - the chart's format, as Excel says it", () => {
    const cases: Array<[string, { d3Format?: string; modelFormat?: string }, number[], string | null]> = [
        ["d3 grouped, 2 decimals", { d3Format: ",.2f" }, [1], "#,##0.00"],
        ["d3 currency, whole", { d3Format: "$,.0f" }, [1], "\"$\"#,##0"],
        ["d3 percent", { d3Format: ".0%" }, [0.5], "0%"],
        ["d3 trimmed decimals follow the data", { d3Format: ",.3~f" }, [1.5, 2.25], "#,##0.00"],
        ["d3 plain integer is General", { d3Format: "d" }, [3], null],
        ["d3 SI prefix has no Excel equivalent", { d3Format: ".3s" }, [1], null],
        ["d3 sign and parens", { d3Format: "(,.1f" }, [1], "#,##0.0;(#,##0.0);#,##0.0"],
        ["d3 scientific", { d3Format: ".2e" }, [1], "0.00E+00"],
        ["d3 wins over the model", { d3Format: ".1f", modelFormat: "0.000" }, [1], "0.0"],
        ["model currency with parens", { modelFormat: "\\$#,0.00;(\\$#,0.00);\\$#,0.00" }, [1], "\"$\"#,##0.00;(\"$\"#,##0.00);\"$\"#,##0.00"],
        ["model percent", { modelFormat: "0.00 %;-0.00 %;0.00 %" }, [0.1], "0.00%"],
        ["model euro after the digits", { modelFormat: "#,0.00 \u20AC" }, [1], "#,##0.00\"\u20AC\""],
        ["model bracketed locale symbol", { modelFormat: "[$\u20AC-x-euro2] #,##0" }, [1], "\"\u20AC\"#,##0"],
        ["a model date format is not a number format", { modelFormat: "dd/MM/yyyy" }, [1], null],
        ["model optional decimals follow the data", { modelFormat: "#,0.###" }, [1.5], "#,##0.0"],
    ];
    for (const [label, col, vals, want] of cases) it(label, () => expect(excelNumberFormat(col, vals)).toBe(want));
});

describe("dates and names", () => {
    it("excelSerial is Excel's day number", () => {
        expect(excelSerial(Date.UTC(1970, 0, 1))).toBe(25569);
        expect(excelSerial(Date.UTC(1900, 0, 1))).toBe(1);
        expect(excelSerial(Date.UTC(1900, 1, 28))).toBe(59);
        expect(excelSerial(Date.UTC(1900, 2, 1))).toBe(61);
        expect(excelSerial(Date.UTC(2024, 2, 5, 12))).toBe(45356.5);
    });

    it("a sheet name Excel accepts", () => {
        expect(sheetName("Sales: Q1/Q2 [draft]?")).toBe("Sales Q1 Q2 draft");
        expect(sheetName("x".repeat(40)).length).toBe(31);
        expect(sheetName("'quoted'")).toBe("quoted");
        expect(sheetName("")).toBe("Data");
        expect(sheetName("History")).toBe("Data");
    });

    it("a file name safe on every file system", () => {
        expect(exportFileName("Sales: Q1/Q2 <draft>", "xlsx")).toBe("Sales Q1 Q2 draft.xlsx");
        expect(exportFileName("trailing dots...", "csv")).toBe("trailing dots.csv");
        expect(exportFileName("CON", "csv")).toBe("table.csv");
        expect(exportFileName(null, "xlsx")).toBe("table.xlsx");
        expect(exportFileName("y".repeat(200), "csv").length).toBe(84);
    });

    it("base64 matches the platform's", () => {
        for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) {
            const b = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
            expect(bytesToBase64(b), String(n)).toBe(Buffer.from(b).toString("base64"));
        }
    });

    it("the ZIP writer handles a UTF-8 entry name", () => {
        const z = readZip(zipStored([["d\u00E9j\u00E0.txt", "x"]]));
        expect(z[0].name).toBe("d\u00E9j\u00E0.txt");
    });
});

// ------------------------------------------------------------------ the service ---------------------------------------

describe("exportTableService - what a chart calls", () => {
    it("builds the file and hands it to the host's saveFile, resolving true", async () => {
        const got: ExportFile[] = [];
        const ok = await exportTableService(f => { got.push(f); })(SALES, "xlsx");
        expect(ok).toBe(true);
        expect(got[0]).toMatchObject({ name: "Sales by region.xlsx", format: "xlsx", mime: XLSX_MIME });
        expect(readZip(got[0].bytes).length).toBe(6);
        await exportTableService(f => { got.push(f); })(SALES, "csv");
        expect(got[1].name).toBe("Sales by region.csv");
        // the table rides along, so a host that must rename the sheet can write the workbook again
        expect(got[0].table).toBe(SALES);
        expect(got[1].table).toBe(SALES);
    });

    it("resolves false, never rejects, when the host refuses, throws or rejects", async () => {
        expect(await exportTableService(() => false)(SALES, "csv")).toBe(false);
        expect(await exportTableService(() => { throw new Error("no"); })(SALES, "csv")).toBe(false);
        expect(await exportTableService(() => Promise.reject(new Error("no")))(SALES, "csv")).toBe(false);
        expect(await exportTableService(async () => false)(SALES, "csv")).toBe(false);
        expect(await exportTableService(async () => true)(SALES, "csv")).toBe(true);
    });

    it("refuses a format the host does not take, and a table that is not one, without calling the host", async () => {
        const save = vi.fn();
        const xlsxOnly = exportTableService(save, ["xlsx"]);
        expect(await xlsxOnly(SALES, "csv")).toBe(false);
        expect(await xlsxOnly(SALES, "pdf" as never)).toBe(false);
        expect(await xlsxOnly(null as never, "xlsx")).toBe(false);
        expect(await xlsxOnly({ columns: "a" } as never, "xlsx")).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(await xlsxOnly(SALES, "xlsx")).toBe(true);
    });

    it("exportFormatsFor keeps the host's list to the formats written here, best first", () => {
        expect(exportFormatsFor(undefined)).toEqual(["xlsx", "csv"]);
        expect(exportFormatsFor(["csv", "xlsx", "csv"])).toEqual(["xlsx", "csv"]);
        expect(exportFormatsFor(["xlsx"])).toEqual(["xlsx"]);
        expect(exportFormatsFor(["pdf"])).toEqual([]);
        expect(EXPORT_FORMATS).toEqual(["xlsx", "csv"]);
    });
});

describe("resolveOptions derives exportTable from the host's saveFile (1.19.0)", () => {
    it("a host with a file service gets exportTable and every format", async () => {
        const saved: string[] = [];
        const o = resolveOptions({ saveFile: (f: ExportFile) => { saved.push(f.name); } });
        expect(o.exportFormats).toEqual(["xlsx", "csv"]);
        expect(typeof o.exportTable).toBe("function");
        expect(await o.exportTable!(SALES, "csv")).toBe(true);
        expect(saved).toEqual(["Sales by region.csv"]);
    });

    it("the host can narrow the formats; a list with none left gives no export", async () => {
        const o = resolveOptions({ saveFile: () => true, exportFormats: ["xlsx"] });
        expect(o.exportFormats).toEqual(["xlsx"]);
        expect(await o.exportTable!(SALES, "csv")).toBe(false);
        const none = resolveOptions({ saveFile: () => true, exportFormats: ["pdf"] });
        expect(none.exportTable).toBeUndefined();
        expect(none.exportFormats).toBeUndefined();
        expect(none.saveFile).toBeUndefined();
    });

    it("no file service, or junk in its place, gives no export at all - and a host cannot pass exportTable itself", () => {
        for (const junk of [undefined, null, true, "download", {}, []]) {
            const o = resolveOptions({ saveFile: junk });
            expect(o.exportTable, String(junk)).toBeUndefined();
            expect(o.exportFormats, String(junk)).toBeUndefined();
        }
        expect(resolveOptions({ exportTable: async () => true, exportFormats: ["csv"] }).exportTable).toBeUndefined();
        expect(resolveOptions({ exportTable: async () => true }).exportFormats).toBeUndefined();
    });
});

describe("browserSaveFile - a page's file service", () => {
    it("downloads through a hidden link with the file's name and type, then removes the link", () => {
        const dom = new JSDOM("<!doctype html><body></body>");
        const win = dom.window as unknown as Window & typeof globalThis;
        const blobs: Blob[] = [];
        (win.URL as any).createObjectURL = (b: Blob) => { blobs.push(b); return "blob:x/1"; };
        (win.URL as any).revokeObjectURL = () => {};
        const clicks: Array<{ href: string; download: string }> = [];
        win.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicks.push({ href: this.href, download: this.download }); };
        vi.useFakeTimers();
        try {
            const ok = browserSaveFile(win.document)(buildExportFile(SALES, "xlsx"));
            expect(ok).toBe(true);
            expect(clicks).toEqual([{ href: "blob:x/1", download: "Sales by region.xlsx" }]);
            expect(blobs[0].type).toBe(XLSX_MIME);
            expect(win.document.querySelectorAll("a").length).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it("answers false where there is no document to download through", () => {
        const dom = new JSDOM("<!doctype html><body></body>");
        const doc = dom.window.document;
        doc.body.remove();
        expect(browserSaveFile(doc)(buildExportFile(SALES, "csv"))).toBe(false);
    });
});

// ------------------------------------------------------------------ size and time --------------------------------------

describe("a large table", () => {
    it("50,000 rows by 8 columns write as CSV and as .xlsx in under 3 seconds each", () => {
        const cols: ExportTable["columns"] = [
            { name: "Id", type: "number" }, { name: "Name", type: "text" }, { name: "Amount", type: "number", d3Format: "$,.2f" },
            { name: "Share", type: "number", d3Format: ".1%" }, { name: "Day", type: "date" }, { name: "Flag", type: "boolean" },
            { name: "Notes", type: "text" }, { name: "Qty", type: "number", d3Format: ",d" },
        ];
        const rows: ExportTable["rows"] = [];
        const base = Date.UTC(2020, 0, 1);
        for (let i = 0; i < 50000; i++)
            rows.push([i, "Customer " + i, i * 1.25, (i % 100) / 100, new Date(base + (i % 1500) * 86400000), i % 2 === 0, i % 7 ? "note, \"quoted\" " + i : null, i * 3]);
        const t: ExportTable = { title: "Big", columns: cols, rows };
        let t0 = performance.now();
        const csv = tableToCsv(t);
        const csvMs = performance.now() - t0;
        t0 = performance.now();
        const x = tableToXlsx(t);
        const xlsxMs = performance.now() - t0;
        expect(csv.split("\r\n").length).toBe(50002);
        const sheet = parts(x)["xl/worksheets/sheet1.xml"];
        expect(sheet).toContain('<dimension ref="A1:H50001"/>');
        expect((sheet.match(/<row /g) || []).length).toBe(50001);
        expect(csvMs, "csv ms").toBeLessThan(3000);
        expect(xlsxMs, "xlsx ms").toBeLessThan(3000);
    }, 20000);
});
