import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
    classifyForAggregation,
    defaultAggregation,
    nameLooksLevelNotSum,
    shareOfTotalIsHonest,
} from "../src/index";

// A PRICE, A TEMPERATURE, A LEVEL OR A PER-CASE DURATION IS NOT SUMMED.
//
// The names are a shared table: the server's resolver runs the same file through its own copy of
// the rule, so a name that moves on one side and not the other fails there or here.

interface NameTable { rule: string; source: string; yes: Array<string | { name: string }>; no: Array<string | { name: string }> }

const table: NameTable = JSON.parse(
    fs.readFileSync(new URL("./fixtures/level-not-sum.json", import.meta.url), "utf8"));
const names = (xs: NameTable["yes"]) => xs.map((x) => (typeof x === "string" ? x : x.name));
const yes = names(table.yes);
const no = names(table.no);
const measure = (name: string) => ({ name, isMeasure: true, dataType: "Double" });

describe("the level-not-sum name table", () => {
    it("is the table the server reads", () => {
        expect(table.rule).toBe("MeasureAdditivity.NameLooksLevelNotSum");
        expect(yes.length).toBeGreaterThan(0);
        expect(no.length).toBeGreaterThan(0);
        expect(new Set([...yes, ...no]).size).toBe(yes.length + no.length);
    });

    it("reads every YES name as a level", () => {
        // Joined so one run names every miss, not only the first.
        expect(yes.filter((n) => !nameLooksLevelNotSum(n)).join(" | ")).toBe("");
    });

    it("reads every NO name as not a level", () => {
        expect(no.filter((n) => nameLooksLevelNotSum(n)).join(" | ")).toBe("");
    });

    it("averages every YES name and sums every NO name under Auto", () => {
        expect(yes.filter((n) => defaultAggregation(measure(n)) !== "average").join(" | ")).toBe("");
        expect(no.filter((n) => defaultAggregation(measure(n)) !== "sum").join(" | ")).toBe("");
    });

    it("offers no share of a total beside a level", () => {
        expect(yes.filter((n) => shareOfTotalIsHonest(measure(n), "sum")).join(" | ")).toBe("");
        expect(no.filter((n) => !shareOfTotalIsHonest(measure(n), "sum")).join(" | ")).toBe("");
    });
});

describe("the rule stays a fallback", () => {
    it("a measured flag still wins; a default Sum of is not a measurement", () => {
        expect(classifyForAggregation({ ...measure("UnitPrice"), additivity: "part_of_whole" }).additivity).toBe("part_of_whole");
        expect(classifyForAggregation({ ...measure("Close"), additivity: "additive" }).additivity).toBe("additive");
        expect(classifyForAggregation({ ...measure("Sum of Close"), additivity: "additive" }).additivity).toBe("intensive_rate");
    });

    it("tokenises the server's way, so a bracketed unit still splits off", () => {
        // A word reader that keeps punctuation attached would read "(days)" and miss.
        expect(nameLooksLevelNotSum("Lead Time (days)")).toBe(true);
        expect(nameLooksLevelNotSum("Temp\u00e9rature niveau")).toBe(true);
        expect(nameLooksLevelNotSum("Pre\u00e7o M\u00e9dio")).toBe(true);
        expect(nameLooksLevelNotSum("")).toBe(false);
        expect(nameLooksLevelNotSum(null)).toBe(false);
    });
});
