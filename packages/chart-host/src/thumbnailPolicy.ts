// THUMBNAIL CAPTURE - when a host captures the chart it just drew, and what it says about consent.
//
// A host can send an image of a rendered chart beside its render telemetry. Three different things
// can call for that image, and only ONE of them is the reader's consent:
//
//   consented         - the reader (or their account) opted in to saving thumbnails. The image may go
//                       to the reader's own chart history.
//   forced            - the service asked for this account's renders to be captured for diagnosis. An
//                       additive lever for an account under investigation; it is NOT consent, so the
//                       consent flag stays false and the service keeps the image out of the reader's
//                       history.
//   capturesByDefault - the host's terms cover a capture without the setting (a free tier's first
//                       render, say). Also NOT consent, for the same reason.
//
// ONE PER GENERATION, NOT ONE PER PAINT. Opted-in and by-default captures happen only on the first
// render of a newly generated version: a resize, a reopen, a cross-filter or a theme change repaints
// the same version and must not upload it again. A forced capture is not limited this way - the
// diagnosis wants the chart as each viewer sees it - so a host bounds it with its own once-per-version
// row gate.
//
// Pure: the host resolves each input from its own settings, account state and render lifecycle.

export interface ThumbnailGate {
    /** The reader or their account opted in to saving thumbnails. The only input that is consent. */
    consented: boolean;
    /** The service asked for this account's renders to be captured for diagnosis. Not consent. */
    forced: boolean;
    /** The host's terms cover a capture without the setting (e.g. a free tier). Not consent. */
    capturesByDefault: boolean;
    /** This render is the first of a newly generated version - not a resize, reopen or filter. */
    firstRenderAfterGenerate: boolean;
}

export interface ThumbnailDecision {
    /** Capture an image of this render. */
    capture: boolean;
    /** The consent flag to send beside it: `consented`, never raised by a forced or default capture. */
    consent: boolean;
}

export function shouldCaptureThumbnail(g: ThumbnailGate): ThumbnailDecision {
    const capture = g.forced || ((g.consented || g.capturesByDefault) && g.firstRenderAfterGenerate);
    return { capture, consent: g.consented };
}
