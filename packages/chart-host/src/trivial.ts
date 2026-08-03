// DETERMINISTIC CHARTS FOR SHAPES THAT HAVE EXACTLY ONE DEFENSIBLE ANSWER.
//
// Some datasets do not need a language model. A single value is a Card. One categorical
// column with repeats is a frequency bar chart. One numeric column is a histogram. There is
// no creative decision left in any of those, so spending a generation on them costs money
// and latency to arrive somewhere a template already knew.
//
// Measured on one production corpus before this existed: 2.0% of all generations arrived
// with a single row, 3.1% with a single column — and 6.1% of FIRST-TIME unpaid generations
// were single-row, which is the case that matters most. Those users get one generation, and
// they were spending it to be told that one row contains one value. A deterministic answer
// is instant, costs nothing, and leaves their generation unspent for real data.
//
// SCOPE IS DELIBERATELY NARROW. This module only claims shapes where every reasonable
// analyst would draw the same picture. It returns null for everything else — including
// "one category plus one measure", which looks trivial and is not: bar vs lollipop vs
// dot-plot vs treemap is a judgement about the data and the audience, and a template that
// guesses there would be a quality CEILING rather than a floor.
//
// WHAT THIS MODULE DOES NOT DECIDE: whether to USE the plan. A caller that has an explicit
// user request, a forced chart type, or a forced renderer should generate anyway — the user
// asked for something specific and a template cannot honour it. Callers own that gate; this
// function only answers "does this shape have one right answer?".
//
// No d3. These render with plain DOM so they work before any chart library has loaded,
// which is most of the point: the round-trip is what we are removing.

import type { RenderOptions } from "./contract";
import { MARK_CLASS, ROW_IDX_ATTR } from "./contract";
// TYPE-ONLY, so this stays runtime-free: the plans must be usable interchangeably with
// generated code, which means sharing its exact signature rather than declaring a lookalike.
import type { RenderFn } from "./host";

/** Columns the host synthesises; never part of the user's data shape. */
const META_COLUMNS = new Set(["__rowIdx__", "__geoIso__", "__geoLat__", "__geoLon__"]);

/** Above this many distinct categories a frequency bar chart stops being readable, and the
 *  choice of what to do instead (top-N, group to other, a different mark) is a real
 *  decision — so it stops being ours to make. */
const MAX_FREQUENCY_CATEGORIES = 30;

/** Below this many rows a histogram is a scatter of noise, not a distribution. */
const MIN_HISTOGRAM_ROWS = 8;

export type TrivialShapeKind = "card" | "frequency-bar" | "histogram";

export interface TrivialPlan {
    kind: TrivialShapeKind;
    /** Plain-language reason, written to be shown to the user verbatim. A deterministic
     *  render must never be silent about being deterministic — the user pressed a button
     *  expecting a generation, and "no credit used" is good news they should receive. */
    reason: string;
    /** Index of the single data column this plan reads. */
    columnIndex: number;
    /** Same signature as generated code, so a host can treat the two identically. */
    render: RenderFn;
}

interface DataLike {
    columns?: Array<{ name?: string; isMeasure?: boolean; dataType?: string } | string>;
    rows?: any[][];
}

function columnName(c: any): string {
    return typeof c === "string" ? c : String(c?.name ?? "");
}

function isNumericColumn(col: any, rows: any[][], idx: number): boolean {
    // Trust the declared flag when it is a real measure, but VERIFY against values:
    // a host can mark a text column as a measure (a "First" aggregation over a string),
    // and drawing a histogram of words would be worse than not drawing at all.
    let seen = 0;
    for (let r = 0; r < rows.length && seen < 50; r++) {
        const v = rows[r]?.[idx];
        if (v === null || v === undefined || v === "") continue;
        seen++;
        if (typeof v === "number") { if (!isFinite(v)) return false; continue; }
        const n = Number(v);
        if (!isFinite(n) || String(v).trim() === "") return false;
    }
    return seen > 0;
}

/**
 * Decide whether a dataset has exactly one defensible chart, and return a ready-to-call
 * render function when it does. Returns null whenever there is a real choice to make.
 */
export function planTrivialChart(data: DataLike | null | undefined): TrivialPlan | null {
    const allCols = Array.isArray(data?.columns) ? data!.columns! : [];
    const rows = Array.isArray(data?.rows) ? data!.rows! : [];
    if (!allCols.length || !rows.length) return null;

    // Index into the ORIGINAL column array — render functions receive the untouched
    // payload, metadata columns and all.
    const dataCols: number[] = [];
    for (let i = 0; i < allCols.length; i++) {
        if (!META_COLUMNS.has(columnName(allCols[i]))) dataCols.push(i);
    }
    if (dataCols.length !== 1) return null;          // more than one column = a real choice
    const idx = dataCols[0];
    const name = columnName(allCols[idx]) || "Value";

    // ---- one column, one row -> a Card. There is nothing else to draw.
    if (rows.length === 1) {
        return {
            kind: "card",
            columnIndex: idx,
            reason: `One row of one column has a single value, so this is a card. `
                  + `No generation was needed and none was used.`,
            render: makeCardRender(idx, name),
        };
    }

    const numeric = isNumericColumn(allCols[idx], rows, idx);

    // ---- one numeric column, many rows -> a histogram of its distribution.
    if (numeric) {
        if (rows.length < MIN_HISTOGRAM_ROWS) return null;
        return {
            kind: "histogram",
            columnIndex: idx,
            reason: `A single numeric column has one defensible chart: the distribution of `
                  + `its values. No generation was needed and none was used.`,
            render: makeHistogramRender(idx, name),
        };
    }

    // ---- one categorical column, many rows -> how often each value occurs.
    // Only when values actually REPEAT: all-distinct values make every bar 1, which tells
    // the reader nothing and is a worse answer than asking for a real chart.
    const counts = new Map<string, number[]>();
    for (let r = 0; r < rows.length; r++) {
        const raw = rows[r]?.[idx];
        const key = raw === null || raw === undefined || raw === "" ? "(blank)" : String(raw);
        const bucket = counts.get(key);
        if (bucket) bucket.push(r); else counts.set(key, [r]);
    }
    if (counts.size < 2 || counts.size >= rows.length) return null;
    if (counts.size > MAX_FREQUENCY_CATEGORIES) return null;

    return {
        kind: "frequency-bar",
        columnIndex: idx,
        reason: `A single categorical column has one defensible chart: how often each value `
              + `occurs. No generation was needed and none was used.`,
        render: makeFrequencyRender(idx, name),
    };
}

// ---------------------------------------------------------------- shared drawing helpers

function fg(o: RenderOptions): string { return o.themeFg || "#333333"; }
function bg(o: RenderOptions): string { return o.backgroundColor || "transparent"; }
function accent(o: RenderOptions): string {
    return (Array.isArray(o.palette) && o.palette.length ? o.palette[0] : "#3182bd") as string;
}
/** Chrome font size derived from the viewport, matching the archetypes' CF convention so a
 *  deterministic chart does not look foreign beside a generated one. */
function chromeFont(o: RenderOptions): number {
    return Math.max(9, Math.min(14, Math.round(Math.min(o.width, o.height) / 55)));
}
function fmtNumber(v: number, culture?: string): string {
    try { return new Intl.NumberFormat(culture || undefined).format(v); }
    catch { return String(v); }
}
/** Compact form for axis/labels — full thousands separators eat width a small tile cannot spare. */
function fmtCompact(v: number, culture?: string): string {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K";
    return fmtNumber(Math.round(v * 100) / 100, culture);
}
function el(tag: string, style?: Partial<CSSStyleDeclaration>): HTMLElement {
    const n = document.createElement(tag);
    if (style) Object.assign(n.style, style);
    return n;
}
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
    return n;
}

// ---------------------------------------------------------------- card

function makeCardRender(idx: number, name: string): RenderFn {
    return (container, data, options) => {
        container.replaceChildren();
        const raw = data?.rows?.[0]?.[idx];
        const isNum = typeof raw === "number" || (raw !== "" && raw !== null && raw !== undefined && isFinite(Number(raw)));
        const shown = raw === null || raw === undefined || raw === ""
            ? "(blank)"
            : (isNum ? fmtNumber(Number(raw), options.cultureCode) : String(raw));

        const root = el("div", {
            width: options.width + "px", height: options.height + "px",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", boxSizing: "border-box", padding: "8px",
            overflow: "hidden", fontFamily: "sans-serif",
            color: fg(options), background: bg(options),
        });

        // The value sizes to the SPACE AND THE STRING, so a long text value shrinks to fit
        // rather than overflowing a card that was measured for a short number.
        const budget = Math.max(1, options.width - 24);
        const byWidth = budget / Math.max(1, shown.length * 0.62);
        const size = Math.max(14, Math.min(options.height * 0.42, byWidth, 96));

        const value = el("div", {
            fontSize: Math.round(size) + "px", fontWeight: "700", lineHeight: "1.1",
            maxWidth: "100%", textAlign: "center", wordBreak: "break-word",
        });
        value.textContent = shown;

        const label = el("div", {
            fontSize: chromeFont(options) + "px", opacity: "0.75",
            marginTop: "6px", textAlign: "center", maxWidth: "100%",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        });
        label.textContent = name;

        root.appendChild(value);
        root.appendChild(label);
        container.appendChild(root);
    };
}

// ---------------------------------------------------------------- frequency bars

function makeFrequencyRender(idx: number, name: string): RenderFn {
    return (container, data, options) => {
        container.replaceChildren();
        const rows: any[][] = data?.rows ?? [];
        const counts = new Map<string, number[]>();
        for (let r = 0; r < rows.length; r++) {
            const raw = rows[r]?.[idx];
            const key = raw === null || raw === undefined || raw === "" ? "(blank)" : String(raw);
            const b = counts.get(key);
            if (b) b.push(r); else counts.set(key, [r]);
        }
        const entries = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
        const max = entries.length ? entries[0][1].length : 1;

        const CF = chromeFont(options);
        const svg = svgEl("svg", { width: options.width, height: options.height });
        const padL = Math.min(Math.max(70, options.width * 0.22), options.width * 0.4);
        const padR = 52, padT = CF + 12, padB = 8;
        const plotW = Math.max(10, options.width - padL - padR);
        const bandH = Math.max(8, (options.height - padT - padB) / entries.length);
        const barH = Math.min(bandH - 3, 26);

        const title = svgEl("text", {
            x: 8, y: CF + 2, "font-size": CF, "font-weight": "700", fill: fg(options),
        });
        title.textContent = `${name} — count of ${fmtNumber(rows.length, options.cultureCode)} rows`;
        svg.appendChild(title);

        entries.forEach(([key, idxs], i) => {
            const y = padT + i * bandH;
            const w = Math.max(1, (idxs.length / max) * plotW);

            // A PAINTED, full-band hit target: the row is clickable across its whole width,
            // not only where the bar happens to reach. Same grammar as generated charts, so
            // cross-filter behaves identically whether or not a model was involved.
            const hit = svgEl("rect", {
                x: 0, y, width: options.width, height: bandH,
                fill: "transparent", class: MARK_CLASS, [ROW_IDX_ATTR]: idxs.join(","),
            });
            (hit as SVGElement & { style: CSSStyleDeclaration }).style.cursor = "pointer";
            svg.appendChild(hit);

            const label = svgEl("text", {
                x: padL - 6, y: y + barH / 2 + CF * 0.36, "text-anchor": "end",
                "font-size": CF - 1, fill: fg(options),
            });
            label.setAttribute("pointer-events", "none");
            const budget = Math.max(4, Math.floor((padL - 10) / (CF * 0.58)));
            label.textContent = key.length > budget ? key.slice(0, budget - 1) + "…" : key;
            svg.appendChild(label);

            const bar = svgEl("rect", {
                x: padL, y, width: w, height: barH, fill: accent(options), "fill-opacity": 0.85,
            });
            bar.setAttribute("pointer-events", "none");
            svg.appendChild(bar);

            const val = svgEl("text", {
                x: padL + w + 6, y: y + barH / 2 + CF * 0.36,
                "font-size": CF - 1, fill: fg(options),
            });
            val.setAttribute("pointer-events", "none");
            val.textContent = fmtNumber(idxs.length, options.cultureCode);
            svg.appendChild(val);
        });

        container.appendChild(svg);
    };
}

// ---------------------------------------------------------------- histogram

function makeHistogramRender(idx: number, name: string): RenderFn {
    return (container, data, options) => {
        container.replaceChildren();
        const rows: any[][] = data?.rows ?? [];
        const vals: Array<{ v: number; r: number }> = [];
        for (let r = 0; r < rows.length; r++) {
            const raw = rows[r]?.[idx];
            if (raw === null || raw === undefined || raw === "") continue;
            const n = Number(raw);
            if (isFinite(n)) vals.push({ v: n, r });
        }
        const CF = chromeFont(options);
        const svg = svgEl("svg", { width: options.width, height: options.height });

        if (!vals.length) { container.appendChild(svg); return; }

        let lo = vals[0].v, hi = vals[0].v;
        for (const x of vals) { if (x.v < lo) lo = x.v; if (x.v > hi) hi = x.v; }
        // A constant column has no distribution to show; one full bar is the honest picture.
        const span = hi - lo;
        const binCount = span === 0 ? 1
            : Math.max(4, Math.min(24, Math.round(Math.sqrt(vals.length))));
        const binW = span === 0 ? 1 : span / binCount;

        const bins: number[][] = Array.from({ length: binCount }, () => []);
        for (const x of vals) {
            let b = span === 0 ? 0 : Math.floor((x.v - lo) / binW);
            if (b >= binCount) b = binCount - 1;          // the maximum lands in the last bin
            if (b < 0) b = 0;
            bins[b].push(x.r);
        }
        const maxCount = bins.reduce((m, b) => Math.max(m, b.length), 1);

        const padL = 8, padR = 8, padT = CF + 12, padB = CF + 14;
        const plotW = Math.max(10, options.width - padL - padR);
        const plotH = Math.max(10, options.height - padT - padB);
        const bw = plotW / binCount;

        const title = svgEl("text", {
            x: padL, y: CF + 2, "font-size": CF, "font-weight": "700", fill: fg(options),
        });
        title.textContent = `${name} — distribution of ${fmtNumber(vals.length, options.cultureCode)} values`;
        svg.appendChild(title);

        bins.forEach((idxs, i) => {
            const h = (idxs.length / maxCount) * plotH;
            const x = padL + i * bw;
            const hit = svgEl("rect", {
                x, y: padT, width: Math.max(1, bw), height: plotH,
                fill: "transparent", class: MARK_CLASS, [ROW_IDX_ATTR]: idxs.join(","),
            });
            (hit as SVGElement & { style: CSSStyleDeclaration }).style.cursor = "pointer";
            svg.appendChild(hit);
            if (idxs.length) {
                const bar = svgEl("rect", {
                    x: x + 1, y: padT + plotH - h, width: Math.max(1, bw - 2), height: h,
                    fill: accent(options), "fill-opacity": 0.85,
                });
                bar.setAttribute("pointer-events", "none");
                svg.appendChild(bar);
            }
        });

        // Endpoints only: a deterministic chart should not pretend to a tick strategy it
        // has not earned, and two honest numbers beat a crowded axis.
        const loT = svgEl("text", { x: padL, y: options.height - 4, "font-size": CF - 1, fill: fg(options) });
        loT.textContent = fmtCompact(lo, options.cultureCode);
        const hiT = svgEl("text", {
            x: options.width - padR, y: options.height - 4, "text-anchor": "end",
            "font-size": CF - 1, fill: fg(options),
        });
        hiT.textContent = fmtCompact(hi, options.cultureCode);
        svg.appendChild(loT); svg.appendChild(hiT);

        container.appendChild(svg);
    };
}
