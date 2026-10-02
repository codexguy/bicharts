// A CHART'S IN-CHART CONTROLS, AS STATE THE PAGE CAN READ AND SET (2026-10-02).
//
// Some generated charts draw their own controls - the What-if projection's growth-rate and horizon
// sliders - and keep the values in a bag on their container (`__lchKnobs`), persisting through
// options.uiState / setUiState when a reader lets go of a slider. A page that saves a "scenario"
// needs those values. Every agent-built app reverse-engineered the bag's shape from the chart's
// source, and every one got the same thing wrong: the chart only reports after a slider moves, so
// "Save scenario" before any move had nothing to save - hidden, disabled, or a made-up default
// saved instead of the rate on screen. One app also labelled a monthly rate "/ yr".
//
// So the host reads the controls itself, after every render: each knob's value from the bag (the
// opening value included), and its label and readout from what the chart drew, so the page shows
// the unit the chart shows. `set` applies values (a saved scenario), `reset` returns to the chart's
// defaults.

import type { ChartHost } from "./host";

export interface ControlInfo {
    /** The knob's name in the chart's bag ("rate", "horizon"). */
    key: string;
    /** Its value as the chart stores it (a number, or an ISO date string for a date knob). */
    value: unknown;
    /** The label the chart draws beside it ("growth per year"), or "" if none. */
    label: string;
    /** The readout the chart draws ("+5.5%", "7 years") - the value in the chart's own words. */
    text: string;
}

export interface Controls {
    /** Every knob's current value, by key - the opening values as soon as the chart has drawn. */
    readonly values: Readonly<Record<string, unknown>>;
    /** Each knob in the order the chart draws them, with its label and readout. */
    readonly info: readonly ControlInfo[];
    /** "growth per year +5.5% · horizon 7 years": what to show beside a saved scenario. */
    readonly summary: string;
    /** True once a chart has drawn and reported its controls. */
    readonly ready: boolean;
    /** Bumped on every change. */
    readonly version: number;
    /** Apply values (a saved scenario): the chart redraws with them. Unknown keys are ignored by the chart. */
    set(values: Readonly<Record<string, unknown>>): void;
    /** Back to the chart's own defaults. */
    reset(): void;
    onChange(cb: (c: Controls) => void): () => void;
}

/** What attachControls hands the host: the uiState pair the chart reads and writes. */
export interface ControlsAttachment {
    /** Merge into the host's options at creation (and they stay: setOptions merges). */
    readonly options: { uiState: Record<string, unknown>; setUiState: (s: unknown) => void };
    /** Read the chart's controls now (call once a render has settled). */
    read(): void;
    detach(): void;
}

interface ControlsInternal extends Controls {
    /** The uiState object handed to the chart - kept, its contents replaced, so a later render reads the latest. */
    readonly _ui: Record<string, unknown>;
    _attach(onApply: () => void): () => void;
    _report(info: ControlInfo[]): void;
}

const same = (a: readonly ControlInfo[], b: readonly ControlInfo[]) =>
    a.length === b.length && a.every((x, i) => x.key === b[i].key && x.label === b[i].label && x.text === b[i].text
                                               && JSON.stringify(x.value) === JSON.stringify(b[i].value));

/** Make a controls handle: give it to one chart (a BicChart's `controls`, or attachControls). */
export function createControls(initial?: Readonly<Record<string, unknown>>): Controls {
    const ui: Record<string, unknown> = initial ? { knobs: { ...initial } } : {};
    let info: ControlInfo[] = [];
    let version = 0;
    const subs = new Set<(c: Controls) => void>();
    const appliers = new Set<() => void>();
    const notify = () => { version++; for (const cb of Array.from(subs)) cb(c); };
    const c: ControlsInternal = {
        get values() {
            const out: Record<string, unknown> = {};
            for (const i of info) out[i.key] = i.value;
            if (!info.length && ui.knobs && typeof ui.knobs === "object") Object.assign(out, ui.knobs);
            return out;
        },
        get info() { return info; },
        get summary() {
            return info.map(i => [i.label, i.text].filter(Boolean).join(" ")).filter(Boolean).join(" · ");
        },
        get ready() { return info.length > 0; },
        get version() { return version; },
        set(values) {
            const knobs = { ...((ui.knobs as Record<string, unknown>) ?? {}), ...values };
            ui.knobs = knobs;
            for (const a of Array.from(appliers)) a();
        },
        reset() {
            delete ui.knobs;
            for (const a of Array.from(appliers)) a();
        },
        onChange(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
        _ui: ui,
        _attach(onApply) { appliers.add(onApply); return () => { appliers.delete(onApply); }; },
        _report(next) {
            if (same(info, next)) return;
            info = next;
            notify();
        },
    };
    return c;
}

/** Read each knob off a rendered chart: values from the bag, label and readout from what it drew. */
export function readControls(container: HTMLElement): ControlInfo[] {
    const bag = (container as any).__lchKnobs;
    if (!bag || typeof bag !== "object") return [];
    const keys = Object.keys(bag);
    if (!keys.length) return [];
    const groups = Array.from(container.querySelectorAll("g.llm-slider"));
    return keys.map((key, i) => {
        // A helper that names its knob (data-knob) is matched by name; older generated charts by
        // order - the bag is filled in the order the sliders are drawn.
        const g = groups.find(x => x.getAttribute("data-knob") === key) ?? groups[i] ?? null;
        const txt = (sel: string) => (g?.querySelector(sel)?.textContent ?? "").trim();
        return { key, value: bag[key], label: txt(".llm-slider-label"), text: txt(".llm-slider-readout") };
    });
}

/**
 * Wire a controls handle to one chart. Call it before creating the host and pass
 * `attachment.options` into createChartHost's options (a raw uiState / setUiState pair takes
 * precedence over any viewState provider); `getHost` returns the host once it exists. Call
 * `read()` after each render settles.
 */
export function attachControls(getHost: () => ChartHost | null, container: HTMLElement, controls: Controls): ControlsAttachment {
    const c = controls as ControlsInternal;
    const read = () => c._report(readControls(container));
    const setUiState = (s: unknown) => {
        if (!s || typeof s !== "object") return;
        // REPLACE semantics, as every persisting host: the chart sends its whole bag. The same
        // object stays in the options, so the next render reads what the reader left.
        for (const k of Object.keys(c._ui)) delete c._ui[k];
        Object.assign(c._ui, s as Record<string, unknown>);
        // The readout is repainted before the chart persists; read on the next tick, when it has.
        Promise.resolve().then(read);
    };
    const off = c._attach(() => {
        const host = getHost();
        if (!host) return;                   // not drawn yet: it will be created with these values
        host.setOptions({ uiState: c._ui });
        host.rendered.then(read, () => {});
    });
    return {
        options: { uiState: c._ui, setUiState },
        read,
        detach: off,
    };
}
