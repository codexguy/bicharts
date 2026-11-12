// The template's own Vega-Lite visual, on the same rows and the same page filter as the prebuilt widgets: a bar
// ranking of Category by Value. A click on a bar sets the Category filter; a click elsewhere in a widget reaches it.

import { VegaVisual, type VisualizationSpec } from "@microsoft/fabric-visuals";
import type { Filter } from "@bicharts/chart-host";
import { fieldMap as defaultMap, type FieldMap } from "@/fieldMap";
import { useThemeContext } from "@/hooks/theme.context";
import { toDataTable } from "@/lib/to-data-table";
import type { ActiveFilter } from "@/widgets/query";
import { VEGA_RANKING, vegaToFilter } from "./vega-ranking";
import { useWidgetData } from "@/widgets/use-widget-data";
import { Card, UnmappedRoles } from "./widget-card";

const SPEC: VisualizationSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    // The top ten, so every bar fits the card and the visual never scrolls inside it.
    transform: [
        { window: [{ op: "row_number", as: "rank" }], sort: [{ field: "Value", order: "descending" }] },
        { filter: "datum.rank <= 10" },
    ],
    height: "container",
    width: "container",
    mark: { type: "bar", cursor: "pointer" },
    encoding: {
        y: { field: "Country", type: "nominal", sort: { field: "Value", order: "descending" }, axis: { title: null, labelLimit: 160 } },
        x: { field: "Value", type: "quantitative", title: null },
        tooltip: [
            { field: "Country", type: "nominal" },
            { field: "Value", type: "quantitative", format: ",.0f" },
        ],
    },
};

export function VegaRankingCard({ filters, active, height, map = defaultMap }: {
    filters: Readonly<Record<string, Filter>>; active: readonly ActiveFilter[]; height: number; map?: FieldMap;
}) {
    const { theme } = useThemeContext();
    const { missing, result } = useWidgetData(VEGA_RANKING, map, active);
    const category = filters.Category;
    const table = result.data?.status === "success" ? result.data.table : undefined;
    return (
        <Card title={VEGA_RANKING.title} subtitle={VEGA_RANKING.subtitle} height={height} testId={VEGA_RANKING.id}>
            {missing.length ? (
                <UnmappedRoles roles={missing} />
            ) : table ? (
                <VegaVisual
                    spec={SPEC}
                    data={toDataTable(table as Parameters<typeof toDataTable>[0], { Category: { name: "Country", displayName: "Category" }, Value: { name: "Value", displayName: "Value" } })}
                    theme={theme}
                    style={{ height: "100%" }}
                    // Ten bars always fit: no scroll track beside them.
                    capabilities={{ disableCategoricalScroll: true }}
                    onInteraction={(events) => { if (category) vegaToFilter(category, events as unknown as Parameters<typeof vegaToFilter>[1]); }}
                />
            ) : (
                <p className="text-sm text-muted-foreground">{result.error ? `The query failed: ${result.error.message}` : "Loading..."}</p>
            )}
        </Card>
    );
}
