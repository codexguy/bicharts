// BIC generated chart — What-if scenarios [D3]
// host contract v1.24.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// TWEEN BETWEEN KEYFRAMES - VALUE CHANNELS INTERPOLATE ONLY BETWEEN REAL VALUES.
// R11 A-B Year: "there's no real tweening here, it just jumps as years
// change... how hard would it be to apply the general tweening principle without having
// LLM's 'get it wrong' over any/all chart types." The scrubber has ALWAYS passed
// renderFrame an `animate` flag ("animate=true means tween"); measured on one generation, the
// generation declared the parameter and discarded it - zero .transition( calls in 19,445
// chars. Same failure class as the tooltip clamp and the no-data fill: variance, not
// incapacity, so the behaviour moves into a helper the chart can only CALL.
//
// THE SAFETY DOCTRINE (llmFrameFill's, generalized to geometry): an intermediate position
// on a value scale asserts a measurement that was never made. So a mark tweens ONLY when
// BOTH endpoints are real; everything else SNAPS:
//   * target null/undefined/NaN  -> snap; a null writes attr(null), REMOVING the attribute,
//     so a period with no data draws NOTHING - never a zero-height bar, never a value
//     part-way to one (llmKeyframes hands null for an empty bucket, NEVER 0 - honour it).
//   * current attr missing       -> the mark is ENTERING; it appears in place, full-size.
//     Growing from zero would animate a rise from a value that never existed.
//   * string channels (transform, d) tween only when current and target carry the SAME
//     COUNT of numeric tokens; a structure mismatch snaps rather than letting d3's string
//     interpolator pair unrelated numbers into garbage mid-frames.
// The helper NEVER removes nodes - the join (enter/exit) belongs to the chart. Fills with
// a no-data colour stay on d3.llmFrameFill, which owns the resolved-colour compare; this
// helper deliberately does not call it (helpers are injected independently, and a helper
// that depends on a helper the generation never named would arrive half-armed).
//
// Contract:
//   d3.llmFrameTween(sel, {
//     animate: animate,               // renderFrame's own flag; false = synchronous write
//     ms: options.animPlaySpeedMs,    // frame budget; tween takes ~60%, capped at 600ms
//     attrs: { y: d=>..., height: d=>..., x: d=>... }   // accessors, like sel.attr
//   });
// Returns sel. Snapped nodes are interrupt()ed first, so a still-running previous frame
// cannot keep writing interpolated values over the snap (the llmFrameFill lesson).
d3.llmFrameTween = function (sel, cfg) {
  cfg = cfg || {};
  var attrs = cfg.attrs || {};
  var names = Object.keys(attrs);
  if (!sel || typeof sel.each !== 'function' || !names.length) return sel;
  var ms = +cfg.ms > 0 ? +cfg.ms : 1000;
  // ~60% of the frame budget, capped: a 900ms tween inside a 1000ms frame is how the fill
  // helper's bug happened - the chart spent its whole life mid-interpolation.
  var dur = Math.max(120, Math.min(600, Math.round(ms * 0.6)));
  var animate = !!cfg.animate;
  var numTok = function (v) {
    var m = String(v).match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi);
    return m ? m.length : 0;
  };

  sel.each(function (d, i, grp) {
    var el = this, snap = false;
    for (var k = 0; k < names.length; k++) {
      var name = names[k];
      var a = attrs[name];
      var target = (typeof a === 'function') ? a.call(el, d, i, grp) : a;
      if (target == null) { snap = true; break; }                    // absence: draw nothing
      var cur = el.getAttribute(name);
      if (cur == null || cur === '') { snap = true; break; }         // entering: no origin
      if (typeof target === 'number') {
        if (!isFinite(target) || !isFinite(parseFloat(cur))) { snap = true; break; }
      } else {
        var tt = numTok(target);
        if (!tt || tt !== numTok(cur)) { snap = true; break; }       // structure mismatch
      }
    }
    el.__llmSnapFrame = snap;
  });

  var write = function (s, tween) {
    if (!tween) { for (var k = 0; k < names.length; k++) s.attr(names[k], attrs[names[k]]); return; }
    var t = s.transition().duration(dur).ease(d3.easeCubicInOut);
    for (var k2 = 0; k2 < names.length; k2++) (function (name) {
      var a = attrs[name];
      if (name === 'transform') {
        // NEVER d3's SVG transform interpolator here: it reads svgNode.transform.baseVal, which
        // is absent on incomplete SVG DOMs and THROWS mid-tween (surfaced by the Animated bar
        // chart smoke in jsdom). Numeric-token count already matched (structure check above), so
        // a plain string interpolation of the numbers is exact for translate()/scale() strings.
        t.attrTween(name, function (d, i, grp) {
          var to = (typeof a === 'function') ? a.call(this, d, i, grp) : a;
          var from = this.getAttribute(name);
          var ip = d3.interpolateString(from == null ? '' : String(from), to == null ? '' : String(to));
          return function (tt) { return ip(tt); };
        });
      } else {
        t.attr(name, a);
      }
    })(names[k2]);
  };
  var snapSel = sel.filter(function () { return this.__llmSnapFrame; });
  snapSel.interrupt();
  write(snapSel, false);
  write(sel.filter(function () { return !this.__llmSnapFrame; }), animate);
  return sel;
};
d3.llmSlider = function (svg, cfg) {
  // ONE-HANDLE KNOB THE READER OWNS. The single-handle sibling of llmRangeBrush.
  //
  //   d3.llmSlider(svg, cfg) where cfg =
  //     container  : the render container (the shared knob bag lives on it as container.__lchKnobs)
  //     options    : host options (uiState, setUiState, themeFg, themeAccent, width, height)
  //     key        : this knob's name inside the bag ('rate', 'horizon', 'base', ...)
  //     domain     : [min, max] for a NUMERIC knob, or
  //     snapValues : SORTED array of allowed values (dates or numbers) for a SNAP knob - one of the two
  //     step       : numeric step for a numeric knob (default (max-min)/100)
  //     value      : opening value, used ONLY when nothing restores from uiState.knobs[key]; then cfg.default
  //     default    : the value the reset returns to
  //     x, y, width: the track's left, baseline y and pixel width
  //     fontSize   : the chart's own FS - PASS IT. Default is the archetype rule,
  //                  clamp(TYPE_FLOOR..14, min(width, height) / 55) read off options. A size below
  //                  TYPE_FLOOR (the minimum readable type) is raised to it.
  //     label      : text drawn left of the [-] stepper ('growth per period')
  //     labelRoom  : px available to the label, measured leftwards from the [-] box; a longer
  //                  label is truncated with an ellipsis rather than running off the frame
  //     format     : function (v) -> string for the value readout
  //     steppers   : true (default) draws [-] and [+] with >= 20x20 hit rects
  //     onChange   : function (value, phase) - phase is 'init' | 'drag' | 'end' | 'reset'
  //   returns { value(), set(v, fire), reset(fire), g, bounds() }
  //     bounds() -> { left, right }: the strip's estimated horizontal extent in px (label through
  //                  readout), so a caller can place a reset pill or a caption clear of it.
  //   d3.llmSlider.textWidth(txt, fontSize) is the estimate this helper lays out with - real
  //   metrics in a browser are used where a node can report them; the estimate is the floor.
  //
  // ROW ORDER IS FIXED: label | [-] | track | [+] | readout, each slot placed off its NEIGHBOUR.
  // The first version anchored the label AND the [-] box to the track's left end, and the
  // readout AND the [+] box to its right end, so a label wider than 26px ran under the button
  // and a readout wider than "+3.8%" ran under the [+] - which "12 months", the what-if
  // archetype's own default, already is. Seen on the first human render of the what-if projection.
  //
  // THE FONT IS THE CHART'S. A helper sizing itself from options.width alone drew 14px text
  // on a 1230x404 tile whose chart was at 9px - the strip was 55% larger than everything it sat
  // beside, and every gap the archetype reserved was in the smaller unit. The caller passes
  // its FS; the default reproduces the archetype rule so an omitted FS still agrees.
  //
  // The track, handle and steppers are CONTROLS, not marks: no d3-mark, no data-row-idx, no
  // d3-axis-filter, so nothing here ever cross-filters.
  //
  // PERSISTENCE FIRES ON 'end' AND 'reset' ONLY, never mid-drag, and writes the WHOLE bag:
  // setUiState({ knobs: {...every knob on this container...} }) merged over whatever uiState
  // already carried for OTHER keys. The persisting host REPLACES the bag rather than merging it,
  // so two knobs writing separately would clobber each other and a chart that also persists a
  // frame or a selection would lose it. One bag per container is what prevents that.
  //
  // A RESTORED VALUE IS UNTRUSTED: out of domain, not a number, or not near any snap -> the
  // default. Never a throw. Generated charts are committed source and outlive the state they
  // wrote; the execution gate deliberately hands this helper a poisoned bag to prove it.
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
  if (!svg || (!isSnap && !numericOk)) return noop;
  var isDate = isSnap && snaps[0] instanceof Date;
  var fg = options.themeFg || '#252423', accent = options.themeAccent || fg;
  var x = cfg.x != null ? cfg.x : 0, y = cfg.y != null ? cfg.y : 0, w = cfg.width != null ? cfg.width : 120;
  var step = isSnap ? 1 : (+cfg.step > 0 ? +cfg.step : (dom[1] - dom[0]) / 100);
  var fmt = typeof cfg.format === 'function' ? cfg.format
    : function (v) { return isDate ? new Date(+v).toISOString().slice(0, 10) : String(v); };
  var fsz = Math.max(TYPE_FLOOR, +cfg.fontSize > 0 ? +cfg.fontSize
    : Math.min(14, Math.min(options.width || 600, options.height || 400) / 55));
  var fszSub = Math.max(TYPE_FLOOR, fsz * 0.9);   // label and readout: one size for the drawing and the measure
  var tw = d3.llmSlider.textWidth;
  var withSteppers = cfg.steppers !== false;
  // THE SLOTS, left to right. Each edge is its neighbour's edge plus a gap - the only way a
  // label, a button and a readout of unknown widths can be guaranteed never to share pixels.
  var gap = fsz * 0.6, box = Math.max(20, Math.round(fsz * 1.5));
  var minusLeft = x - gap - box;                                   // [-] box spans [minusLeft, x - gap]
  var labelRight = withSteppers ? minusLeft - fsz * 0.5 : x - fsz * 0.8;
  var plusLeft = x + w + gap;                                      // [+] box spans [plusLeft, plusLeft + box]
  var readoutLeft = withSteppers ? plusLeft + box + fsz * 0.5 : x + w + fsz * 0.8;

  // ONE BAG PER CONTAINER: every slider on this chart reads and writes the same object.
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
    return Math.round((f - dom[0]) / step) * step + dom[0];
  }

  var cur = coerce(restored);
  if (cur === null) cur = coerce(cfg.value);
  if (cur === null) cur = coerce(cfg['default']);
  if (cur === null) cur = isSnap ? 0 : dom[0];

  var scale = isSnap ? d3.scaleLinear().domain([0, snaps.length - 1]).range([x, x + w])
                     : d3.scaleLinear().domain(dom).range([x, x + w]);

  var g = svg.append('g').attr('class', 'llm-slider');
  var labelText = '', labelW = 0;
  if (cfg.label) {
    labelText = String(cfg.label);
    var labelNode = g.append('text').attr('class', 'llm-slider-label')
      .attr('x', labelRight).attr('y', y + fsz * 0.35).attr('text-anchor', 'end')
      .attr('font-size', fszSub).attr('fill', fg).text(labelText);
    labelW = measure(labelNode, labelText, fszSub);
    // labelRoom is the caller's promise of how much frame lies left of the [-] box. Truncate to
    // it - the widest prefix plus an ellipsis - rather than let the label run off the frame.
    if (+cfg.labelRoom > 0 && labelW > +cfg.labelRoom) {
      var keep = labelText;
      while (keep.length > 1 && measure(labelNode, keep + '…', fszSub) > +cfg.labelRoom) keep = keep.slice(0, -1);
      labelText = keep.length > 1 ? keep + '…' : '';
      labelNode.text(labelText);
      labelW = labelText ? measure(labelNode, labelText, fszSub) : 0;
    }
  }
  g.append('line').attr('class', 'llm-slider-track')
    .attr('x1', x).attr('x2', x + w).attr('y1', y).attr('y2', y)
    .attr('stroke', fg).attr('stroke-width', 2).attr('opacity', 0.35);
  var handle = g.append('g').attr('class', 'llm-slider-handle').attr('cursor', 'ew-resize');
  handle.append('circle').attr('r', fsz * 0.55).attr('cy', y).attr('fill', accent)
    .attr('stroke', fg).attr('stroke-width', 1);
  // HIT FLOOR: a 24px square behind an 8px dot. A knob nobody can grab is a knob that does not
  // exist, and the dot is sized for reading, not for pointing.
  handle.append('rect').attr('x', -12).attr('y', y - 12).attr('width', 24).attr('height', 24)
    .attr('fill', 'transparent').attr('pointer-events', 'all');
  var readout = g.append('text').attr('class', 'llm-slider-readout')
    .attr('x', readoutLeft).attr('y', y + fsz * 0.35)
    .attr('font-size', fszSub).attr('fill', fg);
  var readoutText = '';

  // Real metrics where the node can report them (a browser); the shared estimate everywhere
  // else (the jsdom exec gate has no getComputedTextLength). Never throws, never assumes it fits.
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
    handle.attr('transform', 'translate(' + scale(cur) + ',0)');
    readoutText = String(fmt(valueOf()));
    readout.text(readoutText);
  }
  function persist(phase) {
    bag[key] = stored();
    onChange(valueOf(), phase);
    if (typeof options.setUiState !== 'function') return;
    // BASE = the last full state any helper wrote during THIS render, else the render-time
    // uiState. Copying only the render-time bag put back a scrubber frame the
    // reader had already moved on from; container.__lchUiLive is the shared record, valid
    // while options and the uiState it was seeded from are the same objects.
    var live = container && container.__lchUiLiveOpts === options && container.__lchUiLiveSeed === options.uiState
      ? container.__lchUiLive : null;
    var base = live || ui;
    var next = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
    next.knobs = {};
    for (k in bag) if (Object.prototype.hasOwnProperty.call(bag, k)) next.knobs[k] = bag[k];
    if (container) { container.__lchUiLive = next; container.__lchUiLiveOpts = options; container.__lchUiLiveSeed = options.uiState; }
    // Best-effort: a host that refuses the write must never take the chart down with it.
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
    var s = parent.append('g').attr('class', 'llm-slider-step').attr('cursor', 'pointer')
      .on('click', function () { nudge(dir); });
    s.append('rect').attr('x', left).attr('y', y - box / 2).attr('width', box).attr('height', box)
      .attr('rx', 3).attr('fill', 'transparent').attr('stroke', fg).attr('opacity', 0.6);
    s.append('text').attr('x', left + box / 2).attr('y', y + fsz * 0.35).attr('text-anchor', 'middle')
      .attr('font-size', fsz).attr('fill', fg).text(dir < 0 ? '-' : '+');
    return s;
  }
  if (withSteppers) {
    var stepG = g.append('g').attr('class', 'llm-slider-steppers');
    mkStepper(stepG, -1, minusLeft);
    mkStepper(stepG, +1, plusLeft);
  }

  handle.call(d3.drag()
    .on('drag', function (event) {
      // No pixel clamp here on purpose: setCur owns clamping, and every other entry point
      // (set, a stepper, reset, an untrusted restore) reaches the domain through it. A second
      // clamp on this one path cannot fire, and a rule with two owners drifts.
      var v = scale.invert(event.x);
      setCur(isSnap ? v : Math.round((v - dom[0]) / step) * step + dom[0], 'drag');
    })
    .on('end', function () { persist('end'); }));

  paint();
  bag[key] = stored();
  onChange(valueOf(), 'init');
  return {
    value: valueOf,
    g: g,
    set: function (v, fire) { var c = coerce(v); if (c === null) return; setCur(c, fire === false ? 'drag' : 'end'); },
    reset: function (fire) { var c = coerce(cfg['default']); if (c === null) return; setCur(c, fire === false ? 'drag' : 'reset'); },
    bounds: function () {
      var left = labelText ? labelRight - labelW : (withSteppers ? minusLeft : x);
      var right = readoutLeft + measure(readout, readoutText, fszSub);
      return { left: left, right: right };
    }
  };
};
// The width estimate the slider lays out with when no node can measure - the same constant
// llmFitLabel falls back to, so the two helpers agree about how wide a string is.
d3.llmSlider.textWidth = function (txt, fontSize) {
  return String(txt == null ? '' : txt).length * (+fontSize > 0 ? +fontSize : 10) * 0.6;
};
// SHARED animation scrubber for ALL animated D3 chart types (treemap, choropleth, ...). Owns the
// line/boxes period timeline, the play/All controls, the frame + selIdx + timer STATE MACHINE, the
// cross-filter contract (data-row-idx tick marks + llm-xfilter-refresh dispatch), and the container
// hooks (__llmAnimStop / __llmXfClear / __llmInitialXfMark). The CHART supplies only its per-frame
// draw via cfg.renderFrame(i, animate) and a layout. ONE code base so the interaction can't drift.
//
// d3.llmScrubber(svg, cfg) where cfg =
//   keys          : ordered period labels (from d3.llmKeyframes)
//   container     : the visual container element (for events + hooks)
//   options       : host options (uiState, animStopAtEnd, filtersDuringPlay, animAutoPlay,
//                   animPlaySpeedMs, animLoopDelaySec, animTimelineStyle, themeFg, themeAccent,
//                   setUiState, width)
//   renderFrame   : (i, animate) => void   -- chart draws its marks for keyframe i (i<0 = All);
//                   animate=true means tween (goTo), false means synchronous (first paint)
//   periodRowIdx  : (i) => string          -- joined row indices for keyframe i (tick filter marks)
//   layout        : { x0, x1, trackY, playX, playR, allX, allLabelDy, padding,
//                     label:{x,y,size,weight}, tickLabels:{y,everyPx} | falsy }
//   crossFilter   : default true. FALSE when the frames are NOT DATA - a sweep over a
//                   parameter's values (scenarios), not over periods of rows. The ticks then
//                   carry no d3-axis-filter class and no data-row-idx, no llm-xfilter-refresh
//                   is dispatched and no __llmXfClear / __llmInitialXfMark slot is installed:
//                   a scenario never selects, filters or clears report rows.
//   allLabel      : the caption for the All frame (default 'All periods').
// returns { goTo, stopPlay, frame(), selIdx(), ticks, sx }
d3.llmScrubber = function (svg, cfg) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: the period label, tick labels and 'All' draw no smaller
  var keys = cfg.keys, container = cfg.container, options = cfg.options || {};
  var renderFrame = cfg.renderFrame, rowIdxAt = cfg.periodRowIdx || function () { return ''; };
  var xf = cfg.crossFilter !== false, allLabel = cfg.allLabel ? String(cfg.allLabel) : 'All periods';
  var W = options.width, L = cfg.layout || {};
  var x0 = L.x0 != null ? L.x0 : 52, x1 = L.x1 != null ? L.x1 : (W - 40), trackY = L.trackY != null ? L.trackY : 30;
  var playX = L.playX != null ? L.playX : 24, playR = L.playR != null ? L.playR : 11;
  var allX = L.allX != null ? L.allX : (W - 18), allDy = L.allLabelDy != null ? L.allLabelDy : 18;
  var pad = L.padding != null ? L.padding : 0.5;
  var tf = options.themeFg || '#111', ac = options.themeAccent || tf;
  var sx = d3.scalePoint(keys, [x0, x1]).padding(pad);
  var kIdx = new Map(keys.map(function (k, i) { return [k, i]; }));
  var styleOpt = (options.animTimelineStyle || 'auto').toLowerCase();
  var useLine = styleOpt === 'line' || (styleOpt !== 'boxes' && keys.length > 30);
  var speed = Math.max(250, Math.min(5000, +options.animPlaySpeedMs || 1000));
  // Loop-restart delay: seconds to rest on the All overview between the end
  // of an auto-play pass and the next one. Absent/0 = restart immediately (the legacy observed
  // behavior); a huge value (e.g. 1000000) = effectively play ONCE per viewing.
  var loopDelayMs = Math.max(0, (+options.animLoopDelaySec || 0) * 1000);
  var ui = options && options.uiState, hadUi = ui && Number.isInteger(ui.frame);
  // Sticky across re-renders; cleared only by the user pressing play again.
  var userStopped = !!(ui && ui.userStopped);
  var defFrame = options.animStopAtEnd ? keys.length - 1 : -1;
  var defSel = (options.animStopAtEnd && options.filtersDuringPlay) ? keys.length - 1 : null;
  var frame = (hadUi && ui.frame >= -1 && ui.frame < keys.length) ? ui.frame : defFrame;
  var selIdx = (hadUi && Number.isInteger(ui.selIdx) && ui.selIdx >= 0 && ui.selIdx < keys.length) ? ui.selIdx : defSel;
  var timer = null, loopWait = null;
  // PERSIST BY MERGE, NEVER REPLACE. The persisting host's setUiState REPLACES
  // the whole state, and this chart's resting frame may share that state with other writers - a
  // d3.llmSlider knob on a what-if sweep. Writing { frame, selIdx, userStopped } alone dropped
  // every knob the reader had set. Start from the last full state any helper wrote during THIS
  // render (container.__lchUiLive, valid only while options and the uiState it was seeded from
  // are the same objects), else from options.uiState; lay this helper's keys over it.
  function persistUi(patch) {
    if (typeof options.setUiState !== 'function') return;
    var live = container && container.__lchUiLiveOpts === options && container.__lchUiLiveSeed === options.uiState
      ? container.__lchUiLive : null;
    var base = live || (options.uiState && typeof options.uiState === 'object' ? options.uiState : {});
    var next = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k];
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
    if (container) { container.__lchUiLive = next; container.__lchUiLiveOpts = options; container.__lchUiLiveSeed = options.uiState; }
    options.setUiState(next);
  }

  var lb = L.label || {};
  var plabel = svg.append('text').attr('x', lb.x != null ? lb.x : W / 2).attr('y', lb.y != null ? lb.y : 16)
    .attr('text-anchor', 'middle').attr('font-size', Math.max(TYPE_FLOOR, lb.size || 14)).attr('font-weight', lb.weight || 'bold').attr('fill', tf);
  var scr = svg.append('g');
  var playG = scr.append('g').style('cursor', 'pointer').on('click', function () { startPlay(); });
  playG.append('circle').attr('cx', playX).attr('cy', trackY).attr('r', playR).attr('fill', 'transparent').attr('stroke', tf).attr('stroke-width', 1.4);
  var playGlyph = playG.append('text').attr('x', playX).attr('y', trackY + 4).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', tf).style('pointer-events', 'none');

  var // CLICKING A PERIOD STOPS PLAYBACK. Someone who clicks a specific year is asking to LOOK
  // at it; without this the timer keeps running and the frame they chose is gone before
  // they can read it, which reads as the click having been ignored. Stopping first also
  // makes the resting state persist correctly - stopPlay writes {frame, selIdx}, and a
  // still-running timer would overwrite it on its next step.
  tickClick = function (i) { stopPlay(true);
    if (selIdx === i) { selIdx = null; goTo(-1, 'user'); } else { selIdx = i; goTo(i, 'user'); } };
  var tick, lineHandle;
  if (useLine) {
    scr.append('line').attr('x1', x0).attr('y1', trackY).attr('x2', x1).attr('y2', trackY).attr('stroke', tf).attr('stroke-width', 1.5).attr('opacity', 0.5);
    // Visible mini-ticks: one small vertical mark per selectable period so the user can SEE where to
    // click (the 6px hit rects are transparent - without these the line reads as continuous and the
    // click targets are guesswork). Non-interactive - the hit rects above them own
    // the clicks; the selected period's filled rect and the accent handle draw over them.
    scr.append('g').selectAll('line.mtk').data(keys).join('line').attr('class', 'mtk')
      .attr('x1', function (d) { return sx(d); }).attr('x2', function (d) { return sx(d); })
      .attr('y1', trackY - 4).attr('y2', trackY + 4)
      .attr('stroke', tf).attr('stroke-width', 1).attr('opacity', 0.45).style('pointer-events', 'none');
    tick = scr.selectAll('rect.tk').data(keys).join('rect').attr('class', xf ? 'tk d3-axis-filter' : 'tk')
      .attr('data-row-idx', function (d, i) { return xf ? rowIdxAt(i) : null; }).attr('x', function (d) { return sx(d) - 3; }).attr('y', trackY - 6).attr('width', 6).attr('height', 12)
      .attr('fill', 'transparent').style('cursor', 'pointer').on('click', function (e, d) { tickClick(kIdx.get(d)); });
    lineHandle = scr.append('line').attr('y1', trackY - 10).attr('y2', trackY + 10).attr('stroke', ac).attr('stroke-width', 3).attr('pointer-events', 'none');
  } else {
    tick = scr.selectAll('circle.tk').data(keys).join('circle').attr('class', xf ? 'tk d3-axis-filter' : 'tk')
      .attr('data-row-idx', function (d, i) { return xf ? rowIdxAt(i) : null; }).attr('cx', sx).attr('cy', trackY).attr('r', 5)
      .attr('fill', 'transparent').style('cursor', 'pointer').on('click', function (e, d) { tickClick(kIdx.get(d)); });
  }
  if (L.tickLabels) {
    var lyy = L.tickLabels.y != null ? L.tickLabels.y : trackY + 18, everyPx = Math.max(L.tickLabels.everyPx || 48, TYPE_FLOOR * 5);
    var showEvery = Math.max(1, Math.ceil(keys.length / Math.max(1, Math.floor((x1 - x0) / everyPx))));
    scr.append('g').selectAll('text.ticklbl').data(keys).join('text').attr('class', 'ticklbl')
      .attr('x', sx).attr('y', lyy).attr('text-anchor', 'middle').attr('font-size', TYPE_FLOOR).attr('fill', tf)
      .text(function (d, i) { return i % showEvery === 0 ? d : ''; });
  }
  var allStop = scr.append('g').style('cursor', 'pointer').on('click', function (e) { if (e && e.stopPropagation) e.stopPropagation(); stopPlay(true); goTo(-1, 'user'); });
  allStop.append('circle').attr('cx', allX).attr('cy', trackY).attr('r', 6).attr('fill', 'transparent').attr('stroke', tf).attr('stroke-width', 1.4).style('pointer-events', 'all');
  allStop.append('text').attr('x', allX).attr('y', trackY + allDy).attr('text-anchor', 'middle').attr('font-size', TYPE_FLOOR).attr('fill', tf).text('All');

  function paintScrubber(i) {
    plabel.text(i < 0 ? allLabel : String(keys[i]));
    if (useLine) {
      if (lineHandle) { var hx = i < 0 ? x0 - 100 : sx(keys[i]); lineHandle.attr('x1', hx).attr('x2', hx).attr('opacity', i < 0 ? 0 : 1); }
      tick.attr('fill', function (d, j) { return j === selIdx ? tf : 'transparent'; });
    } else {
      tick.attr('stroke', function (d, j) { return (j === i && j !== selIdx) ? ac : tf; })
        .attr('stroke-width', function (d, j) { return (j === i && j !== selIdx) ? 3 : 1.5; })
        .attr('fill', function (d, j) { return j === selIdx ? tf : 'transparent'; })
        .attr('r', function (d, j) { return j === selIdx ? 7.5 : (j === i ? 7 : 5); });
    }
    allStop.select('circle').attr('fill', i < 0 ? tf : 'transparent').attr('r', i < 0 ? 9 : 6);
    playGlyph.text((timer || loopWait) ? '❚❚' : '▶'); // GLYPH TRUTH: playing OR waiting to loop
  }
  function goTo(i, src) {
    frame = i; if (i < 0) selIdx = null; else if (src === 'play' && options.filtersDuringPlay) selIdx = i;
    renderFrame(i, true); paintScrubber(i);
    if (src !== 'play' || i < 0) persistUi({ frame: i, selIdx: selIdx, userStopped: userStopped }); // persist RESTING states only
    if (xf) container.dispatchEvent(new CustomEvent('llm-xfilter-refresh', { bubbles: true,
      detail: i < 0 ? { clear: true, source: src || 'user' } : { mark: tick.nodes()[i], source: src || 'user' } }));
  }
  // A MANUAL STOP MUST SURVIVE THE RE-RENDER IT CAUSES ("auto-play is
  // true here, by the way - but that should not disallow stopping from manual means!").
  // Clicking a period calls stopPlay and then goTo, goTo persists uiState, the host treats
  // that persist as a data change and RE-RENDERS - and the rebuilt chart saw animAutoPlay
  // and started playing again. The delay added for the earlier report only PACED that
  // restart; pacing is not stopping, so the user's explicit gesture was still discarded by
  // the very echo it produced, and the restarted playback then disagreed with the restored
  // selection - which is why the colours looked wrong as well as the animation not
  // stopping. userStopped rides in uiState so the intent outlives the round trip.
  function stopPlay(byUser) { if (loopWait) { loopWait.stop(); loopWait = null; } if (timer) { timer.stop(); timer = null; }
    if (byUser) userStopped = true;
    persistUi({ frame: frame, selIdx: selIdx, userStopped: userStopped }); paintScrubber(frame); }
  function playStep() { if (!svg.node() || !svg.node().isConnected) { stopPlay(); return; }
    if (frame >= keys.length - 1) {
      // END OF PASS => ALWAYS LOOP ("Auto-play should always restart
      // after the restart delay interval"). animStopAtEnd does NOT end playback - it only
      // picks the RESTING FRAME between passes: ON = rest on the last period, OFF = rest
      // on the All overview. Pausing or clicking a period is how playback actually stops.
      // (Before this, stop-at-end parked forever and the restart delay was dead while it
      // was on - two knobs that read as one lever fighting itself.)
      timer.stop(); timer = null;
      if (options.animStopAtEnd) {
        // Already ON the last frame - no goTo (that would re-tween the same frame).
        // Persist the resting state so the PBI persist/re-render seam resumes here,
        // exactly like the goTo(-1) branch persists the overview.
        persistUi({ frame: frame, selIdx: selIdx, userStopped: userStopped });
      } else { goTo(-1, 'play'); }
      // In PBI a persist usually re-renders the visual and the delayed-autoplay branch
      // takes over (this pending wait then dies with the old DOM via the isConnected
      // guard); in hosts without setUiState THIS timeout is the loop.
      loopWait = d3.timeout(function () { loopWait = null; if (!svg.node() || !svg.node().isConnected) return;
        goTo(0, 'play'); timer = d3.interval(playStep, speed); paintScrubber(frame); }, loopDelayMs);
      paintScrubber(frame); return; }
    goTo(frame + 1, 'play'); }
  function startPlay() { if (timer || loopWait) { stopPlay(true); return; } // pause also cancels a pending loop restart
    userStopped = false;   // pressing play IS the intent to resume - it clears the sticky stop
    if (frame < 0 || frame >= keys.length - 1) goTo(0, 'play');
    timer = d3.interval(playStep, speed);
    paintScrubber(frame); // PLAY RESTART repaints the glyph immediately
  }
  renderFrame(frame, false); paintScrubber(frame); // SYNCHRONOUS first paint
  if (xf) {
    container.__llmXfClear = function () { selIdx = null; goTo(-1, 'user'); };
    if (!hadUi && selIdx != null && !options.animAutoPlay) container.__llmInitialXfMark = tick.nodes()[selIdx];
  }
  // animAutoPlay is a DEFAULT, not an override: a chart that has never been touched
  // plays itself, but once the user has stopped it, it stays stopped until they say
  // otherwise. Without this the knob silently outranks every manual gesture.
  if (options.animAutoPlay && !userStopped) {
    // ANY resumed state (hadUi) waits loopDelayMs before autoplay re-engages; only a genuinely
    // FRESH chart (no uiState yet) plays immediately. v1 gated the wait on frame < 0 (the
    // overview) - but PBI re-renders also arrive from click-persist echoes and resizes with a
    // RESTING FRAME >= 0, and each of those fell through to an instant startPlay(), so the knob
    // read as ignored (third report). The user pressing play is a real gesture on
    // the glyph and is never delayed; this only paces the AUTOMATIC restarts.
    if (loopDelayMs > 0 && hadUi) { loopWait = d3.timeout(function () { loopWait = null; if (svg.node() && svg.node().isConnected) startPlay(); }, loopDelayMs); paintScrubber(frame); }
    else startPlay();
  }
  container.__llmAnimStop = stopPlay;
  return { goTo: goTo, stopPlay: stopPlay, frame: function () { return frame; }, selIdx: function () { return selIdx; }, ticks: tick, sx: sx };
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
// SHARED date-cell normaliser. Draws nothing; answers one question before any date is read: which
// calendar day does each date cell mean?
//
// The host contract is that every DateTime cell is a UTC instant and that a date with no time of day is the
// UTC midnight of its day, so the chart reads it with UTC accessors and formats it with timeZone UTC. One
// host path breaks the second half: a plain date field can arrive at the READER'S local midnight, and
// serialising that gives a non-midnight instant. West of Greenwich it is later on the same UTC day; EAST of
// Greenwich it is on the PREVIOUS UTC day, so every UTC read - getUTCDate, d3.utcFormat, a formatter with
// timeZone UTC - shows the day before the one in the cell. This rewrites such a column to the UTC midnight
// of the calendar day the cell named, which is exactly what the contract promised.
//
// A column is rewritten only when EVERY non-empty value is midnight in this browser's own zone - the zone
// that produced it - and at least one is not already UTC midnight. A column with any time of day, any
// unparseable value, or only UTC-midnight values is returned exactly as it arrived. A host that already
// sends UTC midnight declares options.dateCellsAreUtcDays, and then nothing is touched at all. The caller's
// data object and rows are never mutated; a changed column comes back in a new object.
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
  // Wall-clock milliseconds in this browser's zone, as if they were UTC: divisible by DAY exactly when the
  // instant is local midnight. getTimezoneOffset is per instant, so a daylight-saving change is honoured.
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

function render(container, data, options) {
  data = d3.llmUtcDays(data, options);
  const TYPE_FLOOR = 10;
  container.replaceChildren();
  var SERIES_NAME = '';
  var EMPHASIS_NAME = '';
  var TARGET_NAME = 'RevenueTarget';
  var W = options.width, H = options.height;
  var FS = Math.max(TYPE_FLOOR, Math.min(14, Math.min(W, H) / 55));
  var SUB_FS = Math.max(TYPE_FLOOR, FS * 0.9), SMALL_FS = Math.max(TYPE_FLOOR, FS * 0.85);
  var CAP_FS = Math.max(TYPE_FLOOR, FS * 0.8), NOTE_FS = Math.max(TYPE_FLOOR, FS * 0.78);
  var fg = options.themeFg || 'currentColor';
  var accent = options.themeAccent || '#E4572E';
  var hue = '#1F77B4';
  var loc = options.cultureCode || 'en-US';
  var nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 1, notation: 'compact' });
  var pctAt = function (r, digits) {
    return (r >= 0 ? '+' : '\u2212') + new Intl.NumberFormat(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(r) * 100) + '%';
  };
  var pf = function (r) { return pctAt(r, 1); };
  var svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  var NEEDS = 'What-if scenarios requires a date axis with at least 6 periods and one measure.';

  function emptyFrame(msg) {
    svg.append('rect').attr('x', 0.5).attr('y', 0.5).attr('width', W - 1).attr('height', H - 1)
      .attr('fill', 'none').attr('stroke', fg).attr('stroke-opacity', 0.25);
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
      .attr('font-size', FS).attr('fill', fg).text(msg);
  }

  var cols = data.columns || [], rows = data.rows || [];
  var idx = function (n) { return cols.findIndex(function (c) { return c.name === n; }); };
  var ciRow = idx('__rowIdx__');
  var ciSeries = SERIES_NAME ? idx(SERIES_NAME) : -1;
  var ciEmph = EMPHASIS_NAME ? idx(EMPHASIS_NAME) : -1;
  var ciTarget = TARGET_NAME ? idx(TARGET_NAME) : -1;
  var ciTime = idx('MonthStart'), ciVal = idx('Revenue');
  if (ciTime < 0) throw new Error('INVALID:column "MonthStart" not found');
  if (ciVal < 0) throw new Error('INVALID:column "Revenue" not found');
  if (!rows.length) { emptyFrame(options.noDataText || 'No data to display'); return; }

  var asDate = function (v) { return (v instanceof Date) ? v : new Date(v); };
  var num = function (v) { var n = +v; return (v === null || v === '' || v === undefined || !isFinite(n)) ? null : n; };
  var notes = [];
  var grainName = 'month';
  var plural = function (n) { return n + ' ' + grainName + (n === 1 ? '' : 's'); };
  var labelOf = function (d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
  var stepDate = function (from, k) { return d3.utcMonth.offset(new Date(+from), k); };

  var byPeriod = new Map();
  rows.forEach(function (r, ri) {
    var d = asDate(r[ciTime]); if (isNaN(+d)) return;
    var v = num(r[ciVal]); if (v === null) return;
    var key = +d;
    if (!byPeriod.has(key)) byPeriod.set(key, { when: d, vals: [], idx: [] });
    var s = byPeriod.get(key);
    s.vals.push(v);
    s.idx.push(ciRow >= 0 ? r[ciRow] : ri);
  });
  var periods = Array.from(byPeriod.values()).sort(function (a, b) { return +a.when - +b.when; });
  periods.forEach(function (p) { p.value = d3.sum(p.vals); });
  var T = periods.map(function (p) { return p.when; });
  var A = periods.map(function (p) { return p.value; });
  var n = A.length;
  if (n < 6) { emptyFrame(NEEDS); return; }

  var targetVal = null, targetAsOf = '';
  if (ciTarget >= 0) {
    var tvals = [];
    rows.forEach(function (r) { var v = num(r[ciTarget]); if (v !== null) tvals.push(v); });
    var uniq = tvals.filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (uniq.length === 1) targetVal = uniq[0];
    else if (tvals.length) {
      var lastWhen = +T[n - 1], lastVals = [];
      rows.forEach(function (r) { if (+asDate(r[ciTime]) === lastWhen) { var v = num(r[ciTarget]); if (v !== null) lastVals.push(v); } });
      if (lastVals.length) { targetVal = d3.mean(lastVals); targetAsOf = ' as of ' + labelOf(T[n - 1]); }
    }
  }

  function meanPositiveRatio(a) {
    var rs = [];
    for (var i = 1; i < a.length; i++) if (a[i - 1] > 0 && a[i] > 0) rs.push(a[i] / a[i - 1]);
    if (!rs.length) return 0;
    return rs.reduce(function (x, y) { return x + y; }, 0) / rs.length - 1;
  }
  var g = (A[0] > 0 && A[n - 1] > 0) ? Math.pow(A[n - 1] / A[0], 1 / (n - 1)) - 1 : meanPositiveRatio(A);
  if (!isFinite(g)) g = 0;
  var lo = Math.max(-0.5, Math.min(-0.1, -3 * Math.abs(g)));
  var hi = Math.min(1.0, Math.max(0.1, 3 * Math.abs(g)));
  var hMax = Math.max(2, Math.min(60, 2 * n));

  var pastCross = null, atTarget = false;
  if (targetVal !== null) {
    var sideOf = function (v) { return v > targetVal ? 1 : (v < targetVal ? -1 : 0); };
    var nowSide = sideOf(A[n - 1]);
    if (nowSide === 0) atTarget = true;
    else {
      var lastOther = -1;
      for (var hk = 0; hk < n - 1; hk++) if (sideOf(A[hk]) !== nowSide) lastOther = hk;
      if (lastOther >= 0) pastCross = { when: T[lastOther + 1], v: A[lastOther + 1] };
    }
  }
  function projectAt(r, Hh) {
    var pts = [], v = A[n - 1];
    for (var k = 1; k <= Hh; k++) { v = v * (1 + r); pts.push({ k: k, when: stepDate(T[n - 1], k), v: v }); }
    var cross = null;
    if (targetVal !== null && pts.length && !pastCross && !atTarget) {
      var up = targetVal > A[n - 1];
      for (var j = 0; j < pts.length; j++) {
        if (up ? pts[j].v >= targetVal : pts[j].v <= targetVal) { cross = pts[j]; break; }
      }
    }
    return { pts: pts, end: pts.length ? pts[pts.length - 1].v : A[n - 1], flat: A[n - 1], cross: cross };
  }

  var rates = [], defIdx, branch = 'derived';
  for (var di = 0; di < 5; di++) rates.push(lo + di * (hi - lo) / 4);
  var near = 0;
  rates.forEach(function (r, i) { if (Math.abs(r - g) < Math.abs(rates[near] - g)) near = i; });
  rates[near] = g;
  rates.sort(function (a, b) { return a - b; });
  defIdx = rates.indexOf(g);
  var keys = [];
  for (var dg = 1; dg <= 3; dg++) {
    keys = rates.map(function (r) { return pctAt(r, dg); });
    if (new Set(keys).size === keys.length) break;
  }
  if (new Set(keys).size !== keys.length) keys = rates.map(function (r, i) { return pctAt(r, 3) + ' #' + (i + 1); });

  var TL_Y = FS * 0.4, TL_H = FS * 4.6;
  var STRIP_Y = TL_Y + TL_H, STRIP_H = FS * 3.0;
  var READ_Y = STRIP_Y + STRIP_H, READ_H = FS * 2.6;
  var ROW_Y = READ_Y + READ_H, ROW_H = FS * (targetVal !== null ? 3.4 : 2.4);
  var tw = d3.llmSlider.textWidth;
  var gutterText = keys.reduce(function (m, k) { return Math.max(m, tw(k, NOTE_FS)); }, 0);
  if (targetVal !== null) gutterText = Math.max(gutterText, tw(TARGET_NAME + targetAsOf, NOTE_FS));
  var mL = FS * 4.2, mR = FS * 1.2 + gutterText, mB = FS * 3.2;
  var plotY = ROW_Y + ROW_H;
  var plotH = Math.max(FS * 6, H - plotY - mB);
  var plotW = Math.max(FS * 8, W - mL - mR);

  var strip = svg.append('g').attr('class', 'lch-knobs');
  var readG = svg.append('g').attr('class', 'lch-readouts');
  var rowG = svg.append('g').attr('class', 'lch-scenarios');
  var plot = svg.append('g').attr('transform', 'translate(' + mL + ',' + plotY + ')');

  var horizon = Math.min(12, n);
  var horizonFmt = function (v) { return plural(Math.round(v)); };
  var labelW = tw('horizon', SUB_FS);
  var readoutW = tw(horizonFmt(hMax), SUB_FS);
  var stepperW = Math.max(20, Math.round(FS * 1.5)) + FS * 1.1;
  var resetW = Math.max(20, FS * 3.2), resetH = Math.max(20, FS * 2.2);
  var resetLeft = W - FS * 0.6 - resetW;
  var kx = mL + labelW + stepperW;
  var kw = Math.max(FS * 5, Math.min(FS * 14, plotW * 0.42, resetLeft - FS - readoutW - stepperW - kx));
  var ky = STRIP_Y + FS * 1.3;
  var sHor = d3.llmSlider(svg, {
    container: container, options: options, key: 'horizon', domain: [1, hMax], step: 1,
    'default': Math.min(12, n), x: kx, y: ky, width: kw, fontSize: FS, label: 'horizon',
    labelRoom: labelW + FS * 0.5, format: horizonFmt,
    onChange: function (v, phase) { horizon = Math.round(v); if (phase !== 'init') { repaint(); emphasise(current, false); } },
  });

  var tileW = plotW / 3;
  function tile(i, label) {
    var gg = readG.append('g').attr('transform', 'translate(' + (mL + i * tileW) + ',' + (READ_Y + FS * 1.1) + ')');
    gg.append('text').attr('font-size', NOTE_FS).attr('fill', fg).attr('fill-opacity', 0.7).text(label);
    return gg.append('text').attr('y', FS * 1.25).attr('font-size', FS * 1.05).attr('fill', fg);
  }
  var tileEnd = tile(0, 'end value');
  var tileFlat = tile(1, 'vs flat');
  function targetLabel(nm) {
    var s = String(nm == null ? '' : nm);
    var words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/);
    var said = words.some(function (w) { return /^(target|goal|quota|budget|plan)s?$/.test(w); })
      || /(target|goal|quota|budget|plan)s?$/.test(s.toLowerCase().replace(/[^a-z]+/g, ''));
    return said ? nm : 'target ' + nm;
  }
  var tileTarget = tile(2, targetVal === null ? 'target' : targetLabel(TARGET_NAME));

  var x = d3.scaleUtc().range([0, plotW]);
  var y = d3.scaleLinear().range([plotH, 0]);
  var xAxisG = plot.append('g').attr('class', 'lch-x').attr('transform', 'translate(0,' + plotH + ')');
  var yAxisG = plot.append('g').attr('class', 'lch-y');
  var flatPath = plot.append('path').attr('class', 'lch-flat').attr('fill', 'none')
    .attr('stroke', fg).attr('stroke-opacity', 0.28).attr('stroke-width', 1).attr('stroke-dasharray', '2 3');
  var targetG = plot.append('g').attr('class', 'lch-target');
  var fanG = plot.append('g').attr('class', 'lch-fan');
  var fanPaths = rates.map(function (r, i) {
    return fanG.append('path').attr('class', 'lch-scn').attr('data-scn', i).attr('fill', 'none')
      .attr('stroke', hue).attr('stroke-width', 1.2).attr('stroke-dasharray', '5 4').attr('stroke-opacity', 0.35);
  });
  var fanLabels = rates.map(function (r, i) {
    return plot.append('text').attr('class', 'lch-scn-label').attr('font-size', NOTE_FS).attr('fill', fg)
      .attr('fill-opacity', 0.9).text(keys[i]);
  });
  var actualG = plot.append('g').attr('class', 'lch-actual');
  var actualPath = actualG.append('path').attr('fill', 'none').attr('stroke', hue).attr('stroke-width', 2);
  var dotsG = actualG.append('g');
  var emphPath = plot.append('path').attr('class', 'lch-emph').attr('fill', 'none')
    .attr('stroke', hue).attr('stroke-width', 2.6).attr('stroke-dasharray', '6 3');
  var emphEnd = plot.append('circle').attr('class', 'lch-emph-end').attr('r', Math.max(2.5, FS * 0.32)).attr('fill', hue);
  var crossMark = plot.append('circle').attr('class', 'lch-cross').attr('r', 0).attr('fill', 'none')
    .attr('stroke', accent).attr('stroke-width', 2);
  var projLabel = plot.append('text').attr('class', 'lch-proj-label')
    .attr('font-size', SMALL_FS).attr('fill', fg).attr('fill-opacity', 0.9);
  var capG = svg.append('text').attr('class', 'lch-caption').attr('x', mL).attr('y', H - FS * 0.9)
    .attr('font-size', CAP_FS).attr('fill', fg).attr('fill-opacity', 0.7);

  var line = d3.line().x(function (d) { return x(d.when); }).y(function (d) { return y(d.v); });
  var tip = options.allowTooltips === false ? null : d3.llmTooltip(container);
  var series = { name: cols[ciVal].name, pts: periods.map(function (p) { return { when: p.when, v: p.value, idx: p.idx }; }) };
  var proj = [];
  var current = defIdx;

  function drawMarks() {
    var showDots = periods.length <= 120;
    actualPath.attr('d', line(series.pts));
    var sel = dotsG.selectAll('circle').data(showDots ? series.pts : []);
    sel.exit().remove();
    var ent = sel.enter().append('circle').attr('class', 'd3-mark').attr('r', Math.max(2, FS * 0.28));
    ent.merge(sel)
      .attr('class', 'd3-mark')
      .attr('cx', function (d) { return x(d.when); })
      .attr('cy', function (d) { return y(d.v); })
      .attr('fill', hue)
      .attr('data-row-idx', function (d) { return d.idx.join(','); })
      .style('cursor', 'pointer')
      .on('mouseover', function (e, d) { if (tip) tip.show(series.name + ' ' + labelOf(d.when) + ': ' + nf.format(d.v), e); })
      .on('mousemove', function (e) { if (tip) tip.move(e); })
      .on('mouseout', function () { if (tip) tip.hide(); });
  }

  function repaint() {
    proj = rates.map(function (r) { return projectAt(r, horizon); });
    var lastActual = T[n - 1];
    var lastProj = proj[0].pts.length ? proj[0].pts[proj[0].pts.length - 1].when : lastActual;
    x.domain([T[0], lastProj]);
    var ys = [];
    series.pts.forEach(function (q) { if (q.v !== null) ys.push(q.v); });
    proj.forEach(function (p) { p.pts.forEach(function (q) { ys.push(q.v); }); });
    if (targetVal !== null) ys.push(targetVal);
    var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var padY = (yMax - yMin) * 0.08;
    y.domain([Math.max(0, yMin - padY), yMax + padY]);
    var xFmt = function (d) {
      return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : new Intl.DateTimeFormat(loc, { month: 'short', timeZone: 'UTC' }).format(d);
    };
    xAxisG.call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(plotW / (FS * 8)))).tickFormat(xFmt).tickSizeOuter(0)).attr('font-size', CAP_FS);
    yAxisG.call(d3.axisLeft(y).ticks(Math.max(2, Math.floor(plotH / (FS * 3)))).tickFormat(function (v) { return nf.format(v); }).tickSizeOuter(0)).attr('font-size', CAP_FS);
    drawMarks();
    var start = { when: lastActual, v: A[n - 1] };
    fanPaths.forEach(function (fp, i) { fp.attr('d', line([start].concat(proj[i].pts))); });
    flatPath.attr('d', line([{ when: lastActual, v: A[n - 1] }, { when: lastProj, v: A[n - 1] }]));

    var items = rates.map(function (r, i) { return { el: fanLabels[i], y: y(proj[i].end) }; });
    targetG.selectAll('*').remove();
    if (targetVal !== null) {
      targetG.append('line').attr('x1', 0).attr('x2', plotW).attr('y1', y(targetVal)).attr('y2', y(targetVal))
        .attr('stroke', fg).attr('stroke-opacity', 0.55).attr('stroke-dasharray', '4 3');
      var tl = targetG.append('text').attr('font-size', NOTE_FS).attr('fill', fg).text(TARGET_NAME + targetAsOf);
      items.push({ el: tl, y: y(targetVal) });
    }
    items.sort(function (a, b) { return a.y - b.y; });
    var gapY = FS * 0.95;
    for (var i = 1; i < items.length; i++) if (items[i].y < items[i - 1].y + gapY) items[i].y = items[i - 1].y + gapY;
    var over = items.length ? items[items.length - 1].y - (plotH - FS * 0.2) : 0;
    if (over > 0) items.forEach(function (it) { it.y -= over; });
    items.forEach(function (it) { it.el.attr('x', plotW + FS * 0.4).attr('y', it.y + FS * 0.3); });

    rowG.selectAll('*').remove();
    var cellW = plotW / rates.length, fsRow = NOTE_FS;
    rates.forEach(function (r, i) {
      var cx = mL + i * cellW;
      var cell = rowG.append('g').attr('class', 'lch-scn-cell').attr('data-scn', i)
        .attr('transform', 'translate(' + cx + ',' + (ROW_Y + FS * 1.0) + ')');
      cell.append('text').attr('class', 'lch-scn-rate').attr('font-size', fsRow).attr('fill', fg).text(keys[i]);
      cell.append('text').attr('y', FS * 0.95).attr('font-size', fsRow).attr('fill', fg).attr('fill-opacity', 0.75)
        .text(nf.format(proj[i].end));
      if (targetVal !== null) {
        var sentence = atTarget ? 'at target' : pastCross ? 'crossed ' + labelOf(pastCross.when)
          : proj[i].cross ? labelOf(proj[i].cross.when) : 'not within ' + plural(horizon);
        if (tw(sentence, fsRow) > cellW - FS * 0.3) sentence = atTarget ? 'at' : pastCross ? 'crossed'
          : proj[i].cross ? labelOf(proj[i].cross.when) : 'no';
        cell.append('text').attr('y', FS * 1.9).attr('font-size', fsRow).attr('fill', fg).attr('fill-opacity', 0.75).text(sentence);
      }
    });

    var caps = ['monthly grain, projections compound per month'];
    notes.forEach(function (t) { caps.push(t); });
    var capText = caps.join(' - ');
    d3.llmFitLabel(capG, W - mL - FS * 0.5, { pad: 0, text: capText });
    if (capG.text() !== capText) capG.append('title').text(capText);
  }

  function emphasise(i, animate) {
    current = (i >= 0 && i < rates.length) ? i : defIdx;
    var p = proj[current], r = rates[current];
    var ms = options.animPlaySpeedMs;
    var start = { when: T[n - 1], v: A[n - 1] };
    d3.llmFrameTween(emphPath, { animate: animate, ms: ms, attrs: { d: line([start].concat(p.pts)) } });
    var last = p.pts.length ? p.pts[p.pts.length - 1] : start;
    d3.llmFrameTween(emphEnd, { animate: animate, ms: ms, attrs: { cx: x(last.when), cy: y(last.v) } });
    if (pastCross) {
      crossMark.attr('r', Math.max(3, FS * 0.4)).attr('cx', x(pastCross.when)).attr('cy', y(pastCross.v));
    } else if (p.cross) {
      crossMark.attr('r', Math.max(3, FS * 0.4));
      d3.llmFrameTween(crossMark, { animate: animate, ms: ms, attrs: { cx: x(p.cross.when), cy: y(p.cross.v) } });
    } else {
      crossMark.attr('r', 0);
    }
    fanPaths.forEach(function (fp, j) {
      var dist = Math.abs(j - current);
      d3.llmFrameTween(fp, { animate: animate, ms: ms, attrs: { 'stroke-opacity': dist === 0 ? 0.15 : Math.max(0.18, 0.5 - 0.08 * dist) } });
    });
    rowG.selectAll('.lch-scn-rate').attr('font-weight', function () { return +this.parentNode.getAttribute('data-scn') === current ? 'bold' : null; });

    var who = current === defIdx ? 'historical' : 'set by reader';
    var labelText = 'projected - assumes ' + pf(r) + ' per ' + grainName + ', ' + who;
    var labelFs = SMALL_FS, rightEdge = W - mL - FS * 0.6;
    if (tw(labelText, labelFs) > rightEdge) labelText = 'projected - assumes ' + pf(r) + ' per ' + grainName;
    var labelX = Math.max(0, Math.min(x(T[n - 1]) + FS * 0.4, rightEdge - tw(labelText, labelFs)));
    projLabel.text(labelText);
    d3.llmFrameTween(projLabel, { animate: animate, ms: ms, attrs: { x: labelX, y: Math.max(FS, y(p.end) - FS * 0.8) } });
    tileEnd.text(nf.format(p.end));
    tileFlat.text(p.flat === 0 ? 'n/a' : pf((p.end - p.flat) / Math.abs(p.flat)));
    if (targetVal === null) tileTarget.text('none stated');
    else if (atTarget) tileTarget.text('at target now');
    else if (pastCross) tileTarget.text('crossed in ' + labelOf(pastCross.when));
    else tileTarget.text(p.cross ? 'reaches in ' + labelOf(p.cross.when) : 'not within ' + plural(horizon));
  }

  repaint();

  var trackY = TL_Y + FS * 2.3;
  var playR = Math.max(9, FS * 0.85);
  var scrub = d3.llmScrubber(svg, {
    keys: keys, container: container, options: options, crossFilter: false,
    allLabel: 'All scenarios',
    renderFrame: function (i, animate) { emphasise(i, animate); },
    periodRowIdx: function () { return ''; },
    layout: {
      x0: mL + playR * 2 + FS, x1: W - FS * 3.6, trackY: trackY, playX: mL + playR, playR: playR,
      allX: W - FS * 1.6, allLabelDy: Math.max(TYPE_FLOOR, FS) + FS * 1.1, padding: 0.5,
      label: { x: W / 2, y: TL_Y + FS * 0.9, size: Math.max(TYPE_FLOOR, FS * 0.95), weight: 'bold' },
      tickLabels: { y: trackY + Math.max(TYPE_FLOOR, FS) + FS * 0.9, everyPx: FS * 5 },
    },
  });

  var reset = svg.append('g').attr('class', 'lch-reset').attr('cursor', 'pointer')
    .on('click', function () { scrub.stopPlay(true); sHor.reset(); scrub.goTo(-1, 'user'); });
  reset.append('rect').attr('x', resetLeft).attr('y', ky - resetH / 2)
    .attr('width', resetW).attr('height', resetH).attr('rx', 3)
    .attr('fill', 'transparent').attr('stroke', fg).attr('opacity', 0.6);
  reset.append('text').attr('x', resetLeft + resetW / 2).attr('y', ky + FS * 0.35).attr('text-anchor', 'middle')
    .attr('font-size', SMALL_FS).attr('fill', fg).text('reset');
}