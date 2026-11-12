// Every prebuilt widget: its definition (widgets.json) beside the React host its generated code came with. To add a
// chart your agent generated into src/widgets/<id>/, add its entry to widgets.json and its component here.

import type { ComponentType } from "react";
import type { Controls, Filter } from "@bicharts/chart-host";
import { WIDGET_DEFS, renameOf, type WidgetDef } from "./query";

import { LollipopChart } from "./ranking/chart.component";
import { WorldChoroplethChart } from "./country-map/chart.component";
import { TimeSeriesPlotChart } from "./trend/chart.component";
import { VarianceChartBudgetVsActualChart } from "./actual-vs-target/chart.component";
import { WhatIfProjectionChart } from "./what-if-projection/chart.component";
import { WhatIfScenariosChart } from "./what-if-scenarios/chart.component";
import { SelectionExplainerChart } from "./selection-explainer/chart.component";
import { BudgetAllocatorChart } from "./budget-allocator/chart.component";

/** The props every generated component takes that the page passes. */
export interface WidgetComponentProps {
    table?: { columns: { name: string }[]; rows: unknown[][] };
    rename?: Record<string, string>;
    width: number;
    height: number;
    selects?: Filter;
    controls?: Controls;
    options?: Record<string, unknown>;
    rememberAs?: string;
}

const COMPONENTS: Record<string, ComponentType<WidgetComponentProps>> = {
    "ranking": LollipopChart,
    "country-map": WorldChoroplethChart,
    "trend": TimeSeriesPlotChart,
    "actual-vs-target": VarianceChartBudgetVsActualChart,
    "what-if-projection": WhatIfProjectionChart,
    "what-if-scenarios": WhatIfScenariosChart,
    "selection-explainer": SelectionExplainerChart,
    "budget-allocator": BudgetAllocatorChart,
};

export interface Widget {
    def: WidgetDef;
    Component: ComponentType<WidgetComponentProps>;
    /** Role -> the code's column name, built once so a re-render never re-maps the rows. */
    rename: Record<string, string>;
}

export const WIDGETS: Widget[] = WIDGET_DEFS.map((def) => {
    const Component = COMPONENTS[def.id];
    if (!Component) throw new Error(`widgets.json lists ${def.id} but src/widgets/registry.ts has no component for it`);
    return { def, Component, rename: renameOf(def) };
});

export const widgetById = (id: string): Widget => {
    const w = WIDGETS.find((x) => x.def.id === id);
    if (!w) throw new Error(`no widget ${id}`);
    return w;
};

/**
 * The page filters: one per role a widget selects by, keyed by the column name the selecting widgets' code reads (they
 * must agree, which widgets.spec checks).
 */
export function filterKeys(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { def } of WIDGETS) {
        if (!def.selects) continue;
        const col = def.columns.find((c) => c.role === def.selects)?.name;
        if (col) out[def.selects] = out[def.selects] ?? col;
    }
    return out;
}
