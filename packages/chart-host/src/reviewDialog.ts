// "APPLY IMPROVEMENTS?" — the consent half of the propose/accept vision review.
//
// The review service judges a rendered chart and, when a change is warranted, PROPOSES it
// without charging anything (see review.ts). This dialog is the moment a person decides, and
// its contract is identical in every host because the money is identical in every host:
//
//   * Nothing has been charged when it opens.
//   * EVERY ambiguous answer is No: the No button, Escape, a backdrop click, a dialog that
//     throws while building, a second dismissal racing the first, and a surface too small to
//     ask in legibly. Only a deliberate click on Apply resolves true — and only that
//     resolution should lead a host to the one call that bills.
//   * The judge's own sentence is shown verbatim — it is the only thing that says WHAT would
//     change — above a plain statement of the cost, because the cost is the fact being
//     decided.
//
// It lives HERE because it briefly existed twice — once per host — and two copies of "every
// ambiguous answer is No" is how two hosts come to charge differently for the same click.
// Hosts localize the strings and skin the chrome through options; the RESOLUTION RULE is not
// an option.

export interface ReviewDialogText {
    title?: string;
    /** Shown when the judge supplied no reason. The judge's reason always wins when present. */
    fallbackReason?: string;
    cost?: string;
    decline?: string;
    accept?: string;
}

export interface ReviewDialogOptions {
    /** Overlay element id. Stable so tests and log-readers can find the same dialog anywhere. */
    id?: string;
    /** Host chrome. When given they are ADDED to the inline baseline, so a host theme (e.g. a
     *  dark-mode card background) can win where it should while the layout stays put. */
    overlayClass?: string;
    cardClass?: string;
    /** The too-small-to-ask floor. Below it the dialog is a clipped smear over the chart, and
     *  asking illegibly for permission to spend money is worse than not asking. */
    minWidth?: number;
    minHeight?: number;
    text?: ReviewDialogText;
}

const DEFAULT_TEXT: Required<ReviewDialogText> = {
    title: "Apply improvements?",
    fallbackReason: "The AI review suggests a change to this chart.",
    cost: "Applying creates a new chart version and uses a generation. Declining costs nothing.",
    decline: "No thanks",
    accept: "Apply",
};

/** Resolves true ONLY on a deliberate click of Apply. Never rejects. */
export function askApplyImprovements(
    container: HTMLElement, reason: string, opts: ReviewDialogOptions = {},
): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        try {
            const minW = opts.minWidth ?? 260;
            const minH = opts.minHeight ?? 170;
            const w = container.clientWidth || (container as HTMLElement).offsetWidth || 0;
            const h = container.clientHeight || (container as HTMLElement).offsetHeight || 0;
            if (w < minW || h < minH) {
                resolve(false);
                return;
            }
            const text = { ...DEFAULT_TEXT, ...(opts.text ?? {}) };
            const doc = container.ownerDocument;

            const ov = doc.createElement("div");
            ov.id = opts.id ?? "bic-review-ask-overlay";
            if (opts.overlayClass) ov.className = opts.overlayClass;
            else ov.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.55);z-index:110;";
            // Centering is layout, not chrome, so it applies in both branches — a host overlay
            // class supplies backdrop and stacking, not the geometry of the question.
            ov.style.display = "flex";
            ov.style.alignItems = "center";
            ov.style.justifyContent = "center";

            const card = doc.createElement("div");
            if (opts.cardClass) card.className = opts.cardClass;
            else card.style.cssText = "background:#ffffff;color:#1f2937;border-radius:10px;"
                + "box-shadow:0 6px 24px rgba(0,0,0,0.22);";
            // Inline AFTER the class so a full-bleed host card class (width/height 95%) cannot
            // stretch a yes/no question across the whole visual.
            card.style.width = "auto";
            card.style.height = "auto";
            card.style.maxWidth = "min(420px, 90%)";
            card.style.maxHeight = "90%";
            card.style.overflow = "auto";
            card.style.padding = "16px 18px";
            card.style.display = "flex";
            card.style.flexDirection = "column";
            card.style.gap = "10px";
            card.style.boxSizing = "border-box";

            const head = doc.createElement("div");
            head.style.cssText = "font:600 13px 'Segoe UI',system-ui,sans-serif;";
            head.textContent = text.title;

            const why = doc.createElement("div");
            why.style.cssText = "font:400 12px/1.45 'Segoe UI',system-ui,sans-serif;white-space:normal;";
            why.textContent = reason || text.fallbackReason;

            const cost = doc.createElement("div");
            cost.style.cssText = "font:400 11px/1.4 'Segoe UI',system-ui,sans-serif;opacity:0.75;white-space:normal;";
            cost.textContent = text.cost;

            const row = doc.createElement("div");
            row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:4px;";
            const no = doc.createElement("button");
            no.type = "button";
            no.textContent = text.decline;
            const yes = doc.createElement("button");
            yes.type = "button";
            yes.textContent = text.accept;
            yes.style.cssText = "font-weight:600;";

            let done = false;
            const finish = (v: boolean) => {
                if (done) return;                    // Escape then a click must not resolve twice
                done = true;
                try { if (ov.parentElement) ov.parentElement.removeChild(ov); } catch { /* gone */ }
                doc.removeEventListener("keydown", onKey, true);
                resolve(v);
            };
            const onKey = (e: KeyboardEvent) => {
                if (e.key === "Escape") { e.stopPropagation(); finish(false); }
            };
            no.addEventListener("click", () => finish(false));
            yes.addEventListener("click", () => finish(true));
            ov.addEventListener("click", (e) => { if (e.target === ov) finish(false); });
            card.addEventListener("click", (e) => e.stopPropagation());
            doc.addEventListener("keydown", onKey, true);

            row.append(no, yes);
            card.append(head, why, cost, row);
            ov.appendChild(card);
            container.appendChild(ov);
            try { yes.focus(); } catch { /* focus is a nicety */ }
        } catch {
            // A dialog that cannot be built must not strand the flow or silently apply an
            // edit nobody agreed to. Fail CLOSED: no consent, no charge.
            resolve(false);
        }
    });
}
