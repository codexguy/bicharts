import { describe, expect, it } from "vitest";
import { ingest, parseCsvRows } from "../src/ingest";
import { parseCsvRows as fromBarrel } from "../src/index";

/**
 * A ROW WHOSE VALUE IS BLANK IS A ROW.
 *
 * The CSV decoder parsed with Papa's `skipEmptyLines`, which drops any row that parses to a single
 * empty cell. In a one-column CSV that is not only an empty line but also a quoted blank value,
 * `""` - which is how a one-column CSV writes a blank (Python's csv writer quotes exactly that case).
 * So a lone comment column with a blank comment measured one row short of what a host reading the
 * same table through its own data API counts, and of what pandas counts reading the same file.
 *
 * The raw text of each row decides. A line with nothing on it at all - the trailing newline, a
 * blank line between rows - is not a row, as pandas reads it; a line holding `""` is.
 */

// Four rows, one of them a blank comment.
const COMMENTS = 'Comment\n"Great service"\n"Slow delivery"\n""\n"Friendly staff"\n';

describe("a one-column CSV's blank row counts", () => {
    it("ingest measures a quoted blank value as a row, and as a blank", () => {
        const r = ingest({ kind: "csv", text: COMMENTS });
        expect(r.totalRows).toBe(4);
        expect(r.columns[0].blankCount).toBe(1);
    });

    it("the same with CRLF line ends, a byte-order mark, a multi-line value and no final newline", () => {
        const text = '﻿Comment\r\n"line one\r\nline two"\r\n""\r\nlast';
        expect(parseCsvRows(text).rows).toEqual([["Comment"], ["line one\r\nline two"], [""], ["last"]]);
        expect(ingest({ kind: "csv", text }).totalRows).toBe(3);
    });

    it("parseCsvRows keeps the blank row and is the one the package exports", () => {
        expect(parseCsvRows(COMMENTS).rows)
            .toEqual([["Comment"], ["Great service"], ["Slow delivery"], [""], ["Friendly staff"]]);
        expect(fromBarrel).toBe(parseCsvRows);
    });
});

describe("what did not change", () => {
    it("a line with nothing on it is still not a row: the trailing newline, a blank line between rows", () => {
        expect(parseCsvRows("Comment\nA\n\nB\n\n").rows).toEqual([["Comment"], ["A"], ["B"]]);
        expect(ingest({ kind: "csv", text: "Comment\nA\n\nB\n\n" }).totalRows).toBe(2);
    });

    it("a multi-column blank row was always a row, and still is", () => {
        expect(ingest({ kind: "csv", text: "a,b\n1,2\n,\n3,4\n" }).totalRows).toBe(3);
    });

    it("the decoder's error texts are unchanged", () => {
        expect(() => ingest({ kind: "csv", text: "" })).toThrow(/^ingest: CSV parse failed - /);
        expect(() => ingest({ kind: "csv", text: "a,b\n" })).toThrow(/^ingest: CSV needs a header line plus at least one data row\.$/);
    });
});
