// A widget's rows: the live query through the template's own hook once the field map names a connector, the bundled
// sample before that. Either way the result columns are named after the roles.

import { useMemo } from "react";
import type { Filter } from "@bicharts/chart-host";
import type { FieldMap } from "@/fieldMap";
import { connectorConfigs } from "@/lib/connectors";
import { useSemanticModelQuery } from "@/hooks/use-semantic-model-query";
import type { PanelQueryResult } from "@/components/bic-chart-panel";
import { sampleTable } from "@/sample/sample-model";
import { buildDax, missingRoles, type ActiveFilter, type WidgetDef } from "./query";

/** Live when the map's connection is a connector this app declares (and the page isn't the sample preview, `npm run
 *  dev:sample`); otherwise the bundled sample. */
export const isLive = (map: FieldMap): boolean =>
    import.meta.env.MODE !== "sample" && !!map.connection && Object.prototype.hasOwnProperty.call(connectorConfigs, map.connection);

/** The page filters as the queries read them: by role, the values picked. */
export function activeFilters(filters: Readonly<Record<string, Filter>>): ActiveFilter[] {
    return Object.entries(filters)
        .filter(([, f]) => f.active)
        .map(([role, f]) => ({ role, values: f.keys.map((k) => (Array.isArray(k) ? k[0] : k)) }));
}

export interface WidgetData {
    /** Roles this widget reads that the map leaves unbound. */
    missing: string[];
    /** The query the result answers (the DAX when live, a stand-in key for the sample). */
    query: string;
    result: PanelQueryResult;
    live: boolean;
}

export function useWidgetData(def: WidgetDef, map: FieldMap, filters: readonly ActiveFilter[]): WidgetData {
    const missing = useMemo(() => missingRoles(def, map), [def, map]);
    const live = isLive(map);
    const filterKey = JSON.stringify(filters);
    const query = useMemo(
        () => (missing.length ? "" : buildDax(def, map, JSON.parse(filterKey) as ActiveFilter[])),
        [def, map, missing.length, filterKey],
    );
    const remote = useSemanticModelQuery({ connection: live ? map.connection : "", query: live ? query : "" });
    const sample = useMemo<PanelQueryResult>(() => {
        if (live || missing.length) return { isLoading: false };
        try {
            return { isLoading: false, data: { status: "success", table: sampleTable(def, JSON.parse(filterKey) as ActiveFilter[]) } };
        } catch (e) {
            return { isLoading: false, error: e instanceof Error ? e : new Error(String(e)) };
        }
    }, [def, live, missing.length, filterKey]);
    // The template's hook returns what BicChartPanel reads (it was written for it).
    const result: PanelQueryResult = live ? (remote as unknown as PanelQueryResult) : sample;
    return { missing, query: live ? query : `sample:${def.id}:${filterKey}`, result, live };
}
