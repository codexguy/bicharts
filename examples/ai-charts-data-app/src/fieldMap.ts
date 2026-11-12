// THE FIELD MAP: the one file you edit to point every chart and mini-app at your own semantic model.
//
// Each ROLE is a column a prebuilt widget reads. Bind it to a column of your model ({ table, column }), to one of its
// measures ({ measure }) or to a DAX expression ({ expression }). Every widget's query is built from this map, and it
// names each result column after its role, so the widget code never changes: rebinding means editing this file only.
//
// A role bound to a column groups the rows (one row per value); a role bound to a measure or an expression is computed
// for each row. A role you leave out (or set to null) shows "Map a field to <Role> in src/fieldMap.ts" in the panels
// that need it, never a blank chart.
//
// Shipped bound to the public Global Revenue v2 sample model (examples/fabric-app in the bicharts repository). Until
// `connection` names a connector declared in rayfin/rayfin.yml, the page draws its bundled sample rows instead of
// querying a model.

export type FieldBinding =
    | { table: string; column: string }
    | { measure: string }
    | { expression: string };

export interface FieldMap {
    /** The Rayfin connector the queries run through (`npx rayfin connector add --name <this> ...`). */
    connection: string;
    /** Role name -> the field of your model it reads. */
    roles: Partial<Record<string, FieldBinding | null>>;
}

export const fieldMap: FieldMap = {
    connection: "globalrevenue",
    roles: {
        // Charts: one row per category (the ranking, the map, the selection explainer, the template's Vega ranking).
        Category: { table: "DimCountry", column: "Country" },
        CountryCode: { table: "DimCountry", column: "CountryCode" }, // ISO 3166 alpha-3, for the map
        Group: { table: "DimCountry", column: "Region" },
        Value: { measure: "Revenue" },
        Growth: { measure: "Revenue YoY %" },
        Attainment: { measure: "Target Attainment %" },
        ReturnRate: { measure: "Return Rate %" },
        Satisfaction: { measure: "CSAT %" },

        // Charts over time: one row per month (the trend, actual against target).
        Date: { table: "DimDate", column: "MonthStart" },
        Period: { table: "DimDate", column: "YearMonth" },
        Target: { measure: "Revenue Target" },

        // What-if projection and What-if scenarios: the series to project and the goal it is steered toward.
        Baseline: { measure: "Revenue" },
        Goal: { measure: "Revenue Target" },

        // Budget allocator: one row per category and year, the spend and the response it bought.
        Year: { table: "DimDate", column: "Year" },
        Spend: { measure: "Marketing Spend" },
        Response: { measure: "Revenue" },
    },
};
