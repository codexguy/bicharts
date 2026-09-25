// PERIOD CODES - how every language a model is written in labels a quarter, a half-year and a week
// (2026-09-25).
//
// WHY THIS EXISTS. English writes a quarter `Q1`, `Qtr 1` or `2024-Q1`, and every reader here knew only
// those. A French model writes `T1 2024` or `1er trimestre`, a Dutch one `K1 2024`, a German one
// `1. Quartal` and `KW 12`, a Japanese one `第1四半期` or `1Q`, a Korean one `1분기` - and a period column
// in any of them was not a time axis, its quarters had no order, and its pivot of quarterly measures was
// no series. Month and weekday names come from Intl for any language; these labels have no Intl source,
// so they are a typed table.
//
// THE TABLE. Per grain, per language, two lists of TEMPLATES:
//   - `words`: a label that names the period in words (`trimestre #`, `# quartal`, `第#四半期`). A word
//     label says what it is on its own, so a column of them is a period even without a year.
//   - `codes`: a letter code (`t #`, `k #`, `hj #`). `T1`, `K1`, `S1` and `1T` are also tiers, terminals,
//     products and sizes (a toddler's 2T-5T), so a code counts only BESIDE A YEAR (`T1 2024`), never bare.
// English is in the table too, first, so English labels can join another language's run; the readers
// that took English labels before keep their own English tests, and English wins every collision.
//
// TEMPLATE GRAMMAR, compared after the value's fold (below):
//   `#`   the member number, in digits (Arabic-Indic, Devanagari, Thai and full-width digits fold to ASCII)
//   `%`   the member number as a Roman numeral, I-IV
//   `@`   the member number as the language's ordinal word (`PERIOD_ORDINALS`)
//   ` `   a space: any run of spaces, `-`, `_`, `.` and `/`, or nothing (`T1`, `T 1`, `T-1`)
//   `.`   an optional dot (`trim. #`, `#. kwartał`)
//   `=N`  at the end: a fixed label for member N (`上半年=1`, the first half-year)
//   anything else is literal.
//
// HOW A VALUE IS READ (`readPeriodCode`). NFC, lower-cased, folded (never for Vietnamese, whose marks are
// meaning, nor for a template listed in `PERIOD_UNFOLDED`), `_` and runs of space read as one space, a
// trailing dot dropped. The label may carry a year before or after it (`2024 T1`, `T1/2024`, `2024年第1四半期`,
// `1T24`); a year and a number may touch only where a letter separates them, so `T12024` is no period. A
// reading reports its language, grain, member number, year and whether it was a word or a code; the number
// must lie within the grain (quarter 1-4, half 1-2, week 1-53).
//
// THE ONE-LANGUAGE RULE (`periodCodeSeries`). A column, or a run of pivot measures, is a period series only
// when EVERY label reads as one grain in ONE language, English labels joining any language's run - the rule
// the month words and the date levels already follow. `T1 2024` beside `K2 2024` is no series.
//
// WHAT IS LEFT OUT, AND WHY:
//   * nl `kw` (kwartaal): German writes `KW` for a calendar WEEK, and a Dutch quarter is written `K1` or `Q1`;
//   * `trim. #` as a WORD label: `Trim 2` is a car's trim level in English, so it is a code (a year beside it);
//   * da/nb `U7` for a week: `U7`, `U9`, `U11` are youth teams by age, season after season;
//   * the tertial and cuatrimestre (a third of a year): no grain reads them;
//   * vi half-years: written as phrases no template holds (`6 tháng đầu năm`);
//   * `sem`, `s` as a WEEK code beside `s` as a HALF-YEAR code in fr, es, pt: both are in, and a reader that
//     needs one grain asks for it - `S1 2024` reads as both, `S12 2024` only as a week.

import { foldName } from "../nameReader";
import { vocabularyLanguage, type VocabularyLanguageCode } from "../languages";

export type PeriodCodeGrain = "quarter" | "half" | "week";

/** The largest member number each grain has. */
export const PERIOD_CODE_MEMBERS: Readonly<Record<PeriodCodeGrain, number>> = Object.freeze({ quarter: 4, half: 2, week: 53 });

export interface PeriodCodeForms {
    readonly words?: readonly string[];
    readonly codes?: readonly string[];
}

type FormTable = Readonly<Partial<Record<VocabularyLanguageCode, PeriodCodeForms>>>;

/* parity:period-codes:begin */
export const PERIOD_CODE_FORMS: Readonly<Record<PeriodCodeGrain, FormTable>> = {
    quarter: {
        en: { words: ["quarter #", "qtr #"], codes: ["q #"] },
        nl: { words: ["kwartaal #", "# kwartaal", "#e kwartaal", "@ kwartaal"], codes: ["k #"] },
        de: { words: ["quartal #", "# quartal", "@ quartal"] },
        fr: { words: ["trimestre #", "# trimestre", "#er trimestre", "#e trimestre", "#eme trimestre", "@ trimestre"], codes: ["t #", "# t", "trim. #"] },
        es: { words: ["trimestre #", "# trimestre", "#er trimestre", "#o trimestre", "#º trimestre", "#° trimestre", "@ trimestre"], codes: ["t #", "# t", "trim. #"] },
        pt: { words: ["trimestre #", "# trimestre", "#o trimestre", "#º trimestre", "#° trimestre", "@ trimestre"], codes: ["t #", "# t", "#º t", "trim. #"] },
        it: { words: ["trimestre #", "# trimestre", "#º trimestre", "#° trimestre", "% trimestre", "@ trimestre"], codes: ["t #", "trim. #"] },
        pl: { words: ["kwartał #", "# kwartał", "% kwartał", "@ kwartał", "# kw.", "% kw."] },
        cs: { words: ["čtvrtletí #", "# čtvrtletí", "% čtvrtletí", "@ čtvrtletí"] },
        sk: { words: ["štvrťrok #", "# štvrťrok", "% štvrťrok", "@ štvrťrok"] },
        sv: { words: ["kvartal #", "# kvartalet", "#:a kvartalet", "#:e kvartalet", "@ kvartalet"], codes: ["k #"] },
        da: { words: ["kvartal #", "# kvartal", "@ kvartal"], codes: ["k #"] },
        nb: { words: ["kvartal #", "# kvartal", "@ kvartal"], codes: ["k #"] },
        fi: { words: ["neljännes #", "# neljännes", "# vuosineljännes", "vuosineljännes #"] },
        hu: { words: ["negyedév #", "# negyedév", "% negyedév"] },
        tr: { words: ["çeyrek #", "# çeyrek", "@ çeyrek"], codes: ["ç #"] },
        ro: { words: ["trimestrul #", "trimestrul %", "trimestru #"], codes: ["t #"] },
        hr: { words: ["tromjesečje #", "# tromjesečje", "% tromjesečje", "kvartal #", "# kvartal"] },
        id: { words: ["kuartal #", "kuartal %", "kuartal ke #", "triwulan #", "triwulan %", "triwulan ke #"], codes: ["tw #", "tw %"] },
        vi: { words: ["quý #", "quý %"] },
        ru: { words: ["квартал #", "# квартал", "% квартал", "@ квартал", "# кв.", "% кв."] },
        uk: { words: ["квартал #", "# квартал", "% квартал", "@ квартал", "# кв.", "% кв."] },
        el: { words: ["τρίμηνο #", "# τρίμηνο", "#ο τρίμηνο", "@ τρίμηνο"] },
        zh: { words: ["第#季度", "第@季度", "@季度", "#季度"] },
        ja: { words: ["第#四半期", "第@四半期", "#四半期"], codes: ["# q"] },
        ko: { words: ["#분기", "#/4분기"] },
        ar: { words: ["الربع #", "الربع @", "ربع #"] },
        he: { words: ["רבעון #", "רבעון @"] },
        hi: { words: ["तिमाही #", "# तिमाही", "@ तिमाही"] },
        th: { words: ["ไตรมาส #", "ไตรมาสที่ #"] },
    },
    half: {
        en: { words: ["half #"], codes: ["h #"] },
        nl: { words: ["halfjaar #", "# halfjaar", "@ halfjaar"] },
        de: { words: ["halbjahr #", "# halbjahr", "@ halbjahr"], codes: ["hj #"] },
        fr: { words: ["semestre #", "# semestre", "#er semestre", "#e semestre", "#eme semestre", "@ semestre"], codes: ["s #"] },
        es: { words: ["semestre #", "# semestre", "#er semestre", "#o semestre", "#º semestre", "#° semestre", "@ semestre"], codes: ["s #", "# s"] },
        pt: { words: ["semestre #", "# semestre", "#o semestre", "#º semestre", "#° semestre", "@ semestre"], codes: ["s #", "# s"] },
        it: { words: ["semestre #", "# semestre", "#º semestre", "#° semestre", "% semestre", "@ semestre"], codes: ["s #"] },
        pl: { words: ["półrocze #", "# półrocze", "% półrocze", "@ półrocze"] },
        cs: { words: ["pololetí #", "# pololetí", "% pololetí", "@ pololetí"] },
        sk: { words: ["polrok #", "# polrok", "% polrok"] },
        sv: { words: ["halvår #", "# halvåret", "@ halvåret"] },
        da: { words: ["halvår #", "# halvår", "@ halvår"] },
        nb: { words: ["halvår #", "# halvår", "@ halvår"] },
        fi: { words: ["vuosipuolisko #", "# vuosipuolisko"] },
        hu: { words: ["félév #", "# félév", "% félév"] },
        tr: { words: ["yarıyıl #", "# yarıyıl", "@ yarıyıl"] },
        ro: { words: ["semestrul #", "semestrul %"], codes: ["s #"] },
        hr: { words: ["polugodište #", "# polugodište", "% polugodište"] },
        id: { words: ["semester #", "semester %"] },
        ru: { words: ["полугодие #", "# полугодие", "% полугодие", "@ полугодие"] },
        uk: { words: ["півріччя #", "# півріччя", "% півріччя", "@ півріччя"] },
        el: { words: ["εξάμηνο #", "# εξάμηνο", "#ο εξάμηνο", "@ εξάμηνο"] },
        zh: { words: ["上半年=1", "下半年=2"] },
        ja: { words: ["上期=1", "下期=2", "上半期=1", "下半期=2"] },
        ko: { words: ["상반기=1", "하반기=2"] },
        ar: { words: ["النصف @"] },
        he: { words: ["חציון #"] },
        hi: { words: ["छमाही #", "@ छमाही"] },
        th: { words: ["ครึ่งปีแรก=1", "ครึ่งปีหลัง=2"] },
    },
    week: {
        en: { words: ["week #", "wk #"], codes: ["w #"] },
        de: { words: ["woche #", "# woche", "kw #"] },
        fr: { words: ["semaine #", "sem. #"], codes: ["s #"] },
        es: { words: ["semana #", "sem. #"], codes: ["s #"] },
        pt: { words: ["semana #", "sem. #"], codes: ["s #"] },
        it: { words: ["settimana #", "sett. #"] },
        pl: { words: ["tydzień #", "# tydzień", "tydz. #"] },
        cs: { words: ["týden #", "# týden"] },
        sk: { words: ["týždeň #", "# týždeň"] },
        sv: { words: ["vecka #"], codes: ["v #"] },
        da: { words: ["uge #"] },
        nb: { words: ["uke #"] },
        fi: { words: ["viikko #", "vko #", "vk #"] },
        hu: { words: ["hét #", "# hét"] },
        tr: { words: ["hafta #", "# hafta"] },
        ro: { words: ["săptămâna #"] },
        hr: { words: ["tjedan #", "# tjedan"] },
        id: { words: ["minggu #", "minggu ke #"] },
        vi: { words: ["tuần #"] },
        ru: { words: ["неделя #", "# неделя", "нед. #"] },
        uk: { words: ["тиждень #", "# тиждень", "тиж. #"] },
        el: { words: ["εβδομάδα #", "# εβδομάδα"] },
        zh: { words: ["第#周"] },
        ja: { words: ["第#週"] },
        ko: { words: ["#주", "#주차"] },
        ar: { words: ["الأسبوع #", "أسبوع #"] },
        he: { words: ["שבוע #"] },
        hi: { words: ["सप्ताह #"] },
        th: { words: ["สัปดาห์ #", "สัปดาห์ที่ #"] },
    },
};

/** Ordinal words for members 1-4, every form a label uses (gender, case, the article). */
export const PERIOD_ORDINALS: Readonly<Partial<Record<VocabularyLanguageCode, readonly (readonly string[])[]>>> = {
    nl: [["eerste"], ["tweede"], ["derde"], ["vierde"]],
    de: [["erstes", "erste"], ["zweites", "zweite"], ["drittes", "dritte"], ["viertes", "vierte"]],
    fr: [["premier"], ["deuxième", "second"], ["troisième"], ["quatrième"]],
    es: [["primer", "primero"], ["segundo"], ["tercer", "tercero"], ["cuarto"]],
    pt: [["primeiro"], ["segundo"], ["terceiro"], ["quarto"]],
    it: [["primo"], ["secondo"], ["terzo"], ["quarto"]],
    pl: [["pierwszy", "pierwsze"], ["drugi", "drugie"], ["trzeci", "trzecie"], ["czwarty", "czwarte"]],
    cs: [["první"], ["druhé", "druhý"], ["třetí"], ["čtvrté", "čtvrtý"]],
    sk: [["prvý"], ["druhý"], ["tretí"], ["štvrtý"]],
    sv: [["första"], ["andra"], ["tredje"], ["fjärde"]],
    da: [["første"], ["andet", "anden"], ["tredje"], ["fjerde"]],
    nb: [["første"], ["andre"], ["tredje"], ["fjerde"]],
    tr: [["birinci", "ilk"], ["ikinci"], ["üçüncü"], ["dördüncü"]],
    ru: [["первый", "первое"], ["второй", "второе"], ["третий", "третье"], ["четвертый", "четвертое"]],
    uk: [["перший", "перше"], ["другий", "друге"], ["третій", "третє"], ["четвертий", "четверте"]],
    el: [["πρώτο"], ["δεύτερο"], ["τρίτο"], ["τέταρτο"]],
    zh: [["一"], ["二"], ["三"], ["四"]],
    ja: [["一"], ["二"], ["三"], ["四"]],
    ar: [["الأول"], ["الثاني"], ["الثالث"], ["الرابع"]],
    he: [["ראשון"], ["שני"], ["שלישי"], ["רביעי"]],
    hi: [["पहली", "पहला"], ["दूसरी", "दूसरा"], ["तीसरी", "तीसरा"], ["चौथी", "चौथा"]],
};

/** Templates matched as written, never folded: the fold of `ç #` is `c #`, and `C1` is an English code
 *  (a grade, a cell, a language level). */
export const PERIOD_UNFOLDED: readonly string[] = ["ç #"];
/* parity:period-codes:end */

/** One way a label reads as a period. */
export interface PeriodCodeReading {
    lang: VocabularyLanguageCode;
    grain: PeriodCodeGrain;
    /** The member: 1-4 for a quarter, 1-2 for a half-year, 1-53 for a week. */
    n: number;
    /** The year beside the label, or null; a two-digit year reads as 2000 + it. */
    year: number | null;
    /** How many digits the year was written with: 0 (none), 2 or 4. */
    yearDigits: 0 | 2 | 4;
    /** A label in words, or a letter code (which counts only beside a year - see the header). */
    form: "word" | "code";
}

interface CompiledForm {
    lang: VocabularyLanguageCode;
    grain: PeriodCodeGrain;
    form: "word" | "code";
    unfold: boolean;
    re: RegExp;
    /** How the member number is read from the match: a digit group, a Roman group, an ordinal group
     *  (with its words, index = member - 1), or a fixed member. */
    number: { kind: "digits" } | { kind: "roman" } | { kind: "ordinal"; words: string[][] } | { kind: "fixed"; n: number };
}

const SEP = String.raw`[\s\-_./]*`;
const ROMAN: Readonly<Record<string, number>> = { i: 1, ii: 2, iii: 3, iv: 4 };

function prepare(s: string, unfold: boolean): string {
    let t = String(s ?? "").normalize("NFC").toLowerCase();
    if (!unfold) t = foldName(t);
    return t.replace(/[\s_]+/g, " ").trim().replace(/\.+$/, "").trim();
}

function escapeRe(ch: string): string {
    return /[.*+?^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch;
}

function compileForm(template: string, lang: VocabularyLanguageCode, grain: PeriodCodeGrain, form: "word" | "code"): CompiledForm {
    const l = vocabularyLanguage(lang);
    const unfold = !!l?.foldSensitive || PERIOD_UNFOLDED.includes(template);
    let body = template;
    let fixed: number | null = null;
    const eq = /=(\d+)$/.exec(body);
    if (eq) { fixed = Number(eq[1]); body = body.slice(0, eq.index); }
    const ordinals = (PERIOD_ORDINALS[lang] ?? []).map(forms => forms.map(f => prepare(f, unfold)));
    let number: CompiledForm["number"] = fixed !== null ? { kind: "fixed", n: fixed } : { kind: "digits" };
    let re = "";
    for (const ch of prepare(body, unfold)) {
        if (ch === "#") { re += "([0-9]{1,2})"; number = { kind: "digits" }; }
        else if (ch === "%") { re += "(iv|iii|ii|i)"; number = { kind: "roman" }; }
        else if (ch === "@") {
            const alts = ordinals.flat().sort((a, b) => b.length - a.length).map(w => [...w].map(escapeRe).join(""));
            re += "(" + alts.join("|") + ")";
            number = { kind: "ordinal", words: ordinals };
        }
        else if (ch === " ") re += SEP;
        else if (ch === ".") re += "\\.?";
        else re += escapeRe(ch);
    }
    return { lang, grain, form, unfold, re: new RegExp("^" + re + "$", "u"), number };
}

let compiled: CompiledForm[] | null = null;

/** Every template, compiled, in the table's order: grain, then language, then words before codes. */
function forms(): CompiledForm[] {
    if (compiled) return compiled;
    const out: CompiledForm[] = [];
    for (const grain of Object.keys(PERIOD_CODE_FORMS) as PeriodCodeGrain[]) {
        for (const [lang, set] of Object.entries(PERIOD_CODE_FORMS[grain]) as Array<[VocabularyLanguageCode, PeriodCodeForms]>) {
            for (const t of set.words ?? []) out.push(compileForm(t, lang, grain, "word"));
            for (const t of set.codes ?? []) out.push(compileForm(t, lang, grain, "code"));
        }
    }
    compiled = out;
    return out;
}

interface Split { body: string; year: number | null; yearDigits: 0 | 2 | 4 }

const DIGITS = /^[0-9]+$/;
const STARTS_WITH_DIGIT = /^[0-9]/;
const ENDS_WITH_DIGIT = /[0-9]$/;
const LEADING_SEPARATORS = /^[\s\-_./,']*/;
const TRAILING_SEPARATORS = /[\s\-_./,']*$/;
const YEAR_SUFFIX = /^(年|년)/u;

function yearOf(digits: string): number | null {
    if (digits.length === 4) {
        const y = Number(digits);
        return y >= 1900 && y <= 2099 ? y : null;
    }
    return 2000 + Number(digits);
}

/** The label as written, then with a four- or two-digit year taken off its front or its end. A year and
 *  the label's own digits may touch only where a letter (or 年 / 년) stands between them. */
function splits(t: string): Split[] {
    const out: Split[] = [{ body: t, year: null, yearDigits: 0 }];
    for (const width of [4, 2] as const) {
        if (t.length <= width) continue;
        const lead = t.slice(0, width);
        if (DIGITS.test(lead) && !STARTS_WITH_DIGIT.test(t.slice(width))) {
            const rest = t.slice(width);
            const suffix = YEAR_SUFFIX.exec(rest);
            const afterSuffix = suffix ? rest.slice(suffix[0].length) : rest;
            const sep = LEADING_SEPARATORS.exec(afterSuffix)![0];
            const body = afterSuffix.slice(sep.length);
            const y = yearOf(lead);
            if (body && y !== null && (suffix || sep || !STARTS_WITH_DIGIT.test(body))) out.push({ body, year: y, yearDigits: width });
        }
        const tail = t.slice(t.length - width);
        const before = t.slice(0, t.length - width);
        if (DIGITS.test(tail) && !ENDS_WITH_DIGIT.test(before)) {
            const sep = TRAILING_SEPARATORS.exec(before)![0];
            const body = before.slice(0, before.length - sep.length);
            const y = yearOf(tail);
            if (body && y !== null && (sep || !ENDS_WITH_DIGIT.test(body))) out.push({ body, year: y, yearDigits: width });
        }
    }
    return out;
}

/** Words that can make a label without a digit in it: ordinals, fixed half-year labels, Roman numerals. */
let anchors: string[] | null = null;
function digitlessAnchors(): string[] {
    if (anchors) return anchors;
    const set = new Set<string>();
    for (const [lang, ords] of Object.entries(PERIOD_ORDINALS) as Array<[VocabularyLanguageCode, readonly (readonly string[])[]]>) {
        const fs = !!vocabularyLanguage(lang)?.foldSensitive;
        for (const forms of ords) for (const w of forms) { set.add(prepare(w, false)); if (fs) set.add(prepare(w, true)); }
    }
    for (const grain of Object.keys(PERIOD_CODE_FORMS) as PeriodCodeGrain[]) {
        for (const set2 of Object.values(PERIOD_CODE_FORMS[grain])) {
            for (const t of set2?.words ?? []) {
                const eq = /=[0-9]+$/.exec(t);
                if (eq) set.add(prepare(t.slice(0, eq.index), false));
            }
        }
    }
    anchors = [...set];
    return anchors;
}
const HAS_DIGIT = /[0-9]/;
const ROMAN_WORD = /(^|[^\p{L}])(iv|iii|ii|i)([^\p{L}]|$)/u;

/** Cheap test before the templates: a label holds a digit, a Roman numeral, an ordinal or a fixed label. */
function couldBeLabel(t: string): boolean {
    if (HAS_DIGIT.test(t) || ROMAN_WORD.test(t)) return true;
    return digitlessAnchors().some(a => t.includes(a));
}

function memberOf(f: CompiledForm, m: RegExpExecArray): number | null {
    switch (f.number.kind) {
        case "fixed": return f.number.n;
        case "digits": return m[1] === undefined ? null : Number(m[1]);
        case "roman": return m[1] === undefined ? null : ROMAN[m[1]] ?? null;
        case "ordinal": {
            const w = m[1];
            const i = f.number.words.findIndex(forms => forms.includes(w));
            return i < 0 ? null : i + 1;
        }
    }
}

/**
 * Every way a label reads as a period: at most one reading per language and grain, in the table's order
 * (quarter, half-year, week; English first). Empty when the label is no period in any language.
 */
export function readPeriodCode(value: string | null | undefined): PeriodCodeReading[] {
    const raw = String(value ?? "");
    if (!raw.trim() || raw.length > 40) return [];
    const foldedText = prepare(raw, false);
    const unfoldedText = prepare(raw, true);
    if (!couldBeLabel(foldedText) && !couldBeLabel(unfoldedText)) return [];
    const folded = splits(foldedText);
    const unfolded = splits(unfoldedText);
    const out: PeriodCodeReading[] = [];
    const done = new Set<string>();
    for (const f of forms()) {
        const key = f.lang + "|" + f.grain;
        if (done.has(key)) continue;
        for (const s of f.unfold ? unfolded : folded) {
            const m = f.re.exec(s.body);
            if (!m) continue;
            const n = memberOf(f, m);
            if (n === null || n < 1 || n > PERIOD_CODE_MEMBERS[f.grain]) continue;
            out.push({ lang: f.lang, grain: f.grain, n, year: s.year, yearDigits: s.yearDigits, form: f.form });
            done.add(key);
            break;
        }
    }
    return out;
}

/** A column or a run of labels read as one grain in one language. `readings[i]` belongs to `values[i]`. */
export interface PeriodCodeSeries {
    lang: VocabularyLanguageCode;
    grain: PeriodCodeGrain;
    readings: PeriodCodeReading[];
}

/**
 * THE ONE-LANGUAGE RULE: the first grain, then the first language (English first), in which EVERY value
 * has a reading that `accept` takes, English readings joining any language's run. A run that only English
 * reads is English's. Null when no one language reads them all.
 */
export function periodCodeSeries(
    values: readonly string[],
    accept: (r: PeriodCodeReading) => boolean = () => true,
): PeriodCodeSeries | null {
    if (values.length === 0) return null;
    const all = values.map(v => readPeriodCode(v).filter(accept));
    if (all.some(r => r.length === 0)) return null;
    for (const grain of Object.keys(PERIOD_CODE_FORMS) as PeriodCodeGrain[]) {
        for (const lang of Object.keys(PERIOD_CODE_FORMS[grain]) as VocabularyLanguageCode[]) {
            const picked: PeriodCodeReading[] = [];
            let own = 0;
            for (const rs of all) {
                const mine = rs.find(r => r.grain === grain && r.lang === lang);
                const en = rs.find(r => r.grain === grain && r.lang === "en");
                const r = en ?? mine;
                if (!r) break;
                if (r.lang === lang) own++;
                picked.push(r);
            }
            if (picked.length === values.length && (lang === "en" || own > 0)) return { lang, grain, readings: picked };
        }
    }
    return null;
}
