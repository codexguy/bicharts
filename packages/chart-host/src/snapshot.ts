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

/**
 * Serialize an SVG element to a `data:image/svg+xml;base64,` URL, with intrinsic
 * width/height inlined on a clone so a later Image() load knows its size.
 */
export function svgToDataUrl(svg: SVGSVGElement): string {
    const cloned = svg.cloneNode(true) as SVGSVGElement;
    const w = svg.clientWidth || (svg.getBoundingClientRect && svg.getBoundingClientRect().width) || 600;
    const h = svg.clientHeight || (svg.getBoundingClientRect && svg.getBoundingClientRect().height) || 400;
    cloned.setAttribute("width", String(Math.round(w)));
    cloned.setAttribute("height", String(Math.round(h)));
    if (!cloned.getAttribute("xmlns")) cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const svgStr = new XMLSerializer().serializeToString(cloned);
    const bytes = new TextEncoder().encode(svgStr);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return "data:image/svg+xml;base64," + btoa(binary);
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
 * Capture the first <svg> under `root` (or the element itself) as a PNG data URL, falling
 * back to the SVG data URL when rasterizing is unavailable, and to null only when there is
 * genuinely nothing on the canvas to capture.
 */
export async function captureSvgSnapshot(
    root: Element | null | undefined, opts: SnapshotOptions = {},
): Promise<string | null> {
    if (!root) return null;
    const svg: SVGSVGElement | null =
        root instanceof SVGSVGElement ? root : (root.querySelector("svg") as SVGSVGElement | null);
    if (!svg) return null;
    let svgUrl: string;
    try {
        svgUrl = svgToDataUrl(svg);
    } catch (e) {
        opts.onWarn?.("snapshot-serialize", e instanceof Error ? e.message : String(e));
        return null;
    }
    const { width, height } = svgNaturalSize(svg);
    try {
        const png = await rasterizeSvgToPngDataUrl(svgUrl, width, height, opts);
        return png || svgUrl;
    } catch (e) {
        // rasterize is written not to reject; this belt catches environment exotica.
        opts.onWarn?.("snapshot-raster-unexpected", e instanceof Error ? e.message : String(e));
        return svgUrl;
    }
}
