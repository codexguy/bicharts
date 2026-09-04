// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { askApplyImprovements } from "../src/reviewDialog";

// THE CONSENT DIALOG's contract: applying costs money, declining costs nothing, so only a
// deliberate click of Apply may resolve true, and every other way out — including no dialog
// at all — resolves false. The markup is a host concern; the RESOLUTION RULE is what these pin.

function bigContainer(): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 600, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    document.body.appendChild(el);
    return el;
}

const overlay = () => document.getElementById("bic-review-ask-overlay");
const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find(b => b.textContent === label)!;

describe("askApplyImprovements", () => {
    it("resolves TRUE only on a deliberate Apply, and cleans up after itself", async () => {
        const p = askApplyImprovements(bigContainer(), "The y-axis labels overlap.");
        button("Apply").click();
        expect(await p).toBe(true);
        expect(overlay()).toBeNull();
    });

    it("No and Escape resolve false", async () => {
        let p = askApplyImprovements(bigContainer(), "r");
        button("No thanks").click();
        expect(await p).toBe(false);

        p = askApplyImprovements(bigContainer(), "r");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(await p).toBe(false);
    });

    // WAS: "a backdrop click resolves false". Changed deliberately 2026-09-04, not relaxed —
    // the proposal is offered once per generate, so a stray click destroyed a question that
    // could never be asked again. Fail-closed still governs everything that SPENDS.
    it("a BACKDROP click does not answer the question at all", async () => {
        const p = askApplyImprovements(bigContainer(), "r");
        overlay()!.click();
        expect(overlay()).not.toBeNull();          // still on screen, still asking
        let settled = false;
        void p.then(() => { settled = true; });
        await new Promise((r) => setTimeout(r, 0));
        expect(settled).toBe(false);
        button("No thanks").click();
        expect(await p).toBe(false);
    });

    it("a click INSIDE the card does not dismiss — reading the reason must not close the question", async () => {
        const p = askApplyImprovements(bigContainer(), "r");
        (overlay()!.firstElementChild as HTMLElement).click();
        expect(overlay()).not.toBeNull();
        button("No thanks").click();
        await p;
    });

    it("no click escapes the dialog — the live chart underneath must not see it", async () => {
        // The host's own container handler toggles summary panels and clears advisories on a
        // click, so a reader who misses the buttons must not reorganise the chart behind them.
        const host = bigContainer();
        let seen = 0;
        host.addEventListener("click", () => { seen++; });
        const p = askApplyImprovements(host, "r");
        overlay()!.click();                                          // backdrop
        (overlay()!.firstElementChild as HTMLElement).click();       // card
        expect(seen).toBe(0);
        button("No thanks").click();
        expect(await p).toBe(false);
        expect(seen).toBe(0);
    });

    it("shows the judge's own words and states the cost", async () => {
        const p = askApplyImprovements(bigContainer(), "The y-axis labels overlap and are unreadable.");
        const text = overlay()!.textContent ?? "";
        expect(text).toContain("The y-axis labels overlap and are unreadable.");
        expect(text).toContain("uses a generation");
        expect(text).toContain("Declining costs nothing");
        button("No thanks").click();
        await p;
    });

    it("A SURFACE TOO SMALL TO ASK IN IS A NO, and shows nothing", async () => {
        const small = document.createElement("div");
        Object.defineProperty(small, "clientWidth", { value: 200, configurable: true });
        Object.defineProperty(small, "clientHeight", { value: 120, configurable: true });
        document.body.appendChild(small);
        expect(await askApplyImprovements(small, "r")).toBe(false);
        expect(overlay()).toBeNull();
    });

    it("resolves once even when dismissed twice", async () => {
        const p = askApplyImprovements(bigContainer(), "r");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(await p).toBe(false);
    });

    it("hosts can localize the strings without touching the rule", async () => {
        const p = askApplyImprovements(bigContainer(), "", {
            text: { title: "Verbesserungen anwenden?", decline: "Nein danke", accept: "Anwenden", fallbackReason: "Vorschlag." },
        });
        const text = overlay()!.textContent ?? "";
        expect(text).toContain("Verbesserungen anwenden?");
        expect(text).toContain("Vorschlag.");
        button("Anwenden").click();
        expect(await p).toBe(true);
    });

    it("a host card class cannot stretch the question full-bleed", async () => {
        // Hosts reuse existing modal chrome, and one host's card class is width/height 95% —
        // sized for a full-screen viewer. The inline layout must win over any class.
        const p = askApplyImprovements(bigContainer(), "r", { cardClass: "some-fullbleed-card" });
        const card = overlay()!.firstElementChild as HTMLElement;
        expect(card.style.width).toBe("auto");
        expect(card.style.maxWidth).toContain("420px");
        button("No thanks").click();
        await p;
    });
});
