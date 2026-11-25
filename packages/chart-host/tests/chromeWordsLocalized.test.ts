// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSelectionCards, type SelectionCards } from "../src/card";
import { qualifyKindBadgeStyle, QUALIFY_KIND_BADGES, type QualifyKind } from "../src/qualifyTable";
import { HOST_TEXT_CATALOGS } from "../src/strings";
import type { CatalogValue, StringSource } from "../src/hostText";

// THE WORDS CHART-HOST DRAWS AROUND A CHART are the reader's too: the selection card's Pin and Dismiss controls (their
// text, title and accessible label), its "+N more measures" line, and the what-fits kind badge's word. Each comes from
// the host's text source by key, so a reader in another language never meets them in English. The source here brackets
// a real catalog's values, so a word that skipped the catalog is the one left unbracketed; with no source passed, every
// word is the English it always was.

/** The German catalog with every value bracketed (each plural form too): text that reached the reader through the
 *  catalog is bracketed, and English that bypassed it is not. */
function bracketed(): StringSource {
    const de = HOST_TEXT_CATALOGS.de;
    const wrap = (s: string) => `[!! ${s} !!]`;
    return {
        lang: "de",
        get(key: string): CatalogValue | undefined {
            const v = Object.prototype.hasOwnProperty.call(de, key) ? de[key] : undefined;
            if (v == null) return undefined;
            if (typeof v === "string") return wrap(v);
            return Object.fromEntries(Object.entries(v).map(([k, f]) => [k, wrap(f as string)]));
        },
    };
}

const BRACKETED = /^\[!! .+ !!\]$/;

/** A payload with `measures` measure columns, so the card shows four and says how many more there are. */
function payload(measures: number) {
    const cols = [{ name: "City", dataType: "String", isMeasure: false }];
    for (let i = 0; i < measures; i++) cols.push({ name: `M${i + 1}`, dataType: "Double", isMeasure: true });
    cols.push({ name: "__rowIdx__", dataType: "Int64", isMeasure: false });
    const row = (city: string, idx: number) => [city, ...Array.from({ length: measures }, (_, i) => (i + 1) * 10 + idx), idx];
    return { columns: cols, rows: [row("Denver", 0), row("Miami", 1)] };
}

let container: HTMLElement;
let cards: SelectionCards | null = null;

function open(measures: number, strings: StringSource | null): HTMLElement {
    cards = createSelectionCards({
        container,
        getPayload: () => payload(measures),
        getAggregation: () => "sum",
        getEnabled: () => true,
        getPinLimit: () => 3,
        cultureCode: strings ? strings.lang : undefined,
        strings,
    });
    cards.onSelect([0]);
    const card = container.querySelector(".lch-selcard") as HTMLElement;
    expect(card).not.toBeNull();
    return card;
}

function controls(card: HTMLElement) {
    const [pin, close] = Array.from(card.querySelectorAll("button")) as HTMLButtonElement[];
    return { pin, close, more: card.querySelector(".lch-selcard-more") as HTMLElement | null };
}

beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
});
afterEach(() => {
    cards?.destroy();
    cards = null;
    container.remove();
});

describe("the selection card's own controls read the host's text", () => {
    it("Pin and Dismiss: the text, the title and the accessible label all come from the catalog", () => {
        const { pin, close } = controls(open(2, bracketed()));
        expect(pin.textContent).toMatch(BRACKETED);
        expect(pin.title).toMatch(BRACKETED);
        expect(pin.getAttribute("aria-label")).toMatch(BRACKETED);
        expect(close.title).toMatch(BRACKETED);
        expect(close.getAttribute("aria-label")).toMatch(BRACKETED);
        // The close glyph is a symbol, not a word.
        expect(close.textContent).toBe("×");
    });

    it("a pinned card's Pinned comes from the catalog", () => {
        const { pin } = controls(open(2, bracketed()));
        pin.click();
        expect(pin.textContent).toMatch(BRACKETED);
        expect(pin.disabled).toBe(true);
    });

    it("+N more measures is a counted key: one form for 1, another for 3, the count filled", () => {
        const one = controls(open(5, bracketed())).more!;
        expect(one.textContent).toMatch(BRACKETED);
        expect(one.textContent).toContain("1");
        cards!.destroy(); container.textContent = "";
        const three = controls(open(7, bracketed())).more!;
        expect(three.textContent).toMatch(BRACKETED);
        expect(three.textContent).toContain("3");
        expect(three.textContent!.replace("3", "1")).not.toBe(one.textContent);
    });

    it("with no text source, every word is the English it always was", () => {
        const a = controls(open(5, null));
        expect(a.pin.textContent).toBe("Pin");
        expect(a.pin.title).toBe("Keep this card while you click other marks");
        expect(a.pin.getAttribute("aria-label")).toBe("Pin this card");
        expect(a.close.title).toBe("Dismiss");
        expect(a.close.getAttribute("aria-label")).toBe("Dismiss this card");
        expect(a.more!.textContent).toBe("+1 more measure");
        a.pin.click();
        expect(a.pin.textContent).toBe("Pinned");
        cards!.destroy(); container.textContent = "";
        expect(controls(open(7, null)).more!.textContent).toBe("+3 more measures");
    });
});

describe("the kind badge's word reads the host's text", () => {
    const KINDS = Object.keys(QUALIFY_KIND_BADGES) as QualifyKind[];

    it("every kind's word comes from the catalog, on every pane", () => {
        const src = bracketed();
        for (const kind of KINDS) {
            for (const pane of ["light", "dark", { highContrastForeground: "#fff" }] as const) {
                expect(qualifyKindBadgeStyle(kind, pane, src)!.label, `${kind}`).toMatch(BRACKETED);
            }
        }
    });

    it("the colours do not change with the language", () => {
        for (const kind of KINDS) {
            const en = qualifyKindBadgeStyle(kind, "light")!;
            const de = qualifyKindBadgeStyle(kind, "light", bracketed())!;
            expect({ ...de, label: "" }).toEqual({ ...en, label: "" });
        }
    });

    it("with no text source (or null), the English word, as before", () => {
        expect(KINDS.map(k => qualifyKindBadgeStyle(k, "light")!.label)).toEqual(["App", "Table", "Map", "KPI"]);
        expect(KINDS.map(k => qualifyKindBadgeStyle(k, "dark", null)!.label)).toEqual(["App", "Table", "Map", "KPI"]);
        expect(qualifyKindBadgeStyle("chart", "light", bracketed())).toBeNull();
    });
});
