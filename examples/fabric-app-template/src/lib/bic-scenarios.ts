// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useCallback, useEffect, useState } from "react";
import type { Controls } from "@bicharts/chart-host";
import { getRayfinClient } from "@/lib/rayfin-client";
import type { SavedScenario } from "../../rayfin/data/SavedScenario";

export type { SavedScenario };

const FIELDS = ["id", "chart", "name", "comment", "values", "summary", "author", "createdAt"] as const;

async function loadAll(): Promise<SavedScenario[]> {
  const all: SavedScenario[] = [];
  let after: string | undefined;
  do {
    const q = getRayfinClient().data.SavedScenario.select([...FIELDS]).orderBy({ createdAt: "desc" }).first(100);
    const page = await (after ? q.after(after) : q).executePaginated();
    all.push(...(page.items as SavedScenario[]));
    after = page.hasNextPage ? page.endCursor ?? undefined : undefined;
  } while (after);
  return all;
}

/**
 * A chart's saved scenarios, newest first. `save(name, comment)` stores the controls' values as they stand - the
 * opening values too, before any slider has moved - with the chart's own summary; it REJECTS on failure. `apply`
 * puts a saved scenario back on the chart.
 */
export function useSavedScenarios(chart: string, controls: Controls, author: string | undefined) {
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loadAll().then(
      (all) => { if (live) { setScenarios(all.filter((s) => s.chart === chart)); setError(null); } },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [chart, tick]);
  const save = useCallback(async (name: string, comment?: string) => {
    await getRayfinClient().data.SavedScenario.create({
      chart, name, comment: comment || undefined, values: JSON.stringify(controls.values),
      summary: controls.summary, author: author || "unknown", createdAt: new Date(),
    });
    setTick((t) => t + 1);
  }, [chart, controls, author]);
  const apply = useCallback((s: SavedScenario) => {
    try { controls.set(JSON.parse(s.values) as Record<string, unknown>); } catch { /* a malformed row changes nothing */ }
  }, [controls]);
  // The saved scenario the chart shows now: its values are the controls' values (applied, or dialled in by hand).
  const now = JSON.stringify(controls.values);
  const applied = scenarios.find((s) => s.values === now) ?? null;
  return { scenarios, error, save, apply, applied };
}
