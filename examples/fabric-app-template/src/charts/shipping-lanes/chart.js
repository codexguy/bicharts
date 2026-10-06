// BIC generated chart — Origin-Destination Flow Map [D3]
// host contract v1.13.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// SHARED value-channel resolver. Answers ONE question for any chart that reduces rows to a
// value per group: WHICH COLUMN CARRIES THE NUMBER? It draws nothing and it decides nothing
// about geometry, exactly like the bounded-scale resolver does for the gauge family.
//
// WHY THIS EXISTS, and it is not a tidy-up. Every chart that needed a value used to write
//
//     const measIdx = columns.findIndex(c => c.isMeasure);
//     const mv = measIdx >= 0 ? row[measIdx] : 1;
//
// and that is wrong twice over. `isMeasure` is true ONLY for a column bound in the measures
// role; a numeric column bound as a category arrives with isMeasure false and every one of its
// statistics intact, so the flag alone throws away a perfectly good measure. And the fallback
// then substitutes the literal 1, which does not fail - it fabricates. Every group aggregates
// to the same number, a colour ramp collapses to a single tone with a legend annotated 1 at
// both ends, a width scale hands every mark its maximum, and the chart renders cleanly, passes
// every execution gate and answers a question nobody asked. A silent constant is far worse than
// a missing channel, because nothing downstream can tell it apart from real data.
//
// CONTRACT
//   const V = d3.llmValueColumn(columns, rows, { countLabel: 'Rows', exclude: [iLat, iLon] });
//   V.valueIndex   column index of the value, or -1 when the rows are being counted
//   V.valueName    what to PUT ON THE LEGEND - the column's name, or countLabel when counting
//   V.labelIndex   the dimension to label a group with; never the same column as the value
//   V.isCount      true when no value column existed and each row therefore counts as one
//   V.resolvedBy   'measure' | 'numeric' | 'count' - which rule fired, for gates and tooltips
//   V.valueOf(row) the row's numeric contribution, or null for blank. NEVER coerces blank to 0.
//
// Resolution order:
//   0. opts.prefer - a column the CALLER has already resolved, by name or index. Honoured first
//      and without argument. This exists because a lane can REQUIRE this helper be called, and a
//      required call must never be a reason to discard a correct answer the caller already had.
//   1. the first column flagged isMeasure;
//   2. else the first NUMERIC column that is neither host-injected, nor the label, NOR AN
//      IDENTIFIER - a measure the user bound as a category is still the measure they meant, but
//      a ZIP code, a FIPS code or an order number is a NAME WRITTEN IN DIGITS and summing it
//      produces a chart that renders cleanly and means nothing;
//   3. else count the rows, and SAY SO. isCount is the caller's instruction to label the
//      channel as a count rather than borrow a column name for a number that is not that column.
//
// WHY RULE 2 NEEDED THE IDENTIFIER TEST. A US cartogram over ZipCode / City / State / Channel /
// Orders / Revenue arrived with every column isMeasure:false - which is what a dataset well does
// when the user binds fields as categories - so rule 1 found nothing and rule 2 took ZipCode, the
// first numeric. The 51 state tiles were coloured by the SUM OF ZIP CODE, legend reading 42,791
// to 60,294,573, while Revenue went unencoded. It passed every gate, because there is nothing
// wrong with the drawing; the number is just not about anything.
//
// WHAT COUNTS AS AN IDENTIFIER, strongest evidence first:
//   - the host says so: a `geoKind` that is a REGION JOIN CODE (zip / state / county / FIPS /
//     ISO / country). A latitude is numeric, geographic and a real quantity, so coordinate kinds
//     are NOT identifiers;
//   - failing that, the NAME says so AND the data agrees: an id-ish token in the column name
//     (camelCase and underscore both split, so `ZipCode` and `zip_code` read alike) together
//     with an integer type and near-unique values. All three, because `OrderCount` is an
//     integer, `Revenue` is near-unique, and neither is an identifier.
// A pure uniqueness sniff is deliberately NOT used: Revenue was 9,381 distinct over 10,000 rows.
//
// opts.prefer names the column the caller has ALREADY decided is the value - a name or an index.
// Use it when a lane requires this call but you have resolved the value yourself: the required
// call then CONFIRMS your answer instead of replacing it. Ignored when it names nothing real.
//
// opts.exclude is a list of column INDEXES the caller has already claimed for another channel -
// a flow map resolves its own lat/lon pair out of ordinary named columns, and a latitude drafted
// as the value would be worse than counting. Say what you have taken; the resolver skips it for
// both the value and the label.
//
// opts.excludeCoordinates (opt-in) - A COORDINATE IS NEVER THE VALUE. A route or point map resolves its ends from the
// host's reserved columns or from columns it names itself, and the data's OWN latitude and longitude columns stay
// candidates: a numeric dimension with many values can arrive flagged as a measure, and a flow map sized every arc by
// DestinationLatitude under a key titled 'DestinationLatitude' - it rendered cleanly and passed every gate. With the
// option set, the resolver skips (for the value AND the label) every column that NAMES a coordinate - camelCase and
// separators split, any word lat, latitude, lon, lng or longitude; 'long' only when every value is a longitude, so
// 'LongHaulUnits' stays a measure - or that the host DECLARES one (semanticType or dataCategory Latitude / Longitude);
// host columns are skipped already. With nothing else left it counts. V.coordinates names what it skipped. Opt-in,
// because a latitude IS a quantity on a chart that plots it.
//
// An implicit count is legitimate. Reaching it while a real number sits unread is not.
d3.llmValueColumn = function (columns, rows, opts) {
  opts = opts || {};
  var cols = Array.isArray(columns) ? columns : [];
  var data = Array.isArray(rows) ? rows : [];

  // Host-injected columns are plumbing - join keys, row ids, resolved coordinates. They are
  // numeric and they are never what anyone bound, so they can never be a value or a label.
  var isHost = function (c) {
    var n = (c && c.name != null) ? String(c.name) : '';
    return n.indexOf('__') === 0;
  };
  var taken = {};
  (Array.isArray(opts.exclude) ? opts.exclude : []).forEach(function (i) {
    if (i != null && i >= 0) taken[i] = 1;
  });
  var coordinates = [];
  if (opts.excludeCoordinates) {
    var coordWords = function (n) {
      return String(n == null ? '' : n).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/);
    };
    var allLongitudes = function (ci) {
      var seenL = 0;
      for (var rr = 0; rr < data.length; rr++) {
        var lv = data[rr] ? data[rr][ci] : null;
        if (lv === null || lv === undefined || lv === '') continue;
        lv = +lv; seenL++;
        if (!isFinite(lv) || lv < -180 || lv > 180) return false;
      }
      return seenL > 0;
    };
    cols.forEach(function (c, ci) {
      if (!c || isHost(c)) return;
      var declared = String(c.semanticType || c.dataCategory || '').toLowerCase();
      var w = coordWords(c.name);
      if (declared === 'latitude' || declared === 'longitude'
          || w.some(function (t) { return /^(lat|latitude|lon|lng|longitude)$/.test(t); })
          || (w.indexOf('long') >= 0 && allLongitudes(ci))) {
        taken[ci] = 1;
        coordinates.push(String(c.name));
      }
    });
  }

  var NUMERIC_TYPES = { integer: 1, decimal: 1, double: 1, float: 1, single: 1,
                        number: 1, int64: 1, int32: 1, currency: 1, money: 1 };

  // A column is numeric if the host SAYS so, and otherwise if the rows show it. The declared
  // type is preferred because a sparse column of blanks is still numeric; the sniff is the
  // fallback for a payload that carries no type at all.
  var isNumericCol = function (c, i) {
    var dt = (c && c.dataType != null) ? String(c.dataType).toLowerCase() : '';
    if (dt) return NUMERIC_TYPES[dt] === 1;
    var seen = 0, num = 0;
    for (var r = 0; r < data.length && seen < 50; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '') continue;
      seen++;
      if (typeof v !== 'boolean' && isFinite(+v)) num++;
    }
    return seen > 0 && num === seen;
  };

  // A GEO JOIN CODE IS A NAME, NOT A NUMBER. Region codes identify; coordinates measure.
  var isRegionCode = function (c) {
    var k = (c && c.geoKind != null) ? String(c.geoKind).toLowerCase() : '';
    if (!k) return false;
    return k.indexOf('zip') === 0 || k.indexOf('us-zip') === 0 || k.indexOf('us-state') === 0 ||
           k.indexOf('us-county') === 0 || k.indexOf('us-fips') === 0 || k.indexOf('fips') === 0 ||
           k.indexOf('country-') === 0 || k.indexOf('iso-') === 0;
  };

  // Split a column name the way a reader does - camelCase AND underscores AND spaces - because a
  // word-boundary test cannot see the `Code` inside `ZipCode`, and glued names are the common case.
  var ID_TOKENS = { id: 1, ids: 1, identifier: 1, code: 1, codes: 1, zip: 1, zipcode: 1,
                    postal: 1, postcode: 1, fips: 1, guid: 1, uuid: 1, sku: 1, upc: 1, ean: 1,
                    isbn: 1, key: 1, num: 1, number: 1, no: 1, ref: 1, serial: 1, barcode: 1,
                    account: 1, acct: 1, vin: 1, imei: 1, ssn: 1 };
  var nameLooksLikeId = function (c) {
    var n = (c && c.name != null) ? String(c.name) : '';
    if (!n) return false;
    var parts = n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/);
    for (var p = 0; p < parts.length; p++) {
      if (parts[p] && ID_TOKENS[parts[p].toLowerCase()] === 1) return true;
    }
    return false;
  };

  // The name alone is not enough - `OrderCount` would be a false positive on a token list, and a
  // measure lost to a name test is as wrong as an identifier drafted as a measure. Require the
  // DATA to agree: integer-valued and near-unique, which is what a key looks like and what a
  // quantity almost never does.
  var looksLikeKeyData = function (c, i) {
    var seen = 0, ints = 0, vals = {}, distinct = 0;
    for (var r = 0; r < data.length && seen < 2000; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '') continue;
      seen++;
      var num = +v;
      if (isFinite(num) && Math.floor(num) === num) ints++;
      var kk = String(v);
      if (vals[kk] !== 1) { vals[kk] = 1; distinct++; }
    }
    return seen >= 8 && ints === seen && (distinct / seen) >= 0.9;
  };

  var isIdentifierCol = function (c, i) {
    if (!c) return false;
    // geoKind is DECLARED by the host and is the exact signal, so it is tested first and alone.
    // There is deliberately no second declared flag to consult: formatSignature, the host's other
    // identifier signal, is computed for STRING columns only - which is precisely why a numeric
    // ZIP slipped past every identifier test in the pipeline - and inventing a field nothing
    // populates would be a lever that cannot fire.
    if (isRegionCode(c)) return true;
    return nameLooksLikeId(c) && looksLikeKeyData(c, i);
  };

  // A MEASURE THAT HOLDS TEXT IS NOT A VALUE. Power BI's "First" or "Last" of a name is a measure the
  // host sends as a string: taken as the value, valueOf answers null on every row and the chart draws
  // nothing - the card of dashes nine archetypes were fixed for. The same rule as the server's
  // ChartFilter.IsTextMeasure: DECLARED non-numeric (not a date, not a flag) with no numeric evidence
  // (no spread, sum or mean, not continuous). An untyped measure is still taken: no type is not text.
  var isTextMeasure = function (c) {
    if (!c || !c.isMeasure) return false;
    var dt = (c.dataType != null) ? String(c.dataType).toLowerCase() : '';
    if (!dt || NUMERIC_TYPES[dt] === 1 || dt === 'datetime' || dt === 'date' || dt === 'boolean') return false;
    if (c.stdDev != null || c.sum != null || c.avgValue != null) return false;
    return String(c.valueNature || '').toLowerCase() !== 'continuous';
  };

  var valueIndex = -1, resolvedBy = 'count';
  var skipped = [];
  var skippedText = [];      // measures passed over because they hold text (isTextMeasure)

  // 0. THE CALLER'S OWN ANSWER WINS. A lane that REQUIRES this call must not thereby cost the
  //    caller a value it had already resolved correctly.
  if (opts.prefer != null) {
    var want = opts.prefer;
    for (var q = 0; q < cols.length; q++) {
      if (!cols[q]) continue;
      if (q === want || (typeof want === 'string' && String(cols[q].name) === want)) {
        if (!taken[q] && !isHost(cols[q])) { valueIndex = q; resolvedBy = 'preferred'; }
        break;
      }
    }
  }

  if (valueIndex < 0) {
    for (var i = 0; i < cols.length; i++) {
      if (taken[i]) continue;
      if (!cols[i] || !cols[i].isMeasure || isHost(cols[i])) continue;
      // SAY WHAT WAS SKIPPED, as the numeric pass does for an identifier.
      if (isTextMeasure(cols[i])) { skippedText.push(String(cols[i].name)); continue; }
      valueIndex = i; resolvedBy = 'measure'; break;
    }
  }
  if (valueIndex < 0) {
    for (var j = 0; j < cols.length; j++) {
      if (taken[j] || !cols[j] || isHost(cols[j])) continue;
      if (!isNumericCol(cols[j], j)) continue;
      if (isIdentifierCol(cols[j], j)) {
        // SAY WHAT WAS SKIPPED. A silent exclusion is how the opposite bug would hide.
        skipped.push(String(cols[j].name));
        continue;
      }
      valueIndex = j; resolvedBy = 'numeric'; break;
    }
  }

  // The label is the first bound column that is NOT the value. Resolving the two together is
  // what stops a numeric column being drafted as the value and then labelling the groups with
  // itself - the two used to be found by separate scans that could agree on the same column.
  var labelIndex = -1;
  for (var k = 0; k < cols.length; k++) {
    if (taken[k] || !cols[k] || isHost(cols[k]) || k === valueIndex) continue;
    labelIndex = k; break;
  }

  var isCount = valueIndex < 0;
  var nameOf = function (idx) {
    var c = cols[idx];
    return (c && c.name != null) ? String(c.name) : '';
  };

  return {
    valueIndex: valueIndex,
    valueName: isCount ? (opts.countLabel || 'Rows') : nameOf(valueIndex),
    labelIndex: labelIndex,
    labelName: labelIndex >= 0 ? nameOf(labelIndex) : '',
    isCount: isCount,
    resolvedBy: resolvedBy,
    // Columns rule 2 REFUSED as identifiers. Non-empty here beside isCount true means "there were
    // numbers and none of them were quantities" - worth putting in a subtitle rather than hiding.
    skipped: skipped,
    // Measures passed over because they hold TEXT (a "First" of a name): kept apart from `skipped`,
    // which names identifiers, so a caption built from either says the right thing.
    skippedText: skippedText,
    // Columns opts.excludeCoordinates set aside as coordinates (empty when the option is off).
    coordinates: coordinates,
    // A BLANK IS NOT A ZERO. Returning null keeps an absent value out of the aggregate and out
    // of the scale domain, so a group present in the data with nothing to show for this view
    // paints as no-data instead of being dragged to the bottom of the ramp.
    valueOf: function (row) {
      if (isCount) return 1;
      if (!row) return null;
      var v = row[valueIndex];
      if (v == null || v === '' || typeof v === 'boolean') return null;
      var n = +v;
      return isFinite(n) ? n : null;
    }
  };
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
// SHARED key band and note stack for a map that keeps its key in a reserved side band (the
// Origin-Destination Flow Map). It owns every text the band and the note stack draw, so none of
// them can run past the frame - the code pass re-typed this block by hand and dropped the fit
// ('Width: Total UnitsShipped' in a fixed 150 px band ran 7 px past an 800 px frame in
// Arial and 27 px past at 560 px; its note stack drawn at a fixed 12 px ran 23 px past at 400 px).
//
//   var key = d3.llmFlowKey({ width: W, height: H, fontSize: CF, title: valName, themeFg: fg });
//   var mapW = W - key.width, mapH = H;      // key.width is 0 when the frame cannot afford a key
//   ... fit the projection into mapW x mapH and draw the map ...
//   var note = key.notes(svg, { x: pad, y: mapH - Math.max(8, CF * 0.6) });
//   note('Arcs run pale to solid, origin to destination');      // note(text, strong) stacks upward
//   key.draw(svg, { max: vmax, min: vmin, strokeWidth: wid, format: fmt, color: accent,
//     valueFontSize: VAL_FS });                                  // returns <g class="llm-key"> or null
//
// What it owns:
//   * THE BAND: as wide as the title needs (estimated at 0.6 em), at least max(96, 9 em), at most
//     22% of the width; 0 below opts.minWidth (520 px), where no key is drawn at all.
//   * THE TITLE, EVERY REFERENCE VALUE, EVERY ENTRY AND EVERY EXTRA LINE is fitted to the room
//     right of its x - the widest prefix that fits, never a cut inside a number - with the whole
//     text in a <title>. Reference strokes: draw({ max, min }) or draw({ values: [...] }), each
//     drawn at strokeWidth(v) and labelled format(v).
//   * OPTIONAL ENTRIES under the strokes: draw({ entriesTitle: 'Origin', entries: [{ label, color,
//     rows }] }) - a swatch and a fitted label each, class d3-legend-mark with data-row-idx = rows
//     (a click cross-filters them), and '+N more' once the band runs out of height.
//     draw({ lines: ['...'] }) adds plain fitted lines after them. Entries, entriesTitle and lines
//     are also read from d3.llmFlowKey({...}) itself.
//   * THE NOTE STACK: notes(svg, { x, y, right, fontSize }) returns note(text, strong); one
//     y-cursor moving UP from y, so notes never overlap, each fitted to end before right (the
//     frame's right edge less a small margin by default).
//   * key.fit(sel, room, text) fits any other text the same way.
// Uses d3.llmFitLabel when the chart has it installed; otherwise the same measured prefix cut.
d3.llmFlowKey = function (opts) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px
  opts = opts || {};
  var W = +opts.width > 0 ? +opts.width : 800;
  var H = +opts.height > 0 ? +opts.height : 500;
  var CF = Math.max(TYPE_FLOOR, +opts.fontSize > 0 ? +opts.fontSize : Math.min(14, Math.round(Math.min(W, H) / 42)));
  var fg = opts.themeFg || '#333';
  var title = opts.title == null ? '' : String(opts.title);
  var pad = Math.max(8, Math.round(CF * 0.8));
  var minW = opts.minWidth == null ? 520 : +opts.minWidth;
  var band = 0;
  if (W >= minW) band = Math.min(Math.round(W * 0.22),
    Math.max(96, CF * 9, Math.ceil(title.length * CF * 0.6) + 2 * pad));
  // THE BAND HAS A FLOOR OF 20% OF THE WIDTH (within the 22% cap): it is sized before a chart hands draw() its
  // entries, and an origin key's 'Country (code)' names in a band sized for a short value title wrapped three and
  // four deep, or were cut, at every tile size.
  if (band) band = Math.max(band, Math.min(Math.round(W * 0.22), Math.round(W * 0.2)));

  // The measured prefix cut, for a chart that never installed d3.llmFitLabel: real metrics in a
  // browser, the 0.6 em estimate where nothing measures; blank when even one character will not fit.
  function cut(node, room, text) {
    var fs = parseFloat(node.getAttribute && node.getAttribute('font-size')) || CF;
    var width = function () {
      try {
        if (typeof node.getComputedTextLength === 'function') {
          var w = node.getComputedTextLength();
          if (w > 0) return w;
        }
      } catch (e) { /* fall through to the estimate */ }
      return String(node.textContent).length * fs * 0.6;
    };
    node.textContent = text;
    if (!(room >= 14)) { node.textContent = ''; return; }
    if (width() <= room) return;
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      node.textContent = text.slice(0, mid) + '\u2026';
      if (width() <= room) lo = mid; else hi = mid - 1;
    }
    while (lo > 0 && /[0-9.,]/.test(text.charAt(lo - 1)) && /[0-9]/.test(text.charAt(lo))) lo--;
    node.textContent = lo > 0 ? text.slice(0, lo) + '\u2026' : '';
  }

  function fit(sel, room, text) {
    text = text == null ? '' : String(text);
    if (!sel || typeof sel.node !== 'function' || !sel.node()) return sel;
    if (typeof d3.llmFitLabel === 'function') d3.llmFitLabel(sel, room, { pad: 0, text: text });
    else cut(sel.node(), room, text);
    if (text && sel.text() !== text) sel.append('title').text(text);
    return sel;
  }

  // A KEY LABEL THAT WON'T FIT WRAPS, never just cuts: the band is sized before the entries arrive (a chart hands
  // them to draw(), after its map was fitted to the band), so a long country name or entries title breaks at words
  // onto up to maxLines lines. The ellipsis is kept for a label its budget can't hold; a caller near the frame's foot
  // passes a budget of 1. Returns the number of lines drawn.
  function wrap(parent, x, y, size, room, text, weight, maxLines) {
    var fs = Math.max(TYPE_FLOOR, +size || 0);
    text = text == null ? '' : String(text);
    var lh = Math.round(fs * 1.15);
    var mk = function (i) {
      var t = parent.append('text').attr('x', x).attr('y', y + i * lh).attr('font-size', fs).attr('fill', fg);
      if (weight) t.attr('font-weight', weight);
      return t;
    };
    var t1 = mk(0), node = t1.node();
    var meas = function (s) {
      node.textContent = s;
      try {
        if (typeof node.getComputedTextLength === 'function') {
          var w = node.getComputedTextLength();
          if (w > 0) return w;
        }
      } catch (e) { /* fall through to the estimate */ }
      return s.length * fs * 0.6;
    };
    var words = text.split(' ');
    if (!(maxLines > 1) || words.length < 2 || meas(text) <= room) { fit(t1, room, text); return 1; }
    var lines = [], at = 0;
    while (at < words.length && lines.length < maxLines - 1) {
      var k = words.length;
      while (k > at + 1 && meas(words.slice(at, k).join(' ')) > room) k--;
      lines.push(words.slice(at, k).join(' '));
      at = k;
    }
    if (at < words.length) lines.push(words.slice(at).join(' '));
    var cutLast = false;
    for (var i = 0; i < lines.length; i++) {
      var ti = i === 0 ? t1 : mk(i);
      fit(ti, room, lines[i]);
      if (ti.text() !== lines[i]) cutLast = true;
    }
    // The whole label stays in ONE <title> on the first line whenever it spans lines or lost its end: a hover and a
    // screen reader get the name once, not as the pieces the wrap drew.
    t1.selectAll('title').remove();
    t1.append('title').text(text);
    return lines.length;
  }

  // How many lines a label takes WHOLE at a width, wrapped at words; 0 when one word is wider than the width.
  function needLines(parent, text, size, room) {
    var nfs = Math.max(TYPE_FLOOR, +size || 0);
    var probe = parent.append('g').attr('visibility', 'hidden');
    var t = probe.append('text').attr('font-size', nfs);
    var w = function (x) {
      t.text(x);
      var v = 0;
      try { v = t.node().getComputedTextLength(); } catch (err) { v = 0; }
      return v > 0 ? v : x.length * nfs * 0.6;
    };
    var words = String(text).split(' '), n = 0, at = 0;
    while (at < words.length) {
      var k = words.length;
      while (k > at + 1 && w(words.slice(at, k).join(' ')) > room) k--;
      if (w(words.slice(at, k).join(' ')) > room) { probe.remove(); return 0; }
      n++; at = k;
    }
    probe.remove();
    return n;
  }

  function notes(svg, n) {
    n = n || {};
    var x = n.x == null ? pad : +n.x;
    var ny = n.y == null ? H - Math.max(8, CF * 0.6) : +n.y;
    // By default a note stops where the key's band starts: the band runs to the frame's foot, so a note drawn under
    // it collided with its entries.
    var right = n.right == null ? (band ? W - band - Math.round(pad / 2) : W - Math.max(4, Math.round(CF * 0.4))) : +n.right;
    var NFS = Math.max(TYPE_FLOOR, +n.fontSize > 0 ? +n.fontSize : CF);
    var g = svg.append('g').attr('class', 'llm-notes').style('pointer-events', 'none');
    return function (txt, strong) {
      var sg = g.append('g').attr('opacity', strong ? 0.95 : 0.75);
      var n2 = wrap(sg, x, ny, NFS, right - x, txt, strong ? 600 : 400, 2);
      // The stack grows UP from its baseline, so a two-line note shifts up by its extra line and reads top to bottom.
      if (n2 > 1) sg.attr('transform', 'translate(0,' + (-(n2 - 1) * Math.round(NFS * 1.15)) + ')');
      ny -= n2 * (NFS + 3);   // glyph height PLUS the gap, never the gap alone
      return sg.select('text');
    };
  }

  function draw(svg, d) {
    if (!band || !svg) return null;
    d = d || {};
    var px = W - band + pad;
    var py = Math.max(CF * 2, Math.round(H * 0.12));
    var right = W - Math.max(4, Math.round(CF * 0.4));
    var VFS = Math.max(TYPE_FLOOR, +d.valueFontSize > 0 ? +d.valueFontSize : CF * 0.9);
    var g = svg.append('g').attr('class', 'llm-key');
    if (title) {
      var tl = wrap(g, px, py, CF, right - px, title, 600, 3);
      py += CF + 6 + (tl - 1) * Math.round(CF * 1.15);
    }
    var vmax = +d.max, vmin = +d.min;
    var refs = Array.isArray(d.values) ? d.values.slice()
      : (isFinite(vmax) ? [vmax, (vmax + (isFinite(vmin) ? vmin : 0)) / 2, isFinite(vmin) ? vmin : 0] : []);
    refs = refs.filter(function (v, i, a) {
      return isFinite(v) && (i === 0 || Math.abs(v - a[i - 1]) > 1e-9);
    });
    var sw = typeof d.strokeWidth === 'function' ? d.strokeWidth : function () { return 2; };
    var fmt = typeof d.format === 'function' ? d.format : function (v) { return String(v); };
    var ink = d.color || fg;
    var lineW = Math.max(22, CF * 2.4);
    refs.forEach(function (v) {
      var lw = sw(v);
      g.append('line').attr('x1', px).attr('x2', px + lineW)
        .attr('y1', py).attr('y2', py)
        .attr('stroke', ink).attr('stroke-width', lw)
        .attr('stroke-linecap', 'round').attr('stroke-opacity', 0.8);
      var vt = g.append('text').attr('x', px + lineW + 6).attr('y', py + CF * 0.35)
        .attr('font-size', VFS).attr('fill', fg).attr('opacity', 0.8);
      fit(vt, W - (px + lineW + 6), fmt(v));   // a value may run to the frame's edge, never past it
      py += Math.max(CF + 6, lw + VFS);
    });
    var bottom = H - pad;
    var ents = Array.isArray(d.entries) ? d.entries : (Array.isArray(opts.entries) ? opts.entries : []);
    var entTitle = d.entriesTitle != null ? d.entriesTitle : opts.entriesTitle;
    if (ents.length) {
      py += 8;
      if (entTitle) {
        var el = wrap(g, px, py, CF, right - px, entTitle, 600, 4);   // an entries title may run long
        py += CF + 6 + (el - 1) * Math.round(CF * 1.15);
      }
      var box = Math.max(TYPE_FLOOR, Math.round(VFS));
      var rowH = Math.max(16, VFS + 5);
      for (var i = 0; i < ents.length && py <= bottom; i++) {
        if (i < ents.length - 1 && py + rowH > bottom) {
          var mt = g.append('text').attr('x', px).attr('y', py).attr('font-size', VFS).attr('fill', fg);
          fit(mt, right - px, '+' + (ents.length - i) + ' more');
          py += rowH;
          break;
        }
        var e = ents[i] || {};
        // AN ENTRY IS SHOWN WHOLE OR NOT AT ALL: its line budget is what the band's remaining height holds (up to 3);
        // a name that needs more folds - with every entry after it - into the '+N more' row, never a cut name.
        var elh = Math.round(VFS * 1.15), eroom = right - (px + box + 6);
        var ebudget = Math.max(1, Math.min(3, 1 + Math.floor((bottom - py) / elh)));
        var eneed = needLines(g, e.label == null ? '' : String(e.label), VFS, eroom);
        // ...and one that would leave no room for the '+N more' row the entries after it need folds too, so an entry
        // is never dropped uncounted.
        var tail = i < ents.length - 1 && py + ((eneed || 1) - 1) * elh + rowH > bottom;
        if (ents.length > 1 && (eneed === 0 || eneed > ebudget || tail)) {
          var mt2 = g.append('text').attr('x', px).attr('y', py).attr('font-size', VFS).attr('fill', fg);
          fit(mt2, right - px, '+' + (ents.length - i) + ' more');
          py += rowH;
          break;
        }
        var rows = Array.isArray(e.rows) ? e.rows.join(',') : null;
        var eg = g.append('g').attr('class', 'd3-legend-mark').style('cursor', 'pointer');
        if (rows !== null) eg.attr('data-row-idx', rows);
        // The swatch is classed too: the exec gate's legend check then measures the swatches themselves, and never a
        // union of every swatch-and-label run on the chart - which spans the zoom pad and this key's title and values.
        eg.append('rect').attr('class', 'd3-legend-mark').attr('x', px).attr('y', py - box * 0.8)
          .attr('width', box).attr('height', box).attr('fill', e.color || ink);
        var ln = wrap(eg, px + box + 6, py + 1, VFS, eroom, e.label, null, Math.max(1, Math.min(ebudget, eneed || 1)));
        py += rowH + (ln - 1) * elh;
      }
    }
    var lines = Array.isArray(d.lines) ? d.lines : (Array.isArray(opts.lines) ? opts.lines : []);
    // Extra lines wrap like the entries and are drawn as a BLOCK: each is planned first (how many lines it takes
    // whole in the band's width), then as many as fit the remaining height are drawn - never one cut, and never the
    // first line alone when more were given (a heading with nothing under it).
    if (lines.length) {
      var lh2 = Math.round(VFS * 1.15), room = right - px;
      var probe2 = g.append('text').attr('font-size', Math.max(TYPE_FLOOR, VFS));
      var pw2 = function (t) {
        probe2.text(t);
        var w0 = 0;
        try { w0 = probe2.node().getComputedTextLength(); } catch (err) { w0 = 0; }
        return w0 > 0 ? w0 : t.length * VFS * 0.6;
      };
      var need = lines.map(function (ln0) {
        var words = String(ln0 == null ? '' : ln0).split(' '), n = 0, at = 0;
        while (at < words.length) {
          var k = words.length;
          while (k > at + 1 && pw2(words.slice(at, k).join(' ')) > room) k--;
          if (pw2(words.slice(at, k).join(' ')) > room) return 0;   // one word wider than the band: not whole
          n++; at = k;
        }
        return n;
      });
      probe2.remove();
      var y0 = py + 8, take = 0, yy = y0;
      for (var q = 0; q < lines.length; q++) {
        if (!need[q]) break;
        var hgt = VFS + 5 + (need[q] - 1) * lh2;
        if (yy + (need[q] - 1) * lh2 > bottom) break;
        yy += hgt; take++;
      }
      if (take === 1 && lines.length > 1) take = 0;
      for (var j = 0; j < take; j++) {
        var nl = wrap(g, px, j === 0 ? y0 : py, VFS, room, String(lines[j] == null ? '' : lines[j]), null, need[j]);
        if (j === 0) py = y0;
        py += VFS + 5 + (nl - 1) * lh2;
      }
    }
    return g;
  }

  return { width: band, pad: pad, fontSize: CF, draw: draw, notes: notes, fit: fit };
};
// SHARED route drawing for a map of flows between places (the Origin-Destination Flow Map). Each route is ONE mark - a
// g.d3-mark carrying the route's row ids, so a click, a tooltip, a selection and a note badge all see one route - drawn
// as a great circle through the projection in short pieces, each a little more opaque than the last, so DIRECTION READS
// ALONG THE ROUTE ITSELF: pale where it leaves, full where it arrives.
//
//   var arcSel = d3.llmFlowArcs(gArcs, routes, { path: path, color: function (d) { return accent; },
//                                                 width: function (d) { return wid(d.v); }, opacity: arcAlpha });
//
// routes : one datum per route; from(d) / to(d) give [lon, lat] (default [d.og, d.oa] / [d.dg, d.da]), rows(d) its
//          row ids (default d.rows).
// cfg    : path (the d3.geoPath that drew the basemap - REQUIRED), color(d), width(d), opacity (the route's own alpha,
//          default 0.8), fadeFrom / fadeTo (the share of that alpha at the origin and the destination, default 0.2 / 1),
//          pieces (default 16), samples (default 48).
// Returns the routes' g selection: set stroke-width on it after a zoom (the pieces inherit it), and bind tooltips to it.
//
// WHY PIECES AND NOT ONE GRADIENT. An SVG linearGradient runs along a straight line - the generated code laid it from
// the projected origin to the projected destination - while the route is a great circle that bows away from that line
// (London-Tokyo arcs over the pole) and, on a Pacific crossing, is cut at the antimeridian into two pieces at opposite
// edges. Every point then takes its shade from where it falls along the straight line, not along the route, so a route
// that bows far from it stayed pale past its midpoint and read as a weaker flow. Seen on a live Fabric App: East Asia
// routes climbing off the top edge drawn almost entirely pale. Each piece here is its own geoPath LineString, so the
// antimeridian cut and the frame clip still come from geoPath, and its opacity comes from its position ALONG the route.
// Butt caps so pieces abut without doubling alpha at the joins; round joins inside a piece.
d3.llmFlowArcs = function (parent, routes, cfg) {
  cfg = cfg || {};
  var path = cfg.path;
  if (!parent || !path) return null;
  var samples = Math.max(8, Math.round(+cfg.samples || 48));
  var pieces = Math.max(2, Math.min(samples, Math.round(+cfg.pieces || 16)));
  var from = typeof cfg.from === 'function' ? cfg.from : function (d) { return [d.og, d.oa]; };
  var to = typeof cfg.to === 'function' ? cfg.to : function (d) { return [d.dg, d.da]; };
  var rows = typeof cfg.rows === 'function' ? cfg.rows : function (d) { return d.rows || []; };
  var color = typeof cfg.color === 'function' ? cfg.color : function () { return cfg.color || '#4e79a7'; };
  var width = typeof cfg.width === 'function' ? cfg.width : function () { return +cfg.width > 0 ? +cfg.width : 1.5; };
  var alpha = cfg.opacity == null || !isFinite(+cfg.opacity) ? 0.8 : Math.max(0, Math.min(1, +cfg.opacity));
  var lo = cfg.fadeFrom == null ? 0.2 : Math.max(0, Math.min(1, +cfg.fadeFrom));
  var hi = cfg.fadeTo == null ? 1 : Math.max(0, Math.min(1, +cfg.fadeTo));
  var sel = parent.selectAll(null).data(routes || []).enter().append('g')
    .attr('class', 'd3-mark')
    .attr('data-row-idx', function (d) { return [].concat(rows(d) || []).join(','); })
    .attr('fill', 'none')
    .attr('stroke', function (d) { return color(d); })
    .attr('stroke-width', function (d) { return width(d); })
    .attr('stroke-linecap', 'butt')
    .attr('stroke-linejoin', 'round');
  sel.each(function (d) {
    var a = from(d), b = to(d);
    var node = d3.select(this);
    if (!a || !b || !isFinite(+a[0]) || !isFinite(+a[1]) || !isFinite(+b[0]) || !isFinite(+b[1])) return;
    var interp = d3.geoInterpolate(a, b), pts = [];
    for (var s = 0; s <= samples; s++) pts.push(interp(s / samples));
    for (var k = 0; k < pieces; k++) {
      var i0 = Math.floor(k * samples / pieces), i1 = Math.floor((k + 1) * samples / pieces);
      if (i1 <= i0) continue;
      var geom = path({ type: 'LineString', coordinates: pts.slice(i0, i1 + 1) });
      if (!geom) continue;                     // clipped away by the frame
      var t = k / (pieces - 1);
      node.append('path').attr('class', 'llm-flow-piece').attr('d', geom)
        .attr('stroke-opacity', +(alpha * (lo + (hi - lo) * t)).toFixed(4));
    }
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


function render(container, data, options) {
  options = options || {};
  container.replaceChildren();
  var W = options.width || 800, H = options.height || 420;
  var CF = Math.max(10, Math.min(14, Math.round(Math.min(W, H) / 42)));
  var fg = options.themeFg || 'currentColor';
  var land = options.geoLandColor || '#e8e8e8';
  var PAL = options.palette && options.palette.length ? options.palette.slice() : ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf', '#393b79', '#e6550d'];
  var cols = (data.columns || []).map(function (c) { return c.name; });
  var rows = data.rows || [];
  var ix = function (n) { return cols.indexOf(n); };
  function stop(msg) {
    var t = d3.select(container).append('svg').attr('width', W).attr('height', H)
      .append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').attr('font-size', CF).attr('fill', fg);
    d3.llmFitLabel(t, W - 12, { pad: 0, text: msg || (typeof options.noDataText === 'string' && options.noDataText) || 'No data to display' });
  }
  var iRow = ix('__rowIdx__');
  var iOLat = ix('__geoLat__'), iOLon = ix('__geoLon__'), iDLat = ix('__geoLatD__'), iDLon = ix('__geoLonD__');
  if (iOLat < 0 || iOLon < 0 || iDLat < 0 || iDLon < 0) {
    iOLat = ix('OriginLatitude'); iOLon = ix('OriginLongitude'); iDLat = ix('DestinationLatitude'); iDLon = ix('DestinationLongitude');
  }
  if (iOLat < 0 || iOLon < 0 || iDLat < 0 || iDLon < 0) throw new Error('INVALID:column "origin/destination coordinates" not found');
  var iOName = ix('OriginCountry'), iDName = ix('DestinationCountry');
  var iOCode = ix('OriginCountryCode'), iDCode = ix('DestinationCountryCode');
  if (iOName < 0) throw new Error('INVALID:column "OriginCountry" not found');
  var V = d3.llmValueColumn(data.columns, rows, { countLabel: 'Routes', exclude: [iOLat, iOLon, iDLat, iDLon], excludeCoordinates: true });
  var valName = V.isCount ? V.valueName + ' (count of rows)' : V.valueName;
  var num = function (v) { return (v === null || v === '' || v === undefined) ? null : (isFinite(+v) ? +v : null); };
  var routes = {}, order = [], dropped = 0, selfRoutes = 0;
  rows.forEach(function (row, r) {
    var oa = num(row[iOLat]), og = num(row[iOLon]), da = num(row[iDLat]), dg = num(row[iDLon]);
    if (oa === null || og === null || da === null || dg === null || Math.abs(oa) > 90 || Math.abs(da) > 90 || Math.abs(og) > 180 || Math.abs(dg) > 180) { dropped++; return; }
    var k = oa.toFixed(3) + ',' + og.toFixed(3) + '>' + da.toFixed(3) + ',' + dg.toFixed(3);
    var rt = routes[k];
    if (!rt) {
      rt = routes[k] = { oa: oa, og: og, da: da, dg: dg, v: 0, n: 0, rows: [], oName: row[iOName], dName: iDName >= 0 ? row[iDName] : null,
        oCode: iOCode >= 0 ? row[iOCode] : null, dCode: iDCode >= 0 ? row[iDCode] : null,
        self: Math.abs(oa - da) < 1e-6 && Math.abs(og - dg) < 1e-6 };
      order.push(rt);
      if (rt.self) selfRoutes++;
    }
    rt.v += (V.valueOf(row) || 0); rt.n++;
    rt.rows.push(iRow >= 0 ? row[iRow] : r);
  });
  if (!order.length) { stop(rows.length ? 'No route has a usable location at both ends' : ''); return; }
  order.sort(function (a, b) { return b.v - a.v; });
  var cap = Math.min(150, (+options.maxMapPoints > 0 ? +options.maxMapPoints : 2000));
  var total = order.length, truncated = 0;
  if (order.length > cap) { truncated = order.length - cap; order = order.slice(0, cap); }
  var cats = [];
  order.forEach(function (d) { if (cats.indexOf(d.oName) < 0) cats.push(d.oName); });
  var scheme = PAL.slice();
  while (scheme.length < cats.length) scheme.push(d3.interpolateRainbow(scheme.length / (cats.length + 1)));
  var colorOf = d3.scaleOrdinal(cats, scheme);
  var catRows = {};
  order.forEach(function (d) { (catRows[d.oName] = catRows[d.oName] || []).push.apply(catRows[d.oName], d.rows); });
  var entries = cats.map(function (c) { return { label: String(c), color: colorOf(c), rows: catRows[c] }; });

  var key = d3.llmFlowKey({ width: W, height: H, fontSize: CF, title: valName, themeFg: fg, entriesTitle: cats.length > 1 ? 'Origin' : undefined, entries: cats.length > 1 ? entries : undefined });
  var mapW = W - key.width, mapH = H;
  var svg = d3.select(container).append('svg').attr('width', W).attr('height', H).attr('viewBox', '0 0 ' + W + ' ' + H);
  var arcSel = null, dotSel = null;
  var wid;
  var z = d3.llmGeoZoom ? d3.llmGeoZoom(svg, {
    width: mapW, height: mapH, themeFg: fg, backgroundColor: options.backgroundColor, fontSize: CF, maxScale: 10,
    onZoom: function (t) {
      var k = (t && t.k) || 1;
      if (arcSel) arcSel.attr('stroke-width', function (d) { return Math.max(0.6, wid(d.v) / k); });
      if (dotSel) dotSel.attr('r', function (d) { return d.r / k; }).attr('stroke-width', 0.8 / k);
    }
  }) : null;
  var gRoot = z ? z.layer : svg.append('g');
  var geo = (options.geo && options.geo.features && options.geo.features.length) ? options.geo : null;
  var proj = d3.geoNaturalEarth1();
  var pad = Math.max(8, Math.round(CF * 0.8));
  var epts = [];
  order.forEach(function (d) { epts.push([d.og, d.oa]); epts.push([d.dg, d.da]); });
  var wf = d3.llmWorldFit(proj, { geo: geo, points: epts, width: mapW, height: mapH, pad: pad, viewport: [W, H] });
  var path = wf.path;
  if (geo) {
    wf.basemap(svg, gRoot).selectAll('path').data(geo.features).enter().append('path')
      .attr('d', path).attr('fill', land).attr('stroke', '#fff').attr('stroke-width', 0.5).style('pointer-events', 'none');
  }
  var vmax = d3.max(order, function (d) { return d.v; }) || 1;
  var vmin = d3.min(order, function (d) { return d.v; }) || 0;
  var wMax = Math.max(2.5, Math.min(14, Math.round(Math.min(mapW, mapH) / 38)));
  wid = function (v) { return Math.max(0.9, Math.sqrt(Math.max(0, v) / vmax) * wMax); };
  var gArcs = gRoot.append('g');
  var drawable = order.filter(function (d) { return !d.self; });
  arcSel = d3.llmFlowArcs(gArcs, drawable, {
    path: path,
    color: function (d) { return colorOf(d.oName); },
    width: function (d) { return wid(d.v); },
    opacity: 0.95
  });
  if (selfRoutes) {
    gRoot.append('g').selectAll('circle').data(order.filter(function (d) { return d.self; })).enter().append('circle')
      .attr('class', 'd3-mark').style('cursor', 'pointer')
      .attr('data-row-idx', function (d) { return d.rows.join(','); })
      .attr('cx', function (d) { var p = proj([d.og, d.oa]); return p ? p[0] : -99; })
      .attr('cy', function (d) { var p = proj([d.og, d.oa]); return p ? p[1] : -99; })
      .attr('r', function (d) { return Math.max(2.5, wid(d.v) * 0.9); })
      .attr('fill', 'none').attr('stroke', function (d) { return colorOf(d.oName); }).attr('stroke-width', 1.4);
  }
  var endPts = [];
  drawable.forEach(function (d) {
    endPts.push({ ll: [d.og, d.oa], r: Math.max(1.5, CF * 0.16), end: 'origin', rows: d.rows, c: colorOf(d.oName) });
    endPts.push({ ll: [d.dg, d.da], r: Math.max(2, CF * 0.22), end: 'destination', rows: d.rows, c: colorOf(d.oName) });
  });
  dotSel = gRoot.append('g').selectAll('circle').data(endPts).enter().append('circle')
    .attr('class', 'd3-mark').style('cursor', 'pointer')
    .attr('data-row-idx', function (d) { return d.rows.join(','); })
    .attr('cx', function (d) { var p = proj(d.ll); return p ? p[0] : -99; })
    .attr('cy', function (d) { var p = proj(d.ll); return p ? p[1] : -99; })
    .attr('r', function (d) { return d.r; })
    .attr('fill', function (d) { return d.end === 'destination' ? d.c : '#ffffff'; })
    .attr('stroke', function (d) { return d.c; }).attr('stroke-width', 0.8);
  var nf = new Intl.NumberFormat(options.cultureCode, { maximumFractionDigits: 0 });
  var nfSmall = new Intl.NumberFormat(options.cultureCode, { maximumSignificantDigits: 2 });
  var fmt = function (v) {
    if (!isFinite(v)) return '-';
    return Math.abs(v) >= 1 ? nf.format(v) : nfSmall.format(v);
  };
  if (options.allowTooltips !== false && d3.llmTooltip) {
    var tip = d3.llmTooltip(container);
    arcSel.style('cursor', 'pointer')
      .on('mouseover', function (e, d) {
        tip.show('<b>' + d.oName + ' to ' + (d.dName == null ? 'Destination' : d.dName) + '</b><br/>' +
          (d.oCode != null ? 'Origin code: ' + d.oCode + '<br/>' : '') +
          (d.dCode != null ? 'Destination code: ' + d.dCode + '<br/>' : '') +
          valName + ': ' + fmt(d.v) + '<br/>' + d.n + (d.n === 1 ? ' row' : ' rows'), e);
      })
      .on('mousemove', function (e) { tip.move(e); })
      .on('mouseout', function () { tip.hide(); });
  }
  var note = key.notes(svg, { x: pad, y: mapH - Math.max(8, CF * 0.6) });
  note('Arcs run pale to solid, origin to destination');
  if (selfRoutes) note(selfRoutes + (selfRoutes === 1 ? ' route starts' : ' routes start') + ' and ends in the same place (drawn as rings)');
  if (dropped) note(dropped + (dropped === 1 ? ' row' : ' rows') + ' not shown: missing location at one or both ends');
  if (truncated) note('Showing the ' + order.length + ' largest of ' + total + ' routes - raise the map-point cap to see more', true);
  key.draw(svg, { max: vmax, min: vmin, strokeWidth: wid, format: fmt, color: '#7f7f7f', valueFontSize: Math.max(10, CF * 0.9) });
  var title = svg.append('text').attr('x', pad).attr('y', CF + 4).attr('font-size', CF + 2).attr('font-weight', 600).attr('fill', fg);
  d3.llmFitLabel(title, mapW - pad * 2, { pad: 0, text: 'Shipping Lanes by Units Shipped' });
}
