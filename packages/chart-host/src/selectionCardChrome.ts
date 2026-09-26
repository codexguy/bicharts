// THE CARD THAT ANSWERS A CLICK - the chrome around computeSelectionCard: where the card opens,
// how it is pinned, when it is dismissed, and what it sheds when the tile is too small for it.
//
// THE PROMISE THIS KEEPS. Clicking a mark already dims every mark outside the selection, in every
// chart type. Where the host has a report to cross-filter, the dimming is the opening of an
// answer; where it has none (a worksheet, a page), the dimming was the entire response - the UI
// said "this is interactive", the reader interacted, and nothing answered. The card answers.
//
// ARITHMETIC IS NOT HERE. computeSelectionCard (selectionCard.ts) works over the {columns, rows}
// payload every host already holds, which is what makes the capability true for ALL chart types,
// including charts cached long before it existed. What lives here is chrome, and every host that
// mounts a card mounts this one, so they cannot disagree about placement, pins or dismissal.
//
// THE HOOK IS THE HOST'S OWN SELECTION REPORT, NOT A GENERATED CALLBACK. A host hands onSelect
// the row set its click handler resolved (chart-host's `selection.onChange`, or a host's own
// dispatch). Depending on a callback generated code may or may not invoke would make the card a
// per-type, per-generation gamble, absent on every chart cached before it.
//
// WHY THE POINTER IS TRACKED SEPARATELY. A row set carries no event, so a card built from it alone
// would open in a fixed corner and read as a panel rather than as a response to that mark. So the
// container's own click is watched in the CAPTURE phase, which runs before a bubble-phase click
// handler: by the time the row set arrives, the anchor is already recorded.

import { computeSelectionCard, type SelectionCardModel } from "./selectionCard";
import type { SourceFormats } from "./sourceDateFormat";

export interface SelectionCardsDeps {
    /** The positioned ancestor the cards live inside. Nothing the visual draws escapes its
     *  frame, and a card is visual-drawn, so this is a hard boundary rather than a preference. */
    container: HTMLElement;
    /** The payload the chart was drawn from. A getter, not a value: the chart is redrawn on
     *  resize, on a cell edit and on a live restyle, and a captured payload would age out. */
    getPayload: () => any;
    /** The chart's own aggregation, so the card cannot contradict the picture it sits on. */
    getAggregation: () => string;
    /** The source's own per-column date formats (a worksheet's number formats, a model's format
     *  strings), so a click on a date is answered in the reader's formatting rather than in the
     *  payload's ISO instant. A getter for the same reason `getPayload` is one - the source is
     *  re-read on every resize and every edit. Optional: without it the card still renders a
     *  locale date, never the ISO. */
    getSourceFormats?: () => SourceFormats | null;
    getEnabled: () => boolean;
    getPinLimit: () => number;
    cultureCode?: string;
    log?: (tag: string, detail?: unknown) => void;
}

export interface SelectionCards {
    /** Hand it the row set chart-host resolved. Empty clears. */
    onSelect(rowIdxs: number[]): void;
    /** Drop the transient card AND every pin - used when the chart itself goes away. */
    clear(): void;
    destroy(): void;
}

const CARD_CLASS = "lch-selcard";
/** The design's ceiling: a card that covers more than about a third of the tile has stopped
 *  annotating the chart and started replacing it. Past this the card sheds its measure lines
 *  and keeps the header and the row count, which still answers "what did I just click". */
const MAX_TILE_FRACTION = 0.3;

/** What build() hands back: the card plus the two controls show() has to wire. Returned as
 *  a record rather than fished back out of the DOM with querySelector - a selector is a
 *  second place the class names have to agree, and it fails silently when they stop. */
interface BuiltCard {
    el: HTMLElement;
    pin: HTMLButtonElement;
    close: HTMLButtonElement;
}

interface CardHandle {
    el: HTMLElement;
    pinned: boolean;
}

export function createSelectionCards(deps: SelectionCardsDeps): SelectionCards {
    const { container } = deps;
    const log = deps.log ?? (() => { /* diagnostics are optional here */ });

    let transient: CardHandle | null = null;
    const pinned: CardHandle[] = [];
    let anchor = { x: 0, y: 0 };
    let disposed = false;

    // ---- pointer capture, so a card can open WHERE the mark is ---------------------------
    const onPointer = (ev: MouseEvent) => {
        try {
            const r = container.getBoundingClientRect();
            anchor = { x: ev.clientX - r.left, y: ev.clientY - r.top };
        } catch { /* detached during teardown */ }
    };
    container.addEventListener("click", onPointer, true);

    const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        // Esc drops everything, pins included. It is the universal "get this off my screen",
        // and a pin that survived it would be the one thing the user could not dismiss.
        clearAll();
    };
    document.addEventListener("keydown", onKey);

    function removeCard(c: CardHandle | null): void {
        if (!c) return;
        try { c.el.remove(); } catch { /* already gone */ }
    }

    function clearTransient(): void {
        removeCard(transient);
        transient = null;
    }

    function clearAll(): void {
        clearTransient();
        while (pinned.length) removeCard(pinned.pop()!);
    }

    /** Keep the card inside the frame whatever the anchor was. A card clipped by the container
     *  is the same failure as a tooltip running off the edge, and for the same reason: the
     *  reader loses exactly the number they reached for. */
    function place(el: HTMLElement, at: { x: number; y: number }): void {
        const cw = container.clientWidth || 0;
        const ch = container.clientHeight || 0;
        if (!cw || !ch) return;
        const w = el.offsetWidth || 0;
        const h = el.offsetHeight || 0;
        const gap = 12, edge = 6;

        let left = at.x + gap;
        if (left + w > cw - edge) left = at.x - gap - w;
        if (left < edge) left = edge;
        if (left + w > cw - edge) left = Math.max(edge, cw - w - edge);

        let top = at.y + gap;
        if (top + h > ch - edge) top = at.y - gap - h;
        if (top < edge) top = edge;
        if (top + h > ch - edge) top = Math.max(edge, ch - h - edge);

        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
    }

    /** Drag, bounded by the same frame. Pinning two cards is only useful if they can be put
     *  side by side, and they cannot be if they land wherever the marks happened to be. */
    function makeDraggable(el: HTMLElement, grip: HTMLElement): void {
        let startX = 0, startY = 0, baseX = 0, baseY = 0, dragging = false;
        const down = (ev: MouseEvent) => {
            dragging = true;
            startX = ev.clientX; startY = ev.clientY;
            baseX = parseFloat(el.style.left || "0"); baseY = parseFloat(el.style.top || "0");
            ev.preventDefault();
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
        };
        const move = (ev: MouseEvent) => {
            if (!dragging) return;
            const cw = container.clientWidth || 0, ch = container.clientHeight || 0;
            const w = el.offsetWidth || 0, h = el.offsetHeight || 0;
            const nx = Math.min(Math.max(4, baseX + (ev.clientX - startX)), Math.max(4, cw - w - 4));
            const ny = Math.min(Math.max(4, baseY + (ev.clientY - startY)), Math.max(4, ch - h - 4));
            el.style.left = `${Math.round(nx)}px`;
            el.style.top = `${Math.round(ny)}px`;
        };
        const up = () => {
            dragging = false;
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
        };
        grip.addEventListener("mousedown", down);
    }

    /** Build the DOM. Text is set through textContent, never innerHTML: every string here comes
     *  from the reader's own data, and a column called `<img onerror=...>` is a value someone
     *  can type. */
    function build(model: SelectionCardModel, compact: boolean): BuiltCard {
        const el = document.createElement("div");
        el.className = CARD_CLASS;

        const head = document.createElement("div");
        head.className = `${CARD_CLASS}-head`;
        const title = document.createElement("span");
        title.className = `${CARD_CLASS}-title`;
        title.textContent = model.header;
        head.append(title);

        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = `${CARD_CLASS}-btn`;
        pin.title = "Keep this card while you click other marks";
        pin.setAttribute("aria-label", "Pin this card");
        pin.textContent = "Pin";
        head.append(pin);

        const close = document.createElement("button");
        close.type = "button";
        close.className = `${CARD_CLASS}-btn`;
        close.title = "Dismiss";
        close.setAttribute("aria-label", "Dismiss this card");
        close.textContent = "×";
        head.append(close);

        el.append(head);

        const appendLine = (line: SelectionCardModel["lines"][number], cls: string) => {
            const row = document.createElement("div");
            row.className = cls;
            const lbl = document.createElement("span");
            lbl.className = `${CARD_CLASS}-label`;
            lbl.textContent = `${line.label}:`;
            const val = document.createElement("span");
            val.className = `${CARD_CLASS}-value`;
            // The share rides WITH the value, and is absent entirely wherever it would be a lie -
            // see computeSelectionCard: a percentage of an average is one, and so is a percentage
            // of a total of latitudes.
            val.textContent = line.shareText ? `${line.valueText} (${line.shareText})` : line.valueText;
            row.append(lbl, val);
            el.append(row);
        };

        if (!compact) {
            for (const line of model.lines) appendLine(line, `${CARD_CLASS}-line`);
            if (model.hiddenMeasures > 0) {
                const more = document.createElement("div");
                more.className = `${CARD_CLASS}-more`;
                more.textContent = `+${model.hiddenMeasures} more measure${model.hiddenMeasures === 1 ? "" : "s"}`;
                el.append(more);
            }
            // DIMENSIONS, BELOW THE AMOUNTS. A dimension has no arithmetic, which
            // is why it had no line at all: the first one became the header and the rest were
            // discarded, so on the sample table `Segment` appeared nowhere. It carries the two
            // answers a click actually wants - WHICH value this is, and how many there are - and
            // it comes second because the amounts are what the card is for.
            for (const line of model.dimensionLines) appendLine(line, `${CARD_CLASS}-line ${CARD_CLASS}-dim`);
        }

        const rows = document.createElement("div");
        rows.className = `${CARD_CLASS}-rows`;
        rows.textContent = model.rowsText;
        el.append(rows);

        makeDraggable(el, head);
        return { el, pin, close };
    }

    function show(model: SelectionCardModel): void {
        clearTransient();

        // Measure at full content, THEN decide whether it fits. Deciding first and measuring
        // after is how everything always fits and the question can never be answered.
        let built = build(model, false);
        let el: HTMLElement = built.el;
        el.style.visibility = "hidden";
        container.append(el);

        const cw = container.clientWidth || 0, ch = container.clientHeight || 0;
        const area = (el.offsetWidth || 0) * (el.offsetHeight || 0);
        const tile = cw * ch;
        if (tile > 0 && area > tile * MAX_TILE_FRACTION) {
            // Too big for this pane. A tooltip surface painted OUTSIDE the chart's frame would be
            // the only place with room, and a host need not have one, so rather than say nothing
            // the card sheds its measure lines and keeps what still answers "what did I click".
            // Clipped beats absent; silent is worst of all.
            el.remove();
            built = build(model, true);
            el = built.el;
            el.style.visibility = "hidden";
            container.append(el);
            log("selcard-compact", { area, tile });
        }

        place(el, anchor);
        el.style.visibility = "visible";

        const handle: CardHandle = { el, pinned: false };
        transient = handle;

        built.close.addEventListener("click", ev => {
            ev.stopPropagation();
            if (handle.pinned) {
                const i = pinned.indexOf(handle);
                if (i >= 0) pinned.splice(i, 1);
                removeCard(handle);
            } else {
                clearTransient();
            }
        });

        built.pin.addEventListener("click", ev => {
            ev.stopPropagation();
            if (handle.pinned) return;
            handle.pinned = true;
            transient = null;                      // it belongs to the pin list now
            built.pin.textContent = "Pinned";
            built.pin.disabled = true;
            el.classList.add(`${CARD_CLASS}--pinned`);
            pinned.push(handle);
            // OLDEST OUT. The limit is a preference because the right number depends on the
            // pane; evicting silently past it is better than stacking cards over the chart
            // they are describing.
            const limit = Math.max(1, deps.getPinLimit() || 3);
            while (pinned.length > limit) removeCard(pinned.shift()!);
            log("selcard-pinned", { pins: pinned.length, limit });
        });
    }

    return {
        onSelect(rowIdxs: number[]): void {
            if (disposed) return;
            if (!deps.getEnabled()) { clearTransient(); return; }
            // An empty selection is a CLEAR - chart-host sends it on the second click. Pins
            // survive it deliberately: they are the thing the user asked to keep.
            if (!rowIdxs || !rowIdxs.length) { clearTransient(); return; }
            let model: SelectionCardModel | null = null;
            try {
                model = computeSelectionCard(deps.getPayload(), rowIdxs, {
                    aggregation: deps.getAggregation(),
                    cultureCode: deps.cultureCode,
                    sourceFormats: deps.getSourceFormats?.() ?? null,
                });
            } catch (e: any) {
                // A card is a courtesy. It must never be the reason a chart interaction throws.
                log("selcard-failed", { error: e?.message ?? String(e) });
                clearTransient();
                return;
            }
            if (!model) { clearTransient(); return; }
            // A COLUMN THE CLASSIFIER WITHHELD leaves no other trace. Coordinates
            // get no line because a total of latitudes is not an answer - correct, and invisible
            // from the card, which is exactly the kind of absence that costs someone an afternoon
            // later. It goes to the host's log, never to the reader: a reader does not need
            // telling that their latitude was not summed.
            if (model.suppressedColumns.length) {
                log("selcard-not-aggregatable", { columns: model.suppressedColumns.join(", ") });
            }
            show(model);
        },
        clear: clearAll,
        destroy(): void {
            disposed = true;
            clearAll();
            container.removeEventListener("click", onPointer, true);
            document.removeEventListener("keydown", onKey);
        },
    };
}
