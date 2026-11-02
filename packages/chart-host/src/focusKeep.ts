// WHAT THE READER WAS TYPING IN SURVIVES A REDRAW.
//
// The host clears the container before every render (a resize, a theme switch, a setOptions), so a search box the reader
// was typing in is gone by the time the chart's code runs: the chart can't put the caret back, because the element it
// would read it from no longer exists. Measured on an interactive table: type "Cert", move the caret, resize
// - the box loses focus and the next key goes nowhere. So the host notes what had focus inside the container, and
// where its caret was, before it clears, and gives focus back to the same element of the new draw afterwards.
//
// "The same element" is found by what the element IS - its tag, type, classes, name, placeholder and accessible name -
// and, among several alike, by its position. Never by id: the host scopes ids per draw.

export interface FocusMemory {
    sig: string;
    nth: number;
    start: number | null;
    end: number | null;
    dir: "forward" | "backward" | "none" | null;
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
        return { sig, nth: Math.max(0, nth), start, end, dir };
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
        const el = (list[memory.nth] ?? (list.length === 1 ? list[0] : null)) as HTMLElement | null;
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
