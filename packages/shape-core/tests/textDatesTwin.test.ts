import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

// A DATE WRITTEN IN WORDS OR IN ANOTHER COUNTRY'S ORDER IS THE SAME DATE.
//
// The close test for reading dates and numbers from text is a twin test: the same twelve rows
// written the way a German, a French, a Spanish, a Japanese or a Korean spreadsheet writes them
// must profile exactly like the ISO original, and the parsed values must be the true days.
//
// Two day sets, because they fail differently:
//   SET A - some day is over 12, so the values themselves say which field is the day;
//   SET B - every day is 12 or under, so only the reader's locale can say (a value never will).
// Set B is the dangerous one. `05.01.2024` is a valid date either way, so a reader that guesses
// does not fail, it silently moves the date.

const SET_A = [
    "2024-01-15", "2024-02-05", "2024-03-15", "2024-04-20", "2024-05-03", "2024-06-18",
    "2024-07-07", "2024-08-22", "2024-09-09", "2024-10-31", "2024-11-04", "2024-12-25",
];
const SET_B = [
    "2024-01-05", "2024-02-06", "2024-03-05", "2024-04-10", "2024-05-03", "2024-06-08",
    "2024-07-07", "2024-08-12", "2024-09-09", "2024-10-11", "2024-11-04", "2024-12-02",
];

const REGION = ["North", "South", "East", "West", "North", "South", "East", "West", "North", "South", "East", "West"];
const UNITS = [12, 45, 7, 88, 23, 56, 31, 9, 64, 18, 72, 40];
const RATE = [3.25, 12.5, 0.75, 8.1, 4.05, 6.6, 2.35, 9.9, 1.15, 7.45, 5.5, 10.2];
const AMOUNT = [12500.75, 1234.5, 999, 45000.1, 2345678.9, 780.25, 15200, 3300.5, 88000.75, 1250, 640.3, 9100.45];
const QTY = [1234, 12500, 987, 45000, 2300, 780, 15200, 3300, 88000, 1250, 640, 9100];

const MONTHS = {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    enShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
    es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

const p2 = (n: number) => String(n).padStart(2, "0");

/** A number the way a locale writes it: the group and decimal characters are all that differ. */
function num(n: number, group: string, decimal: string, frac: number): string {
    const [whole, fraction = ""] = n.toFixed(frac).split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    return frac > 0 ? grouped + decimal + fraction : grouped;
}

interface Twin {
    label: string;
    /** The locale a host would hand the reader for this CSV. */
    locale: string;
    group: string;
    decimal: string;
    date: (y: number, m: number, d: number) => string;
    /** True when the written order of the fields cannot be told from the values alone (a day over
     *  12 is the only thing that can tell it), so the no-locale reading is the one to pin. */
    numericOrder: boolean;
}

const TWINS: Twin[] = [
    { label: "en-US 03/15/2024", locale: "en-US", group: ",", decimal: ".", numericOrder: true, date: (y, m, d) => `${p2(m)}/${p2(d)}/${y}` },
    { label: "en-US 3/15/2024", locale: "en-US", group: ",", decimal: ".", numericOrder: true, date: (y, m, d) => `${m}/${d}/${y}` },
    { label: "en-GB 15/03/2024", locale: "en-GB", group: ",", decimal: ".", numericOrder: true, date: (y, m, d) => `${p2(d)}/${p2(m)}/${y}` },
    { label: "de 15.03.2024", locale: "de-DE", group: ".", decimal: ",", numericOrder: true, date: (y, m, d) => `${p2(d)}.${p2(m)}.${y}` },
    { label: "de 15.3.2024", locale: "de-DE", group: ".", decimal: ",", numericOrder: true, date: (y, m, d) => `${d}.${m}.${y}` },
    { label: "fr 15/03/2024", locale: "fr-FR", group: " ", decimal: ",", numericOrder: true, date: (y, m, d) => `${p2(d)}/${p2(m)}/${y}` },
    { label: "es 15/3/2024", locale: "es-ES", group: ".", decimal: ",", numericOrder: true, date: (y, m, d) => `${d}/${m}/${y}` },
    { label: "nl 15-03-2024", locale: "nl-NL", group: ".", decimal: ",", numericOrder: true, date: (y, m, d) => `${p2(d)}-${p2(m)}-${y}` },
    { label: "ru 15.03.2024", locale: "ru-RU", group: " ", decimal: ",", numericOrder: true, date: (y, m, d) => `${p2(d)}.${p2(m)}.${y}` },
    { label: "ja 2024/03/15", locale: "ja-JP", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${y}/${p2(m)}/${p2(d)}` },
    { label: "ja 2024/3/15", locale: "ja-JP", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${y}/${m}/${d}` },
    { label: "ja 2024年3月15日", locale: "ja-JP", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${y}年${m}月${d}日` },
    { label: "ko 2024. 3. 15.", locale: "ko-KR", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${y}. ${m}. ${d}.` },
    { label: "ko 2024년 3월 15일", locale: "ko-KR", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${y}년 ${m}월 ${d}일` },
    { label: "en 15-Mar-2024", locale: "en-US", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${d}-${MONTHS.enShort[m - 1]}-${y}` },
    { label: "en 15 March 2024", locale: "en-GB", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${d} ${MONTHS.en[m - 1]} ${y}` },
    { label: "en March 15, 2024", locale: "en-US", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${MONTHS.en[m - 1]} ${d}, ${y}` },
    { label: "en Mar 15, 2024", locale: "en-US", group: ",", decimal: ".", numericOrder: false, date: (y, m, d) => `${MONTHS.enShort[m - 1]} ${d}, ${y}` },
    { label: "de 15. März 2024", locale: "de-DE", group: ".", decimal: ",", numericOrder: false, date: (y, m, d) => `${d}. ${MONTHS.de[m - 1]} ${y}` },
    { label: "fr 15 mars 2024", locale: "fr-FR", group: " ", decimal: ",", numericOrder: false, date: (y, m, d) => `${d} ${MONTHS.fr[m - 1]} ${y}` },
    { label: "es 15 de marzo de 2024", locale: "es-ES", group: ".", decimal: ",", numericOrder: false, date: (y, m, d) => `${d} de ${MONTHS.es[m - 1]} de ${y}` },
];

const ISO: Twin = {
    label: "ISO 2024-03-15", locale: "en-US", group: ",", decimal: ".", numericOrder: false,
    date: (y, m, d) => `${y}-${p2(m)}-${p2(d)}`,
};

function csvOf(tw: Twin, days: string[]): string {
    const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ["Date,Region,Units,Rate,Amount"];
    days.forEach((iso, i) => {
        const [y, m, d] = iso.split("-").map(Number);
        lines.push([
            tw.date(y, m, d), REGION[i], String(UNITS[i]),
            num(RATE[i], tw.group, tw.decimal, 2), num(AMOUNT[i], tw.group, tw.decimal, 2),
        ].map(cell).join(","));
    });
    return lines.join("\n");
}

const run = (tw: Twin, days: string[], locale?: string) =>
    ingest({ kind: "csv", text: csvOf(tw, days) }, { dedup: false, privacyLevel: "20", ...(locale ? { locale } : {}) });

const dayOf = (v: unknown): string | null =>
    v instanceof Date && !isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : null;

const SETS: Array<[string, string[]]> = [["set A (a day over 12)", SET_A], ["set B (every day 12 or under)", SET_B]];

describe("a CSV written in another country's style profiles like its ISO twin (locale passed)", () => {
    for (const [setName, days] of SETS) {
        const reference = run(ISO, days, "en-US");
        for (const tw of TWINS) {
            it(`${tw.label} - ${setName}: same profile, true days`, () => {
                const got = run(tw, days, tw.locale);
                expect(got.columns.find(c => c.name === "Date")!.dataType).toBe("DateTime");
                expect(got.rows.map(r => dayOf(r.Date))).toEqual(days);
                // The WHOLE shape, not a field: a column that differs anywhere reaches the server
                // differently from its twin.
                expect(got.columns).toEqual(reference.columns);
                expect(got.rows).toEqual(reference.rows);
            });
        }
    }
});

describe("with no locale, a column whose values settle the reading still profiles like its twin", () => {
    // Set A has a day over 12, so the order is in the data. The shapes that carry no day/month
    // order at all (year first, a month in words, the CJK markers) need no locale in either set.
    const reference = run(ISO, SET_A);
    for (const tw of TWINS) {
        it(`${tw.label} - set A, no locale`, () => {
            const got = run(tw, SET_A);
            expect(got.columns.find(c => c.name === "Date")!.dataType).toBe("DateTime");
            expect(got.rows.map(r => dayOf(r.Date))).toEqual(SET_A);
            expect(got.columns).toEqual(reference.columns);
        });
    }
    const referenceB = run(ISO, SET_B);
    for (const tw of TWINS.filter(t => !t.numericOrder)) {
        it(`${tw.label} - set B, no locale (the shape carries its own order)`, () => {
            const got = run(tw, SET_B);
            expect(got.rows.map(r => dayOf(r.Date))).toEqual(SET_B);
            expect(got.columns).toEqual(referenceB.columns);
        });
    }
});

describe("an all-ambiguous numeric column and no locale", () => {
    // PINNED, and green before the reader: when no value is over 12 and the host named no locale,
    // the reading is month first, which is what the default locale (en) has always meant. A host
    // that knows its reader's locale passes it, and the table above shows that reading true.
    it("reads month first", () => {
        const got = run(TWINS.find(t => t.label === "de 15.03.2024")!, SET_B);
        expect(got.rows[0].Date.toISOString().slice(0, 10)).toBe("2024-05-01");
    });
});

describe("text numbers beside the dates", () => {
    const de = TWINS.find(t => t.label === "de 15.03.2024")!;
    const csv = (tw: Twin) => {
        const lines = ["Day,Qty"];
        SET_A.forEach((iso, i) => {
            const [y, m, d] = iso.split("-").map(Number);
            lines.push(`${tw.date(y, m, d)},${num(QTY[i], tw.group, tw.decimal, 0)}`);
        });
        return lines.join("\n");
    };

    it("a German thousands column reads as thousands when the locale is passed", () => {
        const got = ingest({ kind: "csv", text: csv(de) }, { dedup: false, locale: "de-DE" });
        expect(got.rows.map(r => r.Qty)).toEqual(QTY);
    });

    it("without a locale the dot rule holds (documented: a lone `12.500` is one reading or the other)", () => {
        // PINNED current behavior, green before and after. Every value here is `d.ddd` or a plain
        // integer, so no value proves the dot is a group mark; the column takes the dot as the
        // decimal point, as an English reader's would. Hosts that know the locale pass it.
        const got = ingest({ kind: "csv", text: csv(de) }, { dedup: false });
        expect(got.rows.map(r => r.Qty)).toEqual([1.234, 12.5, 987, 45, 2.3, 780, 15.2, 3.3, 88, 1.25, 640, 9.1]);
    });
});

describe("a time of day rides along", () => {
    const col = (cells: string[], locale?: string) => {
        const text = "When,V\n" + cells.map((c, i) => `"${c}",${i + 1}`).join("\n");
        return ingest({ kind: "csv", text }, { dedup: false, ...(locale ? { locale } : {}) });
    };

    it("24-hour times after a day-first date are read as a UTC wall clock", () => {
        const got = col(["15.03.2024 10:30", "16.03.2024 11:45:12", "17.03.2024 08:00"], "de-DE");
        expect(got.columns[0].dataType).toBe("DateTime");
        expect(got.rows.map(r => r.When.toISOString())).toEqual([
            "2024-03-15T10:30:00.000Z", "2024-03-16T11:45:12.000Z", "2024-03-17T08:00:00.000Z",
        ]);
        expect(got.columns[0].dateWithTime).toBe(true);
    });

    it("a 12-hour clock with AM / PM after a month-first date", () => {
        const got = col(["3/15/2024 10:30 AM", "3/16/2024 1:05 PM", "3/17/2024 12:00 AM"], "en-US");
        expect(got.columns[0].dataType).toBe("DateTime");
        expect(got.rows.map(r => r.When.toISOString())).toEqual([
            "2024-03-15T10:30:00.000Z", "2024-03-16T13:05:00.000Z", "2024-03-17T00:00:00.000Z",
        ]);
    });
});

describe("a column that is not entirely dates keeps the behavior it always had", () => {
    // GREEN BEFORE AND AFTER. A date reader that is more eager than the engine's old one must not
    // reach these: a labelled row is a label, never a deleted date.
    const colOf = (cells: string[], locale?: string) =>
        ingest({ kind: "csv", text: "When,V\n" + cells.map((c, i) => `"${c}",${i + 1}`).join("\n") }, { dedup: false, ...(locale ? { locale } : {}) });

    it("a labelled row among day-first dates stays text, and the label survives", () => {
        const got = colOf(["15.03.2024", "16.03.2024", "17.03.2024", "18.03.2024", "19.03.2024", "Total"], "de-DE");
        expect(got.columns[0].dataType).toBe("String");
        expect(got.columns[0].temporalTextPattern).toBe("%d.%m.%Y");
        expect(got.rows[5].When).toBe("Total");
    });

    it("two shapes in one column stay text", () => {
        expect(colOf(["15.03.2024", "2024-03-16", "17.03.2024", "2024-03-18"]).columns[0].dataType).toBe("String");
        expect(colOf(["15/03/2024", "16.03.2024", "17/03/2024", "18.03.2024"]).columns[0].dataType).toBe("String");
    });

    it("values that claim both orders stay text", () => {
        expect(colOf(["15/03/2024", "03/15/2024"]).columns[0].dataType).toBe("String");
    });

    it("plain words, codes and version strings stay text", () => {
        expect(colOf(["North", "South", "East"]).columns[0].dataType).toBe("String");
        expect(colOf(["CNSOL-2024-001", "CNSOL-2024-002"]).columns[0].dataType).toBe("String");
        expect(colOf(["3.2.0", "3.3.0", "3.3.1", "3.4.0"]).columns[0].dataType).toBe("String");
    });

    it("an impossible date makes the column text, never a null", () => {
        const got = colOf(["15.03.2024", "31.02.2024", "17.03.2024"], "de-DE");
        expect(got.columns[0].dataType).toBe("String");
        expect(got.rows.map(r => r.When)).toEqual(["15.03.2024", "31.02.2024", "17.03.2024"]);
    });
});
