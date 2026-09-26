// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSelectionCards, type SelectionCards, type SelectionCardsDeps } from "../src/index";

// THE CARD IS THE ANSWER A CLICK GETS, so these tests are mostly about the moments it must NOT
// appear or must NOT linger. A card that shows up correctly is easy; a card that survives the
// chart it describes, or covers an error message, or cannot be dismissed, is the failure that
// makes the feature worse than not having it.

const CARD = ".lch-selcard";

/** The payload shape buildRenderPayload emits: real columns, then the trailing __rowIdx__. */
function payload() {
    return {
        columns: [
            { name: "City", dataType: "String", isMeasure: false },
            { name: "Revenue", dataType: "Double", isMeasure: true },
            { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
        ],
        rows: [
            ["Denver", 100, 0],
            ["Miami", 200, 1],
            ["Boston", 300, 2],
            ["Tulsa", 400, 3],
        ],
    };
}

let container: HTMLElement;
let cards: SelectionCards;
let enabled = true;
let pinLimit = 3;

function build(over: Partial<SelectionCardsDeps> = {}): SelectionCards {
    return createSelectionCards({
        container,
        getPayload: () => payload(),
        getAggregation: () => "sum",
        getEnabled: () => enabled,
        getPinLimit: () => pinLimit,
        ...over,
    });
}

function shown(): HTMLElement[] {
    return Array.from(container.querySelectorAll(CARD)) as HTMLElement[];
}

/** The Pin / dismiss controls, by their accessible label rather than by DOM position - position
 *  is exactly the thing a later layout change is allowed to alter. */
function btn(card: HTMLElement, label: string): HTMLButtonElement {
    return card.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
}

beforeEach(() => {
    enabled = true;
    pinLimit = 3;
    container = document.createElement("div");
    document.body.append(container);
    cards = build();
});

afterEach(() => {
    cards.destroy();
    container.remove();
});

describe("the card appears for a selection", () => {
    it("states the header, the measure and the row count", () => {
        cards.onSelect([0, 1]);
        const card = shown()[0];
        expect(card).toBeTruthy();
        expect(card.textContent).toContain("Denver, Miami");
        expect(card.textContent).toContain("Sum of Revenue");
        expect(card.textContent).toContain("2 of 4 rows");
    });

    it("lives INSIDE the container, because nothing a chart draws escapes its frame", () => {
        cards.onSelect([0]);
        expect(shown()[0].parentElement).toBe(container);
        expect(document.body.querySelectorAll(`:scope > ${CARD}`).length).toBe(0);
    });

    it("REPLACES the previous card rather than stacking one per click", () => {
        cards.onSelect([0]);
        cards.onSelect([1]);
        expect(shown()).toHaveLength(1);
        expect(shown()[0].textContent).toContain("Miami");
    });

    it("never uses innerHTML for the reader's text - a value can contain markup", () => {
        const evil = {
            columns: [
                { name: "City", dataType: "String", isMeasure: false },
                { name: "Revenue", dataType: "Double", isMeasure: true },
                { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
            ],
            rows: [["<img src=x onerror=alert(1)>", 5, 0]],
        };
        const c = build({ getPayload: () => evil });
        c.onSelect([0]);
        const card = shown()[0];
        expect(card.querySelector("img")).toBeNull();
        expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
        c.destroy();
    });

    it("carries a Pin and a Dismiss control, each with an accessible label", () => {
        cards.onSelect([0]);
        const card = shown()[0];
        expect(btn(card, "Pin this card").textContent).toBe("Pin");
        expect(btn(card, "Dismiss this card")).toBeTruthy();
    });
});

describe("the card goes away", () => {
    it("dismisses on an EMPTY selection - the second click on a mark clears", () => {
        cards.onSelect([0]);
        expect(shown()).toHaveLength(1);
        cards.onSelect([]);
        expect(shown()).toHaveLength(0);
    });

    it("dismisses on its own close control", () => {
        cards.onSelect([0]);
        btn(shown()[0], "Dismiss this card").click();
        expect(shown()).toHaveLength(0);
    });

    it("dismissing a PINNED card removes only that one", () => {
        cards.onSelect([0]);
        btn(shown()[0], "Pin this card").click();
        cards.onSelect([1]);
        const pinnedCard = shown().find(c => c.classList.contains("lch-selcard--pinned"))!;
        btn(pinnedCard, "Dismiss this card").click();
        expect(shown()).toHaveLength(1);
        expect(shown()[0].textContent).toContain("Miami");
    });

    it("dismisses on Esc, PINS INCLUDED - nothing may be undismissable", () => {
        cards.onSelect([0]);
        btn(shown()[0], "Pin this card").click();
        cards.onSelect([1]);
        expect(shown().length).toBeGreaterThan(1);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(shown()).toHaveLength(0);
    });

    it("any other key leaves the cards alone", () => {
        cards.onSelect([0]);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        expect(shown()).toHaveLength(1);
    });

    it("clear() drops everything, which is what a new chart needs", () => {
        cards.onSelect([0]);
        btn(shown()[0], "Pin this card").click();
        cards.clear();
        expect(shown()).toHaveLength(0);
    });

    it("destroy() stops the instance responding", () => {
        cards.onSelect([0]);
        cards.destroy();
        expect(shown()).toHaveLength(0);
        cards.onSelect([1]);
        expect(shown()).toHaveLength(0);
    });
});

describe("pinning - the mini dashboard", () => {
    it("a pinned card SURVIVES the next selection, so two sit side by side", () => {
        cards.onSelect([0]);
        btn(shown()[0], "Pin this card").click();
        cards.onSelect([2]);
        const texts = shown().map(c => c.textContent ?? "");
        expect(texts).toHaveLength(2);
        expect(texts.some(t => t.includes("Denver"))).toBe(true);
        expect(texts.some(t => t.includes("Boston"))).toBe(true);
    });

    it("a pinned card reads Pinned, disabled, and carries the pinned class", () => {
        cards.onSelect([0]);
        const b = btn(shown()[0], "Pin this card");
        b.click();
        expect(b.textContent).toBe("Pinned");
        expect(b.disabled).toBe(true);
        expect(shown()[0].classList.contains("lch-selcard--pinned")).toBe(true);
    });

    it("a pinned card survives an empty selection too - the pin is the point", () => {
        cards.onSelect([0]);
        btn(shown()[0], "Pin this card").click();
        cards.onSelect([]);
        expect(shown()).toHaveLength(1);
    });

    it("evicts the OLDEST past the configured limit", () => {
        pinLimit = 2;
        for (const i of [0, 1, 2]) {
            cards.onSelect([i]);
            btn(shown().find(c => !c.classList.contains("lch-selcard--pinned"))!, "Pin this card").click();
        }
        const texts = shown().map(c => c.textContent ?? "");
        expect(texts).toHaveLength(2);
        expect(texts.some(t => t.includes("Denver"))).toBe(false);
        expect(texts.some(t => t.includes("Boston"))).toBe(true);
    });

    it("honours a limit of 1", () => {
        pinLimit = 1;
        cards.onSelect([0]);
        btn(shown()[0], "Pin this card").click();
        cards.onSelect([1]);
        btn(shown().find(c => !c.classList.contains("lch-selcard--pinned"))!, "Pin this card").click();
        expect(shown()).toHaveLength(1);
        expect(shown()[0].textContent).toContain("Miami");
    });

    it("a limit of 0 means the default of 3", () => {
        pinLimit = 0;
        for (const i of [0, 1, 2, 3]) {
            cards.onSelect([i]);
            btn(shown().find(c => !c.classList.contains("lch-selcard--pinned"))!, "Pin this card").click();
        }
        expect(shown()).toHaveLength(3);
    });

    it("pinning twice is idempotent rather than adding a duplicate", () => {
        cards.onSelect([0]);
        const b = btn(shown()[0], "Pin this card");
        b.click();
        b.click();
        expect(shown()).toHaveLength(1);
    });
});

describe("the setting, and the failures that must stay quiet", () => {
    it("draws NOTHING when the preference is off", () => {
        enabled = false;
        cards.onSelect([0, 1]);
        expect(shown()).toHaveLength(0);
    });

    it("takes the preference off MID-SESSION and clears what is up", () => {
        cards.onSelect([0]);
        expect(shown()).toHaveLength(1);
        enabled = false;
        cards.onSelect([1]);
        expect(shown()).toHaveLength(0);
    });

    it("a payload that computes to nothing draws no card and does not throw", () => {
        const c = build({ getPayload: () => ({ columns: [], rows: [] }) });
        expect(() => c.onSelect([0])).not.toThrow();
        expect(shown()).toHaveLength(0);
        c.destroy();
    });

    it("A THROWING PAYLOAD NEVER BREAKS THE CHART - a card is a courtesy on top of a render", () => {
        const boom = () => { throw new Error("payload gone"); };
        const seen: string[] = [];
        const c = build({ getPayload: boom, log: (tag: string) => { seen.push(tag); } });
        expect(() => c.onSelect([0])).not.toThrow();
        expect(shown()).toHaveLength(0);
        expect(seen).toContain("selcard-failed");
        c.destroy();
    });

    it("a column the classifier withheld is logged, never shown", () => {
        const seen: Array<{ tag: string; detail: any }> = [];
        const geo = {
            columns: [
                { name: "City", dataType: "String", isMeasure: false },
                { name: "Latitude", dataType: "Double", isMeasure: true },
                { name: "Revenue", dataType: "Double", isMeasure: true },
                { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
            ],
            rows: [["Denver", 39.7, 100, 0]],
        };
        const c = build({ getPayload: () => geo, log: (tag: string, detail?: unknown) => { seen.push({ tag, detail }); } });
        c.onSelect([0]);
        expect(shown()[0].textContent).not.toContain("Latitude");
        expect(seen.find(s => s.tag === "selcard-not-aggregatable")?.detail).toEqual({ columns: "Latitude" });
        c.destroy();
    });
});

describe("a date reaches the reader in the source's own formatting", () => {
    function datedPayload() {
        return {
            columns: [
                { name: "Week", dataType: "DateTime", isMeasure: false },
                { name: "Reading", dataType: "Double", isMeasure: true },
                { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
            ],
            rows: [["2025-08-31T00:00:00.000Z", 100, 0], ["2025-09-07T00:00:00.000Z", 200, 1]],
        };
    }

    it("renders the source's own format when the host supplies one", () => {
        const c = build({
            getPayload: () => datedPayload(),
            getSourceFormats: () => ({ dialect: "excel", byColumn: { Week: "d-mmm-yy" } }),
            cultureCode: "en-US",
        });
        c.onSelect([0]);
        expect(shown()[0].textContent).toContain("31-Aug-25");
        c.destroy();
    });

    it("still never shows the ISO instant when no format is supplied", () => {
        const c = build({ getPayload: () => datedPayload(), cultureCode: "en-US" });
        c.onSelect([0]);
        const text = shown()[0].textContent ?? "";
        expect(text).toContain("Aug 31, 2025");
        expect(text).not.toContain("T00:00");
        c.destroy();
    });
});

// jsdom lays nothing out, so every size below is stated: the container's client box and each
// card's offset box. What is pinned is the chrome's arithmetic over those sizes.
describe("placement, the compact card, and dragging - over stated sizes", () => {
    let restore: Array<() => void> = [];
    function stub(proto: object, prop: string, get: (this: HTMLElement) => number) {
        const prev = Object.getOwnPropertyDescriptor(proto, prop);
        Object.defineProperty(proto, prop, { configurable: true, get });
        restore.push(() => { if (prev) Object.defineProperty(proto, prop, prev); else delete (proto as any)[prop]; });
    }
    let cardW = 120, cardH = 60;
    const lineCount = (el: HTMLElement) => el.querySelectorAll(".lch-selcard-line").length;

    beforeEach(() => {
        cardW = 120; cardH = 60;
        stub(HTMLElement.prototype, "clientWidth", function () { return this === container ? 400 : 0; });
        stub(HTMLElement.prototype, "clientHeight", function () { return this === container ? 300 : 0; });
        stub(HTMLElement.prototype, "offsetWidth", function () { return this.classList.contains("lch-selcard") ? cardW : 0; });
        stub(HTMLElement.prototype, "offsetHeight", function () { return this.classList.contains("lch-selcard") ? cardH : 0; });
        (container as any).getBoundingClientRect = () => ({ left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300, x: 10, y: 20 });
    });
    afterEach(() => { for (const r of restore.reverse()) r(); restore = []; });

    function clickAt(clientX: number, clientY: number) {
        container.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
    }

    it("opens beside the click, 12px down and right of it, in container coordinates", () => {
        clickAt(110, 120);           // (100, 100) inside the container
        cards.onSelect([0]);
        const el = shown()[0];
        expect(el.style.left).toBe("112px");
        expect(el.style.top).toBe("112px");
        expect(el.style.visibility).toBe("visible");
    });

    it("flips to the left and above when the card would cross the right or bottom edge", () => {
        clickAt(10 + 350, 20 + 280); // (350, 280): 350+12+120 > 394, 280+12+60 > 294
        cards.onSelect([0]);
        const el = shown()[0];
        expect(el.style.left).toBe(`${350 - 12 - 120}px`);
        expect(el.style.top).toBe(`${280 - 12 - 60}px`);
    });

    it("never leaves the frame, even when neither side fits", () => {
        cardW = 395;
        clickAt(10 + 200, 20 + 10);
        cards.onSelect([0]);
        const el = shown()[0];
        expect(parseInt(el.style.left, 10)).toBeGreaterThanOrEqual(6);
    });

    it("keeps its measure lines while it covers at most 30% of the tile", () => {
        cardW = 200; cardH = 180;    // 36,000 of 120,000 = 30%
        cards.onSelect([0]);
        expect(lineCount(shown()[0])).toBeGreaterThan(0);
    });

    it("sheds its measure lines past 30% of the tile, keeping the header and the row count, and logs it", () => {
        const seen: string[] = [];
        const c = build({ log: (tag: string) => { seen.push(tag); } });
        cardW = 200; cardH = 181;
        c.onSelect([0, 1]);
        const el = shown().filter(e => e.style.visibility === "visible");
        expect(el).toHaveLength(1);
        expect(lineCount(el[0])).toBe(0);
        expect(el[0].textContent).toContain("Denver, Miami");
        expect(el[0].textContent).toContain("2 of 4 rows");
        expect(seen).toContain("selcard-compact");
        expect(shown()).toHaveLength(1);    // the full card it measured first is gone
        c.destroy();
    });

    it("a drag by the head moves the card, bounded by the frame", () => {
        clickAt(110, 120);
        cards.onSelect([0]);
        const el = shown()[0];
        const head = el.querySelector(".lch-selcard-head") as HTMLElement;
        head.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 40 }));
        expect(el.style.left).toBe("142px");
        expect(el.style.top).toBe("152px");
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000, clientY: 5000 }));
        expect(el.style.left).toBe(`${400 - 120 - 4}px`);
        expect(el.style.top).toBe(`${300 - 60 - 4}px`);
        document.dispatchEvent(new MouseEvent("mouseup", {}));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 0 }));
        expect(el.style.left).toBe(`${400 - 120 - 4}px`);
    });
});
