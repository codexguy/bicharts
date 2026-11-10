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

// A CHART GENERATED IN ONE LANGUAGE, OPENED IN ANOTHER. The code was written in a Spanish session and reads
// `Suma de Actividades`; the English viewer's host calls the same field `Sum of Actividades`. The English recomposition
// cannot help in that direction, so the host keeps the names and query names the columns had at generation and hands them
// back (setGenerationColumns).
const STORED_CODE = "const mi = ci('Suma de Actividades');";
function englishViewerOfSpanishChart(): IndexedText {
    const idx = new IndexedText();
    idx.setColumns([
        { name: "Riesgo", dataType: "String", isMeasure: false },
        { name: "Sum of Actividades", dataType: "Integer", isMeasure: true },
    ]);
    idx.setHostQueryNames(["Sheet1.Riesgo", "Sum(Sheet1.Actividades)"]);
    idx.addRow(["Alto", 7], 0);
    idx.addRow(["Bajo", 3], 1);
    return idx;
}
const STORED_SPANISH = [
    { n: "Riesgo", q: "Sheet1.Riesgo" },
    { n: "Suma de Actividades", q: "Sum(Sheet1.Actividades)" },
];

describe("a name stored at generation answers through its query name", () => {
    it("without the stored names nothing answers - the chart is refused", () => {
        expect(englishViewerOfSpanishChart().aliasesForCode(STORED_CODE)).toEqual([]);
    });

    it("with them the live column answers to the stored name, in the rows and the CSV header", () => {
        const idx = englishViewerOfSpanishChart();
        idx.setGenerationColumns(STORED_SPANISH);
        const expected = [{ name: "Sum of Actividades", alias: "Suma de Actividades", reason: "stored-query-name" }];
        expect(idx.aliasesForCode(STORED_CODE)).toEqual(expected);
        expect(idx.armAliasesForCode(STORED_CODE)).toEqual(expected);
        expect(idx.getArmedAliases()).toEqual(expected);
        const row = idx.toObjectArray()[0];
        expect(row["Sum of Actividades"]).toBe(7);
        expect(row["Suma de Actividades"]).toBe(7);
        expect(idx.getCSVHeaderLine()).toBe("Riesgo,Suma de Actividades");
    });

    it("a query name that no longer spells the column's function still answers - the stored name was true when stored", () => {
        const idx = new IndexedText();
        idx.setColumns([{ name: "Promedio de Precio", dataType: "Decimal", isMeasure: true }]);
        idx.setHostQueryNames(["Sum(T.Precio)"]);
        idx.addRow([12.5], 0);
        idx.setGenerationColumns([{ n: "Average of Precio", q: "Sum(T.Precio)" }]);
        expect(idx.armAliasesForCode("ci('Average of Precio')")).toEqual([
            { name: "Promedio de Precio", alias: "Average of Precio", reason: "stored-query-name" },
        ]);
    });

    it("a stored query name that matches no live column arms nothing", () => {
        const idx = englishViewerOfSpanishChart();
        idx.setGenerationColumns([{ n: "Suma de Actividades", q: "Sum(Sheet2.Actividades)" }]);
        expect(idx.armAliasesForCode(STORED_CODE)).toEqual([]);
    });

    it("a live column whose query name the host withheld arms nothing", () => {
        const idx = englishViewerOfSpanishChart();
        idx.setHostQueryNames(["Sheet1.Riesgo", null]);
        idx.setGenerationColumns(STORED_SPANISH);
        expect(idx.armAliasesForCode(STORED_CODE)).toEqual([]);
    });

    it("two live columns with the same query name arm nothing - never guess", () => {
        const idx = new IndexedText();
        idx.setColumns([
            { name: "Sum of Actividades", dataType: "Integer", isMeasure: true },
            { name: "Sum of Actividades (2)", dataType: "Integer", isMeasure: true },
        ]);
        idx.setHostQueryNames(["Sum(Sheet1.Actividades)", "Sum(Sheet1.Actividades)"]);
        idx.addRow([1, 2], 0);
        idx.setGenerationColumns(STORED_SPANISH);
        expect(idx.armAliasesForCode(STORED_CODE)).toEqual([]);
    });

    it("a stored name that is another live column's name arms nothing - the alias never shadows a real column", () => {
        const idx = new IndexedText();
        idx.setColumns([
            { name: "Suma de Actividades", dataType: "Integer", isMeasure: false },
            { name: "Sum of Actividades", dataType: "Integer", isMeasure: true },
        ]);
        idx.setHostQueryNames(["Sheet1.Suma de Actividades", "Sum(Sheet1.Actividades)"]);
        idx.addRow([1, 7], 0);
        idx.setGenerationColumns(STORED_SPANISH);
        expect(idx.armAliasesForCode(STORED_CODE)).toEqual([]);
        expect(idx.toObjectArray()[0]["Suma de Actividades"]).toBe(1);
    });

    it("handing back null disarms", () => {
        const idx = englishViewerOfSpanishChart();
        idx.setGenerationColumns(STORED_SPANISH);
        idx.armAliasesForCode(STORED_CODE);
        idx.setGenerationColumns(null);
        expect(idx.getArmedAliases()).toEqual([]);
        expect(idx.aliasesForCode(STORED_CODE)).toEqual([]);
        expect(Object.keys(idx.toObjectArray()[0])).toEqual(["Riesgo", "Sum of Actividades"]);
    });

    it("the same list again keeps what is armed", () => {
        const idx = englishViewerOfSpanishChart();
        idx.setGenerationColumns(STORED_SPANISH);
        idx.armAliasesForCode(STORED_CODE);
        idx.setGenerationColumns(STORED_SPANISH.map(c => ({ ...c })));
        expect(idx.getArmedAliases()).toHaveLength(1);
    });

    it("the English recomposition still reports its own reason beside a stored list", () => {
        const idx = spanishSankey();
        idx.setGenerationColumns([{ n: "Year", q: "Leads.Year" }]);
        expect(idx.armAliasesForCode(ENGLISH_CODE)).toEqual([
            { name: "Suma de Volume", alias: "Sum of Volume", reason: "english-implicit-agg" },
        ]);
    });

    it("reset forgets the stored names", () => {
        const idx = englishViewerOfSpanishChart();
        idx.setGenerationColumns(STORED_SPANISH);
        idx.reset();
        idx.setColumns([{ name: "Sum of Actividades", dataType: "Integer", isMeasure: true }]);
        idx.setHostQueryNames(["Sum(Sheet1.Actividades)"]);
        idx.addRow([7], 0);
        expect(idx.aliasesForCode(STORED_CODE)).toEqual([]);
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
