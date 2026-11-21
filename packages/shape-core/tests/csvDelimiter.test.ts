import { describe, expect, it } from "vitest";
import { ingest, parseCsvRows } from "../src/ingest";

/**
 * THE DELIMITER IS READ FROM THE LINES THAT HOLD DATA.
 *
 * The row-by-row parse keeps empty lines so the decoder can tell an empty line from a quoted blank value (see
 * csvBlankRow.test.ts). Left to guess the delimiter from those same lines, the parser counted a file's final newline
 * as a one-field row; in a two-column file that pulled the average field count under its bar, the guess failed and
 * fell back to the comma. A semicolon or tab file with a trailing newline - which is how most tools write one - then
 * read as ONE column, and a value like `1200,50` was cut at its comma.
 */
describe("a semicolon or tab CSV with a final newline keeps its columns", () => {
    it("semicolon", () => {
        const { rows } = parseCsvRows("Region;Sales\nNorth;1200,50\n");
        expect(rows[0]).toEqual(["Region", "Sales"]);
        expect(rows[1]).toEqual(["North", "1200,50"]);
    });

    it("tab", () => {
        const { rows } = parseCsvRows("Region\tSales\nNorth\t1200.5\n");
        expect(rows[0]).toEqual(["Region", "Sales"]);
        expect(rows[1]).toEqual(["North", "1200.5"]);
    });

    it("semicolon with CRLF line ends and a byte-order mark", () => {
        const { rows } = parseCsvRows("﻿Region;Sales\r\nNorth;1200,50\r\nSouth;980,25\r\n");
        expect(rows).toEqual([["Region", "Sales"], ["North", "1200,50"], ["South", "980,25"]]);
    });

    it("ingest measures the two columns, the decimal comma read as one", () => {
        const r = ingest({ kind: "csv", text: "Region;Sales\nNorth;1200,50\nSouth;980,25\nEast;1500,00\n" });
        expect(r.columns.map(c => `${c.name}:${c.dataType}`)).toEqual(["Region:String", "Sales:Decimal"]);
        expect(r.rows[0]).toEqual({ Region: "North", Sales: 1200.5 });
    });

    it("a comma CSV, and a one-column CSV with blank rows, read as they did", () => {
        expect(parseCsvRows("a,b\n1,2\n").rows).toEqual([["a", "b"], ["1", "2"]]);
        expect(parseCsvRows('Comment\n"x"\n""\n"y"\n').rows).toEqual([["Comment"], ["x"], [""], ["y"]]);
    });
});
