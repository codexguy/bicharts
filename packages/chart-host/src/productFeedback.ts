// "YOUR SUGGESTIONS" - A BOX A READER TYPES INTO, SENT TO THE PRODUCT TEAM (2026-09-16).
//
// A host's landing page is where a person decides whether the product is worth their time, and
// until a chart exists there was no way to tell us what they wanted or why they stopped. This is
// the smallest thing that fixes that: one box, one Send, and a line saying what happened.
//
// WHAT IS SHARED AND WHAT IS NOT. The widget's STATES are the contract every host must agree on,
// because a reader moves between hosts and a box that clears on failure in one of them loses a
// paragraph somebody took the trouble to write:
//
//   * Send is disabled until the box holds something worth sending.
//   * While a send is in flight the button is disabled, so a double click cannot send twice.
//   * SUCCESS clears the box and says so.
//   * FAILURE keeps every word the reader typed and says so inline - never a dialog, never silence.
//   * The text is capped at one length, applied the same way on paste as on typing.
//
// What stays per host is where the box sits, how it looks, the words (hosts localize), and the
// transport: each host already signs requests its own way, so the widget takes a `send` callback
// and never touches the network, a global, or a host API.
//
// THE MESSAGE NEVER REACHES A MODEL. It is product feedback, not a chart prompt, and the payload
// builder below has no field a generation request could read it from. The label and hint say so
// to the reader too, because a free-text box beside a chart prompt invites the two to be confused.

/** The longest message a host will send. Mirrored by the service's own cap. */
export const PRODUCT_FEEDBACK_MAX_CHARS = 2000;
/** Below this there is nothing a person could act on ("ok", "hi"). */
export const PRODUCT_FEEDBACK_MIN_CHARS = 3;

/** Which host a message came from. The service files it under that host. */
export type ProductFeedbackHost = "PBI" | "EXCEL";

/**
 * Clean a typed message for sending: control characters other than line breaks and tabs removed,
 * trailing spaces on each line removed, runs of blank lines collapsed to one, trimmed, and capped.
 * Pure, so every host sends the same bytes for the same keystrokes.
 */
export function normaliseProductFeedbackText(raw: string | null | undefined, maxChars = PRODUCT_FEEDBACK_MAX_CHARS): string {
    const s = String(raw ?? "")
        .replace(/\r\n?/g, "\n")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .split("\n").map(line => line.replace(/[ \t]+$/, "")).join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return s.length > maxChars ? s.slice(0, maxChars).trimEnd() : s;
}

/** True when a message is long enough to send. */
export function productFeedbackSendable(raw: string | null | undefined, maxChars = PRODUCT_FEEDBACK_MAX_CHARS): boolean {
    return normaliseProductFeedbackText(raw, maxChars).length >= PRODUCT_FEEDBACK_MIN_CHARS;
}

/** The credentials a host already holds, forwarded so the service can attach an account when there is one. The
 *  service resolves identity itself; nothing here names an account. Absent fields are sent empty. */
export interface ProductFeedbackIdentity {
    licenseKey?: string;
    licensee?: string;
    secretKey?: string;
    freemiumKey?: string;
    linkNonce?: string;
    instanceKey?: string;
    clientId?: string;
}

export interface ProductFeedbackPayload {
    text: string;
    host: ProductFeedbackHost;
    surface: string;
    clientVersion: string;
    correlationId: string;
    clientId: string;
    licenseKey: string;
    licensee: string;
    secretKey: string;
    freemiumKey: string;
    linkNonce: string;
    instanceKey: string;
}

/** The request body every host sends (before its own encoding and signing). */
export function buildProductFeedbackPayload(input: {
    text: string;
    host: ProductFeedbackHost;
    surface?: string;
    clientVersion: string;
    correlationId: string;
    identity?: ProductFeedbackIdentity;
}): ProductFeedbackPayload {
    const id = input.identity ?? {};
    return {
        text: normaliseProductFeedbackText(input.text),
        host: input.host,
        surface: input.surface || "landing",
        clientVersion: input.clientVersion || "",
        correlationId: input.correlationId || "",
        clientId: id.clientId || "",
        licenseKey: id.licenseKey || "",
        licensee: id.licensee || "",
        secretKey: id.secretKey || "",
        freemiumKey: id.freemiumKey || "",
        linkNonce: id.linkNonce || "",
        instanceKey: id.instanceKey || "",
    };
}

/** What a host's send callback reports. `message` is shown to the reader when present. */
export interface ProductFeedbackSendResult {
    ok: boolean;
    message?: string;
}

/** The words a reader sees. Hosts localize; every field has an English default. */
export interface ProductFeedbackText {
    label?: string;
    placeholder?: string;
    hint?: string;
    send?: string;
    sending?: string;
    sent?: string;
    failed?: string;
}

const DEFAULT_TEXT: Required<ProductFeedbackText> = {
    label: "Your suggestions",
    placeholder: "An idea, a missing chart, or something that got in your way",
    hint: "Sent to our team. It is never used to draw a chart.",
    send: "Send",
    sending: "Sending...",
    sent: "Thank you - your suggestion was sent.",
    failed: "Your suggestion could not be sent. It is still in the box - please try again.",
};

export interface ProductFeedbackBoxOptions {
    /** Delivers the cleaned text. Resolve { ok: false } (or throw) on failure; the box keeps the text either way. */
    send: (text: string) => Promise<ProductFeedbackSendResult>;
    text?: ProductFeedbackText;
    /** Added to the wrapper so the host can skin it; the structure stays the same. */
    className?: string;
    maxChars?: number;
    /** Called once, when the box is mounted - the host's "shown" counter. */
    onShown?: () => void;
    /** Called after a successful send - the host's "sent" counter. */
    onSent?: () => void;
    /** Called after a failed send, with what failed, so the host can log it. */
    onFailed?: (reason: string) => void;
}

export interface ProductFeedbackBox {
    element: HTMLElement;
    /** Removes the box and its listeners. */
    destroy(): void;
}

/**
 * Build the box inside `container`. The wrapper carries `bic-product-feedback` (plus the host's
 * class); the textarea, button and status line carry `bic-product-feedback-input`, `-send` and
 * `-status`, so hosts and tests can find them without depending on the order of elements.
 */
export function mountProductFeedbackBox(container: HTMLElement, opts: ProductFeedbackBoxOptions): ProductFeedbackBox {
    const doc = container.ownerDocument ?? document;
    const text = { ...DEFAULT_TEXT, ...(opts.text ?? {}) };
    const maxChars = Math.max(PRODUCT_FEEDBACK_MIN_CHARS, Math.floor(opts.maxChars ?? PRODUCT_FEEDBACK_MAX_CHARS));

    const wrap = doc.createElement("div");
    wrap.className = "bic-product-feedback" + (opts.className ? " " + opts.className : "");

    const inputId = "bic-product-feedback-" + (++mounted);
    const label = doc.createElement("label");
    label.className = "bic-product-feedback-label";
    label.htmlFor = inputId;
    label.textContent = text.label;

    const input = doc.createElement("textarea");
    input.className = "bic-product-feedback-input";
    input.id = inputId;
    input.rows = 2;
    input.maxLength = maxChars;
    input.placeholder = text.placeholder;
    input.setAttribute("aria-describedby", inputId + "-hint");

    const hint = doc.createElement("div");
    hint.className = "bic-product-feedback-hint";
    hint.id = inputId + "-hint";
    hint.textContent = text.hint;

    const row = doc.createElement("div");
    row.className = "bic-product-feedback-row";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "bic-product-feedback-send";
    button.textContent = text.send;
    const status = doc.createElement("span");
    status.className = "bic-product-feedback-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    row.append(button, status);

    wrap.append(label, input, hint, row);
    container.appendChild(wrap);

    let sending = false;
    const sync = () => { button.disabled = sending || !productFeedbackSendable(input.value, maxChars); };
    const onInput = () => {
        // A new keystroke after a result starts a new message: the old line no longer describes it.
        if (!sending && status.textContent) { status.textContent = ""; status.removeAttribute("data-state"); }
        sync();
    };

    const onClick = async () => {
        if (sending || !productFeedbackSendable(input.value, maxChars)) return;
        const message = normaliseProductFeedbackText(input.value, maxChars);
        sending = true;
        sync();
        button.textContent = text.sending;
        status.textContent = "";
        status.removeAttribute("data-state");
        let result: ProductFeedbackSendResult;
        let failure = "";
        try {
            result = await opts.send(message);
            if (!result?.ok) failure = result?.message || "not sent";
        } catch (e: any) {
            result = { ok: false };
            failure = String(e?.message ?? e);
        }
        sending = false;
        button.textContent = text.send;
        if (result?.ok) {
            input.value = "";
            status.textContent = result.message || text.sent;
            status.setAttribute("data-state", "sent");
            safely(() => opts.onSent?.());
        } else {
            // The reader's words stay exactly where they were.
            status.textContent = result?.message || text.failed;
            status.setAttribute("data-state", "failed");
            safely(() => opts.onFailed?.(failure));
        }
        sync();
    };

    input.addEventListener("input", onInput);
    button.addEventListener("click", onClick);
    sync();
    safely(() => opts.onShown?.());

    return {
        element: wrap,
        destroy() {
            input.removeEventListener("input", onInput);
            button.removeEventListener("click", onClick);
            wrap.remove();
        },
    };
}

let mounted = 0;

function safely(fn: () => void): void {
    try { fn(); } catch { /* a host callback must never break the box */ }
}
