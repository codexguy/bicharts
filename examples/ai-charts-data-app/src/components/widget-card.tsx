// One prebuilt widget in a card: its rows (live or sample), the message for an unmapped role, and the generated
// component wired to the page filter it sets and, for a mini-app, to its controls.

import type { ReactNode } from "react";
import type { Controls, Filter } from "@bicharts/chart-host";
import { BicChartPanel } from "@/components/bic-chart-panel";
import { fieldMap as defaultMap, type FieldMap } from "@/fieldMap";
import type { ActiveFilter } from "@/widgets/query";
import type { Widget } from "@/widgets/registry";
import { useWidgetData } from "@/widgets/use-widget-data";

export function Card({ title, subtitle, height, testId, children }: {
    title: string; subtitle: string; height: number; testId?: string; children: ReactNode;
}) {
    return (
        <section data-widget={testId} className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4" style={{ height }}>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mb-3 text-sm text-muted-foreground">{subtitle}</p>
            <div className="min-h-0 flex-1">{children}</div>
        </section>
    );
}

/** What a panel shows in place of the chart while a role it reads has no field. */
export function UnmappedRoles({ roles }: { roles: string[] }) {
    return (
        <div role="status" className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            <div>
                {roles.map((r) => (
                    <p key={r}>Map a field to {r} in src/fieldMap.ts</p>
                ))}
            </div>
        </div>
    );
}

export interface WidgetCardProps {
    widget: Widget;
    /** The page filters by role; the widget sets the one its definition `selects`. */
    filters: Readonly<Record<string, Filter>>;
    active: readonly ActiveFilter[];
    options: Record<string, unknown>;
    height: number;
    controls?: Controls;
    map?: FieldMap;
}

export function WidgetCard({ widget, filters, active, options, height, controls, map = defaultMap }: WidgetCardProps) {
    const { def, Component } = widget;
    const { missing, query, result } = useWidgetData(def, map, active);
    const selects = def.selects ? filters[def.selects] : undefined;
    return (
        <Card title={def.title} subtitle={def.subtitle} height={height} testId={def.id}>
            {missing.length ? (
                <UnmappedRoles roles={missing} />
            ) : (
                <BicChartPanel result={result} query={query} minHeight={0} minChartHeight={0}>
                    {(table, size) => (
                        <Component
                            table={table}
                            rename={widget.rename}
                            {...size}
                            options={options}
                            selects={selects}
                            controls={controls}
                        />
                    )}
                </BicChartPanel>
            )}
        </Card>
    );
}
