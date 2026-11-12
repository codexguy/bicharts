// BIC generated React host for "Time series plot" - renders ./chart.js through @bicharts/chart-host.
// Regenerate with the MCP generate_chart tool rather than editing: it is rewritten with the chart.
import { useMemo } from "react";
import * as d3base from "d3";
// browserSaveFile needs the @bicharts/chart-host release with host contract 1.19.0 (hostLinkServices, 1.18.0).
import { assembleD3, browserSaveFile, hostLinkServices, type GeoPointBinding, type MarkAnnotation, type Filter, type Controls, type ViewStateProvider, type RowGrowthNotice } from "@bicharts/chart-host";
import { BicChart, BicChartGroup } from "@bicharts/chart-host/react";
// The layout pass needs @bicharts/chart-host 0.6.86 or later.
import { createLegendFitPass } from "@bicharts/chart-host/legend-fit";
import code from "./chart.js?raw";

/** The columns this chart was generated for. Each row must be keyed by these names. */
export const columns = [
  {
    "name": "MonthStart",
    "dataType": "DateTime",
    "isMeasure": false,
    "modelFormat": "yyyy-mm-dd"
  },
  {
    "name": "YearMonth",
    "dataType": "String",
    "isMeasure": false
  },
  {
    "name": "Revenue",
    "dataType": "Decimal",
    "isMeasure": true
  },
  {
    "name": "RevenueTarget",
    "dataType": "Integer",
    "isMeasure": true
  }
];

/** How the payload is built from rows: the choropleth join, and where points and a route's far end come from. */
export const binding: {
  geo: { column: string; kind: string } | null;
  point: GeoPointBinding | null;
  destination: GeoPointBinding | null;
} = {
  "geo": null,
  "point": null,
  "destination": null
};

/** The geometry the chart draws on ("" when it draws none). */
export const geoKind = "";

/** The rows this chart was generated on (null when unknown): the host compares the rows it draws with it after every render. */
const BUILT_FOR_ROWS = 84;

/**
 * This chart type's own minimum size in pixels (0: none on that side). Given less, the chart is drawn at the minimum
 * inside a box of the size it was given, which scrolls: below its minimum this chart scrolls, it never squashes. Don't
 * regenerate it smaller to fit a phone.
 */
export const minSize = {"width":460,"height":340};

// One d3 for the chart, with the plugins its code calls attached (an ES-module d3 namespace cannot be assigned onto).
const d3 = assembleD3(d3base);

// The host's legend and frame fit: it slides a legend clear of the plot and brings text that runs past the edge back
// inside, after every render. Built once - a new function on each render would rebuild the host.
const LAYOUT_PASS = createLegendFitPass();

// Where a chart's Export saves its file: a download from this page. Pass options.saveFile to save another way, or
// saveFile: undefined to offer no export. Built once, like LAYOUT_PASS.
const SAVE_FILE = browserSaveFile();

// Links and copying: a chart draws a link (a table's link column) only where it is handed openUrl, and copies through
// copyText. Here a link opens in a new tab (http(s) and mailto addresses only) and a copy goes to the browser's clipboard;
// neither is logged. Pass options.openUrl or options.copyText to do either another way, or openUrl: undefined to show
// links as text. In a sandboxed iframe the new tab needs allow-popups. Built once, like LAYOUT_PASS.
const LINKS = hostLinkServices((url) => { window.open(url, "_blank", "noopener,noreferrer"); }, typeof navigator !== "undefined" ? navigator.clipboard : undefined);

/**
 * A page filter this chart's query applies, or the part of one it applies: { filter: cell, takes: ["Region"] } when
 * the query maps only some of a pick's key columns, so the chart's scope line names those parts alone. chart-host's
 * ScopeSource, written out here so this file still builds on a chart-host from before it.
 */
export type ScopeEntry = Filter | { filter: Filter; takes?: readonly string[]; label?: string };

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

/**
 * Keeps a reader's view of this chart - an interactive table's sort, column widths and hidden columns, a 3D camera,
 * an expanded row - in this browser's localStorage under `key`, so it survives a reload. Use one key per chart on the
 * page. Without it the chart remembers only while it is mounted. For a view that follows a signed-in person to another
 * device, pass your own { load, save } as viewState instead (a bag of plain JSON, stored per user on your server).
 */
export function localViewState(key: string): ViewStateProvider {
  const k = "bic-view:" + key;
  return {
    load: () => {
      try { const v: unknown = JSON.parse(localStorage.getItem(k) ?? "{}"); return v && typeof v === "object" ? v as Record<string, unknown> : {}; }
      catch { return {}; }
    },
    // Storage full or blocked (a private window): the chart still works, it just forgets on reload.
    save: (next) => { try { localStorage.setItem(k, JSON.stringify(next)); } catch { /* see above */ } },
  };
}

export interface TimeSeriesPlotChartProps {
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
  /**
   * The page filters this chart's QUERY already applies - scopedBy={country} for filterQuery(QUERY, treatAs(country, ...)),
   * or scopedBy={[country, year]}. Its rows arrive already narrowed, so the chart can't see the filter: while one is
   * active the chart says so in its titles and comparisons ("United States only", "rank 2 of 3 (United States only)").
   * A filterBy filter counts already. Shown by the @bicharts/chart-host release with host contract 1.23.0 and later.
   * A query that maps only part of a pick takes that part: scopedBy={{ filter: cell, takes: ["Region"] }}.
   */
  scopedBy?: ScopeEntry | readonly ScopeEntry[];
  /** What a screen reader announces for the chart. Defaults to the chart type's name. */
  ariaLabel?: string;
  /** What the chart says when it has no rows to draw ("Nothing for this filter"). */
  emptyText?: string;
  /** The data lacks a column the chart is built on: called with the chart's reason instead of the chart throwing. */
  onInvalidSentinel?: (info: { reason: string; message: string }) => void;
  /**
   * Called when the rows passed are ten times (and 500 more than) the rows this chart was generated on: say it beside the
   * chart ("Generate again for this data"). Absent: chart-host says it once in the console.
   */
  onRowGrowth?: (notice: RowGrowthNotice) => void;
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
  /** Extra chart options (palette, color scale, theme colors); a restyle, never a regeneration. */
  options?: Record<string, unknown>;
  /**
   * Notes on marks: a badge on each key's mark (a small dot where the chart type asks for one), kept there through filters, re-queries, zooms and scrolls -
   * [{ column: "<a key column above>", value: "<its value>", label: "2", title: "the note" }], or a key over
   * several columns: { where: { <column>: <value>, ... } } (a route by both ends). Key by stable values from
   * the model, never a row position.
   */
  annotations?: MarkAnnotation[];
  /** A badge was clicked (the mark beneath is not selected). */
  onAnnotationClick?: (annotation: MarkAnnotation) => void;
  /**
   * Remember the reader's view across reloads in this browser under this key (see localViewState): a table's sort,
   * widths and hidden columns come back as they left them. One key per chart on the page.
   */
  rememberAs?: string;
  /** Where the reader's view is kept, when the app keeps it itself (per user, on its server); wins over rememberAs. */
  viewState?: ViewStateProvider;
}

/** Renders the chart from live data: the group builds the payload (row index, geometry columns) from the binding. */
export function TimeSeriesPlotChart({ table, rename, rows: given, width: boxWidth, height: boxHeight, onSelectRows, options, scopedBy,
  annotations, onAnnotationClick, selects, controls, filterBy, ariaLabel, emptyText, onInvalidSentinel, onRowGrowth, rememberAs, viewState }: TimeSeriesPlotChartProps) {
  // Mapped once per result: a new rows array rebuilds the chart's payload.
  const mapped = useMemo(() => given ?? (table ? rowsFromTable(table, rename) : []), [given, table, rename]);
  // keep() hands back the same array until the filter or the rows change, so filtering never churns the payload.
  const rows = filterBy ? filterBy.filter.keep(mapped, filterBy.columns) : mapped;
  // What narrowed these rows before the chart draws them: the filters the page's query applies, and filterBy's here.
  // Typed as the older chart-host's prop so the file still builds on one from before scoped entries; a scoped entry
  // itself needs the release whose scopedBy takes it.
  const scope = (filterBy ? [filterBy.filter, ...(scopedBy ? ([] as ScopeEntry[]).concat(scopedBy) : [])] : scopedBy) as Filter | Filter[] | undefined;
  // The chart reads its store when it mounts: one per key, never a new one each render.
  const store = useMemo(() => viewState ?? (rememberAs ? localViewState(rememberAs) : undefined), [viewState, rememberAs]);
  // Never drawn below the type's minimum: given less, the chart keeps its minimum and the box around it scrolls. The box
  // is always there, so crossing the minimum (a phone turned sideways) never remounts the chart and loses its view.
  const width = Math.max(boxWidth, minSize.width);
  const height = Math.max(boxHeight, minSize.height);
  const scrollsX = width > boxWidth;
  const scrollsY = height > boxHeight;
  return (
    <div style={{ width: boxWidth, height: scrollsY ? boxHeight : undefined, overflowX: scrollsX ? "auto" : "visible", overflowY: scrollsY ? "auto" : "visible" }}>
      <BicChartGroup columns={columns} rows={rows}
                     geo={binding.geo} point={binding.point} destination={binding.destination}>
        <BicChart code={code} d3={d3} geoKind={geoKind || undefined}
                  options={{ width, height, saveFile: SAVE_FILE, ...LINKS, ...(emptyText ? { noDataText: emptyText } : {}), ...options }}
                  onInvalidSentinel={onInvalidSentinel} layoutPass={LAYOUT_PASS} viewState={store}
                  builtForRows={BUILT_FOR_ROWS} onRowGrowth={onRowGrowth}
                  annotations={annotations} onAnnotationClick={onAnnotationClick}
                  selects={selects} controls={controls} ariaLabel={ariaLabel ?? "Time series plot"}
                  // A spread, so this file still builds on a chart-host from before host contract 1.23.0 (which ignores it).
                  {...(scope ? { scopedBy: scope } : {})}
                  onSelect={onSelectRows ? (idxs) => onSelectRows(idxs.map((k) => rows[k])) : undefined} />
      </BicChartGroup>
    </div>
  );
}
