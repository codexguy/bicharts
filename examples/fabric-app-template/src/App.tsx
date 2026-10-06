import { useState, type ReactNode } from "react";
import { VegaVisual } from "@microsoft/fabric-visuals";
import {
    useBicControls,
    useBicFilter,
    BicFilterChips,
    fromVegaInteraction,
    noteBadges,
    notesFor,
    badgeKey,
} from "@bicharts/chart-host/react";
import { filterQuery, treatAs } from "@bicharts/chart-host/dax";

import { BicChartPanel } from "@/components/bic-chart-panel";
import { NotesDialog } from "@/components/bic-notes-dialog";
import { ScenariosPanel } from "@/components/bic-scenarios-panel";
import { useAuth } from "@/hooks/auth.context";
import { useThemeContext } from "@/hooks/theme.context";
import { useSemanticModelQuery } from "@/hooks/use-semantic-model-query";
import { useBicChartOptions } from "@/lib/bic-chart-options";
import { useMarkNotes } from "@/lib/bic-notes";
import { toDataTable } from "@/lib/to-data-table";
import { CONNECTION, countryRanking } from "@/queries";

// The three RegiaBI charts. Each folder is exactly what the chart MCP's generate_chart wrote:
// chart.js (the chart) and chart.component.tsx (its React host). Regenerate them rather than editing.
import { BivariateWorldChoroplethChart, rowsFromTable } from "@/charts/country-map/chart.component";
import { OriginDestinationFlowMapChart } from "@/charts/shipping-lanes/chart.component";
import { WhatIfProjectionChart } from "@/charts/revenue-projection/chart.component";
// The DAX each chart was generated on, so the live rows have the columns the chart expects.
import COUNTRY_MAP_DAX from "@/queries/overview/country-map.dax?raw";
import SHIPPING_LANES_DAX from "@/queries/overview/shipping-lanes.dax?raw";
import REVENUE_PROJECTION_DAX from "@/queries/overview/revenue-projection.dax?raw";

// A note is keyed by the model's own columns, never by a row position: a country by its code,
// a lane by both of its ends.
const COUNTRY_NOTES = { chart: "country-map", columns: "CountryCode" } as const;
const LANE_NOTES = { chart: "shipping-lanes", columns: ["OriginCountryCode", "DestinationCountryCode"] } as const;

type OpenNotes = { chart: string; columns: string | readonly string[]; key: readonly string[]; title: string };

const ranking = countryRanking();

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
    return (
        <section className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card p-4">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{subtitle}</p>
            {children}
        </section>
    );
}

function AddNote({ label, onClick }: { label: string | null; onClick: () => void }) {
    return (
        <button
            type="button"
            disabled={!label}
            onClick={onClick}
            className="mb-2 self-start rounded-lg border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
            {label ? `Add a note on ${label}` : "Select a mark to add a note"}
        </button>
    );
}

function App() {
    const { isDark, toggleTheme, theme } = useThemeContext();
    const options = useBicChartOptions();

    // Page filters, kept by the model's key. A chart that `selects` a filter handles the click, the dimming,
    // Ctrl-click, its legend and the clear; there's no select handler to write.
    const country = useBicFilter("CountryCode", { label: "Country", display: "Country" });
    const lane = useBicFilter(["OriginCountryCode", "DestinationCountryCode"], {
        label: "Lane",
        display: ["OriginCountry", "DestinationCountry"],
    });
    // The What-if chart draws its own sliders; this holds their values as page state for saved scenarios.
    const scenario = useBicControls();

    const author = useAuth().session?.user?.email;
    const { notes, error: notesError, add } = useMarkNotes(author);
    const [open, setOpen] = useState<OpenNotes | null>(null);

    const countries = useSemanticModelQuery({ connection: CONNECTION, query: COUNTRY_MAP_DAX });
    const lanes = useSemanticModelQuery({ connection: CONNECTION, query: SHIPPING_LANES_DAX });
    const projection = useSemanticModelQuery({
        connection: CONNECTION,
        // The selected country narrows the projection's query; with nothing selected the query is unchanged.
        query: filterQuery(REVENUE_PROJECTION_DAX, treatAs(country, "DimCountry[CountryCode]")),
    });
    const ranked = useSemanticModelQuery({ connection: ranking.connection, query: ranking.query });

    const countryRows = countries.data?.status === "success" ? rowsFromTable(countries.data.table) : [];

    return (
        <main className="flex min-h-screen flex-col gap-4 bg-background p-4 text-foreground">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h1 className="text-xl font-semibold">Global Revenue</h1>
                    <p className="text-sm text-muted-foreground">
                        Click a country on the map or in the ranking to filter the shipping lanes and the revenue
                        projection. Select a country or a lane to leave a note on it.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <BicFilterChips />
                    <button
                        type="button"
                        onClick={toggleTheme}
                        aria-pressed={isDark}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium"
                    >
                        {isDark ? "Light mode" : "Dark mode"}
                    </button>
                </div>
            </header>
            {notesError ? (
                <p role="alert" className="text-sm text-destructive">
                    Notes could not be loaded: {notesError}
                </p>
            ) : null}

            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                <Card
                    title="Revenue per capita vs return rate"
                    subtitle="Each country by revenue per inhabitant and the share of orders returned"
                >
                    <AddNote
                        label={country.active ? country.text : null}
                        onClick={() =>
                            setOpen({ ...COUNTRY_NOTES, key: [String(country.keys[0])], title: country.text })
                        }
                    />
                    <BicChartPanel result={countries} minChartWidth={560} minChartHeight={320} onClearFilters={country.clear}>
                        {(table, size) => (
                            <BivariateWorldChoroplethChart
                                table={table}
                                {...size}
                                options={options}
                                selects={country}
                                annotations={noteBadges(notes, COUNTRY_NOTES)}
                                onAnnotationClick={(a) => {
                                    const key = badgeKey(a);
                                    setOpen({
                                        ...COUNTRY_NOTES,
                                        key: [String(key)],
                                        title: country.textOf(key, countryRows) || String(key),
                                    });
                                }}
                            />
                        )}
                    </BicChartPanel>
                </Card>

                <Card
                    title="Shipping lanes"
                    subtitle="Units shipped from origin to destination; shows the lanes that touch the selected country"
                >
                    <AddNote
                        label={lane.active ? lane.text : null}
                        onClick={() => setOpen({ ...LANE_NOTES, key: lane.keys.map(String), title: lane.text })}
                    />
                    <BicChartPanel result={lanes} minChartWidth={560} minChartHeight={320} onClearFilters={country.clear}>
                        {(table, size) => (
                            <OriginDestinationFlowMapChart
                                table={table}
                                {...size}
                                options={options}
                                selects={lane}
                                filterBy={{ filter: country, columns: ["OriginCountryCode", "DestinationCountryCode"] }}
                                annotations={noteBadges(notes, LANE_NOTES)}
                                onAnnotationClick={(a) => {
                                    const key = (badgeKey(a) as unknown as unknown[]).map(String);
                                    setOpen({ ...LANE_NOTES, key, title: key.join(" → ") });
                                }}
                            />
                        )}
                    </BicChartPanel>
                </Card>
            </div>

            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="min-w-0 xl:col-span-2">
                    <Card
                        title="Revenue projection"
                        subtitle="Steer the growth rate inside the chart against the target, and save a setting as a named scenario"
                    >
                        <BicChartPanel result={projection} minChartWidth={560} minChartHeight={340} onClearFilters={country.clear}>
                            {(table, size) => (
                                <WhatIfProjectionChart table={table} {...size} options={options} controls={scenario} />
                            )}
                        </BicChartPanel>
                        <ScenariosPanel chart="revenue-projection" controls={scenario} author={author} />
                    </Card>
                </div>

                {/* The template's own Vega-Lite visual, on the same page and the same country filter. */}
                <div className="min-w-0">
                    {ranked.error ? (
                        <p role="alert" className="text-sm text-destructive">
                            The ranking could not be loaded: {ranked.error.message}
                        </p>
                    ) : ranked.data?.status === "success" ? (
                        <VegaVisual
                            spec={ranking.vegaLiteSpec}
                            data={toDataTable(ranked.data.table, ranking.columnMetadata)}
                            theme={theme}
                            style={{ height: 520 }}
                            header={{ title: "Revenue per capita", subtitle: "Countries ranked; click a bar to filter" }}
                            onInteraction={(events) => fromVegaInteraction(country, events)}
                        />
                    ) : (
                        <p className="text-sm text-muted-foreground">Loading the ranking…</p>
                    )}
                </div>
            </div>

            {open ? (
                <NotesDialog
                    title={open.title}
                    notes={notesFor(notes, open.key, { chart: open.chart, columns: open.columns })}
                    onAdd={(body) => add(open.chart, open.key, body)}
                    onClose={() => setOpen(null)}
                />
            ) : null}
        </main>
    );
}

export default App;
