import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";
import { foldNumerals, parseNumberText } from "../src/numberText";
import { readTextDateColumn } from "../src/textDate";

// A NUMBER WRITTEN IN ANOTHER SCRIPT'S DIGITS IS THE SAME NUMBER.
//
// An Arabic, Persian, Hindi or Thai spreadsheet writes its digits in its own script, and a Japanese
// one often in the full-width forms. The number reader's digit class was ASCII only, so every such
// column was text. Each case below is a column written both ways: it must profile field for field like
// its ASCII twin, with the same values.

/** Digits 0-9 written with a script's zero. */
const digits = (zero: number) => (text: string) => text.replace(/\d/g, d => String.fromCharCode(zero + +d));
const arabicIndic = digits(0x0660);
const persian = digits(0x06F0);
const devanagari = digits(0x0966);
const thai = digits(0x0E50);
const fullWidth = digits(0xFF10);

const ARABIC_DECIMAL = "\u066b";
const ARABIC_THOUSANDS = "\u066c";

function column(values: string[]) {
    return ingest({ kind: "csv", text: "V\n" + values.map(v => `"${v}"`).join("\n") }, { dedup: false });
}

const ASCII_DECIMALS = ["12.5", "3.25", "7.75", "8.5"];
const ASCII_INTEGERS = ["12", "345", "7", "89012"];
const ASCII_GROUPED = ["1,234.5", "12,500.75", "999.25", "45,000.1"];

describe("a column in another script's digits profiles like its ASCII twin", () => {
    const cases: Array<[string, (s: string) => string, string[]]> = [
        ["Arabic-Indic digits, dot decimal", arabicIndic, ASCII_DECIMALS],
        ["Arabic-Indic digits, integers", arabicIndic, ASCII_INTEGERS],
        ["Persian digits, dot decimal", persian, ASCII_DECIMALS],
        ["Devanagari digits, dot decimal", devanagari, ASCII_DECIMALS],
        ["Devanagari digits, integers", devanagari, ASCII_INTEGERS],
        ["Thai digits, dot decimal", thai, ASCII_DECIMALS],
        ["full-width digits, dot decimal", fullWidth, ASCII_DECIMALS],
        ["full-width digits, full-width marks", v => fullWidth(v).replace(/\./g, "\uff0e").replace(/,/g, "\uff0c"), ASCII_GROUPED],
        ["Arabic-Indic digits with the Arabic decimal and thousands marks",
            v => arabicIndic(v).replace(/\./g, ARABIC_DECIMAL).replace(/,/g, ARABIC_THOUSANDS), ASCII_GROUPED],
        ["Persian digits with the Arabic decimal mark", v => persian(v).replace(/\./g, ARABIC_DECIMAL), ASCII_DECIMALS],
    ];
    for (const [label, write, ascii] of cases) {
        it(label, () => {
            const native = ascii.map(write);
            const got = column(native);
            const twin = column(ascii);
            expect(native.some(v => /[^\x00-\x7f]/.test(v))).toBe(true);
            expect(got.columns).toEqual(twin.columns);
            expect(got.rows).toEqual(twin.rows);
        });
    }

    it("a negative number and a mixed column of both scripts' digits", () => {
        expect(column([arabicIndic("-12.5"), arabicIndic("3.25"), "7.75"]).rows.map(r => r.V)).toEqual([-12.5, 3.25, 7.75]);
        expect(column([arabicIndic("12"), "34", persian("56")]).columns[0].dataType).toBe("Integer");
    });

    it("comma-decimal text in another script's digits still takes the comma", () => {
        expect(column([arabicIndic("12,5"), arabicIndic("3,25"), arabicIndic("7,75")]).rows.map(r => r.V)).toEqual([12.5, 3.25, 7.75]);
    });
});

describe("what is not a number in any script stays text", () => {
    it("a digit beside a letter, a currency sign or an unknown mark", () => {
        expect(column([arabicIndic("12") + "ab", arabicIndic("34") + "cd"]).columns[0].dataType).toBe("String");
        expect(column(["١٢€", "٣٤€"]).columns[0].dataType).toBe("String");
        expect(column([arabicIndic("1") + "." + arabicIndic("2") + "." + arabicIndic("3x")]).columns[0].dataType).toBe("String");
    });

    it("ASCII text is returned as it came", () => {
        const s = "12,500.75 €";
        expect(foldNumerals(s)).toBe(s);
        expect(foldNumerals("")).toBe("");
        expect(parseNumberText("abc", ".")).toBeNull();
    });
});

describe("foldNumerals", () => {
    it("folds every supported script's zero to nine", () => {
        for (const zero of [0x0660, 0x06F0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0E50, 0x0ED0, 0x0F20, 0x1040, 0x17E0, 0xFF10]) {
            const written = Array.from({ length: 10 }, (_, d) => String.fromCharCode(zero + d)).join("");
            expect(foldNumerals(written), `U+${zero.toString(16)}`).toBe("0123456789");
        }
    });

    it("the Arabic and full-width marks are the dot and the comma", () => {
        expect(foldNumerals(`1${ARABIC_THOUSANDS}234${ARABIC_DECIMAL}5`)).toBe("1,234.5");
        expect(foldNumerals("1\uff0c234\uff0e5")).toBe("1,234.5");
    });
});

describe("dates in another script's digits", () => {
    const days = (values: string[], locale?: string) => {
        const col = readTextDateColumn(values, { locale });
        return col ? values.map(v => col.read(v)?.toISOString().slice(0, 10) ?? null) : null;
    };

    it("Arabic-Indic and full-width digits read as the same days", () => {
        expect(days([arabicIndic("15/03/2024"), arabicIndic("16/03/2024")], "ar")).toEqual(["2024-03-15", "2024-03-16"]);
        expect(days([arabicIndic("2024/03/15"), arabicIndic("2024/03/16")])).toEqual(["2024-03-15", "2024-03-16"]);
        expect(days([fullWidth("2024") + "\uff0e" + fullWidth("03") + "\uff0e" + fullWidth("15"), fullWidth("2024.03.16")])).toEqual(["2024-03-15", "2024-03-16"]);
        expect(days([arabicIndic("15") + " مارس " + arabicIndic("2024")])).toEqual(["2024-03-15"]);
    });

    it("an ingest of such a column is a DateTime column like its ASCII twin", () => {
        const native = ["15/03/2024", "16/03/2024", "17/03/2024"].map(arabicIndic);
        const got = ingest({ kind: "csv", text: "D\n" + native.join("\n") }, { dedup: false, locale: "ar" });
        const twin = ingest({ kind: "csv", text: "D\n15/03/2024\n16/03/2024\n17/03/2024" }, { dedup: false, locale: "ar" });
        expect(got.columns[0].dataType).toBe("DateTime");
        expect(got.columns).toEqual(twin.columns);
    });
});

describe("Persian digits do not make a Solar Hijri year a Gregorian one", () => {
    it("a column whose every year is 1300-1500 is left alone", () => {
        expect(readTextDateColumn([persian("1404/01/15"), persian("1404/02/20")])).toBeNull();
    });
});
