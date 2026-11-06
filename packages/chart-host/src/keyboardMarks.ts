// EVERY SELECTABLE MARK WORKS FROM THE KEYBOARD.
//
// Nothing in a chart took focus - no row, tile, header or badge - so a reader without a mouse couldn't pick a country,
// and a page that needs a picked country (to add an action item to it) was closed to them. The host knows which
// elements select (the marks it wires for clicks), so the host makes them reachable: one tab stop per chart (a roving
// tabindex), arrows and Home / End move it, Enter or Space selects exactly as a click does (Ctrl or Shift add), Escape
// clears. A note's badge and a control the chart declares (CONTROL_CLASS) take focus too, and Enter presses them; a
// control that only wraps other controls, buttons, boxes or a slider takes none, so what it holds is what is reached.
//
// A MARK THAT SELECTS NOTHING IS STILL READ. On a chart whose selection reaches nothing (a map, a time series or KPI
// tiles with no `selects`) the tooltip is the only way to read a mark's figures, so its marks take the same one tab stop,
// the same arrows and the same name, as an image rather than a button: no pressed state, and Enter or Space is the click
// the host already turns into nothing.
//
// BEHIND A FLAG ON EVERY PATH. The server writes KEYBOARD_STAMP at the head of a chart's code while its
// keyboard switch is on, and the host wires keys only for a stamped chart. The stamp travels with the
// code into every host (a React page, the Excel add-in, a saved chart) with nothing for a page or an agent to pass, and
// a chart generated while the switch was off stays as it was until it is regenerated.

export const KEYBOARD_STAMP = "// bic:keyboard-marks";
const STAMP_RE = /^[ \t]*\/\/[ \t]*bic:keyboard-marks\b/;
/** How many lines from the top the stamp may sit: a host writes its own header above the code (chart-mcp's is four). */
const STAMP_HEAD_LINES = 12;

/** Whether the code carries the keyboard stamp in its header. */
export function codeHasKeyboardStamp(code: unknown): boolean {
    if (typeof code !== "string" || !code) return false;
    let start = 0;
    for (let n = 0; n < STAMP_HEAD_LINES && start <= code.length; n++) {
        const end = code.indexOf("\n", start);
        const line = code.slice(start, end < 0 ? code.length : end);
        if (STAMP_RE.test(line)) return true;
        if (end < 0) break;
        start = end + 1;
    }
    return false;
}

/** On the container while its chart works from the keyboard. */
export const KEYBOARD_CLASS = "lch-keyboard";
/** On each element the host made focusable, so it never touches one the chart made focusable itself. */
export const WIRED_ATTR = "data-lch-kb";

export interface KeyboardEnv {
    container: HTMLElement;
    /** The elements a click selects (the host's click selector). */
    markSelector: string;
    /** Elements pressed with Enter: the chart's declared controls and the host's badges. */
    pressSelector: string;
    /** Elements never to treat as marks (the host's own layers). */
    skipSelector: string;
    /** True while a click on a mark selects nothing (the marks are then read as images, with no pressed state). */
    inert(): boolean;
    /** Select a mark as a click on it would. */
    select(mark: Element, mods: { ctrl: boolean; shift: boolean }): void;
    /** The reader's clear: Ctrl+Shift+C on every host (Power BI's own clear-selection key), and Escape where the host
     *  lets it (escapeClears). */
    clear(): void;
    /** Whether Escape clears. False for a host whose frame uses Escape to move focus out of the chart (Power BI), so
     *  leaving the chart never wipes the reader's selection there. Default true. */
    escapeClears?: boolean;
    isSelected(mark: Element): boolean;
    /** What a screen reader calls a mark that names nothing itself. */
    labelOf(mark: Element): string | null;
    /** A stable key for a mark across redraws (its rows). */
    keyOf(mark: Element): string;
}

export interface KeyboardHandle {
    /** Re-apply tab stops, roles, names and pressed state after a draw or a selection change. */
    refresh(): void;
    destroy(): void;
}

/** A Date from any window (a chart drawn in a frame hands over its own realm's Date). */
const isDate = (v: unknown): v is Date => Object.prototype.toString.call(v) === "[object Date]";

/** What a screen reader calls a row: its first few values, numbers and dates in the reader's culture, internal columns
 *  left out. A Date is read as the reader's date, never as its String() (weekday, time and time zone); one that names
 *  no day is skipped like a blank. Text is kept as it is. Shared so every host names a mark the same way. */
export function rowNameOf(columns: ReadonlyArray<unknown>, row: ReadonlyArray<unknown> | null | undefined,
                          culture?: string): string | null {
    if (!row) return null;
    const parts: string[] = [];
    (columns || []).forEach((c: any, i: number) => {
        const name = typeof c === "string" ? c : c?.name;
        const v = row[i];
        if (parts.length >= 4 || v == null || v === "" || (typeof name === "string" && name.startsWith("__"))) return;
        if (isDate(v)) {
            if (!Number.isNaN(v.getTime())) parts.push(v.toLocaleDateString(culture || undefined));
            return;
        }
        parts.push(typeof v === "number" ? v.toLocaleString(culture || undefined, { maximumFractionDigits: 2 }) : String(v));
    });
    return parts.length ? parts.join(", ") : null;
}

/** Ctrl+Shift+C: Power BI's own clear-selection key, taken on every host so one chord clears everywhere. */
const isClearChord = (e: KeyboardEvent) => !!e.ctrlKey && !!e.shiftKey && (e.key === "C" || e.key === "c");

const NATIVE = new Set(["input", "select", "textarea", "button", "a"]);
const isNative = (el: Element) => NATIVE.has((el.localName || "").toLowerCase()) || (el as HTMLElement).isContentEditable === true;
/** What already takes focus, or presses, on its own inside a control. */
const OWN_FOCUS = "input, select, textarea, button, a[href], [role=slider]";

/** A control the reader presses itself, not a WRAPPER around controls: a helper may put the control class on the element
 *  holding the real controls (a pager around its buttons, a slider's group around its steppers and handle). A wrapper
 *  given a tab stop is a stop that does nothing, and Enter inside one of its own buttons or boxes would press it. */
function isLeafControl(el: Element, pressSelector: string): boolean {
    try {
        return !el.querySelector(pressSelector) && !el.querySelector(OWN_FOCUS);
    } catch {
        return true;
    }
}

export function installKeyboard(env: KeyboardEnv): KeyboardHandle {
    const { container } = env;
    // The mark that holds the tab stop, by key, so a redraw (a sort, a filter) keeps it on the same row.
    let rovingKey: string | null = null;
    let destroyed = false;
    // The elements whose role the host gave (a chart's own role is never changed), so a mark can swap button for image.
    const ownRole = new WeakSet<Element>();

    const marksNow = (): HTMLElement[] =>
        Array.from(container.querySelectorAll<HTMLElement>(env.markSelector))
            .filter(m => !m.closest(env.skipSelector) && (m.getAttribute("data-row-idx") ?? "") !== "");
    const wired = (el: Element) => el.hasAttribute(WIRED_ATTR);
    const wire = (el: HTMLElement, tabindex: string, role: string) => {
        // An element the chart made focusable itself keeps its own tab stop and role.
        if (el.hasAttribute("tabindex") && !wired(el)) return false;
        el.setAttribute(WIRED_ATTR, "");
        el.setAttribute("tabindex", tabindex);
        if (!el.hasAttribute("role") || ownRole.has(el)) { el.setAttribute("role", role); ownRole.add(el); }
        return true;
    };
    const setRoving = (list: HTMLElement[], to: HTMLElement) => {
        for (const m of list) if (wired(m)) m.setAttribute("tabindex", m === to ? "0" : "-1");
        rovingKey = env.keyOf(to);
    };

    const refresh = () => {
        if (destroyed) return;
        try {
            container.classList?.add(KEYBOARD_CLASS);
            const inert = env.inert();
            const list = marksNow();
            for (const m of list) {
                if (!wire(m, "-1", inert ? "img" : "button")) continue;
                if (inert) m.removeAttribute("aria-pressed");
                else m.setAttribute("aria-pressed", env.isSelected(m) ? "true" : "false");
                if (!m.hasAttribute("aria-label") && !m.querySelector(":scope > title")) {
                    const name = env.labelOf(m);
                    if (name) m.setAttribute("aria-label", name);
                }
            }
            const own = list.filter(wired);
            if (own.length) {
                const keep = own.find(m => env.keyOf(m) === rovingKey) ?? own.find(m => env.isSelected(m)) ?? own[0];
                setRoving(own, keep);
            }
            for (const c of Array.from(container.querySelectorAll<HTMLElement>(env.pressSelector))) {
                if (isNative(c) || !isLeafControl(c, env.pressSelector)) continue;
                wire(c, "0", "button");
            }
        } catch { /* reachability is added on top of a chart that already drew; never a reason it fails */ }
    };

    const onKey = (e: KeyboardEvent) => {
        if (destroyed || e.defaultPrevented) return;
        const t = e.target as Element | null;
        if (!t || !container.contains(t)) return;
        const k = e.key;
        if (isClearChord(e)) { e.preventDefault(); env.clear(); return; }
        const press = t.closest?.(env.pressSelector) as HTMLElement | null;
        if (press && wired(press) && container.contains(press)) {
            if (k === "Enter" || k === " " || k === "Spacebar") {
                e.preventDefault();
                const ME = ((container.ownerDocument.defaultView as any)?.MouseEvent ?? MouseEvent) as typeof MouseEvent;
                press.dispatchEvent(new ME("click", { bubbles: true, cancelable: true }));
            } else if (k === "Escape" && env.escapeClears !== false && !env.inert()) env.clear();
            return;
        }
        const mark = t.closest?.(env.markSelector) as HTMLElement | null;
        if (!mark || !wired(mark) || !container.contains(mark)) return;
        const list = marksNow().filter(wired);
        const at = list.indexOf(mark);
        const go = (i: number) => {
            const to = list[Math.max(0, Math.min(list.length - 1, i))];
            if (!to) return;
            setRoving(list, to);
            try { to.focus({ preventScroll: false }); } catch { /* an element that can't take focus */ }
        };
        switch (k) {
            case "ArrowRight": case "ArrowDown": e.preventDefault(); go(at + 1); break;
            case "ArrowLeft": case "ArrowUp": e.preventDefault(); go(at - 1); break;
            case "Home": e.preventDefault(); go(0); break;
            case "End": e.preventDefault(); go(list.length - 1); break;
            case "Enter": case " ": case "Spacebar":
                e.preventDefault();
                rovingKey = env.keyOf(mark);
                env.select(mark, { ctrl: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey });
                break;
            // An inert chart's click on empty canvas clears nothing, so neither does its Escape.
            case "Escape": hideTip(); if (env.escapeClears !== false && !env.inert()) env.clear(); break;
        }
    };
    container.addEventListener("keydown", onKey);

    // A FOCUSED MARK SHOWS ITS TOOLTIP. The chart's own tooltip opens on the pointer's hover, so a sighted keyboard reader
    // who tabbed to a tile or a point saw its name read out and none of its figures. Focus on a mark the host wired plays
    // the chart's own hover path at the mark's centre (pointer and mouse over / enter / move), and blur or Escape plays the
    // leave; the chart draws and removes its tooltip exactly as for a pointer, with no change to code already generated.
    let tipOn: HTMLElement | null = null;
    const hover = (el: HTMLElement, enter: boolean) => {
        try {
            const view = container.ownerDocument.defaultView as any;
            const r = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
            const x = r ? r.left + r.width / 2 : 0, y = r ? r.top + r.height / 2 : 0;
            const ME = (view?.MouseEvent ?? MouseEvent) as typeof MouseEvent;
            const PE = view?.PointerEvent as typeof MouseEvent | undefined;
            const names = enter ? ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]
                : ["pointerout", "pointerleave", "mouseout", "mouseleave"];
            for (const n of names) {
                const E = n.startsWith("pointer") && PE ? PE : ME;
                el.dispatchEvent(new E(n, { bubbles: !/enter|leave/.test(n), cancelable: true, clientX: x, clientY: y }));
            }
        } catch { /* a mark the browser can't hover is still focused and named */ }
    };
    const hideTip = () => { const el = tipOn; tipOn = null; if (el) hover(el, false); };
    const onFocusIn = (e: FocusEvent) => {
        if (destroyed) return;
        const mark = (e.target as Element | null)?.closest?.(env.markSelector) as HTMLElement | null;
        if (!mark || !wired(mark) || !container.contains(mark) || mark === tipOn) return;
        hideTip();
        tipOn = mark;
        hover(mark, true);
    };
    const onFocusOut = (e: FocusEvent) => {
        const to = e.relatedTarget as Element | null;
        if (tipOn && (!to || !tipOn.contains(to))) hideTip();
    };
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);

    return {
        refresh,
        destroy() {
            destroyed = true;
            container.removeEventListener("keydown", onKey);
            container.removeEventListener("focusin", onFocusIn);
            container.removeEventListener("focusout", onFocusOut);
            hideTip();
            try { container.classList?.remove(KEYBOARD_CLASS); } catch { /* frozen element */ }
        },
    };
}
