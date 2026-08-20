// AI VISION REVIEW — the pure decision core, shared by every host.
//
// The flow: immediately after the first render from a generate, the host captures the painted
// pixels (see snapshot.ts) and posts them for review. The service judges the image against the
// original ask and answers one of:
//
//   NOCHANGE — the chart is fine. Free, chart untouched.
//   PROPOSED — a change is warranted. STILL FREE: the service stops at a proposal, the host
//              asks the user, and only their explicit yes sends the instruction back to be
//              applied as an ordinary (billed) modify.
//   OK       — the accepted round-trip's answer: a finished generate result to apply.
//   REFUSED / ERROR — keep the chart, log the reason, never surface it as a chart failure.
//
// THE THROUGH-LINE: every ambiguous state resolves toward the FREE outcome. A review exists to
// occasionally save a bad render, and the failure mode it must never have is quietly spending
// the user's money — so an unreadable verdict keeps, a proposal with no instruction keeps, and
// applying always requires an explicit human yes upstream of the one call that bills.
//
// Everything here is pure and host-free so both the deciding and the wire shape are pinnable
// in tests without a DOM, a network, or a Visual.

/** The facts a "should we review this render?" decision needs, named so policy reads in one place. */
export interface ReviewGate {
    /** The user's settings toggle. Reviews are strictly opt-in. */
    enabled: boolean;
    /** Licensed accounts only — the host checks its own credential shape and says so here. */
    modeLicensed: boolean;
    /**
     * True when THIS render is the first paint after a generate this session. A cached
     * restore, a resize, a cross-filter repaint — none of these are "the first render from a
     * generate", and reviewing them would judge the same pixels twice.
     */
    firstRenderAfterGenerate: boolean;
    /** The version on screen. 0/undefined = nothing to review. */
    codeVersion: number | null | undefined;
    /**
     * Versions this session already submitted. Guards re-entrancy: an applied fix's own first
     * render must not trigger a second review of the fix — a fix of a fix of a fix is a
     * billing loop.
     */
    reviewedVersions: ReadonlySet<number>;
    /** A review already in flight for this instance. */
    inFlight: boolean;
}

/** Should a review fire for this render? Every clause is a reason NOT to, because the free
 *  direction is "no review". */
export function shouldReview(g: ReviewGate): boolean {
    if (!g.enabled) return false;
    if (!g.modeLicensed) return false;
    if (!g.firstRenderAfterGenerate) return false;
    if (!g.codeVersion || g.codeVersion <= 0) return false;
    if (g.inFlight) return false;
    if (g.reviewedVersions.has(g.codeVersion)) return false;
    return true;
}

/** The review endpoint's wire body. `request` is the SAME generate request the host would send
 *  for a modify of the reviewed version — the service writes the fix intent into it, so an
 *  applied fix is provably an ordinary modify of exactly this request. */
export interface ReviewWire {
    request: unknown;
    imageBase64: string;
    imageMediaType: string;
    version: number;
    originalAsk: string;
    codeSummary: string;
    chartType: string;
    correlationId: string;
    /**
     * THE SECOND HALF of the propose/accept round-trip. Absent on the judging call; set to the
     * proposal's instruction — verbatim — when the user accepted. Its presence is the whole
     * difference between a free judgement and a billed modify.
     */
    applyInstruction?: string;
}

/** Strip a data-URL prefix if the capture produced one; the wire carries bare base64. */
export function bareBase64(dataUrlOrB64: string): { b64: string; mediaType: string } {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrlOrB64 || "");
    if (m) return { b64: m[2], mediaType: m[1] };
    return { b64: dataUrlOrB64 || "", mediaType: "image/png" };
}

export function buildReviewWire(input: {
    request: unknown;
    capture: string;
    version: number;
    originalAsk: string | null | undefined;
    codeSummary: string | null | undefined;
    chartType: string | null | undefined;
    correlationId: string | null | undefined;
}): ReviewWire {
    const { b64, mediaType } = bareBase64(input.capture);
    return {
        request: input.request,
        imageBase64: b64,
        imageMediaType: mediaType,
        version: input.version,
        originalAsk: (input.originalAsk ?? "").toString(),
        codeSummary: (input.codeSummary ?? "").toString(),
        chartType: (input.chartType ?? "").toString(),
        correlationId: (input.correlationId ?? "").toString(),
    };
}

/** What the service answers, camelCase on the wire. */
export interface ReviewVerdict {
    status: "PROPOSED" | "OK" | "NOCHANGE" | "REFUSED" | "ERROR" | string;
    verdictReason?: string | null;
    /** Set only on PROPOSED: the judge's instruction, sent back verbatim if the user accepts. */
    instruction?: string | null;
    /** A full generate result when status === "OK": the fix IS a modify. */
    fix?: unknown;
    errorMessage?: string | null;
}

/** How the host should react to a verdict:
 *  - propose   → ASK THE USER; nothing has been charged and declining stays free;
 *  - apply-fix → the accepted round-trip answered with a finished result — apply and re-render;
 *  - keep      → chart untouched; log the reason. A REFUSED never surfaces as a user error:
 *                the toggle was on for an account that cannot use the feature, and the chart
 *                is fine. */
export type ReviewAction =
    | { kind: "propose"; instruction: string; reason: string }
    | { kind: "apply-fix"; fix: unknown; reason: string }
    | { kind: "keep"; reason: string; userVisible: boolean };

export function actionFor(v: ReviewVerdict | null | undefined): ReviewAction {
    if (!v) return { kind: "keep", reason: "no verdict returned", userVisible: false };
    if (v.status === "PROPOSED") {
        // A proposal with NO instruction is unactionable: there is nothing to send back and
        // nothing to put in the dialog, so it degrades to "keep" rather than opening an empty
        // question. The service guards the same case; this is the client half of one rule,
        // because a dialog that asks something it cannot act on is worse than staying quiet.
        const instr = (v.instruction ?? "").toString().trim();
        if (instr === "") return { kind: "keep", reason: "reviewer proposed no actionable change", userVisible: false };
        return { kind: "propose", instruction: instr, reason: (v.verdictReason ?? "").toString().trim() };
    }
    if (v.status === "OK" && v.fix) return { kind: "apply-fix", fix: v.fix, reason: v.verdictReason ?? "" };
    if (v.status === "NOCHANGE") return { kind: "keep", reason: v.verdictReason ?? "the chart renders as asked", userVisible: false };
    if (v.status === "REFUSED") return { kind: "keep", reason: v.errorMessage ?? "review not available", userVisible: false };
    // ERROR, or OK-without-fix (should not happen): keep the chart; the review is advisory
    // and a failed review must never read as a broken chart.
    return { kind: "keep", reason: v.errorMessage ?? v.verdictReason ?? "review failed", userVisible: false };
}
