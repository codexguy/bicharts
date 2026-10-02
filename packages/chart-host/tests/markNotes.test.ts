import { describe, it, expect } from "vitest";
import { noteBadges, badgeKey, notesFor } from "../src/markNotes";
import { createFilter } from "../src/filterScope";

// READERS' NOTES AS BADGES, keyed by column values. Every agent-built app wrote this mapping from
// the guide and split its own badge ids apart to find the clicked mark; this is that, once.

const NOTES = [
    { chart: "country-map", markKey: "AUS", body: "Q3 dip is the floods" },
    { chart: "country-map", markKey: "AUS", body: "Older note" },
    { chart: "country-map", markKey: "CHL", body: "New distributor" },
    { chart: "shipping-lanes", markKey: "IND", markKeyTo: "CHL", body: "Port strike" },
    { chart: "country-map", markKey: "", body: "no key - skipped" },
];

describe("noteBadges", () => {
    it("one badge per noted mark: the count, and the first (newest) note as the tooltip", () => {
        const b = noteBadges(NOTES, { chart: "country-map", columns: "CountryCode" });
        expect(b).toHaveLength(2);
        expect(b[0]).toMatchObject({ column: "CountryCode", value: "AUS", label: "2", title: "Q3 dip is the floods (+1 more)" });
        expect(b[1]).toMatchObject({ value: "CHL", label: "1", title: "New distributor" });
    });

    it("a route is keyed by both ends with where", () => {
        const b = noteBadges(NOTES, { chart: "shipping-lanes", columns: ["OriginCountryCode", "DestinationCountryCode"] });
        expect(b).toEqual([expect.objectContaining({ where: { OriginCountryCode: "IND", DestinationCountryCode: "CHL" }, label: "1" })]);
    });

    it("badgeKey reads a clicked badge back as key values - no id parsing in the app", () => {
        const [route] = noteBadges(NOTES, { chart: "shipping-lanes", columns: ["O", "D"] });
        expect(badgeKey(route)).toEqual(["IND", "CHL"]);
        const [aus] = noteBadges(NOTES, { chart: "country-map", columns: "CountryCode" });
        expect(badgeKey(aus)).toEqual(["AUS"]);
    });
});

describe("notesFor", () => {
    it("the notes on the mark a page filter has selected", () => {
        const f = createFilter("CountryCode");
        expect(notesFor(NOTES, f, { chart: "country-map", columns: "CountryCode" })).toEqual([]);
        f.set("AUS");
        expect(notesFor(NOTES, f, { chart: "country-map", columns: "CountryCode" }).map(n => n.body))
            .toEqual(["Q3 dip is the floods", "Older note"]);
    });

    it("by a key given directly, a route's two ends", () => {
        expect(notesFor(NOTES, ["IND", "CHL"], { chart: "shipping-lanes", columns: ["O", "D"] }).map(n => n.body)).toEqual(["Port strike"]);
    });
});
