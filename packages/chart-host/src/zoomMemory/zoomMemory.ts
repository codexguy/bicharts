// REMEMBER ZOOM / PAN - the pure half. Published, with the DOM half, as "@bicharts/chart-host/zoom-memory".
//
// Two behaviors, deliberately separated because they are not the same feature:
//
//   (a) SURVIVE RE-RENDER, always on. A host re-renders on a resize and on every cross-filter, so without
//       this, clicking a bubble to filter throws away the zoom the reader just set. That reads as a bug,
//       not a preference, so no host switch turns it off.
//   (b) SURVIVE CLOSE AND REOPEN, behind the host's own preference. This one rides whatever the host
//       saves (a report file, a workbook), so everyone who opens it lands on the zoom it was saved with.
//       That IS a preference, which is why the host asks for it (ZoomMemoryHost.rememberAcrossSessions).
//
// WHY THIS LIVES IN THE HOST AND NOT IN A ZOOM HELPER. The obvious home is the generated chart's zoom
// helper, which owns the zoom behavior, the viewport selection and the extents. But shared helpers are
// PREPENDED INTO THE GENERATED CODE when it is generated, not injected at render time, so every
// already-generated chart carries a FROZEN COPY of the helper, and a change to it reaches new generations
// only. Putting the memory in the helper would ship a switch that does nothing on every saved chart until
// it is regenerated.
//
// So the host does it, through the one thing every d3-zoom chart has in common regardless of which helper
// version (or hand-rolled zoom) built it: d3-zoom stores its current transform on the DOM node as
// `node.__zoom`. That is not a private detail being reverse-engineered - it is the documented storage
// `d3.zoomTransform(node)` reads. Keying off it means this works on charts generated before the feature
// existed, on charts that never called the helper, and on any future helper, without a regeneration and
// without the generator having to cooperate.

/** A d3-zoom transform, reduced to the three numbers that define it. */
export interface ZoomTransform {
    k: number;
    x: number;
    y: number;
}

/** What gets persisted: the transform plus what it was captured against. */
export interface ZoomState extends ZoomTransform {
    /** Identity of the chart + viewport this transform is meaningful for. */
    key: string;
}

/** Identity is not identity across a resize (see viewportBucket) or a regeneration. */
export function zoomStateKey(codeHash: string | number, width: number, height: number): string {
    return `${codeHash}:${viewportBucket(width)}x${viewportBucket(height)}`;
}

/** Round a dimension so ordinary 1-2px reflow jitter does not discard a good transform,
 *  while a real resize (which changes the fitted frame the transform was chosen against)
 *  does. 32px is a bucket the reader cannot hit by accident and cannot miss on purpose. */
export function viewportBucket(px: number): number {
    if (!isFiniteNumber(px) || px <= 0) return 0;
    return Math.round(px / 32);
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && isFinite(v);
}

/** A transform we are willing to APPLY.
 *
 *  A PERSISTED TRANSFORM IS UNTRUSTED: it round-trips through a saved file that a person can hand-edit,
 *  and it was captured against a geometry that may no longer exist. The floor here is only "these are
 *  three real numbers and the scale is not nonsense".
 *
 *  NOTE ON WHO CLAMPS. `zoom.transform` does NOT constrain - d3-zoom applies `constrain()` in its
 *  wheel/drag/touch handlers and then assigns the result, but the programmatic `zoom.transform` path sets
 *  `__zoom` to exactly what it is given. So the host must clamp before applying, and it does it with the
 *  BEHAVIOR'S OWN accessors (scaleExtent(), extent(), translateExtent(), constrain()) rather than
 *  re-deriving the limits here - see constrainToBehavior in zoomMemoryDom.ts. That keeps one source of
 *  truth: the chart that built the zoom owns what a legal view is, and the host only asks it. */
export function isUsableTransform(t: unknown): t is ZoomTransform {
    if (!t || typeof t !== "object") return false;
    const c = t as ZoomTransform;
    if (!isFiniteNumber(c.k) || !isFiniteNumber(c.x) || !isFiniteNumber(c.y)) return false;
    // k <= 0 inverts or collapses the chart; an absurd k is either corruption or a hand-edit.
    // The real ceiling is the behavior's own scaleExtent; this only rejects the insane.
    if (c.k <= 0 || c.k > 1e6) return false;
    // A translation larger than any plausible viewport is corruption, not a pan.
    if (Math.abs(c.x) > 1e7 || Math.abs(c.y) > 1e7) return false;
    return true;
}

/** k=1 with no offset is the identity - the state a chart is already in after a fresh
 *  render. Storing or restoring it is pure noise, and persisting it would write to the
 *  saved file every time somebody zoomed out again. */
export function isIdentity(t: ZoomTransform): boolean {
    return t.k === 1 && t.x === 0 && t.y === 0;
}

/** Sub-pixel differences are re-render noise, not the reader's intent. Without this, restoring a
 *  transform would itself look like a change and write straight back - a persist loop. */
export function transformsDiffer(a: ZoomTransform | null, b: ZoomTransform | null): boolean {
    if (!a || !b) return a !== b;
    return Math.abs(a.k - b.k) > 1e-6
        || Math.abs(a.x - b.x) > 0.5
        || Math.abs(a.y - b.y) > 0.5;
}

export function serializeZoomState(t: ZoomTransform, key: string): string {
    // Rounded on the way out: a transform is a screen position, and full float precision
    // just makes the persisted blob bigger and noisier to diff.
    return JSON.stringify({
        k: Math.round(t.k * 1e4) / 1e4,
        x: Math.round(t.x * 100) / 100,
        y: Math.round(t.y * 100) / 100,
        key
    });
}

/** Never throws. A blob that will not parse is treated as absent, which is the same
 *  outcome as never having saved one. */
export function parseZoomState(raw: string | null | undefined): ZoomState | null {
    if (!raw || typeof raw !== "string") return null;
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!isUsableTransform(parsed)) return null;
    // isUsableTransform narrows to ZoomTransform, which has no `key` - read it off the raw
    // parse, where it is still `any`.
    const key = typeof (parsed as any).key === "string" ? (parsed as any).key as string : "";
    if (!key) return null;
    return { k: parsed.k, x: parsed.x, y: parsed.y, key };
}

/** A remembered transform is only meaningful for the chart + viewport that produced it.
 *  A regeneration changes the code hash; a real resize changes the viewport bucket. Either
 *  way the old transform describes a frame that no longer exists, and the honest thing is
 *  to open at identity rather than somewhere arbitrary. */
export function isZoomStateUsable(state: ZoomState | null, currentKey: string): boolean {
    return !!state && !!currentKey && state.key === currentKey && isUsableTransform(state);
}

/** Read d3-zoom's stored transform off a node, defensively.
 *  `node.__zoom` is a d3 ZoomTransform instance; only its three numbers are wanted. */
export function readNodeTransform(node: any): ZoomTransform | null {
    if (!node) return null;
    const z = node.__zoom;
    if (!z) return null;
    const t = { k: z.k, x: z.x, y: z.y };
    return isUsableTransform(t) ? t : null;
}

/** Every element under `root` (inclusive) that d3-zoom has attached to.
 *
 *  Nearly always exactly one - the map's pan-catcher rect or the SVG itself. More than one
 *  means a composite chart with independently zoomable panels; those are deliberately NOT
 *  remembered, because pairing several transforms to several panels across a re-render
 *  needs an identity there is none of, and restoring them to the WRONG panels would be worse
 *  than not restoring at all. */
export function findZoomedNodes(root: Element | null): Element[] {
    if (!root) return [];
    const out: Element[] = [];
    if ((root as any).__zoom) out.push(root);
    let all: ArrayLike<Element>;
    try { all = root.querySelectorAll("*"); } catch { return out; }
    for (let i = 0; i < all.length; i++) {
        if ((all[i] as any).__zoom) out.push(all[i]);
    }
    return out;
}

/** The single zoomed node worth remembering, or null. See findZoomedNodes on why >1 opts out. */
export function soleZoomedNode(root: Element | null): Element | null {
    const nodes = findZoomedNodes(root);
    return nodes.length === 1 ? nodes[0] : null;
}
