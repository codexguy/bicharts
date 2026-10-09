import { describe, expect, it } from "vitest";
import { detectTextDatePattern } from "../src/indexedText";
import { measureCadence } from "../src/cadence";
import { readTextDateColumn } from "../src/textDate";
import { ingest } from "../src/ingest";

// A DOTTED DATE WITH THE YEAR LAST IS DAY FIRST, WHATEVER THE LOCALE.
//
// `05.03.2024` is the 5th of March in Germany, Russia, Poland, the Czech Republic, Finland, Turkey and
// most of the east of Europe, and no country that writes the month first writes its dates with dots. So
// when no value says which field is the day (every day is 12 or under), the separator already has: the
// locale a host names (or the default a caller that names none gets, `en`, month first) has nothing to
// add, and reading the column in it moves every date to the wrong month without a flaw.
//
// What must not move: the VALUES still decide first (a second field over 12 is a month, so a dotted
// column of `03.15.2024` is read month first); a slash or a dash date keeps its rule (values, then the
// locale, then month first for the caller that named none); a year first is read by its position.

const LOCALES: Array<string | undefined> = [undefined, "en", "en-US", "en-GB", "de-DE", "ru-RU", "pl-PL", "ja-JP"];
const label = (l: string | undefined) => l ?? "no locale";

/** Every day is 12 or under, so only the separator can say which field is the day. */
const DAYS = ["2024-03-05", "2024-03-06", "2024-04-07", "2024-11-10"];

const SHAPES: Array<{ name: string; cells: string[]; pattern: string }> = [
    { name: "05.03.2024", cells: ["05.03.2024", "06.03.2024", "07.04.2024", "10.11.2024"], pattern: "%d.%m.%Y" },
    { name: "5.3.2024", cells: ["5.3.2024", "6.3.2024", "7.4.2024", "10.11.2024"], pattern: "%d.%m.%Y" },
    { name: "5. 3. 2024", cells: ["5. 3. 2024", "6. 3. 2024", "7. 4. 2024", "10. 11. 2024"], pattern: "%d. %m. %Y" },
    { name: "05.03.2024.", cells: ["05.03.2024.", "06.03.2024.", "07.04.2024.", "10.11.2024."], pattern: "%d.%m.%Y." },
    { name: "05.03.2024 10:30", cells: ["05.03.2024 10:30", "06.03.2024 11:45", "07.04.2024 08:00", "10.11.2024 23:15"], pattern: "%d.%m.%Y %H:%M" },
    { name: "05.03.2024 10:30:15", cells: ["05.03.2024 10:30:15", "06.03.2024 11:45:00", "07.04.2024 08:00:59", "10.11.2024 23:15:01"], pattern: "%d.%m.%Y %H:%M:%S" },
];

describe("a dotted date with the year last, every day 12 or under, reads day first in every locale", () => {
    for (const shape of SHAPES) {
        for (const locale of LOCALES) {
            it(`${shape.name} - ${label(locale)}`, () => {
                const col = readTextDateColumn(shape.cells, { locale });
                expect(col, "the reader reads it").not.toBeNull();
                expect(col!.order).toBe("dmy");
                expect(col!.orderFrom).toBe("shape");
                expect(shape.cells.map(c => col!.read(c)!.toISOString().slice(0, 10))).toEqual(DAYS);
                expect(col!.pattern).toBe(shape.pattern);
                // The profiler's pattern is the same one the reader wrote, from the same rule.
                expect(detectTextDatePattern(shape.cells, locale)).toEqual({ pattern: shape.pattern, orderFrom: "shape" });
            });
        }
    }
});

describe("the values still decide first", () => {
    it("a second field over 12 is a month, dotted or not", () => {
        for (const locale of LOCALES) {
            const col = readTextDateColumn(["03.15.2024", "04.20.2024"], { locale });
            expect(col!.order, label(locale)).toBe("mdy");
            expect(col!.orderFrom).toBe("values");
            expect(col!.read("03.15.2024")!.toISOString().slice(0, 10)).toBe("2024-03-15");
            expect(detectTextDatePattern(["03.15.2024", "04.20.2024"], locale)).toEqual({ pattern: "%m.%d.%Y", orderFrom: "values" });
        }
    });

    it("a first field over 12 is a day", () => {
        for (const locale of LOCALES) {
            expect(detectTextDatePattern(["15.03.2024", "02.04.2024"], locale)).toEqual({ pattern: "%d.%m.%Y", orderFrom: "values" });
            expect(readTextDateColumn(["15.03.2024", "02.04.2024"], { locale })!.orderFrom).toBe("values");
        }
    });

    it("values that claim both orders are not one date column", () => {
        expect(readTextDateColumn(["15.03.2024", "03.15.2024"])).toBeNull();
        expect(detectTextDatePattern(["15.03.2024", "03.15.2024"])).toBeNull();
    });

    it("a dotted column and a slash column in one are still two shapes", () => {
        expect(readTextDateColumn(["05.03.2024", "06/03/2024", "07.04.2024", "08/04/2024"])).toBeNull();
        expect(detectTextDatePattern(["05.03.2024", "06/03/2024", "07.04.2024", "08/04/2024"])).toBeNull();
    });
});

describe("what keeps its rule: slash and dash dates, and a year first", () => {
    const slash = ["05/03/2024", "06/03/2024", "07/04/2024", "10/11/2024"];
    const dash = ["05-03-2024", "06-03-2024", "07-04-2024", "10-11-2024"];

    it("the reader: values, then the locale, then day first when nothing is named", () => {
        for (const cells of [slash, dash]) {
            expect(readTextDateColumn(cells)!.order).toBe("dmy");
            expect(readTextDateColumn(cells)!.orderFrom).toBe("locale");
            expect(readTextDateColumn(cells, { locale: "en-US" })!.order).toBe("mdy");
            expect(readTextDateColumn(cells, { locale: "en-US" })!.orderFrom).toBe("locale");
            expect(readTextDateColumn(cells, { locale: "en" })!.order).toBe("mdy");
            expect(readTextDateColumn(cells, { locale: "de-DE" })!.order).toBe("dmy");
            expect(readTextDateColumn(cells, { locale: "en-GB" })!.order).toBe("dmy");
        }
    });

    it("the profiler's pattern follows the same rule", () => {
        expect(detectTextDatePattern(slash)).toEqual({ pattern: "%d/%m/%Y", orderFrom: "locale" });
        expect(detectTextDatePattern(slash, "en-US")).toEqual({ pattern: "%m/%d/%Y", orderFrom: "locale" });
        expect(detectTextDatePattern(slash, "es-ES")).toEqual({ pattern: "%d/%m/%Y", orderFrom: "locale" });
        expect(detectTextDatePattern(dash, "en-US")).toEqual({ pattern: "%m-%d-%Y", orderFrom: "locale" });
        expect(detectTextDatePattern(dash, "nl-NL")).toEqual({ pattern: "%d-%m-%Y", orderFrom: "locale" });
    });

    it("a year first is read by its position, whatever its separator", () => {
        for (const locale of LOCALES) {
            expect(detectTextDatePattern(["2024.03.05", "2024.03.06", "2024.04.07"], locale)).toEqual({ pattern: "%Y.%m.%d", orderFrom: "iso" });
            expect(detectTextDatePattern(["2024/03/05", "2024/03/06", "2024/04/07"], locale)).toEqual({ pattern: "%Y/%m/%d", orderFrom: "iso" });
            expect(detectTextDatePattern(["2024. 3. 5.", "2024. 3. 6.", "2024. 4. 7."], locale)).toEqual({ pattern: "%Y. %m. %d.", orderFrom: "iso" });
        }
    });
});

// ── Through ingest ────────────────────────────────────────────────────────────────────────────

const dayOf = (v: unknown): string | null => (v instanceof Date && !isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : null);

const TWELVE = [
    "2024-01-05", "2024-02-06", "2024-03-05", "2024-04-10", "2024-05-03", "2024-06-08",
    "2024-07-07", "2024-08-12", "2024-09-09", "2024-10-11", "2024-11-04", "2024-12-02",
];
const REGION = ["North", "South", "East", "West", "North", "South", "East", "West", "North", "South", "East", "West"];

const csvWith = (date: (y: number, m: number, d: number) => string, extra: string[] = []) =>
    "Date,Region,Units\n" + [...TWELVE.map((iso, i) => {
        const [y, m, d] = iso.split("-").map(Number);
        return `${date(y, m, d)},${REGION[i]},${i + 1}`;
    }), ...extra].join("\n");

const p2 = (n: number) => String(n).padStart(2, "0");

describe("a dotted CSV profiles like its ISO twin with no locale and with en-US", () => {
    const iso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;
    const forms: Array<[string, (y: number, m: number, d: number) => string]> = [
        ["05.01.2024", (y, m, d) => `${p2(d)}.${p2(m)}.${y}`],
        ["5.1.2024", (y, m, d) => `${d}.${m}.${y}`],
        ["5. 1. 2024", (y, m, d) => `"${d}. ${m}. ${y}"`],
        ["05.01.2024.", (y, m, d) => `${p2(d)}.${p2(m)}.${y}.`],
    ];
    for (const [name, fmt] of forms) {
        for (const locale of LOCALES) {
            it(`${name} - ${label(locale)}: same columns, true days`, () => {
                const opts = { dedup: false, privacyLevel: "20", ...(locale ? { locale } : {}) } as const;
                const got = ingest({ kind: "csv", text: csvWith(fmt) }, opts);
                const reference = ingest({ kind: "csv", text: csvWith(iso) }, opts);
                expect(got.columns.find(c => c.name === "Date")!.dataType).toBe("DateTime");
                expect(got.rows.map(r => dayOf(r.Date))).toEqual(TWELVE);
                expect(got.columns).toEqual(reference.columns);
                expect(got.rows).toEqual(reference.rows);
            });
        }
    }

    it("a slash CSV with no locale is still month first (the default that has always been)", () => {
        const got = ingest({ kind: "csv", text: csvWith((y, m, d) => `${p2(d)}/${p2(m)}/${y}`) }, { dedup: false });
        expect(got.rows[0].Date.toISOString().slice(0, 10)).toBe("2024-05-01");
        const dash = ingest({ kind: "csv", text: csvWith((y, m, d) => `${p2(d)}-${p2(m)}-${y}`) }, { dedup: false });
        expect(dash.rows[0].Date.toISOString().slice(0, 10)).toBe("2024-05-01");
    });
});

describe("a dotted column that stays text still carries the day-first pattern and a cadence", () => {
    // A labelled row keeps the column text (a label is never deleted by being typed as a date), so the
    // profiler's pattern is what tells the generated code and the cadence reader how to read it.
    const fifth = Array.from({ length: 12 }, (_, m) => `05.${p2(m + 1)}.2024`);
    for (const locale of LOCALES) {
        it(`a monthly dotted column with a Total row - ${label(locale)}`, () => {
            const text = "Date,Units\n" + fifth.concat(["Total"]).map((c, i) => `${c},${i + 1}`).join("\n");
            const got = ingest({ kind: "csv", text }, { dedup: false, ...(locale ? { locale } : {}) });
            const date = got.columns.find(c => c.name === "Date")!;
            expect(date.dataType).toBe("String");
            expect(date.temporalTextPattern).toBe("%d.%m.%Y");
            expect(date.isTemporal).toBe(true);
            expect(date.temporalCadence?.grain).toBe("month");
            expect(date.temporalCadence?.points).toBe(12);
        });
    }

    it("the cadence reader, given the pattern, finds the twelve months", () => {
        const cadence = measureCadence(fifth, { pattern: "%d.%m.%Y" });
        expect(cadence?.grain).toBe("month");
        expect(cadence?.points).toBe(12);
    });
});
