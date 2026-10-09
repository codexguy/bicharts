import { describe, expect, it } from "vitest";
import { monthFirstLocale, readTextDateColumn } from "../src/textDate";
import { monthWordReadings, readMonthWords } from "../src/monthNames";
import { IndexedText, classifyTemporal, detectTextDatePattern } from "../src/indexedText";
import { ingest } from "../src/ingest";

// THE TEXT-DATE READER, ONE SHAPE AT A TIME. The twin tests prove a whole CSV profiles like its ISO
// twin; this table proves each shape on its own, and every REFUSAL: a reader that reads too much turns
// labels into dates, which is worse than reading too little.

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const stamp = (d: Date | null) => (d ? d.toISOString() : null);

/** The days a column reads as, or null when the column is not read. */
function read(values: string[], locale?: string): (string | null)[] | null {
    const col = readTextDateColumn(values, { locale });
    return col ? values.map(v => day(col.read(v))) : null;
}

describe("a year that comes first carries its own order", () => {
    const cases: Array<[string, string[], string[], string]> = [
        ["slashes", ["2024/03/15", "2024/3/5"], ["2024-03-15", "2024-03-05"], "%Y/%m/%d"],
        ["dots, zero-padded", ["2024.03.15", "2024.04.01"], ["2024-03-15", "2024-04-01"], "%Y.%m.%d"],
        ["dots with a closing dot", ["2024.3.15.", "2024.4.1."], ["2024-03-15", "2024-04-01"], "%Y.%m.%d."],
        ["dots and spaces and a closing dot", ["2024. 3. 15.", "2024. 12. 1."], ["2024-03-15", "2024-12-01"], "%Y. %m. %d."],
        ["hyphens that are not zero-padded", ["2024-3-15", "2024-4-1"], ["2024-03-15", "2024-04-01"], "%Y-%m-%d"],
        ["a time of day on every value", ["2024/03/15 10:30", "2024/03/16 18:05"], ["2024-03-15", "2024-03-16"], "%Y/%m/%d %H:%M"],
    ];
    for (const [label, values, expected, pattern] of cases) {
        it(`${label}: ${values[0]}`, () => {
            const col = readTextDateColumn(values)!;
            expect(col.order).toBe("ymd");
            expect(col.orderFrom).toBe("shape");
            expect(values.map(v => day(col.read(v)))).toEqual(expected);
            expect(col.pattern).toBe(pattern);
        });
    }

    it("is the same in every locale", () => {
        for (const locale of ["en-US", "de-DE", "ja-JP", undefined]) {
            expect(read(["2024/01/02", "2024/02/03"], locale)).toEqual(["2024-01-02", "2024-02-03"]);
        }
    });
});

describe("a/b/yyyy: the values decide, then the locale", () => {
    it("a first field over 12 is a day, whatever the locale says", () => {
        const col = readTextDateColumn(["15/03/2024", "02/04/2024", "28/02/2024"], { locale: "en-US" })!;
        expect(col.order).toBe("dmy");
        expect(col.orderFrom).toBe("values");
        expect(col.pattern).toBe("%d/%m/%Y");
    });

    it("a second field over 12 is a day, whatever the locale says", () => {
        const col = readTextDateColumn(["03/15/2024", "04/02/2024"], { locale: "es-ES" })!;
        expect(col.order).toBe("mdy");
        expect(col.orderFrom).toBe("values");
        expect(read(["03/15/2024", "04/02/2024"], "es-ES")).toEqual(["2024-03-15", "2024-04-02"]);
    });

    it("values that claim both orders are not one date column", () => {
        expect(readTextDateColumn(["15/03/2024", "03/15/2024"])).toBeNull();
    });

    it("when no value decides, the locale does: month first only for the United States family", () => {
        const ambiguous = ["01/02/2024", "03/04/2024", "05/06/2024"];
        const first = (locale?: string) => read(ambiguous, locale)![0];
        expect(first("en-US")).toBe("2024-01-02");
        expect(first("en")).toBe("2024-01-02");
        expect(first("en-GB")).toBe("2024-02-01");
        expect(first("de-DE")).toBe("2024-02-01");
        expect(first("es-MX")).toBe("2024-02-01");
        expect(first("fr")).toBe("2024-02-01");
        expect(first("ja-JP")).toBe("2024-02-01");
        // The reader's own default, with no locale at all, is day first (the engine passes `en`).
        expect(first(undefined)).toBe("2024-02-01");
        expect(readTextDateColumn(ambiguous, { locale: "de-DE" })!.orderFrom).toBe("locale");
    });

    it("the separator is kept in the pattern: dots and dashes are not rewritten to slashes", () => {
        expect(readTextDateColumn(["15.03.2024", "16.03.2024"])!.pattern).toBe("%d.%m.%Y");
        expect(readTextDateColumn(["15-03-2024", "16-03-2024"])!.pattern).toBe("%d-%m-%Y");
        expect(readTextDateColumn(["15. 3. 2024", "16. 3. 2024"])!.pattern).toBe("%d. %m. %Y");
        expect(readTextDateColumn(["15.03.2024.", "16.03.2024."])!.pattern).toBe("%d.%m.%Y.");
    });

    it("one-digit and two-digit fields mix", () => {
        expect(read(["5.1.2024", "15.01.2024"], "de-DE")).toEqual(["2024-01-05", "2024-01-15"]);
    });

    it("a leap day exists in a leap year only", () => {
        expect(read(["29.02.2024", "01.03.2024"])).toEqual(["2024-02-29", "2024-03-01"]);
        expect(read(["29.02.2023", "01.03.2023"])).toBeNull();
        expect(read(["29.02.2100", "01.03.2100"])).toBeNull();
        expect(read(["29.02.2000", "01.03.2000"])).toEqual(["2000-02-29", "2000-03-01"]);
    });

    it("reads in UTC: the instant does not depend on the machine's zone", () => {
        const col = readTextDateColumn(["15.03.2024", "16.03.2024"])!;
        expect(stamp(col.read("15.03.2024"))).toBe("2024-03-15T00:00:00.000Z");
    });
});

describe("a time of day", () => {
    it("24-hour times, with or without seconds, are a UTC wall clock", () => {
        const col = readTextDateColumn(["15.03.2024 10:30", "16.03.2024 11:45:12"])!;
        expect(col.hasTime).toBe(true);
        expect(stamp(col.read("15.03.2024 10:30"))).toBe("2024-03-15T10:30:00.000Z");
        expect(stamp(col.read("16.03.2024 11:45:12"))).toBe("2024-03-16T11:45:12.000Z");
    });

    it("the pattern names the clock only when every value carries it, and seconds only when all do", () => {
        expect(readTextDateColumn(["15.03.2024 10:30", "16.03.2024 11:45"])!.pattern).toBe("%d.%m.%Y %H:%M");
        expect(readTextDateColumn(["15.03.2024 10:30:00", "16.03.2024 11:45:12"])!.pattern).toBe("%d.%m.%Y %H:%M:%S");
        expect(readTextDateColumn(["15.03.2024 10:30:00", "16.03.2024 11:45"])!.pattern).toBe("%d.%m.%Y %H:%M");
        expect(readTextDateColumn(["15.03.2024 10:30", "16.03.2024"])!.pattern).toBeUndefined();
    });

    it("12-hour clocks: midnight and noon are the edges", () => {
        const values = ["3/15/2024 12:00 AM", "3/15/2024 12:30 PM", "3/15/2024 1:05 PM", "3/15/2024 11:59 pm"];
        const col = readTextDateColumn(values, { locale: "en-US" })!;
        expect(values.map(v => stamp(col.read(v)))).toEqual([
            "2024-03-15T00:00:00.000Z", "2024-03-15T12:30:00.000Z", "2024-03-15T13:05:00.000Z", "2024-03-15T23:59:00.000Z",
        ]);
        expect(col.pattern).toBeUndefined();
    });

    it("refuses a clock that does not exist", () => {
        expect(read(["15.03.2024 24:00", "16.03.2024 10:00"])).toBeNull();
        expect(read(["15.03.2024 10:60", "16.03.2024 10:00"])).toBeNull();
        expect(read(["3/15/2024 13:00 PM", "3/16/2024 1:00 PM"], "en-US")).toBeNull();
        expect(read(["3/15/2024 0:30 AM", "3/16/2024 1:00 PM"], "en-US")).toBeNull();
    });
});

describe("a month in words", () => {
    const march5 = "2024-03-05";
    // Hand-written, one language each. The three orders: day month year, month day year, year month day.
    const cases: Array<[string, string]> = [
        ["5 March 2024", "en"], ["March 5, 2024", "en"], ["Mar 5, 2024", "en"], ["5-Mar-2024", "en"], ["5 Mar 2024", "en"],
        ["March 5th, 2024", "en"], ["5th March 2024", "en"], ["Mar. 5, 2024", "en"], ["MARCH 5 2024", "en"], ["2024 Mar 5", "en"],
        ["5. März 2024", "de"], ["5 maart 2024", "nl"], ["5 mars 2024", "fr"], ["5 de marzo de 2024", "es"],
        ["5 de março de 2024", "pt"], ["5 marzo 2024", "it"], ["5 marca 2024", "pl"], ["5. března 2024", "cs"],
        ["5 mars 2024", "sv"], ["5. marts 2024", "da"], ["5. maaliskuuta 2024", "fi"], ["2024. március 5.", "hu"],
        ["5 Mart 2024", "tr"], ["5 martie 2024", "ro"], ["5. ožujka 2024.", "hr"], ["5 Maret 2024", "id"],
        ["5 марта 2024 г.", "ru"], ["5 березня 2024 р.", "uk"], ["5 Μαρτίου 2024", "el"], ["5 مارس 2024", "ar"],
        ["5 मार्च 2024", "hi"],
    ];
    for (const [text, lang] of cases) {
        it(`${lang}: ${text}`, () => {
            const col = readTextDateColumn([text])!;
            expect(col, "should read").not.toBeNull();
            expect(col.form).toBe("named");
            expect(day(col.read(text))).toBe(march5);
        });
    }

    it("the order is the order the words are written in, and needs no locale", () => {
        expect(readTextDateColumn(["5 March 2024"])!.order).toBe("dmy");
        expect(readTextDateColumn(["March 5, 2024"])!.order).toBe("mdy");
        expect(readTextDateColumn(["2024 March 5"])!.order).toBe("ymd");
        // A day-first locale does not turn `March 5` into the 3rd of May.
        expect(read(["March 5, 2024", "April 6, 2024"], "de-DE")).toEqual(["2024-03-05", "2024-04-06"]);
    });

    it("a whole column of one language's months, short and long", () => {
        const de = ["5. Januar 2024", "5. Februar 2024", "5. März 2024", "5. April 2024", "5. Mai 2024", "5. Juni 2024",
            "5. Juli 2024", "5. August 2024", "5. September 2024", "5. Oktober 2024", "5. November 2024", "5. Dezember 2024"];
        expect(read(de)!.map(d => d!.slice(5, 7))).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
        const frShort = ["5 janv. 2024", "5 févr. 2024", "5 mars 2024", "5 avr. 2024", "5 mai 2024", "5 juin 2024",
            "5 juil. 2024", "5 août 2024", "5 sept. 2024", "5 oct. 2024", "5 nov. 2024", "5 déc. 2024"];
        expect(read(frShort)!.map(d => d!.slice(5, 7))).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
    });

    it("accents and case are folded: a month exported without its accents is still that month", () => {
        expect(read(["5 FEVRIER 2024", "6 aout 2024"])).toEqual(["2024-02-05", "2024-08-06"]);
        expect(read(["5. Marz 2024", "6. Jänner 2024"])).toEqual(["2024-03-05", "2024-01-06"]);
    });

    it("English wins a collision, and a column is read in ONE language", () => {
        // `lip` is June in Croatian and July in Polish: a column that is only `lip` has two readings
        // and no locale to choose between them.
        expect(read(["5 lip 2024"])).toBeNull();
        expect(read(["5 lip 2024"], "pl-PL")).toEqual(["2024-07-05"]);
        expect(read(["5 lip 2024"], "hr-HR")).toEqual(["2024-06-05"]);
        // An English month beside another language's: the column reads in that language.
        expect(read(["5 Jan 2024", "5 März 2024"])).toEqual(["2024-01-05", "2024-03-05"]);
        // Words from two languages that share no table are not one column.
        expect(read(["5 März 2024", "5 marzo 2024", "5 maart 2024"])).toBeNull();
        expect(read(["5 März 2024", "5 janvier 2024"])).toBeNull();
    });

    it("an impossible day is not a date", () => {
        expect(read(["31 April 2024", "5 May 2024"])).toBeNull();
        expect(read(["30 February 2024"])).toBeNull();
        expect(read(["32 March 2024"])).toBeNull();
    });

    it("a word that is not a month, a two-digit year or a missing field is not a date", () => {
        expect(read(["5 Marchish 2024"])).toBeNull();
        expect(read(["5 March 24"])).toBeNull();
        expect(read(["March 2024"])).toBeNull();
        expect(read(["5 March"])).toBeNull();
        expect(read(["Friday 5 March 2024"])).toBeNull();
        expect(read(["5 Angry 1957", "12 Men 1957"])).toBeNull();
    });

    it("has no strptime pattern: a specifier cannot name another language's month", () => {
        expect(readTextDateColumn(["5 March 2024"])!.pattern).toBeUndefined();
    });
});

describe("every supported language's own long and short dates, from the runtime's calendar data", () => {
    // The check that the month table is complete and the reader is not tuned to the hand-written
    // cases above: ask the runtime to write 5 and 25 of every month in each language, read the whole
    // column back, with the language's locale and with none. Hebrew writes `in January` as one word
    // (read), Thai abbreviates with dots inside the word and Vietnamese writes `tháng 3` (neither is
    // read, and each is left as text rather than guessed at).
    const languages = ["en-US", "en-GB", "nl", "de", "fr", "es", "pt", "it", "pl", "cs", "sk", "sv", "da", "nb", "fi", "hu",
        "tr", "ro", "hr", "id", "ru", "uk", "el", "ar", "he", "hi"];
    for (const lang of languages) {
        for (const month of ["long", "short"] as const) {
            it(`${lang} ${month}`, () => {
                const f = new Intl.DateTimeFormat(`${lang}-u-ca-gregory-nu-latn`, { timeZone: "UTC", day: "numeric", month, year: "numeric" });
                const values: string[] = [], truth: string[] = [];
                for (let m = 0; m < 12; m++) {
                    for (const d of [5, 25]) {
                        values.push(f.format(new Date(Date.UTC(2024, m, d))));
                        truth.push(`2024-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
                    }
                }
                expect(read(values, lang), "with the locale").toEqual(truth);
                expect(read(values), "with none").toEqual(truth);
            });
        }
    }

    it("Thai and Vietnamese abbreviations and Vietnamese months are left as text", () => {
        expect(read(["5 ม.ค. 2024", "25 ม.ค. 2024"])).toBeNull();
        expect(read(["5 tháng 1, 2024", "25 tháng 1, 2024"])).toBeNull();
    });
});

describe("a Solar Hijri or Hijri year is not the same year of the Gregorian calendar", () => {
    // 1404 is 2025 and 1446 is 2024. A reader that took 1404 for the year 1404 would draw a date six
    // centuries early, flawlessly; the column is left as text instead.
    it("a column whose every year is 1300-1500 is left as text", () => {
        expect(read(["1404/01/15", "1404/02/20"])).toBeNull();
        expect(read(["15/01/1446", "20/02/1446"], "ar-SA")).toBeNull();
    });

    it("one year in the window beside an ordinary one is an ordinary column", () => {
        expect(read(["15/01/1404", "20/02/2024"], "en-GB")).toEqual(["1404-01-15", "2024-02-20"]);
    });
});

describe("the Buddhist calendar is not the year 2567", () => {
    it("a column whose every year is 2400-2699 is left as text", () => {
        expect(read(["15/03/2567", "16/03/2567"], "th-TH")).toBeNull();
        expect(read(["5 มีนาคม 2567", "6 มีนาคม 2567"])).toBeNull();
    });

    it("an ordinary far-future or sentinel date among real ones still reads", () => {
        expect(read(["15/03/2024", "31/12/9999"], "en-GB")).toEqual(["2024-03-15", "9999-12-31"]);
        expect(read(["15/03/2024", "16/03/2567"], "en-GB")).toEqual(["2024-03-15", "2567-03-16"]);
    });
});

describe("the CJK markers", () => {
    it("Japanese and Chinese: year, month, day", () => {
        const col = readTextDateColumn(["2024年3月5日", "2024年12月15日"])!;
        expect(col.form).toBe("cjk");
        expect(col.pattern).toBe("%Y年%m月%d日");
        expect(day(col.read("2024年12月15日"))).toBe("2024-12-15");
    });

    it("Korean, with its spaces", () => {
        const col = readTextDateColumn(["2024년 3월 5일", "2024년 12월 15일"])!;
        expect(col.pattern).toBe("%Y년 %m월 %d일");
        expect(day(col.read("2024년 3월 5일"))).toBe("2024-03-05");
    });

    it("needs all three markers: a year and a month is a period, not a day", () => {
        expect(read(["2024年3月", "2024年4月"])).toBeNull();
        expect(read(["2024년 3월", "2024년 4월"])).toBeNull();
    });

    it("an impossible day is refused", () => {
        expect(read(["2024年2月30日"])).toBeNull();
    });
});

describe("what the reader leaves alone", () => {
    it("ISO is the engine's own shape, so it is never claimed here", () => {
        expect(readTextDateColumn(["2024-03-15", "2024-03-16"])).toBeNull();
        expect(readTextDateColumn(["2024-03-15T10:30:00Z", "2024-03-16T10:30:00Z"])).toBeNull();
        expect(readTextDateColumn(["2024-03-15 10:30", "2024-03-16 10:30"])).toBeNull();
    });

    it("two-digit years", () => {
        expect(read(["12/05/24", "13/05/24"])).toBeNull();
        expect(read(["15.03.24", "16.03.24"])).toBeNull();
    });

    it("a column in two shapes", () => {
        expect(read(["15.03.2024", "2024.03.16"])).toBeNull();
        expect(read(["15.03.2024", "16/03/2024"])).toBeNull();
        expect(read(["15.03.2024", "16 March 2024"])).toBeNull();
        expect(read(["5 March 2024", "March 6, 2024"])).toBeNull();
    });

    it("one value that is not a date makes the column not dates, and the label is never read", () => {
        expect(read(["15.03.2024", "16.03.2024", "Total"])).toBeNull();
        expect(read(["15.03.2024", "16.03.2024", "31.02.2024"])).toBeNull();
        expect(read(["15.03.2024", "16.03.2024", "TBD"])).toBeNull();
    });

    it("typed values: a number or a Date makes the column not this reader's", () => {
        expect(readTextDateColumn(["15.03.2024", 45366 as any])).toBeNull();
        expect(readTextDateColumn(["15.03.2024", new Date() as any])).toBeNull();
    });

    it("blanks are skipped, and a column of blanks is nothing", () => {
        const col = readTextDateColumn(["15.03.2024", "", null, undefined, "  ", "16.03.2024"])!;
        expect(day(col.read("16.03.2024"))).toBe("2024-03-16");
        expect(col.read("")).toBeNull();
        expect(readTextDateColumn(["", null, undefined])).toBeNull();
        expect(readTextDateColumn([])).toBeNull();
    });

    it("numbers, codes, versions and a release number that looks like a date", () => {
        expect(read(["1234", "5678"])).toBeNull();
        expect(read(["12.5", "3.25"])).toBeNull();
        expect(read(["3.2.0", "3.3.0", "3.3.1"])).toBeNull();
        expect(read(["3.4.10", "3.4.11"])).toBeNull();
        expect(read(["2024.3.1", "2024.3.2", "2024.4.1"])).toBeNull();
        expect(read(["CNSOL-2024-001", "CNSOL-2024-002"])).toBeNull();
        expect(read(["Q1 2024", "Q2 2024"])).toBeNull();
        expect(read(["99/99/2024", "00/00/2024"])).toBeNull();
    });
});

describe("the whitespace a spreadsheet carries", () => {
    it("no-break and narrow no-break spaces read as spaces", () => {
        expect(read(["15\u00a0mars\u00a02024", "16 mars\u202f2024"])).toEqual(["2024-03-15", "2024-03-16"]);
        expect(read(["2024.\u00a03.\u00a015.", "2024. 3. 16."])).toEqual(["2024-03-15", "2024-03-16"]);
    });

    it("right-to-left marks inside a date are ignored", () => {
        expect(read(["15\u200f/3\u200f/2024", "16\u200f/3\u200f/2024"])).toEqual(["2024-03-15", "2024-03-16"]);
    });
});

describe("the month-word table", () => {
    it("English comes first and wins", () => {
        expect(monthWordReadings("march")[0]).toEqual({ lang: "en", month: 2 });
        expect(monthWordReadings("Sept")[0]).toEqual({ lang: "en", month: 8 });
    });

    it("names no two months in one language", () => {
        // A word that named two months in one language would make the one-language rule guess.
        for (const w of ["lip", "listopad", "lis", "srp", "mar", "may", "mai", "set", "out"]) {
            const byLang = new Map<string, Set<number>>();
            for (const r of monthWordReadings(w)) {
                if (!byLang.has(r.lang)) byLang.set(r.lang, new Set());
                byLang.get(r.lang)!.add(r.month);
            }
            for (const [lang, months] of byLang) expect(months.size, `${w} in ${lang}`).toBe(1);
        }
    });

    it("a month is a word, never a number", () => {
        expect(monthWordReadings("3")).toEqual([]);
        expect(monthWordReadings("")).toEqual([]);
        expect(readMonthWords(["3"])).toBeNull();
    });

    it("the genitive a language writes beside a day is a month word", () => {
        expect(monthWordReadings("марта").some(r => r.lang === "ru" && r.month === 2)).toBe(true);
        expect(monthWordReadings("marca").some(r => r.lang === "pl" && r.month === 2)).toBe(true);
        expect(monthWordReadings("Μαρτίου").some(r => r.lang === "el" && r.month === 2)).toBe(true);
    });
});

describe("monthFirstLocale", () => {
    it("is the United States family and nothing else", () => {
        for (const l of ["en-US", "en", "EN-us", "en-PH", "en-BZ"]) expect(monthFirstLocale(l), l).toBe(true);
        for (const l of ["en-GB", "en-AU", "en-IN", "de-DE", "es-ES", "fr", "pt-BR", "ja-JP", "", undefined]) expect(monthFirstLocale(l), String(l)).toBe(false);
    });
});

describe("a straggler floor, for the flag that has always tolerated a few labels", () => {
    it("a column is read when 80% of its values are dates in one shape", () => {
        const values = ["2024. 3. 15.", "2024. 3. 16.", "2024. 3. 17.", "2024. 3. 18.", "TBD"];
        expect(readTextDateColumn(values)).toBeNull();
        const col = readTextDateColumn(values, { floor: 0.8 })!;
        expect(col.pattern).toBe("%Y. %m. %d.");
        expect(readTextDateColumn(values.slice(0, 3).concat(["TBD", "TBD"]), { floor: 0.8 })).toBeNull();
    });

    it("a day that does not exist is one more straggler, and a typed value is one too", () => {
        const dates = ["15.03.2024", "16.03.2024", "17.03.2024", "18.03.2024"];
        expect(readTextDateColumn(dates.concat(["31.02.2024"]), { floor: 0.8 })).not.toBeNull();
        expect(readTextDateColumn(dates.concat([12 as any]), { floor: 0.8 })).not.toBeNull();
        expect(readTextDateColumn(dates.slice(0, 2).concat(["31.02.2024"]), { floor: 0.8 })).toBeNull();
    });

    it("the shape most values share wins; a second shape is a straggler, not a second reading", () => {
        const col = readTextDateColumn(["15.03.2024", "16.03.2024", "17.03.2024", "18.03.2024", "19.03.2024", "2024-03-20"], { floor: 0.8 })!;
        expect(col.pattern).toBe("%d.%m.%Y");
    });
});

describe("detectTextDatePattern knows the shapes the reader knows", () => {
    it("year first with spaces and a closing dot", () => {
        expect(detectTextDatePattern(["2024. 3. 15.", "2024. 3. 16.", "2024. 4. 1."])).toEqual({ pattern: "%Y. %m. %d.", orderFrom: "iso" });
    });

    it("the CJK markers, with a labelled row among them", () => {
        const values = ["2024年3月15日", "2024年3月16日", "2024年3月17日", "2024年3月18日", "2024年3月19日", "合計"];
        expect(detectTextDatePattern(values)).toEqual({ pattern: "%Y年%m月%d日", orderFrom: "iso" });
        expect(detectTextDatePattern(["2024년 3월 15일", "2024년 3월 16일"])).toEqual({ pattern: "%Y년 %m월 %d일", orderFrom: "iso" });
    });

    it("a hyphen date that is not zero-padded, and spaced or dot-closed day-first dates", () => {
        expect(detectTextDatePattern(["2024-3-5", "2024-3-6", "2024-4-7"])?.pattern).toBe("%Y-%m-%d");
        expect(detectTextDatePattern(["15. 3. 2024", "16. 3. 2024"], "de-DE")).toEqual({ pattern: "%d. %m. %Y", orderFrom: "values" });
        expect(detectTextDatePattern(["01. 02. 2024", "03. 04. 2024"], "en-US")).toEqual({ pattern: "%m. %d. %Y", orderFrom: "locale" });
        expect(detectTextDatePattern(["15.03.2024.", "16.03.2024."])?.pattern).toBe("%d.%m.%Y.");
    });

    it("a month in words has no specifier, so it is no pattern", () => {
        expect(detectTextDatePattern(["15 March 2024", "16 March 2024", "17 March 2024"])).toBeNull();
    });

    it("a column that mixes a legacy shape with a new one is still refused", () => {
        expect(detectTextDatePattern(["2024-03-15", "2024. 3. 16.", "2024-03-17", "2024. 3. 18."])).toBeNull();
        expect(detectTextDatePattern(["15/03/2024", "2024年3月16日", "17/03/2024", "2024年3月18日"])).toBeNull();
    });

    it("the legacy shapes keep their reading exactly (the reader is a fallback, never a rewrite)", () => {
        expect(detectTextDatePattern(["15/03/2024", "02/04/2024"], "en-US")).toEqual({ pattern: "%d/%m/%Y", orderFrom: "values" });
        expect(detectTextDatePattern(["01/02/2024", "03/04/2024"])).toEqual({ pattern: "%d/%m/%Y", orderFrom: "locale" });
        expect(detectTextDatePattern(["12/05/24", "13/05/24", "14/05/24"])).toBeNull();
    });

    it("a String column of such dates is a time axis that carries its pattern", () => {
        const values = ["2024. 3. 15.", "2024. 3. 16.", "2024. 3. 17."];
        expect(classifyTemporal({ dataType: "String", name: "Seen", isMeasure: false, distinctCount: 3, sampleValues: values })).toBe(true);
        const t = new IndexedText();
        t.setColumns([{ name: "Seen", dataType: "String", isMeasure: false }]);
        for (const v of values) t.addRow([v]);
        const col = t.getColumnsWithStats("20", "ko-KR")[0];
        expect(col.isTemporal).toBe(true);
        expect(col.temporalTextPattern).toBe("%Y. %m. %d.");
        expect(col.temporalCadence?.grain).toBe("day");
    });
});

describe("ingest reads a text-date column from the whole column", () => {
    const table = (values: string[], dataType: string | undefined, locale?: string) =>
        ingest({ kind: "table", columns: [{ name: "When", ...(dataType ? { dataType } : {}) }], rows: values.map(v => [v]) }, { dedup: false, ...(locale ? { locale } : {}) });

    it("a value past the type sample can still decide the order for every value", () => {
        // 600 rows whose first field is 12 or under, then one with a first field of 25: the column is
        // day first, and the first row is the 1st of February, not the 2nd of January.
        const values = Array.from({ length: 600 }, (_, i) => `0${(i % 9) + 1}/02/2024`).concat(["25/02/2024"]);
        const got = table(values, undefined);
        expect(got.columns[0].dataType).toBe("DateTime");
        expect(got.rows[0].When.toISOString().slice(0, 10)).toBe("2024-02-01");
        expect(got.rows[600].When.toISOString().slice(0, 10)).toBe("2024-02-25");
    });

    it("a caller-declared DateTime column that holds German text is read, not nulled or swapped", () => {
        const got = table(["15.03.2024", "05.01.2024", "31.12.2023"], "DateTime", "de-DE");
        expect(got.rows.map(r => r.When.toISOString().slice(0, 10))).toEqual(["2024-03-15", "2024-01-05", "2023-12-31"]);
    });

    it("a declared DateTime column of ISO text is exactly as it was", () => {
        const got = table(["2024-03-15", "2024-03-16T10:30:00Z"], "DateTime");
        expect(got.rows.map(r => r.When.toISOString())).toEqual(["2024-03-15T00:00:00.000Z", "2024-03-16T10:30:00.000Z"]);
    });

    it("a column of typed Dates, numbers and mixed text is not this reader's", () => {
        const d = new Date(Date.UTC(2024, 2, 15));
        const got = ingest({ kind: "table", columns: [{ name: "When" }], rows: [[d], ["15.03.2024"]] }, { dedup: false });
        expect(got.columns[0].dataType).not.toBe("DateTime");
    });

    it("a number column is untouched by the reader: nothing in it is a date", () => {
        const got = table(["1.234,5", "12,5", "3"], undefined, "de-DE");
        expect(got.columns[0].dataType).toBe("Decimal");
        expect(got.rows.map(r => r.When)).toEqual([1234.5, 12.5, 3]);
    });
});
