// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useId, useMemo, useState, type KeyboardEvent } from "react";

export interface PickerOption { key: string; text: string; detail?: string }

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * A searchable list of every target a write can go to (an account, a product): the way to reach one by name from the
 * keyboard, beside a pick on a chart. Type to narrow (accents and case don't matter), arrows to move, Enter to choose.
 *   <BicTargetPicker label="Account" options={accounts.map((a) => ({ key: a.id, text: a.name }))} value={key} onChange={setKey} />
 */
export function BicTargetPicker({ label, options, value, onChange, placeholder = "Type to search", max = 50 }: {
  label: string;
  options: readonly PickerOption[];
  value: string | null;
  onChange: (key: string) => void;
  placeholder?: string;
  /** How many matches to list at once; the rest are reached by typing more. */
  max?: number;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const q = fold(query.trim());
    return q ? options.filter((o) => fold(o.text).includes(q) || fold(o.key).includes(q)) : options;
  }, [options, query]);
  const shown = matches.slice(0, max);
  const chosen = options.find((o) => o.key === value);
  const pick = (o: PickerOption) => { onChange(o.key); setQuery(""); setOpen(false); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); pick(shown[active]); }
    // Escape closes the list first, never the dialog around it (whose own Escape steps aside while the list is open).
    else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };
  return (
    <div className="flex flex-col gap-1 text-300">
      <label htmlFor={id + "-input"}>{label}</label>
      <input id={id + "-input"} role="combobox" aria-expanded={open} aria-controls={id + "-list"} aria-autocomplete="list"
             aria-activedescendant={open && shown[active] ? id + "-" + active : undefined}
             value={open ? query : chosen?.text ?? query} placeholder={placeholder}
             onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
             onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown}
             className="rounded-lg border border-border bg-card px-3 py-1.5 text-foreground" />
      {open ? (
        <ul id={id + "-list"} role="listbox" aria-label={label} className="max-h-60 overflow-auto rounded-lg border border-border bg-card">
          {shown.map((o, i) => (
            <li key={o.key} id={id + "-" + i} role="option" aria-selected={o.key === value}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                className={"cursor-pointer px-3 py-1 text-foreground" + (i === active ? " bg-accent" : "")}>
              {o.text}{o.detail ? <span className="text-muted-foreground"> · {o.detail}</span> : null}
            </li>
          ))}
          {!shown.length ? <li className="px-3 py-1 text-muted-foreground">No match</li> : null}
        </ul>
      ) : null}
      {open && matches.length > shown.length
        ? <p className="text-200 text-muted-foreground">Showing {shown.length} of {matches.length}: type more to narrow</p> : null}
    </div>
  );
}
