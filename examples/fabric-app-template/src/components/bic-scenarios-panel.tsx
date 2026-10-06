// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useState } from "react";
import type { Controls } from "@bicharts/chart-host";
import { useSavedScenarios } from "@/lib/bic-scenarios";

/**
 * Save the chart's current control setting under a name, and put a saved one back. Goes below its chart (a chart
 * with in-chart controls keeps its card's full width). Save works from the first draw - no slider has to move - and
 * a failed save keeps what was typed and says why.
 */
export function ScenariosPanel({ chart, controls, author }: { chart: string; controls: Controls; author?: string }) {
  const { scenarios, error, save, apply, applied } = useSavedScenarios(chart, controls, author);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await save(name.trim(), comment.trim());
      setName("");
      setComment("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-300">
          Scenario name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
                 className="rounded-lg border border-border bg-card px-3 py-1.5" />
        </label>
        <label className="flex min-w-0 flex-[2] flex-col gap-1 text-300">
          Comment (optional)
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000}
                 className="rounded-lg border border-border bg-card px-3 py-1.5" />
        </label>
        <button type="button" disabled={!name.trim() || !controls.ready || saving} onClick={onSave}
                className="rounded-lg border border-border px-3 py-1.5 text-300 font-medium disabled:opacity-50">
          {saving ? "Saving..." : "Save scenario"}
        </button>
      </div>
      <p className="text-200 text-muted-foreground">
        Now: {controls.summary || "..."}{applied ? <> - <span className="font-medium">{applied.name}</span> applied</> : null}
      </p>
      {saveError ? <p role="alert" className="text-300 text-destructive">Couldn't save: {saveError}</p> : null}
      {error ? <p role="alert" className="text-300 text-muted-foreground">Saved scenarios couldn't load: {error}</p> : null}
      {scenarios.length ? (
        <ul className="flex flex-col gap-2">
          {scenarios.map((s) => (
            <li key={s.id} aria-current={s.id === applied?.id || undefined}
                className={"flex items-center justify-between gap-2 rounded-lg px-2 text-300" + (s.id === applied?.id ? " bg-accent" : "")}>
              <span className="min-w-0">
                <span className="font-medium">{s.name}</span> - {s.summary}
                {s.comment ? <span className="text-muted-foreground"> - {s.comment}</span> : null}
              </span>
              <button type="button" onClick={() => apply(s)} disabled={s.id === applied?.id}
                      className="rounded-lg border border-border px-2 py-1 text-200 disabled:opacity-50">
                {s.id === applied?.id ? "Applied" : "Apply"}
              </button>
            </li>
          ))}
        </ul>
      ) : !error ? <p className="text-300 text-muted-foreground">No saved scenarios yet.</p> : null}
    </div>
  );
}
