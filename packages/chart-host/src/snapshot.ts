// SVG SNAPSHOT — capture what a hosted D3 chart actually painted, as a data URL.
//
// Every consumer that wants "the pixels the user is looking at" (telemetry thumbnails, the
// AI vision review, an export affordance) needs the same four steps, and each is a known
// trap when hand-rolled:
//
//   1. CLONE and inline width/height. Many charts size their <svg> via CSS only; without
//      intrinsic attributes, Image() loads the serialized SVG at 0x0 and the raster is blank.
//   2. Serialize UTF-8-SAFELY. btoa() takes latin1; axis labels and titles are routinely not.
//      Encode via TextEncoder rather than the deprecated unescape/encodeURIComponent dance.
//   3. RASTERIZE with a deadline. An SVG decode that hangs must never wedge the caller —
//      snapshots are always a side channel, never the render itself.
//   4. FALL BACK to the SVG data URL when rasterizing fails. A vector snapshot is a valid
//      snapshot; null is reserved for "there is nothing to capture".
//
// Failure is SILENT BY CONTRACT (resolve null / fall back, never throw): every caller runs
// this beside a chart that already rendered, and no diagnostic capture is worth breaking the
// thing it is capturing. Pass `onWarn` to hear about the fallbacks.
//
// TWO MORE TRAPS, found on stored thumbnails (2026-09-29):
//
//   5. AN HTML TABLE LANE HAS NO CHART SVG. A table with embedded bars is a frame of HTML rows
//      with one small <svg> PER CELL, so "the first <svg>" is one cell's bar: stored pictures of
//      201x36 showing a single bar labelled "2", from 811x552 tiles. When the chart's picture is a
//      table host (the `.lch-table-frame` the table helper builds, or a <table> that holds the
//      first svg), the FRAME is captured instead - cloned with its computed styles inlined and
//      wrapped in an SVG <foreignObject>, at the frame's own size, so the picture has the tile's
//      aspect and every row the reader could see.
//   6. A SERIALIZED SVG CARRIES NO HOST CSS. Text that inherits its font from the page renders in
//      the image's default serif. The computed font of every <text> is inlined on the clone first.
//   7. A CHART CAN MOUNT SEVERAL SVGS. A carousel draws its front face between two faces peeking at
//      each side, one <svg> each, and the first in document order is a PEEK. The chart stamps the
//      svg that is its picture (SNAPSHOT_SVG_ATTR) and chartSvgOf takes that one first.

import { SNAPSHOT_SVG_ATTR } from "./contract";

export interface SnapshotOptions {
    /**
     * Cap the raster's longest side, preserving aspect. Keeps a giant viewport from producing
     * a multi-megabyte PNG. 0 = no cap (raster at the SVG's natural size).
     */
    maxSide?: number;
    /** Deadline for the SVG decode, in ms. Past it the raster resolves null. */
    timeoutMs?: number;
    /** Diagnostic sink for the silent-failure paths. */
    onWarn?: (event: string, detail?: unknown) => void;
}

const DEFAULT_TIMEOUT_MS = 2000;
const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** UTF-8-safe base64 of a string (btoa takes latin1 only). */
function toBase64(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

/** The element's own window, so this works in an iframe, a task pane and jsdom alike. */
function viewOf(el: Element): any {
    return (el.ownerDocument && (el.ownerDocument as any).defaultView) || (globalThis as any);
}

// The most elements whose styles are inlined into one snapshot. Every one costs a
// getComputedStyle; a table of thousands of cells is still captured, the tail with the styles
// its own inline attributes carry.
const MAX_STYLED_ELEMENTS = 4000;

const TEXT_FONT_PROPS = ["font-family", "font-size", "font-weight", "font-style"];

/**
 * Copy the COMPUTED font of every <text> under `original` onto its twin under `clone`, where the
 * clone's own style does not already set it. A serialized SVG is rendered with no page CSS, so text
 * that inherited its font from the host renders in the image's default serif.
 */
function inlineTextFonts(original: Element, clone: Element): void {
    const view = viewOf(original);
    if (!view || typeof view.getComputedStyle !== "function") return;
    const src = original.querySelectorAll("text");
    const dst = clone.querySelectorAll("text");
    if (src.length !== dst.length) return;
    const n = Math.min(src.length, MAX_STYLED_ELEMENTS);
    for (let i = 0; i < n; i++) {
        let cs: CSSStyleDeclaration;
        try { cs = view.getComputedStyle(src[i]); } catch { continue; }
        const style = (dst[i] as SVGElement).style;
        if (!style) continue;
        for (const prop of TEXT_FONT_PROPS) {
            const v = cs.getPropertyValue(prop);
            if (v && !style.getPropertyValue(prop)) style.setProperty(prop, v);
        }
    }
}

/**
 * Serialize an SVG element to a `data:image/svg+xml;base64,` URL, with intrinsic
 * width/height inlined on a clone so a later Image() load knows its size, and the computed font
 * of its text inlined so the picture is not drawn in a default serif.
 */
export function svgToDataUrl(svg: SVGSVGElement): string {
    const cloned = svg.cloneNode(true) as SVGSVGElement;
    const w = svg.clientWidth || (svg.getBoundingClientRect && svg.getBoundingClientRect().width) || 600;
    const h = svg.clientHeight || (svg.getBoundingClientRect && svg.getBoundingClientRect().height) || 400;
    cloned.setAttribute("width", String(Math.round(w)));
    cloned.setAttribute("height", String(Math.round(h)));
    if (!cloned.getAttribute("xmlns")) cloned.setAttribute("xmlns", SVG_NS);
    try { inlineTextFonts(svg, cloned); } catch { /* a font is cosmetic; the capture is not */ }

    return "data:image/svg+xml;base64," + toBase64(new XMLSerializer().serializeToString(cloned));
}

/**
 * THE TABLE HOST a snapshot of `root` should capture, or null when the chart's picture is an SVG.
 *
 * A table lane draws HTML rows with a small <svg> in each cell, so its first <svg> is one cell.
 * The host is the `.lch-table-frame` the table helper builds, else a <table> - and only when the
 * first <svg> under `root` sits INSIDE it (or there is no svg at all): a chart whose first svg is
 * outside any table is an SVG chart with a table beside it, and keeps its SVG snapshot.
 *
 * Exported because the same question decides what a host measures to fit a chart to its frame: on a
 * table lane that is the frame, never a cell.
 */
export function tableHostOf(root: Element | null | undefined): HTMLElement | null {
    if (!root || typeof (root as any).querySelector !== "function") return null;
    if ((root as any).namespaceURI === SVG_NS) return null;
    const firstSvg = root.querySelector("svg");
    for (const sel of [".lch-table-frame", "table"]) {
        const host = root.querySelector(sel) as HTMLElement | null;
        if (host && (!firstSvg || host.contains(firstSvg))) return host;
    }
    return null;
}

/**
 * THE CHART'S OWN <svg> under `root`: the one stamped SNAPSHOT_SVG_ATTR, else the first.
 *
 * ONE PICKER for everything that acts on "the chart's svg" - the thumbnail here and the frame grow in
 * fitDom - because a chart with several svgs (a carousel mounts its front face between two peeks) is
 * otherwise read by whichever was appended first, and the two callers would each have to know that.
 */
export function chartSvgOf(root: Element | null | undefined): SVGSVGElement | null {
    if (!root || typeof (root as any).querySelector !== "function") return null;
    return (root.querySelector(`svg[${SNAPSHOT_SVG_ATTR}]`) ?? root.querySelector("svg")) as SVGSVGElement | null;
}

/** A length in px from an inline style value ("811px"), or 0. */
function inlinePx(v: string | null | undefined): number {
    const m = /^\s*([0-9.]+)px\s*$/.exec(v || "");
    return m ? parseFloat(m[1]) : 0;
}

/** The drawn size of an HTML element, with an inline-style and then a fixed fallback. */
export function htmlNaturalSize(el: HTMLElement): { width: number; height: number } {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const w = el.clientWidth || (r && r.width) || inlinePx(el.style && el.style.width) || 600;
    const h = el.clientHeight || (r && r.height) || inlinePx(el.style && el.style.height) || 400;
    return { width: Math.round(w), height: Math.round(h) };
}

// What an HTML element needs to look like itself with no stylesheet: box, border, colour, type,
// alignment and flex layout. Copied from the COMPUTED style, so a class the host styles and an
// inline style the chart wrote come out the same.
const HTML_STYLE_PROPS = [
    "display", "box-sizing", "width", "height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-collapse", "border-spacing",
    "background-color", "color", "opacity",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
    "text-align", "vertical-align", "white-space", "text-overflow", "text-decoration-line",
    "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
    "align-items", "justify-content",
    "position", "top", "right", "bottom", "left",
];

/** Inline the computed styles of `original`'s HTML elements onto `clone`'s, and the computed fonts
 *  of the text inside any cell svg. A scrolling box is captured as the reader saw it at the top,
 *  without a scrollbar. */
function inlineHtmlStyles(original: HTMLElement, clone: HTMLElement): void {
    const view = viewOf(original);
    if (!view || typeof view.getComputedStyle !== "function") return;
    const src = [original, ...Array.from(original.querySelectorAll("*"))];
    const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];
    if (src.length !== dst.length) return;
    let styled = 0;
    for (let i = 0; i < src.length && styled < MAX_STYLED_ELEMENTS; i++) {
        const o = src[i] as HTMLElement, c = dst[i] as HTMLElement;
        if (o.namespaceURI !== XHTML_NS || !c.style) continue;
        let cs: CSSStyleDeclaration;
        try { cs = view.getComputedStyle(o); } catch { continue; }
        for (const prop of HTML_STYLE_PROPS) {
            const v = cs.getPropertyValue(prop);
            if (v) c.style.setProperty(prop, v);
        }
        c.style.setProperty("overflow", "hidden");
        styled++;
    }
    try { inlineTextFonts(original, clone); } catch { /* cosmetic */ }
}

/**
 * Serialize an HTML element - a table lane's frame - to an SVG data URL: a clone with its computed
 * styles inlined, inside a <foreignObject> the size of the element. The picture is what the reader
 * saw: the frame's own box, from the top of its scroll.
 */
export function htmlToSvgDataUrl(el: HTMLElement): { url: string; width: number; height: number } {
    const { width, height } = htmlNaturalSize(el);
    const clone = el.cloneNode(true) as HTMLElement;
    inlineHtmlStyles(el, clone);
    clone.style.setProperty("width", `${width}px`);
    clone.style.setProperty("height", `${height}px`);
    clone.style.setProperty("margin", "0");
    let xhtml = new XMLSerializer().serializeToString(clone);
    // An XML serializer names the XHTML namespace on the root; make sure, whatever produced it.
    if (!/^<[^>]*\sxmlns=/.test(xhtml)) xhtml = xhtml.replace(/^<([a-zA-Z0-9-]+)/, `<$1 xmlns="${XHTML_NS}"`);
    const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
    return { url: "data:image/svg+xml;base64," + toBase64(svg), width, height };
}

/** The measured drawing size of an SVG, with the same fallbacks svgToDataUrl inlines. */
export function svgNaturalSize(svg: SVGSVGElement): { width: number; height: number } {
    const w = svg.clientWidth || (svg.getBoundingClientRect && svg.getBoundingClientRect().width) || 600;
    const h = svg.clientHeight || (svg.getBoundingClientRect && svg.getBoundingClientRect().height) || 400;
    return { width: Math.round(w), height: Math.round(h) };
}

/**
 * Rasterize an SVG data URL to a PNG data URL. Resolves null on any failure — decode error,
 * deadline, tainted canvas — and never rejects.
 */
export function rasterizeSvgToPngDataUrl(
    svgDataUrl: string, width: number, height: number, opts: SnapshotOptions = {},
): Promise<string | null> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
        let img: HTMLImageElement;
        try {
            img = new Image();
        } catch (e) {
            // No Image constructor in this environment (a worker, a bare DOM shim).
            opts.onWarn?.("snapshot-no-image", e instanceof Error ? e.message : String(e));
            resolve(null);
            return;
        }
        const timer = setTimeout(() => {
            opts.onWarn?.("snapshot-raster-timeout", { width, height, timeoutMs });
            resolve(null);
        }, timeoutMs);
        img.onload = () => {
            clearTimeout(timer);
            try {
                const cap = opts.maxSide && opts.maxSide > 0 ? opts.maxSide : Math.max(width, height);
                const scale = Math.min(1, cap / Math.max(width, height));
                const cw = Math.max(1, Math.round(width * scale));
                const ch = Math.max(1, Math.round(height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = cw;
                canvas.height = ch;
                const c2d = canvas.getContext("2d");
                if (!c2d) { resolve(null); return; }
                // Fill white so a transparent-background SVG does not read as black in viewers
                // (and vision models) that treat missing alpha as darkness.
                c2d.fillStyle = "white";
                c2d.fillRect(0, 0, cw, ch);
                c2d.drawImage(img, 0, 0, cw, ch);
                resolve(canvas.toDataURL("image/png"));
            } catch (e) {
                opts.onWarn?.("snapshot-raster-draw", e instanceof Error ? e.message : String(e));
                resolve(null);
            }
        };
        img.onerror = () => {
            clearTimeout(timer);
            opts.onWarn?.("snapshot-raster-decode", { width, height });
            resolve(null);
        };
        img.src = svgDataUrl;
    });
}

/**
 * Capture the chart under `root` as a PNG data URL: its table FRAME when the chart is an HTML table
 * lane (see tableHostOf), else the chart's own <svg> under `root` (chartSvgOf), or the element itself. Falls back to
 * the SVG data URL when rasterizing is unavailable, and to null only when there is genuinely nothing
 * on the canvas to capture.
 *
 * PASS THE CONTAINER, not an svg found beforehand: only the container lets this tell a table lane
 * from an SVG chart.
 */
export async function captureSvgSnapshot(
    root: Element | null | undefined, opts: SnapshotOptions = {},
): Promise<string | null> {
    if (!root) return null;
    const table = root instanceof SVGSVGElement ? null : tableHostOf(root);
    const svg: SVGSVGElement | null = table ? null
        : root instanceof SVGSVGElement ? root : chartSvgOf(root);
    if (!table && !svg) return null;
    let svgUrl: string;
    let width: number, height: number;
    try {
        if (table) {
            const r = htmlToSvgDataUrl(table);
            svgUrl = r.url; width = r.width; height = r.height;
        } else {
            svgUrl = svgToDataUrl(svg!);
            ({ width, height } = svgNaturalSize(svg!));
        }
    } catch (e) {
        opts.onWarn?.("snapshot-serialize", e instanceof Error ? e.message : String(e));
        return null;
    }
    try {
        const png = await rasterizeSvgToPngDataUrl(svgUrl, width, height, opts);
        return png || svgUrl;
    } catch (e) {
        // rasterize is written not to reject; this belt catches environment exotica.
        opts.onWarn?.("snapshot-raster-unexpected", e instanceof Error ? e.message : String(e));
        return svgUrl;
    }
}
