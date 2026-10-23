// "LIKE IT? SHARE IT, OR RATE IT" - ONE QUIET LINE ON A HOST'S LANDING PAGE.
//
// The service decides whether to ask and supplies every URL: a block in the landing status answer that is either
// present (ask) or absent (draw nothing). This module turns that block into links and draws them; it never builds a
// URL, never reads a global, and never opens anything itself. Opening is the host's, because each host must go through
// its own door (a sandboxed iframe cannot navigate; an Office pane opens a browser window).
//
// WHAT IS SHARED: which links are drawn and in what order (the model below, pure), that a link only ever opens through
// the host's `open`, that a click never reaches the host page behind the line, and that "shown" fires once. What
// stays per host: placement, styling, the words (hosts localize), and the counters behind the callbacks.
//
// Nothing here offers anything in return for a rating, and nothing branches on how the reader feels about the product:
// the same line is shown to everyone the service asks.

/** The block as the service sends it. Either casing is accepted, because the hosts' status calls serialise differently.
 *  shape-core types the same block on the status answer (GetLicenseStatusResult.shareAsk); it is restated here because
 *  this package's published declarations import nothing they do not ship, and a typecheck test holds the two equal. */
export interface ShareAskWire {
    productUrl?: string; ProductUrl?: string;
    rateUrl?: string; RateUrl?: string;
    targets?: ShareTargetWire[]; Targets?: ShareTargetWire[];
}

export interface ShareTargetWire {
    id?: string; Id?: string;
    label?: string; Label?: string;
    url?: string; Url?: string;
}

export interface ShareLink {
    /** Short network id ("li", "fb", "x"); a host's click counter names it. */
    id: string;
    label: string;
    url: string;
}

export interface ShareRateModel {
    share: ShareLink[];
    /** The listing to rate; null when the block had none worth drawing. */
    rateUrl: string | null;
}

const TARGET_ID = /^[a-z0-9]{1,8}$/;

function httpsUrl(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw) return null;
    try {
        const u = new URL(raw);
        return u.protocol === "https:" ? u.href : null;
    } catch {
        return null;
    }
}

/**
 * The links to draw for a service block, or null to draw nothing. Absent block, nothing https, or nothing usable: null.
 * A target whose URL is not https, whose id is malformed or repeated, or which has no label is dropped; the order the
 * service sent is kept.
 */
export function shareRateLineModel(ask: ShareAskWire | null | undefined): ShareRateModel | null {
    if (!ask || typeof ask !== "object") return null;
    const rateUrl = httpsUrl(ask.rateUrl ?? ask.RateUrl);
    const share: ShareLink[] = [];
    const seen = new Set<string>();
    for (const t of (ask.targets ?? ask.Targets ?? [])) {
        if (!t || typeof t !== "object") continue;
        const id = String(t.id ?? t.Id ?? "");
        const label = String(t.label ?? t.Label ?? "").trim();
        const url = httpsUrl(t.url ?? t.Url);
        if (!TARGET_ID.test(id) || !label || !url || seen.has(id)) continue;
        seen.add(id);
        share.push({ id, label, url });
    }
    if (!rateUrl && share.length === 0) return null;
    return { share, rateUrl };
}

/** The words a reader sees. Hosts localize; every field has an English default. Network names come from the service. */
export interface ShareRateText {
    /** Before the network links: "Like it? Share it on". */
    lead?: string;
    /** Between the network links. */
    separator?: string;
    /** Between the share links and the rate link: ", or". */
    or?: string;
    /** The rate link after share links: "rate it on AppSource". */
    rate?: string;
    /** The rate link when there is nothing to share: "Like it? Rate it on AppSource". */
    rateAlone?: string;
    /** After the links: "Your ratings and feedback encourage us to do more." */
    note?: string;
    /** Menu layout, first: "Thanks for rating it." */
    thanks?: string;
    /** Menu layout, the rate link: "Rate it on AppSource too". */
    rateToo?: string;
    /** Menu layout, the toggle that reveals the networks: "Share it". */
    shareMenu?: string;
}

const DEFAULT_TEXT: Required<ShareRateText> = {
    lead: "Like it? Share it on",
    separator: " · ",
    or: ", or",
    rate: "rate it on AppSource",
    rateAlone: "Like it? Rate it on AppSource",
    note: "Your ratings and feedback encourage us to do more.",
    thanks: "Thanks for rating it.",
    rateToo: "Rate it on AppSource too",
    shareMenu: "Share it",
};

export interface ShareRateLineOptions {
    /** The service's block, as it arrived. Nothing is drawn when it yields no links. */
    ask: ShareAskWire | null | undefined;
    /** Opens a URL through the host's own door. The line never navigates by itself. */
    open: (url: string) => void;
    text?: ShareRateText;
    /** Added to the wrapper so the host can skin it. */
    className?: string;
    /** "inline" (the landing line: the networks named in the sentence) or "menu" (after a vote: a short thank-you, the
     *  rate link, and a "Share it" toggle that reveals the networks). The links, their order and the click contract are
     *  the same either way. */
    layout?: "inline" | "menu";
    /** Menu layout: the "Share it" toggle opened the networks. */
    onMenu?: () => void;
    /** Called once, when the line is mounted - the host's "shown" counter. A host that folds the line away counts it
     *  itself instead and passes nothing here. */
    onShown?: () => void;
    /** A network link was clicked. */
    onShare?: (id: string) => void;
    /** The rate link was clicked. */
    onRate?: () => void;
}

export interface ShareRateLine {
    element: HTMLElement;
    destroy(): void;
}

/**
 * Draw the line inside `container`, or return null (and draw nothing) when the block yields no links. The wrapper carries
 * `bic-share-rate`; network links `bic-share-rate-share` with `data-target`; the rate link `bic-share-rate-rate`; the
 * note `bic-share-rate-note`. Every link carries its real href (so it reads as a link, and a reader can copy it), but a
 * click is cancelled and handed to `open`.
 */
export function mountShareRateLine(container: HTMLElement, opts: ShareRateLineOptions): ShareRateLine | null {
    const model = shareRateLineModel(opts.ask);
    if (!model) return null;
    const doc = container.ownerDocument ?? document;
    const text = { ...DEFAULT_TEXT, ...(opts.text ?? {}) };

    const wrap = doc.createElement("div");
    wrap.className = "bic-share-rate" + (opts.className ? " " + opts.className : "");

    const span = (cls: string, s: string) => {
        const el = doc.createElement("span");
        el.className = cls;
        el.textContent = s;
        return el;
    };
    const link = (cls: string, label: string, url: string, onClick: () => void) => {
        const a = doc.createElement("a");
        a.className = cls;
        a.href = url;
        a.textContent = label;
        a.rel = "noopener noreferrer";
        a.addEventListener("click", (e) => {
            e.preventDefault();
            safely(() => opts.open(url));
            safely(onClick);
        });
        return a;
    };

    const appendNetworks = (into: HTMLElement) => model.share.forEach((t, i) => {
        if (i > 0) into.append(span("bic-share-rate-sep", text.separator));
        const a = link("bic-share-rate-share", t.label, t.url, () => opts.onShare?.(t.id));
        a.setAttribute("data-target", t.id);
        into.append(a);
    });

    if (opts.layout === "menu") {
        // "Thanks for rating it. Rate it on AppSource too · Share it" - the networks wait behind the toggle.
        wrap.setAttribute("data-layout", "menu");
        wrap.append(span("bic-share-rate-lead", text.thanks + " "));
        if (model.rateUrl) wrap.append(link("bic-share-rate-rate", text.rateToo, model.rateUrl, () => opts.onRate?.()));
        if (model.share.length > 0) {
            if (model.rateUrl) wrap.append(span("bic-share-rate-sep", text.separator));
            const toggle = doc.createElement("button");
            toggle.type = "button";
            toggle.className = "bic-share-rate-toggle";
            toggle.textContent = text.shareMenu;
            toggle.setAttribute("aria-expanded", "false");
            const menu = doc.createElement("span");
            menu.className = "bic-share-rate-menu";
            menu.hidden = true;
            menu.append(span("bic-share-rate-menu-gap", " "));
            appendNetworks(menu);
            toggle.addEventListener("click", () => {
                const open = menu.hidden;
                menu.hidden = !open;
                toggle.setAttribute("aria-expanded", String(open));
                if (open) safely(() => opts.onMenu?.());
            });
            wrap.append(toggle, menu);
        }
    } else if (model.share.length > 0) {
        wrap.append(span("bic-share-rate-lead", text.lead + " "));
        appendNetworks(wrap);
        if (model.rateUrl) {
            wrap.append(span("bic-share-rate-or", text.or + " "));
            wrap.append(link("bic-share-rate-rate", text.rate, model.rateUrl, () => opts.onRate?.()));
        }
        wrap.append(span("bic-share-rate-end", "."));
    } else {
        wrap.append(link("bic-share-rate-rate", text.rateAlone, model.rateUrl!, () => opts.onRate?.()));
        wrap.append(span("bic-share-rate-end", "."));
    }
    if (text.note && opts.layout !== "menu") wrap.append(span("bic-share-rate-note", " " + text.note));

    // A click on the line is the line's: a host page that cancels every click it sees (the visual's) must not see it.
    const stop = (e: Event) => e.stopPropagation();
    wrap.addEventListener("click", stop);

    container.appendChild(wrap);
    safely(() => opts.onShown?.());

    return {
        element: wrap,
        destroy() {
            wrap.removeEventListener("click", stop);
            wrap.remove();
        },
    };
}

function safely(fn: () => void): void {
    try { fn(); } catch { /* a host callback must never break the line */ }
}
