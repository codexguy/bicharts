// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
    mountProductFeedbackBox, normaliseProductFeedbackText, productFeedbackSendable, buildProductFeedbackPayload,
    PRODUCT_FEEDBACK_MAX_CHARS,
} from "../src/productFeedback";

// THE BOX'S CONTRACT is its states, and the one that matters most is the failure: a reader who typed a paragraph and
// pressed Send must never lose it to a dropped connection. The markup and the transport are host concerns; these pin
// what every host shows.

function mount(send: (t: string) => Promise<{ ok: boolean; message?: string }>, extra: Record<string, unknown> = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const box = mountProductFeedbackBox(container, { send, ...extra });
    const q = <T extends Element>(sel: string) => box.element.querySelector(sel) as unknown as T;
    const input = q<HTMLTextAreaElement>(".bic-product-feedback-input");
    const button = q<HTMLButtonElement>(".bic-product-feedback-send");
    const status = q<HTMLElement>(".bic-product-feedback-status");
    const type = (s: string) => { input.value = s; input.dispatchEvent(new Event("input")); };
    return { box, input, button, status, type };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe("mountProductFeedbackBox", () => {
    it("keeps Send disabled until there is something worth sending", () => {
        const { button, type } = mount(async () => ({ ok: true }));
        expect(button.disabled).toBe(true);
        type("   ");
        expect(button.disabled).toBe(true);
        type("ok");
        expect(button.disabled).toBe(true);
        type("Please add a waterfall chart");
        expect(button.disabled).toBe(false);
    });

    it("sends the cleaned text, clears the box on success and says so", async () => {
        const send = vi.fn(async () => ({ ok: true }));
        const onSent = vi.fn();
        const { input, button, status, type } = mount(send, { onSent });
        type("  Please add a waterfall chart  \n\n\n\nThanks  ");
        button.click();
        await flush();
        expect(send).toHaveBeenCalledWith("Please add a waterfall chart\n\nThanks");
        expect(input.value).toBe("");
        expect(status.getAttribute("data-state")).toBe("sent");
        expect(status.textContent).toMatch(/sent/i);
        expect(button.disabled).toBe(true);
        expect(onSent).toHaveBeenCalledTimes(1);
    });

    it("KEEPS the reader's words on a failure, shows the service's sentence, and reports it once", async () => {
        const onFailed = vi.fn();
        const { input, button, status, type } = mount(async () => ({ ok: false, message: "Too many suggestions from here - please try again later." }), { onFailed });
        type("A long thoughtful paragraph");
        button.click();
        await flush();
        expect(input.value).toBe("A long thoughtful paragraph");
        expect(status.getAttribute("data-state")).toBe("failed");
        expect(status.textContent).toBe("Too many suggestions from here - please try again later.");
        expect(button.disabled).toBe(false);
        expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it("treats a thrown send as a failure with the default sentence, and never throws itself", async () => {
        const onFailed = vi.fn();
        const { input, button, status, type } = mount(async () => { throw new Error("network down"); }, { onFailed });
        type("Something went wrong for me");
        button.click();
        await flush();
        expect(input.value).toBe("Something went wrong for me");
        expect(status.textContent).toMatch(/still in the box/);
        expect(onFailed).toHaveBeenCalledWith("network down");
        expect(onFailed).toHaveBeenCalledTimes(1);
    });

    it("cannot send twice while a send is in flight", async () => {
        let release!: (v: { ok: boolean }) => void;
        const send = vi.fn(() => new Promise<{ ok: boolean }>(r => { release = r; }));
        const { button, type } = mount(send);
        type("Double click test");
        button.click();
        button.click();
        expect(button.disabled).toBe(true);
        expect(send).toHaveBeenCalledTimes(1);
        release({ ok: true });
        await flush();
    });

    it("clears a stale result line when the reader starts a new message", async () => {
        const { button, status, type } = mount(async () => ({ ok: true }));
        type("First message");
        button.click();
        await flush();
        expect(status.textContent).not.toBe("");
        type("S");
        expect(status.textContent).toBe("");
    });

    it("uses the host's words, caps the textarea, and reports shown once; destroy removes it", () => {
        const onShown = vi.fn();
        const { box, input, button } = mount(async () => ({ ok: true }), {
            onShown, maxChars: 50, className: "host-skin",
            text: { label: "Vos suggestions", send: "Envoyer" },
        });
        expect(onShown).toHaveBeenCalledTimes(1);
        expect(box.element.className).toBe("bic-product-feedback host-skin");
        expect(box.element.querySelector("label")!.textContent).toBe("Vos suggestions");
        expect(button.textContent).toBe("Envoyer");
        expect(input.maxLength).toBe(50);
        const parent = box.element.parentElement!;
        box.destroy();
        expect(parent.querySelector(".bic-product-feedback")).toBeNull();
    });

    it("a host callback that throws never breaks the box", async () => {
        const { button, status, type } = mount(async () => ({ ok: true }), { onShown: () => { throw new Error("x"); }, onSent: () => { throw new Error("y"); } });
        type("Still works");
        button.click();
        await flush();
        expect(status.getAttribute("data-state")).toBe("sent");
    });
});

describe("normaliseProductFeedbackText and the payload", () => {
    it("removes control characters but keeps line breaks and tabs", () => {
        const nul = String.fromCharCode(0), bell = String.fromCharCode(7), del = String.fromCharCode(127);
        expect(normaliseProductFeedbackText("a" + nul + "b" + bell + "c" + del + "\td\r\ne")).toBe("abc\td\ne");
    });

    it("caps at the shared maximum and judges sendability after cleaning", () => {
        expect(normaliseProductFeedbackText("x".repeat(PRODUCT_FEEDBACK_MAX_CHARS + 50)).length).toBe(PRODUCT_FEEDBACK_MAX_CHARS);
        expect(productFeedbackSendable("  ab  ")).toBe(false);
        expect(productFeedbackSendable(" abc ")).toBe(true);
        expect(productFeedbackSendable(null)).toBe(false);
    });

    it("builds one payload shape for every host, with empty strings for absent credentials", () => {
        const p = buildProductFeedbackPayload({
            text: "  More maps  ", host: "EXCEL", clientVersion: "1.0.0.39", correlationId: "c-1",
            identity: { linkNonce: "n", clientId: "x123" },
        });
        expect(p).toEqual({
            text: "More maps", host: "EXCEL", surface: "landing", clientVersion: "1.0.0.39", correlationId: "c-1",
            clientId: "x123", licenseKey: "", licensee: "", secretKey: "", freemiumKey: "", linkNonce: "n", instanceKey: "",
        });
    });
});
