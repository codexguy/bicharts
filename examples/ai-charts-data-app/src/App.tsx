// The AI Charts Data App: prebuilt RegiaBI charts and mini-apps, rebound to your own model through src/fieldMap.ts,
// beside the template's own Vega-Lite visual. Every widget sets or follows the same page filters.

import { useMemo, useState } from "react";
import { BicFilterChips, useBicControls, useBicFilter } from "@bicharts/chart-host/react";
import { BicThemeToggle } from "@/components/bic-theme-toggle";
import { VegaRankingCard } from "@/components/vega-ranking-card";
import { WidgetCard } from "@/components/widget-card";
import { fieldMap } from "@/fieldMap";
import { useBicChartOptions } from "@/lib/bic-chart-options";
import { filterKeys, widgetById } from "@/widgets/registry";
import { activeFilters, isLive } from "@/widgets/use-widget-data";

const KEYS = filterKeys();

type Tab = "charts" | "apps";

function App() {
    const options = useBicChartOptions();
    const [tab, setTab] = useState<Tab>("charts");

    // The page filters, one per role a widget can set. Each is keyed by the column the widgets that set it read.
    const category = useBicFilter(KEYS.Category, { label: "Category" });
    const date = useBicFilter(KEYS.Date, { label: "Month" });
    const filters = useMemo(() => ({ Category: category, Date: date }), [category, date]);
    const active = activeFilters(filters);

    // The mini-apps' own controls (the sliders they draw), as page state that survives switching tabs.
    const projection = useBicControls(undefined, { id: "what-if-projection" });
    const scenarios = useBicControls(undefined, { id: "what-if-scenarios" });
    const explainer = useBicControls(undefined, { id: "selection-explainer" });
    const allocator = useBicControls(undefined, { id: "budget-allocator" });

    const card = (id: string, height: number, controls?: ReturnType<typeof useBicControls>) => (
        <WidgetCard widget={widgetById(id)} filters={filters} active={active} options={options} height={height} controls={controls} />
    );

    const tabClass = (t: Tab) =>
        `rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-brand text-on-brand" : "border border-border"}`;

    return (
        <main className="flex min-h-screen flex-col gap-4 bg-background p-4 text-foreground">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-xl font-semibold">AI Charts Data App</h1>
                    <p className="text-sm text-muted-foreground">
                        {isLive(fieldMap)
                            ? `Live from the ${fieldMap.connection} connector.`
                            : "Sample rows. Point src/fieldMap.ts at your model to draw your own data."}{" "}
                        Click any mark to filter the page.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <BicFilterChips />
                    <BicThemeToggle />
                </div>
            </header>

            <nav role="tablist" aria-label="Pages" className="flex gap-2">
                <button type="button" role="tab" aria-selected={tab === "charts"} className={tabClass("charts")} onClick={() => setTab("charts")}>
                    Charts
                </button>
                <button type="button" role="tab" aria-selected={tab === "apps"} className={tabClass("apps")} onClick={() => setTab("apps")}>
                    Mini-apps
                </button>
            </nav>

            {tab === "charts" ? (
                <div role="tabpanel" className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="min-w-0 xl:col-span-2">{card("ranking", 600)}</div>
                    {card("country-map", 460)}
                    <VegaRankingCard filters={filters} active={active} height={460} />
                    {card("trend", 440)}
                    {card("actual-vs-target", 440)}
                </div>
            ) : (
                <div role="tabpanel" className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                    {/* Full width: the allocator names each channel under its own slot, and drops a name that doesn't fit. */}
                    <div className="min-w-0 xl:col-span-2">{card("budget-allocator", 520, allocator)}</div>
                    {card("selection-explainer", 520, explainer)}
                    {card("what-if-projection", 520, projection)}
                    <div className="min-w-0 xl:col-span-2">{card("what-if-scenarios", 460, scenarios)}</div>
                </div>
            )}
        </main>
    );
}

export default App;
