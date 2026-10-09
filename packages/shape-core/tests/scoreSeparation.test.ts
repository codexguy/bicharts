import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { IndexedText } from "../src/indexedText";
import {
    measureScoreSeparation, SCORE_SEPARATION_MAX_ROWS, SCORE_SEPARATION_MAX_OUTCOMES,
    SCORE_SEPARATION_MAX_SCORES, type ScoreSeparationColumn,
} from "../src/scoreSeparation";
import { seriesKeyVerdict } from "../src/seriesCompleteness";
import type { LLMColumnWithValue } from "../src/models";

// SCORE SEPARATION (2026-10-09). Does a numeric column rank a yes/no outcome? Reported as the area under
// the ROC curve with the RARER outcome value as the positive class and a higher score as the positive
// direction - a fixed orientation, so no outcome value ever ships. Every expectation below is computed by
// an independent pairwise count (each rare case against each common case) written in this file, never
// read back off the pass under test.

const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue => ({ name, dataType, isMeasure });

/** The reference: the share of (rare, common) pairs the rare case wins, a draw counting half. */
function pairwiseAuc(positive: number[], negative: number[]): number {
    let wins = 0;
    for (const p of positive) for (const n of negative) wins += p > n ? 1 : p === n ? 0.5 : 0;
    return wins / (positive.length * negative.length);
}
const round4 = (x: number) => Math.round(x * 10000) / 10000;

function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// `dimensions` are the columns a host declares as group-by columns: inference never promotes them to measures.
function profile(cols: LLMColumnWithValue[], rows: any[][], level = "20", dimensions: string[] = []) {
    const it = new IndexedText();
    it.setColumns(cols);
    it.declareDimensions(cols.filter(c => dimensions.includes(c.name)));
    for (const r of rows) it.addRow(r);
    return { it, cols: it.getColumnsWithStats(level) };
}
const sepOf = (cols: LLMColumnWithValue[], name: string) => (cols.find(c => c.name === name) as any)?.scoreSeparation;

// A 600-row applicants table: a case id, a score where LOW means default (a 640-centred credit score),
// a ratio where HIGH means default, a score bound as a MEASURE and one bound as a dimension, and a
// yes/no outcome. 40 defaulters of 600 (6.7%).
function applicants() {
    const rand = rng(954);
    const rows: any[][] = [];
    const defaulted: boolean[] = [], credit: number[] = [], ratio: number[] = [];
    for (let i = 0; i < 600; i++) {
        const d = i % 15 === 0;
        const c = Math.round(d ? 600 + rand() * 120 : 560 + rand() * 260);
        const r = Math.round((d ? 0.25 + rand() * 0.5 : 0.1 + rand() * 0.5) * 1000) / 1000;
        defaulted.push(d); credit.push(c); ratio.push(r);
        rows.push(["A" + i, c, r, d ? "True" : "False"]);
    }
    return { rows, defaulted, credit, ratio };
}

describe("scoreSeparation - the statistic", () => {
    it("equals the pairwise AUC for a score bound as a DIMENSION and one bound as a MEASURE", () => {
        const { rows, defaulted, credit, ratio } = applicants();
        const { cols } = profile([col("ID", "String"), col("Credit", "Integer"), col("Ratio", "Decimal", true), col("Defaulted", "String")], rows, "20", ["Credit"]);
        const pick = (v: number[], flag: boolean) => v.filter((_, i) => defaulted[i] === flag);
        const wantCredit = round4(pairwiseAuc(pick(credit, true), pick(credit, false)));
        const wantRatio = round4(pairwiseAuc(pick(ratio, true), pick(ratio, false)));
        expect(wantCredit).toBeLessThan(0.5);      // the planted direction: low credit, more default
        expect(wantRatio).toBeGreaterThan(0.5);    // and high ratio, more default
        const credit0 = sepOf(cols, "Credit")![0], ratio0 = sepOf(cols, "Ratio")![0];
        expect(credit0.outcome).toBe("Defaulted");
        expect(credit0.aucMinorityHigh).toBe(wantCredit);
        expect(credit0.nMinority).toBe(40);
        expect(credit0.nMajority).toBe(560);
        expect(ratio0.aucMinorityHigh).toBe(wantRatio);
        expect(cols.find(c => c.name === "Credit")!.isMeasure, "the dimension stays a dimension").toBe(false);
    });

    it("a perfectly separating score reads 1, a perfectly reversed one 0, and a draw counts half", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 30; i++) rows.push(["r" + i, i < 6 ? 100 + i : i, i < 6 ? 50 - i : 90 + i, i < 6 ? 10 : 10, i < 6 ? "Yes" : "No"]);
        const { cols } = profile([col("ID", "String"), col("Up", "Integer"), col("Down", "Integer"), col("Flat", "Integer"), col("Churned", "String")], rows);
        expect(sepOf(cols, "Up")[0].aucMinorityHigh).toBe(1);
        expect(sepOf(cols, "Down")[0].aucMinorityHigh).toBe(0);
        expect(sepOf(cols, "Flat"), "one distinct value is no ranking").toBeUndefined();
    });

    it("ties are scored as half a win and counted, rows inside a block of equal scores", () => {
        // Ten deciles, 12 cases each, 10 of the 120 rows rare (one per decile, plus a second in decile 0).
        const rows: any[][] = [];
        let id = 0;
        for (let d = 1; d <= 10; d++) for (let k = 0; k < 12; k++) rows.push(["r" + id++, d, (k === 0 || (d === 1 && k === 1)) ? "Yes" : "No"]);
        const { cols } = profile([col("ID", "String"), col("Decile", "Integer"), col("Churned", "String")], rows);
        const yes = rows.filter(r => r[2] === "Yes").map(r => r[1] as number);
        const no = rows.filter(r => r[2] === "No").map(r => r[1] as number);
        const e = sepOf(cols, "Decile")[0];
        expect(e.aucMinorityHigh).toBe(round4(pairwiseAuc(yes, no)));
        expect(e.nMinority).toBe(11);
        expect(e.ties).toBe(120);   // every row shares its decile with eleven others
    });

    it("rows with a blank score or a blank outcome are left out of both counts", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 40; i++) rows.push(["r" + i, i + 1, i < 8 ? "Yes" : "No"]);
        rows.push(["b1", null, "Yes"], ["b2", 7, null], ["b3", "", "No"]);
        const { cols } = profile([col("ID", "String"), col("Score", "Integer"), col("Churned", "String")], rows);
        const e = sepOf(cols, "Score")[0];
        expect(e.nMinority).toBe(8);
        expect(e.nMajority).toBe(32);
        expect(e.aucMinorityHigh).toBe(0);   // the rare cases hold the LOWEST scores 1..8
    });

    it("when both values are equally common the alphabetically first one is the rare one", () => {
        const rows: any[][] = [];
        // "No" cases score 1..10, "Yes" cases 11..20: with No as the rare class a higher score does not point at it.
        for (let i = 0; i < 20; i++) rows.push(["r" + i, i + 1, i < 10 ? "No" : "Yes"]);
        const { cols } = profile([col("ID", "String"), col("Score", "Integer"), col("Churned", "String")], rows);
        const e = sepOf(cols, "Score")[0];
        expect(e.nMinority).toBe(10);
        expect(e.nMajority).toBe(10);
        expect(e.aucMinorityHigh).toBe(0);
        // The same table with the labels swapped answers the same way round: the first value is still "No".
        const swapped = rows.map(r => [r[0], r[1], r[2] === "No" ? "Yes" : "No"]);
        expect(sepOf(profile([col("ID", "String"), col("Score", "Integer"), col("Churned", "String")], swapped).cols, "Score")[0].aucMinorityHigh).toBe(1);
    });

    it("a 0/1 MEASURE is an outcome (a total of a flag at case grain), and the row order does not matter", () => {
        const rand = rng(7);
        const rows: any[][] = [];
        for (let i = 0; i < 200; i++) { const y = i % 10 === 0 ? 1 : 0; rows.push(["c" + i, Math.round((y ? 0.4 + rand() * 0.6 : rand() * 0.8) * 1000) / 1000, y]); }
        const colsIn = () => [col("CustomerID", "String"), col("Propensity", "Decimal"), col("Sum of Churned", "Integer", true)];
        const a = profile(colsIn(), rows).cols;
        const b = profile(colsIn(), [...rows].reverse()).cols;
        const yes = rows.filter(r => r[2] === 1).map(r => r[1] as number), no = rows.filter(r => r[2] === 0).map(r => r[1] as number);
        const e = sepOf(a, "Propensity")[0];
        expect(e.outcome).toBe("Sum of Churned");
        expect(e.aucMinorityHigh).toBe(round4(pairwiseAuc(yes, no)));
        expect(e.nMinority).toBe(20);
        expect(sepOf(b, "Propensity")).toEqual(sepOf(a, "Propensity"));
    });

    it("an outcome that is neither flagged nor named like one is still measured, after the flagged ones", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 60; i++) rows.push(["r" + i, i + 1, i % 6 === 0 ? "Fraud" : "Legit", i % 7 === 0 ? "True" : "False"]);
        const { cols } = profile([col("ID", "String"), col("Amount", "Integer"), col("Kind", "String"), col("IsRush", "String")], rows);
        const e = sepOf(cols, "Amount");
        expect(e.map((x: any) => x.outcome)).toEqual(["IsRush", "Kind"]);
    });

    it("the outcome column, a time column and an identifier are never scored", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 40; i++) rows.push([i + 1, 2000 + (i % 10), i * 3 + 1, i % 5 === 0 ? 1 : 0]);
        const { cols } = profile([col("Order ID", "Integer"), col("Year", "Integer"), col("Weight", "Integer"), col("Sum of Churned", "Integer", true)], rows);
        expect(sepOf(cols, "Order ID")).toBeUndefined();
        expect(sepOf(cols, "Year")).toBeUndefined();
        expect(sepOf(cols, "Sum of Churned")).toBeUndefined();
        expect(sepOf(cols, "Weight")).toBeDefined();
    });

    it("an outcome with one value left among the usable rows carries nothing", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 30; i++) rows.push(["r" + i, i + 1, i < 29 ? "No" : "Yes"]);
        for (let i = 0; i < 30; i++) rows[i][1] = i < 29 ? i + 1 : null;     // the lone "Yes" has no score
        const { cols } = profile([col("ID", "String"), col("Score", "Integer"), col("Churned", "String")], rows);
        expect(sepOf(cols, "Score")).toBeUndefined();
    });
});

describe("scoreSeparation - the caps and the ceiling", () => {
    const colMeta = (name: string, extra: Partial<ScoreSeparationColumn> = {}): ScoreSeparationColumn => ({
        name, dataType: "Integer", isMeasure: false, isTemporal: false, isDatePart: false, identifierNamed: false,
        isBinaryFlag: false, distinct: 50, twoValues: null, ...extra,
    });

    it("examines at most six outcomes, the flagged ones first, and at most twelve scores", () => {
        const outcomes = [...Array(7).keys()].map(i => colMeta("g" + i, { dataType: "String", distinct: 2, twoValues: ["a", "b"] }));
        const flagged = colMeta("Defaulted", { dataType: "String", distinct: 2, twoValues: ["a", "b"], isBinaryFlag: true });
        const scores = [...Array(14).keys()].map(i => colMeta("s" + i));
        const columns = [...outcomes, flagged, ...scores];
        const rows = [...Array(40).keys()].map(r => [...outcomes.map(() => r % 3 === 0 ? "a" : "b"), r % 4 === 0 ? "a" : "b", ...scores.map((_, k) => r * (k + 1))]);
        const res = measureScoreSeparation({ rows, columns, text: v => (v == null ? "" : String(v)) });
        expect(SCORE_SEPARATION_MAX_OUTCOMES).toBe(6);
        expect(SCORE_SEPARATION_MAX_SCORES).toBe(12);
        const firstScore = 8;
        expect(res.size).toBe(12);
        expect(res.has(firstScore + 11)).toBe(true);
        expect(res.has(firstScore + 12)).toBe(false);
        const entries = res.get(firstScore)!;
        expect(entries.length).toBe(6);
        expect(entries[0].outcome).toBe("Defaulted");
        expect(entries.map(e => e.outcome)).toEqual(["Defaulted", "g0", "g1", "g2", "g3", "g4"]);
    });

    it("is skipped above the row ceiling and not at it", () => {
        expect(SCORE_SEPARATION_MAX_ROWS).toBe(500_000);
        const columns = [colMeta("Score"), colMeta("Won", { dataType: "String", distinct: 2, twoValues: ["a", "b"], isBinaryFlag: true })];
        const small = [...Array(20).keys()].map(r => [r, r % 4 === 0 ? "a" : "b"]);
        expect(measureScoreSeparation({ rows: small, columns, text: String }).size).toBe(1);
        expect(measureScoreSeparation({ rows: small, columns, text: String, maxRows: 20 }).size).toBe(1);
        expect(measureScoreSeparation({ rows: small, columns, text: String, maxRows: 19 }).size).toBe(0);
        const tooMany = new Array(SCORE_SEPARATION_MAX_ROWS + 1).fill(small[0]);
        expect(measureScoreSeparation({ rows: tooMany, columns, text: String }).size).toBe(0);
    });
});

describe("scoreSeparation - privacy tiers", () => {
    const build = (level: string) => profile(
        [col("ID", "String"), col("Credit", "Integer"), col("Ratio", "Decimal", true), col("Defaulted", "String")],
        applicants().rows, level).cols;

    for (const level of ["0", "10", "20"]) {
        it(`ships at privacy level ${level} exactly as at 20, and carries no cell value`, () => {
            const top = build("20");
            const cols = build(level);
            for (const name of ["Credit", "Ratio"]) {
                expect(sepOf(cols, name), `${name} at ${level}`).toEqual(sepOf(top, name));
                expect(sepOf(cols, name)).toBeDefined();
            }
            const wire = JSON.stringify(sepOf(cols, "Credit"));
            for (const v of ["True", "False"]) expect(wire.includes(v), `${v} leaked`).toBe(false);
            for (const e of sepOf(cols, "Credit")) {
                expect(Object.keys(e).sort()).toEqual(["aucMinorityHigh", "nMajority", "nMinority", "outcome", "ties"]);
            }
            // The tier still withholds what a value survives into.
            expect((cols.find(c => c.name === "Credit") as any).lowValue === undefined, "lowValue is a tier-20 field").toBe(level !== "20");
        });
    }

    it("a recompute at another tier re-measures: an entry the new rows no longer support does not survive it", () => {
        const { it: engine, cols } = profile([col("ID", "String"), col("Score", "Integer"), col("Churned", "String")],
            [...Array(30).keys()].map(i => ["r" + i, i + 1, i % 5 === 0 ? "Yes" : "No"]));
        expect(sepOf(cols, "Score")).toBeDefined();
        engine.addRow(["r99", 31, "Maybe"]);    // the outcome has three values now
        const again = engine.getColumnsWithStats("10");
        expect(again.some(c => "scoreSeparation" in c)).toBe(false);
    });
});

describe("isBinaryFlag - a numeric column whose values are exactly 0 and 1", () => {
    const flag = (cols: LLMColumnWithValue[], name: string) => cols.find(c => c.name === name)!.isBinaryFlag;
    const table = (values: (number | null)[], dataType: string, isMeasure: boolean) =>
        profile([col("ID", "String"), col("V", dataType, isMeasure)], values.map((v, i) => ["r" + i, v])).cols;

    it("a measure of 0 and 1 is flagged, as a Decimal or an Integer, with blanks among them", () => {
        expect(flag(table([0, 1, 1, 0, 0, 0, 1, 0], "Integer", true), "V")).toBe(true);
        expect(flag(table([0, 1, 1, 0, 0, 0, 1, 0], "Decimal", true), "V")).toBe(true);
        expect(flag(table([0, 1, null, 0, 0, null, 1, 0], "Integer", true), "V")).toBe(true);
        expect(flag(table([0.0, 1.0, 1.0, 0.0], "Decimal", true), "V")).toBe(true);
    });

    it("a dimension of 0 and 1 is flagged exactly as it was before", () => {
        expect(flag(table([0, 1, 1, 0, 0, 0, 1, 0], "Integer", false), "V")).toBe(true);
    });

    it("a measure that is not exactly {0, 1} is not flagged", () => {
        expect(flag(table([0, 0, 0, 0], "Integer", true), "V")).toBeUndefined();         // one value
        expect(flag(table([1, 1, 1, 1], "Integer", true), "V")).toBeUndefined();
        expect(flag(table([0, 1, 2, 0, 1], "Integer", true), "V")).toBeUndefined();      // three values
        expect(flag(table([1, 2, 1, 2], "Integer", true), "V")).toBeUndefined();         // two values, not 0 and 1
        expect(flag(table([0, 0.5, 0, 0.5], "Decimal", true), "V")).toBeUndefined();
        expect(flag(table([-1, 1, -1, 1], "Integer", true), "V")).toBeUndefined();
    });

    it("the series-completeness pass cannot move: a flagged measure is read as a measure and is never a series key", () => {
        const QUARTERS = ["2023-Q1", "2023-Q2", "2023-Q3", "2023-Q4", "2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4"];
        const run = (second: number) => {
            const t = new IndexedText();
            t.setColumns([col("Quarter", "String"), col("Route", "String"), col("Passengers", "Integer", true), col("Active", "Integer", true)]);
            let n = 0;
            for (const q of QUARTERS) for (const r of ["Harbour Line", "Airport Express", "Coastal"]) {
                if (r === "Coastal" && QUARTERS.indexOf(q) > 4) continue;
                t.addRow([q, r, 5000 + 37 * n, n++ % 2 === 0 ? 0 : second]);
            }
            return t.getColumnsWithStats("20");
        };
        const flagged = run(1), plain = run(2);
        expect(flagged.find(c => c.name === "Active")!.isBinaryFlag).toBe(true);
        expect(plain.find(c => c.name === "Active")!.isBinaryFlag).toBeUndefined();
        expect(flagged.find(c => c.name === "Quarter")!.seriesCompleteness).toBeDefined();
        expect(flagged.find(c => c.name === "Quarter")!.seriesCompleteness).toEqual(plain.find(c => c.name === "Quarter")!.seriesCompleteness);
        expect(seriesKeyVerdict({
            name: "Active", dataType: "Integer", isMeasure: true, isBinaryFlag: true, identifierNamed: false,
            values: ["0", "1"], rows: 24,
        })).toBe("measure");
    });

    it("a text measure column named like a 0/1 count is not flagged by the new arm", () => {
        const cols = profile([col("ID", "String"), col("T", "String", true)], ["0", "1", "0", "1"].map((v, i) => ["r" + i, v])).cols;
        expect(cols.find(c => c.name === "T")!.isBinaryFlag).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------------------------------
// The two published tables the signal was sized on, when a checkout that holds them sits beside this one.
// The expected numbers are pairwise counts over the CSV, written here, not read off the pass.
function findDatasets(): string | null {
    const env = process.env.SCORE_SEPARATION_DATASETS;
    if (env && fs.existsSync(path.join(env, "loan_default_predictors.csv"))) return env;
    const here = path.dirname(fileURLToPath(import.meta.url));
    let root = path.resolve(here, "..", "..", "..");           // the repository root
    const parent = path.dirname(root);
    for (const name of fs.readdirSync(parent)) {
        const dir = path.join(parent, name, "testharness", "datasets");
        if (fs.existsSync(path.join(dir, "loan_default_predictors.csv")) && fs.existsSync(path.join(dir, "university_admissions.csv"))) return dir;
    }
    return null;
}
const DATASETS = findDatasets();

function readCsv(file: string): { header: string[]; rows: string[][] } {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.length > 0);
    const [header, ...rest] = lines.map(l => l.split(","));
    return { header, rows: rest };
}

describe.skipIf(!DATASETS)("scoreSeparation - the loan and admissions tables", () => {
    const load = (file: string, spec: { name: string, type: string, measure?: boolean }[]) => {
        const { header, rows } = readCsv(path.join(DATASETS!, file));
        const idx = spec.map(s => header.indexOf(s.name));
        const data = rows.map(r => idx.map((i, k) => (spec[k].type === "String" ? r[i] : parseFloat(r[i]))));
        return { data, spec };
    };
    const independent = (data: any[][], scoreAt: number, outcomeAt: number, positiveValue: string) => {
        const pos = data.filter(r => r[outcomeAt] === positiveValue).map(r => r[scoreAt] as number);
        const neg = data.filter(r => r[outcomeAt] !== positiveValue).map(r => r[scoreAt] as number);
        return { auc: pairwiseAuc(pos, neg), nPos: pos.length, nNeg: neg.length };
    };

    it("loan: CreditScore reads 0.2150 and DebtToIncome 0.6669 on 35 defaults of 1,400, as measures and as dimensions", () => {
        const spec = [
            { name: "LoanID", type: "String" }, { name: "CreditScore", type: "Integer" },
            { name: "DebtToIncome", type: "Decimal" }, { name: "Defaulted", type: "String" },
        ];
        const { data } = load("loan_default_predictors.csv", spec);
        const credit = independent(data, 1, 3, "True"), dti = independent(data, 2, 3, "True");
        expect(round4(credit.auc)).toBe(0.215);
        expect(round4(dti.auc)).toBe(0.6669);
        expect([credit.nPos, credit.nNeg]).toEqual([35, 1365]);
        for (const asMeasure of [false, true]) {
            const cols = spec.map(s => col(s.name, s.type, asMeasure && (s.name === "CreditScore" || s.name === "DebtToIncome")));
            for (const level of ["0", "20"]) {
                const out = profile(cols, data, level, asMeasure ? [] : ["CreditScore", "DebtToIncome"]).cols;
                const c = sepOf(out, "CreditScore")[0], d = sepOf(out, "DebtToIncome")[0];
                expect([c.outcome, c.aucMinorityHigh, c.nMinority, c.nMajority]).toEqual(["Defaulted", round4(credit.auc), 35, 1365]);
                expect([d.outcome, d.aucMinorityHigh, d.nMinority, d.nMajority]).toEqual(["Defaulted", round4(dti.auc), 35, 1365]);
            }
        }
    });

    it("admissions: SATScore reads 0.6739 for the accepted, who are the MAJORITY, so the rare value reads its complement", () => {
        const spec = [
            { name: "ApplicantID", type: "String" }, { name: "SATScore", type: "Integer" },
            { name: "HighSchoolGPA", type: "Decimal" }, { name: "Accepted", type: "String" },
        ];
        const { data } = load("university_admissions.csv", spec);
        const accepted = independent(data, 1, 3, "True");
        expect(round4(accepted.auc)).toBe(0.6739);
        expect([accepted.nPos, accepted.nNeg]).toEqual([1308, 492]);
        const out = profile(spec.map(s => col(s.name, s.type)), data).cols;
        const e = sepOf(out, "SATScore")[0];
        expect(e.outcome).toBe("Accepted");
        expect([e.nMinority, e.nMajority]).toEqual([492, 1308]);
        // The rare value is False, and False is the lower-scoring one: its AUC is the complement.
        expect(e.aucMinorityHigh).toBe(round4(1 - accepted.auc));
        expect(round4(1 - e.aucMinorityHigh)).toBe(0.6739);
    });
});

// ---------------------------------------------------------------------------------------------------
// The wire fixture the server reads. The server deserializes this file into its own model and resolves a
// score and an outcome from it, so the file is what both sides agree on: the engine's own output, narrowed
// to the fields the resolver reads, for the published tables above, in the bindings a report uses (the
// score as a group-by column and as a measure, with and without a case id) and at both ends of the
// privacy range. Set SCORE_SEPARATION_FIXTURE_WRITE=1 to rewrite it after a deliberate change.
describe.skipIf(!DATASETS)("scoreSeparation - the wire fixture the server reads", () => {
    const fixturePath = new URL("./fixtures/score-separation.json", import.meta.url);
    type Spec = { name: string, type: string, measure?: boolean, dimension?: boolean };

    const table = (file: string, spec: Spec[], level: string, drop: string[] = []) => {
        const { header, rows } = readCsv(path.join(DATASETS!, file));
        const keep = spec.filter(s => !drop.includes(s.name));
        const idx = keep.map(s => header.indexOf(s.name));
        const data = rows.map(r => idx.map((i, k) => (keep[k].type === "String" ? r[i] : parseFloat(r[i]))));
        const cols = keep.map(s => col(s.name, s.type, !!s.measure));
        return profile(cols, data, level, keep.filter(s => s.dimension).map(s => s.name)).cols;
    };

    const wire = (cols: LLMColumnWithValue[]) => cols.map((c: any) => ({
        name: c.name, dataType: c.dataType, isMeasure: c.isMeasure, isTemporal: c.isTemporal,
        isBinaryFlag: c.isBinaryFlag, distinctCount: c.distinctCount, valueNature: c.valueNature,
        minGroupCount: c.minGroupCount, modalShare: c.modalShare, formatSignature: c.formatSignature,
        ...(c.scoreSeparation ? { scoreSeparation: c.scoreSeparation } : {}),
    }));

    // A table with a two-valued column that is not an outcome (Sex) beside a plain numeric score.
    const people = (level: string) => {
        const rand = rng(21);
        const rows: any[][] = [];
        for (let i = 0; i < 400; i++) rows.push(["P" + i, i % 2 === 0 ? "Female" : "Male", Math.round(rand() * 100), Math.round(rand() * 1000) / 10]);
        return profile([col("PersonID", "String"), col("Sex", "String"), col("OutcomeScore", "Integer"), col("Weight", "Decimal")], rows, level,
            ["PersonID", "Sex", "OutcomeScore"]).cols;
    };

    const loan: Spec[] = [
        { name: "LoanID", type: "String", dimension: true }, { name: "CreditScore", type: "Integer" },
        { name: "DebtToIncome", type: "Decimal" }, { name: "LoanPurpose", type: "String", dimension: true },
        { name: "Defaulted", type: "String", dimension: true },
    ];
    const admissions: Spec[] = [
        { name: "ApplicantID", type: "String", dimension: true }, { name: "HighSchoolGPA", type: "Decimal" },
        { name: "SATScore", type: "Integer" }, { name: "IntendedMajor", type: "String", dimension: true },
        { name: "Accepted", type: "String", dimension: true },
    ];
    const churn: Spec[] = [
        { name: "CustomerID", type: "String", dimension: true }, { name: "Segment", type: "String", dimension: true },
        { name: "Churn Probability", type: "Decimal" }, { name: "Churned", type: "String", dimension: true },
    ];
    const asDims = (spec: Spec[], names: string[]) => spec.map(s => names.includes(s.name) ? { ...s, dimension: true } : s);
    const asMeasures = (spec: Spec[], names: string[]) => spec.map(s => names.includes(s.name) ? { ...s, measure: true } : s);

    const produce = () => ({
        _why: "Engine output for the published loan, admissions and churn tables, narrowed to the fields a server reads, with the score bound "
            + "as a group-by column (`...Dims`) and as a measure (`...Measures`), at the strictest and the most open privacy tier, with and "
            + "without a case id, plus a table whose only two-valued column is not an outcome and the bucketed form (a score bucket, an "
            + "outcome and a count).",
        loanDims: wire(table("loan_default_predictors.csv", asDims(loan, ["CreditScore", "DebtToIncome"]), "20")),
        loanDimsTier0: wire(table("loan_default_predictors.csv", asDims(loan, ["CreditScore", "DebtToIncome"]), "0")),
        loanMeasures: wire(table("loan_default_predictors.csv", asMeasures(loan, ["CreditScore", "DebtToIncome"]), "20")),
        loanNoId: wire(table("loan_default_predictors.csv", asDims(loan, ["CreditScore", "DebtToIncome"]), "20", ["LoanID", "LoanPurpose", "DebtToIncome"])),
        admissionsDims: wire(table("university_admissions.csv", asDims(admissions, ["HighSchoolGPA", "SATScore"]), "20")),
        admissionsTier0: wire(table("university_admissions.csv", asDims(admissions, ["HighSchoolGPA", "SATScore"]), "0")),
        churnDims: wire(table("churn_scores.csv", asDims(churn, ["Churn Probability"]), "20")),
        churnNull: wire(table("churn_scores_null.csv", asDims(churn, ["Churn Probability"]), "20")),
        churnNoId: wire(table("churn_scores.csv", asDims(churn, ["Churn Probability"]), "20", ["CustomerID", "Segment"])),
        peopleSexScore: wire(people("20")),
        bucketed: wire(table("churn_scores_bucketed.csv", [
            { name: "Churn Probability Bucket", type: "String", dimension: true }, { name: "Churned", type: "String", dimension: true },
            { name: "Cases", type: "Integer", measure: true }], "20")),
    });

    it("is what the engine produces today", () => {
        const now = produce();
        if (process.env.SCORE_SEPARATION_FIXTURE_WRITE) fs.writeFileSync(fixturePath, JSON.stringify(now, null, 2) + "\n");
        expect(JSON.parse(fs.readFileSync(fixturePath, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
    });

    it("carries the separation the tables were published with, at every tier", () => {
        const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
        const sep = (t: string, name: string) => fx[t].find((c: any) => c.name === name).scoreSeparation[0];
        expect(sep("loanDims", "CreditScore").aucMinorityHigh).toBe(0.215);
        expect(sep("loanDimsTier0", "CreditScore")).toEqual(sep("loanDims", "CreditScore"));
        expect(sep("loanMeasures", "DebtToIncome").aucMinorityHigh).toBe(0.6669);
        expect(sep("admissionsDims", "SATScore").aucMinorityHigh).toBe(0.3261);
        expect(sep("admissionsTier0", "SATScore")).toEqual(sep("admissionsDims", "SATScore"));
        expect(fx.peopleSexScore.find((c: any) => c.name === "Sex").isBinaryFlag, "Sex is two-valued and not a flag").toBeFalsy();
    });
});
