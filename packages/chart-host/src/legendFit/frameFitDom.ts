/**
 * Frame fit - the labels the viewBox could not rescue.
 *
 * fitTextToFrame grows the viewBox for text that pokes a few units past the frame and
 * DEFERS text that is further out, because swallowing it would shrink the whole chart. A
 * deferred label used to stay exactly where the chart put it, sliced by the frame, and
 * a log line only counted it: a Bullet of 21 KPIs at 1230x626 reported
 * `{"rescued":8,"deferred":6,"grew":"left+68.06"}` while six KPI names still read
 * "...f Service Effort - Reduce effort".
 *
 * A label that overflows on the side its anchor does NOT hold is fitted in place: the type
 * shrinks first (see labelFitDecision - never below the 10px floor or 80% of the chart's size),
 * then the string is cut to the widest prefix that fits, never inside a number, and the full
 * text rides a <title>. A label that overflows vertically, or on the side its anchor holds, is
 * counted as unfixable and left alone. The geometry is in frameFit.ts; this is the DOM I/O,
 * with the measurement handed in so the caller's CTM mapping (viewBox, zoom) is the only one.
 */
import { labelRoom, labelFitDecision, cutToFit, planFrameFit, viewBoxAttr, Rect, ViewBox, TextAnchor, FrameFitPlan } from "./frameFit";
import { chartSvgOf } from "../snapshot";

export interface DeferredLabelFitReport {
    /** Deferred text elements looked at. */
    deferred: number;
    /** Fitted by a smaller font size alone. */
    shrunk: number;
    /** Fitted by cutting the string (after any shrink). */
    cut: number;
    /** Could not be fitted by shortening: vertical overflow, the held edge outside, rotated, tspans. */
    unfixable: number;
    /** The first few full labels that were fitted, for the log line. */
    labels: string[];
}

// The element's own attribute or inline style first (exact, and all jsdom can answer), then the
// computed style (inherited from a group in a browser), then the nearest ancestor that sets it.
function presentation(el: Element, attr: string, cssProp: string, computed: (cs: CSSStyleDeclaration) => string): string {
    const own = (e: Element) => ((e.getAttribute && e.getAttribute(attr)) || ((e as any).style && (e as any).style[cssProp]) || "").trim();
    let v = own(el);
    if (!v) {
        try { if (typeof getComputedStyle === "function") v = (computed(getComputedStyle(el)) || "").trim(); } catch { /* no layout */ }
    }
    for (let n: Element | null = el.parentElement; !v && n; n = n.parentElement) v = own(n);
    return v;
}

function anchorOf(el: Element): TextAnchor {
    const v = presentation(el, "text-anchor", "textAnchor", cs => cs.getPropertyValue("text-anchor"));
    return v === "end" ? "end" : v === "middle" ? "middle" : "start";
}

function fontSizeOf(el: Element): number {
    let raw = presentation(el, "font-size", "fontSize", cs => cs.fontSize);
    // A relative size (em, %, rem) is only answered by layout: ask the computed style for it.
    if (/(em|%)\s*$/.test(raw)) {
        try { if (typeof getComputedStyle === "function") raw = getComputedStyle(el).fontSize || raw; } catch { /* no layout */ }
    }
    const v = parseFloat(raw);
    return v > 0 && !/(em|%)\s*$/.test(raw) ? v : 10;
}

/** The text a reader sees: the element's own text nodes (a <title> child is the tooltip, not the label). */
function ownText(el: Element): string {
    let s = "";
    el.childNodes.forEach(n => { if (n.nodeType === 3) s += n.nodeValue || ""; });
    return s;
}

function setOwnText(el: Element, s: string): void {
    const texts: ChildNode[] = [];
    el.childNodes.forEach(n => { if (n.nodeType === 3) texts.push(n); });
    if (texts.length === 0) { el.insertBefore(el.ownerDocument!.createTextNode(s), el.firstChild); return; }
    texts[0].nodeValue = s;
    for (let i = 1; i < texts.length; i++) texts[i].nodeValue = "";
}

function rotated(el: Element): boolean {
    try {
        const m = (el as any).getCTM ? (el as any).getCTM() : null;
        return !!m && (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6);
    } catch { return false; }
}

/**
 * Fit ONE label, `width` wide, into `room` (both in whatever units `widthNow` measures): shrink the
 * type first (labelFitDecision - never below the 10px floor or 80% of the label's size), then cut
 * the string to the widest prefix that fits, never inside a number, with the full text riding a
 * <title>. `minChars` keeps at least that many characters before the ellipsis even when they do not
 * fit - a caller that must never REMOVE a label (the nominal axis) passes 1. Shared by the
 * frame fit and the nominal-axis cut.
 */
export function fitLabelToRoom(el: Element, width: number, room: number, widthNow: () => number,
    minChars: number = 0): "none" | "shrunk" | "cut" {
    const full = ownText(el);
    const d = labelFitDecision(width, room, fontSizeOf(el));
    if (d.action === "none") return "none";
    if (d.action === "shrink") {
        el.setAttribute("font-size", String(d.fontSize));
        if (widthNow() <= room + 0.5) return "shrunk";
    }
    let fitted = cutToFit(full, s => { setOwnText(el, s); return widthNow() <= room + 0.5; });
    const keep = full.trim();
    if (minChars > 0 && fitted.length - 1 < minChars && keep.length > minChars) {
        fitted = Array.from(keep).slice(0, minChars).join("") + "…";
    }
    setOwnText(el, fitted);
    if (!Array.from(el.children).some(c => c.tagName.toLowerCase() === "title")) {
        const t = el.ownerDocument!.createElementNS("http://www.w3.org/2000/svg", "title");
        t.textContent = full;
        el.appendChild(t);
    }
    return "cut";
}

/**
 * Fit each deferred label to `frame`. `measure` returns the element's box in the SAME user
 * space as `frame` (null when it cannot). Never throws; a label it cannot judge is unfixable.
 */
export function fitDeferredLabels(els: Element[], frame: ViewBox, measure: (el: Element) => Rect | null): DeferredLabelFitReport {
    const rep: DeferredLabelFitReport = { deferred: els.length, shrunk: 0, cut: 0, unfixable: 0, labels: [] };
    for (const el of els) {
        try {
            // A label built from tspans (a wrapped caption, a mixed-weight line) cannot be cut as
            // one string without losing its structure; a rotated one has no horizontal room.
            const kids = Array.from(el.children).filter(c => c.tagName.toLowerCase() !== "title");
            if (kids.length > 0 || rotated(el)) { rep.unfixable++; continue; }
            const box = measure(el);
            if (!box) { rep.unfixable++; continue; }
            const room = labelRoom(box, frame, anchorOf(el));
            if (room == null) { rep.unfixable++; continue; }
            const full = ownText(el);
            if (!full.trim()) continue;
            const done = fitLabelToRoom(el, box.right - box.left, room, () => { const b = measure(el); return b ? b.right - b.left : Infinity; });
            if (done === "none") continue;
            if (done === "shrunk") rep.shrunk++; else rep.cut++;
            if (rep.labels.length < 6) rep.labels.push(full.slice(0, 40));
        } catch {
            rep.unfixable++;
        }
    }
    return rep;
}

/** Perf ceiling: every text costs a getBoundingClientRect, and a Tabular can paint thousands of
 *  cells; above this the sweep costs more than the defect it fixes (and such charts scroll their
 *  own body anyway, so their overflow is intentional). */
export const FRAME_FIT_TEXT_CAP = 600;

export interface FrameFitOutcome {
    /** Set when the pass declined: too many texts to measure. */
    skipped?: { texts: number; cap: number };
    /** The viewBox plan (planFrameFit). */
    plan?: FrameFitPlan;
    /** What happened to the labels the plan deferred, when there were any. */
    labels?: DeferredLabelFitReport;
}

/**
 * THE WHOLE PASS, host-free: grow the viewBox for text a few units past the frame (planFrameFit),
 * then fit the labels it deferred (fitDeferredLabels). Null when there is nothing to measure (no
 * svg, no text, no CTM, an unreadable viewBox). A host adds its own logging around this call; it
 * is kept DOM-only so a headless replay can run exactly what a host runs.
 */
export function fitTextToFrame(host: HTMLElement): FrameFitOutcome | null {
    // The chart's own svg (the stamped one, else the first): a carousel's first svg is a peek.
    const svg = chartSvgOf(host);
    if (!svg) return null;
    const texts = svg.querySelectorAll("text");
    if (texts.length === 0) return null;
    if (texts.length > FRAME_FIT_TEXT_CAP) return { skipped: { texts: texts.length, cap: FRAME_FIT_TEXT_CAP } };

    // Client px -> USER units in one matrix (viewBox, preserveAspectRatio, container scaling AND
    // host page zoom, which a desktop host can run at 116%). Same contract
    // as legendReconcile. Built fresh on each call: the viewBox changes the matrix.
    const userMapper = () => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const inv = ctm.inverse();
        return (r: DOMRect): Rect => {
            const map = (x: number, y: number) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(inv); };
            const tl = map(r.left, r.top), br = map(r.right, r.bottom);
            return { left: Math.min(tl.x, br.x), top: Math.min(tl.y, br.y), right: Math.max(tl.x, br.x), bottom: Math.max(tl.y, br.y) };
        };
    };
    const toUser = userMapper();
    if (!toUser) return null;

    // An absent viewBox is the common case: generated code sets width/height attributes only.
    // Synthesizing the identity viewBox is visually a no-op, and gives us something to grow.
    const vbAttr = svg.getAttribute("viewBox");
    let vb: ViewBox;
    if (vbAttr) {
        const n = vbAttr.trim().split(/[\s,]+/).map(parseFloat);
        if (n.length !== 4 || n.some(v => !isFinite(v))) return null;
        vb = { x: n[0], y: n[1], w: n[2], h: n[3] };
    } else {
        const w = parseFloat(svg.getAttribute("width") || "") || host.offsetWidth;
        const h = parseFloat(svg.getAttribute("height") || "") || host.offsetHeight;
        if (!(w > 0) || !(h > 0)) return null;
        vb = { x: 0, y: 0, w, h };
    }

    // READ pass first, WRITE after - never interleave, or every rect read re-flushes layout.
    const boxes: Rect[] = [];
    const els: Element[] = [];
    for (let i = 0; i < texts.length; i++) {
        const el = texts[i];
        // Text the chart deliberately hides behind a clip (horizon bands, a scrolled row body)
        // is MEANT to be outside the frame.
        if (isClippedOrScrolled(el, svg)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue;      // hidden / empty
        boxes.push(toUser(r));
        els.push(el);
    }

    const plan = planFrameFit(boxes, vb);
    const out: FrameFitOutcome = { plan };
    let frame = vb;
    if (plan.action === "extend") {
        svg.setAttribute("viewBox", viewBoxAttr(plan.newViewBox));
        // "meet" is the default but say it: the content must SCALE to fit rather than overflow again.
        if (!svg.getAttribute("preserveAspectRatio")) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        frame = plan.newViewBox;
    }
    if (plan.deferredIdx.length > 0) {
        const after = userMapper();
        if (after) {
            out.labels = fitDeferredLabels(plan.deferredIdx.map(i => els[i]), frame, el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 || r.height > 0 ? after(r) : null;
            });
        }
    }
    return out;
}

/** True when the element sits under a clip-path/mask, inside <defs>, or inside a scrollable
 *  subtree - all cases where being outside the frame is the chart's intent rather than a
 *  text-metric miss. */
export function isClippedOrScrolled(el: Element, stopAt: Element): boolean {
    let n: Element | null = el;
    while (n && n !== stopAt.parentElement) {
        const tag = n.tagName ? n.tagName.toLowerCase() : "";
        if (tag === "defs" || tag === "clippath" || tag === "mask" || tag === "symbol") return true;
        if (n.getAttribute && (n.getAttribute("clip-path") || n.getAttribute("mask"))) return true;
        if (typeof getComputedStyle === "function") {
            try {
                const cs = getComputedStyle(n);
                if (cs.clipPath && cs.clipPath !== "none") return true;
                if (cs.overflow === "auto" || cs.overflow === "scroll"
                    || cs.overflowY === "auto" || cs.overflowY === "scroll") return true;
            } catch { /* ignore */ }
        }
        n = n.parentElement;
    }
    return false;
}
