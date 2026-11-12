// BIC generated chart — Selection explainer [D3]
// host contract v1.24.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// bic:keyboard-marks
d3.llmSegmented = function (svg, cfg) {
  // A ROW OF MUTUALLY EXCLUSIVE BUTTONS THE READER OWNS - "Stacked | Grouped | 100%".
  //
  //   d3.llmSegmented(svg, cfg) where cfg =
  //     container : the render container (the shared bag lives on it as container.__lchSegments)
  //     options   : host options (uiState, setUiState, themeFg, themeAccent, width, height, and
  //                 optionally onControlChange - called {control,key,value} when a READER clicks,
  //                 never on 'init'; advisory telemetry, and a host that omits it changes nothing)
  //     key       : this control's name inside the bag ('form', 'sort', ...)
  //     choices   : [{ value: 'stacked', label: 'Stacked' }, ...] - at least two; a plain string is a
  //                 choice whose value and label are that string
  //     default   : the value a fresh or unreadable restore lands on (must be one of choices)
  //     x, y      : the row's left edge and vertical CENTRE
  //     fontSize  : the chart's own FS - PASS IT. Default clamp(TYPE_FLOOR..14, min(width, height) / 55);
  //                 a size below TYPE_FLOOR (the minimum readable type) is raised to it.
  //     label     : optional text drawn left of the row ('Show')
  //     onChange  : function (value, phase) - phase is 'init' (first paint, INCLUDING a restored
  //                 value) or 'click' (the reader chose). The CHART redraws on both; it runs its
  //                 transition only on 'click', so a restore never animates in.
  //   returns { value(), set(v, fire), g, bounds() }
  //     bounds() -> { left, right, width, height }: the row's extent, so a caller can reserve
  //                 the band above the plot BEFORE sizing the plot.
  //   d3.llmSegmented.measure(cfg) -> { width, height } without drawing, for the same reason.
  //
  // CONTROLS, NOT MARKS. No d3-mark, no data-row-idx, no d3-axis-filter anywhere in this row, so
  // a click here never cross-filters and never reaches the host's selection bridge. Each button's
  // hit rect is at least 20x20 whatever the font.
  //
  // ONE BAG PER CONTAINER, persisted by MERGE. The persisting host's setUiState REPLACES the whole
  // state object, so two controls writing separately would clobber each other, and a chart that
  // also persists a knob or a frame would lose it on the first click. Every segmented control on
  // one container reads and writes container.__lchSegments, and the write copies the last full
  // state any helper wrote during THIS render (container.__lchUiLive, the record llmSlider and
  // llmScrubber already share) before replacing only `segments`.
  //
  // PERSIST ON 'click' ONLY, never on 'init'. A restore that wrote back what it just read would
  // echo through a persisting host as a fresh render - a write storm on every paint.
  //
  // A RESTORED VALUE IS UNTRUSTED: not a string, not one of the choices, a prototype key - all
  // fall to the default. Never a throw. Generated charts are committed source and outlive the
  // state they wrote; the execution gate poisons the bag on purpose to prove it.
  var TYPE_FLOOR = 10;   // the minimum readable type, px
  cfg = cfg || {};
  var options = cfg.options || {}, container = cfg.container;
  var key = typeof cfg.key === 'string' && cfg.key ? cfg.key : 'segment';
  var onChange = typeof cfg.onChange === 'function' ? cfg.onChange : function () {};
  // A PLAIN STRING IS A CHOICE whose value and label are that string. A model writes ['Stacked', 'Grouped']
  // as readily as the object form, and dropping the strings drew no control at all.
  var offered = Array.isArray(cfg.choices) ? cfg.choices : [];
  var choices = offered.map(d3.llmSegmented.choice).filter(function (c) {
    return c && typeof c.value === 'string' && c.value !== '';
  });
  var noop = { value: function () { return null; }, set: function () {}, g: null,
               bounds: function () { return { left: 0, right: 0, width: 0, height: 0 }; } };
  // AN INERT CALL IS MARKED. Two or more choices were offered and fewer than two are usable, so nothing is
  // drawn; the svg records the control's key and the execution gate heals the chart rather than shipping
  // a toggle the reader never sees. One choice is a chart with nothing to offer, and is never marked.
  if (!svg || choices.length < 2) {
    if (svg && offered.length >= 2 && typeof svg.attr === 'function') {
      var inert = svg.attr('data-llm-inert-control');
      svg.attr('data-llm-inert-control', (inert ? inert + ',' : '') + key);
    }
    return noop;
  }
  var fg = options.themeFg || '#252423', accent = options.themeAccent || fg;
  var fsz = Math.max(TYPE_FLOOR, +cfg.fontSize > 0 ? +cfg.fontSize
    : Math.min(14, Math.min(options.width || 600, options.height || 400) / 55));
  var geo = d3.llmSegmented.measure({ choices: choices, fontSize: fsz, label: cfg.label });
  var x = cfg.x != null ? +cfg.x : 0, y = cfg.y != null ? +cfg.y : 0;

  function isChoice(v) {
    if (typeof v !== 'string') return false;
    for (var i = 0; i < choices.length; i++) if (choices[i].value === v) return true;
    return false;
  }
  var fallback = isChoice(cfg['default']) ? cfg['default'] : choices[0].value;

  // ONE BAG PER CONTAINER.
  var bag = {};
  if (container) {
    if (!container.__lchSegments || typeof container.__lchSegments !== 'object') container.__lchSegments = {};
    bag = container.__lchSegments;
  }
  var ui = options.uiState && typeof options.uiState === 'object' ? options.uiState : {};
  var restoredBag = ui.segments && typeof ui.segments === 'object' ? ui.segments : null;
  var restored = restoredBag && Object.prototype.hasOwnProperty.call(restoredBag, key) ? restoredBag[key] : undefined;
  var cur = isChoice(restored) ? restored : fallback;

  var g = svg.append('g').attr('class', 'llm-segmented').attr('data-segment-key', key);
  var left = x;
  if (cfg.label) {
    g.append('text').attr('class', 'llm-segmented-label')
      .attr('x', left).attr('y', y + fsz * 0.35).attr('font-size', Math.max(TYPE_FLOOR, fsz * 0.9))
      .attr('fill', fg).attr('fill-opacity', 0.75).text(String(cfg.label));
    left += geo.labelW;
  }
  var buttons = [];
  choices.forEach(function (c, i) {
    var w = geo.buttonW[i];
    // A CONTROL THE KEYBOARD REACHES: lch-control lets the host focus it and press it with Enter or Space.
    var b = g.append('g').attr('class', 'llm-segmented-button lch-control').attr('data-segment-value', c.value)
      .attr('cursor', 'pointer').attr('role', 'button')
      .attr('aria-label', (cfg.label ? String(cfg.label) + ': ' : '') + String(c.label == null ? c.value : c.label));
    // The HIT RECT is the whole button and never shorter than 20px.
    b.append('rect').attr('class', 'llm-segmented-hit')
      .attr('x', left).attr('y', y - geo.height / 2).attr('width', w).attr('height', geo.height)
      .attr('rx', i === 0 || i === choices.length - 1 ? 3 : 0)
      .attr('stroke', fg).attr('stroke-opacity', 0.35);
    b.append('text').attr('class', 'llm-segmented-text')
      .attr('x', left + w / 2).attr('y', y + fsz * 0.35).attr('text-anchor', 'middle')
      .attr('font-size', fsz).text(String(c.label == null ? c.value : c.label));
    b.on('click', function (event) {
      // Swallow the event so the host's container click handler does not read a click on a
      // control as a click on empty canvas and clear the reader's selection.
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      setCur(c.value, 'click');
    });
    buttons.push({ value: c.value, g: b });
    left += w;
  });

  function paint() {
    buttons.forEach(function (bt) {
      var on = bt.value === cur;
      bt.g.attr('aria-pressed', on ? 'true' : 'false');
      bt.g.select('rect').attr('fill', on ? accent : 'transparent').attr('fill-opacity', on ? 0.18 : 0);
      bt.g.select('text').attr('fill', fg).attr('font-weight', on ? 'bold' : 'normal');
    });
  }
  function persist() {
    bag[key] = cur;
    if (typeof options.setUiState !== 'function') return;
    var live = container && container.__lchUiLiveOpts === options && container.__lchUiLiveSeed === options.uiState
      ? container.__lchUiLive : null;
    var base = live || ui;
    var next = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
    next.segments = {};
    for (k in bag) if (Object.prototype.hasOwnProperty.call(bag, k)) next.segments[k] = bag[k];
    if (container) { container.__lchUiLive = next; container.__lchUiLiveOpts = options; container.__lchUiLiveSeed = options.uiState; }
    // Best-effort: a host that refuses the write must never take the chart down with it.
    try { options.setUiState(next); } catch (e) { /* persistence is advisory, never fatal */ }
  }
  // A READER worked this control, reported so a host can log the gesture instead of only
  // inferring it from the persist that follows. CLICKS ONLY: the value a control settles on at
  // first paint is already in the persisted view-state, and reporting every repaint would bury
  // the gestures under resizes. ADVISORY AND NEVER FATAL - this runs inside a click handler, so
  // a host that throws here must not take the reader's gesture with it.
  function report() {
    if (!options || typeof options.onControlChange !== 'function') return;
    try { options.onControlChange({ control: 'segmented', key: key, value: cur }); }
    catch (e) { /* telemetry is advisory, never fatal */ }
  }
  function setCur(v, phase) {
    if (!isChoice(v)) return;
    if (v === cur && phase !== 'init') return;         // re-clicking the active button does nothing
    cur = v;
    paint();
    if (phase === 'click') { persist(); report(); }
    onChange(cur, phase);
  }

  paint();
  bag[key] = cur;
  onChange(cur, 'init');
  return {
    value: function () { return cur; },
    g: g,
    set: function (v, fire) { setCur(v, fire === false ? 'init' : 'click'); },
    bounds: function () { return { left: x, right: x + geo.width, width: geo.width, height: geo.height }; }
  };
};
// The row's size WITHOUT drawing it, so a chart can reserve the band before it sizes its plot.
// Width per button is the 0.6em estimate llmSlider and llmFitLabel fall back to, plus padding.
d3.llmSegmented.measure = function (cfg) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px - the row draws no smaller, so it reserves no smaller
  cfg = cfg || {};
  var fsz = Math.max(TYPE_FLOOR, +cfg.fontSize > 0 ? +cfg.fontSize : 11);
  var choices = (Array.isArray(cfg.choices) ? cfg.choices : []).map(d3.llmSegmented.choice);
  var pad = fsz * 0.9;
  var buttonW = choices.map(function (c) {
    var t = String(c && (c.label == null ? c.value : c.label));
    return Math.max(20, Math.round(t.length * fsz * 0.6 + pad * 2));
  });
  var labelW = cfg.label ? Math.round(String(cfg.label).length * Math.max(TYPE_FLOOR, fsz * 0.9) * 0.6 + fsz * 0.6) : 0;
  var width = labelW + buttonW.reduce(function (a, b) { return a + b; }, 0);
  return { width: width, height: Math.max(20, Math.round(fsz * 1.9)), buttonW: buttonW, labelW: labelW };
};
// One choice as the helper reads it: a plain string becomes { value: s, label: s }; anything else is
// passed through for the value check.
d3.llmSegmented.choice = function (c) { return typeof c === 'string' ? { value: c, label: c } : c; };
// SHARED statistics for the Selection explainer. Draws nothing, touches no DOM, no host global and no clock, and reads no
// random source: the same rows, config and selection give the same panel in every host. It answers one question for a
// group of selected rows - which of the OTHER fields set them apart from the rest of the rows in view - and it answers it
// the same way every time, so no chart re-implements a test.
//
// WHAT IS COMPARED. S = the k selected rows, R = the other n - k rows in view; two disjoint groups.
//   category attribute : each level (the 12 most frequent, each with at least 5 rows in view; the rest are pooled and not
//                        tested; a blank is a level named (blank)) is one comparison of a 0/1 indicator, tested with
//                        Fisher's exact test, two-sided (every table with the same margins whose probability is at most the
//                        observed one times 1 + 1e-7, summed). A field whose tested levels are exactly TWO and cover every
//                        row is ONE comparison: its two tables are complements with the same p and the same |delta|, so
//                        counting both would inflate the correction's family with a duplicate. It is stated as the level the
//                        selection holds more of, unless only the other passes the support rule. With three or more levels
//                        each level is its own question (are they more often A? more often B?) and stays its own comparison.
//   measure attribute  : the column's non-blank values in S against R (at least 5 non-blank in each), tested with
//                        Mann-Whitney U, two-sided, normal approximation with the tie-corrected variance
//                        n1 n2 / 12 * ((n + 1) - sum(t^3 - t) / (n (n - 1))) and a continuity correction of 0.5.
//   one effect size    : Cliff's delta = P(x_S > x_R) - P(x_S < x_R) = 2 U / (n1 n2) - 1. On a 0/1 indicator it is exactly
//                        the share in S minus the share in R, so categories and measures rank on one scale in [-1, 1].
//   the correction     : Benjamini-Hochberg at q (0.05) over EVERY comparison drawn for this selection - all measures and
//                        all tested levels - step-up, tied p-values keeping input order.
// A FIELD IS LISTED when ALL hold: BH-significant; |delta| >= deltaFloor (0.2); support (an over-represented level has at
// least 5 selected rows; an under-represented one has k * share-in-R >= 5); and the selection is big enough for the
// exact tests to reach q at all (2 / C(k + r, min(k, r)) < q; a group under 10 on either side is 'small'). Under that nothing is
// tested and the result says so.
// The two AXES are never tested (the selection is defined on them). Nor is a measure whose Spearman |rho| with an axis is at
// least trackRho (0.7) over the rows in view: any group drawn on that axis differs on it, so it would echo the gesture, not
// find anything. It is named once in echoes / echoText ("Revenue tracks MarketingSpend, so it isn't compared") for the panel's
// resting text. A field drawn as the plot's color carries the tag (shown as color). A column that is constant, a row key,
// blank on 80% or more of the rows, or absent from the data is dropped and named in excluded.
// NOTHING LISTED: state 'nothing' still returns the CLOSEST comparison (the supported ones first, all of them when none is;
// the smallest adjusted p, then the ranking) in a finding's format and marked notSignificant, with the reason it is not a
// finding: 'chance' (BH fails), 'small' (|delta| under the floor) or 'few' (the support rule fails). The panel draws it muted
// and without a glyph, so it never reads as a finding.
//
// CALL:  var C = d3.llmContrast(data, { attributes: [{ name: 'Region', kind: 'category' }, { name: 'Tenure', kind: 'measure' }],
//                                       axes: ['Monthly Spend', 'Support Tickets'], encoded: { color: 'Region' },
//                                       culture: options.cultureCode, formats: { 'Discount %': '0%' },
//                                       q: 0.05, deltaFloor: 0.2, maxLevels: 12, trackRho: 0.7 });
//        var r = C.explain(rowIdxs);      // indices into data.rows (an array, a Set or a comma-separated string)
//        r = { state: 'zero' | 'underMinimum' | 'restUnderMinimum' | 'noFields' | 'noComparisons' | 'nothing' | 'found',
//              n, k, rest, title, text, findings, closest, tested, comparisons, footer, remainder, fields, fieldsText,
//              echoes, echoText, excluded, all }
//        r.findings[i] = { field, kind, level, sentence, text, tracks (always null), asColor, note, p, padj, delta, more,
//                          moreText, others, category: shareSel, shareRest, inSel, inRest | measure: medianSel, medianRest, ratio, q1Sel... }
//        r.closest = null | the same fields + { notSignificant: true, reason, qText }, text = 'Closest: {sentence} (could be chance, q=0.31)',
//                         and '(could be chance, no sign of a difference)' where q rounds to 1
//        C.zero({ lassoOff: true })       // the panel's words before anything is selected; C.echoes = [{ field, axis, rho }]
//        C.stats                          // lgamma, erfc, fisherExact, mannWhitney, benjaminiHochberg, spearman
//        C.format(name)                   // a field's value formatter (v -> text) from its format, or null when it has none
// FORMATS: every measure number (a median, a threshold) prints in the column's OWN format - data.columns[i].modelFormat, the
// semantic model's format string, read the house way: '0.0%' prints 0.42 as 42%, '$#,##0' prints $1,234 (a million and up as
// $1.2M), '#,##0.00' two decimals at most. cfg.formats[name] overrides it per field: a format string, or a spec
// { percent, digits, prefix, suffix }. A field with neither is formatted by magnitude.
d3.llmContrast = function (data, cfg) {
  cfg = cfg || {};
  var allRows, columns;
  if (Array.isArray(data)) { allRows = data; columns = []; }
  else { columns = (data && data.columns) || []; allRows = (data && data.rows) || []; }
  var n = allRows.length;
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, '$' + k); }
  function get(o, k) { return o['$' + k]; }
  function put(o, k, v) { o['$' + k] = v; }
  var colIdx = {}, colNames = [], ci, cn;
  for (ci = 0; ci < columns.length; ci++) {
    cn = columns[ci] && (columns[ci].name !== undefined ? columns[ci].name : columns[ci]);
    if (cn !== undefined && cn !== null && !has(colIdx, String(cn))) { put(colIdx, String(cn), ci); colNames.push(String(cn)); }
  }
  if (!colNames.length && n && allRows[0] && typeof allRows[0] === 'object' && !Array.isArray(allRows[0])) {
    Object.keys(allRows[0]).forEach(function (c) { put(colIdx, c, -1); colNames.push(c); });
  }
  function cell(row, name) {
    if (row === null || row === undefined) return undefined;
    if (Array.isArray(row)) { var ix = get(colIdx, name); return ix === undefined || ix < 0 ? undefined : row[ix]; }
    return row[name];
  }
  function num(v) {
    if (v === null || v === undefined || typeof v === 'boolean') return NaN;
    if (typeof v === 'string') { v = v.trim(); if (v === '') return NaN; }
    var x = typeof v === 'number' ? v : +v;
    return isFinite(x) ? x : NaN;
  }
  function levelKey(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function norm(s) {
    var t = String(s).toLowerCase();
    if (typeof t.normalize === 'function') t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.replace(/[\s_\-.,;:'"()\[\]{}%#\/\\]+/g, '');
  }
  function resolveName(name) {
    if (name === undefined || name === null) return null;
    var s = String(name);
    if (has(colIdx, s)) return s;
    var t = norm(s), hit = null, count = 0, i;
    if (t === '') return null;
    for (i = 0; i < colNames.length; i++) if (norm(colNames[i]) === t) { hit = colNames[i]; count++; }
    return count === 1 ? hit : null;
  }
  function pick(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  var q = pick(cfg.q, 0.05); if (!(q > 0 && q < 1)) q = 0.05;
  // THE MINIMUM IS THE TESTS' OWN. A fixed 10-point minimum refused a group of 4 of the 10 products
  // a page filter left, though Fisher's and Mann-Whitney's exact tests can speak at that size. A selection of k with r outside is
  // compared when the most extreme split those k and r rows allow reaches q at all - its exact p, 2 / C(k + r, min(k, r)), under
  // q. Below that no difference could be told from chance whatever the data, and the panel says so. A group the fixed minimum
  // refused (classicMin, 10 on either side) is "small": the per-field floors below fit the group, and a result that passes
  // nothing says plainly that a difference this size can't be told from chance with so few. cfg.minSelected, when stated,
  // still holds as a floor of its own.
  var minStated = typeof cfg.minSelected === 'number' && isFinite(cfg.minSelected);
  var minSelected = Math.max(1, Math.floor(pick(cfg.minSelected, 1)));
  var classicMin = 10;
  function logChoose(a, b) { return lgamma(a + 1) - lgamma(b + 1) - lgamma(a - b + 1); }
  function canReach(k, r) {
    if (!(k >= 1 && r >= 1) || k < minSelected || r < minSelected) return false;
    return Math.log(2) - logChoose(k + r, Math.min(k, r)) < Math.log(q);
  }
  var deltaFloor = pick(cfg.deltaFloor, 0.2);
  var maxLevels = Math.max(1, Math.floor(pick(cfg.maxLevels, 12)));
  var trackRho = pick(cfg.trackRho, 0.7);
  var minLevelRows = pick(cfg.minLevelRows, 5);       // a level under this many rows in view is pooled and not tested
  var minGroupValues = pick(cfg.minGroupValues, 5);   // a measure needs this many non-blank values in each group
  var minSupport = pick(cfg.minSupport, 5);
  var maxBlank = pick(cfg.maxBlank, 0.8);
  // the described layer: from this many points (the tests keep minSelected), and only what clears its floors
  var minDescribed = Math.max(2, Math.floor(pick(cfg.minDescribed, 5)));
  var shareGapFloor = pick(cfg.shareGapFloor, 0.1);    // a level's share in the selection vs all rows, 10 points apart
  var shareListed = pick(cfg.shareListed, 0.05);       // a level is described only when it is 5% of either
  var effectFloor = pick(cfg.effectFloor, 0.3);        // |Cliff's delta| for a measure
  var halfShare = pick(cfg.halfShare, 0.7);            // the share of the selection in one half of a measure
  var maxDescribed = Math.max(1, Math.floor(pick(cfg.maxDescribed, 3)));
  var fdrPct = (function () { var v = Math.round(q * 10000) / 100; return String(v); })();

  // ---- numerics: log-gamma (the same Lanczos as llmPredictor), the normal tail, Fisher, rank sums, Benjamini-Hochberg ----
  function lgamma(x) {
    var g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
      12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    var a = g[0], t = x + 7.5;
    for (var i = 1; i < 9; i++) a += g[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  // erfc(x) for x >= 0 through the regularised incomplete gamma Q(1/2, x^2): a series below x^2 = 1.5, Lentz's continued
  // fraction above, both to a relative 1e-15, which keeps a tiny p-value correct in its leading digits.
  var LGAMMA_HALF = 0.5 * Math.log(Math.PI);
  function erfc(x) {
    if (!(x > 0)) return x === 0 ? 1 : (x < 0 ? 2 - erfc(-x) : NaN);
    var u = x * x, i;
    if (u < 1.5) {
      var ap = 0.5, sum = 2, del = 2;
      for (i = 0; i < 500; i++) { ap += 1; del *= u / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-17) break; }
      return 1 - sum * Math.exp(-u + 0.5 * Math.log(u) - LGAMMA_HALF);
    }
    var FP = 1e-300, b = u + 0.5, c = 1 / FP, d = 1 / b, h = d;
    for (i = 1; i < 500; i++) {
      var an = -i * (i - 0.5);
      b += 2; d = an * d + b; if (Math.abs(d) < FP) d = FP;
      c = b + an / c; if (Math.abs(c) < FP) c = FP;
      d = 1 / d;
      var dl = d * c; h *= dl;
      if (Math.abs(dl - 1) < 1e-16) break;
    }
    return Math.exp(-u + 0.5 * Math.log(u) - LGAMMA_HALF) * h;
  }
  // two-sided Fisher p for a table with x selected rows holding the level, k selected, L rows holding it, N rows: the
  // hypergeometric terms are summed over every x whose probability is at most the observed one times (1 + 1e-7).
  function fisherWith(lf, x, k, L, N) {
    if (k <= 0 || L <= 0 || k >= N || L >= N) return 1;
    var lo = Math.max(0, k - (N - L)), hi = Math.min(k, L), base = lf[k] + lf[N - k] + lf[L] + lf[N - L] - lf[N];
    function pmf(t) { return Math.exp(base - lf[t] - lf[L - t] - lf[k - t] - lf[N - L - k + t]); }
    var pobs = pmf(x), cut = pobs * (1 + 1e-7), sum = 0;
    for (var t = lo; t <= hi; t++) { var pt = pmf(t); if (pt <= cut) sum += pt; }
    return sum > 1 ? 1 : sum;
  }
  function logFactorials(upTo) {
    var lf = new Array(upTo + 1);
    lf[0] = 0; if (upTo >= 1) lf[1] = 0;
    for (var i = 2; i <= upTo; i++) lf[i] = lgamma(i + 1);
    return lf;
  }
  var LF = null;
  function fisherP(x, k, L, N) { if (!LF) LF = logFactorials(n); return fisherWith(LF, x, k, L, N); }
  // Mann-Whitney from the sample-one rank-sum statistic: scipy's method="asymptotic", use_continuity=True
  function mwP(U1, n1, n2, tieTerm, ranks) {
    if (ranks && n1 + n2 <= 30) return mwExactP(ranks, n1, U1);
    var nn = n1 + n2, mu = n1 * n2 / 2, U = Math.max(U1, n1 * n2 - U1);
    var s2 = n1 * n2 / 12 * ((nn + 1) - tieTerm / (nn * (nn - 1)));
    if (!(s2 > 0)) return 1;
    var z = (U - mu - 0.5) / Math.sqrt(s2);
    if (!(z > 0)) return 1;
    var p = erfc(z / Math.SQRT2);
    return p > 1 ? 1 : p;
  }
  // the EXACT two-sided Mann-Whitney p over the n1 + n2 ranks as they are (ties keep their mid-ranks): every way of choosing n1
  // of them, counted by their rank sum (doubled, so a mid-rank is an integer), and the share at least as far from the mean
  function mwExactP(ranks, n1, U1) {
    var N = ranks.length, R2 = ranks.map(function (x) { return Math.round(2 * x); }), tot = 0, i, j, s;
    for (i = 0; i < N; i++) tot += R2[i];
    var ways = [];
    for (j = 0; j <= n1; j++) ways.push(new Float64Array(tot + 1));
    ways[0][0] = 1;
    for (i = 0; i < N; i++) for (j = Math.min(n1, i + 1); j >= 1; j--) for (s = tot; s >= R2[i]; s--) ways[j][s] += ways[j - 1][s - R2[i]];
    var all = 0, far = 0, mean = n1 * tot / N, obs = 2 * (U1 + n1 * (n1 + 1) / 2), gap = Math.abs(obs - mean) - 1e-9;
    for (s = 0; s <= tot; s++) { var w = ways[n1][s]; if (!w) continue; all += w; if (Math.abs(s - mean) >= gap) far += w; }
    return all > 0 ? Math.min(1, far / all) : 1;
  }
  function rankOrder(order, vals, size) {
    var ranks = new Float64Array(size), tie = 0, i = 0, m = order.length;
    while (i < m) {
      var j = i;
      while (j + 1 < m && vals[order[j + 1]] === vals[order[i]]) j++;
      var avg = (i + j) / 2 + 1, t = j - i + 1, s;
      for (s = i; s <= j; s++) ranks[order[s]] = avg;
      if (t > 1) tie += t * t * t - t;
      i = j + 1;
    }
    return { ranks: ranks, tie: tie };
  }
  function sortedOrder(vals, present) {
    var order = [], i;
    for (i = 0; i < vals.length; i++) if (present(i)) order.push(i);
    order.sort(function (a, b) { return vals[a] - vals[b] || a - b; });
    return order;
  }
  function pearson(xs, ys, m) {
    var i, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < m; i++) { mx += xs[i]; my += ys[i]; }
    mx /= m; my /= m;
    for (i = 0; i < m; i++) { var dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }
  function spearman(xs, ys) {
    var px = [], py = [], i;
    for (i = 0; i < xs.length && i < ys.length; i++) {
      var a = num(xs[i]), b = num(ys[i]);
      if (a === a && b === b) { px.push(a); py.push(b); }
    }
    if (px.length < 3) return NaN;
    var rx = rankOrder(sortedOrder(px, function () { return true; }), px, px.length).ranks;
    var ry = rankOrder(sortedOrder(py, function () { return true; }), py, py.length).ranks;
    return pearson(rx, ry, px.length);
  }
  // Benjamini-Hochberg, statsmodels' fdr_bh: sort ascending (ties keep input order), reject up to the largest rank i with
  // p(i) <= (i / m) * q, and the adjusted p is the running minimum of p(i) * m / i from the top, capped at 1.
  function benjaminiHochberg(ps, level) {
    var m = ps.length, order = [], i;
    for (i = 0; i < m; i++) order.push(i);
    order.sort(function (a, b) { return ps[a] - ps[b] || a - b; });
    var reject = new Array(m), padj = new Array(m), top = -1, run = Infinity;
    for (i = 0; i < m; i++) if (ps[order[i]] <= ((i + 1) / m) * level) top = i;
    for (i = m - 1; i >= 0; i--) {
      var v = ps[order[i]] * m / (i + 1);
      if (v < run) run = v;
      padj[order[i]] = run > 1 ? 1 : run;
      reject[order[i]] = i <= top;
    }
    return { reject: reject, padj: padj };
  }
  function mannWhitney(xs, ys) {
    var vals = [], i, n1 = 0, n2 = 0;
    for (i = 0; i < xs.length; i++) { var a = num(xs[i]); if (a === a) { vals.push(a); n1++; } }
    for (i = 0; i < ys.length; i++) { var b = num(ys[i]); if (b === b) { vals.push(b); n2++; } }
    var ro = rankOrder(sortedOrder(vals, function () { return true; }), vals, vals.length), r1 = 0;
    for (i = 0; i < n1; i++) r1 += ro.ranks[i];
    var U1 = r1 - n1 * (n1 + 1) / 2;
    return { U: U1, p: mwP(U1, n1, n2, ro.tie), delta: (2 * U1 - n1 * n2) / (n1 * n2), n1: n1, n2: n2 };
  }
  function quantile(sorted, pr) {
    var m = sorted.length;
    if (!m) return NaN;
    var pos = (m - 1) * pr, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // ---- number words: formatted by magnitude in the reader's culture ----
  var culture = typeof cfg.culture === 'string' && cfg.culture ? cfg.culture : 'en-US';
  var nfCache = {};
  function nfFor(opts) {
    var key = JSON.stringify(opts);
    if (nfCache[key]) return nfCache[key];
    var f = null;
    if (typeof Intl !== 'undefined' && Intl && typeof Intl.NumberFormat === 'function') {
      try { f = new Intl.NumberFormat(culture, opts); }
      catch (e) { try { f = new Intl.NumberFormat('en-US', opts); } catch (e2) { f = null; } }
    }
    nfCache[key] = f;
    return f;
  }
  function plain(v, maxFrac) {
    var s = String(Math.round(v * Math.pow(10, maxFrac)) / Math.pow(10, maxFrac));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmt(v, opts, maxFrac) {
    var f = nfFor(opts);
    return f ? f.format(v) : plain(v, maxFrac);
  }
  function fmtInt(v) { return fmt(v, { maximumFractionDigits: 0 }, 0); }
  function fmtMag(v, spec) {
    spec = spec || {};
    var x = spec.percent ? v * 100 : v, a = Math.abs(x), s;
    if (x === 0) s = '0';
    else if (spec.model && !spec.percent && a >= 1000000) s = fmt(x, { notation: 'compact', maximumFractionDigits: 1 }, 0);
    else if (typeof spec.digits === 'number') s = fmt(x, { minimumFractionDigits: spec.fixed ? spec.digits : 0, maximumFractionDigits: spec.digits }, spec.digits);
    else if (a >= 1000000) s = fmt(x, { notation: 'compact', maximumFractionDigits: 1 }, 0);
    else if (a >= 100) s = fmt(x, { maximumFractionDigits: 0 }, 0);
    else if (a >= 10) s = fmt(x, { maximumFractionDigits: 1 }, 1);
    else if (a >= 1) s = fmt(x, { maximumFractionDigits: 2 }, 2);
    else s = fmt(x, { maximumSignificantDigits: 2 }, 3);
    if (spec.percent) s += '%';
    if (spec.prefix && /^[-\u2212]/.test(s)) return s.charAt(0) + spec.prefix + s.slice(1) + (spec.suffix || '');
    return (spec.prefix || '') + s + (spec.suffix || '');
  }
  function fmtShare(share) {
    var pct = share * 100;
    if (pct > 0 && pct < 1) return fmt(pct, { maximumSignificantDigits: 1 }, 1);
    if (pct > 99 && pct < 100) return fmt(Math.min(99.9, pct), { maximumFractionDigits: 1 }, 1);
    return fmtInt(Math.round(pct));
  }
  function plural(count, one, many) { return count === 1 ? one : many; }
  var formats = cfg.formats && typeof cfg.formats === 'object' ? cfg.formats : {};
  // A format string (a column's modelFormat, '0.0%', '$#,##0.00', '#,##0') as a spec: its first section, literals and
  // [..] tokens aside. A percent keeps its decimals as a ceiling (42%, 12.5%); money with decimals keeps them all ($29.00,
  // never $29.0). A date or text format (no 0 or #) is no number format.
  function specOfFormat(mf) {
    if (typeof mf !== 'string' || !mf.trim()) return null;
    var sec = mf.split(';')[0];
    var sym = (/\[\$([^\-\]]+)/.exec(sec) || [])[1] || '';
    var noTok = sec.replace(/\[[^\]]*\]/g, '');
    var bare = noTok.replace(/"[^"]*"/g, '').replace(/\\./g, '');
    if (!sym) { var cur = /[$\u20AC\u00A3\u00A5]/.exec(noTok); if (cur) sym = cur[0]; }
    var pct = bare.indexOf('%') >= 0;
    if (!pct && !/[0#]/.test(bare)) return null;
    var dm = /\.([0#]+)/.exec(bare), digits = dm ? dm[1].length : 0;
    return { percent: pct, digits: digits, fixed: !!sym && !pct && digits > 0, prefix: sym, model: true };
  }
  var specCache = {};
  function specFor(name) {
    if (has(specCache, name)) return get(specCache, name);
    var s = formats[name], spec = null;
    if (typeof s === 'string') spec = specOfFormat(s);
    else if (s && typeof s === 'object') spec = s;
    else {
      var ix = get(colIdx, name), col = ix === undefined || ix < 0 ? null : columns[ix];
      spec = col && typeof col === 'object' ? specOfFormat(col.modelFormat) : null;
    }
    put(specCache, name, spec);
    return spec;
  }

  // ---- the attributes: re-checked against the rows in view, once ----
  var axisNames = [], axisVals = [], axisRanks = [], axisFull = [];
  (cfg.axes || []).forEach(function (a) {
    var real = resolveName(a && a.name !== undefined ? a.name : a);
    if (real === null || axisNames.indexOf(real) >= 0) return;
    var vals = new Float64Array(n), cnt = 0, i;
    for (i = 0; i < n; i++) { vals[i] = num(cell(allRows[i], real)); if (vals[i] === vals[i]) cnt++; }
    axisNames.push(real); axisVals.push(vals); axisFull.push(cnt === n);
    axisRanks.push(cnt === n ? rankOrder(sortedOrder(vals, function () { return true; }), vals, n).ranks : null);
  });
  var colorName = cfg.encoded && cfg.encoded.color !== undefined && cfg.encoded.color !== null ? resolveName(cfg.encoded.color) : null;

  var attrs = [], excluded = [], echoes = [], echoPreps = [], seen = {};
  function drop(name, reason, text) { excluded.push({ name: name, reason: reason, text: name + ': ' + text }); }
  function guessKind(real) {
    var seenAny = false, i;
    for (i = 0; i < n; i++) {
      var v = cell(allRows[i], real);
      if (levelKey(v) === '') continue;
      seenAny = true;
      if (num(v) !== num(v)) return 'category';
    }
    return seenAny ? 'measure' : 'category';
  }
  function prepCategory(real, order) {
    var keys = new Array(n), counts = {}, distinct = 0, i;
    for (i = 0; i < n; i++) {
      var key = levelKey(cell(allRows[i], real));
      keys[i] = key;
      if (!has(counts, key)) { put(counts, key, 0); distinct++; }
      put(counts, key, get(counts, key) + 1);
    }
    var blanks = has(counts, '') ? get(counts, '') : 0;
    if (n && blanks / n >= maxBlank) return { drop: 'blank', text: 'blank on ' + fmtInt(Math.round(100 * blanks / n)) + '% of rows' };
    if (distinct <= 1) return { drop: 'constant', text: 'the same value on every row' };
    if (n >= 20 && distinct >= 0.9 * n) return { drop: 'identifier', text: 'a row key' };
    var levels = [];
    // on data too small for the pooling floor (under 4 x minLevelRows rows), a level the exact test can speak to is kept
    Object.keys(counts).forEach(function (k) {
      var c = counts[k];
      if (c >= minLevelRows || (n < 4 * minLevelRows && canReach(c, n - c))) levels.push({ key: k.slice(1), count: c });
    });
    levels.sort(function (a, b) {
      var an = a.key === '' ? '(blank)' : a.key, bn = b.key === '' ? '(blank)' : b.key;
      return b.count - a.count || (an < bn ? -1 : an > bn ? 1 : 0);
    });
    levels = levels.slice(0, maxLevels);
    if (!levels.length) return { drop: 'sparse', text: 'too few rows in any value to compare' };
    var map = {}, rowLevel = new Int16Array(n);
    levels.forEach(function (lv, j) { put(map, lv.key, j); lv.name = lv.key === '' ? '(blank)' : lv.key; });
    for (i = 0; i < n; i++) rowLevel[i] = has(map, keys[i]) ? get(map, keys[i]) : -1;
    // two tested levels that hold every row are one comparison (their tables are complements)
    var binary = levels.length === 2 && levels[0].count + levels[1].count === n;
    // keys and counts keep EVERY level (not only the tested ones) for the described shares
    return { name: real, kind: 'category', order: order, levels: levels, rowLevel: rowLevel, binary: binary, keys: keys, counts: counts };
  }
  function prepMeasure(real, order) {
    var vals = new Float64Array(n), nn = 0, i, mn = Infinity, mx = -Infinity;
    for (i = 0; i < n; i++) {
      var x = num(cell(allRows[i], real));
      vals[i] = x;
      if (x === x) { nn++; if (x < mn) mn = x; if (x > mx) mx = x; }
    }
    if (n && (n - nn) / n >= maxBlank) return { drop: 'blank', text: 'blank on ' + fmtInt(Math.round(100 * (n - nn) / n)) + '% of rows' };
    if (nn < 2 * minGroupValues && !(n < 4 * minGroupValues && canReach(Math.floor(nn / 2), Math.ceil(nn / 2)))) return { drop: 'sparse', text: 'too few values to compare' };
    if (mn === mx) return { drop: 'constant', text: 'the same value on every row' };
    var order_ = sortedOrder(vals, function (j) { return vals[j] === vals[j]; });
    var ro = rankOrder(order_, vals, n);
    var at = { name: real, kind: 'measure', order: order, vals: vals, nn: nn, ranks: ro.ranks, tie: ro.tie, sorted: order_,
      min: mn, max: mx, neverNegative: mn >= 0, track: null };
    var best = null;
    axisNames.forEach(function (axName, j) {
      var rho;
      if (nn === n && axisFull[j]) rho = pearson(ro.ranks, axisRanks[j], n);
      else {
        var px = [], py = [];
        for (var r = 0; r < n; r++) if (vals[r] === vals[r] && axisVals[j][r] === axisVals[j][r]) { px.push(vals[r]); py.push(axisVals[j][r]); }
        rho = px.length < 3 ? NaN : pearson(rankOrder(sortedOrder(px, function () { return true; }), px, px.length).ranks,
          rankOrder(sortedOrder(py, function () { return true; }), py, py.length).ranks, px.length);
      }
      if (rho === rho && Math.abs(rho) >= trackRho && (!best || Math.abs(rho) > Math.abs(best.rho))) best = { axis: axName, rho: rho };
    });
    at.track = best;
    return at;
  }
  (cfg.attributes || []).forEach(function (a, order) {
    var raw = typeof a === 'string' ? a : a && a.name;
    if (raw === undefined || raw === null) return;
    var real = resolveName(raw);
    if (real === null) { drop(String(raw), 'missing', 'not in the data'); return; }
    if (has(seen, real)) return;
    put(seen, real, true);
    if (axisNames.indexOf(real) >= 0) { drop(real, 'axis', 'plotted on an axis'); return; }
    var kind = a && a.kind === 'measure' ? 'measure' : (a && a.kind === 'category' ? 'category' : guessKind(real));
    var prep = kind === 'measure' ? prepMeasure(real, order) : prepCategory(real, order);
    if (prep.drop) { drop(real, prep.drop, prep.text); return; }
    // an axis echo: any group drawn on the axis differs on this field too, so it is named, never tested
    if (prep.kind === 'measure' && prep.track) { echoes.push({ field: real, axis: prep.track.axis, rho: prep.track.rho }); echoPreps.push(prep); return; }
    attrs.push(prep);
  });
  var fieldNames = attrs.map(function (at) { return at.name; });
  var echoText = (function () {
    if (!echoes.length) return null;
    var parts = echoes.map(function (e) { return e.field + ' tracks ' + e.axis; });
    var said = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return said + (parts.length === 1 ? ", so it isn't compared" : ", so they aren't compared");
  })();

  // ---- words ----
  var ZERO_TEXT = 'Draw around a group of points to see which of your other fields set them apart';
  var OFF_TEXT = 'Lasso is turned off in the settings. Turn it on to draw around a group of points and see which of your other fields set them apart';
  var maxListed = Math.max(1, Math.floor(pick(cfg.maxListed, 8)));
  function fieldsLine() {
    if (!fieldNames.length) return '';
    var shown = fieldNames.slice(0, maxListed).join(', ');
    return fmtInt(fieldNames.length) + ' ' + plural(fieldNames.length, 'field', 'fields') + ': ' + shown + (fieldNames.length > maxListed ? ', ...' : '');
  }
  function base(k, rest) {
    return { state: '', n: n, k: k, rest: rest, title: null, text: null, findings: [], closest: null, tested: 0, comparisons: 0, footer: null,
      remainder: null, fields: fieldNames.slice(), fieldsText: fieldsLine(), echoes: echoes.map(function (e) { return { field: e.field, axis: e.axis, rho: e.rho }; }),
      echoText: echoText, excluded: excluded.slice(), all: [] };
  }
  function zero(opts) {
    var r = base(0, n);
    r.state = 'zero';
    r.text = opts && opts.lassoOff ? OFF_TEXT : ZERO_TEXT;
    if (!fieldNames.length) r.text = 'There are no other fields to compare the points on';
    return r;
  }

  // ---- one selection ----
  function selectionOf(rowIdxs) {
    var list = rowIdxs, i;
    if (typeof list === 'string') list = list.split(',');
    else if (list && !Array.isArray(list) && typeof list.forEach === 'function') { var tmp = []; list.forEach(function (v) { tmp.push(v); }); list = tmp; }
    var mask = new Uint8Array(n), idx = [];
    if (Array.isArray(list)) {
      for (i = 0; i < list.length; i++) {
        var v = list[i], x = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? +v : NaN);
        if (x !== Math.floor(x) || x < 0 || x >= n) continue;
        if (!mask[x]) { mask[x] = 1; idx.push(x); }
      }
    }
    idx.sort(function (a, b) { return a - b; });
    return { mask: mask, idx: idx, k: idx.length };
  }
  // a p-value compared at nine significant digits: the two tables of a two-level field are complements, so their p-values
  // are equal in exact arithmetic and differ only in the last bits, which must not decide which level is listed
  function pKey(p) { return p === 0 ? 0 : Number(p.toPrecision(9)); }
  function better(a, b) {
    var da = Math.abs(a.delta), db = Math.abs(b.delta);
    if (da !== db) return db - da;
    var pa = pKey(a.p), pb = pKey(b.p);
    if (pa !== pb) return pa - pb;
    if (a.at.order !== b.at.order) return a.at.order - b.at.order;
    return a.level < b.level ? -1 : a.level > b.level ? 1 : 0;
  }
  // the support rule's count: the usual minSupport, or on a small group half of it (a group the fixed minimum served keeps 5)
  function supportNeed(k, rest) { return Math.min(k, rest) < classicMin ? Math.min(minSupport, Math.max(2, Math.ceil(Math.min(k, rest) / 2))) : minSupport; }
  function categoryTests(at, sel, k, rest, out) {
    var hit = new Array(at.levels.length), j, i;
    for (j = 0; j < hit.length; j++) hit[j] = 0;
    for (i = 0; i < sel.idx.length; i++) { j = at.rowLevel[sel.idx[i]]; if (j >= 0) hit[j]++; }
    var mine = [];
    for (j = 0; j < hit.length; j++) {
      var a = hit[j], L = at.levels[j].count, b = L - a;
      var delta = (a * rest - b * k) / (k * rest);
      mine.push({ at: at, field: at.name, kind: 'category', level: at.levels[j].name, p: fisherP(a, k, L, n), delta: delta,
        a: a, b: b, nS: k, nR: rest, supported: delta > 0 ? a >= supportNeed(k, rest) : k * b >= supportNeed(k, rest) * rest });
    }
    if (at.binary) {
      // ONE comparison: the level the selection holds more of (the first on a tie), or the other when only it is supported
      var over = mine[0].delta >= mine[1].delta ? mine[0] : mine[1], under = over === mine[0] ? mine[1] : mine[0];
      var one = over.supported || !under.supported ? over : under;
      one.supported = over.supported || under.supported;
      mine = [one];
    }
    for (j = 0; j < mine.length; j++) out.push(mine[j]);
  }
  function measureTests(at, sel, out) {
    var r1 = 0, k1 = 0, i;
    for (i = 0; i < sel.idx.length; i++) { var rk = at.ranks[sel.idx[i]]; if (rk > 0) { r1 += rk; k1++; } }
    var n1 = k1, n2 = at.nn - k1;
    // a group the fixed minimum served keeps its floor; a smaller one is tested wherever the exact test can reach q
    var smallGroup = Math.min(sel.k, n - sel.k) < classicMin;
    if (smallGroup ? !canReach(n1, n2) : (n1 < minGroupValues || n2 < minGroupValues)) return;
    var U1 = r1 - n1 * (n1 + 1) / 2;
    var present = [];
    if (n1 + n2 <= 30) for (i = 0; i < n; i++) if (at.ranks[i] > 0) present.push(at.ranks[i]);
    var selRanks = [];
    if (present.length) {
      // the exact test reads the selection's ranks first, then the rest's
      for (i = 0; i < sel.idx.length; i++) if (at.ranks[sel.idx[i]] > 0) selRanks.push(at.ranks[sel.idx[i]]);
      for (i = 0; i < n; i++) if (at.ranks[i] > 0 && !sel.mask[i]) selRanks.push(at.ranks[i]);
    }
    out.push({ at: at, field: at.name, kind: 'measure', level: '', p: mwP(U1, n1, n2, at.tie, present.length ? selRanks : null), delta: (2 * U1 - n1 * n2) / (n1 * n2),
      nS: n1, nR: n2, supported: true });
  }
  function groupValues(at, mask) {
    var s = [], r = [], i;
    for (i = 0; i < at.sorted.length; i++) { var ix = at.sorted[i]; (mask[ix] ? s : r).push(at.vals[ix]); }
    return { s: s, r: r };
  }
  function describe(c, sel) {
    var at = c.at, f = { field: c.field, kind: c.kind, level: c.level, p: c.p, padj: c.padj, delta: c.delta, tracks: null,
      asColor: colorName !== null && c.field === colorName, note: null, more: 0, moreText: null, others: [] };
    if (c.kind === 'category') {
      f.inSel = c.a; f.inRest = c.b; f.shareSel = c.a / c.nS; f.shareRest = c.b / c.nR;
      f.sentence = fmtShare(f.shareSel) + '% are ' + c.field + ' = ' + c.level + ', vs ' + fmtShare(f.shareRest) + '%';
    } else {
      var g = groupValues(at, sel.mask), spec = specFor(c.field);
      f.medianSel = quantile(g.s, 0.5); f.medianRest = quantile(g.r, 0.5);
      f.q1Sel = quantile(g.s, 0.25); f.q3Sel = quantile(g.s, 0.75); f.q1Rest = quantile(g.r, 0.25); f.q3Rest = quantile(g.r, 0.75);
      f.min = at.min; f.max = at.max; f.nSel = c.nS; f.nRest = c.nR;
      f.ratio = null;
      var head = 'median ' + c.field + ' ' + fmtMag(f.medianSel, spec) + ' vs ' + fmtMag(f.medianRest, spec);
      if (f.medianSel > 0 && f.medianRest > 0 && at.neverNegative) {
        var ratio = f.medianSel / f.medianRest;
        if (ratio >= 0.1 && ratio <= 10) { f.ratio = ratio; head += ' (' + fmt(ratio, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, 1) + 'x)'; }
      }
      f.sentence = head;
    }
    return f;
  }
  function finish(f) {
    if (f.asColor) f.note = '(shown as color)';
    f.text = f.note ? f.sentence + ' ' + f.note : f.sentence;
    return f;
  }
  // an adjusted p in the reader's culture: two decimals from 0.1, two significant digits under it, '<0.001' at the bottom
  function fmtQ(v) {
    if (!(v < 0.995)) return '1';
    if (v >= 0.1) return fmt(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, 2);
    if (v >= 0.001) return fmt(v, { maximumSignificantDigits: 2 }, 4);
    return '<' + fmt(0.001, { maximumFractionDigits: 3 }, 3);
  }
  var CLOSEST_WHY = { chance: 'could be chance', small: 'a small difference', few: 'too few points to count' };
  var NOTHING_HEAD = { chance: 'Nothing passes the test against chance', small: 'Nothing differs by enough to count',
    few: 'Nothing has enough points to count' };
  function closestOf(cmps, sel) {
    var pool = cmps.filter(function (c) { return c.supported; });
    if (!pool.length) pool = cmps.slice();
    pool.sort(function (a, b) { var qa = pKey(a.padj), qb = pKey(b.padj); return qa !== qb ? qa - qb : better(a, b); });
    var c = pool[0], f = describe(c, sel);
    f.notSignificant = true;
    f.reason = !c.bh ? 'chance' : (!c.floor ? 'small' : 'few');
    // an adjusted p that rounds to 1 is no evidence of any difference, and 'q=1' reads as a typo to anyone who is not a statistician
    f.qText = fmtQ(c.padj) === '1' ? 'no sign of a difference' : 'q' + (c.padj < 0.001 ? '<' : '=') + fmtQ(c.padj).replace(/^</, '');
    f.text = 'Closest: ' + f.sentence + ' (' + CLOSEST_WHY[f.reason] + ', ' + f.qText + ')';
    return f;
  }

  // ---- DESCRIBED, NOT TESTED: the panel never ends on "nothing" ----
  // A fixed set of descriptive analyses under the verdict, whatever was selected, labelled as not tested so nothing here
  // reads as a finding: category shares vs ALL rows (a level that is 5% of either, 10 points apart), concentration (one
  // level holding 40% of the selection at 1.5x its share of all), measure medians ranked by |Cliff's delta| (0.3 and up,
  // with the rank skew folded in), a rank skew on its own (70% in one half), and an axis echo named as context. A level
  // the selection IS, and anything a finding or the closest comparison already states, is not repeated. Nothing above the
  // floors reads "the selection looks like the rest", which is itself an answer.
  var DESCRIBED_TITLE = 'Described, not tested';
  function listWords(names) {
    if (names.length <= 1) return names.join('');
    var shown = names.slice(0, maxListed);
    return shown.length < names.length ? shown.join(', ') + ', ...' : shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1];
  }
  function byGap(a, b) {
    var d = Math.abs(b.gap) - Math.abs(a.gap);
    if (d) return d;
    if (a.order !== b.order) return a.order - b.order;
    return a.level < b.level ? -1 : a.level > b.level ? 1 : 0;
  }
  function pointsGap(sSh, aSh) {
    var g = Math.round(sSh * 100) - Math.round(aSh * 100);
    return (g < 0 ? '-' : '+') + fmtInt(Math.abs(g)) + ' pts';
  }
  function rankSums(at, sel) {
    var r1 = 0, k1 = 0, lo = 0, hi = 0, mid = (at.nn + 1) / 2, i;
    for (i = 0; i < sel.idx.length; i++) {
      var rk = at.ranks[sel.idx[i]];
      if (rk > 0) { r1 += rk; k1++; if (rk < mid) lo++; else if (rk > mid) hi++; }
    }
    var n2 = at.nn - k1;
    var delta = k1 && n2 ? (2 * (r1 - k1 * (k1 + 1) / 2) - k1 * n2) / (k1 * n2) : NaN;
    return { n1: k1, n2: n2, delta: delta, lo: lo, hi: hi };
  }
  function direction(mS, mR, delta) { return mS < mR ? 'lower' : mS > mR ? 'higher' : (delta < 0 ? 'lower' : 'higher'); }
  function describeSelection(sel, k, skip) {
    var shares = [], concs = [], meds = [], echoLines = [];
    attrs.forEach(function (at) {
      if (at.kind !== 'category') return;
      var inSel = {}, best = null, i;
      for (i = 0; i < sel.idx.length; i++) { var key = at.keys[sel.idx[i]]; put(inSel, key, (has(inSel, key) ? get(inSel, key) : 0) + 1); }
      // a selection that is ONE level of this field is that field: every other level reads 0% and only restates it
      if (Object.keys(inSel).length === 1) return;
      Object.keys(at.counts).sort().forEach(function (pk) {
        var key = pk.slice(1), all = at.counts[pk], cs = has(inSel, key) ? get(inSel, key) : 0;
        var name = key === '' ? '(blank)' : key, sSh = cs / k, aSh = all / n;
        if (cs === k || has(skip, at.name + '\u0001' + name)) return;
        var c = { kind: 'share', field: at.name, level: name, inSel: cs, inAll: all, shareSel: sSh, shareAll: aSh, gap: sSh - aSh, order: at.order };
        if ((sSh >= shareListed || aSh >= shareListed) && Math.abs(c.gap) >= shareGapFloor) shares.push(c);
        if (cs >= 2 && sSh >= 0.4 && sSh >= 1.5 * aSh && (!best || cs > best.inSel)) best = c;
      });
      if (best) concs.push(best);
    });
    concs.forEach(function (c) {
      c.kind = 'concentration';
      c.text = fmtInt(c.inSel) + ' of ' + fmtInt(k) + ' are ' + c.field + ' = ' + c.level + ', which is ' + fmtShare(c.shareAll) + '% of all';
    });
    shares = shares.filter(function (c) { return concs.indexOf(c) < 0; }).sort(byGap).slice(0, maxDescribed);
    shares.forEach(function (c) {
      c.text = c.field + ' = ' + c.level + ': ' + fmtShare(c.shareSel) + '% of these, ' + fmtShare(c.shareAll) + '% of all ('
        + pointsGap(c.shareSel, c.shareAll) + ')';
    });
    attrs.forEach(function (at) {
      if (at.kind !== 'measure' || has(skip, at.name + '\u0001')) return;
      var rs = rankSums(at, sel);
      if (rs.n1 < 2 || rs.n2 < 2) return;
      var side = rs.lo >= rs.hi ? 'bottom' : 'top', inHalf = Math.max(rs.lo, rs.hi), skewed = inHalf / rs.n1 >= halfShare;
      var strong = Math.abs(rs.delta) >= effectFloor;
      if (!strong && !skewed) return;
      var g = groupValues(at, sel.mask), spec = specFor(at.name);
      var mS = quantile(g.s, 0.5), mR = quantile(g.r, 0.5);
      var d = { kind: strong ? 'median' : 'rank', field: at.name, level: '', delta: rs.delta, medianSel: mS, medianRest: mR,
        inHalf: skewed ? inHalf : null, half: skewed ? side : null, nSel: rs.n1, order: at.order };
      var halfText = fmtInt(inHalf) + ' of ' + fmtInt(rs.n1);
      d.text = strong
        ? at.name + ' ' + direction(mS, mR, rs.delta) + ': median ' + fmtMag(mS, spec) + ' vs ' + fmtMag(mR, spec) + ' for the rest'
          + (skewed ? '; ' + halfText + ' in the ' + side + ' half' : '')
        : halfText + ' sit in the ' + side + ' half of ' + at.name;
      meds.push(d);
    });
    meds.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta) || a.order - b.order; });
    meds = meds.slice(0, maxDescribed);
    echoPreps.forEach(function (at) {
      var g = groupValues(at, sel.mask);
      if (g.s.length < 2 || g.r.length < 2) return;
      var mS = quantile(g.s, 0.5), mR = quantile(g.r, 0.5);
      if (mS === mR) return;
      // "as expected" only when the selection moves on the axis the way the field's correlation says it should
      var ax = axisNames.indexOf(at.track.axis), as = [], ar = [], i;
      if (ax < 0) return;
      for (i = 0; i < n; i++) { var v = axisVals[ax][i]; if (v === v) (sel.mask[i] ? as : ar).push(v); }
      if (as.length < 2 || ar.length < 2) return;
      as.sort(function (a, b) { return a - b; }); ar.sort(function (a, b) { return a - b; });
      var axisGap = quantile(as, 0.5) - quantile(ar, 0.5);
      if (!axisGap || (axisGap > 0) !== ((mS > mR) === (at.track.rho > 0))) return;
      echoLines.push({ kind: 'echo', field: at.name, level: '', axis: at.track.axis, medianSel: mS, medianRest: mR,
        text: at.name + ' is ' + direction(mS, mR, 0) + ' too, as expected: it tracks ' + at.track.axis });
    });
    var list = shares.concat(concs.slice(0, maxDescribed), meds, echoLines);
    list.forEach(function (x) { delete x.order; delete x.gap; });
    return list;
  }
  // attach the described block to an answer, when the selection and the rest are both big enough to describe
  function withDescribed(out, sel, k, rest, stated) {
    if (k < minDescribed || rest < minDescribed) return out;
    var skip = {};
    (stated || []).forEach(function (f) {
      if (!f) return;
      put(skip, f.field + '\u0001' + (f.kind === 'category' ? f.level : ''), true);
      (f.others || []).forEach(function (o) { put(skip, o.field + '\u0001' + (o.kind === 'category' ? o.level : ''), true); });
    });
    var list = describeSelection(sel, k, skip);
    out.describedTitle = DESCRIBED_TITLE;
    out.described = list;
    out.describedText = list.some(function (x) { return x.kind !== 'echo'; }) || !fieldNames.length ? null
      : 'Described: the selection looks like the rest on ' + listWords(fieldNames);
    return out;
  }

  function explain(rowIdxs) {
    var sel = selectionOf(rowIdxs), k = sel.k, rest = n - k;
    var out = base(k, rest);
    if (k === 0) return zero();
    if (!attrs.length) { out.state = 'noFields'; out.text = 'There are no other fields to compare the points on'; return out; }
    // a floor the caller stated keeps its own words
    if (minStated && k < minSelected) {
      out.state = 'underMinimum';
      out.text = 'Select at least ' + fmtInt(minSelected) + ' points to compare (' + fmtInt(k) + ' selected)';
      return withDescribed(out, sel, k, rest, null);
    }
    if (minStated && rest < minSelected) {
      out.state = 'restUnderMinimum';
      out.text = 'Leave at least ' + fmtInt(minSelected) + ' points outside the selection to compare (' + fmtInt(rest) + ' left outside)';
      return withDescribed(out, sel, k, rest, null);
    }
    if (!canReach(k, rest)) {
      // the smallest group (or rest) at which the exact tests can reach q on this many points, when there is one
      var need = 0, kk;
      if (k <= rest) { for (kk = k + 1; kk < n; kk++) if (canReach(kk, n - kk)) { need = kk; break; } }
      else { for (kk = rest + 1; kk < n; kk++) if (canReach(n - kk, kk)) { need = kk; break; } }
      out.state = k <= rest ? 'underMinimum' : 'restUnderMinimum';
      out.text = (k <= rest ? 'With ' + fmtInt(k) + ' selected, the group is too small' : 'With ' + fmtInt(rest) + ' left outside, the rest is too small')
        + ' for any difference to be told from chance at that size'
        + (!need ? ' - there are too few points to compare a group with the rest'
          : k <= rest ? ' (select at least ' + fmtInt(need) + ')' : ' (leave at least ' + fmtInt(need) + ' outside)');
      return withDescribed(out, sel, k, rest, null);
    }
    var cmps = [], i;
    for (i = 0; i < attrs.length; i++) {
      if (attrs[i].kind === 'category') categoryTests(attrs[i], sel, k, rest, cmps);
      else measureTests(attrs[i], sel, cmps);
    }
    var m = cmps.length, tested = {}, testedCount = 0;
    var bh = benjaminiHochberg(cmps.map(function (c) { return c.p; }), q);
    for (i = 0; i < m; i++) {
      var c = cmps[i];
      c.padj = bh.padj[i]; c.bh = bh.reject[i];
      c.floor = Math.abs(c.delta) >= deltaFloor;
      c.shown = c.bh && c.floor && c.supported;
      if (!has(tested, c.field)) { put(tested, c.field, true); testedCount++; }
    }
    out.tested = testedCount; out.comparisons = m;
    out.title = 'What sets these ' + fmtInt(k) + ' points apart from the other ' + fmtInt(rest);
    out.footer = m ? fmtInt(m) + ' ' + plural(m, 'comparison', 'comparisons') + ', false discovery rate ' + fdrPct + '%' : null;
    out.all = cmps.map(function (c) {
      return { field: c.field, kind: c.kind, level: c.level, p: c.p, padj: c.padj, bh: c.bh, delta: c.delta, supported: c.supported,
        floor: c.floor, shown: c.shown, inSel: c.a, inRest: c.b, nSel: c.nS, nRest: c.nR };
    });
    if (!m) {
      out.state = 'noComparisons';
      out.text = 'Nothing to compare: no field has enough values in both the selection and the rest';
      return withDescribed(out, sel, k, rest, null);
    }
    var byField = {}, lines = [];
    cmps.forEach(function (c) { if (!c.shown) return; if (!has(byField, c.field)) { put(byField, c.field, []); } get(byField, c.field).push(c); });
    attrs.forEach(function (at) {
      if (!has(byField, at.name)) return;
      var list = get(byField, at.name).sort(better);
      var top = finish(describe(list[0], sel));
      top.others = list.slice(1).map(function (c) { return finish(describe(c, sel)); });
      top.more = top.others.length;
      top.moreText = top.more ? '+' + fmtInt(top.more) + ' more' : null;
      lines.push({ f: top, c: list[0] });
    });
    lines.sort(function (x, y) { return better(x.c, y.c); });
    out.findings = lines.map(function (l) { return l.f; });
    if (!out.findings.length) {
      // nothing passes, but something came closest: say what, in a finding's numbers, marked as not a finding
      out.state = 'nothing';
      out.closest = closestOf(cmps, sel);
      out.text = NOTHING_HEAD[out.closest.reason] + ' (' + fmtInt(m) + ' ' + plural(m, 'comparison', 'comparisons') + ')';
      // a group the fixed minimum refused: say plainly what its size means
      if (Math.min(k, rest) < classicMin) out.text = 'With only ' + (k <= rest ? fmtInt(k) + ' selected' : fmtInt(rest) + ' left outside')
        + ', a difference this size can\'t be told from chance (' + fmtInt(m) + ' ' + plural(m, 'comparison', 'comparisons') + ')';
      return withDescribed(out, sel, k, rest, [out.closest]);
    }
    out.state = 'found';
    var others = testedCount - out.findings.length;
    out.remainder = others > 0
      ? fmtInt(others) + ' other ' + plural(others, 'field', 'fields') + ' tested; nothing else differs by more than chance' : null;
    return withDescribed(out, sel, k, rest, out.findings);
  }

  return {
    explain: explain,
    zero: zero,
    n: n,
    fields: fieldNames.slice(),
    excluded: excluded.slice(),
    echoes: echoes.map(function (e) { return { field: e.field, axis: e.axis, rho: e.rho }; }),
    echoText: echoText,
    axes: axisNames.slice(),
    format: function (name) { var sp = specFor(String(name)); return sp ? function (v) { return fmtMag(+v, sp); } : null; },
    stats: { lgamma: lgamma, erfc: erfc, fisherExact: function (a, b, c, d) {
      var N = a + b + c + d; return fisherWith(logFactorials(N), a, a + b, a + c, N);
    }, mannWhitney: mannWhitney, mannWhitneyExact: function (xs, ys) {
      // the exact two-sided p over the pooled mid-ranks, the selection first (the small-group test's own arithmetic)
      var all = xs.concat(ys), ord = all.map(function (v, i) { return i; }).sort(function (a, b) { return all[a] - all[b]; });
      var rk = rankOrder(ord, all, all.length).ranks, r1 = 0, i;
      for (i = 0; i < xs.length; i++) r1 += rk[i];
      return mwExactP(Array.prototype.slice.call(rk), xs.length, r1 - xs.length * (xs.length + 1) / 2);
    }, benjaminiHochberg: benjaminiHochberg, spearman: spearman }
  };
};
// SHARED rule search for the Selection explainer. Draws nothing, touches no DOM, no host global and no clock; its only random
// source is an inline seeded PRNG (mulberry32), so the same rows, config and selection give the same answer in every host.
// llmContrast tests each field on its own; this answers the question a reader asks next - is there ONE short description,
// one or two conditions joined by 'and', that fits most of the selected rows and few of the rest, and does it beat chance.
//
// CANDIDATE CONDITIONS, from the SAME fields llmContrast compares (its axes, axis echoes, row keys, constants and blank-heavy
// columns are already left out: cfg.contrast, or a d3.llmContrast built from the same cfg, supplies the list):
//   category : field = level, for the maxLevels (12) most frequent levels; a blank is the level (blank).
//   measure  : field <= c and field > c, c = the data value at the quartiles and terciles of the non-blank values (at most 5
//              cuts, duplicates dropped); a blank value is covered by neither side.
//   A condition covering exactly the rows another covers is kept once. Each is a bitset (Uint32Array, one bit a row).
// QUALITY: WRAcc = cov / N * (tp / cov - k / N), N rows in view, k selected, cov the rows a rule covers, tp the selected ones.
//   It rewards a rule that is both large and pure, so a two-row rule that happens to be all selected never wins.
// SEARCH: beam search, width beamWidth (10), at most maxDepth (2) conditions, a pair always on two different fields; a rule
//   must cover at least minCovered (5) selected rows. A pair that adds nothing to one of its parents is skipped, and a tie keeps
//   the single condition (then the earlier candidate), so the answer is order-stable.
// THE CHANCE GUARD IS ON THE WHOLE SEARCH: the selected / not-selected labels are shuffled shuffles (199) times, the search is
//   rerun on each, and its best WRAcc recorded. p = (1 + shuffles whose best >= the observed best) / (1 + shuffles). Every
//   shuffle searches the same candidates, so p already pays for every rule that was tried; there is no second correction. The
//   loop stops once p can no longer fall under alpha, and the p reported is then the least the full run could give.
// A RULE IS REPORTED only when p < alpha (0.05), it covers at least minCovered selected rows, and its share in the selection
//   is at least deltaFloor (0.2, llmContrast's floor) above its share in the rest - on thousands of rows a 61% vs 54% rule
//   beats chance and says nothing. The selection is searched when the exact tests can reach alpha at its size, the same
//   minimum as llmContrast: 2 / C(k + r, min(k, r)) under alpha for k selected and r outside.
// WITH llmContrast's result for the same rows (explain's second argument): repeats is true when the rule is ONE condition on a
//   field the panel already lists as a finding (the same level, for a category), so the panel need not say it twice; and when
//   that result is 'nothing', aloneText scopes its words ('Field by field, nothing passes the test against chance (16
//   comparisons)') so they never contradict a rule that beats chance.
//
// CALL:  var S = d3.llmSubgroups(data, { attributes: ATTRIBUTES, axes: [xName, yName], culture: options.cultureCode,
//                                        formats: FORMATS, contrast: C });     // C = the chart's d3.llmContrast(...)
//        A threshold prints in its field's own format, C.format(field) (the column's modelFormat or cfg.formats; llmContrast).
//        var g = S.explain(rowIdxs, res);   // rowIdxs as C.explain takes them; res = C.explain(rowIdxs) (optional)
//        g = { state: 'found' | 'none' | 'underMinimum' | 'noFields', reason, rule, sentence, text, rows, repeats, aloneText,
//              p, stoppedEarly, shareSel, shareRest, inSel, inRest, k, rest, wracc, shuffles, candidates, best }
//        g.reason (state 'none') = 'chance' (p >= alpha) | 'small' (under the floor) | 'nothing' (no rule covers enough)
//        g.rule = null | { conditions: [{ field, kind, op: '=' | '<=' | '>', value, text }], text }
//        g.text = '82% are Region = West and Tenure (months) <= 12, vs 6% of the rest (33 of 40 selected; beats chance,
//                  p = 0.005)'  (the comparison sign is drawn as the less-than-or-equal glyph); null when no rule passes
//        g.rows = the indices of every row the rule covers (selected or not), for the panel to light; g.best = the best rule
//                 found when it did not pass (for a log, never for the panel)
d3.llmSubgroups = function (data, cfg) {
  cfg = cfg || {};
  var allRows, columns;
  if (Array.isArray(data)) { allRows = data; columns = []; }
  else { columns = (data && data.columns) || []; allRows = (data && data.rows) || []; }
  var N = allRows.length;
  function pick(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  var beamWidth = Math.max(1, Math.floor(pick(cfg.beamWidth, 10)));
  var maxDepth = pick(cfg.maxDepth, 2) === 1 ? 1 : 2;
  var minCoveredCfg = Math.max(1, Math.floor(pick(cfg.minCovered, 5))), minCovered = minCoveredCfg;
  // the minimum is the tests' own, as llmContrast's: a group the most extreme split of its rows can't take under alpha is too small
  var minSelected = Math.max(1, Math.floor(pick(cfg.minSelected, 1)));
  var classicMin = 10;
  function canReach(k, r) {
    if (!(k >= 1 && r >= 1) || k < minSelected || r < minSelected) return false;
    var lc = 0, m = Math.min(k, r), i;
    for (i = 1; i <= m; i++) lc += Math.log(k + r - m + i) - Math.log(i);
    return Math.log(2) - lc < Math.log(alpha);
  }
  var alpha = pick(cfg.alpha, 0.05); if (!(alpha > 0 && alpha < 1)) alpha = 0.05;
  var shuffles = Math.max(0, Math.floor(pick(cfg.shuffles, 199)));
  var maxLevels = Math.max(1, Math.floor(pick(cfg.maxLevels, 12)));
  var seed = pick(cfg.seed, 0x5eed1121) >>> 0;
  var earlyStop = cfg.earlyStop !== false;
  var deltaFloor = pick(cfg.deltaFloor, 0.2);

  var colIdx = {};
  columns.forEach(function (c, i) { var nm = c && (c.name !== undefined ? c.name : c); if (nm !== undefined && nm !== null && !colIdx.hasOwnProperty('$' + nm)) colIdx['$' + nm] = i; });
  function cell(row, name) {
    if (row === null || row === undefined) return undefined;
    if (Array.isArray(row)) { var ix = colIdx['$' + name]; return ix === undefined ? undefined : row[ix]; }
    return row[name];
  }
  function num(v) {
    if (v === null || v === undefined || typeof v === 'boolean') return NaN;
    if (typeof v === 'string') { v = v.trim(); if (v === '') return NaN; }
    var x = typeof v === 'number' ? v : +v;
    return isFinite(x) ? x : NaN;
  }
  function levelKey(v) { var s = v === null || v === undefined ? '' : String(v).trim(); return s === '' ? '(blank)' : s; }

  // ---- the fields: exactly the ones llmContrast compares (axes, echoes and unusable columns are already out) ----
  var C = cfg.contrast && cfg.contrast.fields ? cfg.contrast : d3.llmContrast(data, cfg);
  var kinds = {};
  (cfg.attributes || []).forEach(function (a) { if (a && typeof a === 'object' && a.name !== undefined) kinds['$' + a.name] = a.kind; });
  var fields = C.fields.slice();

  // ---- number words, in the reader's culture ----
  var culture = typeof cfg.culture === 'string' && cfg.culture ? cfg.culture : 'en-US';
  var nfCache = {};
  function fmt(v, o, maxFrac) {
    var key = JSON.stringify(o), f = nfCache[key];
    if (f === undefined) {
      f = null;
      if (typeof Intl !== 'undefined' && Intl && typeof Intl.NumberFormat === 'function') {
        try { f = new Intl.NumberFormat(culture, o); } catch (e) { try { f = new Intl.NumberFormat('en-US', o); } catch (e2) { f = null; } }
      }
      nfCache[key] = f;
    }
    return f ? f.format(v) : String(Math.round(v * Math.pow(10, maxFrac)) / Math.pow(10, maxFrac));
  }
  var formats = cfg.formats && typeof cfg.formats === 'object' ? cfg.formats : {};
  function fmtMag(v, spec) {
    spec = spec && typeof spec === 'object' ? spec : {};
    var x = spec.percent ? v * 100 : v, a = Math.abs(x), s;
    if (x === 0) s = '0';
    else if (typeof spec.digits === 'number') s = fmt(x, { maximumFractionDigits: spec.digits }, spec.digits);
    else if (a >= 1000000) s = fmt(x, { notation: 'compact', maximumFractionDigits: 1 }, 0);
    else if (a >= 100) s = fmt(x, { maximumFractionDigits: 0 }, 0);
    else if (a >= 10) s = fmt(x, { maximumFractionDigits: 1 }, 1);
    else if (a >= 1) s = fmt(x, { maximumFractionDigits: 2 }, 2);
    else s = fmt(x, { maximumSignificantDigits: 2 }, 3);
    if (spec.percent) s += '%';
    return (spec.prefix || '') + s + (spec.suffix || '');
  }
  function fmtShare(share) {
    var pct = share * 100;
    if (pct > 0 && pct < 1) return fmt(pct, { maximumSignificantDigits: 1 }, 1);
    if (pct > 99 && pct < 100) return fmt(Math.min(99.9, pct), { maximumFractionDigits: 1 }, 1);
    return fmt(Math.round(pct), { maximumFractionDigits: 0 }, 0);
  }
  // two decimals from 0.1, two significant digits under it, so a p just under 0.05 never prints as 0.05
  function fmtP(p) {
    if (p < 0.001) return '< ' + fmt(0.001, { maximumFractionDigits: 3 }, 3);
    return '= ' + (p >= 0.1 ? fmt(p, { minimumFractionDigits: 2, maximumFractionDigits: 2 }, 2) : fmt(p, { maximumSignificantDigits: 2 }, 4));
  }

  // ---- bitsets ----
  var W = (N + 31) >>> 5;
  function pop32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }
  function popAll(a) { var c = 0; for (var i = 0; i < W; i++) c += pop32(a[i]); return c; }
  function popAnd(a, b) { var c = 0; for (var i = 0; i < W; i++) c += pop32(a[i] & b[i]); return c; }
  function popAnd3(a, b, s) { var c = 0; for (var i = 0; i < W; i++) c += pop32(a[i] & b[i] & s[i]); return c; }
  function setBit(a, i) { a[i >>> 5] = (a[i >>> 5] | (1 << (i & 31))) >>> 0; }
  function sig(a) { var s = ''; for (var i = 0; i < W; i++) s += a[i].toString(36) + ','; return s; }

  // ---- the candidate conditions, built once from the rows in view ----
  var conds = [], seenSig = {};
  function addCond(field, fi, kind, op, value, bits) {
    var cov = popAll(bits);
    if (cov === 0 || cov === N) return;
    var s = sig(bits);
    if (seenSig.hasOwnProperty(s)) return;
    seenSig[s] = true;
    conds.push({ field: field, fi: fi, kind: kind, op: op, value: value, bits: bits, cov: cov });
  }
  fields.forEach(function (name, fi) {
    var kind = kinds['$' + name], r;
    var vals = new Array(N);
    for (r = 0; r < N; r++) vals[r] = cell(allRows[r], name);
    if (kind !== 'measure' && kind !== 'category') {
      kind = 'measure';
      var any = false;
      for (r = 0; r < N; r++) { var key = levelKey(vals[r]); if (key === '(blank)') continue; any = true; if (num(vals[r]) !== num(vals[r])) { kind = 'category'; break; } }
      if (!any) kind = 'category';
    }
    if (kind === 'measure') {
      var xs = [], xv = new Float64Array(N);
      for (r = 0; r < N; r++) { xv[r] = num(vals[r]); if (xv[r] === xv[r]) xs.push(xv[r]); }
      if (xs.length < 2) return;
      xs.sort(function (a, b) { return a - b; });
      var cuts = [];
      [0.25, 1 / 3, 0.5, 2 / 3, 0.75].forEach(function (q) {
        var c = xs[Math.floor(q * (xs.length - 1))];
        if (c < xs[xs.length - 1] && cuts.indexOf(c) < 0) cuts.push(c);
      });
      cuts.sort(function (a, b) { return a - b; });
      cuts.forEach(function (c) {
        var le = new Uint32Array(W), gt = new Uint32Array(W);
        for (var j = 0; j < N; j++) { if (xv[j] !== xv[j]) continue; if (xv[j] <= c) setBit(le, j); else setBit(gt, j); }
        addCond(name, fi, 'measure', '<=', c, le);
        addCond(name, fi, 'measure', '>', c, gt);
      });
    } else {
      var counts = {}, order = [], keys = new Array(N);
      for (r = 0; r < N; r++) {
        keys[r] = levelKey(vals[r]);
        if (!counts.hasOwnProperty('$' + keys[r])) { counts['$' + keys[r]] = 0; order.push(keys[r]); }
        counts['$' + keys[r]]++;
      }
      if (order.length < 2) return;
      order.sort(function (a, b) { return counts['$' + b] - counts['$' + a] || (a < b ? -1 : a > b ? 1 : 0); });
      order.slice(0, maxLevels).forEach(function (lvl) {
        var b = new Uint32Array(W);
        for (var j = 0; j < N; j++) if (keys[j] === lvl) setBit(b, j);
        addCond(name, fi, 'category', '=', lvl, b);
      });
    }
  });
  var NC = conds.length;
  var pairCov = {};

  // The search on one labelling: the best rule's quality (and, when keep, the rule).
  function search(lab, k, keep) {
    var base = k / N, best = { q: -Infinity, a: -1, b: -1, tp: 0, cov: 0 }, singles = [], c, tp, q;
    for (c = 0; c < NC; c++) {
      tp = popAnd(conds[c].bits, lab);
      if (tp < minCovered) continue;
      q = (tp - conds[c].cov * base) / N;
      singles.push({ c: c, q: q });
      if (q > best.q + 1e-12) best = { q: q, a: c, b: -1, tp: tp, cov: conds[c].cov };
    }
    if (maxDepth >= 2 && singles.length > 1) {
      var beam = singles.slice().sort(function (x, y) { return y.q - x.q || x.c - y.c; }).slice(0, beamWidth);
      for (var j = 0; j < beam.length; j++) {
        var A = conds[beam[j].c];
        for (var s = 0; s < singles.length; s++) {
          var bi = singles[s].c, B = conds[bi];
          if (B.fi === A.fi) continue;
          var lo = Math.min(beam[j].c, bi), hi = Math.max(beam[j].c, bi), pk = lo * NC + hi;
          var cv = pairCov[pk];
          if (cv === undefined) { cv = popAnd(A.bits, B.bits); pairCov[pk] = cv; }
          if (cv === A.cov || cv === B.cov) continue;
          tp = popAnd3(A.bits, B.bits, lab);
          if (tp < minCovered) continue;
          q = (tp - cv * base) / N;
          if (q > best.q + 1e-12) best = { q: q, a: lo, b: hi, tp: tp, cov: cv };
        }
      }
    }
    return keep ? best : best.q;
  }

  function selectionOf(rowIdxs) {
    var list = rowIdxs, i;
    if (typeof list === 'string') list = list.split(',');
    else if (list && !Array.isArray(list) && typeof list.forEach === 'function') { var tmp = []; list.forEach(function (v) { tmp.push(v); }); list = tmp; }
    var bits = new Uint32Array(W), idx = [], seen = new Uint8Array(N);
    if (Array.isArray(list)) {
      for (i = 0; i < list.length; i++) {
        var v = list[i], x = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? +v : NaN);
        if (x !== Math.floor(x) || x < 0 || x >= N || seen[x]) continue;
        seen[x] = 1; idx.push(x); setBit(bits, x);
      }
    }
    return { bits: bits, k: idx.length };
  }
  var LE = String.fromCharCode(8804);   // the less-than-or-equal sign
  function condText(c) {
    if (c.op === '=') return c.field + ' = ' + c.value;
    var f = typeof C.format === 'function' ? C.format(c.field) : null;
    return c.field + (c.op === '<=' ? ' ' + LE + ' ' : ' > ') + (f ? f(c.value) : fmtMag(c.value, formats[c.field]));
  }

  function explain(rowIdxs, res) {
    var sel = selectionOf(rowIdxs), k = sel.k, rest = N - k;
    var out = { state: 'none', reason: null, rule: null, sentence: null, text: null, rows: [], repeats: false, aloneText: null, p: null,
      stoppedEarly: false, shareSel: null, shareRest: null, inSel: 0, inRest: 0, k: k, rest: rest, wracc: null, shuffles: 0, candidates: NC, best: null };
    if (!fields.length || !NC) { out.state = 'noFields'; return out; }
    if (!canReach(k, rest)) { out.state = 'underMinimum'; return out; }
    // a group the fixed minimum refused needs its rule to cover half of it (up to the usual minCovered), not 5 of its 4
    var small = Math.min(k, rest);
    minCovered = small < classicMin ? Math.min(minCoveredCfg, Math.max(2, Math.ceil(small / 2))) : minCoveredCfg;
    var obs = search(sel.bits, k, true);
    if (!(obs.q > 0)) { out.reason = 'nothing'; return out; }
    var list = [conds[obs.a]];
    if (obs.b >= 0) list.push(conds[obs.b]);
    var rule = { conditions: list.map(function (c) { return { field: c.field, kind: c.kind, op: c.op, value: c.value, text: condText(c) }; }),
      text: list.map(condText).join(' and ') };
    out.wracc = obs.q;
    out.inSel = obs.tp; out.inRest = obs.cov - obs.tp; out.shareSel = obs.tp / k; out.shareRest = (obs.cov - obs.tp) / rest;
    // the relevance floor first: a rule under it is never a finding, so the shuffles are not run for it
    if (out.shareSel - out.shareRest < deltaFloor) { out.reason = 'small'; out.best = rule; return out; }
    // the chance guard: a partial Fisher-Yates puts a random k rows first, the search reruns on that labelling
    var rand = (function (a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(seed);
    var perm = new Uint32Array(N), lab = new Uint32Array(W), hits = 0, done = 0, i;
    for (i = 0; i < N; i++) perm[i] = i;
    var stopAt = Math.ceil(alpha * (1 + shuffles) - 1);
    for (var t = 0; t < shuffles; t++) {
      for (i = 0; i < k; i++) { var j = i + Math.floor(rand() * (N - i)), tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
      lab.fill(0);
      for (i = 0; i < k; i++) setBit(lab, perm[i]);
      done++;
      if (search(lab, k, false) >= obs.q - 1e-12) hits++;
      if (earlyStop && stopAt > 0 && hits >= stopAt) break;
    }
    // after an early stop the full run's p is at least (1 + hits) / (1 + shuffles), already >= alpha
    var p = (1 + hits) / (1 + shuffles);
    out.p = p; out.shuffles = done; out.stoppedEarly = done < shuffles;
    if (!(p < alpha) || obs.tp < minCovered) { out.reason = 'chance'; out.best = rule; return out; }
    var cover = list.length === 1 ? list[0].bits : (function () { var b = new Uint32Array(W); for (var w = 0; w < W; w++) b[w] = list[0].bits[w] & list[1].bits[w]; return b; })();
    for (i = 0; i < N; i++) if ((cover[i >>> 5] >>> (i & 31)) & 1) out.rows.push(i);
    out.state = 'found';
    out.rule = rule;
    if (res && typeof res === 'object') {
      var one = list.length === 1 ? list[0] : null;
      out.repeats = !!one && (res.findings || []).some(function (f) { return f.field === one.field && (one.kind !== 'category' || f.level === one.value); });
      // 'Nothing passes the test against chance (16 comparisons)' under a rule that beats chance needs its scope said
      if (res.state === 'nothing' && typeof res.text === 'string' && res.text) out.aloneText = 'Field by field, ' + res.text.charAt(0).toLowerCase() + res.text.slice(1);
    }
    out.sentence = fmtShare(out.shareSel) + '% are ' + rule.text + ', vs ' + fmtShare(out.shareRest) + '% of the rest';
    out.text = out.sentence + ' (' + fmt(obs.tp, { maximumFractionDigits: 0 }, 0) + ' of ' + fmt(k, { maximumFractionDigits: 0 }, 0)
      + ' selected; beats chance, p ' + fmtP(p) + ')';
    return out;
  }

  return { explain: explain, fields: fields.slice(), candidates: NC, n: N };
};
// SHARED label-fit helper for hand-drawn D3 charts that place text INSIDE a mark
// (treemap tiles, icicle bands, funnel stages, stacked-bar segments).
//
// Why this exists: codegen reliably gates a label on the MARK's size and then truncates
// by CHARACTER COUNT, which is a proxy for width that fails exactly where it matters. A
// 40px tile passes a ">= 36px" gate, "Los Angeles" is under a 14-char cap so it is left
// whole, and at 10px it renders ~72px wide - centred, so it spills into the tiles on BOTH
// sides. Measured: 34 of 35 prod treemap/icicle gens that draw text never
// measure it.
//
// Contract: call AFTER .text(...) and after font-size is set, with an accessor for the
// space available to that datum. Truncates to the widest prefix that actually fits, and
// blanks the label outright when even one character + the ellipsis will not.
//
// opts.text (string or accessor) - THE AUTHORITATIVE LABEL FOR THIS CALL, and REQUIRED on any
// chart whose text CHANGES between calls. By default the helper caches the original string so a
// re-fit (resize, proofread re-render) works from the full text instead of eroding an already
// clipped one; that is right for a resize and wrong for an animation tick, where a value line is
// a different string every frame. Without opts.text an animated label would be restored to
// frame 0's string and held there - a stale number wearing the look of a label bug.
//
// A STRING IN, THE FITTED STRING OUT: d3.llmFitLabel('Customer effort score', 180, 11) or
// d3.llmFitLabel(name, 180, { fontSize: 11 }) returns the string cut to fit 180px at 11px, for a
// chart that builds its label text before it appends the node. It is the idiom a generation reached
// for, and the selection-only helper handed the string back untouched: six KPI names ran off a
// Bullet chart's frame with no fit at all. Measured on a hidden text node at that font size (the
// estimate where there is no DOM); opts.fontFamily / opts.fontWeight name the chart's font. The
// returned string is only ever CUT, never shrunk - the caller owns its font size - so shrinkTo does
// not apply here.
d3.llmFitLabel = function (sel, widthAccessor, opts) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: a string is fitted at no smaller size than a chart may draw it
  // AN OBJECT IN THE ROOM'S PLACE. d3.llmFitLabel(sel, { text: name, width: w, pad: 2 }) - the room named
  // INSIDE the options - is read as d3.llmFitLabel(sel, w, { text: name, pad: 2 }). The helper used to take that object
  // as the room itself: +{} is NaN, so it blanked EVERY label it was handed (a legend of five swatches and no
  // names). opts.room is read when width is absent, and a third argument's keys win over the object's; a number as the
  // third argument is still the string form's font size. An object that names no width finds no room and blanks, as before.
  if (widthAccessor != null && typeof widthAccessor === 'object' && !Array.isArray(widthAccessor)) {
    var wobj = widthAccessor, wopts = {};
    for (var wk in wobj) if (Object.prototype.hasOwnProperty.call(wobj, wk) && wk !== 'width' && wk !== 'room') wopts[wk] = wobj[wk];
    if (opts != null && typeof opts === 'object') {
      for (var wk2 in opts) if (Object.prototype.hasOwnProperty.call(opts, wk2)) wopts[wk2] = opts[wk2];
    } else if (typeof opts === 'number' && opts > 0 && wopts.fontSize == null) {
      wopts.fontSize = Math.max(TYPE_FLOOR, opts);
    }
    widthAccessor = wobj.width != null ? wobj.width : wobj.room;
    opts = wopts;
  }
  if (typeof sel === 'string' || typeof sel === 'number') {
    var so = (opts != null && typeof opts === 'object') ? opts
      : ((arguments[3] != null && typeof arguments[3] === 'object') ? arguments[3] : {});
    var sfs = Math.max(TYPE_FLOOR, (typeof opts === 'number' && opts > 0) ? opts : (+so.fontSize > 0 ? +so.fontSize : TYPE_FLOOR));
    var sopts = {};
    for (var sk in so) if (Object.prototype.hasOwnProperty.call(so, sk)) sopts[sk] = so[sk];
    sopts.text = String(sel);
    sopts.shrinkTo = null;
    var holder = null, sn = null;
    try {
      if (typeof document !== 'undefined' && document && document.body && document.createElementNS) {
        holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        holder.setAttribute('width', '0'); holder.setAttribute('height', '0');
        holder.style.position = 'absolute'; holder.style.left = '-10000px'; holder.style.visibility = 'hidden';
        sn = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        holder.appendChild(sn);
        document.body.appendChild(holder);
      }
    } catch (e) { holder = null; sn = null; }
    if (!sn) {
      sn = { textContent: '', style: {}, fs: sfs,
             getAttribute: function (a) { return a === 'font-size' ? String(sn.fs) : null; },
             setAttribute: function (a, v) { if (a === 'font-size') sn.fs = +v; } };
    }
    var fitted;
    try {
      sn.setAttribute('font-size', String(sfs));
      if (so.fontFamily) sn.setAttribute('font-family', String(so.fontFamily));
      if (so.fontWeight) sn.setAttribute('font-weight', String(so.fontWeight));
      d3.llmFitLabel({ each: function (fn) { fn.call(sn, null, 0); return this; } }, widthAccessor, sopts);
      fitted = sn.textContent == null ? '' : String(sn.textContent);
    } catch (e) { fitted = String(sel); }
    try { if (holder && holder.parentNode) holder.parentNode.removeChild(holder); } catch (e) { /* detached */ }
    return fitted;
  }
  opts = opts || {};
  var pad = opts.pad == null ? 4 : opts.pad;
  var minWidth = opts.minWidth == null ? 14 : opts.minWidth;
  var ell = opts.ellipsis == null ? '\u2026' : opts.ellipsis;
  var fallbackFs = opts.fontSize == null ? 10 : opts.fontSize;
  // SHRINK BEFORE YOU CUT (opts.shrinkTo, a font size in px). A label that is WIDER than its room
  // is not always a label that should be cut: '180,000 of 200,000' truncated to '180,000 of 2...'
  // is a different number, and a ring's hole is a circle whose chord at the label's baseline is
  // most of what it has. When shrinkTo is given, the helper first reduces the node's font-size
  // from its current value toward shrinkTo until the FULL text fits, and only if it still does
  // not fit at the floor falls through to the cut. The original size is remembered so a re-fit
  // on a wider tile grows the label back rather than leaving it small.
  // opts.overflow: 'truncate' (default, the behaviour every existing caller has) or 'drop' -
  // blank the label rather than cut it, for text whose truncation would state something false.
  var shrinkTo = opts.shrinkTo == null ? null : +opts.shrinkTo;
  var overflow = opts.overflow === 'drop' ? 'drop' : 'truncate';
  // A LABEL FALLS THROUGH ITS SHORTER TRUE FORMS BEFORE IT IS CUT (opts.forms: an array, or an accessor (d, i) that
  // returns one, longest first). A tile's sub-line 'Goal $1.2M - Attainment 95%' cut to 'Goal $1.2M - Attai...' on a
  // phone loses the half the tile is for, while '95% of goal' fits whole. When the label does not fit, each form is
  // tried WHOLE, in order, and the first that fits is drawn; with shrinkTo, the shrink is then tried on the label and
  // each form in the same order; only when none of them fits is the SHORTEST form cut (or blanked, with overflow
  // 'drop'). A form is a whole phrase that is still true, never the label with words chopped off. An array as
  // opts.text is the same thing: its first entry is the label, the rest its forms. The caller keeps the full label
  // in a <title> or tooltip, as for a cut.
  // A CUT KEEPS WHAT TELLS THE LABEL APART (opts.distinctFrom, the sibling labels). The widest
  // prefix is the right cut for one label and the wrong one for a set that shares its start: sixteen gauge
  // panels named 'SBA NAME 1' to 'SBA NAME 18' were each cut to 'SBA NA...', so no panel could be matched to
  // its name. Given the labels drawn beside this one, a prefix cut that keeps no more than this label shares
  // with a sibling becomes a TAIL cut - the ellipsis, then the widest ending that fits ('...NAME 12') - never
  // splitting a number, and blank when even the tail will not fit. A label no sibling shares a start with is
  // cut as before. Callers rarely pass it, and need not: see SIBLINGS ARE THE LABELS ALREADY FITTED below.
  var sibs = Array.isArray(opts.distinctFrom) ? opts.distinctFrom : null;

  if (!sel || typeof sel.each !== 'function') return sel;

  // A CUT NEVER LANDS INSIDE A NUMBER. The widest prefix that fits is right for a word and wrong for a
  // number: 'largest 12...' of 'largest 128 of 400' and '1,234,5...' of '1,234,567' read as different
  // values, and the ellipsis does not say which digits went. So a cut that would split a number - between
  // two digits, at a group or decimal separator between digits, or before a unit or percent sign glued to
  // the digits - moves back to before that number and its sign or currency symbol; a label that is only
  // the number is blanked, as overflow 'drop' would. Every caller gets this, model-written code included,
  // so a caption built from a raw count ('largest ' + n) can no longer state a different count.
  var DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\uFF10-\uFF19]/;
  var JOIN = /[.,'\u00A0\u202F\u2019\u066B\u066C]/;
  var GLUED = /[A-Za-z%\u2030]/;
  var LEAD = /[+\-\u2212$\u20AC\u00A3\u00A5\u20B9]/;
  function numberSafeCut(s, lo) {
    if (!(lo > 0) || lo >= s.length) return lo;
    var a = s.charAt(lo - 1), b = s.charAt(lo);
    var splits = DIGIT.test(a)
      ? (DIGIT.test(b) || GLUED.test(b) || (JOIN.test(b) && DIGIT.test(s.charAt(lo + 1))))
      : (lo >= 2 && JOIN.test(a) && DIGIT.test(s.charAt(lo - 2)) && DIGIT.test(b));
    if (!splits) return lo;
    var i = lo;
    while (i > 0 && (DIGIT.test(s.charAt(i - 1))
                     || (i >= 2 && JOIN.test(s.charAt(i - 1)) && DIGIT.test(s.charAt(i - 2))))) i--;
    while (i > 0 && LEAD.test(s.charAt(i - 1))) i--;
    while (i > 0 && /\s/.test(s.charAt(i - 1))) i--;
    return i;
  }

  function fontSizeOf(node) {
    try {
      var a = parseFloat(node.getAttribute && node.getAttribute('font-size'));
      if (a > 0) return a;
      var s = node.style && node.style.fontSize ? parseFloat(node.style.fontSize) : NaN;
      if (s > 0) return s;
    } catch (e) { /* fall through */ }
    return fallbackFs;
  }

  function setFontSize(node, fs) {
    try { if (node.setAttribute) node.setAttribute('font-size', String(fs)); } catch (e) { /* detached */ }
  }

  // Real metrics in a browser; a conservative estimate anywhere that lacks SVG text
  // measurement (the jsdom exec-gate sidecar has no getComputedTextLength, and a
  // detached node can legitimately report 0) - never throw, never assume it fits.
  function measure(node, txt) {
    try {
      if (typeof node.getComputedTextLength === 'function') {
        var w = node.getComputedTextLength();
        if (w > 0) return w;
      }
    } catch (e) { /* fall through */ }
    return String(txt).length * fontSizeOf(node) * 0.6;
  }

  // SIBLINGS ARE THE LABELS ALREADY FITTED IN THE SAME <svg>. The widest prefix is the right cut for one label
  // and the wrong one for a set whose names share a start: thirty treemap codes on a small tile were cut to
  // 'RSB 40...', 'RSB 40...', 'FS...', 'FS...', so a label pointed at the wrong tile or at none. The callers fit
  // one tile at a time and do not pass distinctFrom, so the helper keeps its own list on the owning svg node,
  // __llmFitRegistry ({ node, full, visible, room }). When a fitted label reads the same as another label in that
  // svg whose full text differs, BOTH are re-fitted to a distinguishing ending: the head that fits, the ellipsis,
  // and the shortest ending of the full text that no colliding label ends with - started at a word where that
  // fits, never inside a number. A label that cannot fit one is blanked (its <title> or tooltip still names it).
  // A label nothing else reads the same as is untouched; opts.distinctFrom still shapes this label's own cut first.
  function ownerSvg(node) {
    try {
      if (node.ownerSVGElement) return node.ownerSVGElement;
      for (var p = node.parentNode; p; p = p.parentNode) {
        if (p.nodeName && String(p.nodeName).toLowerCase() === 'svg') return p;
      }
    } catch (e) { /* detached */ }
    return null;
  }
  // What a reader sees: a <title> child is the tooltip, not the label.
  function shownText(node) {
    var kids = node && node.childNodes;
    if (!kids || !kids.length) return node.textContent == null ? '' : String(node.textContent);
    var s = '';
    for (var c = 0; c < kids.length; c++) {
      var k = kids[c];
      if (k.nodeType === 3) s += k.nodeValue;
      else if (k.nodeType === 1 && String(k.nodeName).toLowerCase() !== 'title') s += shownText(k);
    }
    return s;
  }
  // A label fitted EARLIER and re-fitted now keeps the <title> its caller appended after that first fit.
  function setShown(node, s) {
    var kids = node.childNodes, keep = [];
    if (kids && kids.length) {
      for (var c = 0; c < kids.length; c++) {
        if (kids[c].nodeType === 1 && String(kids[c].nodeName).toLowerCase() === 'title') keep.push(kids[c]);
      }
    }
    node.textContent = s;
    for (var q = 0; q < keep.length; q++) node.appendChild(keep[q]);
  }
  function hiddenIn(node, svg) {
    try {
      for (var p = node, hop = 0; p && hop < 64; p = p.parentNode, hop++) {
        if (p.getAttribute && (p.getAttribute('display') === 'none' || p.getAttribute('visibility') === 'hidden')) return true;
        if (p.style && (p.style.display === 'none' || p.style.visibility === 'hidden')) return true;
        if (p === svg) break;
      }
    } catch (e) { /* read as shown */ }
    return false;
  }
  // An entry is stale once its node left the svg, or its caller re-texted it without a re-fit.
  // The string a label was fitted FROM: the label itself, or the shorter form drawn in its place.
  function fittedFrom(node) {
    return node.__llmFitFrom != null ? node.__llmFitFrom : node.__llmFullLabel;
  }
  function live(svg, en) {
    if (shownText(en.node) !== en.visible) return false;
    if (fittedFrom(en.node) != null && String(fittedFrom(en.node)) !== en.full) return false;
    try { if (typeof svg.contains === 'function' && !svg.contains(en.node)) return false; } catch (e) { /* keep */ }
    return true;
  }
  function endsWithText(s, t) { return s.length >= t.length && s.slice(s.length - t.length) === t; }
  function ending(en, others) {
    var f = en.full, n = en.node, E = en.ell;
    if (en.drop) return '';
    var fits = function (s) { setShown(n, s); return measure(n, s) <= en.room; };
    // The shortest ending no colliding label ends with.
    var t = -1;
    for (var s = f.length - 1; s >= 1 && t < 0; s--) {
      var tl = f.slice(s), alone = true;
      for (var o = 0; o < others.length && alone; o++) if (endsWithText(others[o], tl)) alone = false;
      if (alone) t = s;
    }
    if (t < 1) return '';
    // Never inside a number: '...8' of 'NAME 18' is another name, so back to the number's first digit.
    if (DIGIT.test(f.charAt(t)) && (DIGIT.test(f.charAt(t - 1)) || (t >= 2 && JOIN.test(f.charAt(t - 1)) && DIGIT.test(f.charAt(t - 2))))) {
      while (t > 0 && (DIGIT.test(f.charAt(t - 1)) || (t >= 2 && JOIN.test(f.charAt(t - 1)) && DIGIT.test(f.charAt(t - 2))))) t--;
    }
    if (t < 1) return '';
    // Prefer the start of the word that ending sits in, when that still fits.
    var ws = t;
    while (ws > 0 && !/\s/.test(f.charAt(ws - 1))) ws--;
    if (ws > 0 && ws < t && fits(E + f.slice(ws))) t = ws;
    else if (!fits(E + f.slice(t))) return '';
    // Then the widest head that fits in front of it, cut by the same number rule.
    var tail = f.slice(t), lo = 0, hi = t - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (fits(f.slice(0, mid) + E + tail)) lo = mid; else hi = mid - 1;
    }
    var head = f.slice(0, numberSafeCut(f, lo)).replace(/\s+$/, '');
    if (head.length < 2) head = '';
    return head + E + tail;
  }
  function distinguish(group) {
    var g, h, s, en, others;
    for (g = 0; g < group.length; g++) {
      en = group[g];
      others = [];
      for (h = 0; h < group.length; h++) if (group[h].full !== en.full) others.push(group[h].full);
      try { s = ending(en, others); } catch (e) { s = ''; }
      setShown(en.node, s);
      en.visible = shownText(en.node);
    }
    // Two different names that still read alike both go.
    for (g = 0; g < group.length; g++) {
      for (h = g + 1; h < group.length; h++) {
        var a = group[g], b = group[h];
        if (a.visible && a.visible === b.visible && a.full !== b.full) {
          setShown(a.node, ''); a.visible = '';
          setShown(b.node, ''); b.visible = '';
        }
      }
    }
  }
  function clashes(reg, svg, en) {
    var group = [en], differ = false;
    if (hiddenIn(en.node, svg)) return group;
    for (var k = reg.length - 1; k >= 0; k--) {
      var o = reg[k];
      if (o === en || o.visible !== en.visible) continue;
      if (!live(svg, o)) { reg.splice(k, 1); continue; }
      if (hiddenIn(o.node, svg)) continue;
      group.push(o);
      if (o.full !== en.full) differ = true;
    }
    return differ ? group : [en];
  }
  function settle(node, room) {
    var svg = ownerSvg(node);
    if (!svg) return;
    var reg = svg.__llmFitRegistry;
    if (!Array.isArray(reg)) { reg = []; svg.__llmFitRegistry = reg; }
    var k;
    for (k = reg.length - 1; k >= 0; k--) if (reg[k].node === node) reg.splice(k, 1);
    // A long-lived svg whose labels are re-joined every frame would grow the list without end: sweep it now and then.
    if (reg.length >= (reg.sweepAt || 256)) {
      for (k = reg.length - 1; k >= 0; k--) if (!live(svg, reg[k])) reg.splice(k, 1);
      reg.sweepAt = Math.max(256, reg.length * 2);
    }
    var vis = shownText(node);
    if (!(room > 0) || !vis) return;
    var me = { node: node, full: fittedFrom(node) == null ? vis : String(fittedFrom(node)),
               visible: vis, room: room, ell: ell, drop: overflow === 'drop' };
    reg.push(me);
    var queue = [me];
    for (var round = 0; queue.length && round < 32; round++) {
      var en = queue.shift();
      if (!en.visible) continue;
      var group = clashes(reg, svg, en);
      if (group.length < 2) continue;
      distinguish(group);
      for (var g = 0; g < group.length; g++) if (group[g].visible) queue.push(group[g]);
    }
  }

  // One label's fit; returns the room it was fitted to (undefined when the label was empty).
  function fitOne(node, d, i) {
    // Re-runnable: keep the ORIGINAL text so a second pass (proofread re-render, resize) re-fits
    // from the full string instead of eroding an already-clipped one. An animated chart supplies
    // opts.text instead, because its label is a NEW string each frame rather than the same one
    // re-measured - see the header.
    var full, alts = [];
    if (opts.text != null) {
      try {
        full = typeof opts.text === 'function' ? opts.text.call(node, d, i) : opts.text;
      } catch (e) { full = ''; }
      if (Array.isArray(full)) { alts = full.slice(1); full = full[0]; }
      full = full == null ? '' : String(full);
      node.__llmFullLabel = full;
      node.textContent = full;              // authoritative: an EMPTY label must CLEAR the node,
      if (!full) return;                    // never leave the previous frame's text standing
    } else {
      full = node.__llmFullLabel;
      if (full == null) {
        full = node.textContent == null ? '' : String(node.textContent);
        node.__llmFullLabel = full;
      }
      if (!full) return;
    }
    node.__llmFitFrom = null;
    var fo = opts.forms;
    if (typeof fo === 'function') { try { fo = fo.call(node, d, i); } catch (e) { fo = null; } }
    if (fo != null) alts = alts.concat(Array.isArray(fo) ? fo : [fo]);
    var cands = [full];
    for (var ci = 0; ci < alts.length; ci++) {
      var alt = alts[ci] == null ? '' : String(alts[ci]);
      if (alt && cands.indexOf(alt) < 0) cands.push(alt);
    }

    var room;
    try {
      room = typeof widthAccessor === 'function'
        ? widthAccessor.call(node, d, i)
        : widthAccessor;
    } catch (e) { room = 0; }
    room = (room == null ? 0 : +room) - pad * 2;

    if (!(room > 0) || room < minWidth) { node.textContent = ''; return room; }

    // Start every fit from the ORIGINAL size, for the same reason the original TEXT is kept:
    // a re-fit must be able to undo a shrink, not only deepen one.
    if (shrinkTo != null) {
      if (node.__llmFullFontSize == null) node.__llmFullFontSize = fontSizeOf(node);
      setFontSize(node, node.__llmFullFontSize);
    }
    node.textContent = full;
    var w = measure(node, full);
    if (w <= room) return room;                                // fits whole - done

    // A shorter true form, whole, at the label's own size.
    var c;
    for (c = 1; c < cands.length; c++) {
      node.textContent = cands[c];
      if (measure(node, cands[c]) <= room) { node.__llmFitFrom = cands[c]; return room; }
    }

    if (shrinkTo != null && shrinkTo > 0) {
      for (c = 0; c < cands.length; c++) {
        setFontSize(node, node.__llmFullFontSize);
        node.textContent = cands[c];
        var cur = fontSizeOf(node), wc = measure(node, cands[c]);
        if (!(cur > shrinkTo)) break;
        // Width is close to linear in font size, so the first guess lands within a step of
        // the answer; walk down in half-pixels from there and stop at the first size that
        // fits, never below the floor.
        var fs = Math.max(shrinkTo, Math.floor((cur * room / wc) * 2) / 2);
        for (; fs >= shrinkTo; fs -= 0.5) {
          setFontSize(node, fs);
          if (measure(node, cands[c]) <= room) { if (c) node.__llmFitFrom = cands[c]; return room; }
        }
        setFontSize(node, shrinkTo);
        if (measure(node, cands[c]) <= room) { if (c) node.__llmFitFrom = cands[c]; return room; }
      }
    }
    // Nothing fits whole: the SHORTEST form is the one cut (the label itself when there are no forms).
    if (cands.length > 1) { full = cands[cands.length - 1]; node.__llmFitFrom = full; }
    node.textContent = full;
    if (overflow === 'drop') { node.textContent = ''; return room; }

    // Widest prefix that fits, ellipsis included. Binary search: measure() can be a real
    // layout read, so keep it to ~log2(n) calls per label rather than one per character.
    var lo = 0, hi = full.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      node.textContent = full.slice(0, mid) + ell;
      if (measure(node, node.textContent) <= room) lo = mid; else hi = mid - 1;
    }
    lo = numberSafeCut(full, lo);
    // THE TAIL CUT, when the prefix would keep nothing a sibling does not also start with (opts.distinctFrom).
    if (sibs) {
      var shared = 0;
      for (var si = 0; si < sibs.length; si++) {
        var o = sibs[si] == null ? '' : String(sibs[si]);
        if (o === full) continue;
        var k = 0;
        while (k < o.length && k < full.length && o.charAt(k) === full.charAt(k)) k++;
        if (k > shared) shared = k;
      }
      if (shared > 0 && lo <= shared) {
        // The earliest start whose ending fits, ellipsis included - the same binary search, from the other end.
        var a = 1, b = full.length;
        while (a < b) {
          var m = (a + b) >> 1;
          node.textContent = ell + full.slice(m);
          if (measure(node, node.textContent) <= room) b = m; else a = m + 1;
        }
        // AN ENDING NEVER STARTS INSIDE A NUMBER: '...8' of 'NAME 18' is another name. Back to the number's first
        // digit when that still fits; otherwise the label goes, and the caller's <title> or tooltip keeps it.
        var inNum = function (i) {
          return i > 0 && i < full.length && DIGIT.test(full.charAt(i))
            && (DIGIT.test(full.charAt(i - 1)) || (i >= 2 && JOIN.test(full.charAt(i - 1)) && DIGIT.test(full.charAt(i - 2))));
        };
        if (inNum(a)) {
          var t0 = a;
          while (t0 > 0 && (DIGIT.test(full.charAt(t0 - 1)) || (t0 >= 2 && JOIN.test(full.charAt(t0 - 1)) && DIGIT.test(full.charAt(t0 - 2))))) t0--;
          node.textContent = ell + full.slice(t0);
          a = measure(node, node.textContent) <= room ? t0 : full.length;
        }
        node.textContent = a < full.length ? ell + full.slice(a) : '';
        return room;
      }
    }
    node.textContent = lo > 0 ? full.slice(0, lo) + ell : '';
    return room;
  }

  sel.each(function (d, i) {
    var room = fitOne(this, d, i);
    try { settle(this, room); } catch (e) { /* a failed sibling check leaves the fit as it stands */ }
  });

  return sel;
};
// SHARED tooltip helper for hand-drawn D3 charts. Owns POSITIONING and the container
// CHROME (background/border/padding - one run drew a bare-text tooltip
// floating transparent over the bars); you supply the content and decide when to show
// it. The chrome is DEFAULTS on the reused node - restyle via tip.node if a chart
// genuinely needs its own look.
//
// Why this exists: codegen places its tooltip at the cursor (left = clientX + 12) and stops
// there. That is correct until the cursor is near the right or bottom edge, where the tooltip
// runs outside the visual and the host clips it - the reader loses exactly the datum they
// reached for. Measured across the 60 most recent OK generations per environment:
// of the gens that position an HTML tooltip, 8 of 10 in PROD had no clamp or flip at all
// (eight generations over six chart types, tables and flows among them). The same chart
// type did it correctly in one generation and not the next, so this is variance, not
// incapacity - which is why it belongs in a helper rather than in one more sentence of prose.
//
// Contract:
//   var tip = d3.llmTooltip(container);        // container = the element you were handed
//   tip.show('<b>Label</b><br/>42', event);    // HTML string or plain text
//   tip.move(event);                           // on mousemove
//   tip.hide();                                // on mouseout
//   tip.html('<b>Label</b>') / tip.text('42')  // set the content WITHOUT showing (see below)
// The node is pointer-events:none and lives inside the container, so it cannot steal a click
// from a d3-mark and it cannot escape the visual. Safe to call repeatedly - one node per
// container is created and reused.
//
// THE ONE CASE CLAMPING CANNOT FIX: a container SHORTER than the tooltip. On a banner tile
// (1390x29 observed) the box does not fit at any offset, so the flip-and-clamp above only
// chooses which end gets sliced. Where the host offers a tooltip surface of its own - painted
// OUTSIDE the visual, which is the only place with room - the helper hands the content over and
// draws nothing. Hosts without one are unaffected: the lookup finds no bridge and the local
// tooltip is drawn exactly as before.
d3.llmTooltip = function (container, opts) {
  opts = opts || {};
  var gap = opts.gap == null ? 12 : opts.gap;    // distance from the cursor
  var edge = opts.edge == null ? 4 : opts.edge;  // minimum distance from the container edge
  var routed = false;                            // true while the HOST is showing our content
  var lastContent = '';                          // what to re-send if the host is driving
  var lastEv = null;                             // where the cursor last was, for a re-fit

  var host = (container && typeof container.node === 'function') ? container.node() : container;
  var noop = { show: function () { return this; }, move: function () { return this; }, hide: function () { return this; },
               html: function () { return this; }, text: function () { return this; }, node: null };
  if (!host || !host.appendChild) return noop;

  // An <svg> cannot host an HTML child; mount on its parent instead.
  var mount = host;
  if (mount.tagName && String(mount.tagName).toLowerCase() === 'svg' && mount.parentNode) {
    mount = mount.parentNode;
  }
  if (!mount || !mount.appendChild) return noop;

  // Absolute placement is measured from the nearest positioned ancestor, so the mount must be
  // one. Only promote a STATIC element - never clobber a layout the chart chose deliberately.
  try {
    var pos = (typeof getComputedStyle === 'function') ? getComputedStyle(mount).position : '';
    if (!pos || pos === 'static') mount.style.position = 'relative';
  } catch (e) { /* jsdom / exec-gate: no layout engine, positioning is inert anyway */ }

  var tip = mount.__llmTip;
  if (!tip || tip.parentNode !== mount) {
    tip = document.createElement('div');
    tip.className = 'llm-tooltip';
    tip.style.position = 'absolute';
    // PARK IT AT THE ORIGIN. An absolutely-positioned element with left/top unset resolves to its STATIC position - directly below the SVG - and visibility:hidden still OCCUPIES SPACE. So the resting node quietly added its own padding+border to the container scrollHeight on every chart that builds a tooltip. Invisible while the host clipped overflow; the day the host began MEASURING overflow it became a scrollbar on charts that fit perfectly (18px of phantom content on a 620px chart). place() overwrites both on first show, so this costs nothing.
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.pointerEvents = 'none';
    tip.style.visibility = 'hidden';
    tip.style.zIndex = '20';
    tip.style.boxSizing = 'border-box';
    tip.style.whiteSpace = opts.wrap ? 'normal' : 'nowrap';
    // Container chrome. SOLID background on purpose (the Plotly hoverlabel-alpha lesson:
    // a translucent tooltip over dense marks is unreadable exactly where it is needed).
    // Light panel + dark text reads on any chart theme because it is a floating surface,
    // not part of the canvas.
    tip.style.background = 'rgba(255,255,255,0.97)';
    tip.style.border = '1px solid rgba(0,0,0,0.28)';
    tip.style.borderRadius = '4px';
    tip.style.padding = '6px 9px';
    tip.style.boxShadow = '0 2px 6px rgba(0,0,0,0.22)';
    tip.style.color = '#222';
    tip.style.fontSize = '12px';
    mount.appendChild(tip);
    mount.__llmTip = tip;
  }

  // The host's tooltip surface, if this container sits inside one that offers it. Looked up on
  // the CONTAINER CHAIN rather than on window, so two charts sharing a frame can never pick up
  // each other's bridge. Resolved per call: a host may install it after the chart is built.
  function hostTip() {
    try {
      var n = mount, guard = 0;
      while (n && guard++ < 8) {
        if (n.__lchHostTip && typeof n.__lchHostTip.show === 'function') return n.__lchHostTip;
        n = n.parentNode;
      }
    } catch (e) { /* detached node / cross-document parent */ }
    return null;
  }

  function metrics() {
    var w = 0, h = 0, cw = 0, ch = 0;
    try {
      var r = mount.getBoundingClientRect();
      cw = r.width; ch = r.height;
    } catch (e) { /* fall through to the client* fallbacks */ }
    if (!cw) cw = mount.clientWidth || 0;
    if (!ch) ch = mount.clientHeight || 0;
    w = tip.offsetWidth || 0;
    h = tip.offsetHeight || 0;
    return { w: w, h: h, cw: cw, ch: ch };
  }

  // Cursor position in MOUNT coordinates. offsetX/offsetY are relative to the event target
  // (a mark, not the container), so they are the wrong basis - convert from client coords.
  function local(ev) {
    var x = 0, y = 0;
    try {
      var r = mount.getBoundingClientRect();
      if (ev && ev.clientX != null) { x = ev.clientX - r.left; y = ev.clientY - r.top; }
    } catch (e) {
      if (ev && ev.clientX != null) { x = ev.clientX; y = ev.clientY; }
    }
    return { x: x, y: y };
  }

  function place(ev) {
    var m = metrics();
    if (!m.cw || !m.ch) return;              // no layout to clamp against (exec gate)
    var p = local(ev);

    // Prefer below-right of the cursor; FLIP to the other side when that would overflow, then
    // CLAMP so a tooltip wider or taller than the container still starts inside it.
    var left = p.x + gap;
    if (left + m.w > m.cw - edge) left = p.x - gap - m.w;
    if (left < edge) left = edge;
    if (left + m.w > m.cw - edge) left = Math.max(edge, m.cw - m.w - edge);

    var top = p.y + gap;
    if (top + m.h > m.ch - edge) top = p.y - gap - m.h;
    if (top < edge) top = edge;
    if (top + m.h > m.ch - edge) top = Math.max(edge, m.ch - m.h - edge);

    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  // EITHER ARGUMENT ORDER. The contract is show(content, event); called as show(event, content)
  // the box read "[object MouseEvent]" parked in the corner, and that call has been seen in an
  // archetype, in a served sample and in a few percent of generations. An Event is unmistakable
  // (a clientX, a type, a target) and a content never looks like one, so the helper swaps the
  // two rather than print the event. An ARRAY of lines is a content too - one line per entry.
  function looksLikeEvent(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x)
      && (typeof x.clientX === 'number' || typeof x.type === 'string' || ('target' in x));
  }

  // THE ONE PLACE CONTENT IS WRITTEN, so show(content), html() and text() can never disagree about
  // what the host is re-sent. asText writes textContent whatever the string holds, as a d3
  // selection's .text() does.
  function setContent(content, asText) {
    if (Array.isArray(content)) content = content.map(function (x) { return x == null ? '' : String(x); }).join(asText ? ' ' : '<br/>');
    lastContent = content == null ? '' : String(content);
    if (!asText && typeof content === 'string' && content.indexOf('<') >= 0) tip.innerHTML = lastContent;
    else tip.textContent = lastContent;
  }

  // CONTENT WITHOUT A SHOW: tip.html(content) and tip.text(content). A d3 selection is driven that
  // way, so codegen writes it - tip.show(); tip.move(event); tip.html('...') - and on a handle with
  // only show/move/hide every hover threw after show() had made the EMPTY box visible. The content
  // is set exactly as show(content) sets it. A tooltip already on screen is re-fitted to the new
  // content where it stands (the host's surface gets the new content; ours is re-measured and
  // re-placed at the last cursor position); a hidden one STAYS hidden - showing is show()'s job.
  // With no argument each reads the content back, as a d3 selection's getter does.
  function setAndRefit(self, content, asText) {
    setContent(content, asText);
    if (routed) {
      var hbSet = hostTip();
      if (hbSet && hbSet.show(lastContent, lastEv) === true) return self;
      routed = false;                          // the host let go: the tooltip is still on screen, so draw ours
      return self.show(null, lastEv);
    }
    if (tip.style.visibility === 'visible') return self.show(null, lastEv);
    return self;
  }

  return {
    node: tip,
    html: function (content) { return arguments.length ? setAndRefit(this, content, false) : lastContent; },
    text: function (content) { return arguments.length ? setAndRefit(this, content, true) : (tip.textContent || ''); },
    show: function (content, ev) {
      if (looksLikeEvent(content) && !looksLikeEvent(ev)) { var swapped = content; content = ev; ev = swapped; }
      if (ev) lastEv = ev;
      if (content != null) setContent(content, false);
      // Measure the NATURAL box FIRST. "Does it fit?" is a question about the container, not
      // about the clamp we are deciding whether to apply - measured after clamping, everything
      // always fits and the question can never be answered.
      tip.style.maxWidth = 'none';
      tip.style.visibility = 'visible';      // measurable BEFORE placing
      var m = metrics();
      if (m.ch && m.h + (2 * edge) > m.ch) {
        var hbShow = hostTip();
        // The host may decline - the reader switched tooltips off, or it is already showing its
        // own from the row data. Then we draw ours: clipped still beats absent.
        if (hbShow && hbShow.show(lastContent, ev) === true) {
          routed = true;
          tip.style.visibility = 'hidden';
          return this;
        }
      }
      routed = false;
      // A tooltip can never be wider than the space it must fit in.
      if (m.cw) tip.style.maxWidth = Math.max(80, m.cw - (2 * edge)) + 'px';
      place(ev);
      return this;
    },
    move: function (ev) {
      if (ev) lastEv = ev;
      if (routed) { var hbMove = hostTip(); if (hbMove) hbMove.move(ev); return this; }
      if (tip.style.visibility === 'visible') place(ev);
      return this;
    },
    hide: function () {
      if (routed) { var hbHide = hostTip(); if (hbHide) hbHide.hide(); routed = false; }
      tip.style.visibility = 'hidden';
      return this;
    }
  };
};
// A FIELD'S NAME AS A READER SAYS IT. A data column is often named as an identifier - MarketingSpend, RevenueYoY,
// order_count - and an axis title, a legend title, a column header or a tooltip that prints it verbatim reads as code (app A's
// scatter: "MarketingSpend (USD, log scale)" and "RevenueYoY"). This turns a GLUED identifier into words and leaves a name that
// is already written for a reader alone.
//
// CONTRACT
//   d3.llmDisplayName(name)  'MarketingSpend' -> 'Marketing Spend', 'RevenueYoY' -> 'Revenue YoY', 'order_count' -> 'Order count',
//                            'CSATScore' -> 'CSAT Score', 'Q3Revenue' -> 'Q3 Revenue'; 'Revenue', 'CSAT', 'Net sales (USD)' and any
//                            name that already has a space come back unchanged. A short mixed-case token such as YoY, MoM or QoQ
//                            stays one word. Never throws: a non-string comes back as its String().
d3.llmDisplayName = function (name) {
  var s = name === null || name === undefined ? '' : String(name);
  if (!s || /\s/.test(s)) return s.trim();
  // snake_case, and kebab-case in lower case ('units-sold'), are words already: first letter up. A hyphen between capitalised
  // words ('Z-Score', 'Coca-Cola') is part of the name and stays.
  var t = s.replace(/[_]+/g, ' ');
  if (/^[a-z0-9]+(?:-+[a-z0-9]+)+$/.test(t)) t = t.replace(/-+/g, ' ');
  t = t.trim();
  if (t !== s) return t.charAt(0).toUpperCase() + t.slice(1);
  var parts = [];
  // a short mixed-case token (YoY, MoM, QoQ, WoW) is one word; otherwise split before an upper-case letter that starts a word
  // (after a lower-case letter or a digit) and before the last capital of an acronym run that a word follows (CSATScore)
  // (iPhone and eBay are one word; so are Q3, H1 and FY2024, and a span such as 7D or 30D)
  var re = /[a-z][A-Z][a-z]+|[A-Z][a-z][A-Z](?![a-z])|[A-Z]+[0-9]+|[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+[A-Z](?![a-z0-9])|[0-9]+|[^A-Za-z0-9]+/g;
  var m;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    parts.push(m[0]);
  }
  if (parts.length < 2 || parts.join('') !== s) return s;
  // words are spaced; punctuation ('-', '(', ')') joins its neighbours as it was written
  var out = '';
  for (var i = 0; i < parts.length; i++) {
    var punct = /^[^A-Za-z0-9]+$/.test(parts[i]), prevPunct = i > 0 && /^[^A-Za-z0-9]+$/.test(parts[i - 1]);
    out += i === 0 || punct || prevPunct ? parts[i] : ' ' + parts[i];
  }
  return out.trim();
};
// THE PAGE'S ONE COLOUR SCHEME, READ FROM THE THEME. Two defects in one family, both found by the two-app
// audit: (B) a mark coloured with a typed literal (#1F3B5C, #455A64) is tuned for one background and nearly vanishes on the
// other - 1.3:1 and 2:1 on the dark card; (C) a category coloured by its POSITION or RANK (panel 3, the 2nd most populous) gets a
// different colour in every chart, and good/bad drawn green/red in one chart and blue/red in the next. This is the one place a
// chart takes meaning-carrying colour from: the theme's palette, keyed by the category's VALUE, and a semantic pair that keeps
// its contrast against whichever background the theme draws on.
//
// CONTRACT
//   const T = d3.llmThemeColors(options);
//   T.bg, T.fg            the background the marks sit on (options.backgroundColor, else themeBg, else white) and the ink
//   T.good, T.bad         the semantic pair - ahead/behind, gain/loss, above/below plan - one green and one red, walked in
//                         lightness until each holds 3:1 against T.bg; under high contrast the theme's accent and its ink.
//                         EVERY chart on a page draws ahead and behind in these two, so they mean one thing everywhere.
//   T.categories(values)  a colour function for a category: each VALUE gets the same palette colour in every chart that hands
//                         over the same values, whatever order its rows or panels come in. Values are placed in sorted order,
//                         each on its own hashed slot of options.palette (the next free slot on a collision), so position, rank
//                         and row order never decide a colour. T.categories(regions)('Europe') -> '#...'. The slots are
//                         remembered for the chart, so a filter that leaves fewer values never recolours the rest.
//   T.legible(color)      any colour, walked in lightness (hue kept) until it holds 3:1 against T.bg - for a mark colour the
//                         palette does not supply. A typed hex is tuned for one theme; this keeps it readable on both.
//   T.contrast(a, b)      the WCAG contrast ratio of two colours (1 to 21).
d3.llmThemeColors = function (options) {
  options = options || {};
  var pick = function (v, d) { return (typeof v === 'string' && v && v !== 'transparent') ? v : d; };
  var bg = pick(options.backgroundColor, pick(options.themeBg, '#ffffff'));
  var fg = pick(options.themeFg, '#252423');
  var hc = !!options.isHighContrast;
  var pal = (options.palette && options.palette.length) ? options.palette.slice() : ['#4C78A8', '#F58518', '#54A24B', '#E45756', '#72B7B2', '#B279A2', '#FF9DA6', '#9D755D'];
  var rgb = function (c) { var x = null; try { x = d3.rgb(c); } catch (e) { x = null; } return x && isFinite(x.r) ? x : d3.rgb(128, 128, 128); };
  var lum = function (c) {
    var r = rgb(c);
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r.r) + 0.7152 * f(r.g) + 0.0722 * f(r.b);
  };
  var contrast = function (a, b) { var x = lum(a) + 0.05, y = lum(b) + 0.05; return x > y ? x / y : y / x; };
  var legible = function (col, floor) {
    floor = floor || 3;
    var c = d3.lab(rgb(col));
    var step = lum(bg) > 0.5 ? -3 : 3;   // a light background darkens the hue, a dark one lightens it
    for (var i = 0; i < 34 && contrast(c.formatHex(), bg) < floor; i++) c.l = Math.max(0, Math.min(100, c.l + step));
    return c.formatHex();
  };
  var good = hc ? pick(options.themeAccent, fg) : legible('#2e7d32');
  var bad = hc ? fg : legible('#c62828');
  // FNV-1a over the value's text: the same value lands on the same slot in every chart and every render.
  var slot = function (value, n) {
    var h = 2166136261, text = String(value);
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h % n;
  };
  // MORE VALUES THAN THE PALETTE HAS COLOURS: extend it, so no two values of one category ever share a colour. Each
  // extra colour is the candidate FARTHEST from every colour already in use - greedy max-min by CIEDE2000, chart-host's own
  // rule for a colour set (palette.ts orderMostDistinct) - from a pool DERIVED from the palette: each of its colours turned
  // round the hue circle at a few lightnesses, kept inside the band where a mark stays findable on a light and a dark page
  // (chart-host's LEGIBLE_LIGHTNESS, HSL 15 to 85). The old extension stepped each palette colour 12% lighter or darker and 7
  // degrees round, which made near-twins: on the 10-colour Power BI palette the 11th to 15th colours sat 7.7 to 22 (CIE76)
  // from the base colours they came from. The order is fixed, so a longer extension starts with the shorter one: slot i is the
  // same colour however many values there are. Past the pool, the old lightness steps take over so every value still differs.
  var deltaE2000 = function (x, y) {
    var rad = Math.PI / 180, L1 = x.l, a1 = x.a, b1 = x.b, L2 = y.l, a2 = y.a, b2 = y.b;
    var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2), Cm = (C1 + C2) / 2;
    var G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var hp = function (bb, ap) { if (bb === 0 && ap === 0) return 0; var hh = Math.atan2(bb, ap) / rad; return hh < 0 ? hh + 360 : hh; };
    var h1p = hp(b1, a1p), h2p = hp(b2, a2p);
    var dLp = L2 - L1, dCp = C2p - C1p, dhp = 0;
    if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
    var Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2, hm = h1p + h2p;
    if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hm += (hm < 360 ? 360 : -360); hm /= 2; }
    var T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
    var dTh = 30 * Math.exp(-Math.pow((hm - 275) / 25, 2));
    var Rc = 2 * Math.sqrt(Math.pow(Cmp, 7) / (Math.pow(Cmp, 7) + Math.pow(25, 7)));
    var Sl = 1 + 0.015 * Math.pow(Lm - 50, 2) / Math.sqrt(20 + Math.pow(Lm - 50, 2)), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
    var Rt = -Math.sin(2 * dTh * rad) * Rc;
    var tl = dLp / Sl, tc = dCp / Sc, th = dHp / Sh;
    return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
  };
  var order = null, pool = null, near = null;
  var growOrder = function (count) {
    if (!order) {
      order = pal.map(function (c) { return rgb(c).formatHex(); });
      var taken = order.map(function (c) { return d3.lab(c); });
      var seenHex = {};
      order.forEach(function (c) { seenHex[c] = 1; });
      pool = [];
      pal.forEach(function (c) {
        var h = d3.hcl(rgb(c));
        if (!isFinite(h.h)) h.h = 0;
        var chroma = Math.max(isFinite(h.c) ? h.c : 0, 35);
        [h.l, 38, 52, 66].forEach(function (L) {
          for (var k = 1; k < 18; k++) {
            var cc = d3.hcl((h.h + k * 20) % 360, chroma, L);
            while (!cc.displayable() && cc.c > 20) cc.c -= 5;
            if (!cc.displayable()) continue;
            var hl = d3.hsl(cc).l;
            if (!(hl > 0.15 && hl < 0.85)) continue;
            var hx = cc.formatHex();
            if (seenHex[hx]) continue;
            seenHex[hx] = 1;
            pool.push({ hex: hx, lab: d3.lab(hx) });
          }
        });
      });
      near = pool.map(function (q) {
        var m = Infinity;
        for (var t = 0; t < taken.length; t++) m = Math.min(m, deltaE2000(q.lab, taken[t]));
        return m;
      });
    }
    while (order.length < count && pool.length) {
      var best = 0;
      for (var q = 1; q < pool.length; q++) if (near[q] > near[best]) best = q;
      var picked = pool.splice(best, 1)[0];
      near.splice(best, 1);
      order.push(picked.hex);
      for (var r2 = 0; r2 < pool.length; r2++) near[r2] = Math.min(near[r2], deltaE2000(pool[r2].lab, picked.lab));
    }
    for (var round = 1; order.length < count && round < 40; round++) {
      for (var e = 0; e < pal.length && order.length < count; e++) {
        var hc = d3.hsl(pal[e]);
        if (!isFinite(hc.h)) hc.h = 0;
        var step = Math.ceil(round / 2) * 0.12 * (round % 2 ? 1 : -1);
        hc.l = Math.max(0.12, Math.min(0.88, hc.l + step));
        hc.h = (hc.h + round * 7) % 360;
        var cx = hc.formatHex();
        if (order.indexOf(cx) < 0) order.push(cx);
      }
    }
  };
  var extended = function (count) {
    if (pal.length >= count) return pal.slice();
    growOrder(count);
    return pal.slice().concat(order.slice(pal.length, count));
  };
  // A VALUE KEEPS ITS COLOUR WHEN A FILTER TAKES OTHERS AWAY. Slots are placed in sorted order, the next free one on
  // a collision, so which slot a value lands on depended on the OTHER values in view: a page filter that left two regions moved
  // Europe from the 4th colour to the 2nd. The slots a value was given are remembered on the d3 this chart runs with (one per
  // chart in chart-host, one per visual in Power BI; the gate starts each check with none), in groups of values that were drawn
  // together: a call joins the remembered group it shares the most values with, every value there keeps its slot, and only a
  // value never seen before takes a new one.
  // A NEW VALUE TAKES THE LOWEST FREE SLOT, in sorted order - so a value set drawn for the first time sits on the palette's FIRST
  // n slots, the ones a palette is ordered to keep apart. Hashing each value over every slot put the palette's tail beside its
  // head: a workbook palette painted slots 1, 2, 11 and 19 for four values, two of them 8 apart (CIEDE2000), and 60% of
  // four-value sets hashed to a pair under 20. The order is the sorted values', so it is stable for a given value set.
  var memory = function () {
    var m = d3.__lchCategorySlots;
    if (!m || !Array.isArray(m.groups)) { m = { groups: [] }; try { d3.__lchCategorySlots = m; } catch (e) { /* a frozen d3: no memory */ } }
    return m;
  };
  var categories = function (values) {
    var seen = {}, list = [];
    (values || []).forEach(function (v) { var k = v === null || v === undefined ? '' : String(v); if (!seen[k]) { seen[k] = 1; list.push(k); } });
    list.sort();
    var mem = memory(), group = null, best = 0;
    mem.groups.forEach(function (g) {
      var shared = 0;
      list.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(g.slots, k)) shared++; });
      if (shared > best) { best = shared; group = g; }
    });
    if (!group) {
      group = { slots: {}, used: {}, size: 0 };
      mem.groups.push(group);
      if (mem.groups.length > 32) mem.groups.shift();
    }
    var fresh = list.filter(function (k) { return !Object.prototype.hasOwnProperty.call(group.slots, k); });
    var total = group.size + fresh.length;
    var cols = extended(Math.max(list.length, total));
    var n = cols.length;
    fresh.forEach(function (k) {
      if (group.size >= 2000) return;   // a category this long is not a palette's job: past it, a value is placed but not remembered
      var i = 0;
      while (group.used[i] && i < n) i++;
      group.used[i] = 1;
      group.slots[k] = i;
      group.size++;
    });
    var map = {};
    list.forEach(function (k) {
      var i = Object.prototype.hasOwnProperty.call(group.slots, k) ? group.slots[k] : slot(k, n);
      if (i >= cols.length) cols = extended(i + 1);
      map[k] = cols[i % cols.length];
    });
    return function (v) {
      var k = v === null || v === undefined ? '' : String(v);
      return map[k] || cols[slot(k, n)];
    };
  };
  return { bg: bg, fg: fg, good: good, bad: bad, categories: categories, legible: function (c) { return legible(c); }, contrast: contrast, palette: pal };
};


function render(container, data, options) {
  const TYPE_FLOOR = 10;
  if (typeof container.__lchExplainOff === 'function') container.__lchExplainOff();
  container.replaceChildren();

  var AXES = ["Revenue", "RevenueYoY", "TargetAttainment", "ReturnRate", "CSAT"];
  var ATTRIBUTES = [{"name":"Region","kind":"category"},{"name":"Revenue","kind":"measure"},{"name":"RevenueYoY","kind":"measure"},{"name":"TargetAttainment","kind":"measure"},{"name":"ReturnRate","kind":"measure"},{"name":"CSAT","kind":"measure"}];
  var EXCLUDED = ["Country: a row key", "CountryCode: a row key"];
  var X_NAME = 'Revenue';
  var Y_NAME = 'RevenueYoY';
  var COLOR_BY = 'Region';

  var W = options.width, H = options.height;
  var FS = Math.max(TYPE_FLOOR, Math.min(14, Math.min(W, H) / 38));
  var SUB_FS = Math.max(TYPE_FLOOR, FS * 0.9);
  var fg = options.themeFg || '#333';
  var bg = options.themeBg || options.backgroundColor || '#ffffff';
  var T = d3.llmThemeColors(options);
  var accent = T.legible('#1F77B4');
  var loc = options.cultureCode || 'en-US';
  var svg = d3.select(container).append('svg').attr('width', W).attr('height', H);

  function emptyFrame(msg) {
    svg.append('rect').attr('x', 0.5).attr('y', 0.5).attr('width', W - 1).attr('height', H - 1)
      .attr('fill', 'none').attr('stroke', fg).attr('stroke-opacity', 0.25);
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
      .attr('font-size', FS).attr('fill', fg).text(msg);
  }

  var columns = data.columns || [], rows = data.rows || [];
  var idx = function (n) { return columns.findIndex(function (c) { return c.name === n; }); };
  var axisNames = AXES.filter(function (n) { return idx(n) >= 0; });
  var xName = axisNames.indexOf(X_NAME) >= 0 ? X_NAME : axisNames[0];
  var yName = (axisNames.indexOf(Y_NAME) >= 0 && Y_NAME !== xName) ? Y_NAME : axisNames.filter(function (n) { return n !== xName; })[0];
  if (!xName || !yName) throw new Error('INVALID:column "' + X_NAME + '" not found');
  if (!rows.length) { emptyFrame(options.noDataText || 'No data to display'); return; }
  var xi = idx(xName), yi = idx(yName), countryI = idx('Country');
  var pts = [];
  rows.forEach(function (r, i) {
    var px = r[xi] === null || r[xi] === '' ? NaN : +r[xi], py = r[yi] === null || r[yi] === '' ? NaN : +r[yi];
    if (isFinite(px) && isFinite(py) && px > 0) pts.push({ x: px, y: py, i: i });
  });
  if (!pts.length) { emptyFrame(options.noDataText || 'No data to display'); return; }
  var few = pts.length < 2;
  var dropped = rows.length - pts.length;
  var dropNote = dropped > 0 ? dropped + (dropped === 1 ? ' row is' : ' rows are') + ' not drawn: no value, or a value at or below zero on the log axis, for '
    + d3.llmDisplayName(xName) + ' or ' + d3.llmDisplayName(yName) : '';

  var MAX_KEYS = 8;
  function levelName(v) { return v === null || v === undefined || String(v).trim() === '' ? '(blank)' : String(v).trim(); }
  function levelsOf(n) {
    var ci = idx(n), seen = {};
    if (ci < 0) return [];
    pts.forEach(function (p) { seen[levelName(rows[p.i][ci])] = 1; });
    return Object.keys(seen).sort(function (a, b) { return a === '(blank)' ? 1 : b === '(blank)' ? -1 : a.localeCompare(b, loc); });
  }
  var colorName = '', colorLevels = [];
  if (COLOR_BY !== 'none') {
    var colorCands = COLOR_BY ? [COLOR_BY] : ATTRIBUTES.filter(function (a) { return a.kind === 'category'; }).map(function (a) { return a.name; });
    for (var cc = 0; cc < colorCands.length && !colorName; cc++) {
      var lv = levelsOf(colorCands[cc]);
      if (lv.length >= 2 && lv.length <= MAX_KEYS) { colorName = colorCands[cc]; colorLevels = lv; }
    }
  }
  var colorCi = colorName ? idx(colorName) : -1;
  var blankFill = d3.interpolateRgb(bg, fg)(0.45);
  var levelKey = T.categories(colorLevels);
  function levelColour(l) { return l === '(blank)' ? blankFill : levelKey(l); }
  function dotFill(p) { return colorCi < 0 ? accent : levelColour(levelName(rows[p.i][colorCi])); }
  var dotOpacity = colorCi < 0 ? 0.6 : 0.8;
  var selPaint = colorCi < 0 ? accent : fg;

  var FORMATS = {};
  columns.forEach(function (c) { if (c && typeof c.modelFormat === 'string' && c.modelFormat) FORMATS[c.name] = c.modelFormat; });
  var C = d3.llmContrast(data, { attributes: ATTRIBUTES, axes: [xName, yName], encoded: colorName ? { color: colorName } : undefined, culture: options.cultureCode, formats: FORMATS });
  var S = d3.llmSubgroups(data, { attributes: ATTRIBUTES, axes: [xName, yName], culture: options.cultureCode, formats: FORMATS, contrast: C });

  var lassoOpt = options.lasso && typeof options.lasso === 'object' ? options.lasso : null;
  var lassoState = !lassoOpt || lassoOpt.capable !== true ? 'unavailable'
    : lassoOpt.enabled === false ? 'off'
    : (+lassoOpt.rowCap > 0 && rows.length > +lassoOpt.rowCap) ? 'overcap' : 'live';

  var nf = new Intl.NumberFormat(loc);
  var tickF = new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 });
  var xF = C.format(xName) || function (v) { return tickF.format(v); };
  var yF = C.format(yName) || function (v) { return tickF.format(v); };
  function tw(s, fs) { return String(s == null ? '' : s).length * fs * 0.54; }

  var PAD = Math.round(FS * 0.6);
  var side = W >= H * 1.2;
  var PW = side ? Math.max(FS * 16, Math.min(W * 0.4, FS * 28)) : W - 2 * PAD;
  var PH = side ? H - 2 * PAD : Math.max(FS * 13, Math.min(H * 0.46, FS * 22));
  var PX = side ? W - PAD - PW : PAD, PY = side ? PAD : H - PAD - PH;
  var RX = PAD, RY = PAD;
  var RW = side ? PX - 2 * PAD : W - 2 * PAD;
  var regionH = side ? H - 2 * PAD : PY - 2 * PAD;
  var STRIP = Math.max(24, FS * 2.4);

  function spread(ext) { if (ext[0] !== ext[1]) return ext; var d = Math.abs(ext[0]) * 0.1 || 1; return [ext[0] - d, ext[1] + d]; }
  var xe = d3.extent(pts, function (p) { return p.x; });
  if (xe[0] === xe[1]) xe = [xe[0] / 1.5, xe[1] * 1.5];
  var x = d3.scaleLog().domain(xe).nice();
  var y = d3.scaleLinear().domain(spread(d3.extent(pts, function (p) { return p.y; }))).nice();
  function decadeTicks() {
    var d = x.domain(), lo = Math.ceil(Math.log10(d[0]) - 1e-9), hi = Math.floor(Math.log10(d[1]) + 1e-9);
    var t = d3.range(lo, hi + 1).map(function (p) { return Math.pow(10, p); });
    return t.length >= 2 ? t : x.ticks(4);
  }
  var xt = decadeTicks();
  var tickW = function (vals, f) { return d3.max(vals, function (v) { return f(v).length; }) * FS * 0.6; };
  var TICK_BAND = 9 + FS * 1.1;

  var KEY_ROW = SUB_FS * 1.45, KEY_GAP = FS * 0.9, SW = SUB_FS * 0.85, MAX_KEY_ROWS = 2;
  function keyPlan(room) {
    if (!colorLevels.length) return { rows: 0, items: [] };
    var items = [], r = 0, cx = 0;
    colorLevels.forEach(function (l) {
      var w = SW + FS * 0.4 + l.length * SUB_FS * 0.6;
      if (cx > 0 && cx + w > room) { r++; cx = 0; }
      items.push({ level: l, row: r, x: cx, w: Math.min(w, room) });
      cx += w + KEY_GAP;
    });
    if (r < MAX_KEY_ROWS) return { rows: r + 1, items: items };
    var perRow = Math.ceil(colorLevels.length / MAX_KEY_ROWS), cell = room / perRow;
    return { rows: Math.ceil(colorLevels.length / perRow), items: colorLevels.map(function (l, j) {
      return { level: l, row: Math.floor(j / perRow), x: (j % perRow) * cell, w: cell - KEY_GAP };
    }) };
  }
  var keyLay = keyPlan(RW);
  var KEY_BAND = keyLay.rows ? FS * 0.4 + keyLay.rows * KEY_ROW : 0;

  var ml = Math.round(FS * 1.5 + tickW(y.ticks(5), yF) + 9), mr = Math.round(Math.max(FS, tickW(xt, xF) / 2)), mt = Math.round(STRIP + FS * 0.4);
  var DROP_BAND = dropNote ? SUB_FS * 1.5 : 0;
  var mb = Math.ceil(TICK_BAND + FS * 1.5 + KEY_BAND + DROP_BAND);
  var pw = Math.max(40, RW - ml - mr), ph = Math.max(40, regionH - mt - mb);
  x.range([0, pw]);
  y.range([ph, 0]);
  var origin = 'translate(' + (RX + ml) + ',' + (RY + mt) + ')';

  var plot = svg.append('g').attr('class', 'lch-plot').attr('transform', origin);
  plot.append('rect').attr('class', 'lch-plot-area').attr('width', pw).attr('height', ph).attr('fill', 'none');
  xt.forEach(function (v) {
    plot.append('line').attr('x1', x(v)).attr('x2', x(v)).attr('y1', 0).attr('y2', ph).attr('stroke', fg).attr('stroke-opacity', 0.1);
  });
  y.ticks(5).forEach(function (v) {
    plot.append('line').attr('x1', 0).attr('x2', pw).attr('y1', y(v)).attr('y2', y(v)).attr('stroke', fg).attr('stroke-opacity', 0.1);
  });
  var R = Math.max(2, Math.min(5, Math.sqrt(pw * ph / pts.length) / 3.2));
  var marks = plot.selectAll('circle.lch-dot').data(pts).join('circle')
    .attr('class', 'lch-dot d3-mark')
    .attr('data-row-idx', function (p) { return String(p.i); })
    .attr('cx', function (p) { return x(p.x); }).attr('cy', function (p) { return y(p.y); })
    .attr('r', R).attr('fill', dotFill).attr('fill-opacity', dotOpacity)
    .style('cursor', 'pointer');
  container.__lchLassoAxes = {
    toData: function (p) { return [x.invert(p[0]), y.invert(p[1])]; },
    toScreen: function (p) { return [x(p[0]), y(p[1])]; },
  };

  var axes = svg.append('g').attr('class', 'lch-axes').attr('transform', origin);
  axes.append('g').call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(4).tickFormat(function (v) { return yF(v); }))
    .call(function (s) { s.select('.domain').attr('stroke', fg).attr('stroke-opacity', 0.35); })
    .selectAll('text').attr('fill', fg).attr('font-size', FS);
  axes.append('g').attr('transform', 'translate(0,' + ph + ')')
    .call(d3.axisBottom(x).tickValues(xt).tickSize(4).tickFormat(function (v) { return xF(v); }))
    .call(function (s) { s.select('.domain').attr('stroke', fg).attr('stroke-opacity', 0.35); })
    .selectAll('text').attr('fill', fg).attr('font-size', FS);

  function line(g, tx, ty, str, fs, room, o) {
    var fsz = Math.max(TYPE_FLOOR, fs);
    o = o || {};
    var t = g.append('text').attr('x', tx).attr('y', ty).attr('font-size', fsz).attr('fill', fg)
      .attr('fill-opacity', o.dim ? 0.65 : 0.92).attr('text-anchor', o.anchor || 'start');
    if (o.cls) t.attr('class', o.cls);
    if (o.bold) t.attr('font-weight', 600);
    if (o.italic) t.attr('font-style', 'italic');
    t.text(str);
    d3.llmFitLabel(t, room, { pad: 0, text: str });
    if (t.text() !== str) t.append('title').text(str);
    return t;
  }
  function numLine(g, tx, ty, str, fs, room, o) {
    var fsz = Math.max(TYPE_FLOOR, fs);
    o = o || {};
    var t = g.append('text').attr('x', tx).attr('y', ty).attr('font-size', fsz).attr('fill', fg)
      .attr('fill-opacity', o.dim ? 0.65 : 0.92).attr('text-anchor', o.anchor || 'start');
    if (o.cls) t.attr('class', o.cls);
    t.text(str);
    d3.llmFitLabel(t, room, { pad: 0, text: str, overflow: 'drop' });
    return t;
  }
  function wrap(text, room, fs, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (!cur || tw(next, fs) <= room) cur = next; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) lines = lines.slice(0, maxLines - 1).concat([lines.slice(maxLines - 1).join(' ')]);
    return lines;
  }
  line(svg.append('g').attr('class', 'lch-axis-title'), RX + ml + pw / 2, RY + mt + ph + TICK_BAND + FS * 1.0, d3.llmDisplayName(xName) + ' (log scale)', FS, pw, { anchor: 'middle', dim: true });
  if (dropNote) line(svg.append('g').attr('class', 'lch-drop-note'), RX + ml, RY + mt + ph + TICK_BAND + FS * 1.5 + KEY_BAND + SUB_FS * 1.1, dropNote, SUB_FS, pw, { dim: true });
  var yTitle = svg.append('g').attr('class', 'lch-axis-title').attr('transform', 'rotate(-90)');
  line(yTitle, -(RY + mt + ph / 2), RX + FS * 0.9, d3.llmDisplayName(yName), FS, ph, { anchor: 'middle', dim: true });

  if (keyLay.rows) {
    var keyG = svg.append('g').attr('class', 'lch-legend').attr('data-field', colorName);
    var keyTop = RY + mt + ph + TICK_BAND + FS * 1.5 + FS * 0.4;
    keyLay.items.forEach(function (it) {
      var cy = keyTop + it.row * KEY_ROW + KEY_ROW / 2, ix = RX + it.x;
      var levelRows = pts.filter(function (p) { return levelName(rows[p.i][colorCi]) === it.level; }).map(function (p) { return p.i; });
      var ig = keyG.append('g').attr('class', 'lch-legend-item d3-legend-mark').attr('data-level', it.level)
        .attr('data-row-idx', levelRows.join(',')).style('cursor', 'pointer');
      ig.append('rect').attr('class', 'lch-legend-swatch').attr('x', ix).attr('y', cy - SW / 2).attr('width', SW).attr('height', SW).attr('rx', 2)
        .attr('fill', levelColour(it.level)).attr('fill-opacity', dotOpacity);
      line(ig, ix + SW + FS * 0.4, cy + SUB_FS * 0.35, it.level, SUB_FS, Math.max(FS, it.w - SW - FS * 0.4), { cls: 'lch-legend-label' });
      ig.append('rect').attr('class', 'lch-legend-hit').attr('x', ix).attr('y', cy - KEY_ROW / 2).attr('width', it.w).attr('height', KEY_ROW)
        .attr('fill', 'transparent');
    });
  }

  var strip = svg.append('g').attr('class', 'lch-strip');
  var seg = null;
  if (lassoState === 'live') {
    seg = d3.llmSegmented(svg, { container: container, options: options, key: 'mode',
      choices: [{ value: 'free', label: 'Lasso' }, { value: 'rect', label: 'Rectangle' }], 'default': 'free',
      x: RX, y: RY + STRIP / 2, fontSize: FS,
      onChange: function (v) { container.setAttribute('data-lch-lasso-mode', v === 'rect' ? 'rect' : 'free'); } });
  }
  var countText = strip.append('text').attr('class', 'lch-count').attr('text-anchor', 'end')
    .attr('x', RX + RW).attr('y', RY + STRIP / 2 + FS * 0.35).attr('font-size', SUB_FS).attr('fill', fg).attr('fill-opacity', 0.85);
  var clearW = Math.max(20, FS * 3.6), clearH = Math.max(20, FS * 1.9);
  function countRoom() { return Math.max(FS * 4, RX + RW - (seg ? seg.bounds().right : RX) - clearW - 8 - FS); }
  var clearPill = strip.append('g').attr('class', 'lch-clear lch-control').attr('cursor', 'pointer').attr('display', 'none')
    .on('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
  clearPill.append('rect').attr('class', 'lch-clear-hit').attr('width', clearW).attr('height', clearH).attr('rx', 3)
    .attr('fill', 'transparent').attr('stroke', fg).attr('stroke-opacity', 0.45);
  clearPill.append('text').attr('x', clearW / 2).attr('y', clearH / 2 + SUB_FS * 0.35).attr('text-anchor', 'middle')
    .attr('font-size', SUB_FS).attr('fill', fg).text('clear');

  var panel = svg.append('g').attr('class', 'lch-explain').attr('transform', 'translate(' + PX + ',' + PY + ')');
  var active = null, expanded = {}, picked = 0, ruleRes = null;

  function key(f) { return f.field + '|' + (f.level || ''); }
  function levelOf(r, ci) { var v = r[ci]; return v === null || v === undefined ? '' : String(v).trim(); }
  var ramp = [0.3, 0.65, 1].map(function (t) { return d3.interpolateRgb(bg, accent)(t); });

  function applyHit() {
    marks.classed('lch-explain-hit', false).classed('lch-explain-ramp', false)
      .attr('fill', dotFill).attr('fill-opacity', dotOpacity).attr('stroke', null).attr('stroke-width', null);
    if (!active) return;
    if (active.rule) {
      var on = {};
      (ruleRes && ruleRes.rows ? ruleRes.rows : []).forEach(function (i) { on[i] = true; });
      marks.filter(function (p) { return on[p.i] === true; })
        .classed('lch-explain-hit', true).attr('stroke', fg).attr('stroke-width', Math.max(1.5, R * 0.5)).attr('fill-opacity', 0.95);
      return;
    }
    var ci = idx(active.field);
    if (ci >= 0) {
      if (active.kind === 'category') {
        var want = active.level === '(blank)' ? '' : active.level;
        marks.filter(function (p) { return levelOf(rows[p.i], ci) === want; })
          .classed('lch-explain-hit', true).attr('stroke', fg).attr('stroke-width', Math.max(1.5, R * 0.5)).attr('fill-opacity', 0.95);
      } else {
        var vals = [];
        pts.forEach(function (p) { var v = rows[p.i][ci] === null || rows[p.i][ci] === '' ? NaN : +rows[p.i][ci]; if (isFinite(v)) vals.push(v); });
        if (vals.length >= 3) {
          var q = d3.scaleQuantile().domain(vals).range(ramp);
          marks.each(function (p) {
            var v = rows[p.i][ci] === null || rows[p.i][ci] === '' ? NaN : +rows[p.i][ci];
            if (isFinite(v)) d3.select(this).classed('lch-explain-ramp', true).attr('fill', q(v)).attr('fill-opacity', 0.9);
          });
        }
      }
    }
  }

  function zeroMessage() {
    if (lassoState === 'unavailable') return 'The lasso is not available in this host, so there is nothing to draw around.';
    if (lassoState === 'overcap') return 'Lasso selection is off above ' + nf.format(+lassoOpt.rowCap) + ' rows (' + nf.format(rows.length) + ' here). Filter the rows to a smaller set to use it.';
    return C.zero({ lassoOff: lassoState === 'off' }).text;
  }
  function leftOut() {
    var out = EXCLUDED.slice();
    C.excluded.forEach(function (e) { if (e.reason !== 'axis' && out.indexOf(e.text) < 0) out.push(e.text); });
    return out;
  }

  function glyph(g, f, gx, gy, gw) {
    var bh = Math.max(3, FS * 0.3), restFill = fg;
    if (f.kind === 'category') {
      g.append('line').attr('x1', gx).attr('x2', gx + gw).attr('y1', gy + bh).attr('y2', gy + bh).attr('stroke', fg).attr('stroke-opacity', 0.12);
      g.append('rect').attr('class', 'lch-explain-bar-sel').attr('x', gx).attr('y', gy - bh / 2).attr('width', Math.max(1, gw * f.shareSel)).attr('height', bh).attr('fill', selPaint);
      g.append('rect').attr('class', 'lch-explain-bar-rest').attr('x', gx).attr('y', gy + bh / 2 + 1).attr('width', Math.max(1, gw * f.shareRest)).attr('height', bh).attr('fill', restFill).attr('fill-opacity', 0.45);
    } else if (f.max > f.min) {
      var s = d3.scaleLinear().domain([f.min, f.max]).range([gx, gx + gw]).clamp(true);
      [[f.q1Sel, f.medianSel, f.q3Sel, selPaint, 1, 'sel'], [f.q1Rest, f.medianRest, f.q3Rest, restFill, 0.45, 'rest']].forEach(function (d, k) {
        var cy = gy + k * (bh + 2);
        g.append('line').attr('class', 'lch-explain-iqr-' + d[5]).attr('x1', s(d[0])).attr('x2', s(d[2])).attr('y1', cy).attr('y2', cy)
          .attr('stroke', d[3]).attr('stroke-opacity', d[4]).attr('stroke-width', bh);
        g.append('line').attr('class', 'lch-explain-median-' + d[5]).attr('x1', s(d[1])).attr('x2', s(d[1])).attr('y1', cy - bh).attr('y2', cy + bh)
          .attr('stroke', d[3]).attr('stroke-opacity', Math.min(1, d[4] + 0.3)).attr('stroke-width', 1.5);
      });
    }
  }

  function paint(res) {
    panel.selectAll('*').remove();
    panel.attr('data-state', res.state);
    panel.append('rect').attr('class', 'lch-explain-frame').attr('width', PW).attr('height', PH).attr('rx', 3)
      .attr('fill', 'none').attr('stroke', fg).attr('stroke-opacity', 0.25);
    var tx = PAD, room = PW - 2 * PAD, ty = PAD + FS;
    function block(text, fs, maxLines, o) {
      wrap(text, room, fs, maxLines).forEach(function (ln) { line(panel, tx, ty, ln, fs, room, o); ty += fs * 1.3; });
    }
    function describedBlock(limit) {
      var items = (res.described || []).map(function (d) { return d.text; });
      if (res.describedText) items.push(res.describedText);
      if (items.length > 0 && ty + FS * 0.4 + SUB_FS <= limit) {
        ty += FS * 0.4;
        line(panel, tx, ty, res.describedTitle, SUB_FS, room, { cls: 'lch-explain-described-title', dim: true, bold: true });
        ty += SUB_FS * 1.3;
        for (var di = 0; di < items.length; di++) {
          var dl = wrap(items[di], room, SUB_FS, 2);
          if (ty + (dl.length - 1) * SUB_FS * 1.3 > limit) break;
          dl.forEach(function (ln) { line(panel, tx, ty, ln, SUB_FS, room, { cls: 'lch-explain-described', dim: true }); ty += SUB_FS * 1.3; });
        }
      }
    }
    if (res.state === 'found' || res.state === 'nothing') block(res.title, FS, 3, { cls: 'lch-explain-title', bold: true });
    var ruled = (res.state === 'found' || res.state === 'nothing') && !!ruleRes && ruleRes.state === 'found' && !ruleRes.repeats;
    if (ruled) {
      var ruleOn = !!active && active.rule === true;
      var rLines = wrap(ruleRes.text, room, FS, 3), rTop = ty - FS * 0.6, rH = rLines.length * FS * 1.3 + FS * 1.7;
      var hg = panel.append('g').attr('class', 'lch-explain-headline lch-control' + (ruleOn ? ' lch-explain-headline-active' : ''))
        .attr('data-rule', ruleRes.rule.text).attr('cursor', 'pointer')
        .on('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          active = ruleOn ? null : { rule: true };
          applyHit();
          paint(res);
        });
      hg.append('rect').attr('class', 'lch-explain-headline-hit').attr('x', 2).attr('y', rTop).attr('width', PW - 4).attr('height', Math.max(20, rH))
        .attr('fill', ruleOn ? accent : 'transparent').attr('fill-opacity', ruleOn ? 0.12 : 1);
      rLines.forEach(function (ln, i) { line(hg, tx, rTop + FS * 0.95 + i * FS * 1.3, ln, FS, room, { cls: 'lch-explain-headline-sentence' }); });
      glyph(hg, { kind: 'category', shareSel: ruleRes.shareSel, shareRest: ruleRes.shareRest }, tx, rTop + FS * 0.95 + (rLines.length - 1) * FS * 1.3 + FS * 0.9, room);
      ty = rTop + rH + FS * 0.6 + FS * 0.4;
    }
    if (res.state !== 'found') {
      var message = res.state === 'zero' ? zeroMessage() : (ruled && ruleRes.aloneText ? ruleRes.aloneText : res.text);
      block(message, FS, 5, { cls: 'lch-explain-text' });
      if (res.state === 'nothing' && res.closest) { ty += FS * 0.3; block(res.closest.text, SUB_FS, 3, { cls: 'lch-explain-closest', dim: true, italic: true }); }
      if (res.state !== 'zero') describedBlock(PH - PAD - SUB_FS * 1.6);
      if (res.state === 'noFields' && res.echoText) { ty += FS * 0.3; block(res.echoText, SUB_FS, 3, { cls: 'lch-explain-echo', dim: true }); }
      if (res.state === 'zero' && lassoState !== 'unavailable') {
        if (res.fieldsText) { ty += FS * 0.3; block(res.fieldsText, SUB_FS, 4, { cls: 'lch-explain-fields', dim: true }); }
        if (res.echoText) { ty += FS * 0.3; block(res.echoText, SUB_FS, 3, { cls: 'lch-explain-echo', dim: true }); }
        var out = leftOut();
        if (out.length) { ty += FS * 0.3; block('Left out: ' + out.join('; '), SUB_FS, 4, { cls: 'lch-explain-excluded', dim: true }); }
      }
      if (res.footer) { line(panel, tx, PH - PAD, res.footer, SUB_FS, room, { cls: 'lch-explain-footer', dim: true }); }
      return;
    }
    var foot = [];
    if (res.remainder) wrap(res.remainder, room, SUB_FS, 2).forEach(function (ln) { foot.push(ln); });
    if (res.footer) foot.push(res.footer);
    var footY = PH - PAD - (foot.length - 1) * SUB_FS * 1.3;
    var keyY = footY - SUB_FS * 1.6;
    var bottom = keyY - SUB_FS * 1.2;
    var MOREH = Math.max(20, FS * 1.7), GAPH = FS * 1.4;
    var plan = res.findings.map(function (f) {
      var lines = wrap(f.text, room, FS, 2);
      var h = lines.length * FS * 1.3 + FS * 1.7;
      if (expanded[key(f)]) h += f.others.length * FS * 1.4;
      return { f: f, lines: lines, h: h };
    });
    var top0 = ty - FS * 0.6;
    var fit = 0, used = 0;
    while (fit < plan.length && top0 + used + plan[fit].h + (fit + 1 < plan.length ? GAPH : 0) <= bottom) { used += plan[fit].h; fit++; }
    if (fit === 0 && plan.length) fit = 1;
    var extra = fit ? Math.max(0, Math.min(FS * 2, (bottom - top0 - used - (fit < plan.length ? GAPH : 0)) / fit)) : 0;
    var top = top0;
    plan.slice(0, fit).forEach(function (pl) {
      var f = pl.f, h = pl.h + extra, k = key(f);
      var isActive = !!active && active.field === f.field && active.level === (f.level || '');
      var rg = panel.append('g').attr('class', 'lch-explain-row lch-control' + (isActive ? ' lch-explain-row-active' : ''))
        .attr('data-field', f.field).attr('data-level', f.level || '').attr('data-kind', f.kind).attr('cursor', 'pointer')
        .on('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          active = isActive ? null : { field: f.field, level: f.level || '', kind: f.kind };
          applyHit();
          paint(res);
        });
      rg.append('rect').attr('class', 'lch-explain-row-hit').attr('x', 2).attr('y', top).attr('width', PW - 4).attr('height', Math.max(20, h))
        .attr('fill', isActive ? accent : 'transparent').attr('fill-opacity', isActive ? 0.12 : 1);
      pl.lines.forEach(function (ln, i) {
        line(rg, tx, top + FS * 0.95 + i * FS * 1.3, ln, FS, room, { cls: 'lch-explain-sentence' });
      });
      var bodyY = top + FS * 0.95 + (pl.lines.length - 1) * FS * 1.3;
      var gy = bodyY + FS * 0.9;
      var moreW = f.more ? tw(f.moreText, SUB_FS) + 8 : 0;
      var keyW = isActive && f.kind === 'measure' ? FS * 5.5 : 0;
      glyph(rg, f, tx, gy, Math.max(FS * 4, room - moreW - keyW));
      if (keyW) {
        ramp.forEach(function (c, r) {
          rg.append('rect').attr('class', 'lch-explain-key').attr('x', tx + room - moreW - keyW + r * FS * 0.9).attr('y', gy - FS * 0.3)
            .attr('width', FS * 0.8).attr('height', FS * 0.8).attr('fill', c).attr('stroke', fg).attr('stroke-opacity', 0.3);
        });
        line(rg, tx + room - moreW - keyW + FS * 2.8, gy + FS * 0.35, 'low .. high', SUB_FS, FS * 2.7, { dim: true });
      }
      if (f.more) {
        var mg = rg.append('g').attr('class', 'lch-explain-more lch-control').attr('cursor', 'pointer')
          .on('click', function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            expanded[k] = !expanded[k];
            paint(res);
          });
        mg.append('rect').attr('class', 'lch-explain-more-hit').attr('x', tx + room - moreW - 4).attr('y', gy - MOREH / 2).attr('width', moreW + 8).attr('height', MOREH).attr('fill', 'transparent');
        line(mg, tx + room, gy + SUB_FS * 0.35, expanded[k] ? 'show less' : f.moreText, SUB_FS, moreW + 16, { anchor: 'end', cls: 'lch-explain-morelabel' });
      }
      if (expanded[k]) {
        f.others.forEach(function (o, r) {
          line(rg, tx + FS, bodyY + FS * 2.5 + r * FS * 1.4, o.text, SUB_FS, room - FS, { cls: 'lch-explain-other', dim: true });
        });
      }
      top += h;
    });
    if (fit < plan.length) {
      var hidden = plan.slice(fit).map(function (pl) { return pl.f.field; });
      var more = numLine(panel, tx, top + FS * 0.6, '+' + nf.format(hidden.length) + ' more ' + (hidden.length === 1 ? 'field' : 'fields'), SUB_FS, room, { cls: 'lch-explain-hidden', dim: true });
      more.append('title').text(hidden.join(', '));
    }
    ty = top + FS * 0.6;
    if (fit === plan.length) describedBlock(keyY - SUB_FS * 1.4);
    var kx = tx;
    [['the selected points', selPaint, 1, 'sel'], ['the rest', fg, 0.45, 'rest']].forEach(function (d) {
      panel.append('rect').attr('class', 'lch-explain-legend-' + d[3]).attr('x', kx).attr('y', keyY - SUB_FS * 0.55).attr('width', FS * 1.3).attr('height', Math.max(3, FS * 0.3))
        .attr('fill', d[1]).attr('fill-opacity', d[2]);
      line(panel, kx + FS * 1.6, keyY, d[0], SUB_FS, room - FS * 1.6, { cls: 'lch-explain-legend', dim: true });
      kx += FS * 1.6 + tw(d[0], SUB_FS) + FS * 1.2;
    });
    foot.forEach(function (ln, n) {
      var isFooter = res.footer && n === foot.length - 1;
      line(panel, tx, footY + n * SUB_FS * 1.3, ln, SUB_FS, room, { cls: isFooter ? 'lch-explain-footer' : 'lch-explain-remainder', dim: true });
    });
  }

  var hostHolds = false;
  function explain(rowIdxs, one) {
    picked = rowIdxs.length;
    var res = few ? { state: 'few', text: 'Only one point is in view, so there is no group to set apart from the rest: the explainer needs two or more points to compare.' }
      : rowIdxs.length ? C.explain(rowIdxs) : C.zero({ lassoOff: lassoState === 'off' });
    ruleRes = res.state === 'found' || res.state === 'nothing' ? S.explain(rowIdxs, res) : null;
    expanded = {};
    if (!rowIdxs.length) active = null;
    if (active && active.rule && !(ruleRes && ruleRes.state === 'found' && !ruleRes.repeats)) active = null;
    applyHit();
    if (one) {
      var lead = nf.format(1) + ' selected', how = (lassoState === 'live' ? 'circle' : 'select') + ' two or more';
      d3.llmFitLabel(countText, countRoom(), { pad: 0, text: lead + ': ' + how + ' to compare', forms: [lead + ': ' + how, lead], overflow: 'drop' });
    } else countText.text(picked ? nf.format(picked) + ' of ' + nf.format(rows.length) + ' selected' : '');
    clearPill.attr('display', picked || one || (few && hostHolds) ? null : 'none');
    var cw = picked || one ? tw(countText.text(), SUB_FS) : 0;
    clearPill.attr('transform', 'translate(' + (RX + RW - cw - 8 - clearW) + ',' + (RY + STRIP / 2 - clearH / 2) + ')');
    paint(res);
  }

  var lastKey = '';
  function explainRows(rowIdxs) {
    var k = rowIdxs.slice().sort(function (a, b) { return a - b; }).join(',');
    if (k === lastKey) return;
    lastKey = k;
    explain(rowIdxs);
  }
  var inRange = function (rs) { return (Array.isArray(rs) ? rs : []).filter(function (r) { return Number.isInteger(r) && r >= 0 && r < rows.length; }); };
  function onLasso(ev) {
    var d = (ev && ev.detail) || {};
    explainRows(inRange(d.rows));
  }
  function onHostSelection(fact) {
    if (!fact || !Array.isArray(fact.rows)) return;
    var rs = inRange(fact.rows);
    if (few) { hostHolds = rs.length > 0 || +fact.hidden > 0; lastKey = ''; explain([]); return; }
    if (rs.length < 2) { lastKey = ''; explain([], rs.length === 1); return; }
    explainRows(rs);
  }
  container.addEventListener('llm-lasso', onLasso);
  container.__lchHostSelection = onHostSelection;
  container.__lchExplainOff = function () {
    container.removeEventListener('llm-lasso', onLasso);
    if (container.__lchHostSelection === onHostSelection) container.__lchHostSelection = null;
  };
  hostHolds = !!options.hostSelection && (inRange(options.hostSelection.rows).length > 0 || +options.hostSelection.hidden > 0);
  explain([]);
  var held = options.hostSelection && inRange(options.hostSelection.rows);
  if (held && held.length >= 2) explainRows(held);
  else if (held && held.length === 1) explain([], true);

  if (options.allowTooltips !== false) {
    var tip = d3.llmTooltip(container);
    marks.on('mouseover', function (e, p) {
      var name = countryI >= 0 ? '<b>' + String(rows[p.i][countryI]) + '</b><br/>' : '';
      var reg = colorCi >= 0 ? d3.llmDisplayName(colorName) + ': ' + levelName(rows[p.i][colorCi]) + '<br/>' : '';
      tip.show(name + reg + d3.llmDisplayName(xName) + ': ' + xF(p.x) + '<br/>' + d3.llmDisplayName(yName) + ': ' + yF(p.y), e);
    })
      .on('mousemove', function (e) { tip.move(e); })
      .on('mouseout', function () { tip.hide(); });
  }
}
