// A SMALL LAYOUT ENGINE FOR JSDOM, shared by the legend-reconcile and frame-fit characterization files.
//
// jsdom has no layout, but the reconcile passes and the frame fit measure with the browser's own
// answers: getBoundingClientRect on each element, getScreenCTM on the <svg> (and on a mark, for the
// colorbar's ink probe), DOMPoint / createSVGPoint to carry a client box back into user space. This
// module answers those from the elements' own attributes, the way legendSignatureFurniture.test.ts
// stubs getBoundingClientRect (a rect's x/y/width/height, a line's endpoints, a text at 0.6 em per
// character by its text-anchor), and adds the two things a pass that MOVES things needs to be honest:
//
//   - translate() on an element and on every ancestor up to the <svg> moves its box, so a legend slid
//     by `translate(dx,dy) <prior>` is measured at its new place on the next pass;
//   - the <svg>'s CTM follows its viewBox and preserveAspectRatio="xMidYMid meet" inside the rendered
//     size (its width / height attributes), at a client origin placeSvg() can offset, so widening the
//     viewBox rescales every client box exactly as it does in a browser and the passes' user-space
//     maths is exercised, not bypassed.
//
// Honest for what is pinned here - which elements move, what the viewBox becomes, what is hidden or
// cut - and not for the browser's font metrics. These cases reach the passes only through their public modules.

export const SVG_NS = "http://www.w3.org/2000/svg";

export interface Box { left: number; top: number; right: number; bottom: number }
interface Matrix { a: number; b: number; c: number; d: number; e: number; f: number; inverse(): Matrix }

/** A DOMPoint that transforms the way the platform's does; jsdom has none. */
export class Point {
    constructor(public x = 0, public y = 0) {}
    matrixTransform(m: Matrix): Point {
        return new Point(m.a * this.x + m.c * this.y + m.e, m.b * this.x + m.d * this.y + m.f);
    }
}

function matrix(a: number, b: number, c: number, d: number, e: number, f: number): Matrix {
    return {
        a, b, c, d, e, f,
        inverse(): Matrix {
            const det = a * d - b * c;
            return matrix(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det);
        },
    };
}

const origins = new WeakMap<Element, { left: number; top: number }>();
const sizes = new WeakMap<Element, { w: number; h: number }>();
const withheld = new WeakSet<Element>();

/** Put the <svg>'s top-left at this client position (default 0,0). */
export function placeSvg(svg: Element, left: number, top: number): void { origins.set(svg, { left, top }); }
/** The rendered size of an <svg> that carries no width / height attributes. */
export function sizeSvg(svg: Element, w: number, h: number): void { sizes.set(svg, { w, h }); }
/** Make svg.getScreenCTM() answer null, as a detached or display:none <svg> does. */
export function withholdCtm(svg: Element): void { withheld.add(svg); }

const lower = (el: Element): string => (el.tagName || "").toLowerCase();
const num = (el: Element, attr: string): number => { const v = parseFloat(el.getAttribute(attr) || ""); return isFinite(v) ? v : 0; };
const NOT_RENDERED = new Set(["defs", "clippath", "mask", "symbol", "lineargradient", "radialgradient", "style", "title", "desc"]);

function renderedSize(svg: Element): { w: number; h: number } {
    const o = sizes.get(svg);
    if (o) return o;
    return { w: num(svg, "width"), h: num(svg, "height") };
}

function viewBoxOf(svg: Element): { x: number; y: number; w: number; h: number } {
    const attr = svg.getAttribute("viewBox");
    if (attr) {
        const p = attr.trim().split(/[\s,]+/).map(Number);
        if (p.length === 4 && p.every(isFinite)) return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
    const s = renderedSize(svg);
    return { x: 0, y: 0, w: s.w, h: s.h };
}

/** user -> client for the <svg>: its viewBox meeting its rendered size, centred (xMidYMid meet). */
function svgMatrix(svg: Element): Matrix {
    const o = origins.get(svg) || { left: 0, top: 0 };
    const s = renderedSize(svg);
    const vb = viewBoxOf(svg);
    if (!(s.w > 0) || !(s.h > 0) || !(vb.w > 0) || !(vb.h > 0)) return matrix(1, 0, 0, 1, o.left, o.top);
    const k = Math.min(s.w / vb.w, s.h / vb.h);
    return matrix(k, 0, 0, k, o.left + (s.w - vb.w * k) / 2 - vb.x * k, o.top + (s.h - vb.h * k) / 2 - vb.y * k);
}

/** The sum of every translate() in a transform list; other functions are not modelled. */
function translateOf(el: Element): { x: number; y: number } {
    const t = el.getAttribute("transform") || "";
    let x = 0, y = 0;
    for (const m of t.matchAll(/translate\(\s*(-?[\d.]+(?:e-?\d+)?)(?:[\s,]+(-?[\d.]+(?:e-?\d+)?))?\s*\)/g)) {
        x += parseFloat(m[1]);
        y += m[2] !== undefined ? parseFloat(m[2]) : 0;
    }
    return { x, y };
}

function inherited(el: Element, attr: string, cssProp: string): string {
    for (let n: Element | null = el; n; n = n.parentElement) {
        const v = (n.getAttribute(attr) || ((n as any).style && (n as any).style[cssProp]) || "").trim();
        if (v) return v;
    }
    return "";
}

function labelText(el: Element): string {
    let s = "";
    el.childNodes.forEach(n => {
        if (n.nodeType === 3) s += n.nodeValue || "";
        else if (n.nodeType === 1 && lower(n as Element) !== "title") s += labelText(n as Element);
    });
    return s;
}

function pairsOf(s: string): Box | null {
    const n = (s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(parseFloat);
    if (n.length < 2) return null;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (let i = 0; i + 1 < n.length; i += 2) {
        l = Math.min(l, n[i]); r = Math.max(r, n[i]);
        t = Math.min(t, n[i + 1]); b = Math.max(b, n[i + 1]);
    }
    return { left: l, top: t, right: r, bottom: b };
}

const shift = (b: Box, dx: number, dy: number): Box => ({ left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy });

function hiddenOwn(el: Element): boolean {
    return NOT_RENDERED.has(lower(el)) || (el.getAttribute("display") || (el as any).style?.display) === "none";
}

/** The element's box in its OWN coordinate system (before its own transform), or null if it paints nothing. */
function localBox(el: Element): Box | null {
    const over = el.getAttribute("data-box");
    if (over) {
        const p = over.split(",").map(parseFloat);
        return { left: p[0], top: p[1], right: p[2], bottom: p[3] };
    }
    switch (lower(el)) {
        case "rect": case "image": case "foreignobject": {
            const x = num(el, "x"), y = num(el, "y");
            return { left: x, top: y, right: x + num(el, "width"), bottom: y + num(el, "height") };
        }
        case "line": {
            const x1 = num(el, "x1"), x2 = num(el, "x2"), y1 = num(el, "y1"), y2 = num(el, "y2");
            // A stroke has thickness the bare geometry lacks; half a unit each way is the stand-in.
            return { left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2) - 0.5, bottom: Math.max(y1, y2) + 0.5 };
        }
        case "circle": {
            const cx = num(el, "cx"), cy = num(el, "cy"), r = num(el, "r");
            return { left: cx - r, right: cx + r, top: cy - r, bottom: cy + r };
        }
        case "ellipse": {
            const cx = num(el, "cx"), cy = num(el, "cy");
            return { left: cx - num(el, "rx"), right: cx + num(el, "rx"), top: cy - num(el, "ry"), bottom: cy + num(el, "ry") };
        }
        case "path": return pairsOf(el.getAttribute("d") || "");
        case "polygon": case "polyline": return pairsOf(el.getAttribute("points") || "");
        case "text": {
            const s = labelText(el);
            if (!s) return null;
            const fs = parseFloat(inherited(el, "font-size", "fontSize")) || 10;
            const w = s.length * fs * 0.6;
            const anchor = inherited(el, "text-anchor", "textAnchor");
            const x = num(el, "x"), y = num(el, "y");
            const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
            return { left, right: left + w, top: y - fs * 0.8, bottom: y + fs * 0.2 };
        }
        case "g": case "a": case "svg": {
            let u: Box | null = null;
            for (const ch of Array.from(el.children)) {
                if (hiddenOwn(ch)) continue;
                const cb = localBox(ch);
                if (!cb) continue;
                const t = translateOf(ch);
                const b = shift(cb, t.x, t.y);
                u = u ? { left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) } : b;
            }
            return u;
        }
        default: return null;
    }
}

/** The element's box in the <svg>'s USER space, or null when it is not rendered. */
export function userBox(el: Element): Box | null {
    const svg = el.closest("svg");
    if (!svg || el === svg) return null;
    for (let n: Element | null = el; n && n !== svg; n = n.parentElement) if (hiddenOwn(n)) return null;
    let b = localBox(el);
    if (!b) return null;
    for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
        const t = translateOf(n);
        b = shift(b, t.x, t.y);
    }
    return b;
}

function clientRect(el: Element) {
    const mk = (l: number, t: number, r: number, b: number) =>
        ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t, toJSON: () => ({}) });
    const svg = el.closest("svg");
    if (!svg) return mk(0, 0, 0, 0);
    if (el === svg) {
        const o = origins.get(svg) || { left: 0, top: 0 };
        const s = renderedSize(svg);
        return mk(o.left, o.top, o.left + s.w, o.top + s.h);
    }
    const u = userBox(el);
    if (!u) return mk(0, 0, 0, 0);
    const m = svgMatrix(svg);
    const a = new Point(u.left, u.top).matrixTransform(m), b = new Point(u.right, u.bottom).matrixTransform(m);
    return mk(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
}

function screenCtm(this: Element): Matrix | null {
    const svg = this.closest("svg");
    if (!svg || withheld.has(svg)) return null;
    const base = svgMatrix(svg);
    let tx = 0, ty = 0;
    for (let n: Element | null = this; n && n !== svg; n = n.parentElement) {
        const t = translateOf(n);
        tx += t.x; ty += t.y;
    }
    return matrix(base.a, 0, 0, base.d, base.e + base.a * tx, base.f + base.d * ty);
}

function define(proto: object, name: string, fn: unknown): void {
    Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
}

/** Install the layout on jsdom's prototypes. Call from beforeEach: the stubs are cheap and idempotent. */
export function installSvgLayout(): void {
    (globalThis as any).DOMPoint = Point;
    const protos: object[] = [Element.prototype];
    if (typeof (globalThis as any).SVGSVGElement !== "undefined") protos.push((globalThis as any).SVGSVGElement.prototype);
    for (const p of protos) {
        define(p, "getBoundingClientRect", function (this: Element) { return clientRect(this); });
        define(p, "getScreenCTM", screenCtm);
        define(p, "createSVGPoint", () => new Point());
    }
}

/** Create an element in the SVG namespace under `parent`. Numbers and strings both go in as attributes. */
export function el(parent: Element, tag: string, attrs: Record<string, string | number> = {}, text?: string): Element {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    parent.appendChild(e);
    return e;
}

/** An <svg> of the given rendered size, in the document. A viewBox is optional: generated code often has none. */
export function makeSvg(w: number, h: number, viewBox?: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    if (viewBox) svg.setAttribute("viewBox", viewBox);
    document.body.appendChild(svg);
    return svg;
}

/** The viewBox attribute as four numbers, or null when the <svg> has none. */
export function viewBoxNumbers(svg: Element): number[] | null {
    const a = svg.getAttribute("viewBox");
    return a ? a.trim().split(/[\s,]+/).map(Number) : null;
}

/** The text a reader sees: the element's own text nodes, never its <title> tooltip. */
export function shownText(e: Element): string {
    let s = "";
    e.childNodes.forEach(n => { if (n.nodeType === 3) s += n.nodeValue || ""; });
    return s;
}
