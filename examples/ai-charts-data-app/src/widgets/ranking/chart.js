// BIC generated chart — Lollipop chart [D3]
// host contract v1.24.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// bic:keyboard-marks
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
  container.replaceChildren();
  const W = options.width, H = options.height;
  const fg = options.themeFg || 'currentColor';
  const cols = data.columns.map(c => c.name);
  const need = n => { const k = cols.indexOf(n); if (k < 0) throw new Error('INVALID:column "' + n + '" not found'); return k; };
  const iC = need('Country'), iR = need('Region'), iV = need('RevenueYoY'), iRev = need('Revenue');
  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  if (options.backgroundColor) svg.append('rect').attr('width', W).attr('height', H).attr('fill', options.backgroundColor).style('pointer-events', 'none');
  const items = [];
  let omitted = 0;
  data.rows.forEach((r, i) => {
    const v = r[iV];
    if (v == null || v === '' || !isFinite(+v)) { omitted++; return; }
    const rev = r[iRev];
    items.push({ i, key: String(i), country: String(r[iC]), region: String(r[iR]), yoy: +v, rev: (rev == null || !isFinite(+rev)) ? null : +rev });
  });
  if (!items.length) {
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('fill', fg)
      .text((typeof options.noDataText === 'string' && options.noDataText) ? options.noDataText : 'No data to display');
    return;
  }
  const regTot = d3.rollup(items, v => d3.sum(v, d => d.rev || 0), d => d.region);
  items.sort((a, b) => d3.descending(regTot.get(a.region), regTot.get(b.region)) || d3.ascending(a.region, b.region) || d3.descending(a.yoy, b.yoy));
  const regions = [...new Set(items.map(d => d.region))];
  const T = d3.llmThemeColors(options);
  const colorOf = T.categories(regions);
  const regIdx = d3.group(items, d => d.region);
  const rowsOfRegion = new Map([...regIdx].map(([k, v]) => [k, v.map(d => d.i)]));
  const nf = new Intl.NumberFormat(options.cultureCode || 'en-US', { style: 'percent', maximumFractionDigits: 1 });
  const cf = new Intl.NumberFormat(options.cultureCode || 'en-US', { notation: 'compact', maximumFractionDigits: 1 });
  // layout
  const showLegend = regions.length > 1;
  const maxLab = d3.max(regions, s => s.length) || 6;
  const legendW = showLegend && W >= 500 ? Math.max(96, Math.min(W * 0.30, maxLab * 6.2 + 34)) : 0;
  const bandTop = showLegend && W < 500 ? 24 : 0;
  const maxName = d3.max(items, d => d.country.length) || 6;
  const m = { top: 28 + bandTop, right: legendW + 16, bottom: 46 + (omitted ? 16 : 0), left: Math.min(W * 0.3, maxName * 5.9 + 14) };
  const pw = Math.max(50, W - m.left - m.right), ph = Math.max(50, H - m.top - m.bottom);
  const lo = d3.min(items, d => d.yoy), hi = d3.max(items, d => d.yoy);
  const pad = ((Math.max(0, hi) - Math.min(0, lo)) || 0.1) * 0.06;
  const x = d3.scaleLinear().domain([Math.min(0, lo) - (lo < 0 ? pad : 0), Math.max(0, hi) + pad]).nice().range([0, pw]);
  const y = d3.scaleBand().domain(items.map(d => d.key)).range([0, ph]).padding(0.25);
  const nameOf = new Map(items.map(d => [d.key, d.country]));
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
  // grid
  const ticks = x.ticks(Math.max(3, Math.floor(pw / 70)));
  g.append('g').selectAll('line').data(ticks).join('line')
    .attr('x1', t => x(t)).attr('x2', t => x(t)).attr('y1', 0).attr('y2', ph)
    .attr('stroke', fg).attr('stroke-opacity', 0.12).style('pointer-events', 'none');
  // axes
  const xAxis = g.append('g').attr('transform', `translate(0,${ph})`).call(d3.axisBottom(x).tickValues(ticks).tickFormat(t => nf.format(t)));
  xAxis.selectAll('text').attr('fill', fg).style('font-size', '10px');
  xAxis.selectAll('path,line').attr('stroke', fg).attr('stroke-opacity', 0.4);
  const yAxis = g.append('g').call(d3.axisLeft(y).tickSize(0).tickPadding(6).tickFormat(k => nameOf.get(k)));
  yAxis.selectAll('path').attr('stroke', fg).attr('stroke-opacity', 0.4);
  const rowIdxByKey = new Map(items.map(d => [d.key, [d.i]]));
  yAxis.selectAll('.tick').each(function (k) {
    d3.select(this).select('text').attr('class', 'd3-axis-filter').attr('fill', fg).style('font-size', '10px')
      .style('cursor', 'pointer').attr('data-row-idx', (rowIdxByKey.get(k) || []).join(','));
  });
  g.append('text').attr('x', pw / 2).attr('y', ph + 36).attr('text-anchor', 'middle').attr('fill', fg).style('font-size', '11px')
    .text('Revenue YoY (% change)');
  if (omitted) {
    g.append('text').attr('x', pw / 2).attr('y', ph + 52).attr('text-anchor', 'middle').attr('fill', fg).style('font-size', '10px')
      .text(omitted + (omitted === 1 ? ' row is' : ' rows are') + ' not drawn: no value for Revenue YoY');
  }
  // marks
  const tip = options.allowTooltips !== false ? d3.llmTooltip(container) : null;
  const marks = g.append('g').selectAll('g.d3-mark').data(items).join('g')
    .attr('class', 'd3-mark').attr('data-row-idx', d => d.i).style('cursor', 'pointer');
  marks.append('rect').attr('x', 0).attr('width', pw).attr('y', d => y(d.key) - 1).attr('height', y.bandwidth() + 2).attr('fill', 'transparent');
  marks.append('line').attr('x1', x(0)).attr('x2', d => x(d.yoy)).attr('y1', d => y(d.key) + y.bandwidth() / 2).attr('y2', d => y(d.key) + y.bandwidth() / 2)
    .attr('stroke', d => colorOf(d.region)).attr('stroke-width', 1.6);
  marks.append('circle').attr('cx', d => x(d.yoy)).attr('cy', d => y(d.key) + y.bandwidth() / 2).attr('r', 4.5)
    .attr('fill', d => colorOf(d.region));
  if (tip) {
    marks.on('mousemove', (event, d) => tip.show(
      `<b>${d.country}</b><br/>Region: ${d.region}<br/>Revenue YoY: ${nf.format(d.yoy)}` + (d.rev == null ? '' : `<br/>Revenue: ${cf.format(d.rev)}`), event))
      .on('mouseleave', () => tip.hide());
  }
  // zero reference (above marks, inert)
  g.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', ph)
    .attr('stroke', fg).attr('stroke-opacity', 0.7).attr('stroke-dasharray', '4,3').style('pointer-events', 'none');
  const zx = x(0);
  g.append('text').attr('x', zx).attr('y', -8).attr('text-anchor', zx < 55 ? 'start' : 'middle').attr('fill', fg).style('font-size', '10px')
    .style('pointer-events', 'none').text('Zero growth (0%)');
  // legend
  if (showLegend) {
    const lx = legendW ? W - legendW - 8 : m.left;
    const ly = legendW ? m.top : 4;
    const lg = svg.append('g').attr('transform', `translate(${lx},${ly})`);
    const perRow = legendW ? 1 : Math.max(1, Math.floor((W - m.left) / 130));
    const cell = legendW ? legendW : 130;
    const ent = lg.selectAll('g.leg').data(regions).join('g').attr('class', 'd3-legend-mark leg')
      .attr('data-row-idx', r => rowsOfRegion.get(r).join(',')).style('cursor', 'pointer')
      .attr('transform', (r, k) => `translate(${(k % perRow) * cell},${Math.floor(k / perRow) * 18})`);
    ent.append('rect').attr('width', cell - 6).attr('height', 16).attr('y', -3).attr('fill', 'transparent');
    ent.append('rect').attr('width', 11).attr('height', 11).attr('fill', r => colorOf(r));
    ent.each(function (r) {
      const t = d3.select(this).append('text').attr('x', 16).attr('y', 9).attr('fill', fg).style('font-size', '10px').text(r);
      d3.llmFitLabel(t, cell - 24, { text: r });
    });
  }
}
