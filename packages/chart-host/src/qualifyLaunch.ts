// THE "WHAT FITS?" LIST AS A LAUNCH PAD, NOT A NOTEBOOK.
//
// Hosts have historically used the qualify list as a browsing surface: you open it, you pick a
// type, the pick lands in a dropdown or on a label, and you press the host's own Generate
// afterwards. Putting the list IN FRONT of Generate turns it into the thing that starts the
// work, and that is a different contract - so the decisions below are here rather than in each
// host, because they are the ones that mislead silently when two hosts answer them differently.
//
// THE DECISION THIS EXISTS FOR: **"no preference" and "changed my mind" are NOT the same
// answer.** Both close the dialog and neither names a chart type, so a host that models the
// exit as one boolean will collapse them - and the collapse is invisible either way it falls.
// Collapse toward auto and a reader who backed out is billed for a chart they did not ask for.
// Collapse toward cancel and the reader who explicitly asked the host to choose gets nothing
// and no explanation. Three outcomes, named, is the only shape that cannot be got wrong by
// accident.
//
// The dialog's CHROME is not here: one host draws a centred modal card, another a list panel
// that has to survive being 32 px tall. Words go through each host's own localization. What is
// here is which outcomes exist, when the chooser may open at all, and when the confirm button
// is live.

/** How the reader left the chooser. Three outcomes, never two - see the note above. */
export type QualifyLaunchOutcome =
    /** A named type. Rides the host's explicit-pick lane for exactly one generation. */
    | { kind: "pick"; chartType: string }
    /** "Choose for me." Generates with NO preference expressed. */
    | { kind: "auto" }
    /** Backed out. Nothing is generated and no preference is recorded. */
    | { kind: "cancel" };

export const qualifyPick = (chartType: string): QualifyLaunchOutcome =>
    ({ kind: "pick", chartType });
export const qualifyAuto = (): QualifyLaunchOutcome => ({ kind: "auto" });
export const qualifyCancel = (): QualifyLaunchOutcome => ({ kind: "cancel" });

/** Does this outcome start a generation? False for cancel ALONE. */
export function launchGenerates(outcome: QualifyLaunchOutcome): boolean {
    return outcome.kind === "pick" || outcome.kind === "auto";
}

/**
 * The value a host should put in its explicit-pick field for this outcome.
 *
 * GENERIC OVER THE SENTINEL BECAUSE THE HOSTS DISAGREE ABOUT WHAT "AUTO" IS SPELLED AS, and
 * that disagreement is real rather than sloppy: one host's field is a nullable string whose
 * null means "the picker decides", another's is a plain string whose empty value is the wire
 * form. Neither can adopt the other's without changing a wire contract. So the sentinel is
 * passed IN and this function only decides WHICH of the two values applies - which is the part
 * that must not differ.
 *
 * Cancel maps to the sentinel too, defensively: a caller that ignores `launchGenerates` and
 * reads this anyway gets "no preference" rather than a stale pick. It should still not generate.
 */
export function launchFavorStyle<T>(outcome: QualifyLaunchOutcome, autoSentinel: T): string | T {
    return outcome.kind === "pick" ? outcome.chartType : autoSentinel;
}

/**
 * THE SMALLEST TILE THE CHOOSER IS USABLE IN, measured rather than guessed (2026-09-01).
 *
 * A sweep of 168 tile sizes in headless Chromium, rendering the real card DOM and CSS, asking
 * three questions of each: do the three launch buttons sit on one line inside the card, are at
 * least two list rows visible, and is nothing in the pinned chrome clipped. The measured floor
 * is 320 x 220 - but the two dimensions are COUPLED, because under 400 px the card's title
 * wraps to a second line and eats the list's height: at 320-340 wide the height floor rises to
 * 280, at 360-380 to 260, and only at 400+ does 220 hold.
 *
 * 400 x 240 is that envelope with one sweep step of margin on the height. The margin is not
 * decoration: the measurement used one font stack and one string, and every host localizes the
 * title, so a longer translation wraps sooner than the sample did.
 *
 * ERRING HIGH IS THE CHEAP DIRECTION. Below the floor the host generates immediately, which is
 * the behaviour it had before the chooser existed - so a tile wrongly judged too small costs a
 * feature, while one wrongly judged big enough costs a dialog whose buttons are off the card.
 */
export const CHOOSER_MIN_WIDTH_PX = 400;
export const CHOOSER_MIN_HEIGHT_PX = 240;

/**
 * Is there room to DRAW the chooser here?
 *
 * MEASURE THE REAL SURFACE, never a size the host reports outward. Where a host lets an author
 * state a viewport for generation purposes, that stated size is a claim about a tile that does
 * not exist yet; the dialog has to fit the pixels actually on screen.
 */
export function chooserFitsViewport(width: number, height: number): boolean {
    if (!isFinite(width) || !isFinite(height)) return false;
    return width >= CHOOSER_MIN_WIDTH_PX && height >= CHOOSER_MIN_HEIGHT_PX;
}

export interface ChooserGateInput {
    /** The host's opt-out setting. False = the reader wants one-click Generate back. */
    enabled: boolean;
    /** Real drawable width, in CSS pixels. */
    width: number;
    /** Real drawable height, in CSS pixels. */
    height: number;
    /**
     * Is there anything to qualify? A chooser over an empty binding can only say "bind
     * something first", which the host's own Generate path already says better and without
     * a round-trip.
     */
    hasData: boolean;
}

/**
 * Should pressing Generate open the chooser instead of generating?
 *
 * FALSE IS ALWAYS SAFE and that is the design: every false answer here lands on the behaviour
 * the host had before this feature existed - press Generate, get a chart. So the gate can be
 * conservative without stranding anybody, and a new reason to decline can be added later
 * without auditing what it breaks.
 */
export function shouldOpenChooserOnGenerate(i: ChooserGateInput): boolean {
    if (!i.enabled) return false;
    if (!i.hasData) return false;
    return chooserFitsViewport(i.width, i.height);
}

/**
 * Is the confirm button live?
 *
 * A SEPARATE QUESTION FROM "is a type selected", because it is the answer to a UI state and the
 * host asks it on every selection change. Kept here so both hosts agree that selecting a row is
 * what arms confirm - the alternative, arming it always and validating on click, produces a
 * button that looks ready and then refuses, which is the interaction this flow replaced.
 */
export function canConfirmLaunch(selected: string | null | undefined): boolean {
    return typeof selected === "string" && selected.trim() !== "";
}

/**
 * The outcome of pressing confirm with `selected` highlighted.
 *
 * Returns CANCEL rather than auto when nothing is selected, and the choice matters: confirm
 * with an empty selection is a state the UI should not allow, so if it happens the honest
 * reading is "this click means nothing", not "this click means spend a credit". The host's
 * disabled state is the first guard; this is the second.
 */
export function confirmLaunch(selected: string | null | undefined): QualifyLaunchOutcome {
    return canConfirmLaunch(selected) ? qualifyPick(String(selected).trim()) : qualifyCancel();
}

/**
 * WHAT A FAILED QUALIFY MEANS depends on which door the reader came through, and this is the
 * one place that says so.
 *
 * Opened from Generate, the reader asked for a CHART: the chooser is an offer along the way, so
 * when qualify errors or times out the flow proceeds to generate and the degradation is logged
 * rather than shown. Opened from a "what fits?" affordance, the reader asked a QUESTION: failing
 * open there would spend a credit nobody requested, so the error is shown and nothing runs.
 *
 * This is the whole reason the two doors are distinguishable at all. Everything else about them
 * - the list, the buttons, the outcomes - is deliberately identical.
 */
export function qualifyFailureFallsOpen(viaGenerate: boolean): boolean {
    return viaGenerate === true;
}
