// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useRef, useState, type ReactNode } from "react";
import { useMeasuredSize } from "@bicharts/chart-host/react";

export type QueryTable = { columns: { name: string }[]; rows: unknown[][] };

/** What useSemanticModelQuery returns (the template's hook); only these fields are read. */
export interface PanelQueryResult {
  data?: { status: "success"; table: QueryTable } | { status: "error"; error: { message: string } } | undefined;
  isLoading: boolean;
  error?: Error;
  /** Runs the query again (the template's hook has it); with it, a failed panel offers Retry. */
  refetch?: () => unknown;
}

interface BicChartPanelProps {
  result: PanelQueryResult;
  /** The query this result answers: the same string the query hook was given (after filterQuery). The panel keeps the
   *  query it last drew, and while this one differs - a filter changed it and the new rows haven't arrived - the last
   *  chart stays on screen dimmed, under "Updating...". Without it the panel can go only by isLoading, which a hook
   *  that keeps its old rows while it loads may not report. */
  query?: string;
  /** The panel's height when its cell has none (a section with no height of its own). A cell with a height - even a
   *  smaller one - keeps it: the panel fills that cell and scrolls, so it never runs over what's below it. */
  minHeight?: number;
  /** The smallest size this chart is drawn at; below it the panel scrolls rather than squash or clip the chart.
   *  A time series wants height. The width defaults to none: the panel draws the chart at its box's width. A chart type
   *  with a minimum of its own needs none either: its generated component draws it at that minimum and scrolls when the
   *  box is narrower. Set a width only for a chart that can't be read narrower and has no such minimum, and never one
   *  wider than the card is on a 360px phone (the page's and the card's padding leave about 294px there). */
  minChartWidth?: number;
  minChartHeight?: number;
  /** A page filter narrowed the query to nothing: shown as a "Clear" beside "Nothing matches" - e.g. region.clear. */
  onClearFilters?: () => void;
  /** Renders the chart once the query has rows and the panel has a size. */
  children: (table: QueryTable, size: { width: number; height: number }) => ReactNode;
}

/**
 * A chart's box: sized by the layout (put it in a cell that has a height - a grid row, h-full, a flex item with
 * min-h-0), never by the chart. The measured box is absolutely positioned inside its cell, so a drawn chart can't
 * make it taller than the card shows; when the cell is smaller than the chart's minimum, the panel scrolls. Shows
 * the query's loading, error and empty states in place of the chart. While a NEW result loads (a filter changed the
 * query), the last one stays on screen, dimmed, under "Updating...": the chart isn't unmounted, so it keeps its zoom
 * and its selection, and old figures never pass for the new selection's. A query that fails says so over the dimmed
 * chart rather than leave the last figures standing as if they were current.
 *   const query = filterQuery(QUERY, treatAs(country, "Geography[CountryIso3]"));
 *   <BicChartPanel result={useSemanticModelQuery({ connection, query })} query={query} minChartHeight={300}>
 *     {(table, size) => <MyChart table={table} {...size} options={options} />}
 *   </BicChartPanel>
 */
export function BicChartPanel({ result, query, minHeight = 360, minChartWidth = 0, minChartHeight = 240, onClearFilters, children }: BicChartPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width: boxWidth, height: boxHeight } = useMeasuredSize(ref);
  const width = Math.max(boxWidth, minChartWidth);
  const height = Math.max(boxHeight, minChartHeight);
  const { data, isLoading, error } = result;
  const failed = error?.message ?? (data?.status === "error" ? data.error.message : undefined);
  const fresh = data?.status === "success" ? data.table : undefined;
  // What the panel last drew, and the query that result answers (state set during render: React's pattern for a
  // previous value). The template's hook keeps its previous result while the next one loads, so a result on its own
  // can't say which query it answers: it counts as the current query's only when it arrives with nothing loading.
  const [last, setLast] = useState<{ data: unknown; table: QueryTable; query?: string } | undefined>(undefined);
  if (fresh && !isLoading && data !== last?.data) setLast({ data, table: fresh, query });
  const table = last?.table ?? fresh;
  // Not the current query's rows: one is loading, the query changed since they were drawn, or the new one failed.
  const changed = query !== undefined && last !== undefined && query !== last.query;
  const stale = !!table && (isLoading || changed || !!failed);
  // The template's tokens: muted text for loading and empty, destructive for a failure.
  const note = (text: string, role?: "alert") => (
    <div role={role} className={role ? "text-300 text-destructive" : "text-300 text-muted-foreground"}
         style={{ display: "grid", placeItems: "center", height: "100%" }}>{text}</div>
  );
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minWidth: 0 }}>
      {/* The fallback height, capped at 100% of the panel: in a cell with a height the cap holds it to the cell; in a
          cell with none, 100% resolves to nothing and this gives the panel its height. A min-height can't tell the two. */}
      <div aria-hidden="true" style={{ height: minHeight, maxHeight: "100%" }} />
      <div ref={ref} style={{ position: "absolute", inset: 0, overflow: "auto" }}>
        {!table && failed ? note(`The query failed: ${failed}`, "alert")
          : !table ? note("Loading...")
          : table.rows.length === 0
            ? onClearFilters
              ? <div className="text-300 text-muted-foreground" style={{ display: "grid", placeItems: "center", height: "100%" }}>
                  <span>Nothing matches the current filter. <button type="button" className="underline" onClick={onClearFilters}>Clear</button></span>
                </div>
              : note("No data for this selection.")
          : boxWidth > 0 && boxHeight > 0 && width > 0 && height > 0
            ? <div aria-busy={(stale && !failed) || undefined} style={{ opacity: stale ? 0.55 : 1, transition: "opacity 120ms" }}>
                {children(table, { width, height })}
              </div>
          : null}
        {table && failed
          ? <div role="alert" className="text-200 text-destructive bg-card" style={{ position: "absolute", top: 8, left: 8, right: 8 }}>
              The query failed: {failed}. The figures shown are from before it.
            </div>
          : stale ? <div role="status" className="text-200 text-muted-foreground" style={{ position: "absolute", top: 8, right: 8 }}>Updating...</div> : null}
        {/* A failed query offers to run again: a passing network failure shouldn't need a filter change or a reload. */}
        {failed && result.refetch
          ? <button type="button" onClick={() => { void result.refetch?.(); }}
                    className="rounded-lg border border-border bg-card px-2 py-1 text-200 text-foreground"
                    style={{ position: "absolute", bottom: 8, right: 8 }}>Retry</button>
          : null}
      </div>
    </div>
  );
}
