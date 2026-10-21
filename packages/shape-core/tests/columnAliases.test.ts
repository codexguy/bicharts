import { describe, it, expect } from "vitest";
import { englishImplicitAggNames } from "../src/aggregation";
import { IndexedText } from "../src/indexedText";
import { englishImplicitAggNames as fromBarrel, IndexedText as BarrelIndexedText } from "../src/index";

// A COLUMN CAN ANSWER TO A SECOND NAME, AND ONLY FOR CODE THAT ASKS FOR IT.
//
// Two ways a frozen chart's code can name a column the live data no longer calls that:
//
//  1. The engine renamed it. `Sum of Sum of Revenue` collapses to `Sum of Revenue`, and code
//     written before the collapse still reads the host's original name.
//  2. The HOST named it in another language. Power BI composes an automatic aggregation's name in
//     the viewer's UI language when the report opens - `Sum of Volume` in English, `Suma de Volume`
//     in Spanish - so code generated in one language and saved in a report looks up a name the next
//     viewer's data does not carry. The column's query name (`Sum(Leads.Volume)`) spells the
//     function in every language, so the English name can be recomposed from it exactly.
//
// Both are compatibility for FROZEN code, so neither may change what fresh code sees: no alias
// exists until a host arms the index for a particular piece of code, and code that never names the
// other form arms nothing.

describe("englishImplicitAggNames - the English name Power BI composes from a query name", () => {
    it("recomposes each aggregation function's English label", () => {
        expect(englishImplicitAggNames("Sum(Leads.Volume)")).toEqual(["Sum of Volume"]);
        expect(englishImplicitAggNames("Avg(All Visits.DurMin)")).toEqual(["Average of DurMin"]);
        expect(englishImplicitAggNames("CountNonNull(Lead Contact EMails.ContactEMail)")).toEqual(["Count of ContactEMail"]);
        // Count (Distinct) is labelled "Count of" by Power BI as well.
        expect(englishImplicitAggNames("Count(Leads By Date.CustomerName)")).toEqual(["Count of CustomerName"]);
        expect(englishImplicitAggNames("Median(T.Wait)")).toEqual(["Median of Wait"]);
        expect(englishImplicitAggNames("StandardDeviation(T.Wait)")).toEqual(["Standard deviation of Wait"]);
        expect(englishImplicitAggNames("Variance(T.Wait)")).toEqual(["Variance of Wait"]);
    });

    it("Min and Max are labelled by the column's type, so every form is a candidate", () => {
        // A number reads "Max of", a text column "Last", a date "Latest" - and the same for Min.
        expect(englishImplicitAggNames("Min(T.Price)")).toEqual(["Min of Price", "First Price", "Earliest Price"]);
        expect(englishImplicitAggNames("Max(T.Price)")).toEqual(["Max of Price", "Last Price", "Latest Price"]);
    });

    it("keeps a column name that already carries a label - the doubled name is the host's own", () => {
        expect(englishImplicitAggNames("Sum(divisional_revenue_by_year.Sum of Revenue)")).toEqual(["Sum of Sum of Revenue"]);
    });

    it("offers every table/column split when a name carries a dot, never guessing which half it is", () => {
        expect(englishImplicitAggNames("Sum(Sales.Details.Amount)")).toEqual(["Sum of Details.Amount", "Sum of Amount"]);
    });

    it("names nothing for a column, a model measure, or a function it does not know", () => {
        for (const q of ["Leads.Volume", "Leads.Total Sales", "Summary.Sum(x)", "Distinct(T.C)", "sum(T.C)",
            "Sum(Volume)", "Sum(T.)", "", null, undefined]) {
            expect(englishImplicitAggNames(q as any), String(q)).toEqual([]);
        }
    });

    it("is exported through the public barrel", () => {
        expect(typeof fromBarrel).toBe("function");
        expect(fromBarrel).toBe(englishImplicitAggNames);
        expect(BarrelIndexedText).toBe(IndexedText);
    });
});

// The columns a Spanish-language Power BI hands a visual for a Sankey over an automatic sum, with
// the query names that ride beside them.
function spanishSankey(): IndexedText {
    const idx = new IndexedText();
    idx.setColumns([
        { name: "Year", dataType: "Integer", isMeasure: false },
        { name: "Source", dataType: "String", isMeasure: false },
        { name: "Suma de Volume", dataType: "Integer", isMeasure: true },
    ]);
    idx.setHostQueryNames(["Leads.Year", "Leads.Source", "Sum(Leads.Volume)"]);
    idx.addRow([2022, "Website", 300], 0);
    idx.addRow([2023, "Website", 180], 1);
    return idx;
}

const ENGLISH_CODE = "const volIdx = ci('Sum of Volume'), yearIdx = ci('Year');";

describe("a localized implicit aggregation answers to its English name", () => {
    it("code that names the English form gets the alias, and the row answers to both names", () => {
        const idx = spanishSankey();
        expect(idx.aliasesForCode(ENGLISH_CODE)).toEqual([
            { name: "Suma de Volume", alias: "Sum of Volume", reason: "english-implicit-agg" },
        ]);
        // Asking is not arming: nothing is emitted until a host arms the index for the code.
        expect(idx.getArmedAliases()).toEqual([]);
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["Year", "Source", "Suma de Volume"]);

        expect(idx.armAliasesForCode(ENGLISH_CODE)).toEqual([
            { name: "Suma de Volume", alias: "Sum of Volume", reason: "english-implicit-agg" },
        ]);
        const row = idx.toObjectArray()[0];
        expect(row["Suma de Volume"]).toBe(300);
        expect(row["Sum of Volume"]).toBe(300);
    });

    it("code that does not name the English form gets nothing - fresh code never sees a new key", () => {
        const idx = spanishSankey();
        const spanishCode = "const volIdx = ci('Suma de Volume');";
        expect(idx.armAliasesForCode(spanishCode)).toEqual([]);
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["Year", "Source", "Suma de Volume"]);
        expect(idx.armAliasesForCode(null)).toEqual([]);
    });

    it("a mention that is not a column read arms nothing - a longer name or an unquoted word", () => {
        const idx = spanishSankey();
        expect(idx.aliasesForCode("ci('Sum of Volume Forecast')")).toEqual([]);
        expect(idx.aliasesForCode("// Sum of Volume is drawn as link width")).toEqual([]);
    });

    it("re-arming for code that no longer needs it turns the alias off", () => {
        const idx = spanishSankey();
        idx.armAliasesForCode(ENGLISH_CODE);
        idx.armAliasesForCode("const volIdx = ci('Suma de Volume');");
        expect(idx.getArmedAliases()).toEqual([]);
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["Year", "Source", "Suma de Volume"]);
    });

    it("an existing column of that name is untouched - the alias never shadows a real column", () => {
        const idx = new IndexedText();
        idx.setColumns([
            { name: "Sum of Volume", dataType: "Integer", isMeasure: false },
            { name: "Suma de Volume", dataType: "Integer", isMeasure: true },
        ]);
        idx.setHostQueryNames(["Leads.Sum of Volume", "Sum(Leads.Volume)"]);
        idx.addRow([1, 300], 0);
        expect(idx.armAliasesForCode(ENGLISH_CODE)).toEqual([]);
        expect(idx.toObjectArray()[0]["Sum of Volume"]).toBe(1);
    });

    it("an English viewer's column already has the English name, so there is nothing to alias", () => {
        const idx = new IndexedText();
        idx.setColumns([{ name: "Sum of Volume", dataType: "Integer", isMeasure: true }]);
        idx.setHostQueryNames(["Sum(Leads.Volume)"]);
        idx.addRow([300], 0);
        expect(idx.armAliasesForCode(ENGLISH_CODE)).toEqual([]);
    });

    it("the query name carries the function: `Sum of Volume` never maps onto an average", () => {
        const idx = new IndexedText();
        idx.setColumns([{ name: "Promedio de Volume", dataType: "Decimal", isMeasure: true }]);
        idx.setHostQueryNames(["Avg(Leads.Volume)"]);
        idx.addRow([12.5], 0);
        expect(idx.armAliasesForCode(ENGLISH_CODE)).toEqual([]);
        expect(idx.armAliasesForCode("df['Average of Volume']")).toEqual([
            { name: "Promedio de Volume", alias: "Average of Volume", reason: "english-implicit-agg" },
        ]);
    });

    it("two columns that would both answer to one name answer to neither - never guess", () => {
        const idx = new IndexedText();
        idx.setColumns([
            { name: "Suma de Volume", dataType: "Integer", isMeasure: true },
            { name: "Suma de Volume (2)", dataType: "Integer", isMeasure: true },
        ]);
        idx.setHostQueryNames(["Sum(Leads.Volume)", "Sum(Orders.Volume)"]);
        idx.addRow([1, 2], 0);
        expect(idx.armAliasesForCode(ENGLISH_CODE)).toEqual([]);
    });

    it("the CSV header carries the English name for code that reads it by header", () => {
        const idx = spanishSankey();
        expect(idx.getCSVHeaderLine()).toBe("Year,Source,Suma de Volume");
        idx.armAliasesForCode("df = pd.read_csv(io.StringIO(CSV_STRING)); v = df['Sum of Volume']");
        expect(idx.getCSVHeaderLine()).toBe("Year,Source,Sum of Volume");
        // Code that reads the column by BOTH names keeps the live name in the one positional slot.
        idx.armAliasesForCode("v = df['Sum of Volume']; w = df['Suma de Volume']");
        expect(idx.getCSVHeaderLine()).toBe("Year,Source,Suma de Volume");
    });

    it("new query names drop aliases armed against the old ones", () => {
        const idx = spanishSankey();
        idx.armAliasesForCode(ENGLISH_CODE);
        idx.setHostQueryNames(["Leads.Year", "Leads.Source", "Leads.Volume"]);
        expect(idx.getArmedAliases()).toEqual([]);
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["Year", "Source", "Suma de Volume"]);
    });

    it("an index without query names aliases nothing", () => {
        const idx = new IndexedText();
        idx.setColumns([{ name: "Suma de Volume", dataType: "Integer", isMeasure: true }]);
        idx.addRow([300], 0);
        expect(idx.armAliasesForCode(ENGLISH_CODE)).toEqual([]);
    });
});

describe("the doubled-prefix rename reports itself as an alias too", () => {
    const build = () => {
        const idx = new IndexedText();
        idx.setColumns([
            { name: "Category", dataType: "String", isMeasure: false },
            { name: "Sum of Sum of Revenue", dataType: "Integer", isMeasure: true },
        ]);
        idx.addRow(["Hardware", 1200], 0);
        return idx;
    };
    const OLD = "const revIdx = columns.findIndex(c => c.name === 'Sum of Sum of Revenue');";

    it("code naming the host's original name gets it, and arming sets the legacy switch", () => {
        const idx = build();
        const expected = [{ name: "Sum of Revenue", alias: "Sum of Sum of Revenue", reason: "doubled-agg-prefix" }];
        expect(idx.aliasesForCode(OLD)).toEqual(expected);
        expect(idx.emitLegacyAggAliases).toBe(false);
        expect(idx.armAliasesForCode(OLD)).toEqual(expected);
        expect(idx.emitLegacyAggAliases).toBe(true);
        expect(idx.getArmedAliases()).toEqual(expected);
    });

    it("code written after the collapse arms nothing and switches the legacy alias off", () => {
        const idx = build();
        idx.armAliasesForCode(OLD);
        expect(idx.armAliasesForCode("columns.findIndex(c => c.name === 'Sum of Revenue')")).toEqual([]);
        expect(idx.emitLegacyAggAliases).toBe(false);
    });

    it("a host that sets the legacy switch directly still sees the alias reported", () => {
        const idx = build();
        idx.emitLegacyAggAliases = true;
        expect(idx.getArmedAliases()).toEqual([
            { name: "Sum of Revenue", alias: "Sum of Sum of Revenue", reason: "doubled-agg-prefix" },
        ]);
    });

    it("a localized doubled name is aliased through its query name instead", () => {
        // A Spanish viewer of the same visual: Power BI composes `Suma de Sum of Revenue`, which the
        // English-only collapse leaves alone, and the query name recomposes the English host name.
        const idx = new IndexedText();
        idx.setColumns([{ name: "Suma de Sum of Revenue", dataType: "Integer", isMeasure: true }]);
        idx.setHostQueryNames(["Sum(divisional_revenue_by_year.Sum of Revenue)"]);
        idx.addRow([1200], 0);
        expect(idx.armAliasesForCode(OLD)).toEqual([
            { name: "Suma de Sum of Revenue", alias: "Sum of Sum of Revenue", reason: "english-implicit-agg" },
        ]);
    });

    it("an English doubled name is never aliased twice - its English form is the host name", () => {
        const idx = new IndexedText();
        idx.setColumns([{ name: "Sum of Sum of Revenue", dataType: "Integer", isMeasure: true }]);
        idx.setHostQueryNames(["Sum(divisional_revenue_by_year.Sum of Revenue)"]);
        idx.addRow([1200], 0);
        expect(idx.armAliasesForCode(OLD)).toEqual([
            { name: "Sum of Revenue", alias: "Sum of Sum of Revenue", reason: "doubled-agg-prefix" },
        ]);
    });
});

// AN AGGREGATION SWITCH KEEPS THE QUERY NAME. The reader changed "Count of X" to "Average of X" after the chart drew; the host kept
// `CountNonNull(T.X)`, and the English alias put the averages under the count's name for code that reads "Count of X".
const SWITCH_CODE = "var vi = names.indexOf('Count of Relationship weight'); if (vi < 0) throw new Error('INVALID:column \"Count of Relationship weight\" not found');";
function switched(liveName: string, dataType: string, queryName: string): IndexedText {
    const idx = new IndexedText();
    idx.setColumns([{ name: "Programme", dataType: "String", isMeasure: false }, { name: liveName, dataType, isMeasure: true }] as any);
    idx.setHostQueryNames(["SankeyFlows.Programme", queryName]);
    idx.addRow(["EAGF", 2.5], 0);
    return idx;
}
describe("an aggregation switch keeps the query name, so the English alias must not follow it", () => {
    it("an English average never answers to the count's name", () => {
        const idx = switched("Average of Relationship weight", "Decimal", "CountNonNull(SankeyFlows.Relationship weight)");
        expect(idx.armAliasesForCode(SWITCH_CODE)).toEqual([]);
        expect((idx.toObjectArray()[0] as any)["Count of Relationship weight"]).toBeUndefined();
    });
    it("a Decimal column never answers to a Count name, in any language", () => {
        const idx = switched("Moyenne de Relationship weight", "Decimal", "CountNonNull(SankeyFlows.Relationship weight)");
        expect(idx.armAliasesForCode(SWITCH_CODE)).toEqual([]);
    });
    it("a Sum switched to an English Average never answers to the sum's name", () => {
        const idx = switched("Average of Volume", "Decimal", "Sum(Leads.Volume)");
        expect(idx.armAliasesForCode("ci('Sum of Volume')")).toEqual([]);
    });
    it("the localized cases the alias exists for are unchanged", () => {
        expect(switched("Suma de Volume", "Integer", "Sum(Leads.Volume)").armAliasesForCode("ci('Sum of Volume')"))
            .toEqual([{ name: "Suma de Volume", alias: "Sum of Volume", reason: "english-implicit-agg" }]);
        expect(switched("Recuento de Id", "Integer", "CountNonNull(T.Id)").armAliasesForCode("ci('Count of Id')"))
            .toEqual([{ name: "Recuento de Id", alias: "Count of Id", reason: "english-implicit-agg" }]);
    });
    it("the rule, directly", async () => {
        const { englishAggAliasContradicted } = await import("../src/aggregation") as any;
        expect(englishAggAliasContradicted("Count(T.X)", "Average of X", "Decimal")).toBe(true);
        expect(englishAggAliasContradicted("Count(T.X)", "Min of X", "Integer")).toBe(true);
        expect(englishAggAliasContradicted("Count(T.X)", "Count of X", "Integer")).toBe(false);
        expect(englishAggAliasContradicted("Avg(T.X)", "Average of X", "Decimal")).toBe(false);
        expect(englishAggAliasContradicted("Sum(T.X)", "Somme de X", "Decimal")).toBe(false);
        expect(englishAggAliasContradicted("T.X", "Average of X", "Decimal")).toBe(false);
    });
});
