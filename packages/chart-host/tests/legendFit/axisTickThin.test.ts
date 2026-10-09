import { describe, it, expect } from "vitest";
import {
    planAxisTickThin,
    AXIS_THIN_MIN_TICKS,
    AXIS_THIN_GAP,
    LABEL_ROW_MIN_TEXTS,
    isNumericLabelText,
    groupLabelRows,
    labelRowHasTrack,
    Rect,
} from "../../src/legendFit/legendReconcile";

// Boxes are the tick labels of ONE horizontal axis. The DOM half measures them
// with getBoundingClientRect and never calls this for a vertical axis, so every
// case here is a row of labels laid out left to right.
const label = (left: number, width: number): Rect => ({ left, right: left + width, top: 0, bottom: 10 });

/** n labels of `width`, their left edges `pitch` apart. */
const axis = (n: number, pitch: number, width: number): Rect[] =>
    Array.from({ length: n }, (_, i) => label(i * pitch, width));

const visible = (boxes: Rect[], plan: { hide: number[] }): number => boxes.length - plan.hide.length;

describe("planAxisTickThin", () => {
    it("leaves an axis alone when nothing collides", () => {
        const plan = planAxisTickThin(axis(8, 40, 30));
        expect(plan.reason).toBe("no-overlap");
        expect(plan.stride).toBe(1);
        expect(plan.hide).toEqual([]);
    });

    it("hides every other label when a stride of 2 clears it", () => {
        // 12 monthly ticks, 26px apart, each "Jan 2026" ~45px wide - a narrow
        // right-hand tile. One in two survives and 45 < 52 - GAP, so it clears.
        const plan = planAxisTickThin(axis(12, 26, 45));
        expect(plan.reason).toBe("stride");
        expect(plan.stride).toBe(2);
        expect(plan.hide).toEqual([1, 3, 5, 7, 9, 11]);
        expect(visible(axis(12, 26, 45), plan)).toBe(6);
    });

    it("keeps widening the stride until the survivors clear", () => {
        // 45px labels only 13px apart need one in four, not one in two.
        const plan = planAxisTickThin(axis(12, 13, 45));
        expect(plan.stride).toBe(4);
        expect(plan.hide).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11]);
    });

    it("always keeps the first label", () => {
        const plan = planAxisTickThin(axis(12, 13, 45));
        expect(plan.hide).not.toContain(0);
    });

    it("falls back to the two ends when no regular stride clears", () => {
        // Very wide labels: even one in six still collides, but the two ends do not.
        const boxes = axis(8, 10, 60);
        const plan = planAxisTickThin(boxes);
        expect(plan.reason).toBe("ends-only");
        expect(plan.stride).toBe(0);
        expect(plan.hide).toEqual([1, 2, 3, 4, 5, 6]);
        expect(visible(boxes, plan)).toBe(2);
    });

    it("hides NOTHING when even the two ends collide - an axis with one label says less than an ugly one", () => {
        const boxes = axis(6, 4, 400);
        const plan = planAxisTickThin(boxes);
        expect(plan.reason).toBe("unfixable");
        expect(plan.hide).toEqual([]);
    });

    it("does not thin an axis below the minimum tick count", () => {
        const boxes = axis(AXIS_THIN_MIN_TICKS - 1, 10, 60);
        const plan = planAxisTickThin(boxes);
        expect(plan.reason).toBe("too-few");
        expect(plan.hide).toEqual([]);
    });

    it("indexes hide against the INPUT order, not the sorted order", () => {
        // The DOM hands over document order, which a chart may emit right to left.
        const ordered = axis(12, 26, 45);
        const reversed = ordered.slice().reverse();
        const plan = planAxisTickThin(reversed);
        expect(plan.stride).toBe(2);
        // Reversed input: sorted index i is input index 11 - i, so the odd sorted
        // positions that get hidden are the EVEN input positions.
        expect(plan.hide).toEqual([0, 2, 4, 6, 8, 10]);
    });

    it("counts the gap as part of the collision", () => {
        // Labels that touch exactly: clean without a gap, colliding with one.
        const touching = axis(8, 30, 30);
        expect(planAxisTickThin(touching, 0).reason).toBe("no-overlap");
        expect(planAxisTickThin(touching, AXIS_THIN_GAP).reason).toBe("stride");
    });

    it("is stable - planning the surviving labels again changes nothing", () => {
        const boxes = axis(12, 26, 45);
        const first = planAxisTickThin(boxes);
        const survivors = boxes.filter((_, i) => !first.hide.includes(i));
        expect(planAxisTickThin(survivors).reason).toBe("no-overlap");
    });

    it("handles an empty axis without throwing", () => {
        expect(planAxisTickThin([]).hide).toEqual([]);
    });
});

// The same planner over a row of labels a generation placed by hand. The
// geometry below is a choropleth colorbar, measured in Segoe UI at the rendered 10px:
// three labels on a 120px bar at x = 0 (start), 48 (middle), 120 (end).
describe("planAxisTickThin - a hand-placed label row", () => {
    const box = (left: number, right: number): Rect => ({ left, right, top: 0, bottom: 10 });
    const colorbarRow = [box(0, 32), box(32, 64), box(81, 120)];   // 210,000 | 378,000 | 4,820,000

    it("three colorbar labels that abut keep both ends and lose the middle", () => {
        const plan = planAxisTickThin(colorbarRow, AXIS_THIN_GAP, LABEL_ROW_MIN_TEXTS);
        expect(plan.reason).toBe("ends-only");
        expect(plan.hide).toEqual([1]);
        expect(plan.stride).toBe(0);
    });

    it("touching at exactly 0.0px IS a collision - the gap is the whole defect", () => {
        expect(planAxisTickThin(colorbarRow, 0, LABEL_ROW_MIN_TEXTS).reason).toBe("no-overlap");
        expect(planAxisTickThin(colorbarRow, AXIS_THIN_GAP, LABEL_ROW_MIN_TEXTS).reason).toBe("ends-only");
    });

    it("three labels that clear are left alone", () => {
        const clear = [box(0, 32), box(44, 76), box(88, 120)];
        expect(planAxisTickThin(clear, AXIS_THIN_GAP, LABEL_ROW_MIN_TEXTS).reason).toBe("no-overlap");
    });

    it("two labels - the archetype's own min/max form - are never thinned", () => {
        const plan = planAxisTickThin([box(0, 70), box(60, 120)], AXIS_THIN_GAP, LABEL_ROW_MIN_TEXTS);
        expect(plan.reason).toBe("too-few");
        expect(plan.hide).toEqual([]);
    });

    it("hides nothing when even the two ends collide", () => {
        const plan = planAxisTickThin([box(0, 70), box(40, 110), box(60, 120)], AXIS_THIN_GAP, LABEL_ROW_MIN_TEXTS);
        expect(plan.reason).toBe("unfixable");
        expect(plan.hide).toEqual([]);
    });

    it("the axis default minimum is unchanged by the new parameter", () => {
        expect(LABEL_ROW_MIN_TEXTS).toBe(3);
        expect(AXIS_THIN_MIN_TICKS).toBe(4);
        expect(planAxisTickThin(colorbarRow).reason).toBe("too-few");
    });
});

describe("isNumericLabelText - what counts as a tick-like label", () => {
    it("accepts formatted numbers", () => {
        for (const s of ["210,000", "4,820,000", "$1.2M", "-3.5%", "12:30", "0", " 7 ", "1,5", "\u20ac99"]) {
            expect(isNumericLabelText(s), s).toBe(true);
        }
    });
    it("rejects words, dates, captions and empty text", () => {
        for (const s of ["Jan 2026", "1 region unmatched", "Sum of Sales (sqrt scale)", "", "+", "no data", "Q1"]) {
            expect(isNumericLabelText(s), s).toBe(false);
        }
    });
});

describe("labelRowHasTrack - a colorbar's labels sit along a track, data labels do not", () => {
    const box = (left: number, right: number, top: number, bottom: number): Rect => ({ left, right, top, bottom });
    // The same colorbar in screen space: five 24px swatches at y 8..18, three 10px labels
    // with their baseline at y 28 (boxes ~ y 20..30).
    const labels = [box(8, 40, 20, 30), box(40, 72, 20, 30), box(89, 128, 20, 30)];
    const swatches = [0, 1, 2, 3, 4].map(i => box(8 + i * 24, 8 + (i + 1) * 24, 8, 18));

    it("five swatches union into one track that covers the row", () => {
        expect(labelRowHasTrack(labels, swatches)).toBe(true);
    });
    it("the archetype's single gradient rect is a track too", () => {
        expect(labelRowHasTrack(labels, [box(8, 128, 8, 16)])).toBe(true);
    });
    it("a hand-rolled axis line is a track", () => {
        expect(labelRowHasTrack(labels, [box(8, 128, 17, 18)])).toBe(true);
    });
    it("no shapes near the row - bar value labels in their own group - is no track", () => {
        expect(labelRowHasTrack(labels, [])).toBe(false);
        expect(labelRowHasTrack(labels, [box(8, 128, 200, 210)])).toBe(false);   // far below: the plot, not a track
    });
    it("a shape covering under 80% of the row is not its track", () => {
        expect(labelRowHasTrack(labels, [box(8, 60, 8, 18)])).toBe(false);
    });
    it("a track beside the row rather than under it does not count", () => {
        expect(labelRowHasTrack(labels, [box(300, 420, 8, 18)])).toBe(false);
    });
    it("handles empty input without throwing", () => {
        expect(labelRowHasTrack([], swatches)).toBe(false);
    });
});

describe("groupLabelRows - one baseline is one row", () => {
    const at = (left: number, top: number, w = 30, h = 10): Rect => ({ left, right: left + w, top, bottom: top + h });

    it("groups labels on one baseline and sorts them by left edge, indexed into the input", () => {
        const boxes = [at(80, 100), at(0, 100), at(40, 100.5), at(0, 300)];
        expect(groupLabelRows(boxes)).toEqual([[1, 2, 0]]);
    });
    it("drops rows of one - a lone label has nothing to collide with", () => {
        expect(groupLabelRows([at(0, 0), at(0, 50), at(0, 100)])).toEqual([]);
    });
    it("keeps two rows apart when their centres differ by more than the tolerance", () => {
        const rows = groupLabelRows([at(0, 0), at(40, 0), at(0, 3), at(40, 3)]);
        expect(rows).toEqual([[0, 1], [2, 3]]);
    });
});
