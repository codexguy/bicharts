import query from "./country-ranking.dax?raw";
import spec from "./country-ranking.json";
import type { VisualizationSpec } from "@microsoft/fabric-visuals";
import type { ColumnMetadataMap } from "@/lib/to-data-table";
import { CONNECTION } from "../connection";

const vegaLiteSpec = spec as VisualizationSpec;

// Keyed by the query's raw output names. CountryCode keeps the same plain name the RegiaBI charts
// use, so a click on a bar joins the page's country filter (fromVegaInteraction matches by name).
export const columnMetadata: ColumnMetadataMap = {
    "DimCountry[CountryCode]": { name: "CountryCode", displayName: "Country code" },
    "DimCountry[Country]": { name: "Country", displayName: "Country" },
    "[Revenue per Capita]": { name: "RevenuePerCapita", displayName: "Revenue per capita", format: "$#,0.00" },
};

export function countryRanking() {
    return { connection: CONNECTION, query, columnMetadata, vegaLiteSpec };
}
