import { describe, it, expect } from "vitest";
import {
    classifyForAggregation, allowedAggregations, defaultAggregation, isAggregationAllowed,
    shareOfTotalIsHonest, nameLooksIntensiveRate, nameLooksPositional,
    stripHostAggPrefix, hasDefaultAggPrefix,
    INTENSIVE_WORD_TOKENS, INTENSIVE_SUFFIX_TOKENS, POSITIONAL_WORD_TOKENS,
} from "../src/aggregation";

// The bug this file exists for (2026-09-01), in one line: the selection card offered
// `Sum of Latitude: 84 (12.3% of total)` on the shipped 21-city sample table.
//
// Every case below is anchored on a REAL column from that table or on one of the anchor names
// the server-side resolver documents, so a reader can tell what a failure means. Token parity
// with the server's own copy of these lists is asserted server-side, because that is the suite a
// server-side edit runs; this file pins BEHAVIOUR.

const col = (o: any) => ({ dataType: "Decimal", isMeasure: true, valueNature: "Continuous", ...o });

describe("coordinates are their own class, and they are suppressed", () => {
    for (const name of ["Latitude", "Longitude", "latitude", "LONGITUDE",
                        "Sum of Latitude", "StoreLatitude", "DeliveryLongitude"]) {
        it(`${name} -> positional, no line by default`, () => {
            const k = classifyForAggregation(col({ name }));
            expect(k.additivity).toBe("positional");
            expect(k.suppressed).toBe(true);
            expect(k.nature).toBe("Continuous");       // NOT demoted to Categorical - see the
        });                                            // module header: MinContinuous is Layer A
    }

    it("sum and average are simply absent from the menu", () => {
        const menu = allowedAggregations(col({ name: "Latitude" }));
        expect(menu).not.toContain("sum");
        expect(menu).not.toContain("average");
        // min/max IS the bounding box of a selection, and stays available - which is why
        // `suppressed` is a separate flag from an empty menu.
        expect(menu).toContain("min");
        expect(menu).toContain("max");
        expect(defaultAggregation(col({ name: "Latitude" }))).toBe("min");
    });

    it("a coordinate the HOST already summed is still a coordinate", () => {
        // The measured flag would read "additive" here (a Sum-of prefix is all
        // classifyAdditivity has to go on). The positional test runs first for exactly this.
        const k = classifyForAggregation(col({ name: "Sum of Latitude", additivity: "additive" }));
        expect(k.additivity).toBe("positional");
    });

    it("does not false-match a name that merely CONTAINS the token", () => {
        // Whole-word / suffix only. "Latitudinal Spread" is not a coordinate column.
        expect(nameLooksPositional("Platitudes")).toBe(false);
        expect(nameLooksPositional("Longitudinally")).toBe(false);
    });
});

describe("intensive rates: averaged, never totalled", () => {
    for (const name of ["ChurnRate", "ProfitMargin", "UptimePct", "CreditScore", "NPS",
                        "LatencyMs", "AvgTemperature", "OccupancyRatio"]) {
        it(`${name} -> intensive_rate, sum off the menu`, () => {
            const k = classifyForAggregation(col({ name }));
            expect(k.additivity).toBe("intensive_rate");
            expect(k.suppressed).toBe(false);          // it IS a quantity, unlike a coordinate
            expect(allowedAggregations(col({ name }))).not.toContain("sum");
            expect(defaultAggregation(col({ name }))).toBe("average");
        });
    }

    it("the host's DEFAULT sum does not outrank the name", () => {
        // Power BI applies Sum to every numeric column dropped in a measure well, so
        // "Sum of LatencyMs" says what the host did, not what the quantity is. This is the
        // exact asymmetry the server-side resolver documents.
        expect(classifyForAggregation(col({ name: "Sum of LatencyMs", additivity: "additive" })).additivity)
            .toBe("intensive_rate");
        // ...while a DELIBERATE choice is real evidence and is trusted.
        expect(hasDefaultAggPrefix("Average of Margin")).toBe(false);
        expect(hasDefaultAggPrefix("Sum of Revenue")).toBe(true);
        expect(stripHostAggPrefix("Sum of Revenue")).toBe("Revenue");
    });

    it("a measured part_of_whole still stacks, and is trusted over the name", () => {
        // A production case: "Channel_Revenue_Share" reads as a rate by name and IS a share.
        const k = classifyForAggregation(col({ name: "Channel_Revenue_Share", additivity: "part_of_whole" }));
        expect(k.additivity).toBe("part_of_whole");
        expect(k.basis).toBe("measured");
        expect(allowedAggregations(col({ name: "Channel_Revenue_Share", additivity: "part_of_whole" })))
            .toContain("sum");
    });

    it("discourageAggregationAcrossGroups is honoured when the name says nothing", () => {
        const k = classifyForAggregation(col({ name: "Widgets", discourageAggregationAcrossGroups: true }));
        expect(k.additivity).toBe("intensive_rate");
        expect(k.basis).toBe("host-flag");
    });
});

describe("ordinary measures are untouched", () => {
    for (const name of ["Revenue", "Population", "Stores", "Sum of Revenue", "Units", "Headcount"]) {
        it(`${name} -> additive, full menu`, () => {
            const k = classifyForAggregation(col({ name }));
            expect(k.additivity).toBe("additive");
            expect(defaultAggregation(col({ name }))).toBe("sum");
        });
    }

    it("the words the lists were kept safe FROM still sum", () => {
        // "age" is word-only precisely so these do not false-match - the standing rule in both
        // copies of the list.
        for (const name of ["Usage", "Storage", "DataCoverage"]) {
            // Coverage IS on the list as a word, so only the first two are additive; this pins
            // which is which rather than asserting a comfortable blanket.
            const k = classifyForAggregation(col({ name }));
            if (name === "DataCoverage") expect(k.additivity).toBe("intensive_rate");
            else expect(k.additivity).toBe("additive");
        }
    });
});

describe("dimensions get First / Count / Distinct and nothing arithmetic", () => {
    const dim = (name: string, extra: any = {}) =>
        ({ name, dataType: "String", isMeasure: false, valueNature: "Categorical", ...extra });

    it("City and Segment", () => {
        for (const name of ["City", "Segment"]) {
            const menu = allowedAggregations(dim(name));
            expect(menu).toEqual(["first", "distinctcount", "count"]);
            expect(defaultAggregation(dim(name))).toBe("first");
            for (const bad of ["sum", "average", "median", "min", "max"] as const) {
                expect(isAggregationAllowed(dim(name), bad)).toBe(false);
            }
        }
    });

    it("a NUMERIC ordinal leads with median, offers average, and never sums", () => {
        const numeric = { name: "Tier", dataType: "Integer", isMeasure: false, valueNature: "Ordinal" };
        // The mean of a RANK is formally meaningless, so it must not be the default...
        expect(defaultAggregation(numeric)).toBe("median");
        // ...but a numeric ordinal is very often averaged on purpose ("4.2 stars"), and
        // substituting median for someone who deliberately asked for average is a surprise
        // rather than a protection.
        expect(allowedAggregations(numeric)).toContain("average");
        expect(allowedAggregations(numeric)).not.toContain("sum");

        // Low / Medium / High: the order exists but this module does not carry it, so min/max
        // would be alphabetical and wrong.
        const text = { name: "Severity", dataType: "String", isMeasure: false, valueNature: "Ordinal" };
        expect(allowedAggregations(text)).toEqual(["first", "distinctcount", "count"]);
    });
});

describe("share-of-total needs BOTH halves", () => {
    it("an additive column under a sum: honest", () => {
        expect(shareOfTotalIsHonest(col({ name: "Revenue" }), "sum")).toBe(true);
    });
    it("an AVERAGE of anything: not a share", () => {
        // The half the card already had right.
        expect(shareOfTotalIsHonest(col({ name: "Revenue" }), "average")).toBe(false);
    });
    it("a SUM of a coordinate: the 12.3%-of-total defect, now false", () => {
        expect(shareOfTotalIsHonest(col({ name: "Latitude" }), "sum")).toBe(false);
    });
    it("a SUM of a rate: also false", () => {
        expect(shareOfTotalIsHonest(col({ name: "ChurnRate" }), "sum")).toBe(false);
    });
});

describe("no measured nature (older client, or a host-assembled payload)", () => {
    it("falls back to role, then to dataType", () => {
        expect(classifyForAggregation({ name: "Revenue", isMeasure: true }).nature).toBe("Continuous");
        expect(classifyForAggregation({ name: "Amount", dataType: "Decimal" }).nature).toBe("Continuous");
        expect(classifyForAggregation({ name: "City", dataType: "String" }).nature).toBe("Categorical");
    });
    it("and a coordinate is still a coordinate without one", () => {
        expect(classifyForAggregation({ name: "Latitude", dataType: "Decimal" }).additivity)
            .toBe("positional");
    });
});

describe("the lists themselves", () => {
    it("carry no duplicates, in either array", () => {
        for (const [label, arr] of [["word", INTENSIVE_WORD_TOKENS],
                                    ["suffix", INTENSIVE_SUFFIX_TOKENS],
                                    ["positional", POSITIONAL_WORD_TOKENS]] as const) {
            expect(new Set(arr).size, `${label} list has a duplicate`).toBe(arr.length);
        }
    });

    it("keep coordinates OUT of the intensive arrays - they moved, they were not copied", () => {
        // If both lists carried them the parity test would still pass and the classifier would
        // return intensive_rate before it ever reached the positional branch.
        expect(INTENSIVE_WORD_TOKENS).not.toContain("latitude");
        expect(INTENSIVE_SUFFIX_TOKENS).not.toContain("longitude");
    });

    it("nameLooksIntensiveRate still answers TRUE for a coordinate", () => {
        // Because on the SERVER a coordinate is an intensive rate, and this predicate is the
        // one the parity with the server-side name test is about.
        expect(nameLooksIntensiveRate("Latitude")).toBe(true);
        expect(nameLooksIntensiveRate("ProfitMargin")).toBe(true);
        expect(nameLooksIntensiveRate("Revenue")).toBe(false);
    });
});

// SEPARATOR-GLUED TOKENS (2026-09-04). The camel split covers case and digit transitions and
// nothing else, so a token joined by an UNDERSCORE stayed invisible to `\bword\b` - an
// underscore is itself a word character. Such a name resolved only when the token landed LAST,
// through the `(suffix)$` arm, so `conversion_rate` was caught while a leading or middle `pct_`
// / `rate_` was not. A percentage that reads as additive is one a chart may sum or stack.
//
// Replayed over every distinct measure name the product has been handed: exactly one verdict
// moves, and it moves to intensive.
describe("a token joined by a separator is still a token", () => {
    it("catches a LEADING token an underscore had hidden", () => {
        expect(nameLooksIntensiveRate("pct_open_items")).toBe(true);
        expect(nameLooksIntensiveRate("Pct_Open_Items")).toBe(true);
        expect(nameLooksIntensiveRate("rate_per_hour")).toBe(true);
        expect(nameLooksIntensiveRate("avg_days_to_close")).toBe(true);
    });

    it("catches the other separators too", () => {
        expect(nameLooksIntensiveRate("margin-by-region")).toBe(true);
        expect(nameLooksIntensiveRate("fact.score.raw")).toBe(true);
    });

    it("still catches a TRAILING one, which the suffix arm always did", () => {
        expect(nameLooksIntensiveRate("conversion_rate")).toBe(true);
        expect(nameLooksIntensiveRate("avg_latency")).toBe(true);
    });

    // The whole point of word-only tokens: these CONTAIN one as a substring and are summable.
    // All four are real corpus names, and the separator split must not newly false-match them.
    it("does not create the false matches the word-only arrays were written around", () => {
        expect(nameLooksIntensiveRate("energy_usage_kwh"), "usage contains age").toBe(false);
        expect(nameLooksIntensiveRate("Sum of DurationSec"), "duration contains ratio").toBe(false);
        expect(nameLooksIntensiveRate("SharesTraded"), "shares is not share").toBe(false);
        expect(nameLooksIntensiveRate("Sum of Storage"), "storage contains age").toBe(false);
    });
});
