// BIC generated chart — Budget allocator [D3]
// host contract v1.24.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// bic:keyboard-marks
d3.llmSlider = function (svg, cfg) {
var TYPE_FLOOR = 10;   // the minimum readable type, px
cfg = cfg || {};
var options = cfg.options || {}, container = cfg.container;
var key = cfg.key || 'value';
var onChange = typeof cfg.onChange === 'function' ? cfg.onChange : function () {};
var snaps = cfg.snapValues, dom = cfg.domain;
var isSnap = Array.isArray(snaps) && snaps.length > 1;
var noop = { value: function () { return null; }, set: function () {}, reset: function () {}, g: null,
bounds: function () { return { left: 0, right: 0 }; } };
var numericOk = dom && dom.length === 2 && isFinite(+dom[0]) && isFinite(+dom[1]) && +dom[1] > +dom[0];
var handleOnly = cfg.handleOnly === true && !isSnap && typeof cfg.position === 'function';
if (!svg || (!isSnap && !numericOk) || (cfg.handleOnly === true && !handleOnly)) {
return cfg.handleOnly === true ? { value: noop.value, set: noop.set, reset: noop.reset, g: null, bounds: noop.bounds,
domain: function () { return this; }, refresh: function () { return this; } } : noop;
}
var isDate = isSnap && snaps[0] instanceof Date;
var fg = options.themeFg || '#252423', accent = options.themeAccent || fg;
var x = cfg.x != null ? cfg.x : 0, y = cfg.y != null ? cfg.y : 0, w = cfg.width != null ? cfg.width : 120;
var step = isSnap ? 1 : (+cfg.step > 0 ? +cfg.step : (dom[1] - dom[0]) / 100);
var continuous = handleOnly && !(+cfg.step > 0);   // a handle-only dot with no step keeps the value it is given
var fmt = typeof cfg.format === 'function' ? cfg.format
: function (v) { return isDate ? new Date(+v).toISOString().slice(0, 10) : String(v); };
var fsz = Math.max(TYPE_FLOOR, +cfg.fontSize > 0 ? +cfg.fontSize
: Math.min(14, Math.min(options.width || 600, options.height || 400) / 55));
var fszSub = Math.max(TYPE_FLOOR, fsz * 0.9);   // label and readout: one size for the drawing and the measure
var tw = d3.llmSlider.textWidth;
var withSteppers = cfg.steppers !== false;
var gap = fsz * 0.6, box = Math.max(20, Math.round(fsz * 1.5));
var minusLeft = x - gap - box;                                   // [-] box spans [minusLeft, x - gap]
var labelRight = withSteppers ? minusLeft - fsz * 0.5 : x - fsz * 0.8;
var plusLeft = x + w + gap;                                      // [+] box spans [plusLeft, plusLeft + box]
var readoutLeft = withSteppers ? plusLeft + box + fsz * 0.5 : x + w + fsz * 0.8;

var bag = {};
if (container) {
if (!container.__lchKnobs || typeof container.__lchKnobs !== 'object') container.__lchKnobs = {};
bag = container.__lchKnobs;
}
var ui = options.uiState && typeof options.uiState === 'object' ? options.uiState : {};
var restored = ui.knobs && typeof ui.knobs === 'object' ? ui.knobs[key] : undefined;

function coerce(v) {                     // UNTRUSTED input -> a valid internal value, or null
if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
if (isSnap) {
var n = isDate ? +new Date(v) : +v;
if (!isFinite(n)) return null;
var best = -1, bd = Infinity;
for (var i = 0; i < snaps.length; i++) {
var d = Math.abs(+snaps[i] - n);
if (d < bd) { bd = d; best = i; }
}
return best;                         // snap knobs hold an INDEX internally
}
var f = +v;
if (!isFinite(f) || f < dom[0] || f > dom[1]) return null;
return continuous ? f : Math.round((f - dom[0]) / step) * step + dom[0];
}

var cur = coerce(restored);
if (cur === null) cur = coerce(cfg.value);
if (cur === null) cur = coerce(cfg['default']);
if (cur === null) cur = isSnap ? 0 : dom[0];

var scale = isSnap ? d3.scaleLinear().domain([0, snaps.length - 1]).range([x, x + w])
: d3.scaleLinear().domain(dom).range([x, x + w]);

function stop(ev) { if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation(); }
function place(v) {                      // handle-only: where the caller's position() puts the value
var p = cfg.position(v);
return p && isFinite(+p[0]) && isFinite(+p[1]) ? [+p[0], +p[1]] : [0, 0];
}
function invertPlace(px) {               // handle-only: the value whose handle sits at pixel px
if (typeof cfg.invert === 'function') { var iv = +cfg.invert(px); if (isFinite(iv)) return iv; }
var lo = dom[0], hi = dom[1], pLo = place(lo)[0], pHi = place(hi)[0];
if (pLo === pHi) return cur;
var rising = pHi > pLo;
if (rising ? px <= pLo : px >= pLo) return lo;
if (rising ? px >= pHi : px <= pHi) return hi;
for (var i = 0; i < 60; i++) {
var mid = (lo + hi) / 2;
if ((place(mid)[0] < px) === rising) lo = mid; else hi = mid;
}
return (lo + hi) / 2;
}
var g = svg.append('g').attr('class', 'llm-slider lch-control').attr('data-knob', key).on('click', stop);
var labelText = '', labelW = 0;
if (cfg.label && !handleOnly) {
labelText = String(cfg.label);
var labelNode = g.append('text').attr('class', 'llm-slider-label')
.attr('x', labelRight).attr('y', y + fsz * 0.35).attr('text-anchor', 'end')
.attr('font-size', fszSub).attr('fill', fg).text(labelText);
labelW = measure(labelNode, labelText, fszSub);
if (+cfg.labelRoom > 0 && labelW > +cfg.labelRoom) {
var keep = labelText;
while (keep.length > 1 && measure(labelNode, keep + '\u2026', fszSub) > +cfg.labelRoom) keep = keep.slice(0, -1);
labelText = keep.length > 1 ? keep + '\u2026' : '';
labelNode.text(labelText);
labelW = labelText ? measure(labelNode, labelText, fszSub) : 0;
}
}
if (!handleOnly) g.append('line').attr('class', 'llm-slider-track')
.attr('x1', x).attr('x2', x + w).attr('y1', y).attr('y2', y)
.attr('stroke', fg).attr('stroke-width', 2).attr('opacity', 0.35);
var handle = g.append('g').attr('class', 'llm-slider-handle').attr('cursor', 'ew-resize');
handle.append('circle').attr('r', fsz * 0.55).attr('cy', handleOnly ? 0 : y).attr('fill', accent)
.attr('stroke', fg).attr('stroke-width', 1);
handle.append('rect').attr('x', -12).attr('y', (handleOnly ? 0 : y) - 12).attr('width', 24).attr('height', 24)
.attr('fill', 'transparent').attr('pointer-events', 'all');
handle.attr('role', 'slider').attr('tabindex', 0).attr('aria-label', String(cfg.label || key)).attr('aria-orientation', 'horizontal');
handle.on('keydown', function (event) {
var k = event && event.key, big = isSnap ? Math.max(1, Math.round(snaps.length / 10)) : 10;
var by = k === 'ArrowRight' || k === 'ArrowUp' ? 1 : k === 'ArrowLeft' || k === 'ArrowDown' ? -1
: k === 'PageUp' ? big : k === 'PageDown' ? -big : 0;
if (by) nudge(by);
else if (k === 'Home') setCur(isSnap ? 0 : dom[0], 'end');
else if (k === 'End') setCur(isSnap ? snaps.length - 1 : dom[1], 'end');
else return;
if (event && typeof event.preventDefault === 'function') event.preventDefault();
stop(event);
});
var readout = handleOnly ? null : g.append('text').attr('class', 'llm-slider-readout')
.attr('x', readoutLeft).attr('y', y + fsz * 0.35)
.attr('font-size', fszSub).attr('fill', fg);
var readoutText = '';

function measure(sel, txt, fs) {
try {
var node = typeof sel.node === 'function' ? sel.node() : null;
if (node && typeof node.getComputedTextLength === 'function') {
var mw = node.getComputedTextLength();
if (mw > 0) return mw;
}
} catch (e) { /* fall through to the estimate */ }
return tw(txt, fs);
}

function valueOf() { return isSnap ? snaps[cur] : cur; }
function stored() { return isSnap ? (isDate ? new Date(+snaps[cur]).toISOString() : snaps[cur]) : cur; }
function paint() {
handle.attr('aria-valuemin', isSnap ? 0 : dom[0]).attr('aria-valuemax', isSnap ? snaps.length - 1 : dom[1])
.attr('aria-valuenow', cur).attr('aria-valuetext', String(fmt(valueOf())));
if (handleOnly) { var at = place(cur); handle.attr('transform', 'translate(' + at[0] + ',' + at[1] + ')'); return; }
handle.attr('transform', 'translate(' + scale(cur) + ',0)');
readoutText = String(fmt(valueOf()));
readout.text(readoutText);
}
function reportControl() {
if (typeof options.onControlChange !== 'function') return;
try { options.onControlChange({ control: 'slider', key: key, value: String(stored()) }); }
catch (e) { /* a host that refuses the report must never take the chart down with it */ }
}
function persist(phase) {
bag[key] = stored();
onChange(valueOf(), phase);
if (phase === 'end' || phase === 'reset') reportControl();
if (typeof options.setUiState !== 'function') return;
var live = container && container.__lchUiLiveOpts === options && container.__lchUiLiveSeed === options.uiState
? container.__lchUiLive : null;
var base = live || ui;
var next = {}, k;
for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
next.knobs = {};
for (k in bag) if (Object.prototype.hasOwnProperty.call(bag, k)) next.knobs[k] = bag[k];
if (container) { container.__lchUiLive = next; container.__lchUiLiveOpts = options; container.__lchUiLiveSeed = options.uiState; }
try { options.setUiState(next); } catch (e) { /* persistence is advisory, never fatal */ }
}
function setCur(c, phase) {
var v = isSnap ? Math.max(0, Math.min(snaps.length - 1, Math.round(c)))
: Math.max(dom[0], Math.min(dom[1], c));
if (v === cur && phase !== 'init') return;
cur = v;
paint();
if (phase === 'drag') onChange(valueOf(), 'drag'); else persist(phase);
}
function nudge(dir) { setCur(isSnap ? cur + dir : cur + dir * step, 'end'); }
function mkStepper(parent, dir, left) {
var s = parent.append('g').attr('class', 'llm-slider-step lch-control').attr('cursor', 'pointer')
.attr('aria-label', (dir < 0 ? 'Decrease ' : 'Increase ') + String(cfg.label || key))
.on('click', function () { nudge(dir); });
s.append('rect').attr('x', left).attr('y', y - box / 2).attr('width', box).attr('height', box)
.attr('rx', 3).attr('fill', 'transparent').attr('stroke', fg).attr('opacity', 0.6);
s.append('text').attr('x', left + box / 2).attr('y', y + fsz * 0.35).attr('text-anchor', 'middle')
.attr('font-size', fsz).attr('fill', fg).text(dir < 0 ? '-' : '+');
return s;
}
if (withSteppers && !handleOnly) {
var stepG = g.append('g').attr('class', 'llm-slider-steppers');
mkStepper(stepG, -1, minusLeft);
mkStepper(stepG, +1, plusLeft);
}

handle.call(d3.drag()
.on('drag', function (event) {
var v = handleOnly ? invertPlace(event.x) : scale.invert(event.x);
setCur(isSnap || continuous ? v : Math.round((v - dom[0]) / step) * step + dom[0], 'drag');
})
.on('end', function () { persist('end'); }));

paint();
if (!handleOnly) bag[key] = stored();   // a handle-only dot writes the bag only when the reader lets go
onChange(valueOf(), 'init');
var api = {
value: valueOf,
g: g,
set: function (v, fire) { var c = coerce(v); if (c === null) return; setCur(c, fire === false ? 'drag' : 'end'); },
reset: function (fire) { var c = coerce(cfg['default']); if (c === null) return; setCur(c, fire === false ? 'drag' : 'reset'); },
bounds: function () {
if (handleOnly) { var hp = place(cur); return { left: hp[0], right: hp[0] }; }
var left = labelText ? labelRight - labelW : (withSteppers ? minusLeft : x);
var right = readoutLeft + measure(readout, readoutText, fszSub);
return { left: left, right: right };
}
};
if (handleOnly) {
api.domain = function (d) {
if (d && d.length === 2 && isFinite(+d[0]) && isFinite(+d[1]) && +d[1] >= +d[0]) {
dom = [+d[0], +d[1]];
cur = Math.max(dom[0], Math.min(dom[1], cur));
paint();
}
return api;
};
api.refresh = function () { paint(); return api; };
}
return api;
};
d3.llmSlider.textWidth = function (txt, fontSize) {
return String(txt == null ? '' : txt).length * (+fontSize > 0 ? +fontSize : 10) * 0.6;
};
d3.llmNumberEntry = function (svg, cfg) {
var TYPE_FLOOR = 10, XHTML = 'http://www.w3.org/1999/xhtml';
cfg = cfg || {};
var options = cfg.options || {}, container = cfg.container;
var key = cfg.key || 'value';
var onChange = typeof cfg.onChange === 'function' ? cfg.onChange : function () {};
var allowEmpty = cfg.allowEmpty !== false;
var levels = Array.isArray(cfg.levels) && cfg.levels.length ? cfg.levels.map(String) : null;
var lo = cfg.min != null && isFinite(+cfg.min) ? +cfg.min : -Infinity;
var hi = cfg.max != null && isFinite(+cfg.max) ? +cfg.max : Infinity;
var noop = { value: function () { return null; }, set: function () {}, reset: function () {},
outOfRange: function () { return false; }, bounds: function () { return { left: 0, right: 0 }; }, node: null,
destroy: function () {} };
if (!svg || typeof svg.append !== 'function') return noop;
var fg = options.themeFg || '#252423', bg = options.themeBg || '#ffffff';
var neg = options.themeNegative || '#c4314b';
var fsz = Math.max(TYPE_FLOOR, +cfg.fontSize > 0 ? +cfg.fontSize
: Math.min(14, Math.min(options.width || 600, options.height || 400) / 55));
var x = cfg.x != null ? +cfg.x : 0, y = cfg.y != null ? +cfg.y : 0;
var w = cfg.width != null ? Math.max(fsz * 3, +cfg.width) : fsz * 7;
var h = Math.round(fsz * 1.8);

var culture = options.cultureCode || undefined, decimal = '.', group = ',';
try {
var parts = new Intl.NumberFormat(culture).formatToParts(12345.6);
parts.forEach(function (p) { if (p.type === 'decimal') decimal = p.value; if (p.type === 'group') group = p.value; });
} catch (e) { /* the defaults are the invariant culture's */ }
var fmtNum;
try {
var nf = new Intl.NumberFormat(culture, { maximumFractionDigits: 6 });
var pf = new Intl.NumberFormat(culture, { style: 'percent', maximumFractionDigits: 4 });
fmtNum = function (v) { return cfg.percent ? pf.format(v) : nf.format(v); };
} catch (e) { fmtNum = function (v) { return cfg.percent ? (v * 100) + '%' : String(v); }; }
var fmt = typeof cfg.format === 'function' ? cfg.format : fmtNum;

function levelOf(s) {
var t = String(s == null ? '' : s).trim().toLowerCase();
for (var i = 0; i < levels.length; i++) if (levels[i].toLowerCase() === t) return levels[i];
return undefined;
}
function parseTyped(s) {
var t = String(s == null ? '' : s).trim();
if (t === '') return allowEmpty ? null : undefined;
if (levels) return levelOf(t);
t = t.replace(/[$\u20AC\u00A3\u00A5]/g, '').trim();   // the box's own format printed a currency sign ('$62,542'): it reads back as the number
var pct = false, mult = 1;
if (/%$/.test(t)) { pct = true; t = t.slice(0, -1).trim(); }
var suf = /([kKmMbB])$/.exec(t);
if (suf) { mult = { k: 1e3, m: 1e6, b: 1e9 }[suf[1].toLowerCase()]; t = t.slice(0, -1).trim(); }
t = t.replace(/[\s  ']/g, '');
if (group && group !== decimal) t = t.split(group).join('');
if (decimal !== '.') t = t.split(decimal).join('.');
if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined;
var v = +t * mult;
if (!isFinite(v)) return undefined;
if (pct || cfg.percent) v = v / 100;   // '3.2%' is 0.032 anywhere; '3.2' is 0.032 in a percent box
return v;
}
function coerce(v) {
if (v === null || v === '') return allowEmpty ? null : undefined;
if (v === undefined || typeof v === 'boolean' || typeof v === 'object') return undefined;
if (levels) return levelOf(v);
var n = typeof v === 'number' ? v : NaN;
if (!isFinite(n) || n < lo || n > hi) return undefined;
return n;
}
function show(v) { return v === null || v === undefined ? '' : (levels ? String(v) : String(fmt(v))); }

var bag = {};
if (container) {
if (!container.__lchKnobs || typeof container.__lchKnobs !== 'object') container.__lchKnobs = {};
bag = container.__lchKnobs;
}
var ui = options.uiState && typeof options.uiState === 'object' ? options.uiState : {};
var hasRestore = ui.knobs && typeof ui.knobs === 'object' && Object.prototype.hasOwnProperty.call(ui.knobs, key);
var cur = hasRestore ? coerce(ui.knobs[key]) : undefined;
var dflt = coerce(cfg['default'] === undefined ? null : cfg['default']);
if (cur === undefined) cur = dflt === undefined ? null : dflt;

var g = svg.append('g').attr('class', 'llm-entry lch-control');
var labelRight = cfg.labelRight != null ? +cfg.labelRight : x - fsz * 0.6, labelW = 0;
if (cfg.label) {
var ln = g.append('text').attr('class', 'llm-entry-label').attr('x', labelRight).attr('y', y + fsz * 0.35)
.attr('text-anchor', 'end').attr('font-size', Math.max(TYPE_FLOOR, fsz * 0.9)).attr('fill', fg)
.text(String(cfg.label));
labelW = String(cfg.label).length * Math.max(TYPE_FLOOR, fsz * 0.9) * 0.6;
try { var m = ln.node().getComputedTextLength(); if (m > 0) labelW = m; } catch (e) { /* estimate */ }
}
var fo = g.append('foreignObject').attr('class', 'lch-control').attr('x', x).attr('y', y - h / 2)
.attr('width', w).attr('height', h);
var doc = fo.node().ownerDocument;
var div = doc.createElementNS(XHTML, 'div');
div.setAttribute('class', 'lch-control');
div.setAttribute('style', 'margin:0;padding:0;width:100%;height:100%;box-sizing:border-box;line-height:0;');
var input = doc.createElementNS(XHTML, 'input');
input.setAttribute('type', 'text');
input.setAttribute('inputmode', levels ? 'text' : 'decimal');
input.setAttribute('class', 'lch-control lch-entry');
input.setAttribute('autocomplete', 'off');
input.setAttribute('spellcheck', 'false');
if (cfg.label) input.setAttribute('aria-label', String(cfg.label));
var baseStyle = 'display:block;box-sizing:border-box;width:100%;height:100%;margin:0;padding:0 ' + Math.round(fsz * 0.4) + 'px;' +
'font-family:inherit;font-size:' + fsz + 'px;text-align:right;' +
'color:var(--lch-hc-foreground,' + fg + ');background:var(--lch-hc-background,' + bg + ');' +
'border:1px solid var(--lch-hc-foreground,' + fg + ');border-radius:3px;outline:none;';
function mark(bad) {
input.setAttribute('style', baseStyle + (bad ? 'box-shadow:0 0 0 2px ' + neg + ';' : ''));
input.setAttribute('aria-invalid', bad ? 'true' : 'false');
}
mark(false);
input.value = show(cur);
div.appendChild(input);
fo.node().appendChild(div);

function persist(phase) {
bag[key] = cur;
onChange(cur, phase);
if (typeof options.setUiState !== 'function') return;
var live = container && container.__lchUiLiveOpts === options && container.__lchUiLiveSeed === options.uiState
? container.__lchUiLive : null;
var base = live || ui, next = {}, k;
for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
next.knobs = {};
for (k in bag) if (Object.prototype.hasOwnProperty.call(bag, k)) next.knobs[k] = bag[k];
if (container) { container.__lchUiLive = next; container.__lchUiLiveOpts = options; container.__lchUiLiveSeed = options.uiState; }
try { options.setUiState(next); } catch (e) { /* persistence is advisory, never fatal */ }
}
function report() {
if (typeof options.onControlChange !== 'function') return;
try { options.onControlChange({ control: 'entry', key: key, value: cur }); }
catch (e) { /* telemetry is advisory, never fatal */ }
}
var committedText = input.value;
function commit() {
var v = parseTyped(input.value);
if (v === undefined) { mark(true); return false; }
mark(false);
var changed = v !== cur;
cur = v;
input.value = show(cur);
committedText = input.value;
if (changed) { persist('change'); report(); }
return true;
}
function stop(ev) { if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation(); }
input.addEventListener('keydown', function (ev) {
stop(ev);
if (ev.key === 'Enter') { if (typeof ev.preventDefault === 'function') ev.preventDefault(); commit(); }
else if (ev.key === 'Escape') {
if (typeof ev.preventDefault === 'function') ev.preventDefault();
input.value = committedText; mark(false);
if (typeof input.blur === 'function') input.blur();
}
});
input.addEventListener('keyup', stop);
input.addEventListener('keypress', stop);
input.addEventListener('change', function (ev) { stop(ev); commit(); });
['click', 'dblclick', 'mousedown', 'pointerdown', 'pointerup', 'mouseup', 'contextmenu', 'wheel']
.forEach(function (t) { div.addEventListener(t, stop); });

bag[key] = cur;
onChange(cur, 'init');
return {
node: input,
value: function () { return cur; },
set: function (v, fire) {
var c = typeof v === 'string' ? parseTyped(v) : coerce(v);
if (c === undefined) return;
cur = c; input.value = show(cur); committedText = input.value; mark(false);
if (fire === false) { bag[key] = cur; onChange(cur, 'change'); } else persist('change');
},
reset: function (fire) {
cur = dflt === undefined ? null : dflt; input.value = show(cur); committedText = input.value; mark(false);
if (fire === false) { bag[key] = cur; onChange(cur, 'reset'); } else persist('reset');
},
outOfRange: function () { return typeof cur === 'number' && (cur < lo || cur > hi); },
bounds: function () { return { left: cfg.label ? labelRight - labelW : x, right: x + w }; },
destroy: function () { g.remove(); }
};
};
// @requires llmModelFormat
d3.llmResponseCurves = function (data, cfg) {
cfg = cfg || {};
var columns = (data && data.columns) || [];
var allRows = (data && data.rows) || [];
var colIdx = {};
for (var ci = 0; ci < columns.length; ci++) {
var cn = columns[ci] && (columns[ci].name !== undefined ? columns[ci].name : columns[ci]);
if (cn !== undefined && cn !== null) colIdx[String(cn)] = ci;
}
function cell(row, name) {
if (row === null || row === undefined) return undefined;
if (Array.isArray(row)) return colIdx[name] === undefined ? undefined : row[colIdx[name]];
return row[name];
}
function num(v) {
if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
var x = typeof v === 'number' ? v : +String(v).trim();
return isFinite(x) ? x : NaN;
}
var spendCol = String(cfg.spend), outcomeCol = String(cfg.outcome);
var channelCol = String(cfg.channel), periodCol = String(cfg.period);
var memberCol = cfg.member === undefined || cfg.member === null || String(cfg.member) === '' ? null : String(cfg.member);
var memberMissing = false;
if (memberCol !== null) {
var firstRow = allRows.length ? allRows[0] : null;
var hasMember = colIdx[memberCol] !== undefined ||
(firstRow && !Array.isArray(firstRow) && typeof firstRow === 'object' && Object.prototype.hasOwnProperty.call(firstRow, memberCol));
if (!hasMember && (columns.length || firstRow)) { memberMissing = true; memberCol = null; }
}
var rowFloor = +cfg.minRows > 0 ? +cfg.minRows : 8;
var EXTEND = +cfg.extend > 1 ? Math.min(+cfg.extend, 3) : 1;
var conf = +cfg.confidence > 0 && +cfg.confidence < 1 ? +cfg.confidence : 0.9;
var nonNegAll = cfg.nonNegative === true || cfg.nonNegative === outcomeCol ||
(Array.isArray(cfg.nonNegative) && cfg.nonNegative.map(String).indexOf(outcomeCol) >= 0);
var GRID = 400, NARROW = 3, CONFOUND_R = 0.8, AIC_MARGIN = 2;

function lgamma(x) {
var g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
x -= 1;
var a = g[0], t = x + 7.5;
for (var i = 1; i < 9; i++) a += g[i] / (x + i);
return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {
var TINY = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
if (Math.abs(d) < TINY) d = TINY;
d = 1 / d;
var h = d;
for (var m = 1; m <= 300; m++) {
var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
d = 1 / d; h *= d * c;
aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
d = 1 / d;
var del = d * c;
h *= del;
if (Math.abs(del - 1) < 1e-16) break;
}
return h;
}
function ibeta(x, a, b) {
if (x <= 0) return 0;
if (x >= 1) return 1;
var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function tcdf(t, df) {
var tail = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5);
return t >= 0 ? 1 - tail : tail;
}
function tquantile(p, df) {
var lo = 0, hi = 1;
while (tcdf(hi, df) < p && hi < 1e7) hi *= 2;
for (var i = 0; i < 200; i++) {
var mid = (lo + hi) / 2;
if (tcdf(mid, df) < p) lo = mid; else hi = mid;
if (hi - lo < 1e-13 * Math.max(1, hi)) break;
}
return (lo + hi) / 2;
}
var tCache = {};
function tFor(df) {                     // the two-sided quantile at the chosen confidence; 0 when no degree of freedom is left
if (!(df >= 1)) return 0;
if (tCache[df] === undefined) tCache[df] = tquantile(1 - (1 - conf) / 2, df);
return tCache[df];
}

function periodKey(v) {
if (v === null || v === undefined) return null;
if (v instanceof Date) return isFinite(+v) ? 'd' + (+v) : null;
if (typeof v === 'number') return isFinite(v) ? 'n' + v : null;
var s = String(v).trim();
return s === '' ? null : 's' + s;
}
function periodValue(v) {
if (v instanceof Date) return +v;
if (typeof v === 'number') return v;
var s = String(v).trim();
if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
return Date.parse(s);
}

function olsLine(xs, ys) {
var n = xs.length, sx = 0, sy = 0, i;
for (i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
var xb = sx / n, yb = sy / n, sxx = 0, sxy = 0;
for (i = 0; i < n; i++) { sxx += (xs[i] - xb) * (xs[i] - xb); sxy += (xs[i] - xb) * (ys[i] - yb); }
var b = sxx > 0 ? sxy / sxx : 0, a = yb - b * xb, rss = 0;
for (i = 0; i < n; i++) { var e = ys[i] - a - b * xs[i]; rss += e * e; }
var df = n - 2, s2 = df >= 1 ? rss / df : 0;
var cov = sxx > 0 ? [[s2 * (1 / n + xb * xb / sxx), -s2 * xb / sxx], [-s2 * xb / sxx, s2 / sxx]] : [[s2 / n, 0], [0, 0]];
return { a: a, b: b, rss: rss, df: df >= 1 ? df : 0, cov: cov, aic: aic(rss, n, 2) };
}
function aic(rss, n, p) { return n * Math.log(Math.max(rss, 1e-300) / n) + 2 * p; }
function lsAt(xs, ys, K) {              // (c, V, rss) of the curve at this K by least squares; null when V is not positive
var n = xs.length, gs = new Array(n), gb = 0, yb = 0, i;
for (i = 0; i < n; i++) { gs[i] = xs[i] / (K + xs[i]); gb += gs[i]; yb += ys[i]; }
gb /= n; yb /= n;
var sgg = 0, sgy = 0;
for (i = 0; i < n; i++) { sgg += (gs[i] - gb) * (gs[i] - gb); sgy += (gs[i] - gb) * (ys[i] - yb); }
if (!(sgg > 0)) return null;
var V = sgy / sgg;
if (!(V > 0)) return null;
var c = yb - V * gb, rss = 0;
for (i = 0; i < n; i++) { var e = ys[i] - c - V * gs[i]; rss += e * e; }
return { c: c, V: V, rss: rss };
}
function invert(M) {                    // Gauss-Jordan with partial pivoting on the correlation scale; null when singular
var k = M.length, d = [], A = [], i, j, r;
for (i = 0; i < k; i++) { d[i] = Math.sqrt(M[i][i]); if (!(d[i] > 0)) return null; }
for (i = 0; i < k; i++) {
A.push([]);
for (j = 0; j < k; j++) A[i].push(M[i][j] / (d[i] * d[j]));
for (j = 0; j < k; j++) A[i].push(i === j ? 1 : 0);
}
for (i = 0; i < k; i++) {
var piv = i;
for (r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
if (!(Math.abs(A[piv][i]) > 1e-15)) return null;
var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp;
var p = A[i][i];
for (j = 0; j < 2 * k; j++) A[i][j] /= p;
for (r = 0; r < k; r++) {
if (r === i) continue;
var f = A[r][i];
if (f !== 0) for (j = 0; j < 2 * k; j++) A[r][j] -= f * A[i][j];
}
}
var out = [];
for (i = 0; i < k; i++) { out.push([]); for (j = 0; j < k; j++) out[i].push(A[i][k + j] / (d[i] * d[j])); }
return out;
}

function polish(xs, ys, c, V, K, kMin, kMax) {
var n = xs.length;
function rssOf(c0, V0, K0) {
var s = 0;
for (var i = 0; i < n; i++) { var e = ys[i] - c0 - V0 * xs[i] / (K0 + xs[i]); s += e * e; }
return s;
}
var rss = rssOf(c, V, K);
for (var it = 0; it < 20; it++) {
var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r3 = [0, 0, 0], i, u, w;
for (i = 0; i < n; i++) {
var den = K + xs[i], row = [1, xs[i] / den, -V * xs[i] / (den * den)], res = ys[i] - c - V * xs[i] / den;
for (u = 0; u < 3; u++) { r3[u] += row[u] * res; for (w = 0; w < 3; w++) A[u][w] += row[u] * row[w]; }
}
var inv = invert(A);
if (!inv) break;
var step = [0, 0, 0];
for (u = 0; u < 3; u++) for (w = 0; w < 3; w++) step[u] += inv[u][w] * r3[w];
var scale = 1, next = null;
for (var h = 0; h < 10; h++) {
var c2 = c + scale * step[0], V2 = V + scale * step[1], K2 = K + scale * step[2];
if (V2 > 0 && K2 >= kMin && K2 <= kMax) {
var r2 = rssOf(c2, V2, K2);
if (r2 <= rss) { next = { c: c2, V: V2, K: K2, rss: r2 }; break; }
}
scale /= 2;
}
if (!next) break;
var small = Math.abs(next.K - K) <= 1e-14 * K && Math.abs(next.V - V) <= 1e-14 * V;
c = next.c; V = next.V; K = next.K; rss = next.rss;
if (small) break;
}
return { c: c, V: V, K: K, rss: rss };
}

function profileFit(xs, ys) {
var n = xs.length, lo = Infinity, hi = -Infinity, i;
for (i = 0; i < n; i++) { if (xs[i] < lo) lo = xs[i]; if (xs[i] > hi) hi = xs[i]; }
var lnLo = Math.log(Math.max(1e-6, 0.02 * lo)), lnHi = Math.log(200 * hi), step = (lnHi - lnLo) / (GRID - 1);
function lnK(j) { return j === GRID - 1 ? lnHi : lnLo + j * step; }
var best = -1, bestFit = null;
for (var j = 0; j < GRID; j++) {
var r = lsAt(xs, ys, Math.exp(lnK(j)));
if (r && (bestFit === null || r.rss < bestFit.rss)) { best = j; bestFit = r; bestFit.K = Math.exp(lnK(j)); }
}
if (best < 0) return { noV: true };
if (best === GRID - 1) return { edge: true };
function F(lk) { var q = lsAt(xs, ys, Math.exp(lk)); return q ? q.rss : Infinity; }
var a = lnK(best > 0 ? best - 1 : 0), b = lnK(best + 1), inv = (Math.sqrt(5) - 1) / 2;
var c1 = b - inv * (b - a), d1 = a + inv * (b - a), fc = F(c1), fd = F(d1);
for (var it = 0; it < 300 && b - a > 1e-10; it++) {
if (fc < fd) { b = d1; d1 = c1; fd = fc; c1 = b - inv * (b - a); fc = F(c1); }
else { a = c1; c1 = d1; fc = fd; d1 = a + inv * (b - a); fd = F(d1); }
}
var K = Math.exp((a + b) / 2), q = lsAt(xs, ys, K);
if (!q || q.rss > bestFit.rss) { q = bestFit; K = bestFit.K; }
q = polish(xs, ys, q.c, q.V, K, Math.exp(lnK(best > 0 ? best - 1 : 0)), Math.exp(lnK(best + 1)));
K = q.K;
var JtJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], row;
for (i = 0; i < n; i++) {
var den = K + xs[i];
row = [1, xs[i] / den, -q.V * xs[i] / (den * den)];
for (var u = 0; u < 3; u++) for (var w = 0; w < 3; w++) JtJ[u][w] += row[u] * row[w];
}
var inverse = invert(JtJ), df = n - 3, s2 = df >= 1 ? q.rss / df : 0, cov = null;
if (inverse) {
cov = [];
for (var u2 = 0; u2 < 3; u2++) { cov.push([]); for (var w2 = 0; w2 < 3; w2++) cov[u2].push(s2 * inverse[u2][w2]); }
}
return { c: q.c, V: q.V, K: K, rss: q.rss, cov: cov, df: df >= 1 ? df : 0, aic: aic(q.rss, n, 3) };
}

function pearson(xs, ys) {              // null when either side does not vary
var n = xs.length, i;
if (n < 3) return null;
var mx = 0, my = 0;
for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
mx /= n; my /= n;
var sxx = 0, syy = 0, sxy = 0;
for (i = 0; i < n; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); sxy += (xs[i] - mx) * (ys[i] - my); }
return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function memberStats(mp) {
var M = mp.names.length, n = mp.xs.length, cnt = [], i;
for (i = 0; i < M; i++) cnt.push(0);
for (i = 0; i < n; i++) cnt[mp.mi[i]]++;
return { M: M, n: n, cnt: cnt };
}
function trendStats(st, mp) {
var tb = [], stt = [], k = [], i;
for (i = 0; i < st.M; i++) { tb.push(0); stt.push(0); }
for (i = 0; i < st.n; i++) tb[mp.mi[i]] += mp.rk[i];
for (i = 0; i < st.M; i++) tb[i] = st.cnt[i] > 0 ? tb[i] / st.cnt[i] : 0;
for (i = 0; i < st.n; i++) { var dt = mp.rk[i] - tb[mp.mi[i]]; stt[mp.mi[i]] += dt * dt; }
var kSum = 0;
for (i = 0; i < st.M; i++) { k.push(st.cnt[i] === 0 ? 0 : stt[i] > 1e-12 ? 2 : 1); kSum += k[i]; }
return { tb: tb, stt: stt, k: k, kSum: kSum };
}
function lineOf(st, mp, tr, v) {        // each member's intercept (at its mean rank) and slope over the ranks, fitted to v
var mean = [], slope = [], i;
for (i = 0; i < st.M; i++) { mean.push(0); slope.push(0); }
for (i = 0; i < st.n; i++) mean[mp.mi[i]] += v[i];
for (i = 0; i < st.M; i++) mean[i] = st.cnt[i] > 0 ? mean[i] / st.cnt[i] : 0;
for (i = 0; i < st.n; i++) { var j = mp.mi[i]; if (tr.k[j] === 2) slope[j] += (mp.rk[i] - tr.tb[j]) * (v[i] - mean[j]); }
for (i = 0; i < st.M; i++) slope[i] = tr.k[i] === 2 ? slope[i] / tr.stt[i] : 0;
return { mean: mean, slope: slope };
}
function within(st, mp, tr, v) {        // v with each member's own line removed
var L = lineOf(st, mp, tr, v), out = new Array(st.n);
for (var i = 0; i < st.n; i++) { var j = mp.mi[i]; out[i] = v[i] - L.mean[j] - L.slope[j] * (mp.rk[i] - tr.tb[j]); }
return out;
}
function sumAt(st, tr, L, tL) {         // the members' lines summed at rank tL
var s = 0;
for (var j = 0; j < st.M; j++) if (st.cnt[j] > 0) s += L.mean[j] + L.slope[j] * (tL - tr.tb[j]);
return s;
}
function weighted(mp, v) {              // v times its member's weight 1/a_i: every member counts alike in the shape
var out = new Array(v.length);
for (var i = 0; i < v.length; i++) out[i] = v[i] * mp.w[mp.mi[i]];
return out;
}
function gOf(mp, K) {                   // a_i u/(K + u) with u = x/s_i, and its derivative in K; 0 for a member with no spend
var n = mp.xs.length, g = new Array(n), d = new Array(n);
for (var i = 0; i < n; i++) {
var s = mp.s[mp.mi[i]], a = mp.a[mp.mi[i]];
if (!(s > 0)) { g[i] = 0; d[i] = 0; continue; }
var u = mp.xs[i] / s;
g[i] = a * u / (K + u); d[i] = -a * u / ((K + u) * (K + u));
}
return { g: g, d: d };
}
function memberLs(st, mp, tr, yd, K) {  // (V, rss) at this K, the members' lines concentrated out; null when V is not positive
var gd = within(st, mp, tr, weighted(mp, gOf(mp, K).g)), sgg = 0, sgy = 0, i;
for (i = 0; i < st.n; i++) { sgg += gd[i] * gd[i]; sgy += gd[i] * yd[i]; }
if (!(sgg > 0)) return null;
var V = sgy / sgg;
if (!(V > 0)) return null;
var rss = 0;
for (i = 0; i < st.n; i++) { var e = yd[i] - V * gd[i]; rss += e * e; }
return { V: V, rss: rss };
}
function memberFit(mp, tryCurve) {
var st = memberStats(mp), tr = trendStats(st, mp), n = st.n, M = st.M, i, S = 0, A = 0, nPos = 0;
var ym = lineOf(st, mp, tr, mp.ys).mean;
mp.a = ym.slice();
for (i = 0; i < M; i++) if (mp.s[i] > 0) { S += mp.s[i]; A += mp.a[i]; nPos++; }
var aPos = 0, aN = 0;
for (i = 0; i < M; i++) if (mp.a[i] > 0) { aPos += mp.a[i]; aN++; }
mp.w = [];
for (i = 0; i < M; i++) mp.w.push(mp.a[i] > 0 ? 1 / mp.a[i] : aN > 0 ? aN / aPos : 1);
var tL = -Infinity;                   // the latest period in view: where the members' lines are read
for (i = 0; i < n; i++) if (mp.rk[i] > tL) tL = mp.rk[i];
var lev = 0;                          // sum over members of the leverage of their line at tL, on the weighted scale
for (i = 0; i < M; i++) {
if (st.cnt[i] === 0) continue;
var h = 1 / st.cnt[i] + (tr.k[i] === 2 ? (tL - tr.tb[i]) * (tL - tr.tb[i]) / tr.stt[i] : 0);
lev += h / (mp.w[i] * mp.w[i]);
}
var yd = within(st, mp, tr, weighted(mp, mp.ys));
var gl = new Array(n);
for (i = 0; i < n; i++) { var si = mp.s[mp.mi[i]]; gl[i] = si > 0 ? mp.a[mp.mi[i]] * mp.xs[i] / si : 0; }
var gld = within(st, mp, tr, weighted(mp, gl)), sxx = 0, sxy = 0;
for (i = 0; i < n; i++) { sxx += gld[i] * gld[i]; sxy += gld[i] * yd[i]; }
var b = sxx > 0 ? sxy / sxx : 0, lrss = 0;
for (i = 0; i < n; i++) { var le = yd[i] - b * gld[i]; lrss += le * le; }
var ldf = n - tr.kSum - 1, ls2 = ldf >= 1 ? lrss / ldf : 0, vb = sxx > 0 ? ls2 / sxx : 0;
var glAt = sumAt(st, tr, lineOf(st, mp, tr, gl), tL), r = S > 0 ? A / S : 0;
var resLine = new Array(n);
for (i = 0; i < n; i++) resLine[i] = mp.ys[i] - b * gl[i];
var lineL = lineOf(st, mp, tr, resLine);
var line = { a: sumAt(st, tr, lineL, tL), b: b * r, rss: lrss, df: ldf >= 1 ? ldf : 0, aic: aic(lrss, n, tr.kSum + 1),
cov: [[ls2 * lev + glAt * glAt * vb, -glAt * vb * r], [-glAt * vb * r, vb * r * r]], memberLine: lineL };
var us = [], urk = [], umi = [], uLo = Infinity, uHi = -Infinity;
for (i = 0; i < n; i++) {
var sm = mp.s[mp.mi[i]];
if (!(sm > 0)) continue;
var uu = mp.xs[i] / sm;
us.push(uu); urk.push(mp.rk[i]); umi.push(mp.mi[i]);
if (uu < uLo) uLo = uu; if (uu > uHi) uHi = uu;
}
var ust = memberStats({ names: mp.names, mi: umi, xs: us }), saa = 0, srr = 0, sar = 0;
var um = lineOf(ust, { mi: umi, rk: urk }, { k: [], tb: [], stt: [] }, us).mean, rm = lineOf(ust, { mi: umi, rk: urk }, { k: [], tb: [], stt: [] }, urk).mean;
for (i = 0; i < us.length; i++) {
var da = us[i] - um[umi[i]], dr = urk[i] - rm[umi[i]];
saa += da * da; srr += dr * dr; sar += da * dr;
}
var confR = us.length - M >= 2 && saa > 0 && srr > 0 ? sar / Math.sqrt(saa * srr) : null;
var out = { line: line, prof: null, S: S, A: A, uLo: uLo, uHi: uHi, confoundR: confR, st: st, tr: tr, tL: tL };
if (!tryCurve || n < 4 || !(uHi > 0) || !(S > 0) || !(A > 0) || n - tr.kSum < 3) return out;
var lnLo = Math.log(Math.max(1e-6, 0.02 * uLo)), lnHi = Math.log(200 * uHi), step = (lnHi - lnLo) / (GRID - 1);
function lnK(j) { return j === GRID - 1 ? lnHi : lnLo + j * step; }
var best = -1, bestFit = null;
for (var j = 0; j < GRID; j++) {
var q0 = memberLs(st, mp, tr, yd, Math.exp(lnK(j)));
if (q0 && (bestFit === null || q0.rss < bestFit.rss)) { best = j; bestFit = q0; bestFit.K = Math.exp(lnK(j)); }
}
if (best < 0) { out.prof = { noV: true }; return out; }
if (best === GRID - 1) { out.prof = { edge: true }; return out; }
function F(lk) { var q = memberLs(st, mp, tr, yd, Math.exp(lk)); return q ? q.rss : Infinity; }
var lo = lnK(best > 0 ? best - 1 : 0), hi = lnK(best + 1), inv = (Math.sqrt(5) - 1) / 2;
var c1 = hi - inv * (hi - lo), d1 = lo + inv * (hi - lo), fc = F(c1), fd = F(d1);
for (var it = 0; it < 300 && hi - lo > 1e-10; it++) {
if (fc < fd) { hi = d1; d1 = c1; fd = fc; c1 = hi - inv * (hi - lo); fc = F(c1); }
else { lo = c1; c1 = d1; fc = fd; d1 = lo + inv * (hi - lo); fd = F(d1); }
}
var K = Math.exp((lo + hi) / 2), q = memberLs(st, mp, tr, yd, K);
if (!q || q.rss > bestFit.rss) { q = bestFit; K = bestFit.K; }
var V = q.V, rss = q.rss, kMin = Math.exp(lnK(best > 0 ? best - 1 : 0)), kMax = Math.exp(lnK(best + 1));
function jac(V0, K0) {                 // the within residuals and Jacobian columns over (V, K)
var go = gOf(mp, K0), gd = within(st, mp, tr, weighted(mp, go.g)), hd = within(st, mp, tr, weighted(mp, go.d)), res = new Array(n), s0 = 0;
for (var k = 0; k < n; k++) { res[k] = yd[k] - V0 * gd[k]; s0 += res[k] * res[k]; }
return { gd: gd, hd: hd, res: res, rss: s0, g: go.g, d: go.d };
}
var J = jac(V, K);
rss = J.rss;
for (var pit = 0; pit < 20; pit++) {
var A00 = 0, A01 = 0, A11 = 0, r0 = 0, r1 = 0;
for (i = 0; i < n; i++) {
var j0 = J.gd[i], j1 = V * J.hd[i];
A00 += j0 * j0; A01 += j0 * j1; A11 += j1 * j1; r0 += j0 * J.res[i]; r1 += j1 * J.res[i];
}
var Ai = invert([[A00, A01], [A01, A11]]);
if (!Ai) break;
var sV = Ai[0][0] * r0 + Ai[0][1] * r1, sK = Ai[1][0] * r0 + Ai[1][1] * r1, scale = 1, next = null;
for (var h2 = 0; h2 < 10; h2++) {
var V2 = V + scale * sV, K2 = K + scale * sK;
if (V2 > 0 && K2 >= kMin && K2 <= kMax) {
var J2 = jac(V2, K2);
if (J2.rss <= rss) { next = { V: V2, K: K2, J: J2 }; break; }
}
scale /= 2;
}
if (!next) break;
var small = Math.abs(next.K - K) <= 1e-14 * K && Math.abs(next.V - V) <= 1e-14 * V;
V = next.V; K = next.K; J = next.J; rss = J.rss;
if (small) break;
}
var B00 = 0, B01 = 0, B11 = 0;
for (i = 0; i < n; i++) { var k0 = J.gd[i], k1 = V * J.hd[i]; B00 += k0 * k0; B01 += k0 * k1; B11 += k1 * k1; }
var Bi = invert([[B00, B01], [B01, B11]]), df = n - tr.kSum - 2, s2 = df >= 1 ? rss / df : 0, cov = null;
var gAt = sumAt(st, tr, lineOf(st, mp, tr, J.g), tL), dAt = sumAt(st, tr, lineOf(st, mp, tr, J.d), tL);
var resCurve = new Array(n);
for (i = 0; i < n; i++) resCurve[i] = mp.ys[i] - V * J.g[i];
var curveL = lineOf(st, mp, tr, resCurve), c = sumAt(st, tr, curveL, tL);
if (Bi) {
var C = [[s2 * Bi[0][0], s2 * Bi[0][1]], [s2 * Bi[1][0], s2 * Bi[1][1]]];
var hv = [gAt, V * dAt], Ch = [C[0][0] * hv[0] + C[0][1] * hv[1], C[1][0] * hv[0] + C[1][1] * hv[1]];
var vc = s2 * lev + hv[0] * Ch[0] + hv[1] * Ch[1];
cov = [[vc, -A * Ch[0], -S * Ch[1]], [-A * Ch[0], A * A * C[0][0], A * S * C[0][1]], [-S * Ch[1], A * S * C[1][0], S * S * C[1][1]]];
}
out.prof = { c: c, V: A * V, K: S * K, rss: rss, cov: cov, df: df >= 1 ? df : 0, aic: aic(rss, n, tr.kSum + 2), memberLine: curveL, Vu: V, Ku: K };
return out;
}

function fitChannel(name, pts, tryCurve, mp) {
var n = pts.length, xs = [], ys = [], ps = [], i;
for (i = 0; i < n; i++) { xs.push(pts[i].x); ys.push(pts[i].y); ps.push(pts[i].rank); }
var lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
if (mp) return fitMembers(name, pts, lo, hi, tryCurve, mp);
var line = olsLine(xs, ys), prof = tryCurve && n >= 4 ? profileFit(xs, ys) : null;
var mm = prof && prof.cov ? prof : null, why, curved = false, dAIC = null;
if (!tryCurve || n < 4) why = 'rows';
else if (prof.noV) why = 'noV';
else if (prof.edge) why = 'edge';
else if (!mm) why = 'singular';
else {
dAIC = line.aic - mm.aic;
curved = dAIC > AIC_MARGIN;
why = curved ? 'curved' : 'aic';
}
var r = pearson(ps, xs);
var confound = r !== null && Math.abs(r) >= CONFOUND_R ? { r: r, direction: r > 0 ? 'rose' : 'fell' } : null;
var cv = {
name: name, n: n, lo: lo, hi: hi, span: lo > 0 ? hi / lo : Infinity, narrow: !(hi / lo >= NARROW), confound: confound,
confoundR: r, nonNeg: nonNegAll, mm: mm ? { c: mm.c, V: mm.V, K: mm.K, rss: mm.rss, cov: mm.cov, df: mm.df, aic: mm.aic } : null,
line: line, dAIC: dAIC, why: why, curved: curved, isLine: !curved,
verdict: curved ? 'diminishing returns shown' : 'straight in this data'
};
if (curved) {
cv.c = mm.c; cv.V = mm.V; cv.K = mm.K; cv.a = null; cv.b = null; cv.cov = mm.cov; cv.df = mm.df;
cv.params = ['c', 'V', 'K']; cv.falling = false;
} else {
cv.c = line.a; cv.V = null; cv.K = null; cv.a = line.a; cv.b = line.b; cv.cov = line.cov; cv.df = line.df;
cv.params = ['a', 'b']; cv.falling = !(line.b > 0);
}
cv.periods = n; cv.members = null;
return cv;
}
function fitMembers(name, pts, lo, hi, tryCurve, mp) {
var f = memberFit(mp, tryCurve), n = f.st.n, prof = f.prof, line = f.line;
var mm = prof && prof.cov ? prof : null, why, curved = false, dAIC = null;
if (!tryCurve || n < 4) why = 'rows';
else if (!prof || prof.noV) why = 'noV';
else if (prof.edge) why = 'edge';
else if (!mm) why = 'singular';
else {
dAIC = line.aic - mm.aic;
curved = dAIC > AIC_MARGIN;
why = curved ? 'curved' : 'aic';
}
var r = f.confoundR, span = f.uLo > 0 ? f.uHi / f.uLo : Infinity;
var confound = r !== null && Math.abs(r) >= CONFOUND_R ? { r: r, direction: r > 0 ? 'rose' : 'fell' } : null;
var L = curved ? mm.memberLine : line.memberLine, tr = f.tr;
var members = mp.names.map(function (nm, i) {
return { name: nm, s: mp.s[i], a: mp.a[i], n: f.st.cnt[i], trend: L.slope[i],
c: f.st.cnt[i] > 0 ? L.mean[i] + L.slope[i] * (f.tL - tr.tb[i]) : 0 };
});
var shift = Object.create(null);
for (var k = 0; k < n; k++) shift[mp.rk[k]] = (shift[mp.rk[k]] || 0) + L.slope[mp.mi[k]] * (f.tL - mp.rk[k]);
var cv = {
name: name, n: n, lo: lo, hi: hi, span: span, narrow: !(span >= NARROW), confound: confound, confoundR: r,
nonNeg: nonNegAll, mm: mm ? { c: mm.c, V: mm.V, K: mm.K, rss: mm.rss, cov: mm.cov, df: mm.df, aic: mm.aic } : null,
line: { a: line.a, b: line.b, rss: line.rss, df: line.df, aic: line.aic, cov: line.cov }, dAIC: dAIC, why: why,
curved: curved, isLine: !curved, verdict: curved ? 'diminishing returns shown' : 'straight in this data',
periods: pts.length, members: members, shiftByRank: shift
};
if (curved) {
cv.c = mm.c; cv.V = mm.V; cv.K = mm.K; cv.a = null; cv.b = null; cv.cov = mm.cov; cv.df = mm.df;
cv.params = ['c', 'V', 'K']; cv.falling = false;
} else {
cv.c = line.a; cv.V = null; cv.K = null; cv.a = line.a; cv.b = line.b; cv.cov = line.cov; cv.df = line.df;
cv.params = ['a', 'b']; cv.falling = !(line.b > 0);
}
return cv;
}
function fval(cv, x) { return cv.isLine ? cv.a + cv.b * x : cv.c + cv.V * x / (cv.K + x); }
function fder(cv, x) { return cv.isLine ? cv.b : cv.V * cv.K / ((cv.K + x) * (cv.K + x)); }
function fgrad(cv, x) { return cv.isLine ? [1, x] : [1, x / (cv.K + x), -cv.V * x / ((cv.K + x) * (cv.K + x))]; }
function quad(C, g) {
var s = 0;
for (var i = 0; i < g.length; i++) for (var j = 0; j < g.length; j++) s += g[i] * C[i][j] * g[j];
return s;
}

var rowPos = null;                      // a row's position in data.rows, so a point can name the rows behind it
function positionOf(rows, k, row) {
if (rows === allRows) return k;
if (rowPos === null && typeof Map === 'function') {
rowPos = new Map();
for (var q = 0; q < allRows.length; q++) rowPos.set(allRows[q], q);
}
var hit = rowPos ? rowPos.get(row) : undefined;
return hit === undefined ? k : hit;
}
function tabulate(rows) {
var byChannel = Object.create(null), order = [], seenPeriod = Object.create(null), periods = [], blanks = 0;
for (var k = 0; k < rows.length; k++) {
var row = rows[k], ch = cell(row, channelCol), pr = cell(row, periodCol);
var chKey = ch === null || ch === undefined ? '' : String(ch).trim(), pKey = periodKey(pr);
var x = num(cell(row, spendCol)), y = num(cell(row, outcomeCol));
var mv = memberCol === null ? null : cell(row, memberCol), mKey = mv === null || mv === undefined ? '' : String(mv).trim();
if (chKey === '' || pKey === null || !isFinite(x) || !isFinite(y) || (memberCol !== null && mKey === '')) { blanks++; continue; }
if (!byChannel[chKey]) {
byChannel[chKey] = { name: chKey, cells: Object.create(null), keys: [], members: Object.create(null), memberOrder: [], memberPoints: 0 };
order.push(chKey);
}
if (!seenPeriod[pKey]) { seenPeriod[pKey] = { key: pKey, raw: pr, first: periods.length, value: periodValue(pr) }; periods.push(seenPeriod[pKey]); }
var chan = byChannel[chKey], pt = chan.cells[pKey];
if (!pt) { pt = chan.cells[pKey] = { x: 0, y: 0, rows: [], period: pr, pKey: pKey }; chan.keys.push(pKey); }
pt.x += x; pt.y += y; pt.rows.push(positionOf(rows, k, row));
if (memberCol !== null) {           // the member's own point in this period: rows finer than (member, period) are summed
var mem = chan.members[mKey];
if (!mem) { mem = chan.members[mKey] = { name: mKey, cells: Object.create(null), keys: [] }; chan.memberOrder.push(mKey); }
var mpt = mem.cells[pKey];
if (!mpt) { mpt = mem.cells[pKey] = { x: 0, y: 0 }; mem.keys.push(pKey); chan.memberPoints++; }
mpt.x += x; mpt.y += y;
}
}
var chronological = periods.length > 0 && periods.every(function (p) { return isFinite(p.value); });
periods.sort(function (a, b) {
if (chronological && a.value !== b.value) return a.value < b.value ? -1 : 1;
return a.first - b.first;
});
var rank = Object.create(null);
periods.forEach(function (p, i) { rank[p.key] = i; });
return { byChannel: byChannel, order: order, periods: periods, rank: rank, blanks: blanks };
}

var holder = cfg.container && typeof cfg.container === 'object' ? cfg.container : null;
var modelKey = JSON.stringify(memberCol === null ? [spendCol, outcomeCol, channelCol, periodCol, nonNegAll]
: [spendCol, outcomeCol, channelCol, periodCol, nonNegAll, memberCol]);
var last = holder && holder.__lchCurvesLast && holder.__lchCurvesLast.key === modelKey ? holder.__lchCurvesLast.fit : null;
var current = null, lastSolve = { total: null, locks: {} };
function defaultTotal() {              // before any solve, the total the reader has now: the latest period's spends
if (lastSolve.total !== null && isFinite(lastSolve.total)) return lastSolve.total;
var s = 0, sp = now().current.spends;
for (var i = 0; i < sp.length; i++) s += sp[i];
return s;
}

function fit(rowsInView) {
var rows = rowsInView ? (Array.isArray(rowsInView) ? rowsInView : rowsInView.rows || []) : allRows;
var tab = tabulate(rows), notes = [], names = tab.order.slice();
var restsOn = function (nm) { var ch = tab.byChannel[nm]; return memberCol === null ? ch.keys.length : ch.memberPoints; };
var rarest = names.length ? Infinity : 0;
names.forEach(function (nm) { rarest = Math.min(rarest, restsOn(nm)); });
var belowFloor = names.length > 0 && rarest < rowFloor;
if (belowFloor && last) {
var keep = {};
for (var key in last) if (Object.prototype.hasOwnProperty.call(last, key)) keep[key] = last[key];
keep.stale = true; keep.nInView = names.reduce(function (s, nm) { return s + restsOn(nm); }, 0);
return keep;
}
if (memberMissing) notes.push(String(cfg.member) + ' is not in the data, so each curve rests on its channel\'s per-period totals');
if (tab.blanks) notes.push(tab.blanks + (tab.blanks === 1 ? ' row' : ' rows') + ' with a blank left out');
var curves = names.map(function (nm) {
var chan = tab.byChannel[nm];
var pts = chan.keys.map(function (k) {
var p = chan.cells[k];
return { x: p.x, y: p.y, period: p.period, rank: tab.rank[k], rows: p.rows };
});
pts.sort(function (a, b) { return a.rank - b.rank; });
var mp = null;
if (memberCol !== null) {           // each member's points, in period order, and its typical spend (their mean)
mp = { names: chan.memberOrder.slice(), s: [], mi: [], xs: [], ys: [], rk: [] };
mp.names.forEach(function (mn, mIdx) {
var mem = chan.members[mn], ks = mem.keys.slice().sort(function (a, b) { return tab.rank[a] - tab.rank[b]; }), sx = 0;
ks.forEach(function (pk) {
var c = mem.cells[pk];
mp.mi.push(mIdx); mp.xs.push(c.x); mp.ys.push(c.y); mp.rk.push(tab.rank[pk]); sx += c.x;
});
mp.s.push(ks.length ? sx / ks.length : 0);
});
}
var cv = fitChannel(nm, pts, !belowFloor, mp);
var shift = cv.shiftByRank;
delete cv.shiftByRank;
cv.points = pts.map(function (p) {
return shift ? { x: p.x, y: p.y + (shift[p.rank] || 0), yObserved: p.y, period: p.period, rows: p.rows }
: { x: p.x, y: p.y, period: p.period, rows: p.rows };
});
return cv;
});
var latest = tab.periods.length ? tab.periods[tab.periods.length - 1] : null;
var cur = { period: latest ? latest.raw : null, spends: [], absent: [] };
curves.forEach(function (cv, i) {
var pt = latest ? tab.byChannel[cv.name].cells[latest.key] : null;
cur.spends.push(pt ? pt.x : 0);
if (!pt) cur.absent.push(cv.name);
});
curves.forEach(function (cv) { cv.capHi = cv.isLine || !(EXTEND > 1) ? cv.hi : cv.hi * EXTEND; });
var tr = { lo: 0, hi: 0 };
curves.forEach(function (cv) { tr.lo += cv.lo; tr.hi += cv.capHi; });
var out = { curves: curves, channels: names, periods: tab.periods.map(function (p) { return p.raw; }), floor: rowFloor,
rarest: names.length ? rarest : 0, belowFloor: belowFloor, stale: false, nInView: curves.reduce(function (s, cv) { return s + cv.n; }, 0),
totalRange: tr, current: cur, notes: notes, confidence: conf, member: memberCol };
if (belowFloor) notes.push('fewer than ' + rowFloor + (memberCol === null ? ' periods' : ' ' + memberCol + '-period rows') +
' for the rarest channel: every channel is read as a straight line');
if (!belowFloor) { last = out; if (holder) holder.__lchCurvesLast = { key: modelKey, fit: out }; }
return out;
}
function now() { return current || (current = fit()); }
function curveAt(i) {
var cs = now().curves;
if (typeof i === 'string') { for (var k = 0; k < cs.length; k++) if (cs[k].name === i) return k; return -1; }
return i >= 0 && i < cs.length ? i : -1;
}

function at(i, x) {
var k = curveAt(i);
if (k < 0) return null;
var cv = now().curves[k];
x = +x;
var mean = fval(cv, x), se = Math.sqrt(Math.max(0, quad(cv.cov, fgrad(cv, x)))), half = tFor(cv.df) * se;
var lo = mean - half, hi = mean + half, clipped = false;
if (cv.nonNeg && (lo < 0 || hi < 0)) { lo = Math.max(0, lo); hi = Math.max(0, hi); clipped = true; }
return { mean: mean, lo: lo, hi: hi, se: se, marginal: fder(cv, x), outside: x < cv.lo || x > cv.hi, clipped: clipped };
}
function marginalAt(i, x, step) {
var k = curveAt(i);
if (k < 0) return NaN;
return fder(now().curves[k], +x) * (+step > 0 ? +step : 1);
}
function niceStep(total) {
var v = 0.01 * Math.abs(+total);
if (!(v > 0)) return 1;
var e = Math.floor(Math.log(v) / Math.LN10), f = v / Math.pow(10, e);
return (f < Math.SQRT2 ? 1 : f < Math.sqrt(10) ? 2 : f < Math.sqrt(50) ? 5 : 10) * Math.pow(10, e);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lockOf(locks, name) {
if (!locks || !Object.prototype.hasOwnProperty.call(locks, name)) return null;
var v = num(locks[name]);
return isFinite(v) ? v : null;
}
function bindingOrder(cs, idx) {        // largest observed spend first, then channel name: the same answer on every machine
return idx.slice().sort(function (p, q) {
if (cs[p].hi !== cs[q].hi) return cs[q].hi - cs[p].hi;
return cs[p].name < cs[q].name ? -1 : cs[p].name > cs[q].name ? 1 : 0;
});
}
function solveCore(cs, total, locks) {
var N = cs.length, spends = new Array(N), binding = new Array(N), notes = [], free = [], fixed = 0, i;
for (i = 0; i < N; i++) {
var lk = lockOf(locks, cs[i].name);
if (lk !== null) { spends[i] = clamp(lk, cs[i].lo, cs[i].capHi); binding[i] = 'locked'; fixed += spends[i]; }
else free.push(i);
}
var loSum = 0, hiSum = 0;
free.forEach(function (j) { loSum += cs[j].lo; hiSum += cs[j].capHi; });
var requested = +total, B = isFinite(requested) ? requested : fixed + loSum;
var R = B - fixed, clamped = false;
if (R < loSum) { R = loSum; clamped = true; } else if (R > hiSum) { R = hiSum; clamped = true; }
var rising = free.filter(function (j) { return !cs[j].isLine || cs[j].b > 0; });
var falling = free.filter(function (j) { return cs[j].isLine && !(cs[j].b > 0); });
falling.forEach(function (j) { spends[j] = cs[j].lo; binding[j] = 'falling'; });
var RA = R, level = null;
falling.forEach(function (j) { RA -= cs[j].lo; });
var capSum = 0, floorSum = 0;
rising.forEach(function (j) { capSum += cs[j].capHi; floorSum += cs[j].lo; });
var slack = 1e-12 * Math.max(1, Math.abs(RA));
if (RA > capSum + slack) {
var excess = RA - capSum;
rising.forEach(function (j) { spends[j] = cs[j].capHi; });
falling.slice().sort(function (p, q) {
if (cs[p].b !== cs[q].b) return cs[q].b - cs[p].b;
return bindingOrder(cs, [p, q])[0] === p ? -1 : 1;
}).forEach(function (j) {
var add = Math.min(cs[j].capHi - cs[j].lo, excess);
spends[j] += add; excess -= add;
});
notes.push('the rising channels are full; the rest of the total went to the channels whose outcome falls with spend');
level = null;
rising.forEach(function (j) { var d = fder(cs[j], cs[j].capHi); level = level === null ? d : Math.min(level, d); });
} else if (rising.length === 0) {
level = null;
} else if (RA >= capSum - slack) {
level = null;
rising.forEach(function (j) { spends[j] = cs[j].capHi; var d = fder(cs[j], cs[j].capHi); level = level === null ? d : Math.min(level, d); });
} else if (RA <= floorSum + slack) {
level = null;
rising.forEach(function (j) { spends[j] = cs[j].lo; var d = fder(cs[j], cs[j].lo); level = level === null ? d : Math.max(level, d); });
} else {
var mLow = Infinity, mHigh = 0;
rising.forEach(function (j) { mLow = Math.min(mLow, fder(cs[j], cs[j].capHi)); mHigh = Math.max(mHigh, fder(cs[j], cs[j].lo)); });
var xAt = function (cv, m) {
if (cv.isLine) return cv.b >= m ? cv.capHi : cv.lo;
return clamp(Math.sqrt(cv.V * cv.K / m) - cv.K, cv.lo, cv.capHi);
};
var total_ = function (m) { var s = 0; for (var q = 0; q < rising.length; q++) s += xAt(cs[rising[q]], m); return s; };
var uLo = Math.log(mLow) - 1e-6, uHi = Math.log(mHigh) + 1e-6;
for (var it = 0; it < 80; it++) {
var um = (uLo + uHi) / 2;
if (total_(Math.exp(um)) >= RA) uLo = um; else uHi = um;
}
level = Math.exp((uLo + uHi) / 2);
var tied = [];
rising.forEach(function (j) {
var cv = cs[j];
if (cv.isLine && Math.abs(cv.b - level) <= 1e-13 * level) { tied.push(j); spends[j] = cv.lo; }
else spends[j] = xAt(cv, level);
});
if (tied.length) {
var rest = RA;
rising.forEach(function (j) { rest -= spends[j]; });
bindingOrder(cs, tied).forEach(function (j) {
var add = Math.min(cs[j].capHi - cs[j].lo, Math.max(0, rest));
spends[j] += add; rest -= add;
});
}
}
rising.forEach(function (j) {
var cv = cs[j], tol = 1e-9 * Math.max(1, cv.capHi);
binding[j] = spends[j] >= cv.capHi - tol ? 'cap' : spends[j] <= cv.lo + tol ? 'floor' : cv.isLine ? 'remainder' : 'free';
});
var sum = 0;
for (i = 0; i < N; i++) sum += spends[i];
var beyond = spends.map(function (s, j) { return s > cs[j].hi * (1 + 1e-12); });
return { spends: spends, m: level, binding: binding, beyond: beyond, marginals: cs.map(function (cv, j) { return fder(cv, spends[j]); }),
total: sum, requested: requested, clamped: clamped, feasible: { lo: fixed + loSum, hi: fixed + hiSum }, notes: notes,
channels: cs.map(function (cv) { return cv.name; }) };
}
function solve(total, locks) {
var res = solveCore(now().curves, total, locks);
lastSolve = { total: +total, locks: locks || {} };
return res;
}

function vector(cs, p) {
var v = p && !Array.isArray(p) && Array.isArray(p.spends) ? p.spends : p;
if (Array.isArray(v)) return v.slice();
return cs.map(function (cv) { return v && Object.prototype.hasOwnProperty.call(v, cv.name) ? +v[cv.name] : NaN; });
}
function lossCore(cs, plan, best) {
var p = vector(cs, plan), b = vector(cs, best), delta = 0, variance = 0, dfMin = Infinity, changed = [];
for (var i = 0; i < cs.length; i++) {
if (!isFinite(p[i]) || !isFinite(b[i]) || p[i] === b[i]) continue;
changed.push(cs[i].name);
dfMin = Math.min(dfMin, cs[i].df);
delta += fval(cs[i], b[i]) - fval(cs[i], p[i]);
var gb = fgrad(cs[i], b[i]), gp = fgrad(cs[i], p[i]), g = [];
for (var k = 0; k < gb.length; k++) g.push(gb[k] - gp[k]);
variance += Math.max(0, quad(cs[i].cov, g));
}
var se = Math.sqrt(variance), t = changed.length ? tFor(dfMin) : 0;
var noInfo = changed.length > 0 && !(dfMin >= 1);
return { delta: delta, se: se, t: t, df: changed.length ? (dfMin >= 1 ? dfMin : 0) : null, lo: delta - t * se, hi: delta + t * se,
within: noInfo || Math.abs(delta) <= t * se, changed: changed };
}
function loss(plan, best) { return lossCore(now().curves, plan, best); }

function domainCore(cs, k, total, locks) {
var fixed = 0, loFree = 0, hiFree = 0;
for (var j = 0; j < cs.length; j++) {
if (j === k) continue;
var lk = lockOf(locks, cs[j].name);
if (lk !== null) fixed += clamp(lk, cs[j].lo, cs[j].capHi);
else { loFree += cs[j].lo; hiFree += cs[j].capHi; }
}
var a = Math.max(cs[k].lo, total - fixed - hiFree), b = Math.min(cs[k].capHi, total - fixed - loFree);
return [a, Math.max(a, b)];
}
function others(locks, name) {
var o = {};
if (locks) for (var key in locks) if (Object.prototype.hasOwnProperty.call(locks, key) && key !== name) o[key] = locks[key];
return o;
}
function domainOf(i, total, locks) {
var k = curveAt(i);
if (k < 0) return null;
var cs = now().curves;
var base = others(locks === undefined ? lastSolve.locks : locks, cs[k].name);
var t = total === undefined ? defaultTotal() : total;
return domainCore(cs, k, solveCore(cs, t, base).total, base);
}
function nearBest(i, total, locks) {
var k = curveAt(i);
if (k < 0) return null;
var cs = now().curves, name = cs[k].name;
var t = total === undefined ? defaultTotal() : total;
var base = others(locks === undefined ? lastSolve.locks : locks, name);
var best = solveCore(cs, t, base), x0 = best.spends[k], dom = domainCore(cs, k, best.total, base);
function within(x) {
var held = others(base, name);
held[name] = x;
return lossCore(cs, solveCore(cs, t, held).spends, best.spends).within;
}
function side(edge) {
var scale = Math.max(1, Math.abs(x0));
if (Math.abs(edge - x0) <= 1e-12 * scale) return x0;
if (within(edge)) return edge;
var good = x0, bad = edge;
for (var it = 0; it < 200 && Math.abs(bad - good) > 1e-13 * scale; it++) {
var mid = (good + bad) / 2;
if (within(mid)) good = mid; else bad = mid;
}
return good;
}
return [side(dom[0]), side(dom[1])];
}
function totalRange(locks) {
var cs = now().curves, lo = 0, hi = 0;
cs.forEach(function (cv) {
var lk = lockOf(locks, cv.name);
if (lk !== null) { var v = clamp(lk, cv.lo, cv.capHi); lo += v; hi += v; } else { lo += cv.lo; hi += cv.capHi; }
});
return { lo: lo, hi: hi };
}

function format(name, culture, opts) {
var ix = colIdx[String(name)], col = ix === undefined ? null : columns[ix];
var mf = col && typeof col === 'object' ? col.modelFormat : null;
if (typeof mf !== 'string' || !mf.trim()) return null;
return d3.llmModelFormat(mf, culture, { intl: opts && typeof opts === 'object' ? opts : null, minus: '-' });
}

var api = {
fit: function (rowsInView) { current = fit(rowsInView); return current; },
at: at,
solve: solve,
loss: loss,
nearBest: nearBest,
domainOf: domainOf,
totalRange: totalRange,
marginalAt: marginalAt,
niceStep: niceStep,
tQuantile: tquantile,
format: format
};
Object.defineProperty(api, 'curves', { enumerable: true, get: function () { return now().curves; } });
Object.defineProperty(api, 'state', { enumerable: true, get: function () { return now(); } });
return api;
};
d3.llmModelFormat = (function () {
var MINUS = '\u2212';
function read(mf) {
if (typeof mf !== 'string' || !mf.trim()) return null;
var sec = mf.split(';')[0];
var sym = (/\[\$([^\-\]]+)/.exec(sec) || [])[1] || '';
var noTok = sec.replace(/\[[^\]]*\]/g, '');
var bare = noTok.replace(/"[^"]*"/g, '').replace(/\\./g, '');
if (!sym) { var cur = /[$\u20AC\u00A3\u00A5]/.exec(noTok); if (cur) sym = cur[0]; }
var pct = bare.indexOf('%') >= 0;
if (!pct && !/[0#]/.test(bare)) return null;
var dm = /\.([0#]+)/.exec(bare), maxD = dm ? dm[1].length : 0, minD = dm ? dm[1].replace(/#/g, '').length : 0;
var plus = /^\s*\+/.test(bare);
var scale = 1, pre = '', suf = '', grouped = bare, lits = [], li = 0;
var marked = noTok.replace(/"([^"]*)"|\\(.)/g, function (m0, quoted, escaped) { lits.push(quoted !== undefined ? quoted : escaped); return '\u0001'; });
var run = /[0#?][0#?,]*(?:\.[0#?]*,*)?/.exec(marked);
var lead = run ? marked.slice(0, run.index) : '', trail = run ? marked.slice(run.index + run[0].length) : '';
if (run && !/[0#?]/.test(lead + trail)) {
var sides = run[0].split('.'), commas = /,*$/.exec(sides[0])[0].length + (sides.length > 1 ? /,*$/.exec(sides[1])[0].length : 0);
for (var c3 = commas; c3 > 0; c3--) scale *= 1000;
grouped = sides[0].replace(/,+$/, '');
var SYMBOLS = /[$\u20AC\u00A3\u00A5]/g;
var textOf = function (s, withLetters) {
return s.replace(/[_*]?[\s\S]/g, function (ch) {
var last = ch.charAt(ch.length - 1), out = last === '\u0001' ? lits[li++] : last;
if (ch.length > 1) return '';
return last === '\u0001' || last === ' ' || (withLetters && /[A-Za-z\u00C0-\uFFFF]/.test(last)) ? out : '';
}).replace(SYMBOLS, '');
};
pre = textOf(lead, false).replace(/^\s+/, '');
suf = textOf(trail, true).replace(/\s+$/, '');
}
return { prefix: pre + sym, symbol: sym, suffix: suf, scale: scale, percent: pct, minDigits: minD, maxDigits: maxD, grouping: grouped.indexOf(',') >= 0, plus: plus };
}
function make(mf, culture, opts) {
var s = read(mf);
if (!s) return null;
opts = opts && typeof opts === 'object' ? opts : {};
var o = s.percent ? { style: 'percent', minimumFractionDigits: s.minDigits, maximumFractionDigits: s.maxDigits }
: { minimumFractionDigits: s.minDigits, maximumFractionDigits: s.maxDigits, useGrouping: s.grouping };
var intl = opts.intl && typeof opts.intl === 'object' ? opts.intl : null;
if (intl) {
if (intl.maximumSignificantDigits !== undefined || intl.notation !== undefined) o = s.percent ? { style: 'percent' } : { useGrouping: s.grouping };
for (var k in intl) if (Object.prototype.hasOwnProperty.call(intl, k)) o[k] = intl[k];
}
var nf;
try { nf = new Intl.NumberFormat(culture || undefined, o); }
catch (e) { try { nf = new Intl.NumberFormat('en', o); } catch (e2) { return null; } }
var minus = typeof opts.minus === 'string' ? opts.minus : MINUS;
var body = function (x) { return nf.format(x / s.scale) + s.suffix; };
return function (v) { v = +v; return v < 0 ? minus + s.prefix + body(-v) : (s.plus && v > 0 ? '+' : '') + s.prefix + body(v); };
}
make.read = read;
return make;
})();
d3.llmFitLabel = function (sel, widthAccessor, opts) {
var TYPE_FLOOR = 10;   // the minimum readable type, px: a string is fitted at no smaller size than a chart may draw it
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
var shrinkTo = opts.shrinkTo == null ? null : +opts.shrinkTo;
var overflow = opts.overflow === 'drop' ? 'drop' : 'truncate';
var sibs = Array.isArray(opts.distinctFrom) ? opts.distinctFrom : null;

if (!sel || typeof sel.each !== 'function') return sel;

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

function measure(node, txt) {
try {
if (typeof node.getComputedTextLength === 'function') {
var w = node.getComputedTextLength();
if (w > 0) return w;
}
} catch (e) { /* fall through */ }
return String(txt).length * fontSizeOf(node) * 0.6;
}

function ownerSvg(node) {
try {
if (node.ownerSVGElement) return node.ownerSVGElement;
for (var p = node.parentNode; p; p = p.parentNode) {
if (p.nodeName && String(p.nodeName).toLowerCase() === 'svg') return p;
}
} catch (e) { /* detached */ }
return null;
}
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
var t = -1;
for (var s = f.length - 1; s >= 1 && t < 0; s--) {
var tl = f.slice(s), alone = true;
for (var o = 0; o < others.length && alone; o++) if (endsWithText(others[o], tl)) alone = false;
if (alone) t = s;
}
if (t < 1) return '';
if (DIGIT.test(f.charAt(t)) && (DIGIT.test(f.charAt(t - 1)) || (t >= 2 && JOIN.test(f.charAt(t - 1)) && DIGIT.test(f.charAt(t - 2))))) {
while (t > 0 && (DIGIT.test(f.charAt(t - 1)) || (t >= 2 && JOIN.test(f.charAt(t - 1)) && DIGIT.test(f.charAt(t - 2))))) t--;
}
if (t < 1) return '';
var ws = t;
while (ws > 0 && !/\s/.test(f.charAt(ws - 1))) ws--;
if (ws > 0 && ws < t && fits(E + f.slice(ws))) t = ws;
else if (!fits(E + f.slice(t))) return '';
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

function fitOne(node, d, i) {
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

if (shrinkTo != null) {
if (node.__llmFullFontSize == null) node.__llmFullFontSize = fontSizeOf(node);
setFontSize(node, node.__llmFullFontSize);
}
node.textContent = full;
var w = measure(node, full);
if (w <= room) return room;                                // fits whole - done

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
var fs = Math.max(shrinkTo, Math.floor((cur * room / wc) * 2) / 2);
for (; fs >= shrinkTo; fs -= 0.5) {
setFontSize(node, fs);
if (measure(node, cands[c]) <= room) { if (c) node.__llmFitFrom = cands[c]; return room; }
}
setFontSize(node, shrinkTo);
if (measure(node, cands[c]) <= room) { if (c) node.__llmFitFrom = cands[c]; return room; }
}
}
if (cands.length > 1) { full = cands[cands.length - 1]; node.__llmFitFrom = full; }
node.textContent = full;
if (overflow === 'drop') { node.textContent = ''; return room; }

var lo = 0, hi = full.length;
while (lo < hi) {
var mid = (lo + hi + 1) >> 1;
node.textContent = full.slice(0, mid) + ell;
if (measure(node, node.textContent) <= room) lo = mid; else hi = mid - 1;
}
lo = numberSafeCut(full, lo);
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
var a = 1, b = full.length;
while (a < b) {
var m = (a + b) >> 1;
node.textContent = ell + full.slice(m);
if (measure(node, node.textContent) <= room) b = m; else a = m + 1;
}
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
d3.llmDisplayName = function (name) {
var s = name === null || name === undefined ? '' : String(name);
if (!s || /\s/.test(s)) return s.trim();
var t = s.replace(/[_]+/g, ' ');
if (/^[a-z0-9]+(?:-+[a-z0-9]+)+$/.test(t)) t = t.replace(/-+/g, ' ');
t = t.trim();
if (t !== s) return t.charAt(0).toUpperCase() + t.slice(1);
var parts = [];
var re = /[a-z][A-Z][a-z]+|[A-Z][a-z][A-Z](?![a-z])|[A-Z]+[0-9]+|[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+[A-Z](?![a-z0-9])|[0-9]+|[^A-Za-z0-9]+/g;
var m;
while ((m = re.exec(s)) !== null) {
if (m[0] === '') { re.lastIndex++; continue; }
parts.push(m[0]);
}
if (parts.length < 2 || parts.join('') !== s) return s;
var out = '';
for (var i = 0; i < parts.length; i++) {
var punct = /^[^A-Za-z0-9]+$/.test(parts[i]), prevPunct = i > 0 && /^[^A-Za-z0-9]+$/.test(parts[i - 1]);
out += i === 0 || punct || prevPunct ? parts[i] : ' ' + parts[i];
}
return out.trim();
};
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
var slot = function (value, n) {
var h = 2166136261, text = String(value);
for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
return h % n;
};
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
  container.replaceChildren();

  var SPEND = 'MarketingSpend';
  var OUTCOME = 'Revenue';
  var CHANNEL = 'Region';
  var PERIOD = 'Year';
  var GRAIN = 'year';
  var MIN_ROWS = 8;
  var NONNEG = true;
  var TOTAL_FROM = '';
  var MEMBER = 'CountryCode';

  var W = options.width, H = options.height;
  var FS = Math.max(TYPE_FLOOR, Math.min(14, Math.min(W, H) / 55));
  var SUB_FS = Math.max(TYPE_FLOOR, FS * 0.9), CAP_FS = Math.max(TYPE_FLOOR, FS * 0.8);
  var fg = options.themeFg || 'currentColor';
  var loc = options.cultureCode || 'en-US';
  var svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  if (options.backgroundColor) {
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', options.backgroundColor).style('pointer-events', 'none');
  }
  var NEEDS = 'Budget allocator needs a spend, an outcome, a channel and a period.';

  function emptyFrame(msg) {
    svg.append('rect').attr('x', 0.5).attr('y', 0.5).attr('width', W - 1).attr('height', H - 1)
      .attr('fill', 'none').attr('stroke', fg).attr('stroke-opacity', 0.25).style('pointer-events', 'none');
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
      .attr('font-size', FS).attr('fill', fg).text(msg);
  }

  var cols = data.columns || [], rows = data.rows || [];
  var idx = function (n) { return data.columns.findIndex(function (c) { return c.name === n; }); };
  var ciRow = idx('__rowIdx__');
  if (idx(SPEND) < 0) throw new Error('INVALID:column "' + SPEND + '" not found');
  if (idx(OUTCOME) < 0) throw new Error('INVALID:column "' + OUTCOME + '" not found');
  if (idx(CHANNEL) < 0) throw new Error('INVALID:column "' + CHANNEL + '" not found');
  if (idx(PERIOD) < 0) throw new Error('INVALID:column "' + PERIOD + '" not found');
  if (idx(MEMBER) < 0) throw new Error('INVALID:column "' + MEMBER + '" not found');
  if (!rows.length) { emptyFrame(options.noDataText || 'No data to display'); return; }
  var SPEND_W = d3.llmDisplayName(SPEND), OUTCOME_W = d3.llmDisplayName(OUTCOME), TOTAL_W = TOTAL_FROM ? d3.llmDisplayName(TOTAL_FROM) : '';
  var rowKey = function (pos) { var r = rows[pos]; return ciRow >= 0 && r && r[ciRow] !== undefined ? r[ciRow] : pos; };

  var nfInt = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  var nfOut = new Intl.NumberFormat(loc, { maximumSignificantDigits: 4 });
  var nfRatio = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
  var nfCompact = new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 });
  var fmtSpend = function (v) { return nfInt.format(v); };
  var fmtOut = function (v) { return nfOut.format(v); };
  var signed = function (v) { return (v < 0 ? '-' : '+') + fmtOut(Math.abs(v)); };
  var tw = function (s, fs) { return String(s == null ? '' : s).length * (+fs > 0 ? +fs : 10) * 0.6; };
  var clampTo = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var showPeriod = function (v) { return v instanceof Date ? v.toISOString().slice(0, 10) : String(v); };

  var R = d3.llmResponseCurves(data, { spend: SPEND, outcome: OUTCOME, channel: CHANNEL, period: PERIOD, member: MEMBER,
    minRows: MIN_ROWS, nonNegative: NONNEG, bounds: 'observed', extend: 1.5, confidence: 0.9, container: container });
  var spendF = R.format(SPEND, loc), outF = R.format(OUTCOME, loc, { maximumSignificantDigits: 4 });
  var spendTick = R.format(SPEND, loc, { notation: 'compact', maximumFractionDigits: 1 });
  var outTick = R.format(OUTCOME, loc, { notation: 'compact', maximumFractionDigits: 1 });
  if (spendF) fmtSpend = spendF;
  if (outF) fmtOut = outF;
  var fit = R.fit(rows);
  var curves = fit.curves, N = curves.length;
  if (!N) { emptyFrame(options.noDataText || 'No data to display'); return; }
  var divide = N >= 2;
  var conf = fit.confidence, confPct = Math.round(conf * 100) + '%';

  var channelColour = d3.llmThemeColors(options).categories(curves.map(function (cv) { return cv.name; }));
  var chan = curves.map(function (cv, i) { return { cv: cv, i: i, name: cv.name, color: channelColour(cv.name) }; });
  var viewPts = null;
  if (fit.stale) {
    var inView = d3.llmResponseCurves(data, { spend: SPEND, outcome: OUTCOME, channel: CHANNEL, period: PERIOD, member: MEMBER,
      minRows: 1, nonNegative: NONNEG, bounds: 'observed', extend: 1.5, confidence: 0.9 }).fit(rows);
    viewPts = {};
    inView.curves.forEach(function (cv) { viewPts[cv.name] = cv.points; });
  }
  var ptsOf = function (c) { return viewPts ? (viewPts[c.name] || []) : c.cv.points; };

  var tr = fit.totalRange;
  var curSpends = fit.current.spends, curTotal = 0;
  curSpends.forEach(function (s) { curTotal += s; });
  var total0 = clampTo(curTotal > 0 ? curTotal : (tr.lo + tr.hi) / 2, tr.lo, tr.hi);
  var paramVal = null, paramNote = '';
  var ciParam = TOTAL_FROM ? idx(TOTAL_FROM) : -1;
  if (ciParam >= 0) {
    var seen = [];
    rows.forEach(function (r) { var v = +r[ciParam]; if (isFinite(v) && seen.indexOf(v) < 0) seen.push(v); });
    if (seen.length === 1) paramVal = seen[0];
    else paramNote = TOTAL_W + ' no longer holds one value, so the strip sets the total';
  }
  var ownsTotal = paramVal !== null;

  var uiState = options.uiState && typeof options.uiState === 'object' ? options.uiState : {};
  var uiKnobs = uiState.knobs && typeof uiState.knobs === 'object' ? uiState.knobs : {};
  if (!container.__lchKnobs || typeof container.__lchKnobs !== 'object') container.__lchKnobs = {};
  var bag = container.__lchKnobs;
  var copyLocks = function (l) { var o = {}; Object.keys(l).forEach(function (k) { o[k] = l[k]; }); return o; };
  function sanitizeLocks(raw, totalNow) {
    var out = {}, sum = 0;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    chan.forEach(function (c) {
      if (!Object.prototype.hasOwnProperty.call(raw, c.name)) return;
      var v = raw[c.name];
      if (typeof v !== 'number' || !isFinite(v) || v < c.cv.lo || v > c.cv.hi) return;
      out[c.name] = v; sum += v;
    });
    return sum > totalNow * (1 + 1e-9) ? {} : out;
  }
  var total = ownsTotal ? paramVal : total0;
  var locks = {};
  bag.locks = {};
  var busy = false;
  var dragging = null;

  var PAD = FS * 0.8;
  var TITLE_H = FS * 1.9;
  svg.append('text').attr('class', 'chart-title').attr('x', PAD).attr('y', FS * 1.3).attr('font-size', Math.max(14, FS * 1.1))
    .attr('font-weight', 600).attr('fill', fg).text('Regional Budget Split by Diminishing Returns');
  d3.llmFitLabel(svg.select('text.chart-title'), W - 2 * PAD, { text: 'Regional Budget Split by Diminishing Returns' });
  var STRIP_Y = Math.max(FS * 1.5, 14) + TITLE_H;
  var READ_Y = STRIP_Y + FS * 2.1;
  var READ_LINE = SUB_FS * 1.4;
  var multiples = N > 6 || (N > 1 && d3.max(curves, function (c) { return c.hi; }) / Math.max(1e-9, d3.min(curves, function (c) { return c.hi; })) > 20);

  var groupBy = {};
  curves.forEach(function (cv) {
    var key = cv.verdict;
    (groupBy[key] = groupBy[key] || []).push(cv);
  });
  var capParts = [];
  var say = function (rank, forms) { capParts.push({ rank: rank, forms: forms, at: 0 }); };
  var byMember = !!fit.member;
  var MEMBER_W = byMember ? d3.llmDisplayName(fit.member) : '';
  var unitRows = byMember ? MEMBER_W + '-by-' + GRAIN + ' rows' : GRAIN + 's';
  var unitShort = byMember ? MEMBER_W + '-' + GRAIN + 's' : GRAIN + 's';
  var lastPeriod = showPeriod(fit.periods[fit.periods.length - 1]);
  var summed = chan.some(function (c) { return ptsOf(c).some(function (p) { return p.rows.length > 1; }); });
  var FIT_HEAD = 'Fitted and estimated per channel: ' + OUTCOME_W + ' = c + V x / (K + x) on ' + SPEND_W + ', from ' + fit.rarest + ' ';
  say(5, [FIT_HEAD + unitRows + ' for the rarest channel'
    + (byMember ? ', each ' + MEMBER_W + ' on its own baseline and straight trend with a response in proportion to its typical ' + OUTCOME_W + ', a channel\'s budget taken as split in proportion to its ' + MEMBER_W + ' typical spends, every curve read at ' + lastPeriod + ' and each point that ' + GRAIN + '\'s total moved there by those trends; one row is one ' + GRAIN + ' of one ' + MEMBER_W
      : '; one row is one ' + GRAIN + ' of one channel' + (summed ? ', and rows finer than that were summed to it' : '')) + '.',
    FIT_HEAD + unitRows + ' for the rarest channel' + (byMember ? '; each ' + MEMBER_W + ' has its own baseline, straight trend and response in proportion to its size, every curve read at ' + lastPeriod
      : summed ? '; finer rows were summed to one ' + GRAIN : '') + '.',
    FIT_HEAD + unitShort + ' for the rarest channel' + (byMember ? ', each ' + MEMBER_W + ' on its own trend' : '') + '.']);
  if (options.dataComplete === false) {
    var leftOut = options.rowsWithheld > 0 ? ' (' + nfInt.format(options.rowsWithheld) + ' left out)' : '';
    say(9, ['Rows were cut before they reached this chart' + leftOut + ', so every fitted curve reflects only part of the ' + GRAIN + 's.',
      'Rows were cut before this chart' + leftOut + ': the curves reflect part of the ' + GRAIN + 's.']);
  }
  if (fit.stale) say(9, ['These curves are from the last complete set of rows: fewer than ' + fit.floor + ' ' + unitRows + ' per channel are in view now.',
    'Curves from the last complete rows: under ' + fit.floor + ' ' + unitShort + ' per channel in view.']);
  else if (fit.belowFloor) say(9, ['Fewer than ' + fit.floor + ' ' + unitRows + ' for the rarest channel: every channel is read as a straight line.',
    'Under ' + fit.floor + ' ' + unitShort + ' for the rarest channel: all read straight.']);
  (fit.notes || []).forEach(function (n) { if (!fit.belowFloor || n.indexOf('fewer than') !== 0) say(8, [n + '.']); });
  if (fit.current.absent.length) say(7, [fit.current.absent.join(', ') + ' had no spend in the latest ' + GRAIN + ', counted as 0 in the current split.',
    fit.current.absent.join(', ') + ': no spend in the latest ' + GRAIN + ', counted as 0.']);
  Object.keys(groupBy).forEach(function (verdict) {
    var members = groupBy[verdict];
    var text = members.map(function (c) { return c.name; }).join(', ') + ': ';
    var extras = [], extrasShort = [];
    members.forEach(function (c) {
      if (c.narrow && isFinite(c.span)) { extras.push(c.name + "'s spend varied only " + nfRatio.format(c.span) + 'x, too narrow to see a curve'); extrasShort.push(c.name + ' varied ' + nfRatio.format(c.span) + 'x, too narrow'); }
      else if (c.narrow) { extras.push(c.name + "'s spend barely varied, too narrow to see a curve"); extrasShort.push(c.name + ' barely varied'); }
    });
    var paren = function (x) { return x.length ? ' (' + x.join('; ') + ')' : ''; };
    say(7, [text + verdict + paren(extras) + '.', text + verdict + paren(extrasShort) + '.', text + verdict.replace(/ (shown|in this data)$/, '') + paren(extrasShort) + '.']);
  });
  curves.forEach(function (cv) {
    if (cv.confound) say(6, byMember
      ? [cv.name + ' spend ' + cv.confound.direction + ' steadily over time in its ' + MEMBER_W + 's\' own years, so its curve and their trends are hard to tell apart.',
        cv.name + ' spend ' + cv.confound.direction + ' with its ' + MEMBER_W + 's\' years: its curve and their trends are hard to tell apart.']
      : [cv.name + ' spend ' + cv.confound.direction + ' steadily over time; its curve may reflect the trend rather than the spend.',
        cv.name + ' spend ' + cv.confound.direction + ' over time: its curve may be the trend.']);
  });
  say(3, ['The band is the range of the average ' + OUTCOME_W + ' at ' + confPct + '; a curve is dashed past the spend a channel has tried, and a split gives a channel that shows diminishing returns at most 1.5x the most it has spent (the dashed stretch, where the band widens); a straight channel stays within what it has spent.',
    'The band is the average ' + OUTCOME_W + ' at ' + confPct + '; dashed is past the spend tried, where a split goes up to 1.5x on a curve and never on a straight line.',
    'Band: ' + confPct + ' range of the average ' + OUTCOME_W + '; dashed: untried spend, up to 1.5x on a curve.']);
  var ASSOC = 'These are associations in past ' + GRAIN + 's';
  say(4, [ASSOC + ': ' + (byMember ? 'one ' + MEMBER_W + ' in one ' + GRAIN : 'a ' + GRAIN) + ' is one observation, and ' + (byMember ? 'each ' + MEMBER_W + '\'s trend is a straight line and seasonality is not modeled.' : 'trend and seasonality are not modeled.'),
    ASSOC + (byMember ? '; ' + MEMBER_W + ' trends are straight lines and seasonality is not modeled.' : '; trend and seasonality are not modeled.'),
    ASSOC + (byMember ? '; no seasonality.' : '; no trend or seasonality.')]);
  if (curves.some(function (cv) { return cv.isLine; })) say(2, ['A channel that reads straight is drawn straight, so the solver gives it its whole observed range or nothing above its lowest spend.',
    'A split gives a straight channel its whole observed range or its lowest spend.', 'A split gives a straight channel all of its range or none.']);
  var roleCols = [SPEND, OUTCOME, CHANNEL, PERIOD, TOTAL_FROM, MEMBER];
  var unusedCols = cols.filter(function (c) { return c.name !== '__rowIdx__' && c.name.indexOf('__geo') !== 0 && roleCols.indexOf(c.name) < 0; })
    .map(function (c) { return c.name; });
  if (unusedCols.length) say(8, ['Not used: ' + unusedCols.map(function (n) { return d3.llmDisplayName(n); }).join(', ') + '.']);
  if (paramNote) say(9, [paramNote + '.']);
  var staticCaption = capParts.map(function (p) { return p.forms[0]; }).join(' ');
  var CAP_LINE = CAP_FS * 1.25, CAP_ROOM = W - 2 * PAD;
  var wordW = {}, spaceW = null;
  function capW(s) {
    var t = svg.append('text').attr('font-size', CAP_FS).text(s), n = t.node();
    var w = n && n.getComputedTextLength ? n.getComputedTextLength() : 0;
    t.remove();
    return w > 0 ? w : tw(s, CAP_FS);
  }
  function wrap(text, maxW) {
    if (spaceW === null) spaceW = Math.max(capW('x x') - 2 * capW('x'), CAP_FS * 0.2);
    var lines = [], line = '', lw = 0;
    String(text).split(/\s+/).filter(Boolean).forEach(function (w) {
      var ww = wordW[w] !== undefined ? wordW[w] : (wordW[w] = capW(w));
      if (!line) { line = w; lw = ww; }
      else if (lw + spaceW + ww > maxW * 0.98) { lines.push(line); line = w; lw = ww; }
      else { line += ' ' + w; lw += spaceW + ww; }
    });
    if (line) lines.push(line);
    return lines;
  }
  var capNow = function () { return capParts.map(function (p) { return p.forms[p.at]; }).join(' '); };
  function capFit(lines) {
    capParts.forEach(function (p) { p.at = 0; });
    var order = capParts.slice().sort(function (a, b) { return a.rank - b.rank; });
    var out = wrap(capNow(), CAP_ROOM);
    for (var lvl = 1; lvl <= 2 && out.length > lines; lvl++) {
      order.forEach(function (p) {
        if (out.length > lines && p.forms.length > lvl) { p.at = lvl; out = wrap(capNow(), CAP_ROOM); }
      });
    }
    return out;
  }
  function noteText(p, form) {
    var parts = [];
    if (p.clamped) parts.push((form ? 'Total kept within the channels\' range: ' : 'The total was kept inside the range the channels have spent: ')
      + fmtSpend(p.feasible.lo) + ' to ' + fmtSpend(p.feasible.hi) + '.');
    p.notes.forEach(function (n) { if (n) parts.push(form && /^the rising channels are full/.test(n) ? 'Rising channels full: the rest went to the falling ones.' : n); });
    return parts.join(' ');
  }
  var hiAll = 0;
  curves.forEach(function (cv) { hiAll += cv.capHi || cv.hi; });
  var canFall = curves.some(function (cv) { return cv.isLine && !(cv.b > 0); });
  var noteLines = divide ? Math.max(1, wrap(noteText({ clamped: true, feasible: { lo: hiAll, hi: hiAll }, notes: canFall ? ['the rising channels are full'] : [] }, 1), CAP_ROOM).length) : 0;
  var prefLines = clampTo(Math.floor((H * 0.16) / CAP_LINE), 2, 6);
  var capShown = capFit(prefLines);
  var capCut = false;
  var MARG_H = divide ? Math.max(FS * 4.8, Math.min(H * 0.15, FS * 8)) : 0;
  var spendShort = spendTick || function (v) { return nfCompact.format(v); };
  var KEY_SW = FS * 1.2, KEY_GAP = FS * 1.1, KEY_LINE = SUB_FS * 1.45, keyCols = 1, keyRows = 1, keyCellW = W - 2 * PAD;
  if (divide && !multiples) {
    var keyAvail = W - 2 * PAD;
    var hiSum = 0;
    curves.forEach(function (cv) { hiSum += cv.hi; });
    var spendWide = Math.max(tw(spendShort(total), SUB_FS), tw(spendShort(hiSum * 1.5), SUB_FS));
    var keyNeed = d3.max(chan, function (c) { return KEY_SW + tw(c.name + ' ', SUB_FS) + spendWide; });
    var keyNeedRange = keyNeed + tw(' (near-best  to )', SUB_FS) + 2 * spendWide;
    var colsFor = function (need) { return Math.min(N, Math.floor((keyAvail + KEY_GAP) / (need + KEY_GAP))); };
    keyCols = colsFor(keyNeedRange) >= Math.ceil(N / 3) ? colsFor(keyNeedRange) : Math.max(Math.ceil(N / 3), colsFor(keyNeed));
    keyCols = Math.max(1, Math.min(N, keyCols));
    keyRows = Math.ceil(N / keyCols);
    keyCellW = (keyAvail - KEY_GAP * (keyCols - 1)) / keyCols;
  }
  var legendRow = (divide && !multiples) ? FS * 1.7 + (keyRows - 1) * KEY_LINE : 0;
  var LEGEND_Y = READ_Y + 2 * READ_LINE + FS * 1.3;
  var PLOT_TOP = READ_Y + 2 * READ_LINE + FS * 0.9 + legendRow;
  var LANE = 5;
  var laneH = divide ? (multiples ? LANE : N * LANE) : 0;
  var AXIS_H = laneH + FS * 3.6;
  var spareLine = true;
  var panelRows = multiples ? Math.ceil(N / Math.min(N, Math.max(2, Math.round(Math.sqrt(N * (W - 2 * PAD)
    / Math.max(1, H - (capShown.length + noteLines) * CAP_LINE - MARG_H - PAD * 0.5 - PLOT_TOP - FS * 1.5)))))) : 1;
  var plotNeed = PLOT_TOP + (multiples ? FS * 1.5 + panelRows * (FS * 1.6 + FS * 1.5 + LANE + 2 + FS * 3) : FS * 6 + AXIS_H);
  var bottomFor = function () { return H - (capShown.length + noteLines) * CAP_LINE - MARG_H - PAD * 0.5; };
  var roomLines = function () { return Math.floor((H - MARG_H - PAD * 0.5 - plotNeed) / CAP_LINE) - noteLines; };
  if (capShown.length > prefLines) {
    var capMin = capFit(0).length;
    if (capMin > roomLines() && MARG_H > FS * 4.8) MARG_H = FS * 4.8;
    if (capMin > roomLines()) MARG_H = 0;
    capShown = capFit(Math.max(prefLines, capMin));
  }
  if (bottomFor() < plotNeed) {
    spareLine = false;
    noteLines = Math.min(noteLines, 1);
    while (bottomFor() < plotNeed && capShown.length > 1) { capShown = capShown.slice(0, capShown.length - 1); capCut = true; }
    if (bottomFor() < plotNeed) noteLines = 0;
    if (bottomFor() < plotNeed) MARG_H = 0;
  }
  var CAP_H = (capShown.length + noteLines) * CAP_LINE;
  var PLOT_BOTTOM = bottomFor();

  var xMax = d3.max(curves, function (c) { return c.capHi || c.hi; }) * 1.06;
  var yLo = Infinity, yHi = -Infinity;
  chan.forEach(function (c) {
    ptsOf(c).forEach(function (pt) { yLo = Math.min(yLo, pt.y); yHi = Math.max(yHi, pt.y); });
    for (var s = 0; s <= 24; s++) {
      var a = R.at(c.i, c.cv.lo + (c.cv.hi - c.cv.lo) * s / 24);
      yLo = Math.min(yLo, a.lo); yHi = Math.max(yHi, a.hi);
    }
  });
  yLo = NONNEG ? 0 : Math.min(yLo, 0);
  yHi = yLo + (yHi - yLo) * 1.06;
  if (!(yHi > yLo)) yHi = yLo + 1;
  if (!(xMax > 0)) xMax = 1;
  var panels = [];
  var Y_AXIS_W = FS * 4.6;
  if (!multiples) {
    panels.push({ x0: PAD + Y_AXIS_W, y0: PLOT_TOP, w: W - 2 * PAD - Y_AXIS_W, h: Math.max(FS * 6, PLOT_BOTTOM - PLOT_TOP - AXIS_H), idxs: chan.map(function (c) { return c.i; }) });
  } else {
    var areaW = W - 2 * PAD, areaH = PLOT_BOTTOM - PLOT_TOP - FS * 1.5;
    var pcols = Math.min(N, Math.max(2, Math.round(Math.sqrt(N * areaW / Math.max(1, areaH)))));
    var prows = Math.ceil(N / pcols);
    var gapX = FS * 0.8, titleBand = FS * 1.6, belowBand = FS * 1.5 + LANE + 2;
    var pw = (areaW - gapX * (pcols - 1)) / pcols, cellH = areaH / prows, ph = cellH - titleBand - belowBand;
    chan.forEach(function (c, k) {
      panels.push({ x0: PAD + (k % pcols) * (pw + gapX) + Y_AXIS_W * 0.55, y0: PLOT_TOP + Math.floor(k / pcols) * cellH + titleBand, w: pw - Y_AXIS_W * 0.55, h: Math.max(FS * 3, ph), idxs: [c.i] });
    });
  }
  var panelOf = {};
  panels.forEach(function (p) { p.idxs.forEach(function (i) { panelOf[i] = p; }); });
  panels.forEach(function (p) { p.sx = d3.scaleLinear().domain([0, xMax]).range([0, p.w]); p.sy = d3.scaleLinear().domain([yLo, yHi]).range([p.h, 0]); });
  var X = function (i, v) { var p = panelOf[i]; return p.x0 + p.sx(v); };
  var Y = function (i, v) { var p = panelOf[i]; return p.y0 + p.sy(v); };

  var strip = svg.append('g').attr('class', 'lch-knobs');
  var readouts = svg.append('g').attr('class', 'lch-readouts');
  var plot = svg.append('g').attr('class', 'lch-curves');
  var marginal = svg.append('g').attr('class', 'lch-marginal');
  var capG = svg.append('g').attr('class', 'lch-caption');
  var clipId = 'lch-clip-' + (container.__lchClipSeq = (container.__lchClipSeq || 0) + 1);

  var readoutText = [0, 1, 2].map(function (k) {
    return readouts.append('text').attr('class', 'lch-readout').attr('x', PAD).attr('y', READ_Y + k * READ_LINE).attr('font-size', SUB_FS).attr('fill', fg);
  });
  var readoutW = W - 2 * PAD;

  var keyText = {};
  if (divide && !multiples) {
    chan.forEach(function (c, k) {
      var rowsOf = [];
      ptsOf(c).forEach(function (p) { p.rows.forEach(function (pos) { rowsOf.push(rowKey(pos)); }); });
      var kx = PAD + (k % keyCols) * (keyCellW + KEY_GAP), ky = LEGEND_Y + Math.floor(k / keyCols) * KEY_LINE;
      var lg = plot.append('g').attr('class', 'lch-legend');
      lg.append('rect').attr('class', 'd3-legend-mark').attr('data-row-idx', rowsOf.join(',')).attr('data-channel', c.name)
        .attr('x', kx).attr('y', ky - FS * 0.8).attr('width', FS * 0.9).attr('height', FS * 0.9).attr('rx', 2).attr('fill', c.color).style('cursor', 'pointer');
      keyText[c.name] = lg.append('text').attr('class', 'lch-spend').attr('data-channel', c.name).attr('x', kx + KEY_SW).attr('y', ky)
        .attr('font-size', SUB_FS).attr('fill', fg).text(c.name);
      keyText[c.name].room = keyCellW - KEY_SW;
    });
  }
  function nameHeads(c) {
    var words = c.name.split(/\s+/), out = [];
    for (var n = words.length - 1; n >= 1; n--) {
      var head = words.slice(0, n).join(' ');
      if (/\w$/.test(head) && !chan.some(function (o) { return o !== c && o.name.indexOf(head) === 0; })) out.push(head + '\u2026');
    }
    return out;
  }
  function fitTitle(p, used) {
    p.titleForms.some(function (form) {
      d3.llmFitLabel(p.title, Math.max(0, p.titleRoom - used), { pad: 0, text: form, overflow: 'drop' });
      return p.title.text() !== '';
    });
    p.title.selectAll('title').remove();
    p.title.append('title').text(p.titleTip);
  }

  panels.forEach(function (p, k) {
    var g = plot.append('g').attr('class', 'lch-panel');
    g.append('clipPath').attr('id', clipId + '-' + k).append('rect').attr('x', p.x0).attr('y', p.y0).attr('width', p.w).attr('height', p.h);
    var xAxis = d3.axisBottom(p.sx).ticks(Math.max(2, Math.floor(p.w / (FS * 7)))).tickFormat(function (v) { return spendTick ? spendTick(v) : nfCompact.format(v); }).tickSizeOuter(0);
    var yAxis = d3.axisLeft(p.sy).ticks(Math.max(2, Math.floor(p.h / (FS * 3)))).tickFormat(function (v) { return outTick ? outTick(v) : nfCompact.format(v); }).tickSizeOuter(0);
    var gx = g.append('g').attr('class', 'lch-axis lch-axis-x').attr('transform', 'translate(' + p.x0 + ',' + (p.y0 + p.h) + ')').call(xAxis);
    var gy = g.append('g').attr('class', 'lch-axis lch-axis-y').attr('transform', 'translate(' + p.x0 + ',' + p.y0 + ')').call(yAxis);
    [gx, gy].forEach(function (ga) {
      ga.selectAll('text').attr('font-size', CAP_FS).attr('fill', fg);
      ga.selectAll('path,line').attr('stroke', fg).attr('stroke-opacity', 0.5);
    });
    gx.selectAll('text').attr('y', laneH + 4 + CAP_FS * 0.9).attr('dy', null);
    gx.selectAll('.tick line').attr('y2', 3);
    if (k === 0) {
      g.append('text').attr('class', 'lch-axis-title').attr('x', multiples ? W / 2 : p.x0 + p.w / 2).attr('y', multiples ? PLOT_BOTTOM - FS * 0.35 : p.y0 + p.h + laneH + 6 + CAP_FS * 2.6)
        .attr('text-anchor', 'middle').attr('font-size', CAP_FS).attr('fill', fg).attr('fill-opacity', 0.8)
        .text(SPEND_W + ' per ' + GRAIN + (multiples ? ' (vertical: ' + OUTCOME_W + ' per ' + GRAIN + ')' : ''));
    }
    if (!multiples) {
      g.append('text').attr('class', 'lch-axis-title').attr('transform', 'translate(' + (PAD + CAP_FS * 0.6) + ',' + (p.y0 + p.h / 2) + ') rotate(-90)')
        .attr('text-anchor', 'middle').attr('font-size', CAP_FS).attr('fill', fg).attr('fill-opacity', 0.8).text(OUTCOME_W + ' per ' + GRAIN);
    }
    if (multiples) {
      var c1 = chan[p.idxs[0]];
      var ptitle = g.append('text').attr('class', 'lch-panel-title').attr('x', p.x0).attr('y', p.y0 - FS * 0.45).attr('font-size', SUB_FS).attr('fill', fg)
        .attr('font-weight', 600);
      p.title = ptitle;
      p.titleForms = [c1.name + (c1.cv.curved ? '' : ' (straight)'), c1.name].concat(nameHeads(c1));
      p.titleTip = c1.name + (c1.cv.curved ? ' (diminishing returns shown)' : ' (straight in this data)');
      p.titleRoom = Math.min(p.w + Y_AXIS_W * 0.4, W - PAD - p.x0);
      fitTitle(p, 0);
      keyText[c1.name] = g.append('text').attr('class', 'lch-spend').attr('data-channel', c1.name).attr('text-anchor', 'end')
        .attr('x', p.x0 + p.titleRoom).attr('y', p.y0 - FS * 0.45).attr('font-size', SUB_FS).attr('fill', fg);
      keyText[c1.name].panel = p;
    }
    var body = g.append('g').attr('clip-path', 'url(#' + clipId + '-' + k + ')');
    p.idxs.forEach(function (i) {
      var c = chan[i], cv = c.cv;
      var xs = [];
      var steps = 72;
      for (var s = 0; s <= steps; s++) xs.push(xMax * s / steps);
      var lineGen = d3.line().x(function (x) { return X(i, x); }).y(function (x) { return Y(i, R.at(i, x).mean); });
      var drawSeg = function (from, to, dashed) {
        if (!(to > from)) return;
        var pts = [from].concat(xs.filter(function (x) { return x > from && x < to; })).concat([to]);
        body.append('path').attr('class', 'lch-curve' + (dashed ? ' lch-curve-extrapolated' : ''))
          .attr('data-channel', c.name).attr('data-shape', cv.isLine ? 'line' : 'curve').attr('d', lineGen(pts))
          .attr('fill', 'none').attr('stroke', c.color).attr('stroke-width', dashed ? 1 : 2).attr('stroke-opacity', dashed ? 0.45 : 1)
          .attr('stroke-dasharray', dashed ? '4 3' : null).style('pointer-events', 'none');
      };
      var bandPts = [];
      for (var b = 0; b <= 48; b++) bandPts.push(cv.lo + (cv.hi - cv.lo) * b / 48);
      body.append('path').attr('class', 'lch-band').attr('data-channel', c.name)
        .attr('d', d3.area().x(function (x) { return X(i, x); }).y0(function (x) { return Y(i, R.at(i, x).lo); }).y1(function (x) { return Y(i, R.at(i, x).hi); })(bandPts))
        .attr('fill', c.color).attr('fill-opacity', 0.16).attr('stroke', 'none').style('pointer-events', 'none');
      drawSeg(0, cv.lo, true);
      drawSeg(cv.lo, cv.hi, false);
      drawSeg(cv.hi, xMax, true);
      ptsOf(c).forEach(function (pt) {
        var keys = pt.rows.map(rowKey);
        body.append('circle').attr('class', 'd3-mark').attr('data-row-idx', keys.join(',')).attr('data-channel', c.name)
          .attr('cx', X(i, pt.x)).attr('cy', Y(i, pt.y)).attr('r', Math.max(2.2, FS * 0.28))
          .attr('fill', c.color).attr('fill-opacity', 0.7).style('cursor', 'pointer')
          .append('title').text(c.name + ', ' + showPeriod(pt.period) + ': ' + SPEND_W + ' ' + fmtSpend(pt.x) + ', ' + OUTCOME_W + ' ' + fmtOut(pt.yObserved !== undefined ? pt.yObserved : pt.y)
            + (pt.yObserved !== undefined && pt.yObserved !== pt.y ? ' (' + fmtOut(pt.y) + ' moved to the latest ' + GRAIN + ' by its trends)' : ''));
      });
      if (curSpends[i] > 0) {
        body.append('circle').attr('class', 'lch-current').attr('data-channel', c.name)
          .attr('cx', X(i, curSpends[i])).attr('cy', Y(i, R.at(i, curSpends[i]).mean)).attr('r', Math.max(4, FS * 0.5))
          .attr('fill', 'none').attr('stroke', c.color).attr('stroke-width', 1.8)
          .append('title').text(c.name + ' current spend ' + fmtSpend(curSpends[i]) + ' (' + showPeriod(fit.current.period) + ')');
      }
    });
    p.dyn = g.append('g').attr('class', 'lch-plot-live').attr('clip-path', 'url(#' + clipId + '-' + k + ')').style('pointer-events', 'none');
    p.lanes = g.append('g').attr('class', 'lch-nearbest');
  });

  var dotLayer = svg.append('g').attr('class', 'lch-dots');
  var lockLayer = svg.append('g').attr('class', 'lch-locks');

  var plan = null, best = null, dotsBuilt = false;
  var dots = {};
  var placed = {};
  function persistLocks() {
    bag.locks = copyLocks(locks);
    if (typeof options.setUiState !== 'function') return;
    var live = container.__lchUiLiveOpts === options && container.__lchUiLiveSeed === options.uiState ? container.__lchUiLive : null;
    var base = live || uiState, next = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
    next.knobs = {};
    for (k in bag) if (Object.prototype.hasOwnProperty.call(bag, k)) next.knobs[k] = bag[k];
    container.__lchUiLive = next; container.__lchUiLiveOpts = options; container.__lchUiLiveSeed = options.uiState;
    try { options.setUiState(next); } catch (e) { /* persistence is advisory */ }
  }
  function report(control, key, value) {
    if (typeof options.onControlChange !== 'function') return;
    try { options.onControlChange({ control: control, key: key, value: String(value) }); } catch (e) { /* advisory */ }
  }
  function unlock(name) {
    delete locks[name];
    persistLocks();
    report('lock', 'dot:' + name, 'released');
    solveAndPaint();
  }

  function solveAndPaint() {
    if (!divide) { paintReadouts(null, null, null); return; }
    plan = R.solve(total, locks);
    best = Object.keys(locks).length ? R.solve(total, {}) : plan;
    positionDots();
    paintLive();
    paintReadouts(plan, best, R.loss(curSpends, best.spends));
  }

  function positionDots() {
    if (!dotsBuilt) return;
    busy = true;
    try {
      chan.forEach(function (c) {
        var d = dots[c.name];
        if (!d || (dragging === c.name)) return;
        var dom = R.domainOf(c.i, total, locks);
        if (dom) d.domain(dom);
        var want = dom ? clampTo(plan.spends[c.i], dom[0], dom[1]) : plan.spends[c.i];
        d.set(want, false);
        placed[c.name] = d.value();
        d.refresh();
      });
    } finally { busy = false; }
  }

  function lockGlyph(c, cx, cy) {
    var g = lockLayer.append('g').attr('class', 'lch-lock lch-control').attr('aria-label', 'Release ' + c.name).attr('data-channel', c.name).attr('cursor', 'pointer')
      .on('click', function () { unlock(c.name); });
    var s = Math.max(10, FS * 0.9);
    g.append('rect').attr('x', cx - 12).attr('y', cy - 12).attr('width', 24).attr('height', 24).attr('fill', 'transparent');
    g.append('path').attr('d', 'M' + (cx - s * 0.28) + ',' + (cy - s * 0.05) + ' v' + (-s * 0.25) + ' a' + (s * 0.28) + ',' + (s * 0.28) + ' 0 0 1 ' + (s * 0.56) + ',0 v' + (s * 0.25))
      .attr('fill', 'none').attr('stroke', fg).attr('stroke-width', 1.4);
    g.append('rect').attr('x', cx - s * 0.4).attr('y', cy - s * 0.05).attr('width', s * 0.8).attr('height', s * 0.6).attr('rx', 1.5).attr('fill', fg).attr('fill-opacity', 0.85);
    g.append('title').text(c.name + ' is held at ' + fmtSpend(locks[c.name]) + ' - click to let the solver move it');
  }

  function paintSpend(c, x, nb) {
    var t = keyText[c.name];
    if (!t) return;
    var s = spendShort(x), held = plan.binding[c.i] === 'locked';
    var range = nb && nb[1] - nb[0] >= 1e-6 ? ' (near-best ' + spendShort(nb[0]) + ' to ' + spendShort(nb[1]) + ')' : '';
    var forms = [];
    if (t.panel) forms.push(s + range, s);
    else {
      forms.push(c.name + ' ' + s + range, c.name + ' ' + s);
      nameHeads(c).forEach(function (h) { forms.push(h + ' ' + s); });
      forms.push(s);
    }
    if (!t.panel) forms.some(function (f) { d3.llmFitLabel(t, t.room, { pad: 0, text: f, overflow: 'drop' }); return t.text() !== ''; });
    else {
      var p = t.panel, combos = [];
      forms.forEach(function (f) { p.titleForms.forEach(function (tf) { combos.push([tf, f]); }); });
      combos.push([p.titleForms[p.titleForms.length - 1], '']);
      combos.some(function (cb) {
        t.text(cb[1]);
        var used = cb[1] ? (t.node().getComputedTextLength ? t.node().getComputedTextLength() : tw(cb[1], SUB_FS)) + FS * 0.6 : 0;
        if (used > p.titleRoom) return false;
        d3.llmFitLabel(p.title, p.titleRoom - used, { pad: 0, text: cb[0], overflow: 'drop' });
        return p.title.text() !== '';
      });
      p.title.selectAll('title').remove();
      p.title.append('title').text(p.titleTip);
    }
    t.selectAll('title').remove();
    t.append('title').text(c.name + (held ? ' (held)' : '') + ': ' + SPEND_W + ' ' + fmtSpend(x) + ' per ' + GRAIN
      + (nb ? ', near-best ' + fmtSpend(nb[0]) + ' to ' + fmtSpend(nb[1]) : ''));
  }

  function paintLive() {
    panels.forEach(function (p) { p.dyn.selectAll('*').remove(); p.lanes.selectAll('*').remove(); });
    lockLayer.selectAll('*').remove();
    marginal.selectAll('*').remove();
    var step = R.niceStep(plan.total);
    chan.forEach(function (c) {
      var i = c.i, p = panelOf[i], x = plan.spends[i];
      var a = R.at(i, x);
      var kx = p.w / xMax, ky = p.h / (yHi - yLo);
      var slope = -a.marginal * ky / kx;
      var L = Math.min(p.w * 0.3, Math.max(p.h * 0.5, p.w * 0.12)), dx = L / Math.sqrt(1 + slope * slope);
      var px = X(i, x), py = Y(i, a.mean);
      p.dyn.append('line').attr('class', 'lch-tangent').attr('data-channel', c.name).attr('data-binding', plan.binding[i]).attr('data-marginal', a.marginal)
        .attr('x1', px - dx).attr('y1', py - slope * dx).attr('x2', px + dx).attr('y2', py + slope * dx)
        .attr('stroke', c.color).attr('stroke-width', 1.6).attr('stroke-dasharray', '7 3');
      var nb = R.nearBest(i, total, locks);
      if (nb) {
        var laneY = p.y0 + p.h + 2 + (multiples ? 0 : i * LANE);
        p.lanes.append('rect').attr('class', 'lch-nearbest-bar').attr('data-channel', c.name).attr('data-from', nb[0]).attr('data-to', nb[1])
          .attr('x', p.x0 + p.sx(nb[0])).attr('width', Math.max(2, p.sx(nb[1]) - p.sx(nb[0]))).attr('y', laneY).attr('height', LANE - 1)
          .attr('fill', c.color).attr('fill-opacity', 0.85)
          .append('title').text(c.name + ' near-best range: ' + fmtSpend(nb[0]) + ' to ' + fmtSpend(nb[1])
            + (nb[1] - nb[0] < 1e-6 ? ' (held at a bound of its own range)' : ' (the loss stays inside its own interval)'));
      }
      if (plan.binding[i] === 'locked') lockGlyph(c, px + FS * 1.0, py - FS * 1.0);
      var dg = dots[c.name] && dots[c.name].g;
      if (dg) dg.attr('data-channel', c.name).attr('data-spend', x).attr('data-binding', plan.binding[i]).attr('data-mean', a.mean).attr('data-lo', a.lo).attr('data-hi', a.hi).attr('data-marginal', a.marginal);
      paintSpend(c, x, nb);
    });
    if (MARG_H > 0) {
      var mTop = PLOT_BOTTOM, mBottom = PLOT_BOTTOM + MARG_H;
      var mx0 = PAD + Y_AXIS_W * 0.4, mw = W - PAD - mx0, my0 = mTop + FS * 1.5, my1 = mBottom - FS * 1.4;
      var vals = chan.map(function (c) { return R.marginalAt(c.i, plan.spends[c.i], step); });
      var topVal = d3.max(vals.concat(plan.m != null ? [plan.m * step] : [])) || 1;
      var lowVal = Math.min(0, d3.min(vals));
      var ym = d3.scaleLinear().domain([lowVal, topVal * 1.12]).range([Math.max(my0 + FS * 0.5, my1), my0]);
      marginal.append('text').attr('class', 'lch-marginal-title').attr('x', mx0).attr('y', mTop + FS * 0.9).attr('font-size', CAP_FS).attr('fill', fg).attr('fill-opacity', 0.85)
        .text('the next ' + fmtSpend(step) + ' per ' + GRAIN + ' buys (' + OUTCOME_W + '):');
      if (plan.m != null) {
        marginal.append('line').attr('class', 'lch-marginal-level').attr('data-value', plan.m * step).attr('x1', mx0).attr('x2', mx0 + mw).attr('y1', ym(plan.m * step)).attr('y2', ym(plan.m * step))
          .attr('stroke', fg).attr('stroke-width', 1).attr('stroke-opacity', 0.7).attr('stroke-dasharray', '2 2')
          .append('title').text('the common marginal return of the channels the solver moves: ' + fmtOut(plan.m * step));
      }
      var slot = mw / N;
      var notes = { cap: ' (cap)', floor: ' (floor)', locked: ' (locked)', remainder: '', falling: ' (falling)', free: '' };
      var notesLong = { cap: ' (at its cap)', floor: ' (at its floor)', locked: ' (locked)', remainder: ' (a straight channel)', falling: ' (outcome falls with spend, held at its floor)', free: '' };
      chan.forEach(function (c) {
        var cx = mx0 + (c.i + 0.5) * slot, vy = ym(vals[c.i]);
        var tick = marginal.append('line').attr('class', 'lch-marginal-tick').attr('data-channel', c.name).attr('data-binding', plan.binding[c.i]).attr('data-value', vals[c.i])
          .attr('x1', cx - slot * 0.28).attr('x2', cx + slot * 0.28).attr('y1', vy).attr('y2', vy).attr('stroke', c.color).attr('stroke-width', 3);
        tick.append('title').text(c.name + ': the next ' + fmtSpend(step) + ' buys ' + fmtOut(vals[c.i]) + (notesLong[plan.binding[c.i]] || ''));
        var lab = marginal.append('text').attr('class', 'lch-marginal-label').attr('x', cx).attr('y', mBottom - 2).attr('text-anchor', 'middle')
          .attr('font-size', CAP_FS).attr('fill', fg);
        var forms = [c.name + ' ' + fmtOut(vals[c.i]) + (notes[plan.binding[c.i]] || ''), c.name + ' ' + fmtOut(vals[c.i]), fmtOut(vals[c.i])];
        for (var f = 0; f < forms.length; f++) {
          d3.llmFitLabel(lab, slot - 2, { pad: 0, text: forms[f], overflow: 'drop' });
          if (lab.text()) break;
        }
      });
    }
  }

  function paintReadouts(p, b, loss) {
    var unit = OUTCOME_W;
    function sumAt(spends) { var s = 0; chan.forEach(function (c) { s += R.at(c.i, spends[c.i]).mean; }); return s; }
    var curVal = sumAt(curSpends);
    var set = function (k, forms) {
      var t = readoutText[k];
      for (var f = 0; f < forms.length; f++) {
        d3.llmFitLabel(t, readoutW, { pad: 0, text: forms[f], overflow: 'drop' });
        if (t.text()) break;
      }
      t.selectAll('title').remove();
      if (t.text() !== forms[0]) t.append('title').text(forms[0]);
    };
    set(0, ['current split: ' + fmtOut(curVal) + ' ' + unit, 'current ' + fmtOut(curVal), fmtOut(curVal)]);
    if (!p) { set(1, ['']); set(2, ['']); return; }
    var bestVal = sumAt(b.spends);
    var half = loss.t * loss.se;
    var bestForms = loss.within
      ? ['best split: ' + fmtOut(bestVal) + ' ' + unit + ' (' + signed(loss.delta) + ' vs current, within the fit\'s uncertainty)', 'best split: ' + fmtOut(bestVal) + ' (within the fit\'s uncertainty)', 'best ' + fmtOut(bestVal)]
      : ['best split: ' + fmtOut(bestVal) + ' ' + unit + ' (' + signed(loss.delta) + ' vs current, +/- ' + fmtOut(half) + ' at ' + confPct + ')', 'best split: ' + fmtOut(bestVal) + ' (' + signed(loss.delta) + ')', 'best ' + fmtOut(bestVal)];
    var past = chan.filter(function (c) { return b.beyond && b.beyond[c.i]; }).map(function (c) { return c.name; });
    if (past.length) bestForms[0] += '; ' + past.join(', ') + ' past the spend this data has seen';
    set(1, bestForms);
    if (Object.keys(locks).length) {
      var yoursVal = sumAt(p.spends);
      var l2 = R.loss(p.spends, b.spends);
      var yForms = l2.within
        ? ['your split: ' + fmtOut(yoursVal) + ' ' + unit + ' (' + signed(-l2.delta) + ' vs best, within the fit\'s uncertainty)', 'your split: ' + fmtOut(yoursVal) + ' (within the fit\'s uncertainty)', 'yours ' + fmtOut(yoursVal)]
        : ['your split: ' + fmtOut(yoursVal) + ' ' + unit + ' (' + signed(-l2.delta) + ' vs best, ' + signed(-l2.hi) + ' to ' + signed(-l2.lo) + ' at ' + confPct + ')', 'your split: ' + fmtOut(yoursVal) + ' (' + signed(-l2.delta) + ')', 'yours ' + fmtOut(yoursVal)];
      set(2, yForms);
      readoutText[2].attr('fill-opacity', 1);
    } else {
      set(2, ['your split: drag a dot to set a channel\'s spend', 'drag a dot to set a spend']);
      readoutText[2].attr('fill-opacity', 0.6);
    }
    var nl = wrap(noteText(p, spareLine ? 0 : 1), CAP_ROOM);
    if (nl.length > noteLines) nl = wrap(noteText(p, 1), CAP_ROOM);
    capNotes.forEach(function (t, j) { t.text(nl[j] || ''); });
    if (noteLines && nl.length > noteLines) d3.llmFitLabel(capNotes[noteLines - 1], CAP_ROOM, { pad: 0, text: nl.slice(noteLines - 1).join(' ') });
    if (!noteLines && capLast) d3.llmFitLabel(capLast, CAP_ROOM, { pad: 0, text: noteText(p, 1) || capLastText });
    capTitle.text(staticCaption + (noteText(p, 0) ? ' ' + noteText(p, 0) : ''));
  }

  var capTop = H - CAP_H + CAP_LINE * 0.8, capLast = null, capLastText = '';
  capShown.forEach(function (ln, k) {
    var shown = ln;
    if (k === capShown.length - 1 && capCut) {
      var kept = ln.split(' ');
      while (kept.length > 1 && wrap(kept.join(' ') + ' ...', CAP_ROOM).length > 1) kept.pop();
      shown = kept.join(' ') + ' ...';
    }
    capLast = capG.append('text').attr('class', 'lch-caption-line').attr('x', PAD).attr('y', capTop + k * CAP_LINE).attr('font-size', CAP_FS)
      .attr('fill', fg).attr('fill-opacity', 0.8).text(shown);
    capLastText = shown;
  });
  var capTitle = capG.append('title').text(staticCaption);
  var capNotes = [];
  for (var nj = 0; nj < noteLines; nj++) {
    capNotes.push(capG.append('text').attr('class', 'lch-caption-note').attr('x', PAD).attr('y', capTop + (capShown.length + nj) * CAP_LINE).attr('font-size', CAP_FS)
      .attr('fill', fg).attr('fill-opacity', 0.8));
  }

  if (!divide) {
    strip.append('text').attr('class', 'lch-note').attr('x', PAD).attr('y', STRIP_Y + FS * 0.35).attr('font-size', SUB_FS).attr('fill', fg)
      .text('one channel in view - nothing to divide; clear the selection to allocate');
    paintReadouts(null, null, null);
    return;
  }

  var resetW = Math.max(20, FS * 3.2), resetH = Math.max(20, FS * 2.0), resetLeft = W - PAD - resetW;
  var slider = null, entry = null;
  var labelText = 'total budget per ' + GRAIN;
  if (ownsTotal) {
    strip.append('text').attr('class', 'lch-total-owner').attr('x', PAD).attr('y', STRIP_Y + FS * 0.35).attr('font-size', SUB_FS).attr('fill', fg)
      .text('total from ' + TOTAL_W + ': ' + fmtSpend(paramVal) + ' per ' + GRAIN);
  } else {
    var sliderX = PAD + tw(labelText, SUB_FS) + FS * 0.5 + Math.max(20, Math.round(FS * 1.5)) + FS * 0.6 + FS * 0.5;
    var boxW = Math.max(FS * 5.5, Math.min(FS * 8, W * 0.14));
    var sliderW = Math.max(FS * 6, resetLeft - sliderX - Math.max(20, Math.round(FS * 1.5)) - FS * 1.6 - boxW - FS * 1.2);
    var step0 = R.niceStep(tr.hi);
    var onTotal = function (v, source) {
      if (busy) return;
      busy = true;
      try {
        if (source === 'slider' && entry) entry.set(v, false);
        if (source === 'entry' && slider) slider.set(clampTo(v, tr.lo, tr.hi), false);
      } finally { busy = false; }
      total = v;
      solveAndPaint();
    };
    slider = d3.llmSlider(strip, { container: container, options: options, key: 'total', domain: [tr.lo, tr.hi], step: step0, 'default': total0,
      x: sliderX, y: STRIP_Y, width: sliderW, label: labelText, labelRoom: sliderX - PAD - FS * 2.4, format: function () { return ''; }, fontSize: FS,
      onChange: function (v, phase) { if (phase !== 'init') onTotal(v, 'slider'); } });
    entry = d3.llmNumberEntry(strip, { container: container, options: options, key: 'total', 'default': total0, format: fmtSpend,
      min: tr.lo, max: tr.hi, allowEmpty: false,
      x: Math.min(resetLeft - boxW - FS, (slider.bounds ? slider.bounds().right : sliderX + sliderW) + FS * 2.2), y: STRIP_Y, width: boxW, fontSize: FS,
      onChange: function (v, phase) { if (phase !== 'init' && v !== null && v !== undefined) onTotal(+v, 'entry'); } });
    var typed = entry.value();
    total = (typeof typed === 'number' && isFinite(typed)) ? typed : slider.value();
  }
  var reset = strip.append('g').attr('class', 'lch-reset lch-control').attr('aria-label', 'Reset total and release held channels').attr('cursor', 'pointer')
    .on('click', function () {
      locks = {};
      busy = true;
      try {
        if (entry) entry.reset(false);
        if (slider) slider.set(total0, false);
      } finally { busy = false; }
      total = ownsTotal ? paramVal : total0;
      persistLocks();
      report('reset', 'allocator', 'reset');
      solveAndPaint();
    });
  reset.append('rect').attr('x', resetLeft).attr('y', STRIP_Y - resetH / 2).attr('width', resetW).attr('height', resetH)
    .attr('rx', 3).attr('fill', 'transparent').attr('stroke', fg).attr('opacity', 0.6);
  reset.append('text').attr('x', resetLeft + resetW / 2).attr('y', STRIP_Y + FS * 0.35).attr('text-anchor', 'middle')
    .attr('font-size', SUB_FS).attr('fill', fg).text('reset');

  locks = sanitizeLocks(uiKnobs.locks, total);
  bag.locks = copyLocks(locks);

  chan.forEach(function (c) {
    if (!(c.cv.hi > c.cv.lo)) return;
    var p = panelOf[c.i];
    var d = d3.llmSlider(dotLayer, { container: container, options: options, key: 'dot:' + c.name, handleOnly: true, domain: [c.cv.lo, c.cv.hi],
      position: function (v) { return [X(c.i, v), Y(c.i, R.at(c.i, v).mean)]; }, invert: function (px) { return p.sx.invert(px - p.x0); },
      fontSize: FS,
      onChange: function (v, phase) {
        if (phase === 'end') delete bag['dot:' + c.name];
        if (busy || phase === 'init') return;
        if (phase === 'drag') { dragging = c.name; locks[c.name] = v; solveAndPaint(); return; }
        var moved = dragging === c.name || (placed[c.name] !== undefined && Math.abs(v - placed[c.name]) > 1e-9 * Math.max(1, Math.abs(v)));
        if (phase === 'end' && moved) {
          dragging = null;
          locks[c.name] = v;
          bag.locks = copyLocks(locks);
          solveAndPaint();
        }
      } });
    if (!d.g) return;
    d.g.select('.llm-slider-handle circle').attr('fill', c.color);
    d.g.append('title').text(c.name + ': drag it, or use the arrow keys, to hold this channel at a spend and let the solver re-split the rest');
    dots[c.name] = d;
  });
  dotsBuilt = true;
  solveAndPaint();
}
