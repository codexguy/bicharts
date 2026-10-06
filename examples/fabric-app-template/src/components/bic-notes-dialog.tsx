// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MarkNote } from "@/lib/bic-notes";

/**
 * A mark's notes over the page (a portal - never inside the chart's card, which would clip it), and a box to add one.
 * `onAdd` returns the save: the text is cleared only once it succeeds, and a failure is shown with the text kept.
 */
export function NotesDialog({ title, notes, onAdd, onClose }: {
  title: string;
  notes: readonly MarkNote[];
  onAdd: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onAdd(draft.trim());
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
           className="flex max-h-[80vh] w-[min(480px,92vw)] flex-col gap-3 overflow-auto rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-4">
        <h2 className="text-400 font-semibold">{title}</h2>
        {notes.length ? (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id} className="text-300">
                {n.body}
                <div className="text-200 text-muted-foreground">{n.author}, {new Date(n.createdAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-300 text-muted-foreground">No notes yet.</p>}
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={3} autoFocus
                  aria-label="New note" className="rounded-lg border border-border bg-card p-2 text-300" />
        {error ? <p role="alert" className="text-300 text-destructive">Couldn't save the note: {error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-300">Close</button>
          <button type="button" disabled={!draft.trim() || saving} onClick={save}
                  className="rounded-lg border border-border px-3 py-1.5 text-300 font-medium disabled:opacity-50">
            {saving ? "Saving..." : "Add note"}
          </button>
        </div>
      </div>
    </div>,
    document.body);
}
