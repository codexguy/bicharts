// BIC generated chart — Variance chart (budget vs actual) [D3]
// host contract v1.24.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// bic:keyboard-marks
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
d3.llmThinLabels = function (labels, opts) {
opts = opts || {};
var pad = isFinite(+opts.pad) && +opts.pad >= 0 ? +opts.pad : 2;
var nodes = [];
if (labels && typeof labels.each === 'function') labels.each(function (d, i) { nodes.push({ node: this, d: d, i: i }); });
var n = nodes.length;
if (n < 2) return { shown: n, hidden: 0 };
var num = function (v, dflt) { var x = parseFloat(v); return isFinite(x) ? x : dflt; };
var boxOf = function (node) {
try {
var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
if (r && r.width > 0 && r.height > 0) return { l: r.left, r: r.right, t: r.top, b: r.bottom };
} catch (e) { /* no layout: the estimate below */ }
var fs = num(node.getAttribute && node.getAttribute('font-size'), 0)
|| num(node.style && node.style.fontSize, 0) || 11;
var text = String(node.textContent || '');
var w = text.length * fs * 0.6;
var x = num(node.getAttribute && node.getAttribute('x'), 0), y = num(node.getAttribute && node.getAttribute('y'), 0);
var anchor = (node.getAttribute && node.getAttribute('text-anchor')) || 'start';
var l = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
return { l: l, r: l + w, t: y - fs * 0.85, b: y + fs * 0.25 };
};
var rank = typeof opts.priority === 'function'
? function (o) { var p = +opts.priority(o.d, o.i); return isFinite(p) ? p : -Infinity; }
: function (o) { return o.i === 0 || o.i === n - 1 ? Infinity : -o.i; };
var given = typeof opts.box === 'function' ? function (o) {
var b = null;
try { b = opts.box(o.d, o.i, o.node); } catch (e) { b = null; }
return b && isFinite(b.l) && isFinite(b.r) && isFinite(b.t) && isFinite(b.b) ? { l: +b.l, r: +b.r, t: +b.t, b: +b.b } : null;
} : function () { return null; };
nodes.forEach(function (o) { o.box = given(o) || boxOf(o.node); o.rank = rank(o); });
var order = nodes.slice().sort(function (a, b) { return b.rank - a.rank || a.i - b.i; });
var kept = [], hidden = 0;
order.forEach(function (o) {
if (!String(o.node.textContent || '').trim()) return;   // an empty label takes no room
var hit = kept.some(function (k) {
return o.box.l < k.r + pad && k.l < o.box.r + pad && o.box.t < k.b && k.t < o.box.b;
});
if (hit) {
o.node.style.visibility = 'hidden';
o.node.setAttribute('data-thinned', '1');
hidden++;
} else {
o.node.style.visibility = '';
o.node.removeAttribute('data-thinned');
kept.push(o.box);
}
});
return { shown: n - hidden, hidden: hidden };
};
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

var mount = host;
if (mount.tagName && String(mount.tagName).toLowerCase() === 'svg' && mount.parentNode) {
mount = mount.parentNode;
}
if (!mount || !mount.appendChild) return noop;

try {
var pos = (typeof getComputedStyle === 'function') ? getComputedStyle(mount).position : '';
if (!pos || pos === 'static') mount.style.position = 'relative';
} catch (e) { /* jsdom / exec-gate: no layout engine, positioning is inert anyway */ }

var tip = mount.__llmTip;
if (!tip || tip.parentNode !== mount) {
tip = document.createElement('div');
tip.className = 'llm-tooltip';
tip.style.position = 'absolute';
tip.style.left = '0px';
tip.style.top = '0px';
tip.style.pointerEvents = 'none';
tip.style.visibility = 'hidden';
tip.style.zIndex = '20';
tip.style.boxSizing = 'border-box';
tip.style.whiteSpace = opts.wrap ? 'normal' : 'nowrap';
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

function looksLikeEvent(x) {
return !!x && typeof x === 'object' && !Array.isArray(x)
&& (typeof x.clientX === 'number' || typeof x.type === 'string' || ('target' in x));
}

function setContent(content, asText) {
if (Array.isArray(content)) content = content.map(function (x) { return x == null ? '' : String(x); }).join(asText ? ' ' : '<br/>');
lastContent = content == null ? '' : String(content);
if (!asText && typeof content === 'string' && content.indexOf('<') >= 0) tip.innerHTML = lastContent;
else tip.textContent = lastContent;
}

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
tip.style.maxWidth = 'none';
tip.style.visibility = 'visible';      // measurable BEFORE placing
var m = metrics();
if (m.ch && m.h + (2 * edge) > m.ch) {
var hbShow = hostTip();
if (hbShow && hbShow.show(lastContent, ev) === true) {
routed = true;
tip.style.visibility = 'hidden';
return this;
}
}
routed = false;
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
d3.llmUtcDays = function (data, options) {
if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return data;
if (options && options.dateCellsAreUtcDays === true) return data;
var DAY = 86400000;
var dateCols = [];
for (var ci = 0; ci < data.columns.length; ci++) {
var col = data.columns[ci];
if (col && /date|time/i.test(String(col.dataType || ''))) dateCols.push(ci);
}
if (!dateCols.length) return data;
function empty(v) { return v === null || v === undefined || v === ''; }
function localWall(t) { return t - new Date(t).getTimezoneOffset() * 60000; }
var fix = [];
for (var k = 0; k < dateCols.length; k++) {
var idx = dateCols[k], moved = 0, ok = true;
for (var r = 0; r < data.rows.length; r++) {
var row = data.rows[r];
if (!row || empty(row[idx])) continue;
var t = new Date(row[idx]).getTime();
if (!isFinite(t)) { ok = false; break; }
if (t % DAY === 0) continue;
if (localWall(t) % DAY !== 0) { ok = false; break; }
moved++;
}
if (ok && moved > 0) fix.push(idx);
}
if (!fix.length) return data;
var rows = data.rows.map(function (row) {
if (!row) return row;
var out = row.slice();
for (var f = 0; f < fix.length; f++) {
var j = fix[f];
if (empty(out[j])) continue;
var tt = new Date(out[j]).getTime();
if (tt % DAY === 0) continue;
out[j] = new Date(localWall(tt)).toISOString();
}
return out;
});
var result = {};
for (var key in data) if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
result.rows = rows;
return result;
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
  data = d3.llmUtcDays(data, options);
  container.replaceChildren();
  var TYPE_FLOOR = 10;
  var W = options.width, H = options.height;
  var FS = Math.max(TYPE_FLOOR, Math.min(14, Math.min(W, H) / 55));
  var DELTA_FS = Math.max(TYPE_FLOOR, FS * 0.9), PCT_FS = Math.max(TYPE_FLOOR, FS * 0.85);
  var TICK_FS = Math.max(TYPE_FLOOR, FS * 0.82), LEG_FS = Math.max(TYPE_FLOOR, FS * 0.8), NOTE_FS = Math.max(TYPE_FLOOR, FS * 0.78);
  var CAP_FS = Math.max(TYPE_FLOOR, FS * 0.95);
  var fg = options.themeFg || 'currentColor';
  var bg = options.themeBg || 'transparent';
  var hc = !!options.isHighContrast;
  var accent = options.themeAccent || fg;
  var culture = options.cultureCode || 'en-US';
  var cols = data.columns, rows = data.rows;
  function idxOf(n) { return cols.findIndex(function (c) { return c.name === n; }); }
  var ciCat = idxOf('MonthStart'), ciAct = idxOf('Revenue'), ciRef = idxOf('Target'), ciRow = idxOf('__rowIdx__');
  if (ciCat < 0) throw new Error('INVALID:column "MonthStart" not found');
  if (ciAct < 0) throw new Error('INVALID:column "Revenue" not found');
  if (ciRef < 0) throw new Error('INVALID:column "Target" not found');
  var actName = d3.llmDisplayName('Revenue'), refName = d3.llmDisplayName('Target');
  var nf = new Intl.NumberFormat(culture, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
  var pf = new Intl.NumberFormat(culture, { maximumFractionDigits: 1 });
  var POLARITY = 'higher';
  var TC = d3.llmThemeColors(options);
  var GOOD = hc ? accent : TC.good, BAD = hc ? fg : TC.bad;
  var actualFill = TC.legible(TC.categories(['Revenue'])('Revenue'));

  function emptyMsg() {
    var s = d3.select(container).append('svg').attr('width', W).attr('height', H).style('background', bg);
    s.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('fill', fg).attr('font-size', FS)
      .text((options.noDataText && String(options.noDataText)) || 'No data to display');
  }
  if (!rows.length) { emptyMsg(); return; }

  function sumOrNull(v, c) {
    var s = 0, any = false;
    v.forEach(function (r) { var raw = r[c]; if (raw === null || raw === undefined || raw === '') return; var n = +raw; if (isFinite(n)) { s += n; any = true; } });
    return any ? s : null;
  }
  var groups = d3.rollups(rows, function (v) {
    return {
      actual: sumOrNull(v, ciAct), ref: sumOrNull(v, ciRef),
      rowIdx: v.map(function (r) { return ciRow >= 0 ? r[ciRow] : rows.indexOf(r); }).join(','),
      when: new Date(v[0][ciCat])
    };
  }, function (r) { return String(r[ciCat]); }).map(function (kv) {
    var o = kv[1]; o.key = kv[0];
    o.missed = o.actual === null && o.ref !== null;
    if (o.missed) o.actual = 0;
    o.delta = o.ref === null || o.actual === null ? null : o.actual - o.ref;
    o.pct = o.delta === null || o.ref === 0 ? null : (o.delta / Math.abs(o.ref)) * 100;
    return o;
  }).filter(function (d) { return !isNaN(d.when); });
  groups.sort(function (a, b) { return a.when - b.when; });
  if (!groups.length) { emptyMsg(); return; }
  var missedN = groups.filter(function (d) { return d.missed; }).length;
  var noRefN = groups.filter(function (d) { return d.ref === null; }).length;

  function favourable(dv) { return POLARITY === 'higher' ? dv > 0 : POLARITY === 'lower' ? dv < 0 : null; }
  function varFill(dv) { var f = favourable(dv); return f === null || dv === 0 ? fg : (f ? GOOD : BAD); }
  function varPaint(dv) { return (hc && favourable(dv) === false) ? 'url(#lchHatchBad)' : varFill(dv); }
  function signed(v, f) { return (v > 0 ? '+' : v < 0 ? '\u2212' : '') + f.format(Math.abs(v)); }
  function fmtVal(v) { return nf.format(v); }
  function monthLong(d) { return d.toLocaleDateString(culture, { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  var monShort = new Intl.DateTimeFormat(culture, { month: 'short', timeZone: 'UTC' });

  var svg = d3.select(container).append('svg').attr('width', W).attr('height', H)
    .style('background', bg).style('font-family', 'sans-serif');
  var defs = svg.append('defs');
  defs.append('pattern').attr('id', 'lchHatchBad').attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6)
    .attr('patternTransform', 'rotate(45)').append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
    .attr('stroke', fg).attr('stroke-width', 1.2);
  var tip = d3.llmTooltip(container);

  function textW(s, size) {
    var w = 0;
    var p = svg.append('text').attr('font-size', Math.max(TYPE_FLOOR, size)).attr('visibility', 'hidden').text(String(s));
    w = p.node().getComputedTextLength ? p.node().getComputedTextLength() : 0;
    p.remove();
    return w > 0 ? w : String(s).length * size * 0.66;
  }
  function widest(labels) { return d3.max(labels, function (s) { return textW(s, TICK_FS); }) || 0; }

  var refVals = groups.filter(function (d) { return d.ref !== null; }).map(function (d) { return d.ref; });
  var constRef = refVals.length > 0 && refVals.every(function (v) { return v === refVals[0]; });
  var refLineLabel = constRef ? refName + ' ' + nf.format(refVals[0]) : '';
  var axisVals = [0];
  groups.forEach(function (d) { [d.actual, d.ref, d.delta].forEach(function (v) { if (v !== null && isFinite(v)) { axisVals.push(v); axisVals.push(-Math.abs(v)); } }); });
  var leftLabels = d3.scaleLinear().domain(d3.extent(axisVals)).nice().ticks(5).concat(axisVals).map(fmtVal);
  leftLabels.push(pf.format(-(d3.max(groups, function (d) { return d.pct === null ? 0 : Math.abs(d.pct); }) || 0)) + '%');

  var caption = [actName + ' vs ' + refName + ' by month'];
  if (missedN) caption.push(missedN + ' month' + (missedN === 1 ? '' : 's') + ' with a blank ' + actName + ' against a ' + refName + ': each is counted as a full miss');
  if (noRefN) caption.push(noRefN + ' month' + (noRefN === 1 ? '' : 's') + ' with no target: no variance is drawn for ' + (noRefN === 1 ? 'it' : 'them'));

  var margin = {
    top: FS * 1.2 + caption.length * FS * 1.35 + FS * 1.35,
    right: Math.max(FS * 1.6, constRef ? textW(refLineLabel, NOTE_FS) + FS * 0.8 : 0),
    bottom: FS * 3.4,
    left: Math.max(FS * 4.8, 9 + widest(leftLabels) + FS * 0.4)
  };
  var plotW = Math.max(10, W - margin.left - margin.right);

  function idxJoin(fn) { return groups.filter(fn).map(function (d) { return d.rowIdx; }).join(','); }
  var refShort = refName;
  var legendItems = [
    { t: refShort, hollow: true, idx: idxJoin(function (d) { return d.ref !== null; }) },
    { t: actName, hollow: false, idx: idxJoin(function (d) { return d.actual !== null; }) },
    { t: 'above ' + refShort + ' (ahead)', fill: varPaint(1), idx: idxJoin(function (d) { return d.delta !== null && d.delta > 0; }) },
    { t: 'below ' + refShort + ' (behind)', fill: varPaint(-1), idx: idxJoin(function (d) { return d.delta !== null && d.delta < 0; }) }
  ];
  var LEG_SW = FS * 1.3, LEG_GAP = FS * 0.9, LEG_ROW = FS * 1.25;
  var legendRows = [[]], used = 0;
  legendItems.forEach(function (it) {
    var full = LEG_SW + FS * 0.35 + textW(it.t, LEG_FS);
    it.cut = full > plotW; it.w = Math.min(full, plotW);
    if (legendRows[legendRows.length - 1].length && used + it.w > plotW) { legendRows.push([]); used = 0; }
    legendRows[legendRows.length - 1].push(it);
    used += it.w + LEG_GAP;
  });
  margin.top += (legendRows.length - 1) * LEG_ROW;
  var plotH = Math.max(10, H - margin.top - margin.bottom);

  svg.append('g').selectAll('text').data(caption).join('text')
    .attr('x', margin.left).attr('y', function (d, k) { return FS * 1.15 + k * FS * 1.35; })
    .attr('font-size', CAP_FS).attr('fill', fg).attr('opacity', function (d, k) { return k ? 0.72 : 1; })
    .text(function (d) { return d; })
    .each(function (d) { var t = d3.select(this); d3.llmFitLabel(t, W - margin.left - FS * 0.5, { pad: 0, text: d }); if (t.text() !== d) t.append('title').text(d); });

  var gap = FS * 1.5, band = plotH - 2 * gap;
  var hVal = band * 0.50, hAbs = band * 0.28, hRel = band * 0.22;
  var yVal0 = margin.top, yAbs0 = yVal0 + hVal + gap, yRel0 = yAbs0 + hAbs + gap;
  var x = d3.scaleBand().domain(groups.map(function (d) { return d.key; })).range([margin.left, margin.left + plotW]).padding(0.28);
  var vHi = d3.max(groups, function (d) { return Math.max(d.actual === null ? 0 : d.actual, d.ref === null ? 0 : d.ref); });
  var yVal = d3.scaleLinear().domain([0, vHi > 0 ? vHi : 1]).nice().range([yVal0 + hVal, yVal0]);
  function headroom(max, half, room) { return max * half / Math.max(half - room, half * 0.45); }
  var aMax = d3.max(groups, function (d) { return d.delta === null ? 0 : Math.abs(d.delta); }) || 1;
  var yAbs = d3.scaleLinear().domain([-1, 1].map(function (s) { return s * headroom(aMax, hAbs / 2, FS * 1.3); })).range([yAbs0 + hAbs, yAbs0]);
  var pMax = d3.max(groups, function (d) { return d.pct === null ? 0 : Math.abs(d.pct); }) || 1;
  var yRel = d3.scaleLinear().domain([-1, 1].map(function (s) { return s * headroom(pMax, hRel / 2, FS * 1.6); })).range([yRel0 + hRel, yRel0]);

  function styleAxis(g) {
    g.selectAll('text').attr('fill', fg).attr('font-size', TICK_FS);
    g.selectAll('line,path').attr('stroke', fg).attr('opacity', 0.5);
  }
  function axisLeft(scale, ticks, fmt, vals) {
    var ax = d3.axisLeft(scale).tickFormat(fmt);
    if (vals) ax.tickValues(vals); else ax.ticks(ticks);
    styleAxis(svg.append('g').attr('transform', 'translate(' + margin.left + ',0)').call(ax));
  }
  function zeroRule(scale) {
    svg.append('line').attr('x1', margin.left).attr('x2', margin.left + plotW).attr('y1', scale(0)).attr('y2', scale(0))
      .attr('stroke', fg).attr('opacity', 0.55);
  }
  function panelTag(yTop, text) {
    svg.append('text').attr('x', margin.left).attr('y', yTop - FS * 0.45).attr('font-size', NOTE_FS).attr('fill', fg).attr('opacity', 0.75).text(text);
  }
  axisLeft(yVal, 4, fmtVal);
  axisLeft(yAbs, 3, fmtVal, [-aMax, 0, aMax]);
  axisLeft(yRel, 3, function (v) { return pf.format(v) + '%'; }, [-pMax, 0, pMax]);
  zeroRule(yAbs); zeroRule(yRel);
  panelTag(yVal0, 'Monthly ' + actName + ' vs ' + refName);
  panelTag(yAbs0, 'Gap to ' + refName + ' (' + 'ahead / behind)');
  panelTag(yRel0, 'Gap as % of ' + refName);

  // legend
  var lg = svg.append('g').attr('font-size', LEG_FS).attr('fill', fg);
  var legY = margin.top - FS * 1.5;
  legendRows.forEach(function (row, r) {
    var rowW = d3.sum(row, function (it) { return it.w; }) + (row.length - 1) * LEG_GAP;
    var cx = margin.left + Math.max(0, plotW - rowW);
    var y = legY - (legendRows.length - 1 - r) * LEG_ROW;
    row.forEach(function (it) {
      var gg = lg.append('g').attr('transform', 'translate(' + cx + ',' + y + ')')
        .attr('class', 'd3-legend-mark').attr('data-row-idx', it.idx).style('cursor', 'pointer');
      gg.append('rect').attr('x', 0).attr('y', -FS * 0.62).attr('width', LEG_SW).attr('height', FS * 0.8)
        .attr('fill', it.fill ? it.fill : (it.hollow ? 'none' : actualFill)).attr('stroke', fg).attr('stroke-width', it.hollow ? 1 : 0);
      var tx = gg.append('text').attr('x', LEG_SW + FS * 0.35).attr('y', 0).attr('fill', fg).text(it.t);
      if (it.cut) { d3.llmFitLabel(tx, plotW - LEG_SW - FS * 0.35, { pad: 0, text: it.t }); if (tx.text() !== it.t) tx.append('title').text(it.t); }
      cx += it.w + LEG_GAP;
    });
  });

  var bw = x.bandwidth(), innerW = bw * 0.62, innerX = bw * 0.19;
  var cat = svg.append('g').selectAll('g').data(groups).join('g')
    .attr('class', 'd3-mark').attr('data-row-idx', function (d) { return d.rowIdx; }).style('cursor', 'pointer');
  cat.append('rect').attr('x', function (d) { return x(d.key); }).attr('y', yVal0).attr('width', bw)
    .attr('height', (yRel0 + hRel) - yVal0).attr('fill', 'transparent');
  cat.filter(function (d) { return d.ref !== null; }).append('rect')
    .attr('x', function (d) { return x(d.key); }).attr('width', bw)
    .attr('y', function (d) { return yVal(Math.max(0, d.ref)); })
    .attr('height', function (d) { return Math.abs(yVal(d.ref) - yVal(0)); })
    .attr('fill', 'none').attr('stroke', fg).attr('stroke-width', 1);
  cat.filter(function (d) { return d.actual !== null; }).append('rect')
    .attr('x', function (d) { return x(d.key) + innerX; }).attr('width', innerW)
    .attr('y', function (d) { return yVal(Math.max(0, d.actual)); })
    .attr('height', function (d) { return Math.abs(yVal(d.actual) - yVal(0)); })
    .attr('fill', actualFill);
  var withRef = cat.filter(function (d) { return d.delta !== null; });
  withRef.append('rect')
    .attr('x', function (d) { return x(d.key) + innerX; }).attr('width', innerW)
    .attr('y', function (d) { return yAbs(Math.max(0, d.delta)); })
    .attr('height', function (d) { return Math.abs(yAbs(d.delta) - yAbs(0)); })
    .attr('fill', function (d) { return varPaint(d.delta); });
  var gapLabels = withRef.append('text').style('pointer-events', 'none')
    .attr('x', function (d) { return x(d.key) + bw / 2; })
    .attr('y', function (d) {
      var free = d.delta >= 0 ? yAbs(d.delta) - FS * 0.4 : yAbs(d.delta) + FS * 1.05;
      return Math.max(yAbs0 + FS * 0.9, Math.min(yAbs0 + hAbs - FS * 0.15, free));
    })
    .attr('text-anchor', 'middle').attr('font-size', DELTA_FS).attr('fill', fg)
    .text(function (d) { return signed(d.delta, nf); });
  withRef.append('line')
    .attr('x1', function (d) { return x(d.key) + bw / 2; }).attr('x2', function (d) { return x(d.key) + bw / 2; })
    .attr('y1', yRel(0)).attr('y2', function (d) { return d.pct === null ? yRel(0) : yRel(d.pct); })
    .attr('stroke', function (d) { return varFill(d.pct === null ? 0 : d.pct); }).attr('stroke-width', 1.5);
  withRef.filter(function (d) { return d.pct !== null; }).append('circle')
    .attr('cx', function (d) { return x(d.key) + bw / 2; }).attr('cy', function (d) { return yRel(d.pct); })
    .attr('r', Math.max(2, FS * 0.42)).attr('fill', function (d) { return varPaint(d.pct); });
  var pctLabels = withRef.append('text').style('pointer-events', 'none')
    .attr('x', function (d) { return x(d.key) + bw / 2; })
    .attr('y', function (d) {
      if (d.pct === null) return yRel(0) - FS * 0.5;
      var free = d.pct >= 0 ? yRel(d.pct) - FS * 0.75 : yRel(d.pct) + FS * 1.35;
      return Math.max(yRel0 + FS * 0.85, Math.min(yRel0 + hRel - FS * 0.1, free));
    })
    .attr('text-anchor', 'middle').attr('font-size', PCT_FS).attr('fill', fg)
    .text(function (d) { return d.pct === null ? 'n/a' : signed(d.pct, pf) + '%'; });
  [[gapLabels, DELTA_FS], [pctLabels, PCT_FS]].forEach(function (p) {
    p[0].attr('x', function () {
      var t = d3.select(this), half = textW(t.text(), p[1]) / 2, cx = +t.attr('x');
      return Math.max(margin.left + half, Math.min(margin.left + plotW - half, cx));
    });
  });
  d3.llmThinLabels(gapLabels, { priority: function (d) { return Math.abs(d.delta); } });
  d3.llmThinLabels(pctLabels, { priority: function (d) { return d.pct === null ? -1 : Math.abs(d.pct); } });

  // reference line (Target is constant): dashed, label in the right margin band
  if (constRef) {
    svg.append('line').attr('x1', margin.left).attr('x2', margin.left + plotW)
      .attr('y1', yVal(refVals[0])).attr('y2', yVal(refVals[0]))
      .attr('stroke', fg).attr('stroke-dasharray', '5 4').attr('opacity', 0.7).style('pointer-events', 'none');
    svg.append('text').attr('x', margin.left + plotW + FS * 0.4).attr('y', yVal(refVals[0]) + NOTE_FS * 0.35)
      .attr('font-size', NOTE_FS).attr('fill', fg).style('pointer-events', 'none').text(refLineLabel);
  }

  // month labels as axis-filter affordances
  var short = x.step() < 34;
  svg.append('g').selectAll('text').data(groups).join('text')
    .attr('class', 'd3-axis-filter').attr('data-row-idx', function (d) { return d.rowIdx; })
    .style('cursor', 'pointer')
    .attr('x', function (d) { return x(d.key) + bw / 2; })
    .attr('y', yRel0 + hRel + FS * 1.5)
    .attr('text-anchor', 'middle').attr('font-size', DELTA_FS).attr('fill', fg)
    .text(function (d) { var m = monShort.format(d.when); return short ? m.charAt(0) : m; })
    .each(function (d) { d3.select(this).append('title').text(monthLong(d.when)); });

  function tipHtml(d) {
    return '<b>' + monthLong(d.when) + '</b><br/>'
      + actName + ': ' + (d.missed ? 'blank (a full miss)' : d.actual === null ? 'blank' : nf.format(d.actual)) + '<br/>'
      + refName + ': ' + (d.ref === null ? 'blank' : nf.format(d.ref)) + '<br/>'
      + (d.delta === null ? 'No target: no variance'
        : (d.delta >= 0 ? 'Ahead of target: ' : 'Behind target: ') + signed(d.delta, nf) + (d.pct === null ? ' (n/a)' : ' (' + signed(d.pct, pf) + '%)'));
  }
  cat.on('mouseover', function (event, d) { if (options.allowTooltips !== false) tip.show(tipHtml(d), event); })
    .on('mousemove', function (event, d) { if (options.allowTooltips !== false) tip.show(tipHtml(d), event); })
    .on('mouseout', function () { tip.hide(); });
}
