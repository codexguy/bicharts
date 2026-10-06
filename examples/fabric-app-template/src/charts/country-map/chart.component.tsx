// BIC generated React host for "Bivariate World Choropleth" - renders ./chart.js through @bicharts/chart-host.
// Regenerate with the MCP generate_chart tool rather than editing: it is rewritten with the chart.
import { useMemo } from "react";
import * as d3base from "d3";
import { assembleD3, type GeoPointBinding, type MarkAnnotation, type Filter, type Controls } from "@bicharts/chart-host";
import { BicChart, BicChartGroup } from "@bicharts/chart-host/react";
import code from "./chart.js?raw";

/** The columns this chart was generated for. Each row must be keyed by these names. */
export const columns = [
  {
    "name": "CountryCode",
    "dataType": "String",
    "isMeasure": false
  },
  {
    "name": "Country",
    "dataType": "String",
    "isMeasure": false
  },
  {
    "name": "RevenuePerCapita",
    "dataType": "Decimal",
    "isMeasure": true
  },
  {
    "name": "ReturnRate",
    "dataType": "Decimal",
    "isMeasure": true
  }
];

/** How the payload is built from rows: the choropleth join, and where points and a route's far end come from. */
export const binding: {
  geo: { column: string; kind: string } | null;
  point: GeoPointBinding | null;
  destination: GeoPointBinding | null;
} = {
  "geo": {
    "column": "CountryCode",
    "kind": "country-iso3"
  },
  "point": null,
  "destination": null
};

/** The geometry the chart draws on ("" when it draws none). */
export const geoKind = "country-iso3";

// One d3 for the chart, with the plugins its code calls attached (an ES-module d3 namespace cannot be assigned onto).
const d3 = assembleD3(d3base);

const key = (s: string) => s.replace(/^[^[]*\[(.+)\]$/, "$1").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Rows keyed by this chart's column names, from a query result of { columns: [{ name }], rows: [[...]] }.
 * A DAX result's "Table[Column]" and "[Measure]" headers match by the bracketed name, ignoring case, spaces and
 * punctuation, so "[Average Daily Rate]" fills AverageDailyRate with no alias. Pass `rename` for anything else.
 */
export function rowsFromTable(
  table: { columns: { name: string }[]; rows: unknown[][] },
  rename: Record<string, string> = {},
): Record<string, unknown>[] {
  const wanted = new Map(columns.map((c) => [key(c.name), c.name]));
  const target = table.columns.map((c) => rename[c.name] ?? wanted.get(key(c.name)));
  return table.rows.map((r) => {
    const o: Record<string, unknown> = {};
    target.forEach((t, k) => { if (t) o[t] = r[k]; });
    return o;
  });
}

export interface BivariateWorldChoroplethChartProps {
  /** The live query result as it arrives ({ columns, rows }); mapped with rowsFromTable. Or pass rows. */
  table?: { columns: { name: string }[]; rows: unknown[][] };
  /** Header -> column name, for any header rowsFromTable can't match by name. */
  rename?: Record<string, string>;
  /** Rows already keyed by the chart's column names, instead of table. */
  rows?: Record<string, unknown>[];
  width: number;
  height: number;
  /**
   * The page filter a click on this chart sets - from useBicFilter("<key column>") in @bicharts/chart-host/react.
   * A click sets it, the same click or empty canvas clears it, filter.clear() clears the marks too, and new data
   * keeps a pick it still draws. Read filter.value / filter.row on the page; no select handler to write.
   */
  selects?: Filter;
  /**
   * Show only the rows a page filter keeps - { filter: region, columns: ["OriginCode", "DestinationCode"] }
   * keeps a route that starts or ends in the selected region (columns default to the filter's key). Applied here,
   * after the rows are mapped, so the chart redraws only when the filter or the data changes.
   */
  filterBy?: { filter: Filter; columns?: string[] };
  /** What a screen reader announces for the chart. Defaults to the chart type's name. */
  ariaLabel?: string;
  /** What the chart says when it has no rows to draw ("Nothing for this filter"). */
  emptyText?: string;
  /** The data lacks a column the chart is built on: called with the chart's reason instead of the chart throwing. */
  onInvalidSentinel?: (info: { reason: string; message: string }) => void;
  /**
   * The chart's own controls (a What-if chart's sliders) as page state - from useBicControls(). values holds
   * every knob from the first draw, summary the chart's own label and readout; set(saved) applies a scenario.
   */
  controls?: Controls;
  /**
   * The clicked marks' source rows - read a stable key from them (an id or code), never a row position. An empty
   * list means the selection was CLEARED (the same mark clicked again, empty canvas, or new data without it): set
   * your state from exactly this, never toggle it yourself. Prefer `selects`.
   */
  onSelectRows?: (rows: Record<string, unknown>[]) => void;
  /** Extra chart options (palette, colour scale, theme colours); a restyle, never a regeneration. */
  options?: Record<string, unknown>;
  /**
   * Notes on marks: a badge on each key's mark, kept there through filters, re-queries and zooms -
   * [{ column: "<a key column above>", value: "<its value>", label: "2", title: "the note" }], or a key over
   * several columns: { where: { <column>: <value>, ... } } (a route by both ends). Key by stable values from
   * the model, never a row position.
   */
  annotations?: MarkAnnotation[];
  /** A badge was clicked (the mark beneath is not selected). */
  onAnnotationClick?: (annotation: MarkAnnotation) => void;
}

/** Renders the chart from live data: the group builds the payload (row index, geometry columns) from the binding. */
export function BivariateWorldChoroplethChart({ table, rename, rows: given, width, height, onSelectRows, options,
  annotations, onAnnotationClick, selects, controls, filterBy, ariaLabel, emptyText, onInvalidSentinel }: BivariateWorldChoroplethChartProps) {
  // Mapped once per result: a new rows array rebuilds the chart's payload.
  const mapped = useMemo(() => given ?? (table ? rowsFromTable(table, rename) : []), [given, table, rename]);
  // keep() hands back the same array until the filter or the rows change, so filtering never churns the payload.
  const rows = filterBy ? filterBy.filter.keep(mapped, filterBy.columns) : mapped;
  return (
    <BicChartGroup columns={columns} rows={rows}
                   geo={binding.geo} point={binding.point} destination={binding.destination}>
      <BicChart code={code} d3={d3} geoKind={geoKind || undefined}
                options={{ width, height, ...(emptyText ? { noDataText: emptyText } : {}), ...options }}
                onInvalidSentinel={onInvalidSentinel}
                annotations={annotations} onAnnotationClick={onAnnotationClick}
                selects={selects} controls={controls} ariaLabel={ariaLabel ?? "Bivariate World Choropleth"}
                onSelect={(idxs) => onSelectRows?.(idxs.map((k) => rows[k]))} />
    </BicChartGroup>
  );
}
