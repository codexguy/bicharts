// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useCallback, useEffect, useState } from "react";
import { getRayfinClient } from "@/lib/rayfin-client";
import type { MarkNote } from "../../rayfin/data/MarkNote";

export type { MarkNote };

const FIELDS = ["id", "chart", "markKey", "markKeyTo", "body", "author", "createdAt"] as const;

/** Every note, newest first. Pages through: one query returns at most 100 and doesn't say there are more. */
export async function loadMarkNotes(): Promise<MarkNote[]> {
  const all: MarkNote[] = [];
  let after: string | undefined;
  do {
    const q = getRayfinClient().data.MarkNote.select([...FIELDS]).orderBy({ createdAt: "desc" }).first(100);
    const page = await (after ? q.after(after) : q).executePaginated();
    all.push(...(page.items as MarkNote[]));
    after = page.hasNextPage ? page.endCursor ?? undefined : undefined;
  } while (after);
  return all;
}

/**
 * The notes, loaded once and kept current. `add(chart, key, body)` saves one under a mark's key - [code] for one
 * mark, [from, to] for a route - and reloads; it REJECTS when the save fails, so the dialog keeps the reader's text.
 * `error` says why the notes couldn't load (before the first deploy the table doesn't exist yet).
 */
export function useMarkNotes(author: string | undefined) {
  const [notes, setNotes] = useState<MarkNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loadMarkNotes().then(
      (all) => { if (live) { setNotes(all); setError(null); setLoading(false); } },
      (e: unknown) => { if (live) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { live = false; };
  }, [tick]);
  const add = useCallback(async (chart: string, key: readonly unknown[], body: string) => {
    await getRayfinClient().data.MarkNote.create({
      chart, markKey: String(key[0] ?? ""), markKeyTo: key.length > 1 && key[1] != null ? String(key[1]) : undefined,
      body, author: author || "unknown", createdAt: new Date(),
    });
    setTick((t) => t + 1);
  }, [author]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { notes, error, loading, add, reload };
}
