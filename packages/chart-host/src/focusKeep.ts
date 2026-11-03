// WHAT THE READER WAS TYPING IN SURVIVES A REDRAW.
//
// The host clears the container before every render (a resize, a theme switch, a setOptions), so a search box the reader
// was typing in is gone by the time the chart's code runs: the chart can't put the caret back, because the element it
// would read it from no longer exists. Measured on an interactive table: type "Cert", move the caret, resize
// - the box loses focus and the next key goes nowhere. So the host notes what had focus inside the container, and
// where its caret was, before it clears, and gives focus back to the same element of the new draw afterwards.
//
// "The same element" is found by what the element IS - its tag, type, classes, name, placeholder and accessible name -
// and, among several alike, by its row (a mark's data-row-idx, so a sort that moved the row keeps focus on it) or else
// its position. Never by id: the host scopes ids per draw.

export interface FocusMemory {
    sig: string;
    nth: number;
    start: number | null;
    end: number | null;
    dir: "forward" | "backward" | "none" | null;
    /** The focused element's data-row-idx, when it carries one: the row it stands for, wherever a redraw puts it. */
    row?: string;
}

function signatureOf(el: Element): string {
    const a = (n: string) => el.getAttribute(n) ?? "";
    const cls = Array.from(el.classList ?? []).filter(c => !/^lch-|^bic-/.test(c)).sort().join(" ");
    return [el.localName, a("type"), cls, a("name"), a("placeholder"), a("aria-label"), a("role")].join("|");
}

function alike(container: Element, sig: string): Element[] {
    const tag = sig.split("|", 1)[0];
    if (!tag) return [];
    return Array.from(container.querySelectorAll(tag)).filter(e => signatureOf(e) === sig);
}

/** The focused element inside the container and its caret, or null when focus is elsewhere (or on the container). */
export function rememberFocus(container: HTMLElement): FocusMemory | null {
    try {
        const active = container.ownerDocument?.activeElement;
        if (!active || active === container || !container.contains(active)) return null;
        const sig = signatureOf(active);
        const nth = alike(container, sig).indexOf(active);
        const t = active as HTMLInputElement;
        let start: number | null = null, end: number | null = null, dir: FocusMemory["dir"] = null;
        try {
            if (typeof t.selectionStart === "number") { start = t.selectionStart; end = t.selectionEnd; dir = t.selectionDirection ?? null; }
        } catch { /* an input type with no caret (a checkbox, a range) */ }
        const out: FocusMemory = { sig, nth: Math.max(0, nth), start, end, dir };
        const row = active.getAttribute("data-row-idx");
        if (row != null && row !== "") out.row = row;
        return out;
    } catch { return null; }
}

/** Give focus back to the same element of the new draw, with its caret. Nothing when the chart already moved focus into
 *  itself, or when the new draw has no such element. Returns whether focus was restored. */
export function restoreFocus(container: HTMLElement, memory: FocusMemory | null): boolean {
    if (!memory) return false;
    try {
        const active = container.ownerDocument?.activeElement;
        if (active && active !== container && container.contains(active)) return false;   // the chart put it somewhere itself
        const list = alike(container, memory.sig);
        const sameRow = memory.row != null ? list.find(e => e.getAttribute("data-row-idx") === memory.row) : undefined;
        const el = (sameRow ?? list[memory.nth] ?? (list.length === 1 ? list[0] : null)) as HTMLElement | null;
        if (!el || typeof el.focus !== "function") return false;
        el.focus({ preventScroll: true });
        const t = el as HTMLInputElement;
        if (memory.start != null && typeof t.setSelectionRange === "function") {
            const len = typeof t.value === "string" ? t.value.length : 0;
            try {
                t.setSelectionRange(Math.min(memory.start, len), Math.min(memory.end ?? memory.start, len), memory.dir ?? undefined);
            } catch { /* an input type with no caret */ }
        }
        return container.ownerDocument?.activeElement === el;
    } catch { return false; }
}

// FOCUS ACROSS A CHART'S OWN REDRAW. The host's render() notes focus before its own clear, but a chart that redraws
// itself (a table re-sorting on a header press calls its own render(), which replaces every node) removes the focused
// element before the host hears of it: by the time a MutationObserver runs, focus has already fallen to the page body.
// So the host keeps a standing note of what has focus in the chart, taken as focus arrives, and the observer asks it
// what a redraw took.

export interface FocusTracker {
    /** What had focus, when a redraw has since removed it and focus fell to nothing (the page body); null when the
     *  element is still there, focus went somewhere else, or nothing in the chart had focus. Consumed by the call. */
    takeLost(): FocusMemory | null;
    /** Drop the note (the host's own render remembers and restores focus itself). */
    forget(): void;
    dispose(): void;
}

export function trackFocus(container: HTMLElement): FocusTracker {
    let el: Element | null = null;
    let memory: FocusMemory | null = null;
    let disposed = false;
    const doc = container.ownerDocument;
    const view = doc?.defaultView;
    const forget = () => { el = null; memory = null; };
    const note = () => {
        if (disposed) return;
        const m = rememberFocus(container);
        el = m ? doc?.activeElement ?? null : null;
        memory = m;
    };
    const onIn = () => note();
    // Focus that LEAVES for something outside the chart is the reader's move: forget it. A focusout with no related
    // target is either a removal (some browsers fire one) or a click on nothing; once the event has settled, an element
    // still in the page that no longer has focus was left by the reader, and one gone from the page is the redraw's.
    const onOut = (e: Event) => {
        const to = (e as FocusEvent).relatedTarget as Node | null;
        if (to) { if (!container.contains(to)) forget(); return; }
        const was = el;
        try {
            view?.setTimeout(() => {
                if (disposed || el !== was || !was || !was.isConnected) return;
                const active = doc?.activeElement;
                if (!active || !container.contains(active)) forget();
            }, 0);
        } catch { /* a page with no timers keeps the note; the next focusin replaces it */ }
    };
    container.addEventListener("focusin", onIn);
    container.addEventListener("focusout", onOut);
    note();
    return {
        takeLost() {
            if (disposed || !el || !memory || el.isConnected) return null;
            const active = doc?.activeElement;
            const fell = !active || active === doc?.body || active === doc?.documentElement || active === container;
            if (!fell) {
                if (!container.contains(active)) forget();   // the reader is elsewhere: never pull focus back
                return null;
            }
            const out: FocusMemory = { ...memory };
            const t = el as HTMLInputElement;
            try {   // the caret as the reader left it, read off the removed element (it keeps its value and selection)
                if (typeof t.selectionStart === "number") { out.start = t.selectionStart; out.end = t.selectionEnd; out.dir = t.selectionDirection ?? null; }
            } catch { /* an input type with no caret */ }
            forget();
            return out;
        },
        forget,
        dispose() {
            disposed = true;
            forget();
            container.removeEventListener("focusin", onIn);
            container.removeEventListener("focusout", onOut);
        },
    };
}
