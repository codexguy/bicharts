// BIC generated chart — Bivariate World Choropleth [D3]
// host contract v1.13.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
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
  var ell = opts.ellipsis == null ? '…' : opts.ellipsis;
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
  // A CUT KEEPS WHAT TELLS THE LABEL APART (opts.distinctFrom, the sibling labels). The widest
  // prefix is the right cut for one label and the wrong one for a set that shares its start: sixteen gauge
  // panels named 'SBA NAME 1' to 'SBA NAME 18' were each cut to 'SBA NA...', so no panel could be matched to
  // its name. Given the labels drawn beside this one, a prefix cut that keeps no more than this label shares
  // with a sibling becomes a TAIL cut - the ellipsis, then the widest ending that fits ('...NAME 12') - never
  // splitting a number, and blank when even the tail will not fit. A label no sibling shares a start with is
  // cut as before.
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

  sel.each(function (d, i) {
    var node = this;
    // Re-runnable: keep the ORIGINAL text so a second pass (proofread re-render, resize) re-fits
    // from the full string instead of eroding an already-clipped one. An animated chart supplies
    // opts.text instead, because its label is a NEW string each frame rather than the same one
    // re-measured - see the header.
    var full;
    if (opts.text != null) {
      try {
        full = typeof opts.text === 'function' ? opts.text.call(node, d, i) : opts.text;
      } catch (e) { full = ''; }
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

    var room;
    try {
      room = typeof widthAccessor === 'function'
        ? widthAccessor.call(node, d, i)
        : widthAccessor;
    } catch (e) { room = 0; }
    room = (room == null ? 0 : +room) - pad * 2;

    if (!(room > 0) || room < minWidth) { node.textContent = ''; return; }

    // Start every fit from the ORIGINAL size, for the same reason the original TEXT is kept:
    // a re-fit must be able to undo a shrink, not only deepen one.
    if (shrinkTo != null) {
      if (node.__llmFullFontSize == null) node.__llmFullFontSize = fontSizeOf(node);
      setFontSize(node, node.__llmFullFontSize);
    }
    node.textContent = full;
    var w = measure(node, full);
    if (w <= room) return;                                // fits whole - done

    if (shrinkTo != null && shrinkTo > 0) {
      var cur = fontSizeOf(node);
      if (cur > shrinkTo) {
        // Width is close to linear in font size, so the first guess lands within a step of
        // the answer; walk down in half-pixels from there and stop at the first size that
        // fits, never below the floor.
        var fs = Math.max(shrinkTo, Math.floor((cur * room / w) * 2) / 2);
        for (; fs >= shrinkTo; fs -= 0.5) {
          setFontSize(node, fs);
          if (measure(node, full) <= room) return;
        }
        setFontSize(node, shrinkTo);
        if (measure(node, full) <= room) return;
      }
    }
    if (overflow === 'drop') { node.textContent = ''; return; }

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
        return;
      }
    }
    node.textContent = lo > 0 ? full.slice(0, lo) + ell : '';
  });

  return sel;
};
// SHARED zoom/pan helper for D3 charts drawn on a map projection (the geo BUBBLE lanes).
//
// Why this exists: zoom is easy to get wrong in ways that only show up in a HOST. Four
// traps, all handled here so 80 generations do not each rediscover them.
//
//  1. THE WHEEL BELONGS TO THE PAGE. A visual sits inside a scrollable report, so a map
//     that swallows the wheel steals the user's scroll. Embedded maps solved this long ago
//     with cooperative gestures (embedded Google Maps, Mapbox cooperativeGestures): Ctrl or
//     Cmd + wheel zooms, a plain wheel scrolls the page, and a one-line hint appears so the
//     plain wheel does not read as a broken map. One finger scrolls the page; two fingers
//     work the map.
//  2. A PAN MUST NOT CROSS-FILTER. The host resolves clicks with a delegated listener on
//     the container root, so the click synthesised at the end of a drag would select
//     whatever mark sat under the pointer. d3-zoom suppresses that click itself, and
//     clickDistance keeps a few px of wobble a real CLICK so ordinary selection still works.
//  3. FURNITURE MUST NOT MOVE. The legend panel, the annotation stack and the reset control
//     live OUTSIDE the transformed layer, and the layer is clipped to the map area, so
//     nothing can pan out over the panel or the notes.
//  4. SYMBOL SIZE IS NOT GEOGRAPHY. A bubble radius encodes a MEASURE, so it must not grow
//     with the zoom the way a country outline does. The chart gets an onZoom callback and
//     counter-scales its own marks and labels by the transform's k.
//
// Contract: call BEFORE drawing the map, draw into the returned `layer` - or into z.group(),
// a group in that layer whose borders and hub dots keep their on-screen size as the map grows
// (a choropleth's whole zoom wiring is these two calls) - and append the legend/notes to the
// SVG afterwards so they paint on top. Never null for a real svg: when d3.zoom is absent (or
// the frame has no size) it returns a STILL object whose layer is the svg itself and whose
// group() appends to it, so the caller draws exactly as it would with no zoom at all.
//   var z = d3.llmGeoZoom(svg, { width, height, originX, originY, themeFg, backgroundColor, fontSize, maxScale });
//   var gMap = z.group({ stroke: 0.5, dotStroke: 0.7 });   // stroke: path border px; dotStroke: hub dots too
d3.llmGeoZoom = function (svg, opts) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: the hint and the pad glyphs draw no smaller
  opts = opts || {};
  if (!svg || typeof svg.append !== 'function') return null;
  // NO ZOOM AVAILABLE: a still map, drawn straight onto the svg - never null, so a caller
  // never needs a guard of its own (a guard is how generations learned to drop zoom).
  var still = function () {
    return { layer: svg, still: true, group: function () { return svg.append('g'); },
      reset: function () {}, step: function () {} };
  };
  if (typeof d3.zoom !== 'function' || typeof d3.zoomIdentity === 'undefined') return still();

  var w = +opts.width, h = +opts.height;
  // ORIGIN of the map area within the SVG. Lanes whose furniture sits to the SIDE
  // (the bubble maps) leave this at 0,0 and nothing changes. A lane whose legend takes a
  // band or a column (the choropleths, placed by d3.llmLegendLayout) passes the map area's
  // own corner, so the pan catcher, the clip and the d-pad all land inside the map rather
  // than across the legend. NOT
  // applied to `layer`: callers project into absolute SVG coords, and translating the
  // layer would slide every mark off its own projection.
  var ox = +opts.originX || 0, oy = +opts.originY || 0;
  if (!(w > 0) || !(h > 0)) return still();
  var maxScale = +opts.maxScale > 1 ? +opts.maxScale : 8;
  var fg = opts.themeFg || '#333';
  var fs = Math.max(TYPE_FLOOR, +opts.fontSize > 0 ? +opts.fontSize : 11);
  var coop = opts.cooperative === false ? false : true;
  var onZoom = typeof opts.onZoom === 'function' ? opts.onZoom : null;
  var hintText = opts.hintText || 'Use Ctrl (Cmd) + scroll to zoom, or drag to pan';

  // Clip id derived from the viewport - the geo lanes' convention: deterministic, no
  // random, and two visuals that collide are by definition the same size.
  var clipId = 'llmzoomclip-' + Math.abs(((w * 131 + h * 17 + ox * 7 + oy) | 0));
  svg.append('defs').append('clipPath').attr('id', clipId).append('rect')
    .attr('x', ox).attr('y', oy).attr('width', w).attr('height', h);

  var viewport = svg.append('g').attr('clip-path', 'url(#' + clipId + ')');
  // A PAINTED catcher so empty ocean can start a pan. fill 'transparent', never 'none' -
  // an unpainted shape takes no pointer events. It sits UNDER the map content, so marks
  // keep their own clicks.
  viewport.append('rect').attr('class', 'llm-zoom-surface')
    .attr('x', ox).attr('y', oy).attr('width', w).attr('height', h)
    .attr('fill', 'transparent');
  var layer = viewport.append('g');

  // MAP GROUPS (z.group). A BORDER is not geography - it is a hairline drawn on it - and a
  // hub dot marks a place, not an area, so both keep their on-screen size as the map grows:
  // on every zoom, each group's path borders are set to stroke / k and, with dotStroke, its
  // circles to their own radius / k and dotStroke / k. Re-selected on every zoom rather than
  // captured once, so a lane that re-joins its paths per keyframe stays correct.
  var groups = [];
  function group(gopts) {
    var g = layer.append('g');
    groups.push({ g: g, o: gopts || {} });
    return g;
  }
  function scaleGroups(k) {
    if (!(k > 0)) return;
    for (var gi = 0; gi < groups.length; gi++) {
      var ge = groups[gi], go = ge.o;
      try {
        if (+go.stroke > 0) ge.g.selectAll('path').attr('stroke-width', +go.stroke / k);
        if (+go.dotStroke > 0) ge.g.selectAll('circle').each(dotScaler(+go.dotStroke, k));
      } catch (e) { /* a border width is never worth breaking the chart for */ }
    }
  }
  // A hub dot's own radius is read once, the first time it is scaled, so a radius the chart
  // set (the user's Map Dot Size) is what stays constant on screen.
  function dotScaler(dotStroke, k) {
    return function () {
      if (this.__llmBaseR == null) this.__llmBaseR = parseFloat(this.getAttribute('r'));
      if (isFinite(this.__llmBaseR)) this.setAttribute('r', this.__llmBaseR / k);
      this.setAttribute('stroke-width', dotStroke / k);
    };
  }

  // Reset is the pad's CENTRE cell (built below); this holds it so the show/hide and the
  // adopt()-skip keep working. Null on a viewport too small for the pad, hence every use
  // being guarded.
  var ctrl = null;

  // SIX ALWAYS-VISIBLE CONTROLS. Cooperative gestures are the right
  // BEHAVIOUR but they are INVISIBLE: nothing on the chart said the map could move at all,
  // and a reader on a trackpad, a touchpad or a wheel-less mouse had no way to find out.
  // Zoom in/out plus pan left/up/right/down, laid out as a d-pad so each direction reads
  // without a label:
  //     [+] [^] [-]
  //     [<]     [>]
  //         [v]
  // On the SVG ROOT like the rest of the furniture, so the transform never moves them, and
  // OUTSIDE the zoom viewport so a press is a click rather than the start of a pan.
  var PAD_BTN = Math.max(15, Math.min(22, Math.round(fs * 1.7)));
  var PAD_GAP = 2, PAD_W = PAD_BTN * 3 + PAD_GAP * 2;
  var padX = ox + w - PAD_W - 6, padY = oy + 6;
  var pad = null, panBtns = [];
  // Omit rather than overlap: on a tile too small to hold the pad and still be a map, the
  // gesture path is still there and the furniture rule wins (same test the size key uses).
  if (w >= PAD_W + fs * 8 && h >= PAD_BTN * 3 + PAD_GAP * 2 + 16) {
    pad = svg.append('g').attr('class', 'llm-zoom-pad');
    // The centre cell was empty and Reset was a separate box in the opposite corner, so the
    // controls read as two unrelated things. Reset now sits in the middle of its own d-pad
    // - one compact cluster, and the arrows point away from the thing that
    // undoes them.
    var CELLS = [
      [0, 0, 'in', '+'], [1, 0, 'up', '\u2191'], [2, 0, 'out', '\u2212'],
      [0, 1, 'left', '\u2190'], [1, 1, 'reset', '\u27F2'], [2, 1, 'right', '\u2192'],
      [1, 2, 'down', '\u2193']
    ];
    // A named function, not an IIFE: injected helpers are prepended into generated code
    // and face the same CQC pass it does, and d3_iife_wrapper rejects the (function(){})()
    // form. Passing the cell as an argument gives the same per-iteration capture.
    for (var ci = 0; ci < CELLS.length; ci++) addPadButton(CELLS[ci]);
  }
  function addPadButton(cell) {
    {
        var bx = padX + cell[0] * (PAD_BTN + PAD_GAP);
        var by = padY + cell[1] * (PAD_BTN + PAD_GAP);
        var g = pad.append('g').attr('class', 'llm-zoom-btn').style('cursor', 'pointer');
        g.append('rect').attr('x', bx).attr('y', by).attr('rx', 3)
          .attr('width', PAD_BTN).attr('height', PAD_BTN)
          .attr('fill', opts.backgroundColor || '#fff').attr('fill-opacity', 0.85)
          .attr('stroke', fg).attr('stroke-opacity', 0.35);
        g.append('text').attr('x', bx + PAD_BTN / 2).attr('y', by + PAD_BTN / 2)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-size', Math.max(TYPE_FLOOR, PAD_BTN - 6)).attr('fill', fg)
          .style('pointer-events', 'none').text(cell[3]);
        g.on('click', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          llmZoomStep(cell[2]);
        });
        // The arrows do nothing at k=1 (translateExtent pins the fitted frame), so they
        // start dimmed - a control that looks live and is not is worse than none.
        if (cell[2] === 'reset') { ctrl = g; g.style('opacity', 0.35); panBtns.push(g); }
        else if (cell[2] !== 'in' && cell[2] !== 'out') { g.style('opacity', 0.35); panBtns.push(g); }
    }
  }

  var hint = svg.append('g').style('display', 'none').style('pointer-events', 'none');
  hint.append('rect').attr('x', ox + w / 2 - fs * 12).attr('y', oy + h / 2 - fs).attr('rx', 4)
    .attr('width', fs * 24).attr('height', fs * 2)
    .attr('fill', fg).attr('fill-opacity', 0.72);
  hint.append('text').attr('x', ox + w / 2).attr('y', oy + h / 2 + fs * 0.4)
    .attr('text-anchor', 'middle').attr('font-size', fs)
    .attr('fill', opts.backgroundColor || '#fff').text(hintText);

  var hintTimer = null;
  function showHint() {
    try {
      hint.raise().style('display', null).style('opacity', 1);
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { hint.style('display', 'none'); }, 1500);
    } catch (e) { /* a hint is never worth breaking the chart for */ }
  }

  // COOPERATIVE GESTURE FILTER. Returning false leaves the event unprevented, which is what
  // lets the report page scroll normally.
  function filt(event) {
    if (!event) return false;
    if (event.type === 'wheel') {
      if (!coop || event.ctrlKey || event.metaKey) return true;
      showHint();
      return false;
    }
    if (event.touches) {
      if (!coop) return true;
      if (event.touches.length < 2) { showHint(); return false; }
      return true;
    }
    if (event.type === 'dblclick') return true;
    return !event.button;                       // primary-button drag pans
  }

  // SELF-HEALING ADOPTION - the "wired it, but it does not work" case. A generation can
  // call this helper and then draw the map straight onto the SVG anyway, which leaves the
  // layer empty and makes the zoom a silent no-op. So on the FIRST gesture, if the layer is
  // still empty, adopt the groups that actually hold the map: anything carrying a .d3-mark
  // or a basemap <path>, minus legend furniture, which must never move with the map. Same
  // doctrine as the exec gate healing a throw rather than failing the render.
  //
  // On first interaction rather than a timer: synchronous, nothing to schedule, and the
  // render is guaranteed complete because nobody can gesture at a chart that does not exist.
  var adopted = false, adoptedBaseR = null;
  function adopt() {
    if (adopted) return;
    adopted = true;
    try {
      var layerNode = layer.node(), svgNode = svg.node();
      if (!layerNode || !svgNode) return;
      if (layerNode.childNodes.length) return;          // drawn correctly - nothing to do
      var kids = [].slice.call(svgNode.childNodes), moved = 0;
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType !== 1 || !n.querySelector) continue;
        if (n === viewport.node() || n === hint.node()) continue;
        if (ctrl && n === ctrl.node()) continue;
        if (pad && n === pad.node()) continue;
        if (n.tagName === 'defs' || n.tagName === 'title') continue;
        // Furniture stays put, even when it happens to contain a path.
        var isFurniture = (n.classList && n.classList.contains('d3-legend-mark'))
          || n.querySelector('.d3-legend-mark');
        if (isFurniture) continue;
        var holdsMap = n.tagName === 'path'
          || (n.classList && n.classList.contains('d3-mark'))
          || n.querySelector('.d3-mark')
          || (n.tagName === 'g' && n.querySelector('path'));
        if (!holdsMap) continue;
        layerNode.appendChild(n);                        // document order is preserved
        moved++;
      }
      if (!moved) return;
      // The chart's own onZoom cannot be counter-scaling marks it never put here, so the
      // helper takes that over: a radius encodes a MEASURE, not an area on the ground.
      adoptedBaseR = [];
      var ms = layerNode.querySelectorAll('.d3-mark');
      for (var j = 0; j < ms.length; j++) {
        var r = parseFloat(ms[j].getAttribute('r'));
        if (isFinite(r)) adoptedBaseR.push([ms[j], r, parseFloat(ms[j].getAttribute('stroke-width')) || 0]);
      }
    } catch (e) { /* a heal is never worth breaking the chart for */ }
  }

  // Base font sizes, captured lazily the first time we compensate - reading them every
  // frame would re-read a value we had already divided.
  var textBase = null;
  function scaleLayerText(k) {
    if (!(k > 0)) return;
    try {
      var layerNode = layer.node();
      if (!layerNode) return;
      var ts = layerNode.querySelectorAll('text');
      if (textBase === null || textBase.length !== ts.length) {
        textBase = [];
        for (var i = 0; i < ts.length; i++) {
          var cs = null;
          try { cs = window.getComputedStyle(ts[i]).fontSize; } catch (e) { cs = null; }
          var px = parseFloat(ts[i].getAttribute('font-size'));
          if (!isFinite(px)) px = parseFloat(cs);
          textBase.push(isFinite(px) && px > 0 ? px : 0);
        }
      }
      for (var j = 0; j < ts.length; j++) {
        if (textBase[j] > 0) ts[j].setAttribute('font-size', (textBase[j] / k).toFixed(2));
      }
    } catch (e) { /* a label size is never worth breaking the chart for */ }
  }

  function scaleAdopted(k) {
    if (!adoptedBaseR || !(k > 0)) return;
    for (var i = 0; i < adoptedBaseR.length; i++) {
      var e = adoptedBaseR[i];
      e[0].setAttribute('r', e[1] / k);
      if (e[2]) e[0].setAttribute('stroke-width', e[2] / k);
    }
  }

  var zoom = d3.zoom()
    // d3's DEFAULT wheelDelta multiplies by 10 when ctrlKey is set, because it assumes
    // ctrl+wheel means a trackpad PINCH. Here ctrl is the deliberate zoom modifier, so that
    // boost makes a single notch slam to the maximum scale. Use the plain delta.
    .wheelDelta(function (event) {
      return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002);
    })
    .scaleExtent([1, maxScale])
    .extent([[0, 0], [w, h]])
    // Keep the fitted world inside the frame: at k=1 there is nothing to pan to, which is
    // also what keeps the map from drifting off its own reserved area.
    .translateExtent([[0, 0], [w, h]])
    .clickDistance(4)
    .filter(filt)
    .on('zoom', function (event) {
      var t = event && event.transform ? event.transform : d3.zoomIdentity;
      adopt();                       // no-op when the chart drew into the layer as intended
      layer.attr('transform', t.toString());
      scaleAdopted(t.k);
      scaleLayerText(t.k);
      scaleGroups(t.k);
      if (onZoom) { try { onZoom(t); } catch (e) { /* never break the render */ } }
      try {
        // The pad is always visible; only the arrows and Reset go live once there is
        // something to pan or undo. Hiding the whole cluster is what made zoom
        // undiscoverable in the first place.
        if (ctrl) ctrl.style('opacity', t.k > 1.001 ? 1 : 0.35);
        for (var pi = 0; pi < panBtns.length; pi++) panBtns[pi].style('opacity', t.k > 1.001 ? 1 : 0.35);
        if (pad) pad.raise();
      } catch (e) { /* ignore */ }
    });

  try { viewport.call(zoom); } catch (e) { if (pad) pad.remove(); return { layer: layer, group: group, reset: function () {}, step: function () {} }; }

  function reset() {
    try { viewport.call(zoom.transform, d3.zoomIdentity); } catch (e) { /* ignore */ }
  }

  // Pan by a FRACTION OF THE FRAME so a press feels the same on any tile size, divided by
  // k because translateBy works in the layer's own pre-scale coordinates - without that,
  // one press at k=8 would jump eight times as far as the same press at k=1. translateExtent
  // already clamps at the edges, so a press at the border is a no-op, never a drift off the
  // reserved map area. An arrow moves the VIEW that way, so the content moves the opposite
  // way - the same direction sense as a scrollbar or an arrow key.
  function llmZoomStep(dir) {
    try {
      if (dir === 'reset') { reset(); return; }
      if (dir === 'in') { viewport.call(zoom.scaleBy, 1.6); return; }
      if (dir === 'out') { viewport.call(zoom.scaleBy, 1 / 1.6); return; }
      var t = d3.zoomTransform(viewport.node());
      var k = t && t.k > 0 ? t.k : 1;
      var dx = (w * 0.18) / k, dy = (h * 0.18) / k;
      if (dir === 'left') viewport.call(zoom.translateBy, dx, 0);
      else if (dir === 'right') viewport.call(zoom.translateBy, -dx, 0);
      else if (dir === 'up') viewport.call(zoom.translateBy, 0, dy);
      else if (dir === 'down') viewport.call(zoom.translateBy, 0, -dy);
    } catch (e) { /* a control is never worth breaking the chart for */ }
  }

  return { layer: layer, group: group, reset: reset, zoom: zoom, viewport: viewport, pad: pad, step: llmZoomStep };
};
// SHARED world-basemap FIT for D3 maps drawn on a WORLD projection: the route lane, the world
// point lanes and the world choropleths.
//
// What it owns, so a caller cannot get it half-right:
//   * the FAR-SOUTH TRIM. The far south is about a third of a Natural Earth frame for a
//     continent that is almost never a business dimension, so the basemap is cut just under
//     the trimmed continent's own top edge, leaving a thin SLIVER so the map never reads as
//     though the continent were missing;
//   * ANY point below FAR_SOUTH, or any data REGION reaching below it, turns the trim off
//     completely - pass every place a mark sits (BOTH ends of a route) and every region that
//     carries data, because a supply line to a research station is exactly the dataset that
//     must see its own continent;
//   * the TWO-PASS FIT. Fitting the full world and then cropping leaves the cropped height as
//     dead space under the map; fitting a TRIMMED world instead scales as though the continent
//     did not exist, so its landing position stops being determined by the fit. So the full
//     world is fitted twice - the first pass only MEASURES what the clip will remove;
//   * the clip goes on the BASEMAP GROUP ONLY, never on point or route marks: clipping a mark
//     hides data, not scenery, and the trim is already off whenever a mark sits below the cut.
//     A choropleth's regions ARE its basemap, so it clips its region group with wf.clip.
// With no basemap it fits the points' own extent and trims nothing.
//
//   var wf = d3.llmWorldFit(proj, {
//     geo: geo,                  // options.geo FeatureCollection, or null
//     points: epts,              // [[lon, lat], ...] - EVERY place a mark sits (point and route maps)
//     regions: matched,          // the basemap features that CARRY DATA (choropleths)
//     width: mapW, height: mapH, // the MAP AREA: the clip's width, and the y the clip never passes
//     pad: pad,                  // inset of the fit box, px
//     viewport: [W, H] });       // the whole chart: sizes the sliver and names the clip
//   Optional, for a lane whose frame is not simply the map area inset by pad:
//     box: [[x0, y0], [x1, y1]]  // the fit box (y1 is where the map bottom lands before the trim)
//     pointBox: [[..], [..]]     // the fit box when there is NO basemap (default: box)
//     fitPolygons: true          // fit the basemap's polygons only (its Point features are join aids)
//     refit: false               // one fit, no second pass
//     anchorLow: y               // a width-bound map moves DOWN so most slack sits above it, under y
//     clipTop: y                 // the clip's top edge (default 0)
//   var path = wf.path;          // d3.geoPath over the fitted projection - draw basemap AND marks with it
//   wf.basemap(svg, layer)       // the clipped <g class='llm-basemap'> to draw countries into; null with no geo
//   wf.basemap(svg, layer, true) // the same clipped group, plain: no class, pointer events untouched
//   wf.clip(svg, g)              // clip a group you made yourself (a choropleth's region group); returns g
//   wf.trimSouth / wf.clipBottom // whether the far south is trimmed, and the y the basemap is cut at
d3.llmWorldFit = function (proj, opts) {
  opts = opts || {};
  var FAR_SOUTH = -60;
  var geo = (opts.geo && opts.geo.features && opts.geo.features.length) ? opts.geo : null;
  var mapW = +opts.width || 0, mapH = +opts.height || 0;
  var pad = isFinite(+opts.pad) && opts.pad !== null && opts.pad !== undefined ? +opts.pad : 8;
  var vp = opts.viewport || [mapW, mapH];
  var VW = +vp[0] || mapW, VH = +vp[1] || mapH;
  var pts = (opts.points || []).filter(function (p) {
    return p && p.length > 1 && p[0] !== null && p[1] !== null && isFinite(+p[0]) && isFinite(+p[1]);
  });

  var isFarSouth = function (f) { var b = d3.geoBounds(f); return b[1][1] < FAR_SOUTH; };
  var anyFarSouth = pts.some(function (p) { return +p[1] < FAR_SOUTH; })
    || (opts.regions || []).some(function (f) { return !!f && isFarSouth(f); });
  var trimSouth = !!geo && !anyFarSouth;
  // Anchored to min(W, H) of the WHOLE chart: in a portrait viewport width binds the fit, and a
  // height-relative sliver would cover most of the (now small) far south instead of trimming it.
  var sliver = trimSouth ? Math.max(8, Math.round(Math.min(VW, VH) * 0.03)) : 0;

  var box = opts.box || [[pad, pad], [mapW - pad, mapH - pad]];
  var x0 = box[0][0], y0 = box[0][1], x1 = box[1][0], y1 = box[1][1];
  var polys = geo ? geo.features.filter(function (f) { return f.geometry && f.geometry.type !== 'Point'; }) : [];
  var fitGeo = (geo && opts.fitPolygons && polys.length) ? { type: 'FeatureCollection', features: polys } : geo;
  var fitTo = function (bottom) {
    if (geo) proj.fitExtent([[x0, y0], [x1, bottom]], fitGeo);
    else if (pts.length) proj.fitExtent(opts.pointBox || [[x0, y0], [x1, bottom]], { type: 'MultiPoint', coordinates: pts });
  };
  fitTo(y1);
  var path = d3.geoPath(proj);

  var farSouthCol = { type: 'FeatureCollection', features: polys.filter(isFarSouth) };
  if (opts.refit !== false && trimSouth && farSouthCol.features.length) {
    var fsB = path.bounds(farSouthCol), worldB = path.bounds(geo);
    var cut = fsB[0][1] + sliver;                  // where the clip will land
    var crop = Math.max(0, worldB[1][1] - cut);    // dead space this would leave
    if (crop > 1) { fitTo(y1 + crop); path = d3.geoPath(proj); }
  }
  // ANCHOR LOW: when the frame is flatter than the world, fitExtent centres the leftover slack
  // half above and half below, and the bottom half reads as a too-large gutter. Keep about 30% of
  // the slack at the bottom (floor 24px, room for note lines) and shift the rest to the top. The
  // shift is measured from where the CLIP lands, so a height-bound frame does not move.
  var aTop = opts.anchorLow;
  if (trimSouth && aTop !== undefined && aTop !== null && isFinite(+aTop)) {
    var vis = polys.filter(function (f) { return !isFarSouth(f); });
    if (vis.length) {
      var vb = path.bounds({ type: 'FeatureCollection', features: vis });
      var cutA = farSouthCol.features.length ? path.bounds(farSouthCol)[0][1] + sliver : vb[1][1];
      var slackTop = Math.max(0, vb[0][1] - aTop);
      var slackBottom = Math.max(0, y1 - cutA);
      var bottomGap = Math.max(24, Math.round((slackTop + slackBottom) * 0.3));
      var dy = Math.round((mapH - bottomGap) - cutA);
      if (dy > 1) {
        var t = proj.translate();
        proj.translate([t[0], t[1] + Math.min(dy, slackTop + slackBottom)]);
        path = d3.geoPath(proj);
      }
    }
  }
  // The sliver hangs off the TRIMMED CONTINENT'S own top edge, not off where the rest of the
  // world ends: there is open ocean between Cape Horn and the Antarctic coast.
  var farSouthTop = farSouthCol.features.length ? path.bounds(farSouthCol)[0][1] : Infinity;
  var clipBottom = (trimSouth && isFinite(farSouthTop)) ? Math.min(mapH, farSouthTop + sliver) : mapH;
  var clipTop = +opts.clipTop || 0;

  // The clip id is derived from the viewport: deterministic, and two visuals that collide are
  // by definition the same size.
  var clipId = 'llmgeoclip-' + Math.abs((VW * 131 + VH) | 0);
  var defineClip = function (svg) {
    svg.append('defs').append('clipPath').attr('id', clipId).append('rect')
      .attr('x', 0).attr('y', clipTop).attr('width', mapW).attr('height', Math.max(1, clipBottom - clipTop));
  };
  var basemap = function (svg, layer, plain) {
    if (!geo || !svg || !layer) return null;
    defineClip(svg);
    var g = layer.append('g');
    if (plain) return g.attr('clip-path', 'url(#' + clipId + ')');
    return g.attr('class', 'llm-basemap').attr('clip-path', 'url(#' + clipId + ')')
      .style('pointer-events', 'none');
  };
  var clip = function (svg, g) {
    if (!geo || !svg || !g) return g;
    defineClip(svg);
    return g.attr('clip-path', 'url(#' + clipId + ')');
  };

  return { path: path, projection: proj, trimSouth: trimSouth, clipBottom: clipBottom, clipTop: clipTop,
    sliver: sliver, farSouth: FAR_SOUTH, basemap: basemap, clip: clip };
};
// SHARED bivariate colour scale + two-way legend for the D3 choropleths that colour each region
// by TWO measures at once (Bivariate World Choropleth, Bivariate USA Choropleth (by state)).
//
// Why this is a helper and not two blocks of archetype: the two gauges were written separately
// and 68 of their substantial lines came out byte-identical, and two copies of "bin each measure
// into thirds and index a 3x3 colour matrix" diverge in a way no render check catches - both maps
// still DRAW, only their colours disagree. One copy, and the offline gate proves that copy.
//
// WHAT IT OWNS, so an archetype cannot get it half-right:
//   * THE BINS ARE TERTILES OF THE REGIONS THAT HAVE BOTH VALUES. A region missing either
//     measure has no cell and contributes nothing to either threshold. A null is NEVER a 0.
//   * THE NINE COLOURS ARE A DELIBERATE 2-D RAMP (Stevens' 3x3 - the scheme the d3 bivariate
//     choropleth example uses): the bottom row runs grey -> teal along the PRIMARY, the left
//     column grey -> magenta up the SECONDARY, and the far corner is the deep purple both reach
//     together. Palette rotation would give nine unordered hues and an unreadable map.
//   * A USER-FORCED RAMP (Colour Scale Low/High) GOES ON THE PRIMARY AXIS ONLY; the secondary is
//     expressed as light -> dark on that ramp, and the helper hands back a sentence saying so.
//     The pickers assume ONE ramp; blending them into both axes silently would produce a
//     matrix the legend could not explain, and ignoring them would be the defect
//     d3_geo_colorscale_endpoints_ignored was written for.
//   * THE LEGEND IS A ROTATED SQUARE WITH LABELLED AXES. Both labels start at the low/low corner
//     and read upright, so they cannot cross or turn upside down whatever the measure names; a
//     label past two edges or 18 characters is cut with an ellipsis (the caption keeps the name).
//     The box COVERS THE LABEL RUNS,
//     not just the grid's diagonal, and it reports that box BEFORE it is
//     drawn (legendSize), so the caller can RESERVE room for it (d3.llmLegendLayout: a band or a
//     column, whichever leaves the larger map) and fit the map beside it rather than under it. The parent lanes' 46px strip is not enough, and inheriting it silently is how a
//     legend ends up on top of New Zealand.
//
// Contract:
//   const biv = d3.llmBivariate({
//     x: [...], y: [...],                   // paired per region, in the same order; null = missing
//     xLabel, yLabel,                       // the measure names, for the legend and the note
//     colorScaleLow, colorScaleHigh,        // options.colorScaleLow/High - either one forces
//     palettePrimary,                       // fallback high end when only Low was forced
//   });
//   biv.xBin(v) / biv.yBin(v)     -> 0 | 1 | 2 | null
//   biv.colors[9]                 -> hex, indexed yBin * 3 + xBin
//   biv.colorFor(xv, yv)          -> hex | null (null when either value is missing)
//   biv.primaryColor(xv)          -> hex | null: the bottom row as a continuous ramp, for the
//                                    honest degrade (primary only when the square cannot fit)
//   biv.thirdName(bin)            -> 'low' | 'mid' | 'high'
//   biv.occupancy[9], biv.emptyCells, biv.thresholds {x:[..], y:[..]}
//   biv.forced, biv.forcedNote, biv.captionText
//   biv.legendSize(cell, fontSize)               -> { width, height }
//   biv.drawLegend(svg, { x, y, cell, fontSize, themeFg }) -> { width, height }; the group is
//                                    <g class="llm-bivariate-legend" data-w data-h>
d3.llmBivariate = function (cfg) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: the arm labels draw no smaller, and the size promised is at that size
  cfg = cfg || {};
  var num = function (v) { return (v == null || v === '' || !isFinite(+v)) ? null : +v; };
  var xin = cfg.x || [], yin = cfg.y || [];
  var n = Math.min(xin.length, yin.length);
  var xs = [], ys = [];
  for (var i = 0; i < n; i++) {
    var a = num(xin[i]), b = num(yin[i]);
    if (a != null && b != null) { xs.push(a); ys.push(b); }   // PAIRED regions only
  }
  var xLabel = cfg.xLabel || 'x', yLabel = cfg.yLabel || 'y';

  // Tertiles via scaleQuantile. A constant axis has no thirds; everything sits in the middle
  // row/column rather than being pushed to 'high' by a degenerate bisect.
  var mk = function (vals) {
    if (!vals.length) return { bin: function () { return null; }, thresholds: [], flat: true };
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) return { bin: function () { return 1; }, thresholds: [], flat: true };
    var q = d3.scaleQuantile().domain(vals).range([0, 1, 2]);
    return { bin: function (v) { return q(v); }, thresholds: q.quantiles(), flat: false };
  };
  var QX = mk(xs), QY = mk(ys);
  var xBin = function (v) { v = num(v); return v == null ? null : QX.bin(v); };
  var yBin = function (v) { v = num(v); return v == null ? null : QY.bin(v); };

  // THE SCHEME. Indexed y * 3 + x. Joshua Stevens' 3x3, with ONE change: his low/low corner is a neutral
  // #e8e8e8, and the map's land / no-data fill defaults to #e6e6e6 - the two are indistinguishable (dE 0.7),
  // so every region low on both measures read as a region with no data (five US states in one render).
  // The corner is a pale warm tint instead: still the lightest cell, dE ~17 from that grey and from white.
  var STEVENS = ['#f8f8d8', '#ace4e4', '#5ac8c8', '#dfb0d6', '#a5add3', '#5698b9', '#be64ac', '#8c62aa', '#3b4994'];
  var forced = !!(cfg.colorScaleLow || cfg.colorScaleHigh);
  var colors;
  if (!forced) {
    colors = STEVENS.slice();
  } else {
    // The user's ramp along the PRIMARY; the SECONDARY as lightness on top of it.
    var lo2 = cfg.colorScaleLow || '#eef3f8';
    var hi2 = cfg.colorScaleHigh || cfg.palettePrimary || '#3182bd';
    var ramp = (typeof d3.interpolateLab === 'function') ? d3.interpolateLab(lo2, hi2) : d3.interpolateRgb(lo2, hi2);
    colors = [];
    for (var j = 0; j < 3; j++) {
      for (var k = 0; k < 3; k++) {
        var base = d3.color(ramp(k / 2)) || d3.color(hi2);
        var c = j === 0 ? base.brighter(0.9) : (j === 1 ? base : base.darker(0.9));
        colors.push(c.formatHex());
      }
    }
  }
  var colorFor = function (xv, yv) {
    var a = xBin(xv), b = yBin(yv);
    return (a == null || b == null) ? null : colors[b * 3 + a];
  };
  // The degrade ramp: the bottom row, continuous, over the primary's own extent.
  var pxlo = xs.length ? Math.min.apply(null, xs) : 0, pxhi = xs.length ? Math.max.apply(null, xs) : 1;
  var pRamp = (typeof d3.interpolateLab === 'function') ? d3.interpolateLab(colors[0], colors[2]) : d3.interpolateRgb(colors[0], colors[2]);
  var primaryColor = function (xv) {
    xv = num(xv); if (xv == null) return null;
    var t = pxhi === pxlo ? 0.5 : (xv - pxlo) / (pxhi - pxlo);
    return d3.color(pRamp(Math.max(0, Math.min(1, t)))).formatHex();
  };

  var occupancy = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (var r = 0; r < xs.length; r++) occupancy[QY.bin(ys[r]) * 3 + QX.bin(xs[r])]++;
  var emptyCells = occupancy.filter(function (c) { return c === 0; }).length;
  var NAMES = ['low', 'mid', 'high'];
  var thirdName = function (bin) { return bin == null ? 'no data' : NAMES[bin]; };

  // THE ARMS DROP A LEADING AGGREGATION PREFIX. The caption under the legend already carries
  // the full "Sum of X" name; an arm has only the diamond's edge to run along, and "Sum of "
  // is 7 characters of it. Falls back to the full name if stripping would leave nothing.
  var shortLabel = function (s) {
    var t = String(s == null ? '' : s);
    var m = t.replace(/^(sum|average|avg|count|distinct count|min|minimum|max|maximum|median|standard deviation|variance|first|last) of\s+/i, '');
    return m.length ? m : t;
  };
  var xArm = shortLabel(xLabel), yArm = shortLabel(yLabel);
  // A label's RUN, modelled before anything is drawn. legendSize is a PROMISE the caller
  // reserves a band against, so it has to know how LONG the text is, not just how tall - there
  // is no layout engine to ask, and getComputedTextLength is 0 until the thing is on a screen.
  var textRun = function (s, fs) { return String(s == null ? '' : s).length * fs * 0.58; };

  var forcedNote = forced
    ? ('Colour Scale (Low/High) applied to ' + xLabel + '; ' + yLabel + ' runs light to dark')
    : null;
  var captionText = xLabel + ' (→) by ' + yLabel + ' (↑), each split into thirds: low / mid / high';

  // LEGEND GEOMETRY. A 3x3 grid of `cell` px, rotated 45 degrees so the low/low corner points
  // down and the two axes climb away from it; the labels sit just outside the two lower edges.
  //
  // BOTH LABELS START AT THE LOW/LOW CORNER AND RUN OUT ALONG THEIR OWN EDGE, the x label up to
  // the right and the y label up to the left. In the grid's own frame the x label keeps to
  // x >= -e + 2 and the y label to x <= -e - 6, so the two cannot cross at ANY length. Centred on
  // their edges they met below the corner as soon as a name ran past about 60px.
  //
  // THE Y LABEL TURNS +90 INSIDE THE -45 GROUP, so on screen it reads down toward the corner at
  // +45 degrees, with a leading arrow pointing back up its axis. Turned -90 it sat at -135
  // degrees, upside down. Turned this way its glyphs grow TOWARD the grid from the baseline, so
  // the baseline sits one font size further out.
  //
  // A LABEL PAST TWO EDGES OR 18 CHARACTERS, WHICHEVER IS LONGER, IS CUT WITH AN ELLIPSIS. Up to
  // two edges (six cells) a label widens the box but never deepens it, and the depth is what the
  // caller takes from the map; the character floor keeps a short name whole on a small tile for a
  // few px of depth. The caption still names both measures in full.
  //
  // EACH ARM PROJECTS ITS LENGTH ONTO BOTH AXES AT 1/sqrt2, because it is drawn along a 45-degree
  // edge, and the archetypes reserve their band from exactly this box - a label the box does not
  // cover runs onto the map, where 8px grey text over an ocean margin looks like nothing at all.
  var ARM_CHARS = 18;
  var armCap = function (cell, fs) { return Math.max(6 * cell, ARM_CHARS * fs * 0.58); };
  var armFull = function (name, isY) { return isY ? '← ' + name : name + ' →'; };
  var armText = function (name, isY, cell, fs) {
    var full = armFull(name, isY), cap = armCap(cell, fs);
    if (textRun(full, fs) <= cap) return full;
    var keep = Math.max(1, Math.floor(cap / (fs * 0.58) + 1e-9) - 3);   // the arrow, its space, the ellipsis
    var s = String(name), cut = s.slice(0, keep), sp = cut.lastIndexOf(' ');
    // At a word boundary when one is in the back half: "Physical Circ…", not "Physical Circ p…".
    if (s.charAt(keep) !== ' ' && sp >= Math.ceil(keep / 2)) cut = cut.slice(0, sp);
    return armFull(cut.replace(/\s+$/, '') + '…', isY);
  };
  // A cut label's run is taken as the cap itself, so a box promised at one font size still covers
  // the label drawn at a smaller one (the archetypes size at CF and draw at CF - 1).
  var armRun = function (name, isY, cell, fs) {
    return Math.min(textRun(armFull(name, isY), fs), armCap(cell, fs));
  };
  var geom = function (cell, fontSize) {
    fontSize = Math.max(TYPE_FLOOR, +fontSize || 0);
    var D = 3 * cell * Math.SQRT2, K = Math.SQRT1_2, e = 1.5 * cell, h = D / 2;
    var yy = e + 4 + fontSize, xx = e + 6 + fontSize;   // each label's baseline, out from the centre
    var ax = -e + 2, by = e - 2;                        // where each label meets the corner
    var Lx = armRun(xArm, false, cell, fontSize), Ly = armRun(yArm, true, cell, fontSize);
    // In the grid's frame the x label is the segment (ax..ax+Lx, yy) and the y label
    // (-xx, by-Ly..by); a point (u, v) there lands on screen at (K(u + v), K(v - u)).
    var hL = Math.max(h, K * (xx - by + Ly), -K * (ax + yy));
    var hR = Math.max(h, K * (ax + Lx + yy), K * (by - xx));
    var hT = Math.max(h, -K * (yy - ax - Lx), -K * (by - Ly + xx));
    var hB = Math.max(h, K * (yy - ax), K * (by + xx));
    return { width: Math.round(hL + hR + 8), height: Math.round(hT + hB + 6),
             cx: hL + 4, cy: hT + 3, D: D, e: e };
  };
  var legendSize = function (cell, fontSize) {
    var g = geom(cell, fontSize);
    return { width: g.width, height: g.height };
  };
  var drawLegend = function (svg, o) {
    o = o || {};
    var cell = o.cell || 12, fs = Math.max(TYPE_FLOOR, o.fontSize || TYPE_FLOOR), fg = o.themeFg || '#333';
    var gm = geom(cell, fs), size = { width: gm.width, height: gm.height };
    var g = svg.append('g').attr('class', 'llm-bivariate-legend')
      .attr('transform', 'translate(' + (o.x || 0) + ',' + (o.y || 0) + ')')
      .attr('data-w', size.width).attr('data-h', size.height);
    var D = gm.D;
    var cx = gm.cx, cy = gm.cy;   // the box leans with the labels; the grid is NOT at its centre
    var rot = g.append('g').attr('transform', 'translate(' + cx + ',' + cy + ') rotate(-45)');
    for (var jj = 0; jj < 3; jj++) {
      for (var ii = 0; ii < 3; ii++) {
        rot.append('rect').attr('class', 'llm-bivariate-cell')
          .attr('x', (ii - 1.5) * cell).attr('y', (0.5 - jj) * cell)
          .attr('width', cell).attr('height', cell)
          .attr('fill', colors[jj * 3 + ii]).attr('stroke', '#fff').attr('stroke-width', 0.5);
      }
    }
    // The two axes, drawn along the lower edges; each label's arrow points the way its measure grows.
    var e = 1.5 * cell;
    rot.append('line').attr('x1', -e).attr('y1', e + 3).attr('x2', e).attr('y2', e + 3)
      .attr('stroke', fg).attr('stroke-width', 0.8).attr('opacity', 0.7);
    rot.append('line').attr('x1', -e - 3).attr('y1', e).attr('x2', -e - 3).attr('y2', -e)
      .attr('stroke', fg).attr('stroke-width', 0.8).attr('opacity', 0.7);
    rot.append('text').attr('class', 'llm-bivariate-x').attr('x', -e + 2).attr('y', e + 4 + fs)
      .attr('text-anchor', 'start').attr('font-size', fs).attr('fill', fg)
      .text(armText(xArm, false, cell, fs));
    rot.append('text').attr('class', 'llm-bivariate-y')
      .attr('transform', 'translate(' + (-e - 6 - fs) + ',' + (e - 2) + ') rotate(90)')
      .attr('text-anchor', 'end').attr('font-size', fs).attr('fill', fg)
      .text(armText(yArm, true, cell, fs));
    return { width: size.width, height: size.height };
  };
  return {
    xBin: xBin, yBin: yBin, colors: colors, colorFor: colorFor, primaryColor: primaryColor,
    thirdName: thirdName, occupancy: occupancy, emptyCells: emptyCells,
    thresholds: { x: QX.thresholds, y: QY.thresholds }, paired: xs.length,
    forced: forced, forcedNote: forcedNote, captionText: captionText,
    legendSize: legendSize, drawLegend: drawLegend,
  };
};
// SHARED legend PLACEMENT for a map that gives part of its frame to a legend: a BAND across the
// frame (above the map, or below it) or a COLUMN beside it - whichever leaves the larger map. The
// World and USA choropleths, single-measure and bivariate, place their legend through it.
//
// WHY THE PLACEMENT IS CHOSEN, NOT FIXED. A band costs the map its HEIGHT and a column costs it
// WIDTH, and a map is bound by only one of the two. On a wide, short tile a full-width band takes
// height from a map that was already height-bound, and the frame ends up with side gutters far
// wider than the legend that caused them; on a narrow or tall tile a column takes width the map
// needed. So the map is fitted BOTH ways and the larger fit wins - the column only by a clear
// margin (minGain), so a frame near the boundary keeps the band rather than flipping on a pixel.
//
// WHY IT IS A HELPER. The placement decides the fit box, the zoom area, the map clip, the legend's
// position and where the caption goes, and all of them must agree. Re-typed by hand, one of them
// keeps the old band: the map shrinks for nothing, or the pan catcher lands across the legend.
//
//   var lay = d3.llmLegendLayout({
//     width: W, height: H,
//     legend: { width: lw, height: lh },  // the legend block, labels included, drawn at (lay.legendX, lay.legendY)
//     band: legendBand,                   // the height a band takes off the map in band mode
//     edge: 'top',                        // where a band sits: 'top' (default) or 'bottom'
//     side: 'left',                       // where a column sits: 'left' (default) or 'right'
//     top: 0, bottom: 14,                 // strips the map never takes: a title or scrubber above, the note line below
//     pad: 6, inset: 8,                   // the map box's and the legend's inset from the frame
//     items: [{ text, fontSize, opacity, swatch }],  // caption lines after the legend: one fitted line each beside
//                                         // it in a band, wrapped under it in a column (swatch: a key square's colour)
//     projection: proj, object: fitCol,   // what is fitted - the fitted SCALE decides; proj is left fitted to lay.mapBox
//     fit: function (box) { ... return scale; }   // or a fit of your own (a world map's trim), returning the scale
//   });
//   lay.mode        -> 'band' | 'side'
//   lay.mapBox      -> [[x0, y0], [x1, y1]]: fit the map into this box
//   lay.legendX/Y   -> the legend block's top-left corner
//   lay.zoom        -> { originX, originY, width, height }: the map area for d3.llmGeoZoom, never over the legend
//   lay.clipTop     -> the y a map clip starts at (d3.llmWorldFit's clipTop)
//   lay.scale       -> { band, side }: both fitted scales (side null when no column fits the frame)
//   lay.items       -> [{ x, y, width, fontSize, lines }]: where each caption item goes (y = first baseline)
//   lay.drawItems(parent, { fg }) -> the y under the last item; every line fitted to its room, the whole
//                      text in a <title> when a line had to be cut
d3.llmLegendLayout = function (o) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: a caption line draws no smaller
  o = o || {};
  var W = +o.width > 0 ? +o.width : 0, H = +o.height > 0 ? +o.height : 0;
  var lg = o.legend || {};
  var lw = Math.max(0, +lg.width || 0), lh = Math.max(0, +lg.height || 0);
  var band = Math.max(0, +o.band || 0);
  var edge = o.edge === 'bottom' ? 'bottom' : 'top';
  var side = o.side === 'right' ? 'right' : 'left';
  var top = Math.max(0, +o.top || 0);
  var bottom = o.bottom == null ? 14 : Math.max(0, +o.bottom || 0);
  var pad = o.pad == null ? 6 : Math.max(0, +o.pad || 0);
  var inset = o.inset == null ? 8 : Math.max(0, +o.inset || 0);
  var minGain = +o.minGain > 1 ? +o.minGain : 1.05;
  var maxCol = +o.maxColumn > 0 ? +o.maxColumn : 0.34;   // a column wider than this share of W is never offered
  var LINE_GAP = 4, WRAP_GAP = 2, ITEM_GAP = 8;
  var items = (o.items || []).filter(function (it) { return it && it.text != null && String(it.text) !== ''; });
  var fsOf = function (it) { return Math.max(TYPE_FLOOR, +it.fontSize > 0 ? +it.fontSize : TYPE_FLOOR); };
  // The run of a line, by the 0.6 em the other helpers estimate with: a little wide on purpose, so a
  // line wrapped to the column is not then cut to it by the real glyphs.
  var run = function (s, fs) { return String(s).length * fs * 0.6; };
  var swatchRoom = function (it, fs) { return it.swatch ? Math.round(fs * 0.8) + 4 : 0; };
  var wrap = function (text, width, fs) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (cur && run(t, fs) > width) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  var proj = o.projection, obj = o.object;
  var measure = typeof o.fit === 'function' ? o.fit
    : (proj && obj && typeof proj.fitExtent === 'function')
      ? function (box) { proj.fitExtent(box, obj); return proj.scale(); } : null;
  var scaleOf = function (box) {
    if (!measure || !(box[1][0] - box[0][0] > 1) || !(box[1][1] - box[0][1] > 1)) return null;
    var s = +measure(box);
    return isFinite(s) && s > 0 ? s : null;
  };

  // THE BAND: the frame's full width, the band's height taken off the map at its edge.
  var bandBox = edge === 'top'
    ? [[pad, top + band], [W - pad, H - bottom]]
    : [[pad, top + pad], [W - pad, H - band]];
  // THE COLUMN: the legend's own width plus its inset either side, the full height for the map.
  var colW = Math.ceil(lw + 2 * inset);
  var sideBox = side === 'left'
    ? [[colW, top + pad], [W - pad, H - bottom]]
    : [[pad, top + pad], [W - colW, H - bottom]];
  // In a column the caption wraps to the legend's width, so its height is known before the choice -
  // a column that cannot hold the legend AND its caption above the note line is never offered.
  var sideItems = [], itemsH = 0;
  for (var si = 0; si < items.length; si++) {
    var sfs = fsOf(items[si]);
    var sl = wrap(items[si].text, Math.max(1, lw - swatchRoom(items[si], sfs)), sfs);
    sideItems.push({ it: items[si], fs: sfs, lines: sl });
    itemsH += (si ? LINE_GAP : 0) + sl.length * sfs + (sl.length - 1) * WRAP_GAP;
  }
  var colNeed = inset + lh + (sideItems.length ? ITEM_GAP + itemsH : 0);
  var sideOk = W > 0 && H > 0 && lw > 0 && colW <= W * maxCol && colNeed <= H - top - bottom - 8;

  var sBand = scaleOf(bandBox);
  var sSide = sideOk ? scaleOf(sideBox) : null;
  var useSide = sSide !== null && sBand !== null && sSide >= sBand * minGain;
  // The projection is left fitted to the box chosen, so a caller that passed one can draw with it as is.
  if (sSide !== null && !useSide) scaleOf(bandBox);

  var lay = { mode: useSide ? 'side' : 'band', scale: { band: sBand, side: sSide } };
  if (useSide) {
    lay.mapBox = sideBox;
    lay.legendX = side === 'left' ? inset : W - inset - lw;
    lay.legendY = edge === 'top' ? top + inset : H - lh;
    lay.zoom = side === 'left'
      ? { originX: colW - 4, originY: top + 2, width: Math.max(1, W - colW + 4), height: Math.max(1, H - top - 2) }
      : { originX: 0, originY: top + 2, width: Math.max(1, W - colW + 4), height: Math.max(1, H - top - 2) };
    lay.clipTop = top;
  } else {
    lay.mapBox = bandBox;
    lay.legendX = edge === 'bottom' && side === 'right' ? W - inset - lw : inset;
    lay.legendY = edge === 'top' ? top + inset : H - lh;
    lay.zoom = edge === 'top'
      ? { originX: 0, originY: top + band - 4, width: W, height: Math.max(1, H - (top + band - 4)) }
      : { originX: 0, originY: top + 2, width: W, height: Math.max(1, H - band - (top + 2)) };
    lay.clipTop = edge === 'top' ? top + band - 4 : top;
  }

  // WHERE THE CAPTION GOES. Beside the legend in a band, each item one line fitted to the room right of
  // it (as the band always drew it); under the legend in a column, each item wrapped to the legend's
  // width - above it when the legend sits at the column's foot.
  lay.items = [];
  if (useSide) {
    var y = edge === 'top' ? lay.legendY + lh + ITEM_GAP : lay.legendY - ITEM_GAP - itemsH;
    for (var k = 0; k < sideItems.length; k++) {
      var s = sideItems[k];
      y += (k ? LINE_GAP : 0) + s.fs;
      lay.items.push({ x: lay.legendX, y: y, width: lw, fontSize: Math.max(TYPE_FLOOR, s.fs), lines: s.lines, item: s.it });
      y += (s.lines.length - 1) * (s.fs + WRAP_GAP);
    }
  } else {
    var bx = lay.legendX + lw + 12, by = lay.legendY;
    for (var b = 0; b < items.length; b++) {
      var bfs = fsOf(items[b]);
      by += (b ? LINE_GAP : 2) + bfs;
      lay.items.push({ x: bx, y: by, width: Math.max(0, W - bx - 8), fontSize: Math.max(TYPE_FLOOR, bfs), lines: [String(items[b].text)], item: items[b] });
    }
  }

  // Each line is fitted to its room (d3.llmFitLabel when the chart has it, else the estimated prefix
  // cut) - a column line was wrapped to fit, so it is cut only when the real glyphs run wider than the
  // estimate; a band line keeps the band's old rule, the widest prefix that fits.
  var fitLine = function (sel, room, text) {
    if (typeof d3.llmFitLabel === 'function') { d3.llmFitLabel(sel, room, { pad: 0, text: text }); return; }
    var fs = parseFloat(sel.attr('font-size')) || TYPE_FLOOR;
    if (run(text, fs) <= room) { sel.text(text); return; }
    var n = Math.max(0, Math.floor(room / (fs * 0.6)) - 1);
    sel.text(n > 0 ? text.slice(0, n) + '\u2026' : '');
  };
  lay.drawItems = function (parent, d) {
    d = d || {};
    var fg = d.fg || '#333', yEnd = lay.legendY + lh;
    if (!parent || !lay.items.length) return yEnd;
    var g = parent.append('g').attr('class', 'llm-legend-caption');
    for (var i = 0; i < lay.items.length; i++) {
      var p = lay.items[i], it = p.item, fs = Math.max(TYPE_FLOOR, p.fontSize), sw = swatchRoom(it, fs);
      // One group per item at its first baseline, so an item reads (and is found) as one block.
      var ig = g.append('g').attr('transform', 'translate(' + p.x + ',' + p.y + ')');
      if (it.swatch) {
        var sq = Math.round(fs * 0.8);
        ig.append('rect').attr('y', 1 - sq).attr('width', sq).attr('height', sq)
          .attr('fill', it.swatch).attr('stroke', '#ccc').attr('stroke-width', 0.5);
      }
      var full = String(it.text), cut = false, first = null;
      for (var j = 0; j < p.lines.length; j++) {
        var t = ig.append('text').attr('x', sw).attr('y', j * (fs + WRAP_GAP))
          .attr('font-size', fs).attr('fill', fg);
        if (it.opacity != null) t.attr('fill-opacity', it.opacity);
        fitLine(t, Math.max(0, p.width - sw), p.lines[j]);
        if (t.text() !== p.lines[j]) cut = true;
        if (!first) first = t;
      }
      // A sentence broken over lines, or cut, still reads whole on hover.
      if (first && (cut || p.lines.length > 1)) first.append('title').text(full);
      yEnd = p.y + (p.lines.length - 1) * (fs + WRAP_GAP) + Math.round(fs * 0.25);
    }
    return yEnd;
  };
  return lay;
};


function render(container, data, options) {
  container.replaceChildren();
  const TYPE_FLOOR = 10;
  const columns = data.columns, rows = data.rows;
  const W = options.width, H = options.height;
  const CF = Math.max(TYPE_FLOOR, Math.min(14, Math.round(Math.min(W, H) / 55)));
  const SUB_FS = Math.max(TYPE_FLOOR, CF - 1), SMALL_FS = Math.max(TYPE_FLOOR, CF - 2);
  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  const fmt = new Intl.NumberFormat(options.cultureCode || 'en-US', { maximumSignificantDigits: 3 });
  const geo = options.geo;
  const themeFg = options.themeFg || 'currentColor';
  svg.append('rect').attr('width', W).attr('height', H).attr('fill', options.backgroundColor || '#ffffff').style('pointer-events', 'none');

  const ci = n => columns.findIndex(c => c.name === n);
  const isoIdx = ci('__geoIso__'), idxIdx = ci('__rowIdx__');
  const xIdx = ci('RevenuePerCapita'), yIdx = ci('ReturnRate');
  const labelIdx = ci('Country'), codeIdx = ci('CountryCode');
  if (xIdx < 0) throw new Error('INVALID:column "RevenuePerCapita" not found');
  if (yIdx < 0) throw new Error('INVALID:column "ReturnRate" not found');
  const xName = 'RevenuePerCapita', yName = 'ReturnRate';

  const byIso = new Map();
  const numOf = v => (v == null || v === '' || !isFinite(+v)) ? null : +v;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], iso = isoIdx >= 0 ? row[isoIdx] : null;
    if (iso == null || iso === '') continue;
    let g = byIso.get(iso);
    if (!g) { g = { iso: iso, label: labelIdx >= 0 ? row[labelIdx] : iso, code: codeIdx >= 0 ? row[codeIdx] : iso, x: null, y: null, xs: [], ys: [], idx: [] }; byIso.set(iso, g); }
    const xv = numOf(row[xIdx]), yv = numOf(row[yIdx]);
    if (xv != null) g.xs.push(xv);
    if (yv != null) g.ys.push(yv);
    g.idx.push(idxIdx >= 0 ? row[idxIdx] : r);
  }
  if (!geo || !geo.features || byIso.size === 0) {
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('fill', themeFg).text(options.noDataText || 'No data to display');
    return;
  }
  const agg = a => {
    const m = (options.aggregation || '').toLowerCase();
    if (m === 'average') return d3.mean(a);
    if (m === 'median') return d3.median(a);
    if (m === 'min') return d3.min(a);
    if (m === 'max') return d3.max(a);
    if (m === 'count') return a.length;
    if (m === 'distinct') return new Set(a).size;
    return d3.sum(a);
  };
  byIso.forEach(g => { g.x = g.xs.length ? agg(g.xs) : null; g.y = g.ys.length ? agg(g.ys) : null; });
  const matched = [];
  const featById = new Map(geo.features.map(f => [f.id, f]));
  byIso.forEach(g => { const f = featById.get(g.iso); if (f) matched.push(f); });

  const regions = Array.from(byIso.values());
  const biv = d3.llmBivariate({
    x: regions.map(g => g.x), y: regions.map(g => g.y), xLabel: xName, yLabel: yName,
    colorScaleLow: options.colorScaleLow, colorScaleHigh: options.colorScaleHigh,
    palettePrimary: '#3b4994'
  });
  const cell = Math.max(10, Math.min(16, Math.round(Math.min(W, H) / 32)));
  const lsz = biv.legendSize(cell, CF);
  const degrade = (lsz.height + 16) > H * 0.34;
  const LEGW = 120, LEGH = 8;
  const legendBand = degrade ? (8 + LEGH + 16 + LEGH + 6) : (8 + lsz.height + 4);
  const land = options.geoLandColor || '#e6e6e6';
  const noData = options.geoNoDataColor || land;
  let ndCount = 0; byIso.forEach(g => { if (g.x == null || g.y == null) ndCount++; });
  const regTxt = biv.paired + ' ' + (biv.paired === 1 ? 'region' : 'regions') + ' in ' + (9 - biv.emptyCells) + ' of 9 cells' + (biv.emptyCells ? ' (' + biv.emptyCells + ' empty)' : '');
  const capItems = degrade
    ? [{ text: 'Tile too short for the two-way legend - shading by ' + xName + ' only', fontSize: SUB_FS, opacity: 0.8 }]
    : [{ text: biv.captionText, fontSize: CF, opacity: 0.85 }, { text: regTxt, fontSize: SUB_FS, opacity: 0.7 }]
        .concat(biv.forcedNote ? [{ text: biv.forcedNote, fontSize: SUB_FS, opacity: 0.7 }] : [])
        .concat(ndCount > 0 && noData !== land ? [{ text: 'no data', fontSize: SMALL_FS, swatch: noData }] : []);
  const legendBox = degrade ? { width: LEGW, height: legendBand - 8 } : { width: biv.legendSize(cell, SUB_FS).width, height: lsz.height };
  const proj = d3.geoNaturalEarth1();
  const worldFit = (box, clipTop) => d3.llmWorldFit(proj, { geo: geo, regions: geo.features, width: W, height: H - 10, viewport: [W, H], box: box, fitPolygons: true, clipTop: clipTop });
  const lay = d3.llmLegendLayout({ width: W, height: H, legend: legendBox, band: legendBand, items: capItems, fit: box => worldFit(box, 0).projection.scale() });
  const wf = worldFit(lay.mapBox, lay.clipTop);
  const path = wf.path;
  const fillFor = g => {
    if (!g) return land;
    if (degrade) return g.x == null ? noData : biv.primaryColor(g.x);
    return (g.x == null || g.y == null) ? noData : biv.colorFor(g.x, g.y);
  };
  const z = d3.llmGeoZoom(svg, { width: lay.zoom.width, height: lay.zoom.height, originX: lay.zoom.originX, originY: lay.zoom.originY, themeFg: themeFg, backgroundColor: options.backgroundColor, fontSize: CF, maxScale: 8 });
  const gMap = z.group({ stroke: 0.5, dotStroke: 0.7 });
  wf.clip(svg, gMap);
  const cxy = (c, i) => (c && isFinite(c[i]) ? Math.round(c[i] * 10) / 10 : null);
  const polys = geo.features.filter(f => f.geometry && f.geometry.type !== 'Point');
  gMap.selectAll('path').data(polys, f => f.id).join('path')
    .attr('d', path)
    .attr('class', f => byIso.has(f.id) ? 'd3-mark' : null)
    .attr('data-row-idx', f => byIso.has(f.id) ? byIso.get(f.id).idx.join(',') : null)
    .attr('data-cx', f => byIso.has(f.id) ? cxy(path.centroid(f), 0) : null)
    .attr('data-cy', f => byIso.has(f.id) ? cxy(path.centroid(f), 1) : null)
    .style('cursor', f => byIso.has(f.id) ? 'pointer' : null)
    .attr('fill', f => fillFor(byIso.get(f.id)))
    .attr('stroke', '#fff').attr('stroke-width', 0.5);
  const pts = matched.filter(f => f.geometry && f.geometry.type === 'Point');
  const pr = Math.max(3, Math.min(7, Math.round(Math.min(W, H) / 90)));
  gMap.selectAll('circle').data(pts, f => f.id).join('circle')
    .attr('class', 'd3-mark').style('cursor', 'pointer')
    .attr('cx', f => proj(f.geometry.coordinates)[0]).attr('cy', f => proj(f.geometry.coordinates)[1])
    .attr('r', pr)
    .attr('data-row-idx', f => byIso.get(f.id).idx.join(','))
    .attr('data-cx', f => proj(f.geometry.coordinates)[0]).attr('data-cy', f => proj(f.geometry.coordinates)[1])
    .attr('fill', f => fillFor(byIso.get(f.id)))
    .attr('stroke', '#333').attr('stroke-width', 0.7);

  const partText = (name, v, bin) => name + ': ' + (v == null ? 'no data' : fmt.format(v) + ' (' + biv.thirdName(bin) + ')');
  const tipText = g => {
    const head = g.label + ' (' + g.code + ')';
    if (g.x == null && g.y == null) return head + ' - no data';
    return head + ' - ' + partText(xName, g.x, g.x == null ? null : biv.xBin(g.x)) + ' | ' + partText(yName, g.y, g.y == null ? null : biv.yBin(g.y)) + (g.idx.length > 1 ? ' | ' + g.idx.length + ' rows' : '');
  };
  if (options.allowTooltips !== false) {
    gMap.selectAll('.d3-mark').append('title').text(f => tipText(byIso.get(f.id)));
  }

  const unm = options.geoUnmatched && options.geoUnmatched.count;
  if (unm > 0) {
    const unmText = unm + (unm === 1 ? ' region unmatched' : ' regions unmatched');
    const unmG = svg.append('g');
    const unmT = unmG.append('text').attr('x', 8).attr('y', H - 12).attr('font-size', CF).attr('fill', themeFg);
    d3.llmFitLabel(unmT, W - 16, { pad: 0, text: unmText });
  }

  const LEGX = lay.legendX, LEGY = lay.legendY;
  if (!degrade) {
    const L = biv.drawLegend(svg, { x: LEGX, y: LEGY, cell: cell, fontSize: SUB_FS, themeFg: themeFg });
    if (lay.mode === 'side') {
      lay.drawItems(svg, { fg: themeFg });
    } else {
      const tx = LEGX + L.width + 12;
      const cap = svg.append('g').attr('transform', 'translate(' + tx + ',' + (LEGY + CF + 2) + ')');
      const capRoom = W - tx - 8;
      const capT = cap.append('text').attr('font-size', CF).attr('fill', themeFg).attr('fill-opacity', 0.85);
      d3.llmFitLabel(capT, capRoom, { pad: 0, text: biv.captionText });
      if (capT.text() !== biv.captionText) capT.append('title').text(biv.captionText);
      cap.append('text').attr('y', CF + 4).attr('font-size', SUB_FS).attr('fill', themeFg).attr('fill-opacity', 0.7).text(regTxt);
      if (biv.forcedNote) {
        const fnT = cap.append('text').attr('y', 2 * CF + 8).attr('font-size', SUB_FS).attr('fill', themeFg).attr('fill-opacity', 0.7);
        d3.llmFitLabel(fnT, capRoom, { pad: 0, text: biv.forcedNote });
      }
      if (ndCount > 0 && noData !== land) {
        const S = cap.append('g').attr('transform', 'translate(0,' + (biv.forcedNote ? 3 * CF + 12 : 2 * CF + 8) + ')');
        S.append('rect').attr('width', LEGH).attr('height', LEGH).attr('fill', noData).attr('stroke', themeFg).attr('stroke-opacity', 0.3);
        S.append('text').attr('x', LEGH + 4).attr('y', LEGH - 1).attr('font-size', SMALL_FS).attr('fill', themeFg).text('no data');
      }
    }
  } else {
    const xsAll = regions.map(g => g.x).filter(v => v != null);
    const lo = xsAll.length ? d3.min(xsAll) : 0, hi = xsAll.length ? d3.max(xsAll) : 1;
    const gid = 'llmgeo-' + Math.abs((W * 131 + H) | 0);
    const lg = svg.append('defs').append('linearGradient').attr('id', gid);
    lg.append('stop').attr('offset', '0%').attr('stop-color', biv.colors[0]);
    lg.append('stop').attr('offset', '100%').attr('stop-color', biv.colors[2]);
    const L = svg.append('g').attr('transform', 'translate(' + LEGX + ',' + LEGY + ')');
    L.append('rect').attr('width', LEGW).attr('height', LEGH).attr('fill', 'url(#' + gid + ')');
    L.append('text').attr('y', LEGH + 12).attr('font-size', SMALL_FS).attr('fill', themeFg).text(fmt.format(lo));
    L.append('text').attr('x', LEGW).attr('y', LEGH + 12).attr('text-anchor', 'end').attr('font-size', SMALL_FS).attr('fill', themeFg).text(fmt.format(hi));
    if (lay.mode === 'side') lay.drawItems(svg, { fg: themeFg });
    else svg.append('text').attr('x', LEGX + LEGW + 12).attr('y', LEGY + LEGH + 2).attr('font-size', SUB_FS).attr('fill', themeFg).text('Tile too short for the two-way legend - shading by ' + xName + ' only');
  }
}
