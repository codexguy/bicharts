// Remembering a reader's zoom and pan on a d3-zoom chart, published as "@bicharts/chart-host/zoom-memory".
//
// A chart that calls d3.zoom() (a zoomable map, a pannable scatter) is redrawn by its host on a resize, a
// cross-filter or a restyle, and every redraw opens it at full extent again. This entry remembers the view:
// for the session always, and across a close and reopen while the host's own preference says so. The host
// supplies where the view is kept (ZoomMemoryHost); createZoomMemoryHook binds the functions to it, and
// createChartHost takes the hook as `zoomMemory` and does the rest on every render.
//
// It is its own entry because the main entry's eager closure is budgeted (see scripts/checkEagerSize.mjs):
// only a host that remembers zoom pays for it. The main entry names the hook's TYPE only.

// The pure half: keys, validation and the (de)serialized form of a remembered view.
export {
    zoomStateKey, viewportBucket, isUsableTransform, isIdentity, transformsDiffer, serializeZoomState,
    parseZoomState, isZoomStateUsable, readNodeTransform, findZoomedNodes, soleZoomedNode,
    type ZoomTransform, type ZoomState,
} from "./zoomMemory";

// The DOM half, over the host's state object, and the hook createChartHost takes.
export {
    captureZoomBehaviors, restoreZoomForRender, attachZoomWatcher, captureCurrentZoom, flushPendingZoom, forgetZoom,
    createZoomMemoryHook,
    type ZoomMemoryHost, type ZoomCapture, type ZoomMemoryHook,
} from "./zoomMemoryDom";
