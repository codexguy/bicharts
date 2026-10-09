/**
 * Frame fit — pure geometry.
 *
 * The third measured sibling of the label-contrast and legend-reconcile passes.
 * Generated code routinely parks a footer/source caption against the
 * RAW svg edge — `svg.append('text').attr('y', height - 2)` — instead of reserving
 * a band for it inside `margin.bottom`. That looks right in the code and is wrong
 * on screen: a baseline is not an ink box. A glyph descends roughly 0.27 * fontSize
 * BELOW its baseline, so a 2px gap at font-size 7.5 puts the tails of "g", "p", "y"
 * exactly on (or past) the frame, and `.lch-d3ctr` is `overflow:hidden` — the host
 * silently slices them. Measured live on a Marimekko (690x340): the
 * caption's ink box ran 331->340 in a 340-tall frame, i.e. flush, tails gone.
 *
 * Corpus: 41 D3 generations across ~20 chart types park text within 5 user units of
 * the frame, so this is a RENDERER-level habit, not one chart's bug.
 *
 * WHY EXTEND THE VIEWBOX RATHER THAN MOVE THE TEXT: nudging a glyph back inside
 * can shove it into whatever sits above it — in that Marimekko the axis title's ink
 * ends 12 units above the caption, so a blind 6-unit lift would collide the two
 * and trade a clipped line for an overlapping one. Growing the viewBox instead
 * makes the SVG scale to fit its container: nothing moves relative to anything
 * else, nothing is clipped, and a 2-unit grow on a 340-unit frame is a 0.6%
 * rescale nobody can see. This is exactly the remedy the legend-reconcile pass already
 * uses for a legend that runs off the right edge.
 *
 * Coordinates: EVERYTHING here is in the SVG's USER space (== viewBox units). The
 * caller maps measured client-px boxes through `svg.getScreenCTM().inverse()`
 * first, which captures viewBox, preserveAspectRatio, container scaling AND host
 * page zoom in one matrix — so this module needs no px<->unit factor. Same
 * contract as legendReconcile; the box and viewBox types are shared with it.
 *
 * DOM-free so it can be unit-tested on plain numbers; the DOM I/O lives in
 * frameFitDom.fitTextToFrame.
 */
import type { Rect, ViewBox } from "./legendReconcile";
export type { Rect, ViewBox };

export interface FrameFitPlan {
    action: "none" | "extend" | "defer";
    top: number;         // user units to add ABOVE the viewBox
    right: number;       // ... to the right
    bottom: number;      // ... below
    left: number;        // ... to the left
    newViewBox: ViewBox; // the viewBox to set (== input when action is not "extend")
    considered: number;  // boxes measured
    rescued: number;     // boxes that drove an extension
    deferred: number;    // boxes too far out to be a metric miss (left alone by the viewBox)
    deferredIdx: number[]; // WHICH boxes were deferred, by index into the input - the label fit's population
    reason: string;
}

// Breathing room, in user units, left between a glyph's ink box and the frame.
// A box that lands EXACTLY on the edge (overflow 0) is already clipped in
// practice — antialiasing and the host's fractional page zoom (a host at 116%
// showed it on the Marimekko above) round it over the line. So "flush"
// must still trigger a grow, which is what adding PAD before the test achieves.
export const FRAME_PAD = 1;

// Beyond this fraction of the frame, an overflow is NOT a text-metric miss —
// it's a layout that genuinely doesn't fit (a Tabular's scrolled-away rows, a
// chart drawing off-canvas on purpose behind a clip). Growing the viewBox to
// swallow it would shrink the real chart to nothing, so those boxes are counted
// and left exactly where the chart put them.
export const MAX_EXTEND_FRACTION = 0.08;

/**
 * Work out how much the viewBox must grow so every measured ink box sits inside
 * the frame with FRAME_PAD to spare.
 *
 * @param boxes  ink boxes in USER space (see module note on the CTM mapping)
 * @param vb     the SVG's current viewBox in user units
 * @param maxFraction  per-axis extension ceiling, as a fraction of the frame
 */
export function planFrameFit(
    boxes: Rect[],
    vb: ViewBox,
    maxFraction: number = MAX_EXTEND_FRACTION
): FrameFitPlan {
    const deferredIdx: number[] = [];
    const rescuedIdx: number[] = [];
    const none = (reason: string, considered: number, deferred: number, idx: number[] = deferredIdx): FrameFitPlan => ({
        action: deferred > 0 && considered > 0 ? "defer" : "none",
        top: 0, right: 0, bottom: 0, left: 0,
        newViewBox: vb, considered, rescued: 0, deferred, deferredIdx: idx.slice().sort((a, b) => a - b), reason
    });

    if (!boxes || boxes.length === 0) return none("no-text", 0, 0);
    if (!vb || !(vb.w > 0) || !(vb.h > 0)) return none("bad-viewbox", boxes.length, 0);

    const maxH = vb.w * maxFraction;
    const maxV = vb.h * maxFraction;
    const vbRight = vb.x + vb.w;
    const vbBottom = vb.y + vb.h;

    let top = 0, right = 0, bottom = 0, left = 0;
    let rescued = 0, deferred = 0;

    for (let bi = 0; bi < boxes.length; bi++) {
        const b = boxes[bi];
        if (!b || !isFinite(b.left) || !isFinite(b.top) || !isFinite(b.right) || !isFinite(b.bottom)) {
            continue;
        }
        // How far past each edge this box reaches, PAD already granted. A value
        // <= 0 means the box is comfortably inside on that side.
        const needTop = (vb.y - b.top) + FRAME_PAD;
        const needLeft = (vb.x - b.left) + FRAME_PAD;
        const needRight = (b.right - vbRight) + FRAME_PAD;
        const needBottom = (b.bottom - vbBottom) + FRAME_PAD;

        const worstV = Math.max(needTop, needBottom);
        const worstH = Math.max(needLeft, needRight);
        if (worstV <= 0 && worstH <= 0) continue;          // fully inside

        // Structurally outside on either axis: not ours to fix.
        if (worstV > maxV || worstH > maxH) { deferred++; deferredIdx.push(bi); continue; }

        let drove = false;
        if (needTop > 0) { top = Math.max(top, needTop); drove = true; }
        if (needLeft > 0) { left = Math.max(left, needLeft); drove = true; }
        if (needRight > 0) { right = Math.max(right, needRight); drove = true; }
        if (needBottom > 0) { bottom = Math.max(bottom, needBottom); drove = true; }
        if (drove) { rescued++; rescuedIdx.push(bi); }
    }

    if (rescued === 0) {
        return none(deferred > 0 ? "all-overflow-structural" : "all-inside", boxes.length, deferred);
    }

    // Re-clamp the ACCUMULATED growth: several small per-box needs on the same
    // axis can sum past the ceiling even though each one passed individually.
    if (top + bottom > maxV || left + right > maxH) {
        return none("accumulated-overflow-structural", boxes.length, deferred + rescued, deferredIdx.concat(rescuedIdx));
    }

    const parts: string[] = [];
    if (top > 0) parts.push("top+" + round2(top));
    if (right > 0) parts.push("right+" + round2(right));
    if (bottom > 0) parts.push("bottom+" + round2(bottom));
    if (left > 0) parts.push("left+" + round2(left));

    return {
        action: "extend",
        top: round2(top), right: round2(right), bottom: round2(bottom), left: round2(left),
        newViewBox: {
            x: round2(vb.x - left),
            y: round2(vb.y - top),
            w: round2(vb.w + left + right),
            h: round2(vb.h + top + bottom)
        },
        considered: boxes.length,
        rescued,
        deferred,
        deferredIdx: deferredIdx.slice(),
        reason: parts.join(",")
    };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/** Serialize a viewBox the way the SVG attribute wants it. */
export function viewBoxAttr(vb: ViewBox): string {
    return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}

/*
 * THE LABELS THE VIEWBOX COULD NOT RESCUE ARE FITTED, NOT LEFT CUT.
 *
 * A deferred box is one the frame cannot swallow without shrinking the chart, and it
 * used to stay exactly where the chart put it - sliced by the frame. On a Bullet
 * of 21 KPIs at 1230x626 the viewBox grew 68 units to the left, eight names came back,
 * and six still read "...f Service Effort - Reduce effort". A label that runs off the frame
 * on the side its anchor does NOT hold can be fitted in place: an end-anchored y label keeps
 * its right edge, so a shorter string pulls its left edge back inside. The fit SHRINKS the
 * type first (never below the 10px floor, never below 80% of what the chart chose) and CUTS
 * the rest, keeping the full text in a <title>. A box that overflows vertically, or on the
 * side its anchor holds, cannot be fitted by shortening, and is only counted.
 */
export type TextAnchor = "start" | "middle" | "end";

/** The minimum readable type, px. */
export const FIT_TYPE_FLOOR = 10;
/** A shrink never goes below this fraction of the chart's own size: past it, cut instead. */
export const FIT_SHRINK_FLOOR = 0.8;

/**
 * The width, in user units, a label may keep so that its box sits inside `frame` (with
 * FRAME_PAD), given the edge its anchor holds - or null when no shortening can fit it
 * (it overflows vertically, or its held edge is itself outside the frame).
 */
export function labelRoom(box: Rect, frame: ViewBox, anchor: TextAnchor): number | null {
    if (!box || !frame || ![box.left, box.right, box.top, box.bottom].every(isFinite)) return null;
    const fl = frame.x + FRAME_PAD, fr = frame.x + frame.w - FRAME_PAD;
    const ft = frame.y, fb = frame.y + frame.h;
    if (box.top < ft - FRAME_PAD || box.bottom > fb + FRAME_PAD) return null;
    let room: number;
    if (anchor === "end") {
        if (box.right > fr) return null;
        room = box.right - fl;
    } else if (anchor === "start") {
        if (box.left < fl) return null;
        room = fr - box.left;
    } else {
        const c = (box.left + box.right) / 2;
        if (c < fl || c > fr) return null;
        room = 2 * Math.min(c - fl, fr - c);
    }
    return room > 0 ? round2(room) : null;
}

export interface LabelFitDecision {
    action: "none" | "shrink" | "cut";
    fontSize: number;   // the size to set (the original when cutting)
}

/**
 * Shrink or cut: a label `width` units wide at `fontSize` px that must fit `room` units.
 * Width scales with the font size, so the first guess is exact to within hinting; the caller
 * re-measures after a shrink and falls through to the cut if hinting disagreed.
 */
export function labelFitDecision(width: number, room: number, fontSize: number): LabelFitDecision {
    if (!(width > 0) || !(room > 0) || !(fontSize > 0) || width <= room) return { action: "none", fontSize };
    const floor = Math.min(fontSize, Math.max(FIT_TYPE_FLOOR, fontSize * FIT_SHRINK_FLOOR));
    const want = Math.floor((fontSize * room / width) * 2) / 2;
    if (want >= floor && want < fontSize) return { action: "shrink", fontSize: want };
    return { action: "cut", fontSize };
}

/**
 * The widest prefix of `full` (plus the ellipsis) that `fits`, never cut inside a number:
 * a cut between two digits moves back to before the number ("largest 12..." of
 * "largest 128 of 400" states a different count). Empty when nothing fits.
 */
export function cutToFit(full: string, fits: (s: string) => boolean, ell: string = "…"): string {
    if (fits(full)) return full;
    let lo = 0, hi = full.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (fits(full.slice(0, mid) + ell)) lo = mid; else hi = mid - 1;
    }
    const digit = (i: number) => i >= 0 && i < full.length && /[0-9]/.test(full.charAt(i));
    const sep = (i: number) => i >= 0 && i < full.length && /[.,]/.test(full.charAt(i));
    const splits = digit(lo - 1) ? (digit(lo) || (sep(lo) && digit(lo + 1))) : (sep(lo - 1) && digit(lo - 2) && digit(lo));
    if (lo > 0 && splits) {
        while (lo > 0 && (digit(lo - 1) || (sep(lo - 1) && digit(lo - 2)))) lo--;
        while (lo > 0 && /[\s+\-$]/.test(full.charAt(lo - 1))) lo--;
    }
    while (lo > 0 && /\s/.test(full.charAt(lo - 1))) lo--;
    return lo > 0 ? full.slice(0, lo) + ell : "";
}
