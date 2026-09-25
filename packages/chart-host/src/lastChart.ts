// THE WAY BACK TO THE LAST WORKING CHART - two pure decisions over a host's persisted cache.
//
// A host that keeps the chart it last drew (a cached version number and that version's code) can
// offer the reader a way back to it from a setup or landing screen. Both decisions below read only
// that PERSISTED cache, never the live render state: the live state can be empty on a landing
// screen even when a real cached chart exists.
//
// THE BUTTON'S QUESTION HAS NO VERSION TERM, and the absence is the fix. The first version of this
// gate also required the host's current version selector to be 0 (the landing state). That hid the
// button in exactly the state that needs it most: a copy stranded at a NON-zero version whose render
// was refused - licence details stripped from a distributed copy, so the landing screen's only
// action (Generate) cannot succeed, the landing screen suppresses the other recovery links because
// it "carries its own buttons", and the version term hid this one. Three gates, zero exits, with a
// perfectly good cached chart one click away. Cached version plus cached code is the whole question.
//
// "Is a chart painted right now?" is deliberately NOT a term either. The button lives on the setup
// screen, which is hidden once a chart paints, so the DOM already answers it; and a "last render
// succeeded" flag can be stale-true while the chart is hidden, which would re-hide the button in
// the very case this exists for.
//
// THE RESTORE'S QUESTION HAS ONE, and the asymmetry is the point. Entering a licence goes through
// the version-0 landing state; nothing put the reader back, so a reader who had just converted
// landed on setup, pressed the only button there, and owned a duplicate version. Restoring the
// cached version after the licence is saved is the same decision as the button, made without the
// click - so it composes `canShowLastChart` instead of growing a second notion of "is there a chart
// to go back to". But it also asks "were we parked on the landing state", and a non-zero version
// means the reader is somewhere else on purpose: moving them would be the bug, not the fix.

/**
 * Should the "show last chart" way back be offered?
 *
 * @param cachedVersionPersisted the PERSISTED cached version (not live render state)
 * @param cachedCodePersisted    the PERSISTED cached code (not live render state)
 *
 * True when a positive version is cached and its code is not blank.
 */
export function canShowLastChart(
    cachedVersionPersisted: number | null | undefined,
    cachedCodePersisted: string | null | undefined,
): boolean {
    return (cachedVersionPersisted ?? 0) > 0
        && String(cachedCodePersisted ?? "").trim() !== "";
}

/**
 * After a licence is saved, should the host restore the cached version on its own?
 *
 * Only when the current version is 0 (missing reads as 0) - the reader was parked on the landing
 * state - and there is a last chart to go back to (`canShowLastChart`).
 */
export function shouldRestoreVersionAfterLicenseSave(
    currentVersionValue: number | null | undefined,
    cachedVersionPersisted: number | null | undefined,
    cachedCodePersisted: string | null | undefined,
): boolean {
    return (currentVersionValue ?? 0) === 0
        && canShowLastChart(cachedVersionPersisted, cachedCodePersisted);
}
