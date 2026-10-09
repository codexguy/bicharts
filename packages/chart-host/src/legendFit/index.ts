// The post-render passes that keep a drawn D3 chart readable inside its frame, published as
// "@bicharts/chart-host/legend-fit". A generated chart cannot know how wide its own legend text will
// come out, where its tick labels will collide, or how far a label will hang past the frame, so a host
// measures the rendered SVG and repairs what it finds:
//
//   - the legend (found by its contract class, or by its measured shape when it carries none) is slid
//     clear of the plot, and a colorbar drawn over the chart is pushed into the margin it belongs in;
//   - a horizontal axis whose tick labels collide is thinned by stride (a nominal axis is cut to its
//     band instead, never thinned), and so is a hand-placed row of numeric labels along a track;
//   - an axis title or caption sitting on top of the tick labels is pushed below them;
//   - the viewBox is extended so nothing the chart painted is cut off, unless the extension would cost
//     more legibility than it buys;
//   - text a few units past the frame grows the viewBox, and a label too far out for that is shrunk
//     and then cut, with the full text kept in a <title>.
//
// The passes are mechanism only. WHEN to run them (a placement setting, a sampling coin, logging, a
// per-host switch) is the host's decision, and the options below are the whole seam.
//
// It is its own entry because the main entry's eager closure is budgeted (see scripts/checkEagerSize.mjs):
// only a host that runs these passes pays for them, and nothing the main entry imports reaches this file.
// The scroll-fit helpers these passes share (the content selector, the phantom-box test and the matrix
// scale) stay in "./fit" and "./fitDom" and are exported from the main entry.

// The pure geometry: boxes and viewBoxes in, a plan out.
export {
    MIN_OVERLAP, MAX_GUTTER_FRACTION, COLORBAR_ON_PLOT_COVER, MAX_FIT_FRACTION, FIT_PAD,
    LEGIBILITY_GRACE_PX, MIN_LEGIBLE_PX, BOTTOM_TEXT_MIN_TICK_HITS,
    SWATCH_MAX_PX, SWATCH_LABEL_GAP_PX, SIGNATURE_MIN_PAIRS,
    AXIS_THIN_MIN_TICKS, AXIS_THIN_GAP, LABEL_ROW_MIN_TEXTS, LABEL_ROW_Y_TOLERANCE,
    LABEL_ROW_TRACK_COVER, LABEL_ROW_TRACK_REACH,
    rightmostOverlappingPlotEdge, bottommostOverlappingPlotEdge, planLegendReconcile,
    colorbarProbePoints, colorbarOnPlot, colorbarSitsOnMarks, colorbarReconcileSide,
    planContentFit, planBottomTextPush, swatchPairs, isLegendSignature, planAxisTickThin,
    isNumericLabelText, isDateLikeLabelText, isOrderedAxisLabelText, axisLabelsAreNominal,
    nominalLabelRooms, groupLabelRows, labelRowHasTrack,
    type Rect, type ViewBox, type ReconcileSide, type ReconcilePlan, type ReconcileOptions,
    type ContentFitPlan, type ContentFitOptions, type SwatchPairs, type AxisThinPlan,
} from "./legendReconcile";
export {
    FRAME_PAD, MAX_EXTEND_FRACTION, FIT_TYPE_FLOOR, FIT_SHRINK_FLOOR,
    planFrameFit, viewBoxAttr, labelRoom, labelFitDecision, cutToFit,
    type FrameFitPlan, type TextAnchor, type LabelFitDecision,
} from "./frameFit";

// The DOM passes: measure the rendered SVG, run a plan, apply it.
export {
    reconcileLegendInSvg, findSignatureLegendGroups, findColorbarFurniture,
    smallestRenderedTextPx, styleDeclaresScroll,
    type LegendReconcileResult, type AxisThinReport,
} from "./legendReconcileDom";
export {
    FRAME_FIT_TEXT_CAP, fitTextToFrame, fitDeferredLabels, fitLabelToRoom, isClippedOrScrolled,
    type FrameFitOutcome, type DeferredLabelFitReport,
} from "./frameFitDom";
