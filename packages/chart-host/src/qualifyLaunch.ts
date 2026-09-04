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
    /**
     * A named type. Rides the host's explicit-pick lane for exactly one generation.
     *
     * `projectionKey` is set when the row the reader clicked was a PROJECTED one: the list offers
     * such a type once per projection that admits it, so the same chart appears at two grains and
     * the pick has to say which. Absent for a direct row, and for a host that does not offer the
     * choice - the server then picks the first projection that admits the type, as it always did.
     */
    | { kind: "pick"; chartType: string; projectionKey?: string }
    /** "Choose for me." Generates with NO preference expressed. */
    | { kind: "auto" }
    /** Backed out. Nothing is generated and no preference is recorded. */
    | { kind: "cancel" };

export const qualifyPick = (chartType: string, projectionKey?: string | null): QualifyLaunchOutcome =>
    ({ kind: "pick", chartType, ...(projectionKey ? { projectionKey } : {}) });
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
 * THE SMALLEST TILE THE CHOOSER IS USABLE IN, measured rather than guessed - and RE-MEASURED on
 * 2026-09-04, because the first measurement was taken on a card the product does not draw.
 *
 * WHAT THE FIRST SWEEP GOT WRONG (it shipped 400 x 240). It asked three questions of 168 tile
 * sizes - do the three launch buttons sit on one line inside the card, are at least two list
 * rows visible, is nothing in the pinned chrome clipped - and found that two rows fit at
 * 400 x 220. Two rows only fit there if a row is ~22px tall, and a real row is 48: every row
 * carries its type's DESCRIPTION, which wraps to a second line at any width this dialog will
 * ever open at. That text has been in the list since 2026-07-11, seven weeks BEFORE the floor
 * was measured. So the sweep sized the card against a list half the height of the one on
 * screen, and the coupling it inferred from the wrapping TITLE, though real, is not what binds.
 *
 * WHAT THE RE-MEASURE SAYS. 4,050 layouts - 675 sizes (280-520 x 160-420 in 10px steps) x three
 * description lengths (p25 / p50 / p75 over the 108 active types) x two base font sizes (14 and
 * 16px) - same DOM, same compiled CSS. The structure is identical at both font sizes:
 *
 *     not trapped (buttons on one line, pinned chrome unclipped, card not overflowing)  300 x 190
 *     >= 1 full list row visible                                                        330 x 330
 *     >= 2 full list rows visible                          340 x 420, and UNREACHABLE below 410
 *                                                          wide once a description runs to p75
 *
 * 400 x 240 satisfies NEITHER - fifty pixels too tall to be about escapability, ninety too short
 * to be about legibility. A 400 x 240 tile leaves 77px of list; two rows and their group heading
 * need 126.
 *
 * SO THE FLOOR ANSWERS THE ONLY QUESTION A FLOOR CAN ANSWER HERE: can the reader get out of this
 * card. The list is `overflow-y: auto` with `min-height: 0` and scrolls at every size, so "how
 * much of it do I see at once" is not a thing a gate decides - scrolling handles it. What
 * scrolling cannot handle is a card that CLIPS its own buttons, and that is precisely the pair
 * of questions that hold from 300 x 190 down.
 *
 * 320 x 220 is that floor with one sweep step of margin on both dimensions - and it is also,
 * exactly, the absolute floor the FIRST sweep reported before inflating it for the coupling.
 * Two independent measurements agreeing on the escapability floor is the part of the original
 * that survived. The margin is not decoration: both sweeps used one font stack and one English
 * title, and every host localizes it.
 *
 * THIS IS THE ARGUMENT THE EXCEL PANE ALREADY MAKES, which is why the two hosts now differ by a
 * card rather than by a philosophy - see shouldOpenInlineChooserOnGenerate below, whose whole
 * reason for having no size clause is that a scrolling panel cannot trap anyone. The modal's
 * list scrolls too; its CARD is the part that clips, and this floor is about the card.
 *
 * ERRING HIGH IS STILL THE CHEAP DIRECTION where it is genuinely cheap - below the floor the
 * host generates immediately, which is what it did before this feature existed, so a tile
 * wrongly judged too small costs a feature while one wrongly judged big enough costs a dialog
 * with its buttons off the card. What the re-measure changes is the band over which that trade
 * was being made blind: at 400 x 240 the chooser was withheld from tiles that show MORE of the
 * list than tiles it was being offered on.
 */
export const CHOOSER_MIN_WIDTH_PX = 320;
export const CHOOSER_MIN_HEIGHT_PX = 220;

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
 * The same gate for a host whose chooser is an INLINE, SCROLLING PANEL rather than a modal card
 * - and it deliberately has no size clause at all.
 *
 * THE ASYMMETRY IS THE POINT, AND IT IS MEASURED RATHER THAN ASSUMED. The modal above lives in
 * a card that CLIPS, so past a certain smallness its buttons are simply not on screen and the
 * reader is trapped. A panel that flows inside a scrolling pane, with a wrapping button row,
 * cannot reach that state: swept across 63 pane sizes down to 200x120, every one stayed usable
 * - the footer wrapped from one line to three (38px to 86px) and stayed inside the panel.
 *
 * So a size clause here would not protect anybody. Two hosts, two layouts, two honest answers -
 * written next to each other so the difference reads as a decision rather than as one of them
 * having forgotten.
 *
 * TWO CLAIMS THIS COMMENT USED TO MAKE HAVE BEEN WITHDRAWN (2026-09-04), because the modal's
 * re-measure discredits the sweep they came from rather than this function:
 *
 *   * "a default task pane is narrower than the modal's floor" - it no longer is. The floor moved
 *     to 320x220 and an ordinary task pane clears it, so the two gates now agree on the pane that
 *     used to be the whole argument. The asymmetry survives only below the card's drawable
 *     minimum, which is the only place it ever described something real.
 *   * "the list kept four or more rows" - measured the same way the modal's rows were, which is
 *     to say without the DESCRIPTION every row carries. Whatever that number is, it is not four,
 *     and no claim is made here in its place. It was never the reason for having no size clause:
 *     the panel scrolls and the footer wraps, and THAT is the reason.
 */
export function shouldOpenInlineChooserOnGenerate(i: { enabled: boolean; hasData: boolean }): boolean {
    return i.enabled === true && i.hasData === true;
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
export function confirmLaunch(selected: string | null | undefined,
                              projectionKey?: string | null): QualifyLaunchOutcome {
    return canConfirmLaunch(selected)
        ? qualifyPick(String(selected).trim(), projectionKey)
        : qualifyCancel();
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
