// The template's Vega-Lite ranking as the page sees it: the roles it reads and how a picked bar reaches the filter.

import { fromVegaInteraction } from "@bicharts/chart-host/react";
import type { WidgetDef } from "@/widgets/query";

// Its column names are the page filter's key ("Country", the name the prebuilt widgets read for Category), so
// fromVegaInteraction matches a picked bar to the filter by name.
export const VEGA_RANKING: WidgetDef = {
    id: "vega-ranking",
    kind: "chart",
    renderer: "d3",
    chartType: "Vega-Lite bar chart",
    title: "Top ten (the template's Vega-Lite visual)",
    subtitle: "The same rows and the same filter as the widgets around it.",
    selects: "Category",
    columns: [
        { name: "Country", role: "Category" },
        { name: "Value", role: "Value" },
    ],
    source: { kind: "file", path: "src/components/vega-ranking-card.tsx" },
};

/** A Vega interaction, applied to the page filter it belongs to. Returns whether the filter changed. */
export const vegaToFilter = fromVegaInteraction;

