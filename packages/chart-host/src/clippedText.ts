// IS ANY TEXT CUT OFF BY THE FRAME? Generated code that draws a title or label above its own origin can push the glyphs
// past the edge of the SVG, where they are clipped without anything throwing, so no exec gate sees it. This reads every
// visible <text> box back against the SVG's own box and counts what sticks out. It REPORTS and never moves anything:
// the verdict feeds the proofread loop and the harness, and a host decides what to do with it.

export interface ClippedText {
    text: string;
    /** Pixels past the frame on each side (0 = inside). */
    top: number;
    left: number;
    bottom: number;
    right: number;
}

export interface ClippedTextCensus {
    /** Visible text elements measured. */
    measured: number;
    /** Those with any side more than the tolerance outside the frame, worst first, at most MAX_REPORTED. */
    clipped: ClippedText[];
    /** How many were clipped in all (can exceed clipped.length). */
    clippedCount: number;
    /** False when there was no SVG or no layout (0x0 frame): nothing was measured, and that is not a pass. */
    laidOut: boolean;
}

export const CLIP_TOLERANCE_PX = 1;
export const MAX_REPORTED = 8;

/** Counts only visible text whose box leaves the SVG's box. A host without layout (jsdom) reports laidOut false. */
export function censusClippedText(container: any): ClippedTextCensus {
    const none: ClippedTextCensus = { measured: 0, clipped: [], clippedCount: 0, laidOut: false };
    try {
        const svg = container?.querySelector?.("svg");
        if (!svg) return none;
        const f = svg.getBoundingClientRect();
        if (!f || !(f.width > 0) || !(f.height > 0)) return none;
        const view = svg.ownerDocument?.defaultView;
        const clipped: ClippedText[] = [];
        let measured = 0;
        for (const t of Array.from(svg.querySelectorAll("text")) as any[]) {
            const r = t.getBoundingClientRect();
            if (!r || !(r.width > 0) || !(r.height > 0)) continue;
            const s = view?.getComputedStyle?.(t);
            if (s && (s.display === "none" || s.visibility === "hidden" || s.opacity === "0")) continue;
            measured++;
            const top = f.top - r.top, left = f.left - r.left, bottom = r.bottom - f.bottom, right = r.right - f.right;
            if (top > CLIP_TOLERANCE_PX || left > CLIP_TOLERANCE_PX || bottom > CLIP_TOLERANCE_PX || right > CLIP_TOLERANCE_PX) {
                clipped.push({
                    text: String(t.textContent ?? "").slice(0, 40), top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round(left)),
                    bottom: Math.max(0, Math.round(bottom)), right: Math.max(0, Math.round(right)),
                });
            }
        }
        clipped.sort((a, b) => Math.max(b.top, b.left, b.bottom, b.right) - Math.max(a.top, a.left, a.bottom, a.right));
        return { measured, clipped: clipped.slice(0, MAX_REPORTED), clippedCount: clipped.length, laidOut: true };
    } catch {
        return none;
    }
}

/** A one-line verdict for a log or a report; "" when nothing is clipped or nothing could be measured. */
export function clippedTextFlag(c: ClippedTextCensus): string {
    if (!c.laidOut || c.clippedCount === 0) return "";
    const worst = c.clipped[0];
    const side = (["top", "left", "bottom", "right"] as const).reduce((a, k) => (worst[k] > worst[a] ? k : a), "top" as "top" | "left" | "bottom" | "right");
    return `${c.clippedCount} of ${c.measured} text label(s) are cut off by the frame; the worst, "${worst.text}", by ${worst[side]}px at the ${side}.`;
}
