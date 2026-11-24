// The binary-outcome NAME test reads whole words. A two-valued column is flagged as an outcome (isBinaryFlag) when its
// values are boolean-ish or its NAME says outcome. The name test matched its words anywhere, so Window and Winter
// ("win"), Passenger and Compass ("pass"), Interactive ("active") read as outcomes, and a false flag feeds the server's
// outcome facts, drops a real parent in the categorical nesting, makes a cutoff outcome and ranks first in the
// separation score. Now the name is split into words (camel case and separators) and each word is tested whole, with its
// inflections; the long distinctive stems (default, churn, fraud, approv, convert, cancel, delinquen) still read at a
// word's start. The values here are Alpha/Beta, so only the name can flag the column.
import { describe, it, expect } from "vitest";
import { ingest } from "../src/ingest";

function flagged(name: string): boolean {
    const r = ingest({ kind: "csv", text: `${name},Value\nAlpha,1\nBeta,2\nAlpha,3\nBeta,4\n` }, { measures: ["Value"] });
    return !!r.columns.find(c => c.name === name)!.isBinaryFlag;
}

describe("an outcome word inside another word is not an outcome", () => {
    it.each(["Window", "Passenger Class", "Interactive", "Winter Season", "Compass Point", "Wind Direction", "Password Reset",
             "Flagship Store", "Twin Peaks"])("%s", name => {
        expect(flagged(name)).toBe(false);
    });
});

describe("an outcome name is still an outcome", () => {
    it.each(["Churned", "Churn Flag", "ChurnFlag", "churn_status", "Defaulted", "Fraud", "Approved", "Approval Status",
             "Converted", "Cancelled", "Delinquent", "Paid", "Unpaid", "Won", "Win", "Pass", "Passed", "Fail", "Failed",
             "Active", "Inactive", "Flag", "isActive", "has_churned", "IsPaid", "Loan Defaulted", "Pass/Fail"])("%s", name => {
        expect(flagged(name)).toBe(true);
    });
});

describe("boolean values still flag whatever the name", () => {
    it("Window with yes/no values", () => {
        const r = ingest({ kind: "csv", text: "Window,Value\nyes,1\nno,2\nyes,3\nno,4\n" }, { measures: ["Value"] });
        expect(r.columns.find(c => c.name === "Window")!.isBinaryFlag).toBe(true);
    });
});
