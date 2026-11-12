// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Hold the keyboard inside an open dialog: focus moves into it (unless something in it already has focus, as an
 * autoFocus field does), Tab and Shift+Tab go round its own controls, Escape calls onEscape, and the returned cleanup
 * gives focus back to `returnTo` - by default whatever had it when this was called. The dialog element takes
 * tabIndex={-1}, so it can hold focus itself when it has nothing focusable.
 */
export function holdFocus(dialog: HTMLElement | null, onEscape?: () => void, returnTo?: Element | null): () => void {
  if (!dialog) return () => {};
  const doc = dialog.ownerDocument;
  const back = (returnTo === undefined ? doc.activeElement : returnTo) as HTMLElement | null;
  // What the opener IS, so its replacement can be found when a repaint rebuilt it while the dialog was open (a save
  // that redraws a chart's badges): the same tag, classes, role and name - or, when its name changed with the save (a
  // badge's count), the same tag, classes and role at the same place among its look-alikes.
  const sig = (el: Element, named = true) => [el.localName, el.getAttribute("role") ?? "", named ? el.getAttribute("aria-label") ?? "" : "",
    Array.from(el.classList).filter((c) => !/^lch-|-(selected|active|focus)/.test(c)).sort().join(" ")].join("|");
  const alike = (s: string, named: boolean) => Array.from(doc.body.querySelectorAll(s.split("|", 1)[0] || "*"))
    .filter((el) => sig(el, named) === s);
  const opener = back && back !== doc.body ? back : null;
  const backSig = opener ? sig(opener) : "", looseSig = opener ? sig(opener, false) : "";
  const backAt = opener ? alike(backSig, true).indexOf(opener) : -1, looseAt = opener ? alike(looseSig, false).indexOf(opener) : -1;
  const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!dialog.contains(doc.activeElement)) (focusables()[0] ?? dialog).focus();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // A control inside the dialog closes its own list first (an open combobox, a select): its Escape isn't the dialog's.
      const t = e.target as Element | null;
      if (t?.closest?.('[aria-expanded="true"], select, [role="listbox"]')) return;
      e.stopPropagation();
      // What the reader typed is never thrown away unasked: with unsaved text in a field, Escape asks first.
      if (hasTyped(dialog) && !confirmDiscard(doc)) return;
      onEscape?.();
      return;
    }
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) { e.preventDefault(); dialog.focus(); return; }
    const at = doc.activeElement, first = f[0], last = f[f.length - 1];
    if (!dialog.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (at === first || at === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  doc.addEventListener("keydown", onKey, true);
  return () => {
    doc.removeEventListener("keydown", onKey, true);
    if (back && back.isConnected && typeof back.focus === "function") { back.focus(); return; }
    if (!opener) return;
    const same = alike(backSig, true), loose = alike(looseSig, false);
    const again = (same[backAt] ?? (same.length === 1 ? same[0] : null) ?? loose[looseAt] ?? null) as HTMLElement | null;
    if (again && typeof again.focus === "function") again.focus();
  };
}

type Field = HTMLInputElement | HTMLTextAreaElement;
const TEXT_FIELDS = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"]';
const fieldsOf = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<Field>(TEXT_FIELDS));

/** What watchDraft knows of an open dialog: what each field started from, which ones the reader changed, and what they held at a submit. */
const drafts = new WeakMap<HTMLElement, { from: WeakMap<Field, string>; edited: WeakSet<Field>; submitted: Map<Field, string> | null }>();

// A field the reader hasn't changed starts from whatever it holds now (the app filled it, or a list loaded into it). After a
// submit, the app changing a field the reader didn't touch since (`except` is the one they're typing in) is a save that
// cleared the form: from then on, what every field holds is where it starts.
function settle(dialog: HTMLElement, except?: EventTarget | null): void {
  const d = drafts.get(dialog);
  if (!d) return;
  const fields = fieldsOf(dialog), at = d.submitted;
  if (at && fields.some((f) => f !== except && at.has(f) && at.get(f) !== f.value)) { d.edited = new WeakSet(); d.submitted = null; }
  for (const f of fields) if (f !== except && !d.edited.has(f)) d.from.set(f, f.value);
}

/**
 * Remember what a dialog's text fields hold as it opens, so hasTyped counts only what the reader typed: a field the app
 * filled (a picker opened on the chart's pick, a form opened on a saved row, a default adopted when its data arrived)
 * isn't typed text until the reader changes it, and a field that appears later starts from what it holds then. A save
 * through the dialog's <form onSubmit> that clears the form and keeps the dialog open makes what the fields then hold the
 * new start, so a country the reader chose before it no longer holds the backdrop; a failed save that keeps the text
 * keeps it counted. useDialogFocus calls this; the returned cleanup stops it.
 */
export function watchDraft(dialog: HTMLElement | null): () => void {
  if (!dialog) return () => {};
  const d = { from: new WeakMap<Field, string>(), edited: new WeakSet<Field>(), submitted: null as Map<Field, string> | null };
  drafts.set(dialog, d);
  settle(dialog);
  const onInput = (e: Event) => {
    settle(dialog, e.target);
    d.submitted = null;
    const t = e.target as Element | null;
    if (t?.matches?.(TEXT_FIELDS)) d.edited.add(t as Field);
  };
  const onSubmit = () => { settle(dialog); d.submitted = new Map(fieldsOf(dialog).map((f) => [f, f.value])); };
  const Watch = dialog.ownerDocument.defaultView?.MutationObserver;
  const seen = Watch ? new Watch(() => settle(dialog)) : null;
  seen?.observe(dialog, { subtree: true, childList: true, characterData: true, attributes: true });
  dialog.addEventListener("input", onInput, true);
  dialog.addEventListener("submit", onSubmit, true);
  return () => {
    seen?.disconnect();
    dialog.removeEventListener("input", onInput, true);
    dialog.removeEventListener("submit", onSubmit, true);
    if (drafts.get(dialog) === d) drafts.delete(dialog);
  };
}

/**
 * Does any text field in the dialog hold something the reader typed? Typed means the reader changed the field and it now
 * holds text (not blank) that differs from what it held when the dialog opened, or since its last save (watchDraft). A
 * dialog nothing watched counts any text a field holds.
 */
export function hasTyped(dialog: HTMLElement): boolean {
  const d = drafts.get(dialog);
  if (d) settle(dialog);
  return fieldsOf(dialog).some((f) => !f.readOnly && !f.disabled && f.value.trim() !== ""
    && (!d || (d.edited.has(f) && f.value.trim() !== (d.from.get(f) ?? "").trim())));
}

/** Ask before discarding typed text. A host that can't show the question (a sandbox blocking confirm) keeps the dialog open. */
export function confirmDiscard(doc: Document): boolean {
  try { return !!doc.defaultView?.confirm("Discard what you've typed?"); } catch { return false; }
}

/**
 * A dialog's backdrop: a press on it closes the dialog only when nothing has been typed, so a stray click never discards
 * a draft:  <div className="fixed inset-0 ..." onMouseDown={(e) => closeFromBackdrop(e, box.current, onClose)}>
 */
export function closeFromBackdrop(e: { target: unknown; currentTarget: unknown }, dialog: HTMLElement | null, onClose: () => void): void {
  if (e.target !== e.currentTarget) return;
  if (dialog && hasTyped(dialog)) return;
  onClose();
}

/**
 * holdFocus for a dialog component, from mount to unmount:
 *   const box = useRef<HTMLDivElement>(null);
 *   useDialogFocus(box, onClose);
 *   <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>...</div>
 * onClose may be a new function on every render: the latest one is called, and focus isn't moved again. What had focus
 * is read on the first render, before an autoFocus field inside the dialog takes it, and gets it back on close. What
 * the fields hold as it opens is remembered (watchDraft), so Escape and the backdrop treat only the reader's changes as typed.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose?: () => void): void {
  const [opener] = useState<Element | null>(() => (typeof document === "undefined" ? null : document.activeElement));
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => watchDraft(ref.current), [ref]);
  useEffect(() => holdFocus(ref.current, () => close.current?.(), opener), [ref, opener]);
}
