// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { shareRateLineModel, mountShareRateLine } from "../src/shareRate";

// THE LINE'S CONTRACT: the service decides and supplies every URL; the line draws only https links, keeps the service's
// order, opens nothing itself (every click goes through the host's `open`), and never lets a click reach the host page.

const LISTING = "https://marketplace.microsoft.com/en-us/product/WA200012179";
const li = { id: "li", label: "LinkedIn", url: "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fexample.com%2F%3Floc%3Dsh-li-xls" };
const fb = { id: "fb", label: "Facebook", url: "https://www.facebook.com/sharer/sharer.php?u=x" };
const x = { id: "x", label: "X", url: "https://x.com/intent/post?url=x" };
const ask = { productUrl: "https://example.com/product", rateUrl: LISTING, targets: [li, fb, x] };

describe("shareRateLineModel", () => {
    it("draws nothing for an absent block", () => {
        expect(shareRateLineModel(undefined)).toBeNull();
        expect(shareRateLineModel(null)).toBeNull();
        expect(shareRateLineModel({})).toBeNull();
    });

    it("keeps the service's order and both casings", () => {
        expect(shareRateLineModel(ask)).toEqual({ share: [li, fb, x], rateUrl: LISTING });
        const pascal = { RateUrl: LISTING, Targets: [{ Id: "x", Label: "X", Url: x.url }, { Id: "li", Label: "LinkedIn", Url: li.url }] };
        expect(shareRateLineModel(pascal)!.share.map(t => t.id)).toEqual(["x", "li"]);
    });

    it("drops anything that is not https, malformed or repeated", () => {
        const m = shareRateLineModel({
            rateUrl: "http://marketplace.microsoft.com/x",
            targets: [
                { id: "li", label: "LinkedIn", url: "javascript:alert(1)" },
                { id: "fb", label: "Facebook", url: "http://www.facebook.com/" },
                { id: "Bad Id", label: "Bad", url: "https://b.example/" },
                { id: "nl", label: "", url: "https://n.example/" },
                x,
                { ...x, label: "X again" },
            ],
        });
        expect(m).toEqual({ share: [x], rateUrl: null });
        expect(shareRateLineModel({ rateUrl: "not a url", targets: [] })).toBeNull();
    });

    it("still offers the rating when no network survives", () => {
        expect(shareRateLineModel({ rateUrl: LISTING, targets: [] })).toEqual({ share: [], rateUrl: LISTING });
    });
});

function mount(extra: Record<string, unknown> = {}) {
    const page = document.createElement("div");
    const pageClick = vi.fn();
    page.addEventListener("click", pageClick);
    document.body.appendChild(page);
    const open = vi.fn();
    const line = mountShareRateLine(page, { ask, open, ...extra } as any);
    return { page, pageClick, open, line };
}

describe("mountShareRateLine", () => {
    it("draws the networks, then the rating, with the default words", () => {
        const { line } = mount();
        const el = line!.element;
        expect(el.textContent).toBe("Like it? Share it on LinkedIn · Facebook · X, or rate it on AppSource. Your ratings and feedback encourage us to do more.");
        expect([...el.querySelectorAll(".bic-share-rate-share")].map(a => a.getAttribute("data-target"))).toEqual(["li", "fb", "x"]);
        expect((el.querySelector(".bic-share-rate-rate") as HTMLAnchorElement).href).toBe(LISTING);
    });

    it("opens through the host's open, and the click never reaches the page", () => {
        const onShare = vi.fn(), onRate = vi.fn();
        const { line, open, pageClick } = mount({ onShare, onRate });
        const share = line!.element.querySelector('[data-target="fb"]') as HTMLAnchorElement;
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        share.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);                 // the line never navigates by itself
        expect(open).toHaveBeenCalledWith(fb.url);
        expect(onShare).toHaveBeenCalledWith("fb");
        (line!.element.querySelector(".bic-share-rate-rate") as HTMLElement).click();
        expect(open).toHaveBeenLastCalledWith(LISTING);
        expect(onRate).toHaveBeenCalledTimes(1);
        expect(pageClick).not.toHaveBeenCalled();
    });

    it("fires shown once, and draws nothing (and counts nothing) without links", () => {
        const onShown = vi.fn();
        mount({ onShown });
        expect(onShown).toHaveBeenCalledTimes(1);
        const none = vi.fn();
        const { line, page } = mount({ ask: undefined, onShown: none });
        expect(line).toBeNull();
        expect(page.childElementCount).toBe(0);
        expect(none).not.toHaveBeenCalled();
    });

    it("words a rating-only line on its own, and takes the host's words", () => {
        const { line } = mount({ ask: { rateUrl: LISTING, targets: [] }, text: { rateAlone: "Gefällt es Ihnen? Bewerten Sie es", note: "" } });
        expect(line!.element.textContent).toBe("Gefällt es Ihnen? Bewerten Sie es.");
    });

    it("a host callback that throws does not stop the link opening", () => {
        const { line, open } = mount({ onShare: () => { throw new Error("counter down"); } });
        (line!.element.querySelector('[data-target="x"]') as HTMLElement).click();
        expect(open).toHaveBeenCalledWith(x.url);
    });

    it("destroy removes it", () => {
        const { line, page } = mount();
        line!.destroy();
        expect(page.querySelector(".bic-share-rate")).toBeNull();
    });
});

// AFTER A VOTE the line is short - thanks, the rate link, and "Share it" - and the networks wait behind that toggle.
// The same line follows every vote; nothing here knows the value.
describe("mountShareRateLine, menu layout", () => {
    it("reads 'Thanks for rating it. Rate it on AppSource too · Share it' with the networks hidden", () => {
        const { line } = mount({ layout: "menu" });
        const el = line!.element;
        const menu = el.querySelector(".bic-share-rate-menu") as HTMLElement;
        expect(menu.hidden).toBe(true);
        menu.remove();                                   // the visible sentence, without the hidden networks
        expect(el.textContent).toBe("Thanks for rating it. Rate it on AppSource too · Share it");
    });

    it("the toggle reveals the networks in the service's order, and they open and count like the landing line's", () => {
        const onMenu = vi.fn(), onShare = vi.fn(), onRate = vi.fn();
        const { line, open, pageClick } = mount({ layout: "menu", onMenu, onShare, onRate });
        const el = line!.element;
        const toggle = el.querySelector(".bic-share-rate-toggle") as HTMLButtonElement;
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        toggle.click();
        expect((el.querySelector(".bic-share-rate-menu") as HTMLElement).hidden).toBe(false);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(onMenu).toHaveBeenCalledTimes(1);
        expect([...el.querySelectorAll(".bic-share-rate-menu .bic-share-rate-share")].map(a => a.getAttribute("data-target"))).toEqual(["li", "fb", "x"]);
        (el.querySelector('[data-target="x"]') as HTMLElement).click();
        expect(open).toHaveBeenCalledWith(x.url);
        expect(onShare).toHaveBeenCalledWith("x");
        (el.querySelector(".bic-share-rate-rate") as HTMLElement).click();
        expect(open).toHaveBeenLastCalledWith(LISTING);
        expect(onRate).toHaveBeenCalledTimes(1);
        toggle.click();                                   // closing is not another open
        expect(onMenu).toHaveBeenCalledTimes(1);
        expect(pageClick).not.toHaveBeenCalled();
    });

    it("drops the toggle with no networks, and the rate link with no listing", () => {
        const rateOnly = mount({ layout: "menu", ask: { rateUrl: LISTING, targets: [] } }).line!.element;
        expect(rateOnly.querySelector(".bic-share-rate-toggle")).toBeNull();
        expect(rateOnly.textContent).toBe("Thanks for rating it. Rate it on AppSource too");
        const shareOnly = mount({ layout: "menu", ask: { targets: [li] } }).line!.element;
        expect(shareOnly.querySelector(".bic-share-rate-rate")).toBeNull();
        expect(shareOnly.querySelector(".bic-share-rate-toggle")).not.toBeNull();
    });
});
