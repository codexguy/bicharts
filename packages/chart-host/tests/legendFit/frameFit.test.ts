import { describe, it, expect } from "vitest";
import {
    planFrameFit, viewBoxAttr, FRAME_PAD, MAX_EXTEND_FRACTION,
    Rect, ViewBox,
    labelRoom, labelFitDecision, cutToFit, FIT_TYPE_FLOOR
} from "../../src/legendFit/frameFit";

const VB: ViewBox = { x: 0, y: 0, w: 690, h: 340 };

function box(top: number, bottom: number, left = 10, right = 200): Rect {
    return { top, bottom, left, right };
}

describe("planFrameFit", () => {
    it("does nothing when every box is comfortably inside", () => {
        const p = planFrameFit([box(10, 24), box(300, 314)], VB);
        expect(p.action).toBe("none");
        expect(p.newViewBox).toEqual(VB);
        expect(p.rescued).toBe(0);
    });

    it("does nothing for an empty chart", () => {
        expect(planFrameFit([], VB).action).toBe("none");
        expect(planFrameFit([], VB).reason).toBe("no-text");
    });

    // THE REGRESSION. Real measurement of a Marimekko (690x340) in
    // headless Chromium: the footer caption's ink box ran 331 -> 340 in a 340-tall
    // frame. Flush with the edge, so its descenders are sliced by the host's
    // overflow:hidden. The axis title above it (318 -> 328) is fine and must not
    // move relative to anything.
    it("rescues a caption whose ink box is flush with the bottom edge", () => {
        const caption = box(331, 340, 50, 190);
        const axisTitle = box(318, 328, 200, 490);
        const p = planFrameFit([axisTitle, caption], VB);

        expect(p.action).toBe("extend");
        expect(p.bottom).toBe(FRAME_PAD);          // exactly the breathing room, no more
        expect(p.top).toBe(0);
        expect(p.left).toBe(0);
        expect(p.right).toBe(0);
        expect(p.rescued).toBe(1);                 // only the caption drove it
        expect(p.newViewBox).toEqual({ x: 0, y: 0, w: 690, h: 341 });
        expect(viewBoxAttr(p.newViewBox)).toBe("0 0 690 341");
    });

    it("rescues a caption that has already spilled past the edge", () => {
        const p = planFrameFit([box(333, 343)], VB);
        expect(p.action).toBe("extend");
        expect(p.bottom).toBe(3 + FRAME_PAD);
        expect(p.newViewBox.h).toBe(344);
    });

    it("grows only by the WORST overflow, not the sum, when several boxes spill", () => {
        const p = planFrameFit([box(333, 342), box(334, 343), box(330, 338)], VB);
        expect(p.action).toBe("extend");
        expect(p.bottom).toBe(3 + FRAME_PAD);      // driven by the 343 box alone
        // The 330->338 box ends 2 units clear of the edge, so it already has its
        // FRAME_PAD and drives nothing; only the two genuine spills count.
        expect(p.rescued).toBe(2);
    });

    it("handles every edge independently", () => {
        const p = planFrameFit([
            { top: -2, bottom: 12, left: 100, right: 200 },   // over the top
            { top: 100, bottom: 112, left: -4, right: 40 },   // over the left
            { top: 100, bottom: 112, left: 600, right: 695 }, // over the right
            { top: 330, bottom: 341, left: 50, right: 190 }   // over the bottom
        ], VB);
        expect(p.action).toBe("extend");
        expect(p.top).toBe(2 + FRAME_PAD);
        expect(p.left).toBe(4 + FRAME_PAD);
        expect(p.right).toBe(5 + FRAME_PAD);
        expect(p.bottom).toBe(1 + FRAME_PAD);
        expect(p.newViewBox).toEqual({ x: -5, y: -3, w: 690 + 5 + 6, h: 340 + 3 + 2 });
    });

    // A Tabular scrolls its own row body behind a pinned header: rows below the
    // fold are MEANT to be outside the frame. Swallowing them would shrink the
    // table to illegibility, so they must be left alone and only counted.
    it("leaves structurally-outside text alone instead of swallowing it", () => {
        const offscreenRows = [box(700, 714), box(900, 914), box(1200, 1214)];
        const p = planFrameFit(offscreenRows, VB);
        expect(p.action).toBe("defer");
        expect(p.deferred).toBe(3);
        expect(p.newViewBox).toEqual(VB);
    });

    it("still rescues a real caption while deferring the off-frame rows beside it", () => {
        const p = planFrameFit([box(331, 340), box(900, 914)], VB);
        expect(p.action).toBe("extend");
        expect(p.rescued).toBe(1);
        expect(p.deferred).toBe(1);
        expect(p.newViewBox.h).toBe(341);
    });

    it("honours the per-axis ceiling exactly", () => {
        const limit = VB.h * MAX_EXTEND_FRACTION;          // 27.2
        const justInside = box(330, VB.h + limit - FRAME_PAD - 0.1);
        const justOutside = box(330, VB.h + limit);
        expect(planFrameFit([justInside], VB).action).toBe("extend");
        expect(planFrameFit([justOutside], VB).action).toBe("defer");
    });

    it("refuses when small per-box needs ACCUMULATE past the ceiling", () => {
        // Each of these passes the per-box test on its own axis, but together
        // they would grow the height by more than the ceiling allows.
        const limit = VB.h * MAX_EXTEND_FRACTION;
        const p = planFrameFit([
            { top: -(limit - 2), bottom: 10, left: 10, right: 100 },
            { top: 300, bottom: VB.h + limit - 2, left: 10, right: 100 }
        ], VB);
        expect(p.action).toBe("defer");
        expect(p.newViewBox).toEqual(VB);
    });

    it("respects a non-zero viewBox origin", () => {
        const shifted: ViewBox = { x: -20, y: -10, w: 400, h: 200 };
        const p = planFrameFit([{ top: 100, bottom: 190, left: 0, right: 100 }], shifted);
        expect(p.action).toBe("extend");
        expect(p.bottom).toBe(FRAME_PAD);
        expect(p.newViewBox).toEqual({ x: -20, y: -10, w: 400, h: 201 });
    });

    it("is idempotent — replanning against the grown viewBox is a no-op", () => {
        const caption = box(331, 340);
        const first = planFrameFit([caption], VB);
        expect(first.action).toBe("extend");
        const second = planFrameFit([caption], first.newViewBox);
        expect(second.action).toBe("none");
        expect(second.newViewBox).toEqual(first.newViewBox);
    });

    it("ignores non-finite boxes rather than producing a NaN viewBox", () => {
        const p = planFrameFit([
            { top: NaN, bottom: 340, left: 0, right: 10 },
            box(331, 340)
        ], VB);
        expect(p.action).toBe("extend");
        expect(Number.isFinite(p.newViewBox.h)).toBe(true);
        expect(p.newViewBox.h).toBe(341);
    });

    it("refuses to plan against a degenerate viewBox", () => {
        expect(planFrameFit([box(331, 340)], { x: 0, y: 0, w: 0, h: 0 }).action).toBe("none");
        expect(planFrameFit([box(331, 340)], { x: 0, y: 0, w: 0, h: 0 }).reason).toBe("bad-viewbox");
    });
});

// THE LABELS THE VIEWBOX COULD NOT RESCUE. The plan now says WHICH boxes it deferred,
// and the pure half of the label fit decides the room a label has, whether a shrink is enough,
// and where a cut lands. A Bullet chart (21 KPIs, 1230x626) grew left 68 units and six
// end-anchored KPI names still ran off the left edge.
describe("planFrameFit - the deferred boxes are named", () => {
    it("lists the index of every deferred box, and none of the rescued ones", () => {
        const p = planFrameFit([box(331, 340), box(900, 914), box(10, 24), box(700, 714)], VB);
        expect(p.deferredIdx).toEqual([1, 3]);
        expect(p.deferred).toBe(2);
    });

    it("lists every overflowing box when the accumulated growth is refused", () => {
        const p = planFrameFit([box(-20, -8), box(345, 360)], { x: 0, y: 0, w: 690, h: 340 }, 0.05);
        expect(p.action).toBe("defer");
        expect(p.deferredIdx).toEqual([0, 1]);
    });

    it("is empty when nothing is deferred", () => {
        expect(planFrameFit([box(331, 340)], VB).deferredIdx).toEqual([]);
    });
});

describe("labelRoom - the width a label may keep", () => {
    const F: ViewBox = { x: -68, y: 0, w: 1298, h: 626 };
    it("an end-anchored y label overflowing left keeps its right edge: room runs to the frame's left", () => {
        expect(labelRoom({ left: -170, right: 228, top: 40, bottom: 54 }, F, "end")).toBe(228 - (-68 + FRAME_PAD));
    });
    it("a start-anchored label overflowing right runs to the frame's right", () => {
        expect(labelRoom({ left: 1100, right: 1300, top: 40, bottom: 54 }, F, "start")).toBe(1230 - FRAME_PAD - 1100);
    });
    it("a middle-anchored label keeps its centre", () => {
        expect(labelRoom({ left: -100, right: 100, top: 40, bottom: 54 }, F, "middle")).toBe(2 * (0 - (-68 + FRAME_PAD)));
    });
    it("no shortening fits a label overflowing vertically, or on the side its anchor holds", () => {
        expect(labelRoom({ left: 10, right: 100, top: 620, bottom: 640 }, F, "start")).toBeNull();
        expect(labelRoom({ left: -170, right: 228, top: 40, bottom: 54 }, F, "start")).toBeNull();
        expect(labelRoom({ left: 1100, right: 1300, top: 40, bottom: 54 }, F, "end")).toBeNull();
    });
});

describe("labelFitDecision - shrink before cutting, within the floor", () => {
    it("leaves a label that fits", () => {
        expect(labelFitDecision(90, 100, 12).action).toBe("none");
    });
    it("shrinks when the full label fits at no less than 80% of its size and the type floor", () => {
        const d = labelFitDecision(110, 100, 13);
        expect(d.action).toBe("shrink");
        expect(d.fontSize).toBeLessThan(13);
        expect(d.fontSize).toBeGreaterThanOrEqual(Math.max(FIT_TYPE_FLOOR, 13 * 0.8));
    });
    it("cuts when the shrink would go under the floor", () => {
        expect(labelFitDecision(300, 100, 13).action).toBe("cut");
        expect(labelFitDecision(110, 100, 10).action).toBe("cut");   // already at the floor
    });
});

describe("cutToFit - the widest prefix, never inside a number", () => {
    const fitsAt = (n: number) => (s: string) => s.length <= n;
    it("keeps the widest prefix plus the ellipsis", () => {
        expect(cutToFit("Customer Service Effort", fitsAt(12))).toBe("Customer Se…");
    });
    it("returns a label that fits whole", () => {
        expect(cutToFit("Churn", fitsAt(12))).toBe("Churn");
    });
    it("moves a cut inside a number to before the number", () => {
        expect(cutToFit("largest 128 of 400", fitsAt(11))).toBe("largest…");
    });
    it("is empty when nothing fits", () => {
        expect(cutToFit("Customer", fitsAt(1))).toBe("");
    });
});
