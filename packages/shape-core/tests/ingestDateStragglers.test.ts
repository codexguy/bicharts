import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

/**
 * A DATE COLUMN WITH A LABEL IN IT IS NOT A DATE COLUMN.
 *
 * `inferDataType` used to accept a column as DateTime when more than 90% of its non-blank
 * values parsed as dates, under a comment reading "Dates tolerate a few stragglers; numbers do
 * not". The asymmetry was backwards. A straggler in a numeric column is a value you decline to
 * coerce; a straggler in a DATE column is `Date.parse` returning NaN, and `convert` turns that
 * into **null** - so the one row that is not a date does not merely get misdescribed, it is
 * silently deleted from the data before anything downstream sees it.
 *
 * And these stragglers are not typos. They are the row that says `Total`, `Opening Balance`,
 * `YTD`, `All periods` - the labelled row a finance export puts at the top or the bottom of an
 * otherwise perfectly dated series. A column shaped like that is a labelled sequence, and the
 * whole reason the shape matters is that it decides whether the column is a CATEGORY or an
 * AXIS. Typed as a date it is neither: it is a date axis with a hole where the label was.
 *
 * MEASURED IN A REAL CORPUS: a cash-bridge export's `Period` column is twelve
 * `Mon YYYY` values plus the literal `Opening Balance` - 12/13 = 92.3%, comfortably over the
 * old bar. That one mistype erased the shape's only categorical column (so a waterfall's stage
 * counter honestly counted zero stages and refused the chart) and told the generated code to
 * parse the label with `new Date()`, which NaN'd the x-scale and erased every path in the
 * chart that was drawn instead.
 */
describe("date inference does not tolerate a non-date", () => {
    const rows = [
        "2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30",
        "2025-05-31", "2025-06-30", "2025-07-31", "2025-08-31",
        "2025-09-30", "2025-10-31", "2025-11-30", "2025-12-31",
    ];

    it("types a clean ISO column as DateTime", () => {
        const csv = "Period,Amount\n" + rows.map((d, i) => `${d},${i + 1}`).join("\n");
        const r = ingest({ kind: "csv", text: csv });
        expect(r.columns.find(c => c.name === "Period")!.dataType).toBe("DateTime");
    });

    it("does NOT type a column carrying a label row as DateTime", () => {
        // 12 dates + 1 label = 92.3% - over the old 90% bar, which is the bug.
        const csv = "Period,Amount\n"
            + rows.map((d, i) => `${d},${i + 1}`).join("\n")
            + "\nTotal,78";
        const r = ingest({ kind: "csv", text: csv });
        const period = r.columns.find(c => c.name === "Period")!;
        expect(period.dataType).toBe("String");
    });

    it("keeps the label row's value instead of nulling it", () => {
        // The half that loses DATA rather than merely describing it wrongly. Typed DateTime,
        // `convert` runs Date.parse('Total') -> NaN -> null, and the row silently loses its
        // only identifying value.
        const csv = "Period,Amount\n"
            + rows.map((d, i) => `${d},${i + 1}`).join("\n")
            + "\nOpening Balance,78";
        const r = ingest({ kind: "csv", text: csv });
        const last = r.rows[r.rows.length - 1] as Record<string, any>;
        expect(last.Period).toBe("Opening Balance");
    });

    it("still allows BLANKS - the rule is over non-blank values only", () => {
        // The over-refusal this fix must not cause: a sparse date column is still a date
        // column, and nothing in a run report would say if temporal coverage quietly vanished.
        const csv = "Period,Amount\n"
            + ["2025-01-31", "", "2025-03-31", "", "2025-05-31"]
                .map((d, i) => `${d},${i + 1}`).join("\n");
        const r = ingest({ kind: "csv", text: csv });
        expect(r.columns.find(c => c.name === "Period")!.dataType).toBe("DateTime");
    });

    it("still types slashed dates, and still refuses a version string", () => {
        const dates = "Period,V\n1/15/2024,1\n2/28/2024,2\n12/31/2023,3";
        expect(ingest({ kind: "csv", text: dates }).columns[0].dataType).toBe("DateTime");
        // A version string. Never a date here, and this fix must not make it one.
        const vers = "AppVersion,V\n3.2.0,1\n3.3.0,2\n3.3.1,3\n3.4.0,4";
        expect(ingest({ kind: "csv", text: vers }).columns[0].dataType).toBe("String");
    });
});
