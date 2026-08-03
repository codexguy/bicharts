// DETERMINISTIC CHARTS FOR SHAPES THAT HAVE EXACTLY ONE DEFENSIBLE ANSWER.
//
// Some datasets do not need a language model. A single value is a card. One categorical
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
// THIS EMITS SOURCE, NOT A CLOSURE, and that is the load-bearing design decision. A host
// persists the chart's code and re-renders it on reopen, shares it inside a report, and may
// open it on an OLDER build than the one that made it. A plan that existed only as a live
// function would vanish on save/reopen and could not travel; a plan that is ordinary
// `function render(container, data, options)` source goes down the same pipeline as
// generated code and renders anywhere that can render a chart at all — including builds
// that predate this module. `render` below is that exact source, compiled, so what the
// tests exercise is what ships.
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
// The emitted source uses plain DOM — no d3 — so it renders before any chart library has
// loaded, and it carries the host's own interaction grammar so cross-filter behaves exactly
// as it does for generated charts.

import type { RenderFn } from "./host";
import { MARK_CLASS, ROW_IDX_ATTR } from "./contract";

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
    /** Self-contained `function render(container, data, options)` source. Feed it through
     *  the same path as generated code: persist it, compile it, share it. */
    source: string;
    /** The same source, compiled. Convenience for a host that wants to draw immediately. */
    render: RenderFn;
}

interface DataLike {
    columns?: Array<{ name?: string; isMeasure?: boolean; dataType?: string } | string>;
    rows?: any[][];
}

function columnName(c: any): string {
    return typeof c === "string" ? c : String(c?.name ?? "");
}

function isNumericColumn(rows: any[][], idx: number): boolean {
    // Trust nothing declared — VERIFY against values. A host can mark a text column as a
    // measure (a "First" aggregation over a string), and a histogram of words is worse than
    // no chart at all.
    let seen = 0;
    for (let r = 0; r < rows.length && seen < 50; r++) {
        const v = rows[r]?.[idx];
        if (v === null || v === undefined || v === "") continue;
        seen++;
        if (typeof v === "number") { if (!isFinite(v)) return false; continue; }
        if (String(v).trim() === "" || !isFinite(Number(v))) return false;
    }
    return seen > 0;
}

/** JS string literal, safe to embed in emitted source. */
function lit(s: string): string {
    return JSON.stringify(String(s));
}

/**
 * Decide whether a dataset has exactly one defensible chart, and return its source when it
 * does. Returns null whenever there is a real choice to make.
 */
export function planTrivialChart(data: DataLike | null | undefined): TrivialPlan | null {
    const allCols = Array.isArray(data?.columns) ? data!.columns! : [];
    const rows = Array.isArray(data?.rows) ? data!.rows! : [];
    if (!allCols.length || !rows.length) return null;

    // Index into the ORIGINAL column array — the emitted code receives the untouched
    // payload, metadata columns and all.
    const dataCols: number[] = [];
    for (let i = 0; i < allCols.length; i++) {
        if (!META_COLUMNS.has(columnName(allCols[i]))) dataCols.push(i);
    }
    if (dataCols.length !== 1) return null;          // more than one column = a real choice
    const idx = dataCols[0];
    const name = columnName(allCols[idx]) || "Value";

    const finish = (kind: TrivialShapeKind, reason: string, source: string): TrivialPlan => ({
        kind, reason, columnIndex: idx, source, render: compileTrivialSource(source),
    });

    // ---- one column, one row -> a card. There is nothing else to draw.
    if (rows.length === 1) {
        return finish("card",
            "One row of one column holds a single value, so this is a card. "
            + "No generation was needed and none was used.",
            cardSource(idx, name));
    }

    // ---- one numeric column, many rows -> the distribution of its values.
    if (isNumericColumn(rows, idx)) {
        if (rows.length < MIN_HISTOGRAM_ROWS) return null;
        return finish("histogram",
            "A single numeric column has one defensible chart: the distribution of its "
            + "values. No generation was needed and none was used.",
            histogramSource(idx, name));
    }

    // ---- one categorical column, many rows -> how often each value occurs.
    // Only when values actually REPEAT: all-distinct values make every bar 1, which tells
    // the reader nothing and is a worse answer than asking for a real chart.
    const distinct = new Set<string>();
    for (let r = 0; r < rows.length; r++) {
        const raw = rows[r]?.[idx];
        distinct.add(raw === null || raw === undefined || raw === "" ? "(blank)" : String(raw));
    }
    if (distinct.size < 2 || distinct.size >= rows.length) return null;
    if (distinct.size > MAX_FREQUENCY_CATEGORIES) return null;

    return finish("frequency-bar",
        "A single categorical column has one defensible chart: how often each value "
        + "occurs. No generation was needed and none was used.",
        frequencySource(idx, name));
}

/** Compile emitted source the same way a host compiles generated code. */
export function compileTrivialSource(source: string): RenderFn {
    const factory = new Function(
        "container", "data", "options",
        source + "\n; return typeof render === 'function' ? render : null;");
    const fn = factory(null, null, null);
    if (typeof fn !== "function") throw new Error("trivial template did not define render()");
    return fn as RenderFn;
}

// ---------------------------------------------------------------- emitted source
//
// Shared preamble. Kept inside each template rather than hoisted into a runtime import,
// because the whole point is that the emitted artifact stands alone.

const PRELUDE = `
  var W = options.width, H = options.height;
  var FG = options.themeFg || '#333333';
  var BG = options.backgroundColor || 'transparent';
  var ACCENT = (options.palette && options.palette.length ? options.palette[0] : '#3182bd');
  // Chrome font from the viewport, matching the archetypes' CF convention so a
  // deterministic chart does not look foreign beside a generated one.
  var CF = Math.max(9, Math.min(14, Math.round(Math.min(W, H) / 55)));
  var rows = (data && data.rows) || [];
  function fmt(v) {
    try { return new Intl.NumberFormat(options.cultureCode || undefined).format(v); }
    catch (e) { return String(v); }
  }
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return fmt(Math.round(v * 100) / 100);
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  container.replaceChildren();
`;

function cardSource(idx: number, name: string): string {
    return `function render(container, data, options) {${PRELUDE}
  var raw = rows[0] ? rows[0][${idx}] : null;
  var blank = (raw === null || raw === undefined || raw === '');
  var isNum = !blank && (typeof raw === 'number' || (String(raw).trim() !== '' && isFinite(Number(raw))));
  var shown = blank ? '(blank)' : (isNum ? fmt(Number(raw)) : String(raw));

  var root = document.createElement('div');
  root.style.width = W + 'px'; root.style.height = H + 'px';
  root.style.display = 'flex'; root.style.flexDirection = 'column';
  root.style.alignItems = 'center'; root.style.justifyContent = 'center';
  root.style.boxSizing = 'border-box'; root.style.padding = '8px';
  root.style.overflow = 'hidden'; root.style.fontFamily = 'sans-serif';
  root.style.color = FG; root.style.background = BG;

  // The value sizes to BOTH the space and the string, so a long text value shrinks to fit
  // instead of overflowing a card measured for a short number.
  var budget = Math.max(1, W - 24);
  var byWidth = budget / Math.max(1, shown.length * 0.62);
  var size = Math.max(14, Math.min(H * 0.42, byWidth, 96));

  var value = document.createElement('div');
  value.style.fontSize = Math.round(size) + 'px'; value.style.fontWeight = '700';
  value.style.lineHeight = '1.1'; value.style.maxWidth = '100%';
  value.style.textAlign = 'center'; value.style.wordBreak = 'break-word';
  value.textContent = shown;

  var label = document.createElement('div');
  label.style.fontSize = CF + 'px'; label.style.opacity = '0.75';
  label.style.marginTop = '6px'; label.style.textAlign = 'center';
  label.style.maxWidth = '100%'; label.style.overflow = 'hidden';
  label.style.textOverflow = 'ellipsis'; label.style.whiteSpace = 'nowrap';
  label.textContent = ${lit(name)};

  root.appendChild(value); root.appendChild(label);
  container.appendChild(root);
}`;
}

function frequencySource(idx: number, name: string): string {
    return `function render(container, data, options) {${PRELUDE}
  var counts = new Map();
  for (var r = 0; r < rows.length; r++) {
    var raw = rows[r] ? rows[r][${idx}] : null;
    var key = (raw === null || raw === undefined || raw === '') ? '(blank)' : String(raw);
    var b = counts.get(key);
    if (b) b.push(r); else counts.set(key, [r]);
  }
  var entries = Array.from(counts.entries()).sort(function (a, b) { return b[1].length - a[1].length; });
  var max = entries.length ? entries[0][1].length : 1;

  var svg = svgEl('svg', { width: W, height: H });
  var padL = Math.min(Math.max(70, W * 0.22), W * 0.4);
  var padR = 52, padT = CF + 12, padB = 8;
  var plotW = Math.max(10, W - padL - padR);
  var bandH = Math.max(8, (H - padT - padB) / entries.length);
  var barH = Math.min(bandH - 3, 26);

  var title = svgEl('text', { x: 8, y: CF + 2, 'font-size': CF, 'font-weight': '700', fill: FG });
  title.textContent = ${lit(name)} + ' \\u2014 count of ' + fmt(rows.length) + ' rows';
  svg.appendChild(title);

  entries.forEach(function (e, i) {
    var key = e[0], idxs = e[1];
    var y = padT + i * bandH;
    var w = Math.max(1, (idxs.length / max) * plotW);

    // A PAINTED, full-band hit target: the row is clickable across its whole width, not
    // only where the bar reaches. Same grammar as generated charts, so cross-filter
    // behaves identically whether or not a model was involved.
    var hit = svgEl('rect', { x: 0, y: y, width: W, height: bandH, fill: 'transparent' });
    hit.setAttribute('class', ${lit(MARK_CLASS)});
    hit.setAttribute(${lit(ROW_IDX_ATTR)}, idxs.join(','));
    hit.style.cursor = 'pointer';
    svg.appendChild(hit);

    var label = svgEl('text', { x: padL - 6, y: y + barH / 2 + CF * 0.36,
      'text-anchor': 'end', 'font-size': CF - 1, fill: FG });
    label.setAttribute('pointer-events', 'none');
    var budget = Math.max(4, Math.floor((padL - 10) / (CF * 0.58)));
    label.textContent = key.length > budget ? key.slice(0, budget - 1) + '\\u2026' : key;
    svg.appendChild(label);

    var bar = svgEl('rect', { x: padL, y: y, width: w, height: barH,
      fill: ACCENT, 'fill-opacity': 0.85 });
    bar.setAttribute('pointer-events', 'none');
    svg.appendChild(bar);

    var val = svgEl('text', { x: padL + w + 6, y: y + barH / 2 + CF * 0.36,
      'font-size': CF - 1, fill: FG });
    val.setAttribute('pointer-events', 'none');
    val.textContent = fmt(idxs.length);
    svg.appendChild(val);
  });

  container.appendChild(svg);
}`;
}

function histogramSource(idx: number, name: string): string {
    return `function render(container, data, options) {${PRELUDE}
  var vals = [];
  for (var r = 0; r < rows.length; r++) {
    var raw = rows[r] ? rows[r][${idx}] : null;
    if (raw === null || raw === undefined || raw === '') continue;
    var n = Number(raw);
    if (isFinite(n)) vals.push({ v: n, r: r });
  }
  var svg = svgEl('svg', { width: W, height: H });
  if (!vals.length) { container.appendChild(svg); return; }

  var lo = vals[0].v, hi = vals[0].v;
  for (var i = 0; i < vals.length; i++) { if (vals[i].v < lo) lo = vals[i].v; if (vals[i].v > hi) hi = vals[i].v; }
  // A constant column has no distribution to show; one full bar is the honest picture.
  var span = hi - lo;
  var binCount = span === 0 ? 1 : Math.max(4, Math.min(24, Math.round(Math.sqrt(vals.length))));
  var binW = span === 0 ? 1 : span / binCount;

  var bins = [];
  for (var b = 0; b < binCount; b++) bins.push([]);
  for (var j = 0; j < vals.length; j++) {
    var k = span === 0 ? 0 : Math.floor((vals[j].v - lo) / binW);
    if (k >= binCount) k = binCount - 1;          // the maximum lands in the last bin
    if (k < 0) k = 0;
    bins[k].push(vals[j].r);
  }
  var maxCount = 1;
  for (var m = 0; m < bins.length; m++) if (bins[m].length > maxCount) maxCount = bins[m].length;

  var padL = 8, padR = 8, padT = CF + 12, padB = CF + 14;
  var plotW = Math.max(10, W - padL - padR);
  var plotH = Math.max(10, H - padT - padB);
  var bw = plotW / binCount;

  var title = svgEl('text', { x: padL, y: CF + 2, 'font-size': CF, 'font-weight': '700', fill: FG });
  title.textContent = ${lit(name)} + ' \\u2014 distribution of ' + fmt(vals.length) + ' values';
  svg.appendChild(title);

  bins.forEach(function (idxs, i) {
    var h = (idxs.length / maxCount) * plotH;
    var x = padL + i * bw;
    var hit = svgEl('rect', { x: x, y: padT, width: Math.max(1, bw), height: plotH, fill: 'transparent' });
    hit.setAttribute('class', ${lit(MARK_CLASS)});
    hit.setAttribute(${lit(ROW_IDX_ATTR)}, idxs.join(','));
    hit.style.cursor = 'pointer';
    svg.appendChild(hit);
    if (idxs.length) {
      var bar = svgEl('rect', { x: x + 1, y: padT + plotH - h,
        width: Math.max(1, bw - 2), height: h, fill: ACCENT, 'fill-opacity': 0.85 });
      bar.setAttribute('pointer-events', 'none');
      svg.appendChild(bar);
    }
  });

  // Endpoints only: a deterministic chart should not pretend to a tick strategy it has not
  // earned, and two honest numbers beat a crowded axis.
  var loT = svgEl('text', { x: padL, y: H - 4, 'font-size': CF - 1, fill: FG });
  loT.textContent = compact(lo);
  var hiT = svgEl('text', { x: W - padR, y: H - 4, 'text-anchor': 'end', 'font-size': CF - 1, fill: FG });
  hiT.textContent = compact(hi);
  svg.appendChild(loT); svg.appendChild(hiT);

  container.appendChild(svg);
}`;
}
